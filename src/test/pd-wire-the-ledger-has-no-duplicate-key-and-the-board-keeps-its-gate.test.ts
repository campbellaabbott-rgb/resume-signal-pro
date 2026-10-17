// @vitest-environment node
/**
 * THE DEPLOY LEDGER HAS NO DUPLICATE KEY, AND THE BOARD KEEPS ITS GATE (S12-184).
 *
 * Two merge hazards the S12 sweep named on the profiles branch:
 *
 *   1. docs/deploy-ledger.json is read with JSON.parse, which keeps the LAST of
 *      two equal keys and says nothing. A merge that left two "holdUntilVerified"
 *      keys in the file emptied the 20261012111000 hold: the every-minute perk
 *      sweep cron would have been armed before its function was deployed. This
 *      guard reads the file as text and fails on a key repeated inside one
 *      object, at any depth, naming the path.
 *
 *   2. Whichever side of src/pages/Jobs.tsx wins a merge must keep the S11-020
 *      gate (a token the board does not carry is the "uncarried" page, never a
 *      zero page or a claim) and the intel blocks (the company readers, the
 *      claim CTA, the employer context in the pane). Each is pinned by the
 *      line that does the work, and a planted removal is shown failing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * Every key repeated inside one JSON object, as dotted paths, in document
 * order. Arrays carry no keys; an object inside an array has its own keys.
 */
export function duplicateJsonKeys(text: string): string[] {
  const dups: string[] = [];
  const stack: Array<Set<string> | null> = [];
  const path: string[] = [];
  const parentIsObject = () => stack.length > 0 && stack[stack.length - 1] !== null;
  const valueEnded = () => { if (parentIsObject()) path.pop(); };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const str = JSON.parse(text.slice(i, j + 1)) as string;
      i = j + 1;
      let k = i;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (parentIsObject() && text[k] === ":") {
        const keys = stack[stack.length - 1]!;
        if (keys.has(str)) dups.push([...path, str].join("."));
        keys.add(str);
        path.push(str);
        i = k + 1;
        continue;
      }
      valueEnded();
      continue;
    }
    if (c === "{") { stack.push(new Set()); i++; continue; }
    if (c === "[") { stack.push(null); i++; continue; }
    if (c === "}" || c === "]") { stack.pop(); i++; valueEnded(); continue; }
    if (c === "," || c === ":" || /\s/.test(c)) { i++; continue; }
    let j = i;
    while (j < text.length && /[-+0-9.eEtrufalsn]/.test(text[j])) j++;
    i = j > i ? j : i + 1;
    valueEnded();
  }
  return dups;
}

describe("the deploy ledger has no duplicate key", () => {
  const text = read("docs/deploy-ledger.json");

  it("parses, and no object in it repeats a key", () => {
    expect(() => JSON.parse(text)).not.toThrow();
    expect(duplicateJsonKeys(text)).toEqual([]);
  });

  it("the ledger still carries the holds a duplicate would have emptied", () => {
    const ledger = JSON.parse(text) as { holdUntilVerified?: unknown; reservations?: unknown; verifiedDeploys?: unknown };
    expect(Array.isArray(ledger.holdUntilVerified)).toBe(true);
    expect(typeof ledger.reservations).toBe("object");
    expect(Array.isArray(ledger.verifiedDeploys)).toBe(true);
  });

  it("TEETH: a repeated top-level key, a repeated nested key and a repeated key in an array's object are each caught by path", () => {
    expect(duplicateJsonKeys('{"holdUntilVerified": [{"stamp": "20261012111000"}], "neverApply": [], "holdUntilVerified": []}')).toEqual(["holdUntilVerified"]);
    expect(duplicateJsonKeys('{"reservations": {"wave2": {"migrations": "a"}, "wave3": {}, "wave2": {}}}')).toEqual(["reservations.wave2"]);
    expect(duplicateJsonKeys('{"verifiedDeploys": [{"commit": "a", "date": "d", "commit": "b"}]}')).toEqual(["verifiedDeploys.commit"]);
    // Equal keys in DIFFERENT objects are not duplicates, and a key inside a string value is not a key.
    expect(duplicateJsonKeys('{"a": [{"stamp": 1}, {"stamp": 2}], "b": {"stamp": "\\"stamp\\": 3"}, "c": "stamp"}')).toEqual([]);
    // The planted duplicate on the real file is caught, not swallowed.
    const planted = text.replace(/"holdUntilVerified":/, '"holdUntilVerified": [],\n  "holdUntilVerified":');
    expect(planted, "the teeth mutation did not apply: RE-ANCHOR it").not.toBe(text);
    expect(duplicateJsonKeys(planted)).toEqual(["holdUntilVerified"]);
  });
});

describe("whichever side of Jobs.tsx wins, the board keeps the S11-020 gate and the intel blocks", () => {
  const board = codeOf(read("src/pages/Jobs.tsx"));
  const header = codeOf(read("src/components/jobs/company/CompanyHeader.tsx"));
  const lander = codeOf(read("src/components/jobs/company/CompanyLander.tsx"));

  const GATE = [
    // S11-020: the list reply names the tokens it does not carry, and the page is the "uncarried" variant for one.
    /Array\.isArray\(data\?\.unknownCompanies\) && data!\.unknownCompanies!\.includes\(landerCompany\)/,
    /carried: landerUncarried \? false/,
  ];
  const INTEL = [
    /<CompanyLanderHeader\b/,
    /<CompanyLanderRail\b/,
    /<CompanyLanderAccordion\b/,
    /useCompanyProfile\(landerCompany \?\? null, landerModel \?\? NO_LANDER_MODEL\)/,
    /employerContext: <EmployerContext\b/,
    /record: landerRecordInput,/,
  ];

  it("the board carries the gate and mounts every intel block", () => {
    for (const re of GATE) expect(board, `S11-020 gate: ${re}`).toMatch(re);
    for (const re of INTEL) expect(board, `intel block: ${re}`).toMatch(re);
    // The claim CTA lives in the header the board mounts, and the lander asks the readers.
    expect(header).toMatch(/<CompanyClaim\b/);
    expect(lander).toMatch(/useCompanyIntel\(|useEmployerPerks\(|useSimilarCompanies\(/);
  });

  it("the model refuses a claim, a zero page and the employer facts on an uncarried token", () => {
    const model = codeOf(read("src/lib/company/lander-model.ts"));
    expect(model).toMatch(/if \(input\.carried === false && \(empty \|\| !answered\) && !input\.collision\) return "uncarried";/);
    expect(model).toMatch(/claim: employer && variant !== "uncarried",/);
    expect(model).toMatch(/variant === "uncarried" \|\| variant === "zero" \? null : chooseOpenRoles\(input\)/);
  });

  it("TEETH: a merge that drops the gate line, or an intel block, fails here", () => {
    const noGate = board.replace("data!.unknownCompanies!.includes(landerCompany)", "false");
    expect(noGate, "the teeth mutation did not apply: RE-ANCHOR it").not.toBe(board);
    expect(GATE.some((re) => !re.test(noGate))).toBe(true);
    const noIntel = board.replace(/<CompanyLanderRail\b/, "<div");
    expect(noIntel).not.toBe(board);
    expect(INTEL.some((re) => !re.test(noIntel))).toBe(true);
  });
});
