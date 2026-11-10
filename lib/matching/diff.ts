export interface DiffToken {
  text: string;
  type: "added" | "removed" | "unchanged";
}

/**
 * Splits text into tokens preserving words, whitespace, and punctuation.
 */
function tokenize(text: string): string[] {
  if (!text) return [];
  // Tokenize by words and spaces
  return text.match(/\S+|\s+/g) || [];
}

/**
 * Computes a token/word-level diff between original (canonical) and modified (candidate) captions.
 * Uses the classic Longest Common Subsequence (LCS) dynamic programming algorithm.
 */
export function computeWordDiff(
  original: string,
  modified: string
): {
  originalTokens: DiffToken[];
  modifiedTokens: DiffToken[];
} {
  const origTokens = tokenize(original);
  const modTokens = tokenize(modified);

  const m = origTokens.length;
  const n = modTokens.length;

  // Build LCS matrix
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origTokens[i - 1].toLowerCase() === modTokens[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build the diff
  let i = m;
  let j = n;

  const revOrig: DiffToken[] = [];
  const revMod: DiffToken[] = [];

  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      origTokens[i - 1].toLowerCase() === modTokens[j - 1].toLowerCase()
    ) {
      revOrig.push({ text: origTokens[i - 1], type: "unchanged" });
      revMod.push({ text: modTokens[j - 1], type: "unchanged" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      revMod.push({ text: modTokens[j - 1], type: "added" });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      revOrig.push({ text: origTokens[i - 1], type: "removed" });
      i--;
    }
  }

  return {
    originalTokens: revOrig.reverse(),
    modifiedTokens: revMod.reverse(),
  };
}
