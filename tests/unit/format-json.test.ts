import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createScanner } from "jsonc-parser";
import { JsonSortError, formatJson } from "../../src/index.ts";
import type { JsonSortErrorCode, JsonSortOptions } from "../../src/index.ts";
import { createRandom } from "./random.ts";

const compact = { indent: 0 } as const;

function expectError(
  fn: () => unknown,
  code: JsonSortErrorCode,
): JsonSortError {
  try {
    fn();
  } catch (error) {
    assert.ok(
      error instanceof JsonSortError,
      `expected JsonSortError, got ${String(error)}`,
    );
    assert.equal(error.code, code, error.message);
    return error;
  }
  assert.fail(`expected ${code}`);
}

function numberLiterals(text: string): string[] {
  const scanner = createScanner(text, true);
  const out: string[] = [];
  for (let token = scanner.scan(); token !== 17; token = scanner.scan()) {
    if (token === 11) out.push(scanner.getTokenValue());
  }
  return out.sort();
}

describe("spec examples", () => {
  test("index-like keys are written in sorted string order", () => {
    assert.equal(
      formatJson('{"2":"two","10":"ten","1":"one"}', compact),
      '{"1":"one","10":"ten","2":"two"}',
    );
  });

  test("index-like keys with numeric comparison", () => {
    assert.equal(
      formatJson('{"2":"two","10":"ten","1":"one"}', {
        indent: 0,
        numeric: true,
      }),
      '{"1":"one","2":"two","10":"ten"}',
    );
  });

  test("number literals are preserved", () => {
    assert.equal(
      formatJson('{"z":1e+03,"id":9007199254740993,"a":1.2300}', compact),
      '{"a":1.2300,"id":9007199254740993,"z":1e+03}',
    );
  });

  test("array element order is kept while objects inside are sorted", () => {
    assert.equal(
      formatJson('[{"z":1,"a":2},{"b":3,"a":4}]', compact),
      '[{"a":2,"z":1},{"a":4,"b":3}]',
    );
  });

  test("recursive: false sorts only the root", () => {
    assert.equal(
      formatJson('{"b":{"z":1,"a":2},"a":0}', { recursive: false, indent: 0 }),
      '{"a":0,"b":{"z":1,"a":2}}',
    );
  });

  test("recursive: false with array root keeps object key order", () => {
    assert.equal(
      formatJson('[{"z":1,"a":2}]', { recursive: false, indent: 0 }),
      '[{"z":1,"a":2}]',
    );
  });

  test("primitive root", () => {
    assert.equal(formatJson("  null  ", compact), "null");
    assert.equal(formatJson('"x"'), '"x"');
    assert.equal(formatJson("\n-1.5E-7\r\n"), "-1.5E-7");
    assert.equal(formatJson("true"), "true");
  });
});

describe("formatting", () => {
  const input = '{"b":[1,{"d":null,"c":[]}],"a":{}}';

  test("indent 2 (default)", () => {
    assert.equal(
      formatJson(input),
      '{\n  "a": {},\n  "b": [\n    1,\n    {\n      "c": [],\n      "d": null\n    }\n  ]\n}',
    );
  });

  test("indent 4", () => {
    assert.equal(
      formatJson('{"b":1,"a":[2]}', { indent: 4 }),
      '{\n    "a": [\n        2\n    ],\n    "b": 1\n}',
    );
  });

  test("tab indent", () => {
    assert.equal(
      formatJson('{"b":1,"a":[2]}', { indent: "\t" }),
      '{\n\t"a": [\n\t\t2\n\t],\n\t"b": 1\n}',
    );
  });

  test("compact output has no whitespace between tokens", () => {
    assert.equal(
      formatJson(' { "b" : [ 1 , 2 ] ,\r\n\t"a" : { } } ', compact),
      '{"a":{},"b":[1,2]}',
    );
  });

  test("empty containers", () => {
    assert.equal(formatJson("{ }"), "{}");
    assert.equal(formatJson("[\n]"), "[]");
    assert.equal(
      formatJson('{"a":{ },"b":[ ]}'),
      '{\n  "a": {},\n  "b": []\n}',
    );
  });

  test("no trailing newline", () => {
    assert.ok(!formatJson('{"a":1}').endsWith("\n"));
  });

  test("desc order", () => {
    assert.equal(
      formatJson('{"a":1,"c":{"x":1,"y":2},"b":2}', {
        order: "desc",
        indent: 0,
      }),
      '{"c":{"y":2,"x":1},"b":2,"a":1}',
    );
  });

  test("pinned keys apply to every object", () => {
    assert.equal(
      formatJson('{"z":{"b":1,"id":2},"id":0,"a":[{"c":1,"id":3}]}', {
        pinnedKeys: ["id"],
        indent: 0,
      }),
      '{"id":0,"a":[{"id":3,"c":1}],"z":{"id":2,"b":1}}',
    );
  });
});

describe("literal preservation", () => {
  test("index-like and unusual keys", () => {
    assert.equal(
      formatJson('{"4294967295":0,"-1":1,"01":2,"1":3,"10":4,"2":5}', compact),
      '{"-1":1,"01":2,"1":3,"10":4,"2":5,"4294967295":0}',
    );
  });

  test("numbers keep their exact spelling", () => {
    const text =
      "[9007199254740993,1.2300,1e+03,-0,1e400,-1E-400,0.1e1,123456789012345678901234567890.5]";
    assert.equal(formatJson(text, compact), text);
  });

  test("big numbers survive inside reordered objects (checked via tokens, not JSON.parse)", () => {
    const text =
      '{"z":9007199254740993,"y":{"b":1e400,"a":-0},"x":[12345678901234567890123]}';
    const output = formatJson(text);
    assert.deepEqual(numberLiterals(output), numberLiterals(text));
  });

  test("string escapes are copied verbatim, keys compared decoded", () => {
    const text =
      '{"\\u0062":"\\u00e9\\n","a":"\\/","\\ud83d\\ude00":"😀","é":"\\"q\\""}';
    assert.equal(
      formatJson(text, compact),
      '{"a":"\\/","\\u0062":"\\u00e9\\n","é":"\\"q\\"","\\ud83d\\ude00":"😀"}',
    );
  });

  test("emoji and non-BMP keys sort by UTF-16 code units", () => {
    assert.equal(
      formatJson('{"😀":1,"\\uFF5E":2,"a":3}', compact),
      '{"a":3,"😀":1,"\\uFF5E":2}',
    );
  });

  test("U+2028 and U+2029 inside strings are preserved", () => {
    const text = '{"k":"a\u2028b\u2029c"}';
    assert.equal(formatJson(text, compact), text);
  });

  test("one leading BOM is removed", () => {
    assert.equal(formatJson('\uFEFF{"b":1,"a":2}', compact), '{"a":2,"b":1}');
  });
});

describe("strict parsing", () => {
  const invalid: [string, string][] = [
    ["empty document", ""],
    ["whitespace only", " \n\t "],
    ["trailing comma in object", '{"a":1,}'],
    ["trailing comma in array", "[1,]"],
    ["line comment", '{"a":1} // c'],
    ["block comment", '/* c */ {"a":1}'],
    ["extra content", "{} {}"],
    ["extra token", "1 2"],
    ["unterminated string", '"abc'],
    ["unterminated object", '{"a":1'],
    ["invalid escape", '"\\x"'],
    ["short unicode escape", '"\\u12"'],
    ["raw control character", '"a\u0001b"'],
    ["raw newline in string", '"a\nb"'],
    ["leading zero", "01"],
    ["bare minus", "-"],
    ["trailing dot", "1."],
    ["leading dot", ".5"],
    ["plus sign", "+1"],
    ["empty exponent", "1e"],
    ["hex number", "0x10"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["single quotes", "{'a':1}"],
    ["unquoted key", "{a:1}"],
    ["second BOM", "\uFEFF\uFEFF{}"],
    ["BOM after whitespace", " \uFEFF{}"],
    ["BOM at end", "{}\uFEFF"],
    ["vertical tab", "{\u000b}"],
    ["form feed", "{\u000c}"],
    ["non-breaking space", "{\u00a0}"],
    ["missing colon", '{"a" 1}'],
    ["missing value", '{"a":}'],
  ];
  for (const [name, text] of invalid) {
    test(`rejects ${name}`, () => {
      expectError(() => formatJson(text), "INVALID_JSON");
    });
  }

  test("reports offset, line and column", () => {
    const error = expectError(
      () => formatJson('{\n  "a": 1,\n  "b": ?\n}'),
      "INVALID_JSON",
    );
    assert.equal(error.offset, 19);
    assert.equal(error.line, 3);
    assert.equal(error.column, 8);
  });

  test("location accounts for a leading BOM and CRLF", () => {
    const error = expectError(
      () => formatJson("\uFEFF[\r\n1,\r\n]"),
      "INVALID_JSON",
    );
    assert.equal(error.line, 3);
    assert.equal(error.column, 1);
    assert.equal(error.offset, 8);
  });

  test("error message does not contain document content", () => {
    const error = expectError(
      () => formatJson('{"password":"hunter2-secret",}'),
      "INVALID_JSON",
    );
    assert.ok(!error.message.includes("hunter2"));
  });

  test("non-string input", () => {
    expectError(() => formatJson(42 as unknown as string), "INVALID_JSON");
  });
});

describe("duplicate keys", () => {
  test("literal duplicate", () => {
    const error = expectError(
      () => formatJson('{"a":1,"a":2}'),
      "DUPLICATE_KEY",
    );
    assert.deepEqual(error.path, ["a"]);
    assert.equal(error.offset, 7);
    assert.equal(error.line, 1);
    assert.equal(error.column, 8);
  });

  test("duplicate after decoding escapes", () => {
    expectError(() => formatJson('{"a":1,"\\u0061":2}'), "DUPLICATE_KEY");
  });

  test("nested duplicate reports path", () => {
    const error = expectError(
      () => formatJson('{"x":[{"k":1},{"k":1,"k":2}]}'),
      "DUPLICATE_KEY",
    );
    assert.deepEqual(error.path, ["x", 1, "k"]);
  });

  test("same key in different objects and different case are fine", () => {
    assert.equal(
      formatJson('{"a":{"a":1},"b":{"a":2}}', compact),
      '{"a":{"a":1},"b":{"a":2}}',
    );
    assert.equal(
      formatJson('{"a":1,"A":2}', { caseSensitive: false, indent: 0 }),
      '{"A":2,"a":1}',
    );
  });
});

describe("maxDepth", () => {
  const nested = (depth: number): string =>
    "[".repeat(depth) + "]".repeat(depth);

  test("root primitive has depth 0", () => {
    assert.equal(formatJson("1", { maxDepth: 1 }), "1");
  });

  test("node at maxDepth is allowed, deeper is rejected", () => {
    assert.equal(formatJson('{"a":1}', { maxDepth: 1, indent: 0 }), '{"a":1}');
    assert.equal(
      formatJson('{"a":{}}', { maxDepth: 1, indent: 0 }),
      '{"a":{}}',
    );
    expectError(
      () => formatJson('{"a":{"b":1}}', { maxDepth: 1 }),
      "MAX_DEPTH_EXCEEDED",
    );
    expectError(
      () => formatJson("[[1]]", { maxDepth: 1 }),
      "MAX_DEPTH_EXCEEDED",
    );
  });

  test("default limit is 128", () => {
    assert.equal(formatJson(nested(129), compact), nested(129));
    const error = expectError(
      () => formatJson(nested(130)),
      "MAX_DEPTH_EXCEEDED",
    );
    assert.equal(error.offset, 129);
  });

  test("limit 256 accepted", () => {
    assert.equal(
      formatJson(nested(257), { maxDepth: 256, indent: 0 }),
      nested(257),
    );
    expectError(
      () => formatJson(nested(258), { maxDepth: 256 }),
      "MAX_DEPTH_EXCEEDED",
    );
  });

  test("brackets inside strings do not count", () => {
    assert.equal(
      formatJson('{"a":"[[[[{{{{"}', { maxDepth: 1, indent: 0 }),
      '{"a":"[[[[{{{{"}',
    );
  });

  test("extremely deep input fails fast without stack overflow", () => {
    expectError(() => formatJson(nested(1_000_000)), "MAX_DEPTH_EXCEEDED");
  });
});

describe("properties", () => {
  const random = createRandom(20260926);
  const keyParts = [
    "a",
    "B",
    "b",
    "id",
    "name",
    "1",
    "2",
    "10",
    "01",
    "x9",
    "x10",
    "_",
    "é",
    "😀",
    "\\u0041",
    "\\n",
  ];

  const genKey = (): string => {
    let key = "";
    const n = 1 + random.int(3);
    for (let i = 0; i < n; i++) key += random.pick(keyParts);
    return key;
  };
  const genValue = (depth: number): string => {
    const roll = random.int(depth > 4 ? 5 : 8);
    switch (roll) {
      case 0:
        return "null";
      case 1:
        return random.pick(["true", "false"]);
      case 2:
        return random.pick([
          "0",
          "-0",
          "1.50",
          "-12",
          "3e2",
          "1E-3",
          `${random.int(1_000_000)}`,
        ]);
      case 3:
        return random.pick(['""', '"text"', '"\\u00e9"', '"😀"', '"\\"q\\""']);
      case 4:
        return random.pick(["[]", "{}"]);
      case 5:
      case 6: {
        const keys = new Map<string, string>();
        const n = random.int(6);
        for (let i = 0; i < n; i++) {
          const raw = genKey();
          const decoded = JSON.parse(`"${raw}"`) as string;
          if ([...keys.keys()].some((k) => JSON.parse(`"${k}"`) === decoded))
            continue;
          keys.set(raw, genValue(depth + 1));
        }
        const ws = random.pick(["", " ", "\n  ", "\t"]);
        return `{${ws}${[...keys].map(([k, v]) => `"${k}"${ws}:${ws}${v}`).join(`,${ws}`)}${ws}}`;
      }
      default: {
        const n = random.int(4);
        return `[${Array.from({ length: n }, () => genValue(depth + 1)).join(", ")}]`;
      }
    }
  };
  const optionSets: JsonSortOptions[] = [
    {},
    { indent: 0 },
    { indent: 4, order: "desc" },
    { indent: "\t", numeric: true },
    { caseSensitive: false, numeric: true, pinnedKeys: ["id", "name"] },
    { recursive: false, order: "desc", indent: 0 },
  ];

  test("idempotent and structurally equal for random documents", () => {
    for (let round = 0; round < 400; round++) {
      const text = genValue(0);
      for (const options of optionSets) {
        const once = formatJson(text, options);
        assert.equal(
          formatJson(once, options),
          once,
          `not idempotent: ${text}`,
        );
        assert.deepStrictEqual(JSON.parse(once), JSON.parse(text));
      }
    }
  });

  test("output is independent of input key order", () => {
    const text = '{"b":1,"a":{"y":[{"q":1,"p":2}],"x":2},"c":3}';
    const reordered = '{"c":3,"a":{"x":2,"y":[{"p":2,"q":1}]},"b":1}';
    assert.equal(formatJson(text), formatJson(reordered));
  });
});
