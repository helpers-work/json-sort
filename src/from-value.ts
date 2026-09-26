import { JsonSortError, formatPath } from "./errors.ts";
import type { JsonPathSegment } from "./types.ts";
import type { Entry, JsonNode } from "./tree.ts";

const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

function describeObject(value: object): string {
  if (value instanceof Date) return "Date";
  if (value instanceof Map) return "Map";
  if (value instanceof Set) return "Set";
  if (Array.isArray(value)) return "array subclass";
  return "non-plain object";
}

export function fromValue(root: unknown, maxDepth: number): JsonNode {
  const path: JsonPathSegment[] = [];
  const ancestors = new Set<object>();

  const unsupported = (what: string): JsonSortError =>
    new JsonSortError(
      "UNSUPPORTED_VALUE",
      `Unsupported value (${what}) at path ${formatPath(path)}`,
      {
        path,
      },
    );

  const visitArray = (array: readonly unknown[], depth: number): JsonNode => {
    const length = array.length;
    for (const key of Object.keys(array)) {
      if (!ARRAY_INDEX.test(key) || Number(key) >= length) {
        throw new JsonSortError(
          "UNSUPPORTED_VALUE",
          `Unsupported array property ${JSON.stringify(key)} at path ${formatPath(path)}`,
          { path },
        );
      }
    }
    const items: JsonNode[] = [];
    for (let index = 0; index < length; index++) {
      path.push(index);
      const descriptor = Object.getOwnPropertyDescriptor(array, index);
      if (descriptor === undefined) throw unsupported("sparse array hole");
      if (!("value" in descriptor)) throw unsupported("accessor property");
      items.push(visit(descriptor.value, depth + 1));
      path.pop();
    }
    return { kind: "array", items };
  };

  const visitObject = (object: object, depth: number): JsonNode => {
    const entries: Entry[] = [];
    for (const key of Object.keys(object)) {
      path.push(key);
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor === undefined) throw unsupported("vanished property");
      if (!("value" in descriptor)) throw unsupported("accessor property");
      entries.push({
        key,
        keyText: JSON.stringify(key),
        value: visit(descriptor.value, depth + 1),
      });
      path.pop();
    }
    return { kind: "object", entries };
  };

  const visit = (value: unknown, depth: number): JsonNode => {
    if (depth > maxDepth) {
      throw new JsonSortError(
        "MAX_DEPTH_EXCEEDED",
        `Maximum depth of ${maxDepth} exceeded at path ${formatPath(path)}`,
        { path },
      );
    }
    switch (typeof value) {
      case "string":
        return { kind: "literal", text: JSON.stringify(value) };
      case "number":
        if (!Number.isFinite(value)) throw unsupported(String(value));
        return {
          kind: "literal",
          text: Object.is(value, -0) ? "-0" : String(value),
        };
      case "boolean":
        return { kind: "literal", text: value ? "true" : "false" };
      case "object": {
        if (value === null) return { kind: "literal", text: "null" };
        if (ancestors.has(value)) {
          throw new JsonSortError(
            "CIRCULAR_REFERENCE",
            `Circular reference at path ${formatPath(path)}`,
            { path },
          );
        }
        const proto: unknown = Object.getPrototypeOf(value);
        const isArray = Array.isArray(value);
        if (
          isArray
            ? proto !== Array.prototype
            : proto !== Object.prototype && proto !== null
        ) {
          throw unsupported(describeObject(value));
        }
        ancestors.add(value);
        const node = isArray
          ? visitArray(value as readonly unknown[], depth)
          : visitObject(value, depth);
        ancestors.delete(value);
        return node;
      }
      default:
        throw unsupported(typeof value);
    }
  };

  return visit(root, 0);
}
