import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "dist", "cli.js");
const version = (
  JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
  }
).version;
const isWindows = process.platform === "win32";

const workspace = mkdtempSync(join(tmpdir(), "json-sort-cli-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

let counter = 0;
function makeDir(): string {
  const dir = join(workspace, `case-${++counter}`);
  mkdirSync(dir);
  return dir;
}

function file(dir: string, name: string, content: string | Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  args: string[],
  options: { input?: string | Buffer; cwd?: string } = {},
): Run {
  const result = spawnSync(process.execPath, [cli, ...args], {
    input: options.input ?? "",
    cwd: options.cwd ?? workspace,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const UNSORTED = '{"b":1,"a":{"d":[{"z":1,"y":2}],"c":null}}';
const SORTED =
  '{\n  "a": {\n    "c": null,\n    "d": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n';

describe("print mode", () => {
  test("file to stdout with a single trailing LF", () => {
    const dir = makeDir();
    const r = run([file(dir, "a.json", UNSORTED)]);
    assert.deepEqual(r, { code: 0, stdout: SORTED, stderr: "" });
  });

  test("stdin pipe without arguments", () => {
    assert.deepEqual(run([], { input: UNSORTED }), {
      code: 0,
      stdout: SORTED,
      stderr: "",
    });
  });

  test("explicit - reads stdin", () => {
    const r = run(["-", "--indent", "0"], { input: '{"b":1,"a":2}' });
    assert.deepEqual(r, { code: 0, stdout: '{"a":2,"b":1}\n', stderr: "" });
  });

  test("sorting flags", () => {
    const input =
      '{"item10":1,"item2":2,"ID":0,"id":3,"name":4,"B":{"b":1,"a":2}}';
    assert.equal(
      run(["--indent=0", "--desc", "--numeric"], { input }).stdout,
      '{"name":4,"item10":1,"item2":2,"id":3,"ID":0,"B":{"b":1,"a":2}}\n',
    );
    assert.equal(
      run(["--indent", "0", "--pin", "name", "--pin=id"], { input }).stdout,
      '{"name":4,"id":3,"B":{"a":2,"b":1},"ID":0,"item10":1,"item2":2}\n',
    );
    assert.equal(
      run(["--indent", "0", "--ignore-case", "--no-recursive"], { input })
        .stdout,
      '{"B":{"b":1,"a":2},"ID":0,"id":3,"item10":1,"item2":2,"name":4}\n',
    );
    assert.equal(
      run(["--indent", "tab"], { input: '{"a":[1]}' }).stdout,
      '{\n\t"a": [\n\t\t1\n\t]\n}\n',
    );
    assert.equal(
      run(["--indent", "4", "--indent", "4"], { input: "[1]" }).stdout,
      "[\n    1\n]\n",
    );
  });

  test(
    "symlinked input is readable in print mode",
    { skip: isWindows && "symlinks need privileges" },
    () => {
      const dir = makeDir();
      const target = file(dir, "target.json", UNSORTED);
      symlinkSync(target, join(dir, "link.json"));
      assert.equal(run([join(dir, "link.json")]).stdout, SORTED);
    },
  );

  test("-- ends option parsing", () => {
    const dir = makeDir();
    file(dir, "--write", "[1]");
    const r = run(["--", "--write"], { cwd: dir });
    assert.deepEqual(r, { code: 0, stdout: "[\n  1\n]\n", stderr: "" });
  });

  test("--help and --version", () => {
    const help = run(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^json-sort \[file \.\.\.\] \[options\]/);
    assert.match(help.stdout, /--indent <0\|2\|4\|tab>/);
    assert.deepEqual(run(["--version"]), {
      code: 0,
      stdout: `${version}\n`,
      stderr: "",
    });
  });
});

describe("usage errors (exit 2)", () => {
  const cases: [string, string[]][] = [
    ["unknown flag", ["--sort"]],
    ["short unknown flag", ["-w"]],
    ["missing --pin value", ["--pin"]],
    ["missing --indent value", ["--indent"]],
    ["invalid --indent", ["--indent", "3"]],
    ["conflicting --indent", ["--indent", "2", "--indent", "4"]],
    ["value on boolean flag", ["--write=yes"]],
    ["--write with --check", ["--write", "--check", "a.json"]],
    ["duplicate --pin", ["--pin", "id", "--pin", "id", "-"]],
    ["multiple files in print mode", ["a.json", "b.json"]],
    ["--write with stdin", ["--write", "-"]],
    ["--check mixing stdin and files", ["--check", "-", "a.json"]],
    ["--check with stdin twice", ["--check", "-", "-"]],
  ];
  for (const [name, args] of cases) {
    test(name, () => {
      const r = run(args, { input: "{}" });
      assert.equal(r.code, 2, r.stderr);
      assert.equal(r.stdout, "");
      assert.notEqual(r.stderr, "");
    });
  }
});

describe("input errors (exit 2)", () => {
  test("missing file", () => {
    const r = run([join(makeDir(), "nope.json")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /nope\.json: No such file/);
    assert.equal(r.stdout, "");
  });

  test("directory", () => {
    const r = run([makeDir()]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Is a directory/);
  });

  test("invalid JSON reports location without content", () => {
    const r = run([], { input: '{"secret":"s3cr3t",}' });
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /<stdin>: Invalid JSON .* line 1, column 20/);
    assert.doesNotMatch(r.stderr, /s3cr3t/);
  });

  test("duplicate key", () => {
    const r = run([], { input: '{"a":1,"a":2}' });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Duplicate key "a"/);
  });

  test("invalid UTF-8", () => {
    const r = run([], { input: Buffer.from([0x22, 0xc3, 0x28, 0x22]) });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not valid UTF-8/);
  });

  test("empty stdin", () => {
    assert.equal(run([], { input: "" }).code, 2);
  });
});

describe("--check", () => {
  test("formatted file passes silently", () => {
    const dir = makeDir();
    const r = run(["--check", file(dir, "ok.json", SORTED)]);
    assert.deepEqual(r, { code: 0, stdout: "", stderr: "" });
  });

  test("unsorted file exits 1 and is listed on stderr", () => {
    const dir = makeDir();
    const bad = file(dir, "bad.json", UNSORTED);
    const ok = file(dir, "ok.json", SORTED);
    const r = run(["--check", ok, bad]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /bad\.json/);
    assert.doesNotMatch(r.stderr, /ok\.json/);
    assert.equal(readFileSync(bad, "utf8"), UNSORTED);
  });

  test("format details matter: final newline, CRLF, BOM, indent", () => {
    const dir = makeDir();
    const variants = {
      "no-newline.json": SORTED.trimEnd(),
      "two-newlines.json": `${SORTED}\n`,
      "crlf.json": SORTED.replace(/\n/g, "\r\n"),
      "bom.json": `\uFEFF${SORTED}`,
    };
    for (const [name, content] of Object.entries(variants)) {
      assert.equal(run(["--check", file(dir, name, content)]).code, 1, name);
    }
    assert.equal(
      run(["--check", "--indent", "4", file(dir, "indent.json", SORTED)]).code,
      1,
    );
  });

  test("stdin", () => {
    assert.deepEqual(run(["--check"], { input: SORTED }), {
      code: 0,
      stdout: "",
      stderr: "",
    });
    assert.equal(run(["--check", "-"], { input: UNSORTED }).code, 1);
  });

  test("errors take priority over differences", () => {
    const dir = makeDir();
    const r = run([
      "--check",
      file(dir, "bad.json", UNSORTED),
      file(dir, "broken.json", "{"),
    ]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /broken\.json/);
  });
});

describe("--write", () => {
  test("rewrites files in place with empty stdout", () => {
    const dir = makeDir();
    const a = file(dir, "a.json", UNSORTED);
    const b = file(dir, "b.json", '[{"b":1,"a":2}]');
    const r = run(["--write", a, b]);
    assert.deepEqual(r, { code: 0, stdout: "", stderr: "" });
    assert.equal(readFileSync(a, "utf8"), SORTED);
    assert.equal(
      readFileSync(b, "utf8"),
      '[\n  {\n    "a": 2,\n    "b": 1\n  }\n]\n',
    );
    assert.deepEqual(readdirSync(dir).sort(), ["a.json", "b.json"]);
  });

  test("idempotent: unchanged files are not rewritten", () => {
    const dir = makeDir();
    const path = file(dir, "a.json", UNSORTED);
    assert.equal(run(["--write", path]).code, 0);
    const before = statSync(path);
    assert.equal(run(["--write", path]).code, 0);
    const afterStat = statSync(path);
    assert.equal(afterStat.ino, before.ino);
    assert.equal(afterStat.mtimeMs, before.mtimeMs);
    assert.equal(readFileSync(path, "utf8"), SORTED);
  });

  test("invalid JSON in any file prevents all writes", () => {
    const dir = makeDir();
    const a = file(dir, "a.json", UNSORTED);
    const broken = file(dir, "broken.json", '{"a":1,}');
    const c = file(dir, "c.json", UNSORTED);
    const r = run(["--write", a, broken, c]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.equal(readFileSync(a, "utf8"), UNSORTED);
    assert.equal(readFileSync(broken, "utf8"), '{"a":1,}');
    assert.equal(readFileSync(c, "utf8"), UNSORTED);
    assert.deepEqual(readdirSync(dir).sort(), [
      "a.json",
      "broken.json",
      "c.json",
    ]);
  });

  test(
    "refuses symbolic links",
    { skip: isWindows && "symlinks need privileges" },
    () => {
      const dir = makeDir();
      const target = file(dir, "target.json", UNSORTED);
      const link = join(dir, "link.json");
      symlinkSync(target, link);
      const r = run(["--write", link]);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /symbolic link/);
      assert.equal(readFileSync(target, "utf8"), UNSORTED);
    },
  );

  test(
    "preserves file mode",
    { skip: isWindows && "POSIX permissions only" },
    () => {
      const dir = makeDir();
      const path = file(dir, "a.json", UNSORTED);
      chmodSync(path, 0o640);
      assert.equal(run(["--write", path]).code, 0);
      assert.equal(statSync(path).mode & 0o777, 0o640);
      chmodSync(path, 0o604);
      writeFileSync(path, UNSORTED);
      assert.equal(run(["--write", path]).code, 0);
      assert.equal(statSync(path).mode & 0o777, 0o604);
    },
  );

  test(
    "unwritable directory fails and leaves the file intact",
    {
      skip:
        (isWindows || process.getuid?.() === 0) &&
        "needs POSIX permissions and non-root user",
    },
    () => {
      const dir = makeDir();
      const path = file(dir, "a.json", UNSORTED);
      chmodSync(dir, 0o555);
      try {
        const r = run(["--write", path]);
        assert.equal(r.code, 2);
        assert.match(r.stderr, /Permission denied/);
        assert.equal(readFileSync(path, "utf8"), UNSORTED);
        assert.deepEqual(readdirSync(dir), ["a.json"]);
      } finally {
        chmodSync(dir, 0o755);
      }
    },
  );
});

describe("input size limit", () => {
  const big = (bytes: number): string =>
    `[${"0,".repeat(Math.ceil(bytes / 2))}0]`;

  test("file over 10 MiB", () => {
    const dir = makeDir();
    const content = big(10 * 1024 * 1024 + 16);
    const path = file(dir, "big.json", content);
    const r = run(["--write", path]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /10 MiB/);
    assert.equal(statSync(path).size, content.length);
  });

  test("stdin over 10 MiB", () => {
    const r = run([], { input: big(10 * 1024 * 1024 + 16) });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /10 MiB/);
    assert.equal(r.stdout, "");
  });

  test("limit is shared by all files of a run", () => {
    const dir = makeDir();
    const half = `{"b":${big(6 * 1024 * 1024)},"a":1}`;
    const a = file(dir, "a.json", half);
    const b = file(dir, "b.json", half);
    const r = run(["--write", a, b]);
    assert.equal(r.code, 2);
    assert.equal(readFileSync(a, "utf8"), half);
    assert.equal(readFileSync(b, "utf8"), half);
  });

  test("input just under the limit works", () => {
    const r = run(["--indent", "0"], { input: big(9 * 1024 * 1024) });
    assert.equal(r.code, 0);
  });
});
