// Builds dist/: ESM + CJS bundles of the core, the CLI bundle, and declarations for both formats.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const typesOut = join(root, "build-types");

rmSync(dist, { recursive: true, force: true });
rmSync(typesOut, { recursive: true, force: true });

const shared = {
  absWorkingDir: root,
  bundle: true,
  target: "es2023",
  external: ["jsonc-parser"],
  logLevel: "warning",
  legalComments: "none",
};

await build({
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/esm/index.js",
  format: "esm",
  platform: "neutral",
});

await build({
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/cjs/index.js",
  format: "cjs",
  platform: "neutral",
});
writeFileSync(
  join(dist, "cjs", "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
);

await build({
  ...shared,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  format: "esm",
  platform: "node",
});
chmodSync(join(dist, "cli.js"), 0o755);

const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
});

// Only these declaration files form the public surface; internal modules stay private.
const publicDeclarations = ["index.d.ts", "types.d.ts", "errors.d.ts"];
for (const file of publicDeclarations) {
  const source = readFileSync(join(typesOut, file), "utf8").replace(
    /(from\s+['"]\.\/[\w-]+)\.ts(['"])/g,
    "$1.js$2",
  );
  const imports = [...source.matchAll(/from\s+['"](\.\/[\w-]+)\.js['"]/g)].map(
    (m) => `${m[1]}.d.ts`,
  );
  for (const target of imports) {
    if (!publicDeclarations.includes(target.slice(2))) {
      throw new Error(`${file} references non-public declaration ${target}`);
    }
  }
  for (const format of ["esm", "cjs"]) {
    mkdirSync(join(dist, format), { recursive: true });
    writeFileSync(join(dist, format, file), source);
  }
}
rmSync(typesOut, { recursive: true, force: true });

console.log("Built dist/esm, dist/cjs and dist/cli.js");
