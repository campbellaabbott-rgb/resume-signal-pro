import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WHAT WAS WRONG (2026-11-15): scripts/verify-deploy.sh sets five shell
 * variables every section reads (K, the publishable key; RB; B, the project
 * URL; SITE; UA), then sources each scripts/verify-deploy.d/*.sh into the same
 * shell. The changelog section for 15 November looped with `read -r K M` and
 * `for K in ...`, so from that section on every probe sent a changelog key
 * name as its API key. Two whole verifier runs printed 118 FAILs reading
 * "Invalid API key" (the account guard "not applied", the sign-in page "ahead
 * of its guard", every company card unreadable) while the database answered
 * the real key correctly. A section that reuses a shared name turns every later
 * section's verdict into noise, so no section may assign, read into or loop
 * over one of them.
 *
 * Passing the same value to a child (`K="$K" node -e ...`) is allowed, and so
 * is anything inside single quotes (the node -e programs, which declare their
 * own `const K=process.env.K`).
 */

const ROOT = resolve(__dirname, "../..");
const SHARED = ["K", "RB", "B", "SITE", "UA"];

/** The shell code of a script with single-quoted text, comments and heredoc bodies blanked. */
function shellCode(src: string): string[] {
  const out: string[] = [];
  const lines = src.split("\n");
  let quote: "'" | '"' | null = null;
  let heredoc: string | null = null;
  let dq = "";
  for (const line of lines) {
    if (heredoc !== null) {
      if (line.replace(/^\t+/, "") === heredoc) heredoc = null;
      out.push("");
      continue;
    }
    let code = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote === "'") {
        if (c === "'") { quote = null; code += "'"; }
        continue;
      }
      if (quote === '"') {
        if (c === "\\") { dq += c + (line[i + 1] ?? ""); i++; continue; }
        if (c === '"') {
          quote = null;
          // Only "$NAME" survives (the value a child is passed); other text is blanked.
          code += (/^\$[A-Z]+$/.test(dq) ? dq : "") + '"';
          dq = "";
          continue;
        }
        dq += c;
        continue;
      }
      if (c === "\\") { code += c + (line[i + 1] ?? ""); i++; continue; }
      if (c === "'") { quote = "'"; code += "'"; continue; }
      if (c === '"') { quote = '"'; code += c; continue; }
      if (c === "#" && (i === 0 || /[\s;(]/.test(line[i - 1]))) break;
      code += c;
    }
    const hd = quote === null && /<</.test(code) ? /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(line) : null;
    if (hd) heredoc = hd[1];
    out.push(code);
  }
  return out;
}

function findReuse(src: string, file: string, startAt = 0): string[] {
  const found: string[] = [];
  shellCode(src).forEach((code, i) => {
    if (i < startAt) return;
    for (const n of SHARED) {
      if (new RegExp(`\\bfor\\s+${n}\\s+in\\b`).test(code)) found.push(`${file}:${i + 1} loops over ${n}`);
      const rd = /(?:^|[\s;&|(])read\b([^;|&]*)/.exec(code);
      if (rd && new RegExp(`(^|\\s)${n}(\\s|$)`).test(rd[1])) found.push(`${file}:${i + 1} reads into ${n}`);
      const as = new RegExp(`(?:^|[\\s;&|(])${n}=("[^"]*"|\\S*)`, "g");
      let m: RegExpExecArray | null;
      while ((m = as.exec(code))) {
        if (m[1] !== `"$${n}"`) found.push(`${file}:${i + 1} assigns ${n}=${m[1].slice(0, 30)}`);
      }
    }
  });
  return found;
}

const reuses = (file: string, startAt = 0) => findReuse(readFileSync(resolve(ROOT, file), "utf8"), file, startAt);

const SECTIONS = readdirSync(resolve(ROOT, "scripts/verify-deploy.d"))
  .filter((f) => f.endsWith(".sh"))
  .map((f) => `scripts/verify-deploy.d/${f}`);

describe("no verify section takes a name every later section reads", () => {
  it("the five shared names are the ones verify-deploy.sh sets before any section runs", () => {
    const head = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8").split("\n").slice(0, 45).join("\n");
    for (const n of SHARED) expect(head, `${n} is no longer set at the top`).toMatch(new RegExp(`^${n}=`, "m"));
    expect(readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8")).toMatch(/for f in scripts\/verify-deploy\.d\/\*\.sh; do \[ -f "\$f" \] && \. "\$f"; done/);
  });

  it("the scanner catches each way a section could take one (a positive control)", () => {
    const src = [
      "while IFS='|' read -r K M; do :; done",
      "for K in a b; do :; done",
      "B=other",
      "echo \"it's K=fine\"",
      "node -e 'const K=process.env.K; for (const SITE of x) {}'",
      "K=\"$K\" B=\"$B\" node -e ''",
      "# K=commented",
      "cat <<'DATA'",
      "UA=inside-a-heredoc",
      "DATA",
      "SITE=\"https://elsewhere\"",
    ].join("\n");
    expect(findReuse(src, "control")).toEqual([
      "control:1 reads into K",
      "control:2 loops over K",
      "control:3 assigns B=other",
      'control:11 assigns SITE=""',
    ]);
  });

  for (const file of SECTIONS) {
    it(`${file.split("/").pop()} never assigns, reads into or loops over K, RB, B, SITE or UA`, () => {
      expect(reuses(file)).toEqual([]);
    });
  }

  it("verify-deploy.sh itself takes none of them after it sets them", () => {
    const lines = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8").split("\n");
    const after = lines.findIndex((l) => /^R\(\) \{/.test(l));
    expect(after).toBeGreaterThan(0);
    expect(reuses("scripts/verify-deploy.sh", after)).toEqual([]);
  });
});
