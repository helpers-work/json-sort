#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { JsonSortError, formatJson } from "./index.ts";
import type { JsonSortOptions } from "./index.ts";

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const STDIN_LABEL = "<stdin>";

const HELP = `json-sort [file ...] [options]

Sort JSON object keys and format the result.

--write              Rewrite files in place.
--check              Check sorting and formatting without changing files.
--desc               Sort unpinned keys in descending order.
--numeric            Compare digit runs numerically.
--ignore-case        Compare keys without case sensitivity.
--no-recursive       Sort only the root object.
--pin <key>          Pin a key first; repeat to set multiple keys.
--indent <0|2|4|tab>  Set indentation; default: 2.
--help               Show help.
--version            Show package version.
--                    End option parsing.

Exit codes: 0 success, 1 --check found differences, 2 error.
`;

/** An expected failure reported to the user with exit code 2. */
class CliError extends Error {}

type Mode = "print" | "write" | "check";

interface ParsedArgs {
  mode: Mode;
  inputs: string[];
  options: JsonSortOptions;
  help: boolean;
  version: boolean;
}

function parseIndent(value: string): 0 | 2 | 4 | "\t" {
  switch (value) {
    case "0":
      return 0;
    case "2":
      return 2;
    case "4":
      return 4;
    case "tab":
      return "\t";
    default:
      throw new CliError(`Invalid value for --indent: expected 0, 2, 4 or tab`);
  }
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Set<string>();
  const pins: string[] = [];
  const inputs: string[] = [];
  let indent: 0 | 2 | 4 | "\t" | undefined;
  let optionsEnded = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (optionsEnded || arg === "-" || !arg.startsWith("-")) {
      inputs.push(arg);
      continue;
    }
    if (arg === "--") {
      optionsEnded = true;
      continue;
    }
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const takeValue = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined)
        throw new CliError(`Option ${name} requires a value`);
      i++;
      return next;
    };
    switch (name) {
      case "--write":
      case "--check":
      case "--desc":
      case "--numeric":
      case "--ignore-case":
      case "--no-recursive":
      case "--help":
      case "--version":
        if (inline !== undefined)
          throw new CliError(`Option ${name} does not take a value`);
        flags.add(name);
        break;
      case "--pin":
        pins.push(takeValue());
        break;
      case "--indent": {
        const value = parseIndent(takeValue());
        if (indent !== undefined && indent !== value) {
          throw new CliError("Conflicting values for --indent");
        }
        indent = value;
        break;
      }
      default:
        throw new CliError(`Unknown option ${name}`);
    }
  }

  if (flags.has("--write") && flags.has("--check")) {
    throw new CliError("--write and --check cannot be used together");
  }

  const options: JsonSortOptions = {
    order: flags.has("--desc") ? "desc" : "asc",
    recursive: !flags.has("--no-recursive"),
    caseSensitive: !flags.has("--ignore-case"),
    numeric: flags.has("--numeric"),
    pinnedKeys: pins,
    indent: indent ?? 2,
  };
  return {
    mode: flags.has("--write")
      ? "write"
      : flags.has("--check")
        ? "check"
        : "print",
    inputs,
    options,
    help: flags.has("--help"),
    version: flags.has("--version"),
  };
}

interface Budget {
  remaining: number;
}

function limitError(): CliError {
  return new CliError(
    `Input exceeds the ${MAX_INPUT_BYTES / 1024 / 1024} MiB limit per run`,
  );
}

function readFileInput(
  path: string,
  forWrite: boolean,
  budget: Budget,
): { bytes: Buffer; mode: number } {
  if (forWrite && lstatSync(path).isSymbolicLink()) {
    throw new CliError("Refusing to write through a symbolic link");
  }
  if (statSync(path).isDirectory()) throw new CliError("Is a directory");
  const fd = openSync(path, "r");
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) throw new CliError("Not a regular file");
    if (stats.size > budget.remaining) throw limitError();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(64 * 1024);
      const read = readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      total += read;
      if (total > budget.remaining) throw limitError();
      chunks.push(chunk.subarray(0, read));
    }
    budget.remaining -= total;
    return { bytes: Buffer.concat(chunks, total), mode: stats.mode };
  } finally {
    closeSync(fd);
  }
}

async function readStdin(budget: Budget): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > budget.remaining) throw limitError();
    chunks.push(chunk);
  }
  budget.remaining -= total;
  return Buffer.concat(chunks, total);
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decodeUtf8(bytes: Buffer): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new CliError("Input is not valid UTF-8");
  }
}

function writeFileSafely(path: string, content: string, mode: number): void {
  if (lstatSync(path).isSymbolicLink())
    throw new CliError("Refusing to write through a symbolic link");
  const temp = join(
    dirname(path),
    `.${basename(path)}.${randomBytes(6).toString("hex")}.json-sort.tmp`,
  );
  const permissions = mode & 0o777;
  let fd: number | undefined;
  let tempExists = false;
  try {
    fd = openSync(temp, "wx", permissions);
    tempExists = true;
    const data = Buffer.from(content, "utf8");
    let offset = 0;
    while (offset < data.length) offset += writeSync(fd, data, offset);
    // Creation mode is filtered by umask; restore the original bits explicitly.
    if (process.platform !== "win32") fchmodSync(fd, permissions);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    tempExists = false;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Already failing; the original error is more useful.
      }
    }
    if (tempExists) {
      try {
        unlinkSync(temp);
      } catch {
        // Best effort cleanup of our own temporary file.
      }
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof CliError || error instanceof JsonSortError)
    return error.message;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case "ENOENT":
      return "No such file";
    case "EACCES":
    case "EPERM":
      return "Permission denied";
    case "EISDIR":
      return "Is a directory";
    case "ELOOP":
      return "Too many symbolic links";
    default:
      return error instanceof Error ? error.message : String(error);
  }
}

function fail(message: string): void {
  process.stderr.write(`json-sort: ${message}\n`);
}

interface Result {
  label: string;
  path: string | undefined;
  original: string;
  output: string;
  mode: number;
}

async function main(argv: readonly string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    fail(describeError(error));
    process.stderr.write(`Run 'json-sort --help' for usage.\n`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.version) {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      version: string;
    };
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  let inputs = args.inputs;
  if (inputs.length === 0) {
    if (process.stdin.isTTY) {
      process.stderr.write(HELP);
      return 2;
    }
    inputs = ["-"];
  }
  const stdinCount = inputs.filter((input) => input === "-").length;
  if (args.mode === "print" && inputs.length > 1) {
    fail("Only one input is allowed without --write or --check");
    return 2;
  }
  if (args.mode === "write" && stdinCount > 0) {
    fail("--write cannot be used with stdin");
    return 2;
  }
  if (args.mode === "check" && stdinCount > 0 && inputs.length > 1) {
    fail("--check accepts either a single stdin input or files, not both");
    return 2;
  }

  try {
    formatJson("null", args.options);
  } catch (error) {
    fail(describeError(error));
    return 2;
  }

  const budget: Budget = { remaining: MAX_INPUT_BYTES };
  const results: Result[] = [];
  let failed = false;
  for (const input of inputs) {
    const label = input === "-" ? STDIN_LABEL : input;
    try {
      let bytes: Buffer;
      let mode = 0o644;
      if (input === "-") {
        bytes = await readStdin(budget);
      } else {
        const file = readFileInput(input, args.mode === "write", budget);
        bytes = file.bytes;
        mode = file.mode;
      }
      const original = decodeUtf8(bytes);
      const output = `${formatJson(original, args.options)}\n`;
      results.push({
        label,
        path: input === "-" ? undefined : input,
        original,
        output,
        mode,
      });
    } catch (error) {
      fail(`${label}: ${describeError(error)}`);
      failed = true;
    }
  }
  if (failed) return 2;

  if (args.mode === "print") {
    process.stdout.write(results[0]!.output);
    return 0;
  }

  const changed = results.filter((result) => result.original !== result.output);
  if (args.mode === "check") {
    for (const result of changed)
      process.stderr.write(`${result.label}: not sorted or formatted\n`);
    return changed.length > 0 ? 1 : 0;
  }

  for (const result of changed) {
    try {
      writeFileSafely(result.path!, result.output, result.mode);
    } catch (error) {
      fail(`${result.label}: ${describeError(error)}`);
      return 2;
    }
  }
  return 0;
}

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EPIPE") throw error;
});

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    fail(describeError(error));
    process.exitCode = 2;
  },
);
