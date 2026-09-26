import { fromValue } from "./from-value.ts";
import { resolveOptions } from "./options.ts";
import { parseJson } from "./parse.ts";
import { render } from "./render.ts";
import type { JsonSortOptions, JsonValue } from "./types.ts";

export { JsonSortError } from "./errors.ts";
export type {
  JsonPathSegment,
  JsonPrimitive,
  JsonSortErrorCode,
  JsonSortOptions,
  JsonValue,
} from "./types.ts";

/**
 * Serializes JSON-compatible JavaScript data to JSON text with object keys in sorted order.
 * Numbers are written from their JavaScript value; precision already lost cannot be restored.
 * @throws {JsonSortError}
 */
export function stringifySorted(
  value: JsonValue,
  options?: JsonSortOptions,
): string {
  const resolved = resolveOptions(options);
  return render(fromValue(value, resolved.maxDepth), resolved);
}

/**
 * Parses strict JSON text and returns it with object keys sorted and re-indented.
 * String and number literals are copied verbatim from the input.
 * @throws {JsonSortError}
 */
export function formatJson(text: string, options?: JsonSortOptions): string {
  const resolved = resolveOptions(options);
  return render(parseJson(text, resolved.maxDepth), resolved);
}
