import type { JsonPathSegment, JsonSortErrorCode } from "./types.ts";

export interface JsonSortErrorDetails {
  path?: readonly JsonPathSegment[];
  offset?: number;
  line?: number;
  column?: number;
}

/** Error thrown by `formatJson` and `stringifySorted`. Inspect `code` to distinguish causes. */
export class JsonSortError extends Error {
  readonly code: JsonSortErrorCode;
  /** Location of the problem inside the value, e.g. `['users', 0, 'email']`. */
  declare readonly path?: readonly JsonPathSegment[];
  /** Zero-based offset in UTF-16 code units within the input text. */
  declare readonly offset?: number;
  /** One-based line number within the input text. */
  declare readonly line?: number;
  /** One-based column (UTF-16 code units) within the input text. */
  declare readonly column?: number;

  constructor(
    code: JsonSortErrorCode,
    message: string,
    details: JsonSortErrorDetails = {},
  ) {
    super(message);
    this.name = "JsonSortError";
    this.code = code;
    if (details.path !== undefined)
      this.path = Object.freeze([...details.path]);
    if (details.offset !== undefined) this.offset = details.offset;
    if (details.line !== undefined) this.line = details.line;
    if (details.column !== undefined) this.column = details.column;
  }
}

export function formatPath(path: readonly JsonPathSegment[]): string {
  return JSON.stringify(path);
}
