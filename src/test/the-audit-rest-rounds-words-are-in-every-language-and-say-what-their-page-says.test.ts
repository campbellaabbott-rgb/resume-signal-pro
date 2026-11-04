/**
 * THE AUDIT-REST ROUND'S WORDS ARE IN EVERY LANGUAGE, AND SAY WHAT THEIR PAGE
 * SAYS (the round's landing on deployed main, 2026-11-02).
 *
 * While the nine locale files belonged to other rounds, the audit-rest
 * builders wrote 55 new or changed sentences outside them, to be applied when
 * the round joined main. Until then a German, Hindi or Tagalog reader of the
 * purchase page, the consent page or the account's email controls read them in
 * English. They are applied now, and these properties hold:
 *   - each of the round's keys has a value in all nine locales, carrying
 *     exactly the {{placeholders}} the English one does;
 *   - where a component writes the key with an inline English default, that
 *     default is the sentence en.json holds. The legacy-link refusal said
 *     "it is still included" in the component and "While your plan is active
 *     it is included" in the translations. The conditional one is true: a grant
 *     minted before grants named their account is refused before the plan is
 *     read, and the new grant the signed-in member opens is refused in turn
 *     when the plan has lapsed (_shared/pro-standing.ts proGrantRefusal);
 *   - the five keys the round's new sentences took over are gone from every
 *     locale and called nowhere;
 *   - the Portuguese is Brazilian, as the site's checkout policy names it: the
 *     round's pt values use none of the European forms its builders first
 *     wrote.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "..");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const locale = (l: string) => JSON.parse(readFileSync(resolve(SRC, "i18n/locales", `${l}.json`), "utf8")) as Record<string, unknown>;
const valueOf = (d: Record<string, unknown>, key: string): unknown =>
  key.split(".").reduce<unknown>((c, p) => (c && typeof c === "object" ? (c as Record<string, unknown>)[p] : undefined), d);
const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

/** The round's sentences, by the builder that wrote them. */
const ROUND_KEYS = [
  // abuse
  "oauthConsent.grant",
  // account
  "accountPage.notifSummaryEmails", "accountPage.notifBlurbCadence", "accountPage.notifToggleDaily", "accountPage.notifDaily",
  "accountPage.ssBellOffAriaDaily", "accountPage.ssBellOnAriaDaily", "accountPage.ssBellOnTitleDaily", "accountPage.ssBellOffTitleDaily",
  "accountPage.ssFootnoteACadence", "accountPage.ssFootnoteBCadence", "accountPage.acAiUnavailable", "accountPage.acSavedNoLetter",
  "proPlan.linkPendingNoSecondPlan", "proPlan.toast.linkPendingTitle", "proPlan.toast.linkPendingBody", "pulseConfirm.bodyCurated",
  // pages
  "writingRefusal.toolLimitTitle", "writingRefusal.toolLimitUntil", "analysisResults.jdKeywordsOnResume", "analysisResults.analysisSaved",
  "success.sharedComputer.title", "success.sharedComputer.body", "success.actions.shareHint", "success.actions.copyLink",
  "success.sharedViewDeleteNote", "success.noSession.title", "success.noSession.body", "applyAnswers.draftAgain",
  "productSuccess.noReference.title", "productSuccess.noReference.body", "productSuccess.noReference.pasteLabel",
  "productSuccess.noReference.notALink", "productSuccess.noReference.open",
  "productSuccess.refusal.rateLimited.title", "productSuccess.refusal.rateLimited.body",
  "productSuccess.refusal.refunded.title", "productSuccess.refusal.refunded.body",
  "productSuccess.refusal.withdrawn.title", "productSuccess.refusal.withdrawn.body",
  "productSuccess.refusal.unpaid.title", "productSuccess.refusal.unpaid.body",
  "productSuccess.refusal.notFound.title", "productSuccess.refusal.notFound.body",
  // the fixer
  "productSuccess.refusal.signInAgain.title", "productSuccess.refusal.signInAgain.body", "productSuccess.refusal.signInAgain.button",
  "productSuccess.refusal.busy.title", "productSuccess.refusal.busy.body",
  "writingRefusal.busyTitle", "writingRefusal.busyEveryone", "writingRefusal.busyNetwork",
  "proPlan.toast.alreadyUnconfirmedBody", "oauthConsent.scopesAsked", "oauthConsent.scopeUnexpected",
  // the held pages
  "jobsPage.tailorResumeOpen", "jobsPage.tailorResumeAgain", "jobsPage.coverLetterOpen",
];

/** The keys the round's sentences took over: no source calls them any more. */
const SUPERSEDED = ["accountPage.notifSummary", "accountPage.notifBlurb", "accountPage.ssFootnoteA", "accountPage.ssFootnoteB", "pulseConfirm.body"];

/** European Portuguese forms the round's builders first wrote, each with its Brazilian word. */
const EUROPEAN_PT = /\b(utilizador|registo|telemóvel|ligação|partilha\w*|Inicie sessão|Iniciar sessão|descarreg\w*|demasiad\w*|contacte|fornecedor)\b|\becrã|\b[Ee]stá a \w+r\b/iu;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "i18n") continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** A string literal starting at s[i] (a quote), or null for a template with an expression. */
function literal(s: string, i: number): { value: string; end: number } | null {
  const q = s[i];
  let out = "";
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") { out += s[j + 1]; j++; continue; }
    if (q === "`" && c === "$" && s[j + 1] === "{") return null;
    if (c === q) return { value: out, end: j + 1 };
    out += c;
  }
  return null;
}

/** Every inline English default a component writes for one of `keys`, with where it is written. */
function inlineDefaults(keys: ReadonlySet<string>): { key: string; value: string; file: string }[] {
  const out: { key: string; value: string; file: string }[] = [];
  const call = /(?<![A-Za-z0-9_$.])(?:i18n\.)?t\(\s*(['"`])/g;
  for (const file of sourceFiles(SRC)) {
    const s = readFileSync(file, "utf8");
    for (const m of s.matchAll(call)) {
      const key = literal(s, m.index! + m[0].length - 1);
      if (!key || !keys.has(key.value)) continue;
      let i = key.end;
      while (/\s/.test(s[i] ?? "")) i++;
      if (s[i] !== ",") continue;
      i++;
      while (/\s/.test(s[i] ?? "")) i++;
      if (!["'", '"', "`"].includes(s[i] ?? "")) continue;
      const def = literal(s, i);
      if (def) out.push({ key: key.value, value: def.value, file: file.slice(SRC.length + 1) });
    }
  }
  return out;
}

describe("the audit-rest round's words", () => {
  const en = locale("en");

  it("are in all nine locales, each with the English placeholders", () => {
    const wrong: string[] = [];
    for (const l of LOCALES) {
      const d = locale(l);
      for (const k of ROUND_KEYS) {
        const v = valueOf(d, k);
        const e = valueOf(en, k);
        if (typeof v !== "string" || !v.trim()) { wrong.push(`${l}: ${k} missing`); continue; }
        if (typeof e === "string" && placeholders(v).join() !== placeholders(e).join()) wrong.push(`${l}: ${k} has {{${placeholders(v)}}} for {{${placeholders(e)}}}`);
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("say in each component the sentence en.json holds", () => {
    const found = inlineDefaults(new Set(ROUND_KEYS));
    expect(found.length, "no inline default was read: the reader is pointed at the wrong files").toBeGreaterThan(20);
    const drift = found.filter((f) => f.value !== valueOf(en, f.key)).map((f) => `${f.file}: ${f.key}\n  component: ${f.value}\n  en.json:   ${String(valueOf(en, f.key))}`);
    expect(drift, drift.join("\n")).toEqual([]);
  });

  it("tell a legacy link's member the tool is included only while the plan is active", () => {
    const body = String(valueOf(en, "productSuccess.refusal.signInAgain.body"));
    expect(body).toMatch(/While your plan is active it is included/);
    expect(body).not.toMatch(/still included/);
    const component = inlineDefaults(new Set(["productSuccess.refusal.signInAgain.body"]));
    expect(component.map((c) => c.value)).toEqual([body]);
  });

  it("took over five keys that are gone from every locale and called nowhere", () => {
    for (const l of LOCALES) {
      const d = locale(l);
      for (const k of SUPERSEDED) expect(valueOf(d, k), `${l}: ${k}`).toBeUndefined();
    }
    const callers = sourceFiles(SRC).filter((f) => {
      const s = readFileSync(f, "utf8");
      return SUPERSEDED.some((k) => new RegExp(`['"\`]${k.replace(/\./g, "\\.")}['"\`]`).test(s));
    });
    expect(callers).toEqual([]);
  });

  it("are Brazilian Portuguese in pt", () => {
    const pt = locale("pt");
    const european = ROUND_KEYS.map((k) => [k, String(valueOf(pt, k))] as const).filter(([, v]) => EUROPEAN_PT.test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(european, european.join("\n")).toEqual([]);
  });

  it("TEETH: the European forms are caught and the Brazilian ones pass", () => {
    for (const eu of ["Esta ligação foi criada", "Inicie sessão com a conta", "Descarregue-a em PDF", "Está a usar um computador", "contacte o suporte", "Demasiadas verificações", "no ecrã do telemóvel", "o registo do utilizador"]) {
      expect(EUROPEAN_PT.test(eu), eu).toBe(true);
    }
    for (const br of ["Este link foi criado", "Entre com a conta", "Baixe-a em PDF", "Está usando um computador", "entre em contato com o suporte", "Verificações demais agora", "na tela do celular", "o registro do usuário"]) {
      expect(EUROPEAN_PT.test(br), br).toBe(false);
    }
  });
});
