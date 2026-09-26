// Packs the library, installs the tarball into fresh consumer projects and exercises
// ESM import, CommonJS require, TypeScript consumers, the installed bin and a browser bundle.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const work = mkdtempSync(join(tmpdir(), "json-sort-package-"));
const keep = process.env.KEEP_SMOKE === "1";
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
let tarball = "";

function sh(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
    shell: isWindows,
    ...options,
  });
}

function step(name) {
  console.log(`\n== ${name}`);
}

function write(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(dir, name), content);
}

function consumer(name, files) {
  const dir = join(work, name);
  write(dir, files);
  sh(
    "npm",
    ["install", tarball, "--no-audit", "--no-fund", "--loglevel=error"],
    dir,
  );
  return dir;
}

const EXPECT_COMPACT = '{"1":"one","10":"ten","2":"two"}';
const EXPECT_NUMBERS = '{"a":1.2300,"id":9007199254740993,"z":1e+03}';

try {
  step("build");
  sh("npm", ["run", "build", "--silent"], root, { stdio: "inherit" });
  const esmBundle = readFileSync(join(root, "dist", "esm", "index.js"), "utf8");
  assert.match(
    esmBundle,
    /from "jsonc-parser"/,
    "jsonc-parser must stay an external dependency",
  );

  step("npm pack");
  const packed = JSON.parse(
    sh("npm", ["pack", "--json", "--pack-destination", work], root),
  )[0];
  tarball = join(work, packed.filename);
  const files = packed.files.map((f) => f.path).sort();
  console.log(files.join("\n"));
  for (const required of [
    "package.json",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "dist/cli.js",
    "dist/esm/index.js",
    "dist/esm/index.d.ts",
    "dist/cjs/index.js",
    "dist/cjs/index.d.ts",
    "dist/cjs/package.json",
  ]) {
    assert.ok(files.includes(required), `tarball is missing ${required}`);
  }
  for (const path of files) {
    assert.ok(
      /^(package\.json|README\.md|LICENSE|CHANGELOG\.md|dist\/.+\.(js|d\.ts|json))$/.test(
        path,
      ),
      `unexpected file in tarball: ${path}`,
    );
  }

  step("ESM consumer");
  const esm = consumer("esm", {
    "package.json": JSON.stringify({
      name: "esm-consumer",
      private: true,
      type: "module",
    }),
    "index.js": `
      import assert from 'node:assert/strict'
      import { formatJson, stringifySorted, JsonSortError } from '@helpers-work/json-sort'
      assert.equal(formatJson('{"2":"two","10":"ten","1":"one"}', { indent: 0 }), ${JSON.stringify(EXPECT_COMPACT)})
      assert.equal(formatJson('{"z":1e+03,"id":9007199254740993,"a":1.2300}', { indent: 0 }), ${JSON.stringify(EXPECT_NUMBERS)})
      assert.equal(stringifySorted({ b: 1, a: [2] }, { indent: 0 }), '{"a":[2],"b":1}')
      assert.throws(() => formatJson('{"a":1,"a":2}'), (e) => e instanceof JsonSortError && e.code === 'DUPLICATE_KEY')
      console.log('esm ok')
    `,
  });
  console.log(sh("node", ["index.js"], esm).trim());

  step("CommonJS consumer");
  const cjs = consumer("cjs", {
    "package.json": JSON.stringify({
      name: "cjs-consumer",
      private: true,
      type: "commonjs",
    }),
    "index.js": `
      const assert = require('node:assert/strict')
      const { formatJson, stringifySorted, JsonSortError } = require('@helpers-work/json-sort')
      assert.equal(formatJson('{"2":"two","10":"ten","1":"one"}', { indent: 0 }), ${JSON.stringify(EXPECT_COMPACT)})
      assert.equal(stringifySorted({ b: 1, a: 2 }, { indent: 0, pinnedKeys: ['b'] }), '{"b":1,"a":2}')
      assert.throws(() => stringifySorted({ a: undefined }), (e) => e instanceof JsonSortError && e.code === 'UNSUPPORTED_VALUE')
      assert.equal(require.resolve('@helpers-work/json-sort').replace(/\\\\/g, '/').endsWith('dist/cjs/index.js'), true)
      console.log('cjs ok')
    `,
  });
  console.log(sh("node", ["index.js"], cjs).trim());

  const tsSource = `
    import { formatJson, stringifySorted, JsonSortError } from '@helpers-work/json-sort'
    import type { JsonSortOptions, JsonValue, JsonSortErrorCode } from '@helpers-work/json-sort'
    const options: JsonSortOptions = { indent: 0, numeric: true, pinnedKeys: ['id'] }
    const value: JsonValue = { b: [1, 'x', null, { c: true }], id: 1 }
    const text: string = stringifySorted(value, options) + formatJson('{}', options)
    // Never called: these lines only have to fail type checking.
    export function typeErrors(): void {
      // @ts-expect-error indent 3 is not allowed
      formatJson('{}', { indent: 3 })
      // @ts-expect-error unknown option
      formatJson('{}', { sortArrays: true })
      // @ts-expect-error undefined is not JSON
      stringifySorted({ a: undefined })
    }
    try { formatJson(text) } catch (error) {
      if (error instanceof JsonSortError) {
        const code: JsonSortErrorCode = error.code
        const line: number | undefined = error.line
        console.log(code, line, error.path)
      }
    }
    console.log(stringifySorted(value, options))
  `;
  const tsconfig = (compilerOptions) =>
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: false,
        types: [],
        ...compilerOptions,
      },
      files: ["index.ts"],
    });

  step("TypeScript consumer (nodenext, ESM)");
  const tsEsm = consumer("ts-esm", {
    "package.json": JSON.stringify({
      name: "ts-esm-consumer",
      private: true,
      type: "module",
    }),
    "tsconfig.json": tsconfig({
      module: "nodenext",
      moduleResolution: "nodenext",
      target: "es2023",
      outDir: "out",
    }),
    "index.ts": tsSource,
  });
  sh("node", [tsc, "-p", "."], tsEsm, { stdio: "inherit" });
  console.log(sh("node", ["out/index.js"], tsEsm).trim());

  step("TypeScript consumer (nodenext, CommonJS)");
  const tsCjs = consumer("ts-cjs", {
    "package.json": JSON.stringify({
      name: "ts-cjs-consumer",
      private: true,
      type: "commonjs",
    }),
    "tsconfig.json": tsconfig({
      module: "nodenext",
      moduleResolution: "nodenext",
      target: "es2023",
      outDir: "out",
    }),
    "index.ts": tsSource,
  });
  sh("node", [tsc, "-p", "."], tsCjs, { stdio: "inherit" });
  assert.match(
    readFileSync(join(tsCjs, "out", "index.js"), "utf8"),
    /require\("@helpers-work\/json-sort"\)/,
  );
  console.log(sh("node", ["out/index.js"], tsCjs).trim());

  step("TypeScript consumer (bundler resolution)");
  const tsBundler = consumer("ts-bundler", {
    "package.json": JSON.stringify({
      name: "ts-bundler-consumer",
      private: true,
      type: "module",
    }),
    "tsconfig.json": tsconfig({
      module: "esnext",
      moduleResolution: "bundler",
      target: "es2023",
      noEmit: true,
    }),
    "index.ts": tsSource,
  });
  sh("node", [tsc, "-p", "."], tsBundler, { stdio: "inherit" });
  console.log("bundler types ok");

  step("installed CLI bin");
  const bin = join(
    esm,
    "node_modules",
    ".bin",
    isWindows ? "json-sort.cmd" : "json-sort",
  );
  assert.ok(existsSync(bin), "bin link missing");
  const runBin = (args, input) =>
    spawnSync(bin, args, {
      cwd: esm,
      input,
      encoding: "utf8",
      shell: isWindows,
    });
  const version = runBin(["--version"], "");
  assert.equal(version.status, 0, version.stderr);
  assert.equal(
    version.stdout.trim(),
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
  );
  const piped = runBin(["--indent", "0"], '{"b":1,"a":2}');
  assert.deepEqual(
    [piped.status, piped.stdout, piped.stderr],
    [0, '{"a":2,"b":1}\n', ""],
  );
  writeFileSync(join(esm, "data.json"), '{"b":1,"a":2}');
  assert.equal(runBin(["--check", "data.json"], "").status, 1);
  assert.equal(runBin(["--write", "data.json"], "").status, 0);
  assert.equal(runBin(["--check", "data.json"], "").status, 0);
  assert.equal(
    readFileSync(join(esm, "data.json"), "utf8"),
    '{\n  "a": 2,\n  "b": 1\n}\n',
  );
  console.log("cli ok");

  step("browser bundle");
  const browser = consumer("browser", {
    "package.json": JSON.stringify({
      name: "browser-consumer",
      private: true,
      type: "module",
    }),
    "main.js": `
      import { formatJson, stringifySorted, JsonSortError } from '@helpers-work/json-sort'
      const out = document.getElementById('out')
      try {
        const checks = [
          [formatJson('{"2":"two","10":"ten","1":"one"}', { indent: 0 }), ${JSON.stringify(EXPECT_COMPACT)}],
          [formatJson('{"z":1e+03,"id":9007199254740993,"a":1.2300}', { indent: 0 }), ${JSON.stringify(EXPECT_NUMBERS)}],
          [stringifySorted({ b: 1, a: 2 }, { indent: 0 }), '{"a":2,"b":1}'],
        ]
        let duplicate = ''
        try { formatJson('{"a":1,"\\\\u0061":2}') } catch (e) { duplicate = e instanceof JsonSortError ? e.code : String(e) }
        checks.push([duplicate, 'DUPLICATE_KEY'])
        const failed = checks.filter(([actual, expected]) => actual !== expected)
        out.textContent = failed.length === 0 ? 'BROWSER_SMOKE_PASS' : 'BROWSER_SMOKE_FAIL ' + JSON.stringify(failed)
      } catch (error) {
        out.textContent = 'BROWSER_SMOKE_FAIL ' + String(error)
      }
    `,
  });
  // platform=browser makes esbuild fail on any node: builtin, so success means no Node polyfills are needed.
  await build({
    absWorkingDir: browser,
    entryPoints: ["main.js"],
    outfile: "bundle.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "warning",
  });
  const bundle = readFileSync(join(browser, "bundle.js"), "utf8");
  assert.doesNotMatch(
    bundle,
    /\bprocess\.|require\(["']node:/,
    "bundle references Node APIs",
  );
  writeFileSync(
    join(browser, "index.html"),
    `<!doctype html><html><body><pre id="out">NOT_RUN</pre><script>${bundle.replace(/<\/script/gi, "<\\/script")}</script></body></html>`,
  );
  console.log(`bundle size: ${bundle.length} bytes`);

  const chromeCandidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  const chrome = chromeCandidates.find((path) => existsSync(path));
  if (!chrome) {
    if (process.env.REQUIRE_BROWSER === "1")
      throw new Error("Chrome not found but REQUIRE_BROWSER=1");
    console.log(
      "SKIPPED: headless Chrome not found; browser bundle built but not executed",
    );
  } else {
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      `--user-data-dir=${join(work, "chrome-profile")}`,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      "--dump-dom",
      pathToFileURL(join(browser, "index.html")).href,
    ];
    const result = spawnSync(chrome, args, {
      encoding: "utf8",
      timeout: 60_000,
    });
    const match = /<pre id="out">([^<]*)<\/pre>/.exec(result.stdout ?? "");
    assert.equal(
      match?.[1],
      "BROWSER_SMOKE_PASS",
      `headless Chrome result: ${match?.[1] ?? result.stderr}`,
    );
    console.log(`browser ok (${chrome})`);
  }

  console.log("\nAll package smoke tests passed.");
} finally {
  if (keep) console.log(`Kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
