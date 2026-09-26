import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { JsonSortError, formatJson, stringifySorted } from "../../src/index.ts";

function expectInvalidOption(options: unknown): void {
  for (const fn of [
    () => formatJson("{}", options as never),
    () => stringifySorted({}, options as never),
  ]) {
    assert.throws(
      fn,
      (error: unknown) =>
        error instanceof JsonSortError && error.code === "INVALID_OPTION",
    );
  }
}

describe("options validation", () => {
  const invalid: [string, unknown][] = [
    ["null options", null],
    ["array options", []],
    ["string options", "asc"],
    ["unknown key", { sort: "asc" }],
    ["order", { order: "ascending" }],
    ["recursive", { recursive: "yes" }],
    ["caseSensitive", { caseSensitive: 1 }],
    ["numeric", { numeric: null }],
    ["pinnedKeys not array", { pinnedKeys: "id" }],
    ["pinnedKeys with non-string", { pinnedKeys: ["id", 1] }],
    ["pinnedKeys duplicate", { pinnedKeys: ["id", "name", "id"] }],
    ["pinnedKeys sparse", { pinnedKeys: [, "a"] }], // eslint-disable-line no-sparse-arrays
    ["indent 3", { indent: 3 }],
    ["indent string", { indent: "2" }],
    ["indent spaces", { indent: "  " }],
    ["maxDepth 0", { maxDepth: 0 }],
    ["maxDepth 257", { maxDepth: 257 }],
    ["maxDepth fraction", { maxDepth: 1.5 }],
    ["maxDepth string", { maxDepth: "10" }],
    ["maxDepth NaN", { maxDepth: Number.NaN }],
  ];
  for (const [name, options] of invalid) {
    test(`rejects ${name}`, () => expectInvalidOption(options));
  }

  test("options are validated even when input is invalid", () => {
    assert.throws(
      () => formatJson("{", { indent: 3 as never }),
      (error: unknown) =>
        error instanceof JsonSortError && error.code === "INVALID_OPTION",
    );
  });

  test("undefined values mean defaults", () => {
    assert.equal(
      formatJson('{"b":1,"a":2}', {
        order: undefined,
        recursive: undefined,
        caseSensitive: undefined,
        numeric: undefined,
        pinnedKeys: undefined,
        indent: undefined,
        maxDepth: undefined,
      }),
      '{\n  "a": 2,\n  "b": 1\n}',
    );
  });

  test("maxDepth bounds 1 and 256 are valid", () => {
    assert.equal(formatJson("[]", { maxDepth: 1 }), "[]");
    assert.equal(formatJson("[]", { maxDepth: 256 }), "[]");
  });

  test("error carries name and code", () => {
    try {
      formatJson("{}", { bogus: true } as never);
      assert.fail("expected error");
    } catch (error) {
      assert.ok(error instanceof JsonSortError);
      assert.ok(error instanceof Error);
      assert.equal(error.name, "JsonSortError");
      assert.equal(error.code, "INVALID_OPTION");
      assert.match(error.message, /bogus/);
      assert.equal(Object.hasOwn(error, "path"), false);
      assert.equal(Object.hasOwn(error, "offset"), false);
    }
  });
});
