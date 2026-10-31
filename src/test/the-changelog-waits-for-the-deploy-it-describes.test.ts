// @vitest-environment node
/**
 * THE CHANGELOG WAITS FOR THE DEPLOY IT DESCRIBES (the final recheck of
 * land/all, 2026-10-31).
 *
 * land/all carried the one deploy's seventeen entries, dated 2026-10-31, "the
 * day land/all took them". Merging into main publishes the frontend by itself,
 * so they would have gone live with the merge, before the functions they
 * describe "from this update", and with a date the merge may already have
 * passed. The owner's rule (2026-10-10): entries follow a verified deploy,
 * dated the day its change went live. So they wait in
 * docs/changelog-pending/one-deploy.json, and the changelog step applies them
 * with scripts/apply-pending-changelog.mjs once the deploy has verified.
 * Proved here: the pending file is complete and dates nothing, the tree does
 * not carry it yet, and the applier inserts exactly what the earlier landing
 * did (purely additive, the given date, the file then removed) and refuses
 * what it must.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyPending, LOCALES } from "../../scripts/apply-pending-changelog.mjs";

const ROOT = resolve(__dirname, "../..");
const PENDING_FILE = resolve(ROOT, "docs/changelog-pending/one-deploy.json");
const read = (p: string) => { try { return readFileSync(resolve(ROOT, p), "utf8"); } catch { return null; } };
type Entry = { key: string; category: string } & Record<string, { title: string; description: string }>;
const pending = existsSync(PENDING_FILE) ? (JSON.parse(readFileSync(PENDING_FILE, "utf8")) as { date: string; entries: Entry[] }) : null;

describe.skipIf(!pending)("the one deploy's entries wait in docs/changelog-pending", () => {
  const p = pending!;

  it("seventeen entries in nine languages, the home page first, dated nothing", () => {
    expect(p.date).toBe("DATE_OF_DEPLOY");
    expect(p.entries).toHaveLength(17);
    expect(p.entries[0].key).toBe("theHomePageIsTheJobSearch");
    for (const e of p.entries) for (const lng of LOCALES) {
      expect(e[lng]?.title?.length, `${e.key} ${lng}`).toBeGreaterThan(4);
      expect(e[lng]?.description?.length, `${e.key} ${lng}`).toBeGreaterThan(20);
    }
  });

  it("no entry refuses a buyer for where they are, promises a sale soon, or carries the placeholder", () => {
    for (const e of p.entries) for (const lng of LOCALES) {
      const t = `${e[lng].title} ${e[lng].description}`;
      expect(t, `${e.key} ${lng}`).not.toMatch(/DATE_OF_DEPLOY|open soon|not registered for VAT|turns away buyers it places in the EU/i);
    }
    expect(p.entries.find((e) => e.key === "aPricingPageThatStartsWithWhatIsFree")!.en.description).not.toMatch(/the EU, the EEA, the UK or India/);
  });

  it("the tree does not carry them before the deploy verifies", () => {
    const ts = read("src/data/changelog.ts")!;
    for (const e of p.entries) {
      expect(ts, e.key).not.toMatch(new RegExp(`id: "${e.key}"`));
      for (const lng of LOCALES) expect(Object.keys(JSON.parse(read(`src/i18n/changelog/${lng}.json`)!).changelogEntries), `${lng} ${e.key}`).not.toContain(e.key);
    }
  });

  it("applied with a date, each file only gains: seventeen lines at the top of changelog.ts and seventeen keys at the end of each shard", () => {
    const out = applyPending({ pending: p, date: "2026-11-02", read });
    expect(out.error).toBeUndefined();
    const ts = out.files!["src/data/changelog.ts"];
    const before = read("src/data/changelog.ts")!;
    const head = "export const changelog: ChangelogEntry[] = [\n";
    const added = ts.slice(ts.indexOf(head) + head.length).split("\n").slice(0, 17);
    expect(added.map((l) => /id: "([A-Za-z0-9]+)", date: "2026-11-02"/.exec(l)?.[1])).toEqual(p.entries.map((e) => e.key));
    expect(ts.replace(added.join("\n") + "\n", "")).toBe(before);
    for (const lng of LOCALES) {
      const was = JSON.parse(read(`src/i18n/changelog/${lng}.json`)!).changelogEntries;
      const now = JSON.parse(out.files![`src/i18n/changelog/${lng}.json`]).changelogEntries;
      const keys = Object.keys(now);
      expect(keys.slice(0, Object.keys(was).length)).toEqual(Object.keys(was));
      expect(keys.slice(Object.keys(was).length)).toEqual(p.entries.map((e) => e.key));
      for (const k of Object.keys(was)) expect(now[k]).toEqual(was[k]);
      expect(out.files![`src/i18n/changelog/${lng}.json`].endsWith("\n")).toBe(read(`src/i18n/changelog/${lng}.json`)!.endsWith("\n"));
    }
  });

  it("refuses a bad date, a key already present, missing text, an unknown tag and the placeholder in a text", () => {
    expect(applyPending({ pending: p, date: "DATE_OF_DEPLOY", read }).error).toMatch(/is not YYYY-MM-DD/);
    const twice = applyPending({ pending: p, date: "2026-11-02", read });
    const again = applyPending({ pending: p, date: "2026-11-02", read: (f: string) => twice.files![f] ?? read(f) });
    expect(again.error).toMatch(/changelog\.ts already has theHomePageIsTheJobSearch/);
    const noHi = { ...p, entries: p.entries.map((e, i) => (i === 3 ? { ...e, hi: undefined } : e)) } as unknown as typeof p;
    expect(applyPending({ pending: noHi, date: "2026-11-02", read }).error).toMatch(/^hi text missing or too short for /);
    const badTag = { ...p, entries: p.entries.map((e, i) => (i === 0 ? { ...e, category: "new, shiny" } : e)) };
    expect(applyPending({ pending: badTag, date: "2026-11-02", read }).error).toMatch(/bad tag "shiny"/);
    const ph = { ...p, entries: p.entries.map((e, i) => (i === 1 ? { ...e, de: { ...e.de, description: `${e.de.description} DATE_OF_DEPLOY` } } : e)) };
    expect(applyPending({ pending: ph, date: "2026-11-02", read }).error).toMatch(/de text of aPricingPageThatStartsWithWhatIsFree carries the placeholder/);
  });
});

describe("the changelog step is the script the deploy notes name", () => {
  it("the deploy notes apply the pending file after the record, never in the merge", () => {
    const notes = read("docs/job-board-deploy-notes.md")!;
    expect(notes).toMatch(/node scripts\/apply-pending-changelog\.mjs docs\/changelog-pending\/one-deploy\.json <the day the functions went live>/);
    expect(notes).toMatch(/Merging land\/all into main publishes the frontend by itself/);
  });
});
