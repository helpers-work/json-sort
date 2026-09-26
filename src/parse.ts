import { createScanner, parseTree, printParseErrorCode } from "jsonc-parser";
import type { Node as AstNode, ParseError } from "jsonc-parser";
import { JsonSortError, formatPath } from "./errors.ts";
import type { JsonPathSegment } from "./types.ts";
import type { Entry, JsonNode } from "./tree.ts";

// jsonc-parser exposes SyntaxKind as an ambient const enum, which isolated builds cannot inline.
const TOKEN_OPEN_BRACE = 1;
const TOKEN_CLOSE_BRACE = 2;
const TOKEN_OPEN_BRACKET = 3;
const TOKEN_CLOSE_BRACKET = 4;
const TOKEN_NULL = 7;
const TOKEN_NUMBER = 11;
const TOKEN_EOF = 17;

const BOM = 0xfeff;

interface Location {
  offset: number;
  line: number;
  column: number;
}

function locate(text: string, offset: number): Location {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a || (code === 0x0d && text.charCodeAt(i + 1) !== 0x0a)) {
      line++;
      lineStart = i + 1;
    }
  }
  return { offset, line, column: offset - lineStart + 1 };
}

/** Iterative pre-pass so that deep nesting fails before any recursive parsing starts. */
function checkDepth(
  text: string,
  base: number,
  source: string,
  maxDepth: number,
): void {
  const scanner = createScanner(text, true);
  let open = 0;
  for (
    let token = scanner.scan();
    token !== TOKEN_EOF;
    token = scanner.scan()
  ) {
    if (
      token === TOKEN_OPEN_BRACE ||
      token === TOKEN_OPEN_BRACKET ||
      (token >= TOKEN_NULL && token <= TOKEN_NUMBER)
    ) {
      if (open > maxDepth) {
        const where = locate(source, base + scanner.getTokenOffset());
        throw new JsonSortError(
          "MAX_DEPTH_EXCEEDED",
          `Maximum depth of ${maxDepth} exceeded at line ${where.line}, column ${where.column}`,
          where,
        );
      }
      if (token === TOKEN_OPEN_BRACE || token === TOKEN_OPEN_BRACKET) open++;
    } else if (
      (token === TOKEN_CLOSE_BRACE || token === TOKEN_CLOSE_BRACKET) &&
      open > 0
    ) {
      open--;
    }
  }
}

export function parseJson(source: string, maxDepth: number): JsonNode {
  if (typeof source !== "string") {
    throw new JsonSortError("INVALID_JSON", "Input must be a string");
  }
  const base = source.charCodeAt(0) === BOM ? 1 : 0;
  const text = base === 1 ? source.slice(1) : source;

  checkDepth(text, base, source, maxDepth);

  const errors: ParseError[] = [];
  const ast = parseTree(text, errors, {
    disallowComments: true,
    allowTrailingComma: false,
    allowEmptyContent: false,
  });
  const first = errors[0];
  if (first !== undefined || ast === undefined) {
    const offset = base + (first?.offset ?? text.length);
    const where = locate(source, offset);
    const reason = first ? printParseErrorCode(first.error) : "ValueExpected";
    throw new JsonSortError(
      "INVALID_JSON",
      `Invalid JSON (${reason}) at line ${where.line}, column ${where.column}`,
      where,
    );
  }

  const slice = (node: AstNode): string =>
    text.slice(node.offset, node.offset + node.length);
  const path: JsonPathSegment[] = [];

  const convert = (node: AstNode): JsonNode => {
    switch (node.type) {
      case "object": {
        const entries: Entry[] = [];
        const seen = new Set<string>();
        for (const property of node.children ?? []) {
          const [keyNode, valueNode] = property.children ?? [];
          if (keyNode === undefined || valueNode === undefined) {
            throw new JsonSortError(
              "INVALID_JSON",
              "Invalid JSON: incomplete property",
            );
          }
          const key = keyNode.value as string;
          if (seen.has(key)) {
            const where = locate(source, base + keyNode.offset);
            const keyPath = [...path, key];
            throw new JsonSortError(
              "DUPLICATE_KEY",
              `Duplicate key ${JSON.stringify(key)} at path ${formatPath(keyPath)} (line ${where.line}, column ${where.column})`,
              { path: keyPath, ...where },
            );
          }
          seen.add(key);
          path.push(key);
          entries.push({
            key,
            keyText: slice(keyNode),
            value: convert(valueNode),
          });
          path.pop();
        }
        return { kind: "object", entries };
      }
      case "array": {
        const items = (node.children ?? []).map((child, index) => {
          path.push(index);
          const item = convert(child);
          path.pop();
          return item;
        });
        return { kind: "array", items };
      }
      case "string":
      case "number":
      case "boolean":
      case "null":
        return { kind: "literal", text: slice(node) };
      default:
        throw new JsonSortError(
          "INVALID_JSON",
          `Invalid JSON: unexpected node "${node.type}"`,
        );
    }
  };

  return convert(ast);
}
