export interface CompareOptions {
  readonly order: "asc" | "desc";
  readonly caseSensitive: boolean;
  readonly numeric: boolean;
  readonly pinnedKeys: readonly string[];
}

/** Lexicographic comparison by UTF-16 code units, independent of locale. */
export function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const DIGIT_0 = 0x30;
const DIGIT_9 = 0x39;

function isDigit(code: number): boolean {
  return code >= DIGIT_0 && code <= DIGIT_9;
}

/**
 * Natural comparison: maximal runs of ASCII digits compare by numeric value, everything else by
 * UTF-16 code unit. A digit run sorts where its first digit would sort, so the order is a total
 * preorder (runs with equal value but different leading zeros compare equal here).
 */
export function compareNatural(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(j);
    const da = isDigit(ca);
    const db = isDigit(cb);
    if (da && db) {
      let ie = i;
      while (ie < a.length && isDigit(a.charCodeAt(ie))) ie++;
      let je = j;
      while (je < b.length && isDigit(b.charCodeAt(je))) je++;
      let si = i;
      while (si < ie && a.charCodeAt(si) === DIGIT_0) si++;
      let sj = j;
      while (sj < je && b.charCodeAt(sj) === DIGIT_0) sj++;
      const lenA = ie - si;
      const lenB = je - sj;
      if (lenA !== lenB) return lenA < lenB ? -1 : 1;
      for (let k = 0; k < lenA; k++) {
        const x = a.charCodeAt(si + k);
        const y = b.charCodeAt(sj + k);
        if (x !== y) return x < y ? -1 : 1;
      }
      i = ie;
      j = je;
      continue;
    }
    if (ca !== cb) return ca < cb ? -1 : 1;
    i++;
    j++;
  }
  const restA = i < a.length;
  const restB = j < b.length;
  return restA === restB ? 0 : restA ? 1 : -1;
}

function comparePrepared(
  a: string,
  normA: string,
  b: string,
  normB: string,
  numeric: boolean,
): number {
  const primary = numeric
    ? compareNatural(normA, normB)
    : compareUtf16(normA, normB);
  return primary !== 0 ? primary : compareUtf16(a, b);
}

/** Comparator for unpinned keys. Never returns 0 for distinct strings. */
export function createKeyComparator(
  options: Pick<CompareOptions, "order" | "caseSensitive" | "numeric">,
): (a: string, b: string) => number {
  const { caseSensitive, numeric } = options;
  const desc = options.order === "desc";
  return (a, b) => {
    const result = caseSensitive
      ? comparePrepared(a, a, b, b, numeric)
      : comparePrepared(a, a.toLowerCase(), b, b.toLowerCase(), numeric);
    return desc ? 0 - result : result;
  };
}

/** Returns a new array: pinned keys first in list order, then the rest by the comparator. */
export function orderEntries<T extends { readonly key: string }>(
  entries: readonly T[],
  options: CompareOptions,
): T[] {
  const { caseSensitive, numeric, pinnedKeys } = options;
  const desc = options.order === "desc";
  const pinnedRank = new Map<string, number>();
  pinnedKeys.forEach((key, index) => pinnedRank.set(key, index));

  const pinned: { entry: T; rank: number }[] = [];
  const rest: { entry: T; norm: string }[] = [];
  for (const entry of entries) {
    const rank = pinnedRank.get(entry.key);
    if (rank !== undefined) pinned.push({ entry, rank });
    else
      rest.push({
        entry,
        norm: caseSensitive ? entry.key : entry.key.toLowerCase(),
      });
  }
  pinned.sort((x, y) => x.rank - y.rank);
  rest.sort((x, y) => {
    const result = comparePrepared(
      x.entry.key,
      x.norm,
      y.entry.key,
      y.norm,
      numeric,
    );
    return desc ? 0 - result : result;
  });
  return [...pinned.map((p) => p.entry), ...rest.map((r) => r.entry)];
}
