// S12-014: employers searched by a short name, routed alike in every isolate. brandKeysOf over the
// 2026-10-18 facet (open >= 250), each token read live 2026-11-01. Routing only: layoff-filings copies
// employer-aliases.ts, and these keys are no second names for its matcher (n1415).
export const ROUTE_BRANDS: Readonly<Record<string, { name: string; tokens: string[] }>> = {
  ups: { name: "UPS", tokens: ["hcmportal~wd5~Search"] },
  aeo: { name: "AEO", tokens: ["hcml~us2~CX_1"] },
  chs: { name: "CHS", tokens: ["fa-evxo-saasfaprod1~ocs~CX_1"] },
  ihg: { name: "IHG", tokens: ["fa-evax-saasfaprod1~ocs~CX_1"] },
  heb: { name: "HEB", tokens: ["careers.heb.com"] },
  urbn: { name: "URBN", tokens: ["talent.urbn.com"] },
  wm: { name: "WM", tokens: ["emcm~us2~CX_1"] },
  hp: { name: "HP", tokens: ["hp~wd5~ExternalCareerSite", "hp~wd5~EXTEU-AC-CareerSite"] },
  saic: { name: "SAIC", tokens: ["eihu~us8~CX_1"] },
  ehc: { name: "EHC", tokens: ["ibwsjb~ocs~CX_1"] },
  bny: { name: "BNY", tokens: ["eofe~us2~CX_1"] },
  pg: { name: "P&G", tokens: ["pg~wd5~1000"] },
  lcbo: { name: "LCBO", tokens: ["lcbo~wd3~LCBOCareerSite"] },
  uber: { name: "Uber", tokens: ["iaziqy~ocs~CX_1"] },
  lkq: { name: "LKQ", tokens: ["lkqcorp~wd5~ExternalCareerSite-LKQ"] },
  "3m": { name: "3M", tokens: ["3m~wd1~Search"] },
  dpr: { name: "DPR", tokens: ["mydpr~wd5~11212017"] },
  ucsf: { name: "UCSF", tokens: ["iazuqy~ocs~CX_1"] },
  mufg: { name: "MUFG", tokens: ["mufgub~wd3~MUFG-Careers", "mufgub~wd3~MUFG-EarlyCareers"] },
  bgis: { name: "BGIS", tokens: ["fa-evcg-saasfaprod1~ocs~CX_1"] },
  aep: { name: "AEP", tokens: ["aep~wd1~AEPCareerSite"] },
};
