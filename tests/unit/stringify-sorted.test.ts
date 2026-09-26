import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { JsonSortError, stringifySorted } from "../../src/index.ts";
import type { JsonSortErrorCode, JsonValue } from "../../src/index.ts";

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

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value))
      deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
};

const asJson = (value: unknown): JsonValue => value as JsonValue;

describe("stringifySorted", () => {
  test("spec example with pinned keys and recursion", () => {
    const result = stringifySorted(
      {
        email: "alice@example.com",
        settings: { theme: "dark", language: "en" },
        name: "Alice",
        id: 42,
      },
      { pinnedKeys: ["id", "name"], indent: 2 },
    );
    assert.equal(
      result,
      [
        "{",
        '  "id": 42,',
        '  "name": "Alice",',
        '  "email": "alice@example.com",',
        '  "settings": {',
        '    "language": "en",',
        '    "theme": "dark"',
        "  }",
        "}",
      ].join("\n"),
    );
  });

  test("index-like keys are ordered as strings despite JS property order", () => {
    const value = { b: 1, 10: "ten", 2: "two", 1: "one", a: 0 };
    assert.equal(
      stringifySorted(value, compact),
      '{"1":"one","10":"ten","2":"two","a":0,"b":1}',
    );
    assert.equal(
      stringifySorted(value, { indent: 0, numeric: true }),
      '{"1":"one","2":"two","10":"ten","a":0,"b":1}',
    );
  });

  test("primitives and empty containers", () => {
    assert.equal(stringifySorted(null), "null");
    assert.equal(stringifySorted(true), "true");
    assert.equal(stringifySorted('a"b\n'), '"a\\"b\\n"');
    assert.equal(stringifySorted(1.5), "1.5");
    assert.equal(stringifySorted(1e21), "1e+21");
    assert.equal(stringifySorted({}), "{}");
    assert.equal(stringifySorted([]), "[]");
  });

  test("-0 is written as -0", () => {
    assert.equal(stringifySorted([-0, 0], compact), "[-0,0]");
  });

  test("keys and strings are escaped safely", () => {
    assert.equal(
      stringifySorted({ 'a"\n': "\u2028", "\ud800": "x" }, compact),
      '{"a\\"\\n":"\u2028","\\ud800":"x"}',
    );
  });

  test("arrays keep order, objects inside are sorted; recursive: false keeps nested order", () => {
    const value = { b: [{ z: 1, a: 2 }, 3], a: { d: 1, c: 2 } };
    assert.equal(
      stringifySorted(value, compact),
      '{"a":{"c":2,"d":1},"b":[{"a":2,"z":1},3]}',
    );
    assert.equal(
      stringifySorted(value, { recursive: false, indent: 0 }),
      '{"a":{"d":1,"c":2},"b":[{"z":1,"a":2},3]}',
    );
  });

  test("null-prototype objects are accepted", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.b = 1;
    value.a = 2;
    assert.equal(stringifySorted(asJson(value), compact), '{"a":2,"b":1}');
  });

  test("shared references in independent branches are not cycles", () => {
    const shared = { b: 2, a: 1 };
    assert.equal(
      stringifySorted({ x: shared, y: shared }, compact),
      '{"x":{"a":1,"b":2},"y":{"a":1,"b":2}}',
    );
    assert.equal(
      stringifySorted([shared, [shared]], compact),
      '[{"a":1,"b":2},[{"a":1,"b":2}]]',
    );
  });

  test("non-enumerable and symbol-keyed properties are ignored", () => {
    const value: Record<string | symbol, unknown> = { a: 1 };
    Object.defineProperty(value, "hidden", { value: 2, enumerable: false });
    value[Symbol("s")] = 3;
    assert.equal(stringifySorted(asJson(value), compact), '{"a":1}');
  });
});

describe("unsupported values", () => {
  const cases: [string, unknown, (string | number)[]][] = [
    ["undefined", { a: undefined }, ["a"]],
    ["root undefined", undefined, []],
    ["function", { a: () => 1 }, ["a"]],
    ["symbol", [Symbol("x")], [0]],
    ["bigint", { n: 1n }, ["n"]],
    ["NaN", { n: Number.NaN }, ["n"]],
    ["Infinity", [Infinity], [0]],
    ["-Infinity", [-Infinity], [0]],
    ["Date", { d: new Date(0) }, ["d"]],
    ["Map", { m: new Map() }, ["m"]],
    ["Set", { s: new Set() }, ["s"]],
    [
      "class instance",
      {
        c: new (class Point {
          x = 1;
        })(),
      },
      ["c"],
    ],
    ["boxed string", { s: new String("x") }, ["s"]],
    ["RegExp", { r: /x/ }, ["r"]],
    ["array subclass", { a: new (class Items extends Array {})() }, ["a"]],
    ["nested", { users: [{ email: undefined }] }, ["users", 0, "email"]],
  ];
  for (const [name, value, path] of cases) {
    test(`rejects ${name}`, () => {
      const error = expectError(
        () => stringifySorted(asJson(value)),
        "UNSUPPORTED_VALUE",
      );
      assert.deepEqual(error.path, path);
    });
  }

  test("sparse arrays", () => {
    // eslint-disable-next-line no-sparse-arrays
    const error = expectError(
      () => stringifySorted(asJson([1, , 3])),
      "UNSUPPORTED_VALUE",
    );
    assert.deepEqual(error.path, [1]);
    expectError(
      () => stringifySorted(asJson(new Array(2))),
      "UNSUPPORTED_VALUE",
    );
  });

  test("extra array properties", () => {
    const array = Object.assign([1, 2], { extra: true });
    expectError(() => stringifySorted(asJson(array)), "UNSUPPORTED_VALUE");
  });

  test("getters and setters are rejected without being called", () => {
    let called = false;
    const withGetter = Object.defineProperty({}, "a", {
      enumerable: true,
      get() {
        called = true;
        return 1;
      },
    });
    const withSetter = Object.defineProperty({}, "b", {
      enumerable: true,
      set() {
        called = true;
      },
    });
    const arrayGetter = Object.defineProperty([0], 0, {
      enumerable: true,
      get() {
        called = true;
        return 1;
      },
    });
    for (const value of [withGetter, withSetter, arrayGetter]) {
      expectError(() => stringifySorted(asJson(value)), "UNSUPPORTED_VALUE");
    }
    assert.equal(called, false);
  });

  test("toJSON is never called", () => {
    let called = false;
    const value = {
      toJSON() {
        called = true;
        return "replaced";
      },
    };
    expectError(() => stringifySorted(asJson(value)), "UNSUPPORTED_VALUE");
    assert.equal(called, false);
  });

  test("circular references are detected on the current path", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const error = expectError(
      () => stringifySorted(asJson(a)),
      "CIRCULAR_REFERENCE",
    );
    assert.deepEqual(error.path, ["self"]);

    const list: unknown[] = [];
    list.push({ inner: [list] });
    const error2 = expectError(
      () => stringifySorted(asJson(list)),
      "CIRCULAR_REFERENCE",
    );
    assert.deepEqual(error2.path, [0, "inner", 0]);
  });

  test("maxDepth boundaries", () => {
    assert.equal(
      stringifySorted({ a: { b: 1 } }, { maxDepth: 2, indent: 0 }),
      '{"a":{"b":1}}',
    );
    const error = expectError(
      () => stringifySorted({ a: { b: 1 } }, { maxDepth: 1 }),
      "MAX_DEPTH_EXCEEDED",
    );
    assert.deepEqual(error.path, ["a", "b"]);
    let deep: JsonValue = 0;
    for (let i = 0; i < 300; i++) deep = [deep];
    expectError(() => stringifySorted(deep), "MAX_DEPTH_EXCEEDED");
    expectError(
      () => stringifySorted(deep, { maxDepth: 256 }),
      "MAX_DEPTH_EXCEEDED",
    );
  });
});

describe("safety", () => {
  test("frozen input is accepted and unchanged", () => {
    const value = deepFreeze({ b: [{ d: 1, c: 2 }], a: { y: 1, x: 2 } });
    const before = JSON.stringify(value);
    stringifySorted(value);
    assert.equal(JSON.stringify(value), before);
    assert.deepEqual(Object.keys(value), ["b", "a"]);
  });

  test("options and pinnedKeys are not mutated", () => {
    const pinnedKeys = Object.freeze(["z", "a"]);
    const options = Object.freeze({ pinnedKeys, order: "desc" as const });
    stringifySorted({ a: 1, z: 2, m: 3 }, options);
    assert.deepEqual(pinnedKeys, ["z", "a"]);
    assert.deepEqual(options, { pinnedKeys: ["z", "a"], order: "desc" });
  });

  test("__proto__, constructor and prototype are ordinary keys", () => {
    const value = JSON.parse(
      '{"prototype":1,"__proto__":{"polluted":true},"constructor":2}',
    ) as JsonValue;
    assert.equal(
      stringifySorted(value, compact),
      '{"__proto__":{"polluted":true},"constructor":2,"prototype":1}',
    );
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.equal(
      Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
      false,
    );
  });

  test("array order is preserved", () => {
    assert.equal(
      stringifySorted([3, 1, 2, "b", "a"], compact),
      '[3,1,2,"b","a"]',
    );
  });
});
