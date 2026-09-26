import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  compareNatural,
  compareUtf16,
  createKeyComparator,
  orderEntries,
} from "../../src/compare.ts";
import type { CompareOptions } from "../../src/compare.ts";
import { createRandom } from "./random.ts";

const sortWith = (
  keys: readonly string[],
  options: Partial<CompareOptions> = {},
): string[] => {
  const resolved: CompareOptions = {
    order: "asc",
    caseSensitive: true,
    numeric: false,
    pinnedKeys: [],
    ...options,
  };
  return orderEntries(
    keys.map((key) => ({ key })),
    resolved,
  ).map((entry) => entry.key);
};

describe("default comparison", () => {
  test("uses UTF-16 code unit order", () => {
    assert.deepEqual(sortWith(["b", "a", "A", "2", "10", "1"]), [
      "1",
      "10",
      "2",
      "A",
      "a",
      "b",
    ]);
  });

  test("orders by code units, not code points or locale", () => {
    // U+FF5E (single unit 0xFF5E) sorts after U+1F600 (surrogates 0xD83D 0xDE00) by code unit.
    assert.deepEqual(sortWith(["\uFF5E", "😀", "é", "z", "Z"]), [
      "Z",
      "z",
      "é",
      "😀",
      "\uFF5E",
    ]);
    assert.equal(compareUtf16("😀", "\uFF5E"), -1);
  });

  test("desc reverses the order", () => {
    assert.deepEqual(
      sortWith(["b", "a", "A", "2", "10", "1"], { order: "desc" }),
      ["b", "a", "A", "2", "10", "1"],
    );
  });

  test("empty string sorts first", () => {
    assert.deepEqual(sortWith(["a", "", " "]), ["", " ", "a"]);
  });
});

describe("case-insensitive comparison", () => {
  test("groups letters regardless of case and keeps both keys", () => {
    assert.deepEqual(
      sortWith(["b", "B", "a", "A", "c"], { caseSensitive: false }),
      ["A", "a", "B", "b", "c"],
    );
  });

  test("resolves ties by original UTF-16 order independent of insertion order", () => {
    const expected = ["ID", "Id", "iD", "id"];
    for (const input of [
      ["id", "iD", "Id", "ID"],
      ["Id", "id", "ID", "iD"],
    ]) {
      assert.deepEqual(sortWith(input, { caseSensitive: false }), expected);
    }
  });

  test("underscore position differs from case-sensitive order", () => {
    // "_" (0x5F) sits between upper-case (0x41-0x5A) and lower-case (0x61-0x7A) letters.
    assert.deepEqual(sortWith(["_x", "A", "b"]), ["A", "_x", "b"]);
    assert.deepEqual(sortWith(["_x", "A", "b"], { caseSensitive: false }), [
      "_x",
      "A",
      "b",
    ]);
  });
});

describe("numeric comparison", () => {
  test("compares digit runs by value", () => {
    assert.deepEqual(
      sortWith(["item10", "item2", "item1"], { numeric: true }),
      ["item1", "item2", "item10"],
    );
  });

  test("leading zeros tie on value, then fall back to UTF-16", () => {
    assert.deepEqual(
      sortWith(["item2", "item02", "item1", "item003"], { numeric: true }),
      ["item1", "item02", "item2", "item003"],
    );
    assert.equal(compareNatural("item02", "item2"), 0);
  });

  test("continues comparing after equal digit runs", () => {
    assert.deepEqual(sortWith(["a01b", "a1a", "a1c"], { numeric: true }), [
      "a1a",
      "a01b",
      "a1c",
    ]);
  });

  test("handles digit runs far beyond Number precision", () => {
    const big = "9".repeat(400);
    const bigger = `1${"0".repeat(400)}`;
    assert.deepEqual(
      sortWith([bigger, big, `0000${big}`, "9"], { numeric: true }),
      ["9", `0000${big}`, big, bigger],
    );
  });

  test("treats signs, dots and exponents as ordinary characters", () => {
    assert.deepEqual(
      sortWith(["v1.10", "v1.9", "v1.9.1", "-1", "1e3", "1e20"], {
        numeric: true,
      }),
      ["-1", "1e3", "1e20", "v1.9", "v1.9.1", "v1.10"],
    );
  });

  test("digit vs non-digit uses code unit order", () => {
    // " " (0x20) < digits < "a"
    assert.deepEqual(sortWith(["xa", "x5", "x ", "x"], { numeric: true }), [
      "x",
      "x ",
      "x5",
      "xa",
    ]);
  });

  test("index-like keys", () => {
    assert.deepEqual(
      sortWith(["10", "2", "1", "01", "4294967295", "-1"], { numeric: true }),
      ["-1", "01", "1", "2", "10", "4294967295"],
    );
  });

  test("combined with case-insensitive and desc", () => {
    assert.deepEqual(
      sortWith(["Item10", "item2", "ITEM1", "item1"], {
        numeric: true,
        caseSensitive: false,
        order: "desc",
      }),
      ["Item10", "item2", "item1", "ITEM1"],
    );
  });
});

describe("pinned keys", () => {
  test("come first in list order; missing ones are ignored", () => {
    assert.deepEqual(
      sortWith(["z", "name", "b", "id"], {
        pinnedKeys: ["id", "missing", "name"],
      }),
      ["id", "name", "b", "z"],
    );
  });

  test("desc does not reverse pinned keys", () => {
    assert.deepEqual(
      sortWith(["a", "type", "z", "id"], {
        pinnedKeys: ["id", "type"],
        order: "desc",
      }),
      ["id", "type", "z", "a"],
    );
  });

  test("match exactly even when case-insensitive", () => {
    assert.deepEqual(
      sortWith(["ID", "b", "id"], { pinnedKeys: ["id"], caseSensitive: false }),
      ["id", "b", "ID"],
    );
  });
});

describe("comparator properties", () => {
  const random = createRandom(0x5eed);
  const alphabet = [
    "a",
    "A",
    "b",
    "B",
    "0",
    "1",
    "2",
    "9",
    "00",
    "10",
    "_",
    "-",
    ".",
    " ",
    "é",
    "É",
    "😀",
    "z",
  ];
  const keys = new Set<string>([
    "",
    "item1",
    "item01",
    "item10",
    "Item2",
    "a1b",
    "a01b",
    "a1",
    "a",
  ]);
  while (keys.size < 70) {
    const length = 1 + random.int(5);
    let key = "";
    for (let i = 0; i < length; i++) key += random.pick(alphabet);
    keys.add(key);
  }
  const pool = [...keys];

  for (const numeric of [false, true]) {
    for (const caseSensitive of [true, false]) {
      for (const order of ["asc", "desc"] as const) {
        test(`antisymmetric, total and transitive (numeric=${numeric}, caseSensitive=${caseSensitive}, ${order})`, () => {
          const compare = createKeyComparator({
            order,
            caseSensitive,
            numeric,
          });
          for (const a of pool) {
            assert.equal(compare(a, a), 0);
            for (const b of pool) {
              const ab = Math.sign(compare(a, b));
              assert.equal(
                ab + Math.sign(compare(b, a)),
                0,
                `antisymmetry ${JSON.stringify([a, b])}`,
              );
              if (a !== b)
                assert.notEqual(
                  ab,
                  0,
                  `distinct keys tie ${JSON.stringify([a, b])}`,
                );
            }
          }
          for (const a of pool) {
            for (const b of pool) {
              if (compare(a, b) > 0) continue;
              for (const c of pool) {
                if (compare(b, c) <= 0) {
                  assert.ok(
                    compare(a, c) <= 0,
                    `transitivity ${JSON.stringify([a, b, c])}`,
                  );
                }
              }
            }
          }
        });

        test(`result does not depend on input order (numeric=${numeric}, caseSensitive=${caseSensitive}, ${order})`, () => {
          const options = {
            order,
            caseSensitive,
            numeric,
            pinnedKeys: ["a", "_"],
          };
          const expected = sortWith(pool, options);
          for (let round = 0; round < 20; round++) {
            assert.deepEqual(sortWith(random.shuffle(pool), options), expected);
          }
        });
      }
    }
  }
});
