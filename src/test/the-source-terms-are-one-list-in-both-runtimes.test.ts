// @vitest-environment node
/**
 * THE SOURCE TERMS ARE ONE LIST IN BOTH RUNTIMES.
 *
 * WHAT HAPPENED. API4 labels every /v1 row with what the terms we read say
 * about its hiring system: sourceTerms "permissive" or "conditional", and
 * aiTrain false where the system's content signal forbids training. The design
 * first called this `rights: "clear"`, which promised republication the legal
 * ledger never cleared and dropped the ai-train=no signal Workable and
 * Teamtailor publish (critique-api B-7). The first cut of the corrected labels
 * then dropped it again for Lever: Lever is conditional, not permissive, yet
 * its posting host declares the same ai-train=no, and /v1 serves its rows by
 * default, so a Lever row that said aiTrain null told an AI builder no ban
 * had been read when one had. Training is its own question, answered for
 * conditional systems too. The corrected labels live in
 * supabase/functions/public-api/source-terms.ts, and the site needs the same
 * answers for the data-API docs, the embed builder and the open-data page. A
 * page cannot import a Deno module, so src/config/source-terms.ts is a copy,
 * and a copy is what drifts: the site would tell a builder a system is
 * permissive while the API labels its rows conditional, or the reverse.
 *
 * A THIRD CLASS (OD16, owner 2026-11-18). USAJOBS rows answer "licensed":
 * OPM's own API terms license reuse outright, on conditions every federal row
 * carries. It is its own list (LICENSED_SOURCES) and never on the permissive
 * one, and both runtimes answer it the same.
 *
 * THE PROPERTY. The two modules are one list: the same licensed systems, the
 * same permissive systems,
 * the same training-barred systems, the same answer from sourceTermsOf for
 * every vendor key and every odd spelling, the same wording and the same
 * credit. Every name on either list is a vendor key the board really carries,
 * no row anywhere says training is allowed, and the Deno module imports
 * nothing (later lanes copy it byte for byte into other functions).
 *
 * HOW IT IS CHECKED. Both modules are imported and RUN; the comparison is by
 * value and by behaviour, never by spelling. The literal lists are also read
 * off each file's text with line-leading comments removed, so a list written
 * in prose cannot satisfy the guard. Every check is a pure function, and the
 * TEETH block hands each one a broken copy to prove it can fail.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as denoTerms from "../../supabase/functions/public-api/source-terms";
import * as siteTerms from "../config/source-terms";
import { BOARD_VENDORS } from "../../supabase/functions/_shared/board-domains";

type TermsModule = {
  LICENSED_SOURCES: readonly string[];
  PERMISSIVE_SOURCES: readonly string[];
  AI_TRAIN_BARRED: readonly string[];
  SOURCE_TERMS: readonly string[];
  SOURCE_TERMS_MEANING: Readonly<Record<string, string>>;
  ATTRIBUTION: Readonly<{ text: string; url: string; required: boolean }>;
  sourceTermsOf: (source: unknown) => { sourceTerms: string; aiTrain: boolean | null };
};
const DENO: TermsModule = denoTerms;
const SITE: TermsModule = siteTerms;

const ROOT = resolve(__dirname, "../..");
const DENO_PATH = "supabase/functions/public-api/source-terms.ts";
const SITE_PATH = "src/config/source-terms.ts";
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * Line-leading comments removed: a line that starts with a line comment, and
 * a block comment that opens a line. A marker in the middle of a line is left
 * alone, because there it is usually inside a string or a URL.
 */
function stripLeadingComments(src: string): string {
  return src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/[^\n]*$/gm, "");
}

/** The members of `export const NAME = [...] as const;`. Throws when the declaration is not a literal list. */
function listOf(code: string, name: string): string[] {
  const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const;`).exec(code);
  if (!m) throw new Error(`${name} is not declared as a literal list -- RE-ANCHOR this guard`);
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
}

/** Import statements left in code once comments are gone. */
function importsOf(code: string): string[] {
  return code.split("\n").filter((line) => /^\s*import\b/.test(line) || /^\s*export\s+[^=]*\bfrom\s+["']/.test(line));
}

/** Names on a list that are not vendor keys the board carries. */
function notVendorKeys(names: readonly string[]): string[] {
  return names.filter((n) => !(BOARD_VENDORS as readonly string[]).includes(n));
}

/** Every vendor key, and the spellings a caller or a row could hand in. */
const INPUTS: unknown[] = [
  ...BOARD_VENDORS,
  ...BOARD_VENDORS.map((v) => v.toUpperCase()),
  ...BOARD_VENDORS.map((v) => `  ${v} `),
  "", " ", null, undefined, 42, "not-a-vendor", "greenhouse.io", "ashbyhq",
];
const label = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : String(v));

/** Inputs on which two modules' sourceTermsOf answer differently. */
function disagreements(a: TermsModule, b: TermsModule, inputs: unknown[] = INPUTS): string[] {
  return inputs
    .filter((v) => JSON.stringify(a.sourceTermsOf(v)) !== JSON.stringify(b.sourceTermsOf(v)))
    .map(label);
}

/** Inputs on which a module's answer is not what its own lists say it should be. */
function selfContradictions(m: TermsModule, inputs: unknown[] = INPUTS): string[] {
  return inputs.filter((v) => {
    const key = String(v ?? "").trim().toLowerCase();
    const want = {
      sourceTerms: m.LICENSED_SOURCES.includes(key) ? "licensed" : m.PERMISSIVE_SOURCES.includes(key) ? "permissive" : "conditional",
      aiTrain: m.AI_TRAIN_BARRED.includes(key) ? false : null,
    };
    return JSON.stringify(m.sourceTermsOf(v)) !== JSON.stringify(want);
  }).map(label);
}

/** What is wrong with a module's credit: it must be required, https, on the site's host, name that host, and be frozen. */
function creditFaults(m: TermsModule): string[] {
  const a = m.ATTRIBUTION;
  const out: string[] = [];
  if (a.required !== true) out.push("not required");
  let u: URL | null = null;
  try { u = new URL(a.url); } catch { out.push("url does not parse"); }
  if (u && u.protocol !== "https:") out.push("not https");
  if (u && u.host !== "resumebooster.work") out.push(`links to ${u.host}`);
  if (u && !a.text.includes(u.host)) out.push("text does not name the host it links to");
  if (!Object.isFrozen(a)) out.push("not frozen: a caller could rewrite the shared credit");
  return out;
}

/** Inputs whose row would say training is allowed. No source has given us that. */
function trainingClaims(m: TermsModule, inputs: unknown[] = INPUTS): string[] {
  return inputs.filter((v) => m.sourceTermsOf(v).aiTrain === true).map(label);
}

const DENO_CODE = stripLeadingComments(read(DENO_PATH));
const SITE_CODE = stripLeadingComments(read(SITE_PATH));

describe("one list, two runtimes", () => {
  it("both modules name the same licensed, permissive and training-barred systems, in the same order", () => {
    expect([...SITE.LICENSED_SOURCES]).toEqual([...DENO.LICENSED_SOURCES]);
    expect([...SITE.PERMISSIVE_SOURCES]).toEqual([...DENO.PERMISSIVE_SOURCES]);
    expect([...SITE.AI_TRAIN_BARRED]).toEqual([...DENO.AI_TRAIN_BARRED]);
    expect([...SITE.SOURCE_TERMS]).toEqual([...DENO.SOURCE_TERMS]);
  });

  it("the lists are the program's: one licensed system, five permissive systems, and three systems barred from training", () => {
    // The owner-approved API4 permissive list (spec 4.10, row A1), and every
    // carried system whose content signal says ai-train=no (the legal ledger
    // of 2026-11-16: Workable, Teamtailor and Lever). Changing either is a
    // decision, so it is changed here on purpose or not at all.
    expect([...DENO.PERMISSIVE_SOURCES].sort()).toEqual(["ashby", "greenhouse", "personio", "teamtailor", "workable"]);
    expect([...DENO.AI_TRAIN_BARRED].sort()).toEqual(["lever", "teamtailor", "workable"]);
    // OD16 (owner 2026-11-18): USAJOBS, whose publisher licenses reuse outright.
    expect([...DENO.LICENSED_SOURCES]).toEqual(["usajobs"]);
    expect([...DENO.SOURCE_TERMS]).toEqual(["licensed", "permissive", "conditional"]);
    expect(DENO.LICENSED_SOURCES.filter((s) => DENO.PERMISSIVE_SOURCES.includes(s)), "licensed and permissive are two classes").toEqual([]);
  });

  it("a USAJOBS row is licensed, with no training signal read, in both runtimes", () => {
    for (const m of [DENO, SITE]) {
      expect(m.sourceTermsOf("usajobs")).toEqual({ sourceTerms: "licensed", aiTrain: null });
      expect(m.sourceTermsOf(" USAJOBS ")).toEqual({ sourceTerms: "licensed", aiTrain: null });
      expect(m.SOURCE_TERMS_MEANING.licensed).toMatch(/publisher's own terms license reuse/);
    }
  });

  it("a Lever row is conditional and barred from training, in both runtimes", () => {
    // The barred list is not a subset of the permissive one: whether our use
    // is permissive and whether a model may train on the row are separate.
    for (const m of [DENO, SITE]) {
      expect(m.sourceTermsOf("lever")).toEqual({ sourceTerms: "conditional", aiTrain: false });
      expect(m.sourceTermsOf(" Lever ")).toEqual({ sourceTerms: "conditional", aiTrain: false });
      expect(m.sourceTermsOf("workable")).toEqual({ sourceTerms: "permissive", aiTrain: false });
      expect(m.sourceTermsOf("greenhouse")).toEqual({ sourceTerms: "permissive", aiTrain: null });
    }
  });

  it("each file declares its own literal list, and the declaration read is the value the module exports", () => {
    for (const name of ["LICENSED_SOURCES", "PERMISSIVE_SOURCES", "AI_TRAIN_BARRED", "SOURCE_TERMS"] as const) {
      expect(listOf(DENO_CODE, name), `${DENO_PATH} ${name}`).toEqual([...DENO[name]]);
      expect(listOf(SITE_CODE, name), `${SITE_PATH} ${name}`).toEqual([...SITE[name]]);
    }
  });

  it("every name on either list is a vendor key the board carries, and no list repeats a name", () => {
    for (const m of [DENO, SITE]) {
      expect(notVendorKeys(m.LICENSED_SOURCES)).toEqual([]);
      expect(new Set(m.LICENSED_SOURCES).size).toBe(m.LICENSED_SOURCES.length);
      expect(notVendorKeys(m.PERMISSIVE_SOURCES)).toEqual([]);
      expect(notVendorKeys(m.AI_TRAIN_BARRED)).toEqual([]);
      expect(new Set(m.PERMISSIVE_SOURCES).size).toBe(m.PERMISSIVE_SOURCES.length);
      expect(new Set(m.AI_TRAIN_BARRED).size).toBe(m.AI_TRAIN_BARRED.length);
    }
  });

  it("sourceTermsOf answers the same in both runtimes for every vendor key and every odd spelling", () => {
    expect(disagreements(DENO, SITE)).toEqual([]);
  });

  it("each runtime's answer is what its own lists say, for every input", () => {
    expect(selfContradictions(DENO)).toEqual([]);
    expect(selfContradictions(SITE)).toEqual([]);
  });

  it("a barred system's rows say aiTrain false, and no row in either runtime says training is allowed", () => {
    for (const m of [DENO, SITE]) {
      for (const s of m.AI_TRAIN_BARRED) expect(m.sourceTermsOf(s).aiTrain, s).toBe(false);
      expect(trainingClaims(m)).toEqual([]);
    }
    // Positive control: every combination occurs on a real vendor key, so the
    // checks are not passing over one value (permissive or conditional, each
    // with a ban and without one, and licensed with none read).
    const answers = new Set(BOARD_VENDORS.map((v) => JSON.stringify(DENO.sourceTermsOf(v))));
    expect(answers.size).toBe(5);
  });

  it("the wording and the credit are one constant in both runtimes", () => {
    expect(SITE.SOURCE_TERMS_MEANING).toEqual(DENO.SOURCE_TERMS_MEANING);
    for (const t of DENO.SOURCE_TERMS) expect(DENO.SOURCE_TERMS_MEANING[t], t).toMatch(/\S/);
    expect(SITE.ATTRIBUTION).toEqual(DENO.ATTRIBUTION);
  });

  it("the credit is required, links to the site over https, names the host it links to, and is frozen", () => {
    expect(creditFaults(DENO)).toEqual([]);
    expect(creditFaults(SITE)).toEqual([]);
  });

  it("the Deno module imports nothing, and the site's copy imports nothing from the functions", () => {
    expect(importsOf(DENO_CODE)).toEqual([]);
    expect(importsOf(SITE_CODE).filter((l) => l.includes("supabase/functions"))).toEqual([]);
  });
});

describe("TEETH: each check fails when the runtimes drift", () => {
  it("notices a copy whose answer for one system drifted", () => {
    const drifted: TermsModule = {
      ...SITE,
      sourceTermsOf: (s) => (String(s).trim().toLowerCase() === "personio"
        ? { sourceTerms: "conditional", aiTrain: null }
        : SITE.sourceTermsOf(s)),
    };
    expect(disagreements(DENO, drifted)).toContain('"personio"');
    expect(selfContradictions(drifted)).toContain('"personio"');
  });

  it("notices a copy that lost the licensed class and answers USAJOBS conditional", () => {
    const twoClass: TermsModule = {
      ...SITE,
      sourceTermsOf: (s) => {
        const key = String(s ?? "").trim().toLowerCase();
        return {
          sourceTerms: SITE.PERMISSIVE_SOURCES.includes(key) ? "permissive" : "conditional",
          aiTrain: SITE.AI_TRAIN_BARRED.includes(key) ? false : null,
        };
      },
    };
    expect(disagreements(DENO, twoClass)).toContain('"usajobs"');
    expect(selfContradictions(twoClass)).toContain('"usajobs"');
  });

  it("notices a copy that forgot to normalise case and spaces", () => {
    const strict: TermsModule = {
      ...SITE,
      sourceTermsOf: (s) => ({
        sourceTerms: SITE.PERMISSIVE_SOURCES.includes(String(s)) ? "permissive" : "conditional",
        aiTrain: SITE.AI_TRAIN_BARRED.includes(String(s)) ? false : null,
      }),
    };
    expect(disagreements(DENO, strict)).toContain('"GREENHOUSE"');
    expect(disagreements(DENO, strict)).toContain('"  workable "');
  });

  it("notices a copy that bars training only on permissive systems", () => {
    const permissiveOnly: TermsModule = {
      ...SITE,
      sourceTermsOf: (s) => {
        const key = String(s ?? "").trim().toLowerCase();
        const permissive = SITE.PERMISSIVE_SOURCES.includes(key);
        return {
          sourceTerms: permissive ? "permissive" : "conditional",
          aiTrain: permissive && SITE.AI_TRAIN_BARRED.includes(key) ? false : null,
        };
      },
    };
    expect(disagreements(DENO, permissiveOnly)).toContain('"lever"');
    expect(selfContradictions(permissiveOnly)).toContain('"lever"');
  });

  it("notices a training-barred list that lost Lever", () => {
    const shorter = SITE_CODE.replace('"teamtailor", "lever"] as const;', '"teamtailor"] as const;');
    expect(shorter, "the mutation did not apply -- RE-ANCHOR this tooth").not.toBe(SITE_CODE);
    expect(listOf(shorter, "AI_TRAIN_BARRED")).not.toEqual(listOf(DENO_CODE, "AI_TRAIN_BARRED"));
    expect(listOf(shorter, "AI_TRAIN_BARRED").sort()).not.toEqual(["lever", "teamtailor", "workable"]);
  });

  it("notices a row that says training is allowed", () => {
    const permissive: TermsModule = {
      ...SITE,
      sourceTermsOf: (s) => ({ ...SITE.sourceTermsOf(s), aiTrain: SITE.sourceTermsOf(s).aiTrain ?? true }),
    };
    expect(trainingClaims(permissive)).toContain('"greenhouse"');
  });

  it("notices a literal list that lost a member", () => {
    const shorter = SITE_CODE.replace('"teamtailor", "personio"] as const;', '"teamtailor"] as const;');
    expect(shorter, "the mutation did not apply -- RE-ANCHOR this tooth").not.toBe(SITE_CODE);
    expect(listOf(shorter, "PERMISSIVE_SOURCES")).not.toEqual(listOf(DENO_CODE, "PERMISSIVE_SOURCES"));
  });

  it("does not read a list out of a comment", () => {
    const real = /export const PERMISSIVE_SOURCES = \[[^\]]*\] as const;/;
    const raw = read(SITE_PATH);
    // A commented declaration above the real one is not the one read ...
    const withProse = `// export const PERMISSIVE_SOURCES = ["lever"] as const;\n${raw}`;
    expect(listOf(stripLeadingComments(withProse), "PERMISSIVE_SOURCES")).toEqual([...SITE.PERMISSIVE_SOURCES]);
    // ... and with the real one gone, the commented one does not pass for it.
    const without = raw.replace(real, "");
    expect(without, "the mutation did not apply -- RE-ANCHOR this tooth").not.toBe(raw);
    const onlyProse = `// export const PERMISSIVE_SOURCES = ["lever"] as const;\n${without}`;
    expect(() => listOf(stripLeadingComments(onlyProse), "PERMISSIVE_SOURCES")).toThrow(/RE-ANCHOR/);
    const inBlock = `/**\n * export const PERMISSIVE_SOURCES = ["lever"] as const;\n */\n${without}`;
    expect(() => listOf(stripLeadingComments(inBlock), "PERMISSIVE_SOURCES")).toThrow(/RE-ANCHOR/);
  });

  it("keeps a URL inside a string, because only line-leading comments are removed", () => {
    expect(stripLeadingComments('  url: "https://resumebooster.work",\n').trim()).toBe('url: "https://resumebooster.work",');
  });

  it("notices a misspelt vendor key", () => {
    expect(notVendorKeys(["greenhouse", "ashbyhq"])).toEqual(["ashbyhq"]);
  });

  it("notices an import in the Deno module", () => {
    expect(importsOf(`import { x } from "../_shared/y.ts";\n${DENO_CODE}`)).toHaveLength(1);
    expect(importsOf(`export { x } from "../_shared/y.ts";\n${DENO_CODE}`)).toHaveLength(1);
  });

  it("notices a credit that is optional, plain http, elsewhere, or open to rewriting", () => {
    const loose: TermsModule = { ...SITE, ATTRIBUTION: { text: "Job data", url: "http://example.com", required: false } };
    expect(creditFaults(loose)).toEqual([
      "not required",
      "not https",
      "links to example.com",
      "text does not name the host it links to",
      "not frozen: a caller could rewrite the shared credit",
    ]);
    // And a spread copy, which is what a caller building meta would make, is not frozen.
    expect(creditFaults({ ...SITE, ATTRIBUTION: { ...SITE.ATTRIBUTION } })).toContain("not frozen: a caller could rewrite the shared credit");
  });
});
