import type { Change, DetectedTell, Span } from './types';

export interface Token {
  text: string;
  start: number;
  end: number;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

const MAX_CELLS = 4_000_000;

export function diffChanges(before: string, after: string, tells: DetectedTell[]): Change[] {
  if (before === after) return [];
  const a = tokenize(before);
  const b = tokenize(after);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix]!.text === b[prefix]!.text) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix]!.text === b[b.length - 1 - suffix]!.text
  ) {
    suffix++;
  }

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  if (aMid.length === 0 && bMid.length === 0) return [];

  // Anchor for zero-width ranges when one side of a region is empty.
  const anchorB = (index: number): number => {
    const token = bMid[index];
    if (token) return token.start;
    const prev = bMid[bMid.length - 1] ?? b[prefix - 1];
    return prev ? prev.end : 0;
  };
  const anchorA = (index: number): number => {
    const token = aMid[index];
    if (token) return token.start;
    const prev = aMid[aMid.length - 1] ?? a[prefix - 1];
    return prev ? prev.end : 0;
  };

  if (aMid.length * bMid.length > MAX_CELLS) {
    const range: Span =
      bMid.length > 0
        ? { start: bMid[0]!.start, end: bMid[bMid.length - 1]!.end }
        : { start: anchorB(0), end: anchorB(0) };
    return [{ range, reason: 'Rewritten' }];
  }

  const regions = groupRegions(lcsOps(aMid, bMid));
  return regions.map(r => {
    const bSpan: Span =
      r.bStart < r.bEnd
        ? { start: bMid[r.bStart]!.start, end: bMid[r.bEnd - 1]!.end }
        : { start: anchorB(r.bStart), end: anchorB(r.bStart) };
    const aSpan: Span =
      r.aStart < r.aEnd
        ? { start: aMid[r.aStart]!.start, end: aMid[r.aEnd - 1]!.end }
        : { start: anchorA(r.aStart), end: anchorA(r.aStart) };
    const tell = tells.find(t => t.span.start < aSpan.end && aSpan.start < t.span.end);
    return tell
      ? { range: bSpan, ruleId: tell.ruleId, reason: tell.reason }
      : { range: bSpan, reason: 'Reworded' };
  });
}

type OpType = 'equal' | 'delete' | 'insert';

function lcsOps(a: Token[], b: Token[]): OpType[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const len = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i * width + j] =
        a[i]!.text === b[j]!.text
          ? len[(i + 1) * width + j + 1]! + 1
          : Math.max(len[(i + 1) * width + j]!, len[i * width + j + 1]!);
    }
  }
  const ops: OpType[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i]!.text === b[j]!.text) {
      ops.push('equal');
      i++;
      j++;
    } else if (len[(i + 1) * width + j]! >= len[i * width + j + 1]!) {
      ops.push('delete');
      i++;
    } else {
      ops.push('insert');
      j++;
    }
  }
  while (i < n) {
    ops.push('delete');
    i++;
  }
  while (j < m) {
    ops.push('insert');
    j++;
  }
  return ops;
}

interface Region {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

function groupRegions(ops: OpType[]): Region[] {
  const regions: Region[] = [];
  let i = 0;
  let j = 0;
  let current: Region | null = null;
  for (const op of ops) {
    if (op === 'equal') {
      current = null;
      i++;
      j++;
      continue;
    }
    if (!current) {
      current = { aStart: i, aEnd: i, bStart: j, bEnd: j };
      regions.push(current);
    }
    if (op === 'delete') current.aEnd = ++i;
    else current.bEnd = ++j;
  }
  return regions;
}
