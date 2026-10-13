// @vitest-environment node
/**
 * THE ACCOUNT HOME SPEAKS EVERY WORD THROUGH THE TRANSLATOR (S12-137, plan
 * CP-045 / CP-H).
 *
 * WHAT WAS WRONG. /account's matching-résumé card, the tracker's version
 * picker, fit check and outcome tables, and the Shortlist cross-link were
 * English text written straight into the JSX, so a German or Hindi visitor
 * read them in English; the irreversible controls had been the same.
 *
 * WHAT HOLDS NOW, read with the TypeScript parser (so a comment can neither
 * hide nor fake a finding): in the account home and every card it renders
 * from src/components/account that this round owns, no JSX text node and no
 * placeholder, aria-label or title attribute holds a written word. Every word
 * reaches the page through t(key, English default), so the one translator
 * adds the nine locales after integration.
 *
 * The parse is proven to see: a fixture with one bare word is caught.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";

const FILES = [
  "src/pages/Account.tsx",
  "src/components/account/AccountNav.tsx",
  "src/components/account/ConnectedAIsCard.tsx",
  "src/components/account/CreditsAndPurchases.tsx",
  "src/components/account/DataPrivacyCard.tsx",
  "src/components/account/OrdersList.tsx",
  "src/components/account/SecurityCard.tsx",
];

const WORDY = /[A-Za-z]{2,}/;
const ATTRS = new Set(["placeholder", "aria-label", "title", "alt"]);

/** Every written word the JSX carries outside an expression: [line, text]. */
export function bareWords(source: string, name = "x.tsx"): Array<[number, string]> {
  const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Array<[number, string]> = [];
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const walk = (n: ts.Node) => {
    if (ts.isJsxText(n)) {
      const text = n.getText(sf).replace(/\s+/g, " ").trim();
      if (WORDY.test(text)) out.push([at(n), text]);
    } else if (ts.isJsxAttribute(n) && ATTRS.has(n.name.getText(sf)) && n.initializer && ts.isStringLiteral(n.initializer)) {
      if (WORDY.test(n.initializer.text)) out.push([at(n), `${n.name.getText(sf)}="${n.initializer.text}"`]);
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

describe("S12-137: no written word bypasses the translator on the account home", () => {
  it("the parse sees a bare word and a bare attribute, and passes a translated one", () => {
    const fixture = `export const A = ({ t }) => (<div><p>Delete my account</p><input placeholder="New address" /><b>{t("k", "Fine")}</b><i>×</i></div>);`;
    expect(bareWords(fixture).map(([, s]) => s)).toEqual(["Delete my account", 'placeholder="New address"']);
  });

  for (const f of FILES) {
    it(`${f} carries no bare word`, () => {
      const found = bareWords(readFileSync(f, "utf8"), f);
      expect(found, found.map(([l, s]) => `${f}:${l} ${s}`).join("\n")).toEqual([]);
    });
  }
});
