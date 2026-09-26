# json-sort

[![npm](https://img.shields.io/npm/v/@helpers-work/json-sort)](https://www.npmjs.com/package/@helpers-work/json-sort)
[![CI](https://github.com/helpers-work/json-sort/actions/workflows/ci.yml/badge.svg)](https://github.com/helpers-work/json-sort/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Sort the keys of JSON objects in a deterministic order and format the result. Use it as a library in Node.js or the browser, or as a CLI to normalize JSON files and check them in CI.

**Try it online:** [JSON Sort on Helpers.work](https://helpers.work/tool/json-sort) is built on this package and runs entirely in your browser.

Typical uses: keep configuration files and test fixtures in one canonical key order, and reduce noise in diffs.

- Sorts object keys; never reorders array elements.
- `formatJson` copies string and number literals from the input verbatim — `9007199254740993`, `1.2300` and `1e400` stay exactly as written.
- Strict JSON only: comments, trailing commas and duplicate keys are errors.
- Locale-independent ordering by UTF-16 code units, with optional case-insensitive and numeric ("natural") comparison and pinned keys.
- One runtime dependency: [`jsonc-parser`](https://github.com/microsoft/node-jsonc-parser), used as the tokenizer/parser.

## Installation

```bash
npm install @helpers-work/json-sort
```

The CLI can run without installing the package:

```bash
npx @helpers-work/json-sort data.json
```

## Quick example

```ts
import { formatJson, stringifySorted } from "@helpers-work/json-sort";

formatJson('{"b":1,"a":{"d":2,"c":3}}');
// {
//   "a": {
//     "c": 3,
//     "d": 2
//   },
//   "b": 1
// }

stringifySorted(
  { name: "Alice", id: 42, email: "alice@example.com" },
  { pinnedKeys: ["id"], indent: 0 },
);
// '{"id":42,"email":"alice@example.com","name":"Alice"}'
```

CommonJS works too:

```js
const { formatJson, stringifySorted } = require("@helpers-work/json-sort");
```

## API

Both functions are synchronous, return a JSON **string** without a trailing newline, and never modify their arguments. They throw `JsonSortError` on failure.

### `formatJson(text, options?)`

Parses strict JSON text (RFC 8259) and returns it with sorted keys and the requested indentation.

- String literals (keys and values) are copied as written, including escapes such as `"\u00e9"`. Keys are compared by their decoded value, so `"\u0061"` and `"a"` are the same key.
- Number literals are copied as written. No value passes through a JavaScript `Number`, so large integers, trailing zeros, exponents and `-0` are preserved.
- A single leading byte order mark (U+FEFF) is removed. A BOM anywhere else is an error.
- Allowed changes: property order, insignificant whitespace, line breaks, and removal of one leading BOM.

```ts
formatJson('{"z":1e+03,"id":9007199254740993,"a":1.2300}', { indent: 0 });
// '{"a":1.2300,"id":9007199254740993,"z":1e+03}'
```

### `stringifySorted(value, options?)`

Serializes existing JavaScript data. Accepted values: strings, finite numbers, booleans, `null`, plain objects (including `Object.create(null)`), and dense arrays.

- Only own, enumerable, string-keyed data properties are used. Non-enumerable and symbol-keyed properties are ignored.
- Rejected with `UNSUPPORTED_VALUE`: `undefined`, functions, symbols, bigint, `NaN`, `±Infinity`, `Date`, `Map`, `Set`, class instances, boxed primitives, array subclasses, sparse arrays, arrays with extra non-index properties, and accessor properties (getters are never invoked).
- `toJSON` is never called.
- Cycles are rejected with `CIRCULAR_REFERENCE`. The same object in two independent branches is fine.
- Numbers are written from their JavaScript value (`-0` stays `-0`). Precision lost when the value was created, for example by `JSON.parse`, cannot be restored. Use `formatJson` when you have the original text.
- Keys like `__proto__`, `constructor` and `prototype` are treated as ordinary keys.

### Options

| Option          | Type                  | Default | Description                                                                                           |
| --------------- | --------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `order`         | `'asc' \| 'desc'`     | `'asc'` | Direction for unpinned keys.                                                                          |
| `recursive`     | `boolean`             | `true`  | Sort nested objects, including objects inside arrays. `false` sorts only the root object.             |
| `caseSensitive` | `boolean`             | `true`  | `false` compares `toLowerCase()` forms; ties are broken by the original strings.                      |
| `numeric`       | `boolean`             | `false` | Compare runs of ASCII digits by numeric value: `item2` before `item10`.                               |
| `pinnedKeys`    | `readonly string[]`   | `[]`    | Keys placed first, in this order, in every sorted object. Exact, case-sensitive match. No duplicates. |
| `indent`        | `0 \| 2 \| 4 \| '\t'` | `2`     | `0` produces compact output with no whitespace.                                                       |
| `maxDepth`      | integer 1–256         | `128`   | Maximum nesting depth. The root is depth 0; each property value or array element adds 1.              |

Unknown option names, wrong types and invalid values throw `INVALID_OPTION`. An option set to `undefined` uses its default.

### Sort order

- **Default:** lexicographic by UTF-16 code units, the same as comparing strings with `<` in JavaScript. It does not depend on the current locale. Example: `"1", "10", "2", "A", "a", "b"`.
- **`caseSensitive: false`:** a simple case-insensitive comparison using `String.prototype.toLowerCase()`. It is not linguistic collation for any particular language, and there is no Unicode normalization. `"A"` and `"a"` remain two different keys. When two keys compare equal case-insensitively, the original strings decide, so the result never depends on input order.
- **`numeric: true`:** maximal runs of ASCII digits compare by value, with no length limit and no conversion to `Number`. Everything else compares by code unit. Signs, dots and exponents have no numeric meaning. `item02` and `item2` have the same value; the original strings break the tie, so `item02` comes first in ascending order.
- **`order: 'desc'`** reverses the order of unpinned keys only.
- **`pinnedKeys`** come first in list order. Pinned keys that do not exist are ignored.

### Errors

```ts
import { JsonSortError, formatJson } from "@helpers-work/json-sort";

try {
  formatJson('{"a":1,"a":2}');
} catch (error) {
  if (error instanceof JsonSortError) {
    error.code; // 'DUPLICATE_KEY'
    error.path; // ['a']
    error.offset; // 7  (0-based, UTF-16 code units)
    error.line; // 1  (1-based)
    error.column; // 8  (1-based)
  }
}
```

| `code`               | Meaning                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `INVALID_JSON`       | Syntax error, comment, trailing comma, empty document, extra content, bad escape. |
| `DUPLICATE_KEY`      | The same decoded key appears twice in one object.                                 |
| `UNSUPPORTED_VALUE`  | `stringifySorted` got a value that is not plain JSON data.                        |
| `CIRCULAR_REFERENCE` | `stringifySorted` found a cycle.                                                  |
| `INVALID_OPTION`     | Unknown or invalid option.                                                        |
| `MAX_DEPTH_EXCEEDED` | Nesting deeper than `maxDepth`.                                                   |

`path` is set for value errors. `offset`, `line` and `column` are set for errors in text input. Messages are in English and never include the document or values, though key names and paths may appear. Depth is checked with an iterative pre-scan before any recursive parsing, so very deep input fails with `MAX_DEPTH_EXCEEDED` rather than a stack overflow.

## CLI

```text
json-sort [file ...] [options]

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
```

Install it as a dev dependency to use `json-sort` in npm scripts, or run it once with `npx @helpers-work/json-sort`.

```bash
json-sort data.json                      # print sorted JSON to stdout
cat data.json | json-sort                # read stdin (also: json-sort -)
json-sort data.json --indent 0           # compact output
json-sort data.json --pin id --pin name  # pinned keys
json-sort a.json b.json --check          # CI check
json-sort a.json b.json --write          # rewrite in place
```

- The CLI uses `formatJson` and appends exactly one `\n` to its output.
- Without `--write` or `--check`, it accepts one file or stdin. Multiple files in this mode are an error.
- With no arguments, it reads stdin if stdin is a pipe. In an interactive terminal it prints usage and exits with 2.
- `--check` compares each file byte-for-byte with the exact CLI output. It fails on unsorted keys and also on different indentation, CRLF line endings, a BOM, or a missing or extra final newline. File names that need changes are printed to stderr.
- `--write` and `--check` cannot be combined. `--write` does not accept stdin. `--check` accepts one stdin input or files, not both.
- Paths are taken literally. Directories and glob patterns are not expanded; let your shell expand globs.
- Input must be valid UTF-8. Invalid byte sequences are an error, never silently replaced.
- The total input per run is limited to 10 MiB.
- In `--check` and `--write` modes stdout stays empty. Diagnostics go to stderr.

### Exit codes

| Code | Meaning                                                                    |
| ---- | -------------------------------------------------------------------------- |
| 0    | Success; with `--check`, all inputs are already formatted.                 |
| 1    | `--check` found inputs that would change.                                  |
| 2    | Invalid JSON, invalid options or arguments, I/O error, or another failure. |

If any input fails, the exit code is 2 even when other inputs would return 1.

### How `--write` changes files

- All inputs are read, parsed and formatted before anything is written. If any input is invalid, no file is modified.
- Each file is written to a temporary file in the same directory, flushed and closed, then renamed over the original. The original is never truncated first.
- Permission bits are preserved on POSIX systems. File ownership and extended attributes are not carried over.
- Files whose content would not change are left untouched.
- Symbolic links are refused in `--write` mode.
- Writing several files is **not transactional**. If an I/O error occurs while writing the third file, the first two have already been replaced.

## Supported environments

- Node.js 22 and 24, ESM (`import`) and CommonJS (`require`), with TypeScript declarations for both.
- Browsers through a bundler. The library entry point does not use Node.js APIs, `process`, the DOM, the network or the file system. The CLI is a separate file and is not reachable from the library entry point.

## Limitations

- **Arrays are not sorted.** Only object keys are reordered.
- **The output is text, not an object.** JavaScript orders integer-like property names such as `"1"` and `"10"` before other keys, whatever order they were inserted in. A JavaScript object therefore cannot hold an arbitrary key order, so both functions return JSON text.
- **Not canonical JSON.** The package does not implement RFC 8785 (JCS). Semantically equal documents with different literals (`1`, `1.0`, `1e0`, or `"é"` and `"\u00e9"`) stay different. Do not use the output as input for cryptographic signatures.
- **Literal preservation is not arbitrary-precision arithmetic.** `formatJson` keeps number text unchanged; it never computes with numbers.
- **No JSON5, JSONC, or YAML**, no comments and no trailing commas.
- **Proxies and cross-realm objects** (for example from another `iframe` or `vm` context) are not supported by `stringifySorted`. Plain objects and arrays from another realm are rejected as non-plain.
- **Whole-document processing.** Documents are processed in memory; the CLI limits the input size to 10 MiB per run.

## Development

Requires Node.js 22.18+ or 24; tests run TypeScript sources through Node's built-in type stripping.

```bash
npm ci
npm run typecheck
npm run lint
npm test              # builds, then runs unit and CLI tests
npm run build
npm run test:package  # packs, installs the tarball into temporary consumer projects, runs a browser smoke test
npm pack --dry-run
```

`npm run test:package` runs a headless Chrome smoke test when Chrome is available. Set `CHROME_BIN` to use a specific binary, or `REQUIRE_BROWSER=1` to fail when no browser is found.

To try an unreleased build in another project, install a local tarball:

```bash
npm run build
npm pack                      # creates helpers-work-json-sort-<version>.tgz
cd /path/to/your/project
npm install /path/to/helpers-work-json-sort-<version>.tgz
```

## Support

- Bugs and feature requests: [GitHub issues](https://github.com/helpers-work/json-sort/issues)
- Email: [support@helpers.work](mailto:support@helpers.work)
- Security issues: please report privately to [support@helpers.work](mailto:support@helpers.work) instead of opening a public issue.

## About

Created for [Helpers.work](https://helpers.work/),
a collection of practical developer tools.
The [online JSON Sort tool](https://helpers.work/tool/json-sort) uses this package.

## License

MIT © Julian Halden
