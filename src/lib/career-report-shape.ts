// THE SHAPE OF A CAREER SNAPSHOT AND A GRADUATE GAME PLAN (sweep S8-034, S8-073).
//
// Pure, no imports. Two byte-identical copies: supabase/functions/_shared/
// (the generators) and src/lib/ (the pages and the PDF); a test holds them
// equal.
//
// - The generators accepted any reply with four top-level keys, so a reply
//   without careerRisks or a week, or with a string where a list belongs, was
//   saved, emailed and marked delivered, then crashed the success page. A
//   generator now ships a reply only when it has no problems here, else it
//   asks the next model.
// - The verdicts ("Strong", "High", "Ready to Apply") decide colours and
//   gauges. The language instruction told the model to translate "labels", so
//   a Spanish "Fuerte" read as a red, 30% gauge. They are kept in English,
//   translations a model writes anyway are mapped back, and the page shows
//   each one in the reader's language from its English value.

export const REPORT_ENUMS = {
  overall: ["Strong", "Mixed", "Risky"],
  performance: ["Strong", "Mixed", "Weak"],
  trajectory: ["Growth", "Stable", "Stagnant", "Unclear"],
  credibility: ["High", "Medium", "Low"],
  level: ["Entry", "Mid", "Senior", "Executive"],
  fit: ["Aligned", "Stretch", "Mismatch"],
  verdict: ["Ready to Apply", "Fix These First"],
  confidence: ["High", "Medium"],
  priority: ["High", "Medium", "Low"],
} as const;
export type ReportEnumKind = keyof typeof REPORT_ENUMS;

/** The i18n key (careerReportEnum.<key>) of each English value. */
export const REPORT_ENUM_KEY: Record<string, string> = {
  Strong: "strong", Mixed: "mixed", Risky: "risky", Weak: "weak",
  Growth: "growth", Stable: "stable", Stagnant: "stagnant", Unclear: "unclear",
  High: "high", Medium: "medium", Low: "low",
  Entry: "entry", Mid: "mid", Senior: "senior", Executive: "executive",
  Aligned: "aligned", Stretch: "stretch", Mismatch: "mismatch",
  "Ready to Apply": "readyToApply", "Fix These First": "fixTheseFirst",
};

export type ReportTone = "positive" | "neutral" | "negative" | "unknown";

/** The colour a value is drawn in; a value that is not one of ours is "unknown", never red. */
export function reportTone(value: unknown): ReportTone {
  switch (value) {
    case "Strong": case "High": case "Growth": case "Aligned": case "Ready to Apply": return "positive";
    case "Mixed": case "Medium": case "Stable": case "Stretch": case "Fix These First": return "neutral";
    case "Risky": case "Weak": case "Low": case "Stagnant": case "Unclear": case "Mismatch": return "negative";
    default: return "unknown";
  }
}

// What a model writes for each value in our nine languages, folded (lower
// case, Latin accents dropped). One word can mean two values ("faible" is
// Weak or Low); the field's own list decides.
const SYNONYMS: Record<string, string[]> = {
  Strong: ["strong", "fuerte", "solido", "solida", "stark", "fort", "forte", "solide", "sterk", "krachtig", "मजबूत", "मज़बूत", "malakas", "matibay"],
  Mixed: ["mixed", "mixto", "mixta", "gemischt", "durchwachsen", "mitige", "mitigee", "mixte", "gemengd", "wisselend", "misto", "mista", "मिश्रित", "halo-halo", "magkahalo"],
  Risky: ["risky", "arriesgado", "riesgoso", "riskant", "risque", "risquee", "risicovol", "arriscado", "जोखिम भरा", "जोखिमपूर्ण", "mapanganib", "delikado"],
  Weak: ["weak", "debil", "schwach", "faible", "zwak", "fraco", "fraca", "कमजोर", "कमज़ोर", "mahina"],
  Growth: ["growth", "growing", "crecimiento", "en crecimiento", "wachstum", "wachsend", "croissance", "en croissance", "groei", "groeiend", "crescimento", "em crescimento", "विकास", "वृद्धि", "paglago", "lumalago"],
  Stable: ["stable", "estable", "stabil", "stabiel", "estavel", "स्थिर", "matatag"],
  Stagnant: ["stagnant", "stagnating", "estancado", "estancada", "stagnierend", "stagnerend", "stilstaand", "estagnado", "estagnada", "ठहरा हुआ", "ठहराव", "रुका हुआ", "hindi umuusad"],
  Unclear: ["unclear", "poco claro", "incierto", "unklar", "pas clair", "incertain", "flou", "onduidelijk", "pouco claro", "incerto", "अस्पष्ट", "hindi malinaw"],
  High: ["high", "alto", "alta", "elevado", "elevada", "hoch", "elevee", "eleve", "haute", "haut", "hoog", "उच्च", "mataas", "fort", "forte"],
  Medium: ["medium", "medio", "media", "mittel", "moyenne", "moyen", "gemiddeld", "middel", "medio", "média", "मध्यम", "katamtaman"],
  Low: ["low", "bajo", "baja", "niedrig", "gering", "faible", "basse", "bas", "laag", "baixo", "baixa", "निम्न", "कम", "mababa"],
  Entry: ["entry", "entry-level", "entry level", "junior", "inicial", "principiante", "einstieg", "einsteiger", "berufseinsteiger", "debutant", "debutante", "starter", "instap", "iniciante", "प्रारंभिक", "प्रवेश स्तर", "baguhan"],
  Mid: ["mid", "mid-level", "mid level", "mittlere ebene", "intermedio", "intermedia", "medio", "mittel", "intermediaire", "medior", "pleno", "intermediario", "मध्य", "मध्य स्तर", "gitna"],
  Senior: ["senior", "senior-level", "senior level", "वरिष्ठ", "nakatatanda"],
  Executive: ["executive", "ejecutivo", "ejecutiva", "directivo", "fuhrungsebene", "fuhrungskraft", "dirigeant", "executif", "directie", "leidinggevend", "executivo", "executiva", "कार्यकारी", "ehekutibo"],
  Aligned: ["aligned", "alineado", "alineada", "passend", "ausgerichtet", "aligne", "alignee", "afgestemd", "alinhado", "alinhada", "अनुरूप", "संरेखित", "tugma", "nakahanay", "angkop"],
  Stretch: ["stretch", "desafio", "reto", "ambitioniert", "herausforderung", "ambitieux", "defi", "uitdaging", "ambitieus", "desafiador", "चुनौतीपूर्ण", "mapaghamon", "hamon"],
  Mismatch: ["mismatch", "mismatched", "desajuste", "no alineado", "unpassend", "nicht passend", "fehlanpassung", "decalage", "inadequation", "niet passend", "onpassend", "incompativel", "desalinhado", "बेमेल", "असंगत", "hindi tugma", "hindi angkop"],
  "Ready to Apply": ["ready to apply", "ready", "listo para postular", "listo para aplicar", "listo para postularse", "bereit zur bewerbung", "bewerbungsbereit", "pret a postuler", "klaar om te solliciteren", "pronto para se candidatar", "pronto para candidatar-se", "आवेदन के लिए तैयार", "handa nang mag-apply", "handa na"],
  "Fix These First": ["fix these first", "fix first", "corrige esto primero", "corregir primero", "corrige primero", "zuerst beheben", "erst beheben", "a corriger d'abord", "corrigez d'abord", "eerst oplossen", "corrija isto primeiro", "corrigir primeiro", "पहले इन्हें ठीक करें", "पहले ठीक करें", "ayusin muna ang mga ito", "ayusin muna"],
};

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[\s_]+/g, " ").replace(/^[\s"'“”«»(\[]+|[\s"'“”«».!:;)\]]+$/g, "").trim();
}

const BY_WORD = new Map<string, string[]>();
for (const [value, words] of Object.entries(SYNONYMS)) {
  for (const w of [value, ...words]) {
    const k = fold(w);
    const list = BY_WORD.get(k) ?? [];
    if (!list.includes(value)) list.push(value);
    BY_WORD.set(k, list);
  }
}

/** The English value a field's answer means, or null when it is none of the field's values. */
export function canonicalReportEnum(kind: ReportEnumKind, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const allowed = REPORT_ENUMS[kind] as readonly string[];
  const k = fold(value);
  for (const v of BY_WORD.get(k) ?? []) if (allowed.includes(v)) return v;
  return null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

function textList(v: unknown): string[] {
  const items = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return items.map((x) => (isObj(x) ? text(Object.values(x).find((y) => typeof y === "string")) : text(x))).filter(Boolean);
}

function recList<T>(v: unknown, fromObj: (o: Obj) => T, fromText: (s: string) => T): T[] {
  const items = Array.isArray(v) ? v : isObj(v) || typeof v === "string" ? [v] : [];
  const out: T[] = [];
  for (const x of items) {
    if (isObj(x)) out.push(fromObj(x));
    else if (text(x)) out.push(fromText(text(x)));
  }
  return out;
}

class Check {
  problems: string[] = [];
  obj(v: unknown, path: string): Obj {
    if (isObj(v)) return v;
    this.problems.push(`${path} is missing`);
    return {};
  }
  enumOf(kind: ReportEnumKind, v: unknown, path: string): string {
    const c = canonicalReportEnum(kind, v);
    if (c) return c;
    this.problems.push(`${path} ${JSON.stringify(v ?? null).slice(0, 40)} is not one of ${REPORT_ENUMS[kind].join("/")}`);
    return text(v);
  }
}

export interface Shaped<T> {
  /** Always renderable: every list is a list, every object an object. */
  data: T;
  /** Empty when the reply is complete; a generator ships nothing else. */
  problems: string[];
}

export interface CareerSnapshotShape {
  careerSignalScore: {
    overall: string;
    performanceSignal: { score: string; summary: string };
    trajectorySignal: { score: string; summary: string };
    credibilitySignal: { score: string; summary: string };
    seniorityAlignment: { currentLevel: string; targetFit: string; summary: string };
  };
  recruiterPerception: { summary: string };
  topStrengths: Array<{ strength: string; evidence: string }>;
  careerRisks: Array<{ risk: string; recruiterQuestion: string; mitigation: string }>;
  positioningGuidance: { idealPositioning: string; rolesToTarget: string[]; rolesToAvoid: string[]; companyStages: string[]; storyFraming: string };
  priorityFixes: Array<{ fix: string; impact: string; timeEstimate: string }>;
}

export function shapeCareerSnapshot(raw: unknown): Shaped<CareerSnapshotShape> {
  const c = new Check();
  const r = c.obj(raw, "report");
  const s = c.obj(r.careerSignalScore, "careerSignalScore");
  const sig = (key: string, kind: ReportEnumKind) => {
    const o = c.obj(s[key], `careerSignalScore.${key}`);
    return { score: c.enumOf(kind, o.score, `careerSignalScore.${key}.score`), summary: text(o.summary) };
  };
  const sa = c.obj(s.seniorityAlignment, "careerSignalScore.seniorityAlignment");
  const rp = typeof r.recruiterPerception === "string" ? { summary: r.recruiterPerception } : c.obj(r.recruiterPerception, "recruiterPerception");
  const pg = c.obj(r.positioningGuidance, "positioningGuidance");
  const data: CareerSnapshotShape = {
    careerSignalScore: {
      overall: c.enumOf("overall", s.overall, "careerSignalScore.overall"),
      performanceSignal: sig("performanceSignal", "performance"),
      trajectorySignal: sig("trajectorySignal", "trajectory"),
      credibilitySignal: sig("credibilitySignal", "credibility"),
      seniorityAlignment: {
        currentLevel: c.enumOf("level", sa.currentLevel, "careerSignalScore.seniorityAlignment.currentLevel"),
        targetFit: c.enumOf("fit", sa.targetFit, "careerSignalScore.seniorityAlignment.targetFit"),
        summary: text(sa.summary),
      },
    },
    recruiterPerception: { summary: text(rp.summary) },
    topStrengths: recList(r.topStrengths, (o) => ({ strength: text(o.strength), evidence: text(o.evidence) }), (t) => ({ strength: t, evidence: "" })),
    careerRisks: recList(r.careerRisks, (o) => ({ risk: text(o.risk), recruiterQuestion: text(o.recruiterQuestion), mitigation: text(o.mitigation) }), (t) => ({ risk: t, recruiterQuestion: "", mitigation: "" })),
    positioningGuidance: {
      idealPositioning: text(pg.idealPositioning),
      rolesToTarget: textList(pg.rolesToTarget),
      rolesToAvoid: textList(pg.rolesToAvoid),
      companyStages: textList(pg.companyStages),
      storyFraming: text(pg.storyFraming),
    },
    priorityFixes: recList(r.priorityFixes, (o) => ({ fix: text(o.fix), impact: text(o.impact), timeEstimate: text(o.timeEstimate) }), (t) => ({ fix: t, impact: "", timeEstimate: "" })),
  };
  if (!data.recruiterPerception.summary) c.problems.push("recruiterPerception.summary is empty");
  if (data.topStrengths.length === 0) c.problems.push("topStrengths is empty");
  return { data, problems: c.problems };
}

export interface GamePlanShape {
  resumeReadinessGate: { verdict: string; confidence: string; summary: string; quickFixes: string[] };
  roleTargetingMap: { summary: string; priorityRoles: Array<{ title: string; whyFit: string }>; rolesToAvoid: Array<{ title: string; reason: string }> };
  applicationStrategy: { weeklyTarget: string; whereToApply: Array<{ channel: string; priority: string; tip: string }>; whatToAvoid: string[]; keyInsight: string };
  networkingPlaybook: { approach: string; outreachScript: { scenario: string; script: string }; linkedInTips: string[] };
  interviewReadiness: { summary: string; storiesToPrepare: Array<{ type: string; prompt: string }>; whyThisRole: string; projectTalkingPoints: string[] };
  thirtyDayPlan: Record<"week1" | "week2" | "week3" | "week4", { focus: string; tasks: string[] }>;
}

export function shapeGamePlan(raw: unknown): Shaped<GamePlanShape> {
  const c = new Check();
  const r = c.obj(raw, "report");
  const gate = c.obj(r.resumeReadinessGate, "resumeReadinessGate");
  const map = c.obj(r.roleTargetingMap, "roleTargetingMap");
  const app = c.obj(r.applicationStrategy, "applicationStrategy");
  const net = c.obj(r.networkingPlaybook, "networkingPlaybook");
  const script = typeof net.outreachScript === "string" ? { scenario: "", script: net.outreachScript } : c.obj(net.outreachScript, "networkingPlaybook.outreachScript");
  const iv = c.obj(r.interviewReadiness, "interviewReadiness");
  const plan = c.obj(r.thirtyDayPlan, "thirtyDayPlan");
  const week = (k: "week1" | "week2" | "week3" | "week4") => {
    const w = c.obj(plan[k], `thirtyDayPlan.${k}`);
    return { focus: text(w.focus), tasks: textList(w.tasks) };
  };
  const data: GamePlanShape = {
    resumeReadinessGate: {
      verdict: c.enumOf("verdict", gate.verdict, "resumeReadinessGate.verdict"),
      confidence: c.enumOf("confidence", gate.confidence, "resumeReadinessGate.confidence"),
      summary: text(gate.summary),
      quickFixes: textList(gate.quickFixes),
    },
    roleTargetingMap: {
      summary: text(map.summary),
      priorityRoles: recList(map.priorityRoles, (o) => ({ title: text(o.title), whyFit: text(o.whyFit) }), (t) => ({ title: t, whyFit: "" })),
      rolesToAvoid: recList(map.rolesToAvoid, (o) => ({ title: text(o.title), reason: text(o.reason) }), (t) => ({ title: t, reason: "" })),
    },
    applicationStrategy: {
      weeklyTarget: text(app.weeklyTarget),
      whereToApply: recList(app.whereToApply, (o) => ({ channel: text(o.channel), priority: c.enumOf("priority", o.priority, "applicationStrategy.whereToApply.priority"), tip: text(o.tip) }), (t) => ({ channel: t, priority: "", tip: "" })),
      whatToAvoid: textList(app.whatToAvoid),
      keyInsight: text(app.keyInsight),
    },
    networkingPlaybook: { approach: text(net.approach), outreachScript: { scenario: text(script.scenario), script: text(script.script) }, linkedInTips: textList(net.linkedInTips) },
    interviewReadiness: {
      summary: text(iv.summary),
      storiesToPrepare: recList(iv.storiesToPrepare, (o) => ({ type: text(o.type), prompt: text(o.prompt) }), (t) => ({ type: "", prompt: t })),
      whyThisRole: text(iv.whyThisRole),
      projectTalkingPoints: textList(iv.projectTalkingPoints),
    },
    thirtyDayPlan: { week1: week("week1"), week2: week("week2"), week3: week("week3"), week4: week("week4") },
  };
  return { data, problems: c.problems };
}

/** A model reply's JSON object, or null: the whole reply, else its outermost {...}. */
export function parseReportJson(content: unknown): unknown {
  if (typeof content !== "string") return null;
  try { return JSON.parse(content); } catch { /* fall through */ }
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
