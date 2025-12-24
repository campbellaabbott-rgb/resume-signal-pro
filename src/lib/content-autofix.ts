// Client-side auto-fix for common AI content corruption patterns

export interface AutoFixResult {
  fixed: string;
  corrections: string[];
}

export const autoFixContent = (content: string, originalResume?: string): AutoFixResult => {
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
  if (originalResume) {
    const truncatedDollar = fixed.match(/\$,(\d{3})/g);
    if (truncatedDollar) {
      const originalAmounts = originalResume.match(/\$[\d,]+/g) || [];
      for (const truncated of truncatedDollar) {
        const suffix = truncated.slice(2);
        const match = originalAmounts.find(a => a.endsWith(suffix));
        if (match) {
          fixed = fixed.replace(truncated, match);
          corrections.push(`Restored ${truncated} to ${match}`);
        }
      }
    }
  }

  // Fix missing space before numbers (e.g., "across67" → "across 67")
  const beforeFix = fixed;
  fixed = fixed.replace(/([a-zA-Z])(\d{2,})/g, (match, letter, num) => {
    // Don't fix things like "gpt5" or version numbers, or common patterns
    if (/^[a-z]$/.test(letter) && /^\d{1,2}$/.test(num)) return match;
    if (['x', 'v', 'k', 'm', 'b'].includes(letter.toLowerCase())) return match; // 1x, v2, etc.
    return `${letter} ${num}`;
  });
  if (fixed !== beforeFix) {
    corrections.push('Added missing spaces before numbers');
  }

  // Fix truncated CI/CD
  if (/\/CD\b/i.test(fixed) && !/CI\/CD/i.test(fixed)) {
    fixed = fixed.replace(/\b\/CD\b/gi, 'CI/CD');
    corrections.push('Fixed truncated CI/CD');
  }
  fixed = fixed.replace(/including\s*\/CD/gi, 'including CI/CD');

  // Fix truncated GitHub (Git without Hub following)
  const gitBefore = fixed;
  fixed = fixed.replace(/\bGit\b(?!\s*(Hub|Lab|Actions|Flow|Kraken|ignore|config|Bash|commit|branch|merge|push|pull|clone|remote|log|diff|status|add|checkout|reset))/gi, 'GitHub');
  if (fixed !== gitBefore) {
    corrections.push('Fixed truncated Git → GitHub');
  }

  // Fix truncated LinkedIn
  const linkedBefore = fixed;
  fixed = fixed.replace(/\bLinked\b(?!\s*(In|Sales|List))/gi, 'LinkedIn');
  if (fixed !== linkedBefore) {
    corrections.push('Fixed truncated Linked → LinkedIn');
  }

  // Fix Fortune without 500
  if (originalResume?.includes('Fortune 500') && /Fortune\b(?!\s*\d)/i.test(fixed)) {
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
  if (/building\s*-\s*\d+/i.test(fixed)) {
    fixed = fixed.replace(/building\s*-\s*\d+/gi, 'building');
    corrections.push('Fixed nonsensical "building -1" pattern');
  }
  
  // Fix broken hyphenated phrases like "0-to- go-to-market"
  if (/\d+-to-\s+/.test(fixed)) {
    fixed = fixed.replace(/(\d+)-to-\s+/g, '$1-to-');
    corrections.push('Fixed broken hyphenated phrases');
  }

  // Fix Codes) → Codespaces
  if (originalResume?.includes('Codespaces') && /\bCodes\)/.test(fixed)) {
    fixed = fixed.replace(/\bCodes\)/g, 'Codespaces');
    corrections.push('Fixed truncated Codespaces');
  }

  // Fix GitHub Cop → GitHub Copilot
  if (originalResume?.includes('Copilot') && /GitHub\s+Cop\b/.test(fixed)) {
    fixed = fixed.replace(/GitHub\s+Cop\b/g, 'GitHub Copilot');
    corrections.push('Fixed truncated Copilot');
  }

  // Fix Git Actions → GitHub Actions
  if (/\bGit\s+Actions\b/.test(fixed)) {
    fixed = fixed.replace(/\bGit\s+Actions\b/g, 'GitHub Actions');
    corrections.push('Fixed Git Actions → GitHub Actions');
  }

  // Fix Full-C → Full-Cycle
  if (originalResume?.includes('Full-Cycle') && /Full-C\b/.test(fixed)) {
    fixed = fixed.replace(/Full-C\b/g, 'Full-Cycle');
    corrections.push('Fixed truncated Full-Cycle');
  }

  // Fix Carnegie Mellonator → Carnegie Mellon
  if (/Carnegie\s+Mellonator/i.test(fixed)) {
    fixed = fixed.replace(/Carnegie\s+Mellonator/gi, 'Carnegie Mellon');
    corrections.push('Fixed garbled Carnegie Mellon');
  }

  // Fix highpensity → high-propensity (common AI error)
  if (/highpensity/i.test(fixed)) {
    fixed = fixed.replace(/highpensity/gi, 'high-propensity');
    corrections.push('Fixed garbled high-propensity');
  }

  if (corrections.length > 0) {
    console.log(`[AUTO-FIX] Applied ${corrections.length} corrections:`, corrections);
  }

  return { fixed, corrections };
};
