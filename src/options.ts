import { JsonSortError } from "./errors.ts";

export interface ResolvedOptions {
  readonly order: "asc" | "desc";
  readonly recursive: boolean;
  readonly caseSensitive: boolean;
  readonly numeric: boolean;
  readonly pinnedKeys: readonly string[];
  readonly indent: 0 | 2 | 4 | "\t";
  readonly maxDepth: number;
}

const KNOWN_OPTIONS = new Set([
  "order",
  "recursive",
  "caseSensitive",
  "numeric",
  "pinnedKeys",
  "indent",
  "maxDepth",
]);

export const MAX_DEPTH_LIMIT = 256;

function invalid(message: string): JsonSortError {
  return new JsonSortError("INVALID_OPTION", message);
}

function readBoolean(
  source: Record<string, unknown>,
  name: string,
  fallback: boolean,
): boolean {
  const value = Object.hasOwn(source, name) ? source[name] : undefined;
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw invalid(`Option "${name}" must be a boolean`);
  return value;
}

export function resolveOptions(options: unknown): ResolvedOptions {
  if (options === undefined) {
    return {
      order: "asc",
      recursive: true,
      caseSensitive: true,
      numeric: false,
      pinnedKeys: [],
      indent: 2,
      maxDepth: 128,
    };
  }
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw invalid("Options must be a plain object");
  }
  const source = options as Record<string, unknown>;
  for (const name of Object.keys(source)) {
    if (!KNOWN_OPTIONS.has(name)) throw invalid(`Unknown option "${name}"`);
  }
  const get = (name: string): unknown =>
    Object.hasOwn(source, name) ? source[name] : undefined;

  const order = get("order") ?? "asc";
  if (order !== "asc" && order !== "desc")
    throw invalid('Option "order" must be "asc" or "desc"');

  const indent = get("indent") ?? 2;
  if (indent !== 0 && indent !== 2 && indent !== 4 && indent !== "\t") {
    throw invalid('Option "indent" must be 0, 2, 4 or "\\t"');
  }

  const maxDepth = get("maxDepth") ?? 128;
  if (
    typeof maxDepth !== "number" ||
    !Number.isInteger(maxDepth) ||
    maxDepth < 1 ||
    maxDepth > MAX_DEPTH_LIMIT
  ) {
    throw invalid(
      `Option "maxDepth" must be an integer from 1 to ${MAX_DEPTH_LIMIT}`,
    );
  }

  const rawPinned = get("pinnedKeys") ?? [];
  if (!Array.isArray(rawPinned))
    throw invalid('Option "pinnedKeys" must be an array of strings');
  const pinnedKeys: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawPinned.length; i++) {
    const key: unknown = rawPinned[i];
    if (typeof key !== "string")
      throw invalid('Option "pinnedKeys" must be an array of strings');
    if (seen.has(key))
      throw invalid(
        `Option "pinnedKeys" contains duplicate key ${JSON.stringify(key)}`,
      );
    seen.add(key);
    pinnedKeys.push(key);
  }

  return {
    order,
    recursive: readBoolean(source, "recursive", true),
    caseSensitive: readBoolean(source, "caseSensitive", true),
    numeric: readBoolean(source, "numeric", false),
    pinnedKeys: Object.freeze(pinnedKeys),
    indent,
    maxDepth,
  };
}
