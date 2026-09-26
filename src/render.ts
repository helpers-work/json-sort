import { orderEntries } from "./compare.ts";
import type { ResolvedOptions } from "./options.ts";
import type { JsonNode } from "./tree.ts";

export function render(root: JsonNode, options: ResolvedOptions): string {
  const out: string[] = [];
  const pretty = options.indent !== 0;
  const unit = options.indent === "\t" ? "\t" : " ".repeat(options.indent);
  const separator = pretty ? ": " : ":";
  const indents = [""];
  const indentAt = (level: number): string => {
    while (indents.length <= level)
      indents.push(indents[indents.length - 1] + unit);
    return indents[level]!;
  };

  const write = (node: JsonNode, level: number): void => {
    if (node.kind === "literal") {
      out.push(node.text);
      return;
    }
    if (node.kind === "array") {
      if (node.items.length === 0) {
        out.push("[]");
        return;
      }
      out.push("[");
      node.items.forEach((item, index) => {
        if (index > 0) out.push(",");
        if (pretty) out.push("\n", indentAt(level + 1));
        write(item, level + 1);
      });
      if (pretty) out.push("\n", indentAt(level));
      out.push("]");
      return;
    }
    if (node.entries.length === 0) {
      out.push("{}");
      return;
    }
    const entries =
      options.recursive || level === 0
        ? orderEntries(node.entries, options)
        : node.entries;
    out.push("{");
    entries.forEach((entry, index) => {
      if (index > 0) out.push(",");
      if (pretty) out.push("\n", indentAt(level + 1));
      out.push(entry.keyText, separator);
      write(entry.value, level + 1);
    });
    if (pretty) out.push("\n", indentAt(level));
    out.push("}");
  };

  write(root, 0);
  return out.join("");
}
