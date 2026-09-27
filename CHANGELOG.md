# Changelog

## 0.1.1 — 2026-09-26

- First release published from GitHub Actions with npm provenance. No functional changes since 0.1.0.
- Package smoke test supports the npm 12 `npm pack --json` output format.

## 0.1.0 — 2026-09-26

- `formatJson(text, options)`: strict JSON parsing, key sorting, re-indentation; string and number literals are copied verbatim.
- `stringifySorted(value, options)`: sorted serialization of JSON-compatible JavaScript data with runtime validation.
- Options: `order`, `recursive`, `caseSensitive`, `numeric`, `pinnedKeys`, `indent`, `maxDepth`.
- `JsonSortError` with `code`, `path`, `offset`, `line`, `column`.
- `json-sort` CLI with stdout, `--check` and `--write` modes.
