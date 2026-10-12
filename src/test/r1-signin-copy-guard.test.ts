// @vitest-environment node
/**
 * R1: NO COPY NAMES A SIGN-IN METHOD WHOSE SWITCH IS OFF, AND NONE SAYS "SENT".
 *
 * Copy goes false when the thing it describes is not live (the "no
 * subscriptions" incident): a page telling people to "sign in with Google"
 * while no Google button exists is a dead end for a locked-out subscriber.
 * This guard reads every source file under src/ (comments stripped, tests and
 * the changelog's history excluded) and the English locale values, and fails
 * on any string naming a method whose switch in src/config/auth-providers.ts
 * is off, unless it lives in the control that switch gates: Google only in
 * ProviderButtons, the code only in CodeEntry, recovery only in ResetFlow (and
 * the recovery copy of CodeEntry), and their own key namespaces in
 * src/i18n/auth. The render tests (r1-signin-auth, r1-signin-flags-on) prove
 * those controls render only behind their switches. The magic link, Apple and
 * Microsoft are off for good, so they may appear nowhere.
 *
 * Strings that already named an off method in files this round does not own
 * are listed with their owner (a ratchet: each must still be present, so the
 * list shrinks as they are fixed; a new one fails).
 *
 * Also held here: no auth surface says a mail was "sent"; the nine auth
 * locale files carry the same keys and placeholders, and English equals the
 * default each call site passes; the support address is the footer's.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { APPLE_SIGN_IN_LIVE, AUTH_SUPPORT_EMAIL, CODE_SIGN_IN_LIVE, GOOGLE_SIGN_IN_LIVE, RECOVERY_LIVE } from "@/config/auth-providers";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const SOURCES = walk(resolve(ROOT, "src"))
  .map((p) => relative(ROOT, p))
  .filter((p) => /\.(ts|tsx)$/.test(p) && !p.startsWith("src/test/") && !/\.test\.tsx?$/.test(p) && !p.startsWith("src/i18n/changelog/"));

function flat(o: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, flat(v, key));
    else if (typeof v === "string") out[key] = v;
  }
  return out;
}

type Method = { live: boolean; re: RegExp; files: string[]; keys: RegExp | null };
const METHODS: Record<string, Method> = {
  google: { live: GOOGLE_SIGN_IN_LIVE, re: /\bwith google\b/i, files: ["src/components/auth/ProviderButtons.tsx"], keys: /^auth\.google\./ },
  apple: { live: APPLE_SIGN_IN_LIVE, re: /\bwith apple\b/i, files: [], keys: null },
  microsoft: { live: false, re: /\bwith microsoft\b/i, files: [], keys: null },
  // A space or hyphen: "magiclink" alone is the auth server's OTP type name, not copy.
  "magic link": { live: false, re: /\bmagic[ -]link\b|sign-in link|login link/i, files: [], keys: null },
  code: { live: CODE_SIGN_IN_LIVE, re: /sign-in code|one-time code|login code/i, files: ["src/components/auth/CodeEntry.tsx"], keys: /^auth\.code\./ },
  recovery: { live: RECOVERY_LIVE, re: /forgot (your )?password|reset (your )?password|password reset|reset code/i, files: ["src/components/auth/ResetFlow.tsx", "src/components/auth/CodeEntry.tsx"], keys: /^auth\.(reset\.|forgot$)/ },
};

/** Off-method strings in files R1 does not own, with the round that owns the fix. */
const KNOWN: { method: string; where: string; text: string; owner: string }[] = [
  { method: "google", where: "src/components/ProSubscriptionCard.tsx", text: "Sign in with Google using that address", owner: "CP-H (Account; proPlan.linkPending)" },
  { method: "google", where: "src/i18n/locales/en.json#proPlan.linkPending", text: "Sign in with Google using that address", owner: "CP-H (company profiles owns the locale files)" },
  { method: "google", where: "src/i18n/locales/en-GB.json#proPlan.linkPending", text: "Sign in with Google using that address", owner: "CP-H (company profiles owns the locale files)" },
];

describe("no copy names a sign-in method whose switch is off", () => {
  for (const [name, m] of Object.entries(METHODS)) {
    it(`${name} (${m.live ? "live" : "off"})`, () => {
      if (m.live) return;
      const hits: string[] = [];
      for (const rel of SOURCES) {
        if (m.files.includes(rel)) continue;
        const c = codeOf(read(rel));
        const at = m.re.exec(c);
        if (at) hits.push(`${rel}: …${c.slice(Math.max(0, at.index - 40), at.index + 40).replace(/\s+/g, " ")}…`);
      }
      for (const loc of ["en", "en-GB"]) {
        for (const [key, value] of Object.entries(flat(JSON.parse(read(`src/i18n/locales/${loc}.json`))))) {
          if (m.re.test(value)) hits.push(`src/i18n/locales/${loc}.json#${key}: ${value}`);
        }
        for (const [key, value] of Object.entries(flat(JSON.parse(read(`src/i18n/auth/${loc}.json`))))) {
          if (m.re.test(value) && !(m.keys && m.keys.test(key))) hits.push(`src/i18n/auth/${loc}.json#${key}: ${value}`);
        }
      }
      const known = KNOWN.filter((k) => k.method === name);
      const unexplained = hits.filter((hit) => !known.some((k) => hit.startsWith(k.where) && hit.includes(k.text)));
      expect(unexplained, `copy names ${name}, whose switch is off, outside its gated control`).toEqual([]);
      for (const k of known) expect(hits.some((hit) => hit.startsWith(k.where) && hit.includes(k.text)), `${k.where} no longer names ${name}: remove it from KNOWN`).toBe(true);
    });
  }

  it("the guard reads what it claims to (positive control)", () => {
    expect(SOURCES).toEqual(expect.arrayContaining(["src/pages/Auth.tsx", "src/components/auth/ProviderButtons.tsx", "src/pages/Account.tsx"]));
    expect(METHODS.google.re.test(codeOf(read("src/components/auth/ProviderButtons.tsx")))).toBe(true);
    expect(METHODS.recovery.re.test(codeOf(read("src/components/auth/ResetFlow.tsx")))).toBe(true);
    expect(METHODS.code.re.test(codeOf(read("src/components/auth/CodeEntry.tsx")))).toBe(true);
  });

  it("each gated control returns nothing while its switch is off", () => {
    expect(codeOf(read("src/components/auth/ProviderButtons.tsx"))).toMatch(/if \(!GOOGLE_SIGN_IN_LIVE\) return null;/);
    expect(codeOf(read("src/components/auth/ResetFlow.tsx"))).toMatch(/if \(!RECOVERY_LIVE\) return null;/);
    const auth = codeOf(read("src/pages/Auth.tsx"));
    expect(auth).toMatch(/if \(raw === "reset"\) return RECOVERY_LIVE \? "reset" : "continue";/);
    expect(auth).toMatch(/useState\(!CODE_SIGN_IN_LIVE\)/);
    expect(auth).toMatch(/\{CODE_SIGN_IN_LIVE && \(/);
  });
});

describe("no auth surface says a mail was sent", () => {
  const files = ["src/pages/Auth.tsx", "src/contexts/AuthContext.tsx", ...readdirSync(resolve(ROOT, "src/components/auth")).map((f) => `src/components/auth/${f}`)];
  it.each(files)("%s", (rel) => {
    const c = codeOf(read(rel));
    const strings = [...c.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((x) => x[1]);
    expect(strings.filter((s) => /\bsent\b/i.test(s))).toEqual([]);
    expect(c).not.toMatch(/Magic link sent/);
  });
  it.each(["en", "en-GB"])("src/i18n/auth/%s.json", (loc) => {
    expect(Object.values(flat(JSON.parse(read(`src/i18n/auth/${loc}.json`)))).filter((v) => /\bsent\b/i.test(v))).toEqual([]);
  });
  it("the code and reset copy says 'on its way' only if the address can sign in", () => {
    const en = flat(JSON.parse(read("src/i18n/auth/en.json")));
    expect(en["auth.code.onItsWay"]).toMatch(/^If this address can sign in, a code is on its way\./);
    expect(en["auth.reset.onItsWay"]).toMatch(/^If an account exists for this address, a reset code is on its way\./);
  });
});

describe("the auth strings in nine languages", () => {
  const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
  const en = flat(JSON.parse(read("src/i18n/auth/en.json")));
  const placeholders = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();

  it("every locale file exists and the loader names it", () => {
    const loader = codeOf(read("src/i18n/auth/load.ts"));
    for (const loc of LOCALES) {
      expect(readdirSync(resolve(ROOT, "src/i18n/auth"))).toContain(`${loc}.json`);
      expect(loader).toContain(`import("./${loc}.json")`);
    }
  });

  it.each(LOCALES)("%s has exactly the English keys and the same placeholders", (loc) => {
    const t = flat(JSON.parse(read(`src/i18n/auth/${loc}.json`)));
    expect(Object.keys(t).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(placeholders(t[k]), `${loc} ${k}`).toEqual(placeholders(en[k]));
    for (const v of Object.values(t)) expect(v.trim().length).toBeGreaterThan(0);
  });

  it("English is the default each call site passes, and every key a call site names exists", () => {
    const files = ["src/pages/Auth.tsx", "src/contexts/AuthContext.tsx", ...readdirSync(resolve(ROOT, "src/components/auth")).map((f) => `src/components/auth/${f}`)];
    const used = new Map<string, string>();
    for (const rel of files) {
      for (const m of read(rel).matchAll(/\b(?:t|tr)\(\s*"(auth\.[A-Za-z0-9_.]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/g)) used.set(m[1], JSON.parse(`"${m[2]}"`));
    }
    expect(used.size).toBeGreaterThan(50);
    for (const [k, v] of used) expect(en[k], k).toBe(v);
    expect(Object.keys(en).filter((k) => !used.has(k)), "keys no call site uses").toEqual([]);
  });

  it("names no AI host but the three seekers use (Claude, ChatGPT, Claude Code)", () => {
    for (const loc of LOCALES) expect(read(`src/i18n/auth/${loc}.json`)).not.toMatch(/Gemini|Copilot|Cursor|Perplexity|Windsurf|Codex/);
  });
});

describe("the support address on the sign-in page", () => {
  it("is the one the footer shows", () => {
    expect(read("src/components/Footer.tsx")).toContain(`mailto:${AUTH_SUPPORT_EMAIL}`);
  });
});
