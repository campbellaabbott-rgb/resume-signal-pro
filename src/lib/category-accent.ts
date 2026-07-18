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
export const accentFor = (c?: string | null): string => CATEGORY_ACCENT[c ?? "other"] ?? CATEGORY_ACCENT.other;
