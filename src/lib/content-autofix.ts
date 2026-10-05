// Client-side auto-fix for common AI content corruption patterns, applied to
// the streamed Premium Package résumé and cover letter (ProductSuccess).
//
// WHAT WAS REMOVED, AND WHY (register L5-03). Five rules rewrote correct text
// in the paid deliverable:
//   - a space between a letter and 2+ digits: "jsmith1987@gmail.com" became
//     "jsmith 1987@gmail.com" and "github.com/jsmith2020" a broken URL;
//   - every "Git" became "GitHub" (a skill the candidate never claimed);
//   - every "linked" became "LinkedIn" ("closely LinkedIn to retention");
//   - a lower-case letter followed by a capitalised word got a full stop
//     between them, so "GitHub" printed "Git. Hub", "LinkedIn" "Linked. In",
//     "JavaScript" "Java. Script";
//   - "apply the ...", "year over ..." and "finished top 3 of ..." were
//     rewritten wherever they appeared, changing what sentences say.
// And emails and URLs are now set aside before any rule runs and put back
// unchanged afterwards: no rule below may touch an address a buyer pastes
// into a real application.

export interface AutoFixResult {
  fixed: string;
  corrections: string[];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// An email, or a URL / bare domain path (linkedin.com/in/..., github.com/...).
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:https?:\/\/)?(?:www\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|net|org|io|dev|co|me|ai|app|edu|gov|uk|de|fr|ca|au|in|us)\b(?:\/[^\s|,)]*)?/g;
const MASK_OPEN = "";
const MASK_CLOSE = "";

export const autoFixContent = (content: string, originalResume?: string): AutoFixResult => {
  const corrections: string[] = [];
  const addresses: string[] = [];
  let fixed = content.replace(ADDRESS, (m) => {
    addresses.push(m);
    return `${MASK_OPEN}${addresses.length - 1}${MASK_CLOSE}`;
  });

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

  // Fix truncated CI/CD
  if (/\/CD\b/i.test(fixed) && !/CI\/CD/i.test(fixed)) {
    fixed = fixed.replace(/\b\/CD\b/gi, "CI/CD");
    corrections.push("Fixed truncated CI/CD");
  }
  fixed = fixed.replace(/including\s*\/CD/gi, "including CI/CD");

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

  // Fix Git Actions → GitHub Actions (only when the candidate wrote GitHub Actions)
  if (originalResume?.includes("GitHub Actions") && /\bGit\s+Actions\b/.test(fixed)) {
    fixed = fixed.replace(/\bGit\s+Actions\b/g, "GitHub Actions");
    corrections.push("Fixed Git Actions → GitHub Actions");
  }

  // Fix Full-C → Full-Cycle
  if (originalResume?.includes("Full-Cycle") && /Full-C\b/.test(fixed)) {
    fixed = fixed.replace(/Full-C\b/g, "Full-Cycle");
    corrections.push("Fixed truncated Full-Cycle");
  }

  // === GRAMMAR & STYLE FIXES ===

  // Fix "enterprise level" → "enterprise-level" (compound adjective)
  {
    const before = fixed;
    fixed = fixed.replace(/\benterprise level\b/gi, "enterprise-level");
    if (fixed !== before) corrections.push("Fixed enterprise level → enterprise-level");
  }

  // Fix "Contingents" → "Contingent's" (possessive)
  {
    const before = fixed;
    fixed = fixed.replace(/\bContingents\b(?!\s+set)/g, "Contingent's");
    fixed = fixed.replace(/\bContingents set\b/gi, "Contingent's set");
    if (fixed !== before) corrections.push("Fixed Contingents → Contingent's");
  }

  // Fix "of Leaderboard" → "on the leaderboard"
  {
    const before = fixed;
    fixed = fixed.replace(/\bof Leaderboard\b/gi, "on the leaderboard");
    fixed = fixed.replace(/\bof the Leaderboard\b/gi, "on the leaderboard");
    if (fixed !== before) corrections.push("Fixed of Leaderboard → on the leaderboard");
  }

  // Fix "with the C-level going from" → "with C-level executives to take organizations from"
  {
    const before = fixed;
    fixed = fixed.replace(
      /\bwith the C-level going from\b/gi,
      "with C-level executives to take organizations from"
    );
    fixed = fixed.replace(
      /\bwith the C going from\b/gi,
      "with C-level executives to take organizations from"
    );
    if (fixed !== before) corrections.push("Fixed C-level phrasing");
  }

  // Fix tilde character issues (˜ → ~)
  {
    const before = fixed;
    fixed = fixed.replace(/˜/g, "~");
    if (fixed !== before) corrections.push("Fixed tilde character ˜ → ~");
  }

  // Fix missing "and" between amounts and achievements (e.g., "$130,000 achieved" → "$130,000 and achieved")
  {
    const before = fixed;
    fixed = fixed.replace(/(\$[\d,]+)\s+(achieved\s)/gi, "$1 and $2");
    if (fixed !== before) corrections.push("Added missing 'and' between amounts");
  }

  // === COVER LETTER GRAMMAR FIXES ===

  // Fix "I deals" → "I closed deals" or "I secured deals"
  {
    const before = fixed;
    fixed = fixed.replace(/\bI deals\b/gi, "I closed deals");
    if (fixed !== before) corrections.push("Fixed 'I deals' → 'I closed deals'");
  }

  // Fix "apply the Target Position" → "apply for the Target Position" (only
  // that placeholder: "apply the same rigour" must stay as written)
  {
    const before = fixed;
    fixed = fixed.replace(/\bapply the Target Position\b/g, "apply for the Target Position");
    if (fixed !== before) corrections.push("Fixed 'apply the' → 'apply for the'");
  }

  // Fix missing "At" before company names at sentence start (e.g., "GitHub, I managed" → "At GitHub, I managed")
  {
    const before = fixed;
    fixed = fixed.replace(/^(GitHub|Stack|Microsoft|Google|Amazon|Meta|Apple|Netflix),\s+I\b/gm, "At $1, I");
    fixed = fixed.replace(/\.\s+(GitHub|Stack|Microsoft|Google|Amazon|Meta|Apple|Netflix),\s+I\b/g, ". At $1, I");
    if (fixed !== before) corrections.push("Added missing 'At' before company name");
  }

  // Fix "year over" at the end of a sentence (incomplete "year over year");
  // "a year over the target" is left alone.
  {
    const before = fixed;
    fixed = fixed.replace(/\byear over(?=\s*(?:[.,;]|$))/gim, "year over year");
    if (fixed !== before) corrections.push("Fixed incomplete 'year over' → 'year over year'");
  }

  // Fix "I was in by" → "I was brought in by"
  {
    const before = fixed;
    fixed = fixed.replace(/\bI was in by\b/gi, "I was brought in by");
    if (fixed !== before) corrections.push("Fixed 'I was in by' → 'I was brought in by'");
  }

  // Fix "Foringent" → "For Ingent" or just remove if nonsense
  {
    const before = fixed;
    fixed = fixed.replace(/\bForingent\b/gi, "For Ingent");
    if (fixed !== before) corrections.push("Fixed 'Foringent' → 'For Ingent'");
  }

  // Fix "Navigator I sourced" → "Navigator, I sourced" (missing comma)
  {
    const before = fixed;
    fixed = fixed.replace(/\bNavigator I sourced\b/gi, "Navigator, I sourced");
    if (fixed !== before) corrections.push("Added missing comma before 'I sourced'");
  }

  // Fix "secured largest deal" → "secured the largest deal"
  {
    const before = fixed;
    fixed = fixed.replace(/\bsecured largest\b/gi, "secured the largest");
    if (fixed !== before) corrections.push("Fixed 'secured largest' → 'secured the largest'");
  }

  // Fix "discuss I can help" → "discuss how I can help"
  {
    const before = fixed;
    fixed = fixed.replace(/\bdiscuss I can\b/gi, "discuss how I can");
    if (fixed !== before) corrections.push("Fixed 'discuss I can' → 'discuss how I can'");
  }

  // Fix "I look to connecting" → "I look forward to connecting"
  {
    const before = fixed;
    fixed = fixed.replace(/\bI look to connecting\b/gi, "I look forward to connecting");
    if (fixed !== before) corrections.push("Fixed 'I look to connecting' → 'I look forward to connecting'");
  }

  // Fix "Earlier, at Stack," incomplete sentences - add context
  {
    const before = fixed;
    fixed = fixed.replace(/\bEarlier, at ([^,]+),\s*$/gm, "Earlier in my career, at $1,");
    if (fixed !== before) corrections.push("Fixed incomplete 'Earlier, at' sentence");
  }

  // Fix broken "in2" "in3" patterns (missing space before quarter)
  {
    const before = fixed;
    fixed = fixed.replace(/\bin(\d)\s+and\s+Q/gi, "in Q$1 and Q");
    if (fixed !== before) corrections.push("Fixed 'inX and Q' → 'in QX and Q'");
  }

  // Fix "leaderboard in2" → "leaderboard in Q2"
  {
    const before = fixed;
    fixed = fixed.replace(/\bleaderboard in(\d)\b/gi, "leaderboard in Q$1");
    if (fixed !== before) corrections.push("Fixed 'leaderboard inX' → 'leaderboard in QX'");
  }

  // === DUPLICATE SUMMARY REMOVAL ===
  // Remove duplicate opening summary if PROFESSIONAL SUMMARY section exists
  {
    const professionalSummaryIndex = fixed.indexOf("PROFESSIONAL SUMMARY");
    if (professionalSummaryIndex > 0 && professionalSummaryIndex < 500) {
      // Check if there's a paragraph before PROFESSIONAL SUMMARY that looks like a duplicate summary
      const beforeSection = fixed.slice(0, professionalSummaryIndex).trim();
      const lines = beforeSection.split("\n").filter(l => l.trim());
      
      // If there's a substantial paragraph (50+ chars) right before PROFESSIONAL SUMMARY, remove it
      const lastParagraph = lines[lines.length - 1];
      if (lastParagraph && lastParagraph.length > 50 && !lastParagraph.includes(":")) {
        // This looks like a duplicate opening summary - remove it
        const newBefore = lines.slice(0, -1).join("\n");
        fixed = newBefore + (newBefore ? "\n\n" : "") + fixed.slice(professionalSummaryIndex);
        corrections.push("Removed duplicate opening summary paragraph");
      }
    }
  }

  // === E-COMMERCE CONSISTENCY ===
  // Standardize to "e-commerce" (lowercase with hyphen)
  {
    const before = fixed;
    fixed = fixed.replace(/\bE-commerce\b/g, "e-commerce");
    fixed = fixed.replace(/\beCommerce\b/g, "e-commerce");
    fixed = fixed.replace(/\bEcommerce\b/g, "e-commerce");
    if (fixed !== before) corrections.push("Standardized e-commerce spelling");
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
    // Only where a year belongs (after a month name or a range dash): "201
    // employees" is a headcount, not a truncated 2019.
    fixed = fixed.replace(
      /(\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+|[–—-]\s*)(20\d)(?![\d.])/gi,
      (match, lead: string, prefix: string) => {
        const candidates = yearsByPrefix.get(prefix) || [];
        if (candidates.length === 1) {
          corrections.push(`Restored year ${prefix} → ${candidates[0]}`);
          return `${lead}${candidates[0]}`;
        }
        return match;
      },
    );

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

  // The addresses set aside at the start go back exactly as written.
  fixed = fixed.replace(new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, "g"), (_m, i: string) => addresses[Number(i)] ?? "");

  if (corrections.length > 0) {
    console.log(`[AUTO-FIX] Applied ${corrections.length} corrections:`, corrections);
  }

  return { fixed, corrections };
};
