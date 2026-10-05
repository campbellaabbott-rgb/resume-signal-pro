/**
 * The deterministic clean-up applied to the paid résumé rewrite and cover
 * letter, and the issue report shown beside them. Pulled out of index.ts so the
 * Node test suite runs the real rules (register L5-03).
 */

// Auto-fix common AI corruption patterns
export const autoFixContent = (content: string, originalResume: string): { fixed: string, corrections: string[] } => {
  let fixed = content;
  const corrections: string[] = [];

  // Fix double commas
  if (/,,+/.test(fixed)) {
    fixed = fixed.replace(/,,+/g, ',');
    corrections.push('Fixed double commas');
  }

  // Fix malformed dollar amounts like $20,,000 → $20,000
  if (/\$\d+,,\d/.test(fixed)) {
    fixed = fixed.replace(/(\$\d+),,(\d)/g, '$1,$2');
    corrections.push('Fixed malformed dollar amounts');
  }

  // Fix truncated dollar amounts $,000 - try to find correct value from original
  const truncatedDollar = fixed.match(/\$,(\d{3})/g);
  if (truncatedDollar) {
    // Try to find the full amount in original
    const originalAmounts: string[] = originalResume.match(/\$[\d,]+/g) ?? [];
    for (const truncated of truncatedDollar) {
      const suffix = truncated.slice(2); // e.g., "000" from "$,000"
      const match = originalAmounts.find(a => a.endsWith(suffix));
      if (match) {
        fixed = fixed.replace(truncated, match);
        corrections.push(`Restored ${truncated} to ${match}`);
      }
    }
  }

  // NO letter-digit spacing, NO Git -> GitHub, NO Linked -> LinkedIn (register
  // L5-03). Each rewrote correct text in the paid résumé and letter: a space
  // went into every email and profile URL with digits in it ("jsmith1987@"
  // became "jsmith 1987@"), every skill "Git" became "GitHub" (a claim the
  // candidate never made), and "closely linked to" became "closely LinkedIn
  // to". A fix that cannot tell a typo from a word is not a fix.

  // Fix truncated CI/CD
  if (/\/CD\b/i.test(fixed) && !/CI\/CD/i.test(fixed)) {
    fixed = fixed.replace(/\b\/CD\b/gi, 'CI/CD');
    corrections.push('Fixed truncated CI/CD');
  }

  // Fix "including/CD" → "including CI/CD"
  fixed = fixed.replace(/including\s*\/CD/gi, 'including CI/CD');

  // Fix Fortune without 500
  if (originalResume.includes('Fortune 500') && /Fortune\b(?!\s*\d)/.test(fixed)) {
    fixed = fixed.replace(/Fortune\b(?!\s*\d)/gi, 'Fortune 500');
    corrections.push('Added missing Fortune 500');
  }

  // Fix broken percentage %+
  if (/%\+/.test(fixed)) {
    fixed = fixed.replace(/%\+/g, '%');
    corrections.push('Fixed broken percentage');
  }

  // Fix empty/malformed parentheses
  fixed = fixed.replace(/\(\s*,\s*\)/g, '');
  fixed = fixed.replace(/\(\s*\)/g, '');

  // Fix "building -1" or similar nonsense
  fixed = fixed.replace(/building\s*-\s*\d+/gi, 'building');
  
  // Fix broken hyphenated phrases like "0-to- go-to-market"
  fixed = fixed.replace(/(\d+)-to-\s+/g, '$1-to-');

  // Fix Codes) → Codespaces (if original has Codespaces)
  if (originalResume.includes('Codespaces') && /\bCodes\)/.test(fixed)) {
    fixed = fixed.replace(/\bCodes\)/g, 'Codespaces');
    corrections.push('Fixed truncated Codespaces');
  }

  // Fix GitHub Cop → GitHub Copilot
  if (originalResume.includes('Copilot') && /GitHub\s+Cop\b/.test(fixed)) {
    fixed = fixed.replace(/GitHub\s+Cop\b/g, 'GitHub Copilot');
    corrections.push('Fixed truncated Copilot');
  }

  // Fix Git Actions → GitHub Actions (only when the candidate wrote GitHub Actions)
  if (originalResume.includes('GitHub Actions') && /\bGit\s+Actions\b/.test(fixed)) {
    fixed = fixed.replace(/\bGit\s+Actions\b/g, 'GitHub Actions');
    corrections.push('Fixed Git Actions → GitHub Actions');
  }

  // Fix Full-C → Full-Cycle
  if (originalResume.includes('Full-Cycle') && /Full-C\b/.test(fixed)) {
    fixed = fixed.replace(/Full-C\b/g, 'Full-Cycle');
    corrections.push('Fixed truncated Full-Cycle');
  }

  if (corrections.length > 0) {
    console.log(`[AUTO-FIX] Applied ${corrections.length} corrections:`, corrections);
  }

  return { fixed, corrections };
};

// Post-processing validation for common AI corruption patterns
export const validateContent = (rawContent: string, originalResume: string): { issues: string[], score: number } => {
  const issues: string[] = [];
  // Emails and URLs legitimately hold letters run into digits; they are not
  // corruption, so the pattern checks below never see them.
  const content = rawContent
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, ' ')
    .replace(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s|,)]*/gi, ' ');

  // Pattern checks. "Git" and "linked" are words, not truncations; they are
  // only suspicious where the candidate's own résumé spells the long form.
  const patterns = [
    { regex: /,,+/g, name: 'double_comma', desc: 'Double commas found' },
    { regex: /\$,\d/g, name: 'truncated_dollar', desc: 'Truncated dollar amount ($,XXX)' },
    { regex: /\$\d+,,\d/g, name: 'malformed_dollar', desc: 'Malformed dollar amount' },
    { regex: /[a-zA-Z]\d{2,}/g, name: 'missing_space_before_number', desc: 'Missing space before number' },
    { regex: /\d{2,}[a-zA-Z]/g, name: 'missing_space_after_number', desc: 'Missing space after number' },
    { regex: /[A-Za-z]+\)/g, name: 'truncated_word', desc: 'Possible truncated word ending in )' },
    { regex: /\([,\s]*\)/g, name: 'empty_parens', desc: 'Empty or malformed parentheses' },
    { regex: /\/CD\b/gi, name: 'truncated_cicd', desc: 'Truncated CI/CD' },
    ...(originalResume.includes('GitHub') && !/\bGit\b(?!\s*Hub)/.test(originalResume)
      ? [{ regex: /\bGit\b(?!\s*(Hub|Lab|Actions|Flow|Kraken))/g, name: 'truncated_github', desc: 'Possible truncated GitHub' }]
      : []),
    ...(originalResume.includes('LinkedIn')
      ? [{ regex: /\bLinked\b(?!\s*(In|Sales|List))/g, name: 'truncated_linkedin', desc: 'Possible truncated LinkedIn' }]
      : []),
    { regex: /Fortune\b(?!\s*\d)/gi, name: 'missing_fortune_number', desc: 'Fortune without number (e.g., Fortune 500)' },
    { regex: /\b\d+-to-\s+/g, name: 'broken_hyphen_phrase', desc: 'Broken hyphenated phrase' },
    { regex: /building\s*-?\d/gi, name: 'nonsense_building', desc: 'Nonsensical "building -1" pattern' },
    { regex: /\b[A-Z][a-z]+ator\b/g, name: 'garbled_name', desc: 'Possible garbled name (ending in -ator)' },
    { regex: /%\+/g, name: 'broken_percentage', desc: 'Broken percentage (%+)' },
  ];

  for (const { regex, name, desc } of patterns) {
    const matches = content.match(regex);
    if (matches && matches.length > 0) {
      // Filter out false positives for some patterns
      if (name === 'truncated_word' && matches.every(m => ['Actions)', 'Codespaces)'].includes(m))) continue;
      
      issues.push(`${desc}: ${matches.slice(0, 3).join(', ')}${matches.length > 3 ? '...' : ''}`);
    }
  }

  // Check if key terms from original are preserved
  const keyTerms = ['GitHub', 'LinkedIn', 'CI/CD', 'Fortune 500', 'Copilot', 'Actions'];
  for (const term of keyTerms) {
    if (originalResume.includes(term) && !rawContent.includes(term)) {
      issues.push(`Missing key term: ${term}`);
    }
  }

  // Calculate quality score (100 = perfect, lower = more issues)
  const score = Math.max(0, 100 - (issues.length * 10));

  if (issues.length > 0) {
    console.log(`[VALIDATION] Found ${issues.length} potential issues:`, issues);
  }

  return { issues, score };
};

