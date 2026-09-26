export interface LiteralNode {
  readonly kind: "literal";
  /** A valid JSON literal: string, number, true, false or null. */
  readonly text: string;
}

export interface ArrayNode {
  readonly kind: "array";
  readonly items: readonly JsonNode[];
}

export interface Entry {
  /** Decoded property name used for comparison and duplicate detection. */
  readonly key: string;
  /** Property name as a JSON string literal, written verbatim to the output. */
  readonly keyText: string;
  readonly value: JsonNode;
}

export interface ObjectNode {
  readonly kind: "object";
  readonly entries: readonly Entry[];
}

export type JsonNode = LiteralNode | ArrayNode | ObjectNode;
