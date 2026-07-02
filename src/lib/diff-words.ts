// Word-level diff (LCS) for before/after rewrite rendering.
// Small inputs only (resume bullets, ~10-40 words) — O(n*m) is fine.

export interface DiffSegment {
  type: "same" | "removed" | "added";
  text: string;
}

export function diffWords(before: string, after: string): DiffSegment[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const n = a.length;
  const m = b.length;

  // LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i].toLowerCase() === b[j].toLowerCase()
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk the table, merging consecutive words of the same type
  const segments: DiffSegment[] = [];
  const push = (type: DiffSegment["type"], word: string) => {
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.text += " " + word;
    else segments.push({ type, text: word });
  };

  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i].toLowerCase() === b[j].toLowerCase()) {
      push("same", b[j]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("removed", a[i]);
      i++;
    } else {
      push("added", b[j]);
      j++;
    }
  }
  while (i < n) { push("removed", a[i]); i++; }
  while (j < m) { push("added", b[j]); j++; }

  return segments;
}
