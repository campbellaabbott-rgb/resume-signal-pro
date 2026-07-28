// One deterministic accent per board category — shared by the job board,
// LiveMatches (report page), and Account so the design language is one
// system. Hues chosen for dark-bg legibility; "other" stays neutral.
export const CATEGORY_ACCENT: Record<string, string> = {
  engineering: "hsl(217 91% 60%)",
  data_ai: "hsl(262 83% 66%)",
  design: "hsl(330 81% 60%)",
  product: "hsl(43 96% 56%)",
  marketing: "hsl(25 95% 53%)",
  sales: "hsl(142 71% 45%)",
  customer: "hsl(173 80% 40%)",
  finance: "hsl(160 84% 39%)",
  legal: "hsl(215 20% 65%)",
  people_hr: "hsl(292 84% 61%)",
  operations: "hsl(199 89% 48%)",
  healthcare: "hsl(0 84% 60%)",
  science: "hsl(188 86% 53%)",
  education: "hsl(48 96% 53%)",
  hospitality_retail: "hsl(31 97% 72%)",
  security: "hsl(0 72% 51%)",
  admin: "hsl(240 5% 65%)",
  other: "hsl(240 5% 45%)",
};
// Own-property check, not a bare index. CATEGORY_ACCENT[c] reaches
// Object.prototype, so accentFor("constructor") returned the Object
// constructor FUNCTION — and `??` does not catch it, because a function is not
// nullish. That value then landed in `border-left: 3px solid ${...}` and
// `backgroundColor`, i.e. a function stringified into CSS. Category reaches
// this from route params on the lander, so the key is not fully ours to trust.
// Same class as the NAME_FIXES["constructor"] leak in company-display.ts.
export const accentFor = (c?: string | null): string => {
  const key = c ?? "other";
  // hasOwnProperty.call, not Object.hasOwn: this project's tsconfig lib is
  // below es2022, and widening it for one lookup is not worth the blast radius.
  return Object.prototype.hasOwnProperty.call(CATEGORY_ACCENT, key)
    ? CATEGORY_ACCENT[key]
    : CATEGORY_ACCENT.other;
};
