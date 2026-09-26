export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface JsonSortOptions {
  /** Direction for unpinned keys. Default: `'asc'`. */
  order?: "asc" | "desc";
  /** Sort nested objects too. When `false`, only the root object is sorted. Default: `true`. */
  recursive?: boolean;
  /** Compare keys case-sensitively. Default: `true`. */
  caseSensitive?: boolean;
  /** Compare runs of ASCII digits by numeric value (`item2` before `item10`). Default: `false`. */
  numeric?: boolean;
  /** Keys that come first, in this exact order, in every sorted object. Default: `[]`. */
  pinnedKeys?: readonly string[];
  /** Indentation of the output. `0` produces compact JSON. Default: `2`. */
  indent?: 0 | 2 | 4 | "\t";
  /** Maximum nesting depth, 1–256. The root value has depth 0. Default: `128`. */
  maxDepth?: number;
}

export type JsonSortErrorCode =
  | "INVALID_JSON"
  | "DUPLICATE_KEY"
  | "UNSUPPORTED_VALUE"
  | "CIRCULAR_REFERENCE"
  | "INVALID_OPTION"
  | "MAX_DEPTH_EXCEEDED";

export type JsonPathSegment = string | number;
