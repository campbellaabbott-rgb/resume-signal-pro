// Client-side auto-fix for common AI content corruption patterns

export interface AutoFixResult {
  fixed: string;
  corrections: string[];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const autoFixContent = (content: string, originalResume?: string): AutoFixResult => {
  let fixed = content;
  const corrections: string[] = [];

  // Remove random commas at the start of lines
  if (/^\s*,\s*/m.test(fixed)) {
    fixed = fixed.replace(/^\s*,\s*/gm, "");
    corrections.push("Removed stray leading commas");
  }

  // Fix double commas
  if (/,,+/.test(fixed)) {
    fixed = fixed.replace(/,,+/g, ",");
    corrections.push("Fixed double commas");
  }

  // Fix malformed dollar amounts like $20,,000 → $20,000
  if (/\$\d+,,\d/.test(fixed)) {
    fixed = fixed.replace(/(\$\d+),,(\d)/g, "$1,$2");
    corrections.push("Fixed malformed dollar amounts");
  }

  // Fix common missing spaces recruiters notice (for8, top3, in2, quota2x)
  {
    const before = fixed;
    fixed = fixed
      .replace(/\bfor(\d)\b/gi, "for $1")
      .replace(/\btop(\d+)\b/gi, "top $1")
      .replace(/\bin(\d)\b/gi, "in $1")
      .replace(/\bquota(\d+x)\b/gi, "quota $1")
      .replace(/\bquota(\d)\b/gi, "quota $1");
    if (fixed !== before) corrections.push("Fixed missing spaces in common patterns");
  }

  // Fix merged section headers like "ServicesProfessional Experience"
  if (/ServicesProfessional Experience/.test(fixed)) {
    fixed = fixed.replace(/ServicesProfessional Experience/g, "Services\n\nProfessional Experience");
    corrections.push("Separated merged section headers");
  }
  // Generic: ensure a clean break before "Professional Experience" if it runs into a word
  if (/\wProfessional Experience/.test(fixed)) {
    const before = fixed;
    fixed = fixed.replace(/([A-Za-z])Professional Experience/g, "$1\n\nProfessional Experience");
    if (fixed !== before) corrections.push("Inserted newline before Professional Experience header");
  }

  // Fix missing space before numbers (e.g., "across67" → "across 67")
  {
    const before = fixed;
    fixed = fixed.replace(/([a-zA-Z])(\d{2,})/g, (match, letter, num) => {
      // Don't fix things like "gpt5" or version numbers, or common patterns
      if (/^[a-z]$/.test(letter) && /^\d{1,2}$/.test(num)) return match;
      if (["x", "v", "k", "m", "b"].includes(String(letter).toLowerCase())) return match; // 1x, v2, etc.
      return `${letter} ${num}`;
    });
    if (fixed !== before) corrections.push("Added missing spaces before numbers");
  }

  // Fix truncated CI/CD
  if (/\/CD\b/i.test(fixed) && !/CI\/CD/i.test(fixed)) {
    fixed = fixed.replace(/\b\/CD\b/gi, "CI/CD");
    corrections.push("Fixed truncated CI/CD");
  }
  fixed = fixed.replace(/including\s*\/CD/gi, "including CI/CD");

  // Fix truncated GitHub (Git without Hub following)
  {
    const before = fixed;
    fixed = fixed.replace(
      /\bGit\b(?!\s*(Hub|Lab|Actions|Flow|Kraken|ignore|config|Bash|commit|branch|merge|push|pull|clone|remote|log|diff|status|add|checkout|reset))/gi,
      "GitHub"
    );
    if (fixed !== before) corrections.push("Fixed truncated Git → GitHub");
  }

  // Fix truncated LinkedIn
  {
    const before = fixed;
    fixed = fixed.replace(/\bLinked\b(?!\s*(In|Sales|List))/gi, "LinkedIn");
    if (fixed !== before) corrections.push("Fixed truncated Linked → LinkedIn");
  }

  // Fix Fortune without 500
  if (originalResume?.includes("Fortune 500") && /Fortune\b(?!\s*\d)/i.test(fixed)) {
    fixed = fixed.replace(/Fortune\b(?!\s*\d)/gi, "Fortune 500");
    corrections.push("Added missing Fortune 500");
  }

  // Fix broken percentage %+
  if (/%\+/.test(fixed)) {
    fixed = fixed.replace(/%\+/g, "%");
    corrections.push("Fixed broken percentage");
  }

  // Fix empty/malformed parentheses
  fixed = fixed.replace(/\(\s*,\s*\)/g, "");
  fixed = fixed.replace(/\(\s*\)/g, "");

  // Fix "building -1" or similar nonsense
  if (/building\s*-\s*\d+/i.test(fixed)) {
    fixed = fixed.replace(/building\s*-\s*\d+/gi, "building");
    corrections.push('Fixed nonsensical "building -1" pattern');
  }

  // Fix broken hyphenated phrases like "0-to- go-to-market"
  if (/\d+-to-\s+/.test(fixed)) {
    fixed = fixed.replace(/(\d+)-to-\s+/g, "$1-to-");
    corrections.push("Fixed broken hyphenated phrases");
  }

  // Fix Codes) → Codespaces
  if (originalResume?.includes("Codespaces") && /\bCodes\)/.test(fixed)) {
    fixed = fixed.replace(/\bCodes\)/g, "Codespaces");
    corrections.push("Fixed truncated Codespaces");
  }

  // Fix GitHub Cop → GitHub Copilot
  if (originalResume?.includes("Copilot") && /GitHub\s+Cop\b/.test(fixed)) {
    fixed = fixed.replace(/GitHub\s+Cop\b/g, "GitHub Copilot");
    corrections.push("Fixed truncated Copilot");
  }

  // Fix Git Actions → GitHub Actions
  if (/\bGit\s+Actions\b/.test(fixed)) {
    fixed = fixed.replace(/\bGit\s+Actions\b/g, "GitHub Actions");
    corrections.push("Fixed Git Actions → GitHub Actions");
  }

  // Fix Full-C → Full-Cycle
  if (originalResume?.includes("Full-Cycle") && /Full-C\b/.test(fixed)) {
    fixed = fixed.replace(/Full-C\b/g, "Full-Cycle");
    corrections.push("Fixed truncated Full-Cycle");
  }

  // Restore common numeric corruptions from the original resume (when available)
  if (originalResume) {
    // 1) Decimal multipliers getting their dot dropped (3.5x → 35x, 1.5x → 15x)
    const originalDecimalMultipliers = Array.from(
      new Set((originalResume.match(/\b~?\d+\.\d+x\b/gi) || []).map(m => m.replace(/^~/, "")))
    );

    for (const m of originalDecimalMultipliers) {
      const key = m.replace(".", ""); // 3.5x -> 35x
      const re = new RegExp(`\\b${escapeRegExp(key)}\\b`, "g");
      if (re.test(fixed)) {
        fixed = fixed.replace(re, m);
        corrections.push(`Restored multiplier ${key} → ${m}`);
      }
    }

    // 2) Years getting truncated (e.g., 202. / 202 → 2024 when original has 2024)
    const originalYears = Array.from(new Set(originalResume.match(/\b20\d{2}\b/g) || []));
    const yearsByPrefix = new Map<string, string[]>();
    for (const y of originalYears) {
      const prefix = y.slice(0, 3); // "202" for 2024
      yearsByPrefix.set(prefix, [...(yearsByPrefix.get(prefix) || []), y]);
    }
    fixed = fixed.replace(/\b(20\d)\.?\b/g, (match, prefix: string) => {
      const candidates = yearsByPrefix.get(prefix) || [];
      if (candidates.length === 1) {
        corrections.push(`Restored year ${match} → ${candidates[0]}`);
        return candidates[0];
      }
      return match;
    });

    // 3) Dollar amounts: restore commas / missing digits / missing $ when we can match by digits
    const originalAmounts = Array.from(new Set(originalResume.match(/\$\d[\d,]*(?:\.\d+)?[MBK]?\+?/g) || []));
    const amountByDigits = new Map<string, string>();
    const amountsBySuffix = new Map<string, string[]>();

    for (const amt of originalAmounts) {
      const digits = amt.replace(/[^\d]/g, "");
      if (digits) amountByDigits.set(digits, amt);

      const suffix = amt.replace(/[\d,$.]/g, ""); // e.g., "M+" or ""
      if (suffix) amountsBySuffix.set(suffix, [...(amountsBySuffix.get(suffix) || []), amt]);
    }

    // Fix weirdly formatted $ amounts by digit match (e.g., $20,000000 → $20,000,000)
    fixed = fixed.replace(/\$\d[\d,]*(?:\.\d+)?[MBK]?\+?/g, (match) => {
      const digits = match.replace(/[^\d]/g, "");
      const restored = digits ? amountByDigits.get(digits) : undefined;
      if (restored && restored !== match) {
        corrections.push(`Restored currency formatting ${match} → ${restored}`);
        return restored;
      }
      return match;
    });

    // Fix "$M+" style truncations when suffix uniquely identifies the original
    fixed = fixed.replace(/\$([MBK]\+?)/g, (match, suffix) => {
      const candidates = amountsBySuffix.get(String(suffix)) || [];
      if (candidates.length === 1) {
        corrections.push(`Restored truncated currency ${match} → ${candidates[0]}`);
        return candidates[0];
      }
      return match;
    });

    // Add missing $ when the number part exactly appears (e.g., 150,000 → $150,000)
    for (const amt of originalAmounts) {
      const numberPart = amt.slice(1); // remove $
      if (!numberPart.includes(",")) continue;
      const re = new RegExp(`(^|[^\\$])\\b${escapeRegExp(numberPart)}\\b`, "g");
      if (re.test(fixed)) {
        fixed = fixed.replace(re, `$1$${numberPart}`);
        corrections.push(`Restored missing $ for ${numberPart}`);
      }
    }
  }

  if (corrections.length > 0) {
    console.log(`[AUTO-FIX] Applied ${corrections.length} corrections:`, corrections);
  }

  return { fixed, corrections };
};
