/**
 * SEO AUDIT 2026-11-18, OFFSITE-M1: EVERY ADDRESS A SEARCH INDEX HOLDS IS ON
 * THE RESUBMISSION LIST, AND THE LIST SAYS HOW IT IS REALLY SENT.
 *
 * The readable search index still listed /privacy and the company pages
 * JSHeldLLC, transperfect and encora10 under the "Zero Ghost Jobs" headline
 * retired on 2026-10-10, and a UUID company address titled 'Roles on the
 * "0ebd29d1-..." board'. Every one of them now serves its own page. The
 * one-time IndexNow resubmission prepared for exactly these stale copies
 * (scripts/seo-seed/indexnow-historical-urls.txt, SEO-012) carried the
 * first four but not /jobs/company/0ebd29d1-d85b-444e-b36b-430da3d7bc58,
 * although seen-in-search-indexes.txt has named it since 2026-11-07: the
 * list was built from the two published-path seeds only. And its header's
 * "submission" command had no INDEXNOW_SEND=1, which since 2026-11-07 is the
 * only thing that makes a run send, so the command it called the submission
 * was a dry run.
 *
 * Judged by reading the lists the way scripts/indexnow-ping.mjs reads them
 * (urlsFromList, urlOfPath, indexNowSendAllowed), never by looking for a line.
 * Nothing here sends: the send is the owner's step.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { indexNowSendAllowed, urlOfPath, urlsFromList } from "../../scripts/indexnow-ping.mjs";

const ROOT = resolve(__dirname, "../..");
const LIST_FILE = "scripts/seo-seed/indexnow-historical-urls.txt";
const seedText = (f: string) => readFileSync(resolve(ROOT, "scripts/seo-seed", f), "utf8");
const pathsOf = (text: string) => text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const LIST = seedText("indexnow-historical-urls.txt");
const SEEN = pathsOf(seedText("seen-in-search-indexes.txt"));
const COMPANY = pathsOf(seedText("published-company-paths.txt"));
const POSTING = pathsOf(seedText("published-posting-paths.txt"));
/** The five pages the SEO report of 2026-10-24 named (SEO-012). */
const NAMED = ["/", "/privacy", "/terms", "/ghost-job-index", "/research/ats-score-benchmarks"];
/** The site addresses the readable index held under retired titles on 2026-11-18 (the audit's evidence). */
const INDEX_HELD_2026_11_18 = [
  "/", "/privacy", "/jobs/company/JSHeldLLC", "/jobs/company/transperfect", "/jobs/company/encora10",
  "/jobs/company/hpe~wd5~Jobsathpe", "/jobs/company/recruiting2~SAL1016SALO~3347ce03-ba60-4bdc-8af2-26369c80b18f",
  "/jobs/company/0ebd29d1-d85b-444e-b36b-430da3d7bc58",
];

/** Paths a list would not submit, in the order given. */
const missingFrom = (listText: string, paths: string[]) => {
  const urls = new Set(urlsFromList(listText));
  return paths.filter((p) => !urls.has(urlOfPath(p)));
};

/**
 * What is wrong with the list's header, as sentences: it must show the dry
 * run first and then a submission command that really sends (its environment
 * gives indexNowSendAllowed the go-ahead), and state its own count.
 */
function headerProblems(listText: string): string[] {
  const head = listText.split("\n").filter((l) => l.startsWith("#")).map((l) => l.replace(/^#\s*/, ""));
  const cmds = head.filter((l) => /\bnode scripts\/indexnow-ping\.mjs\b/.test(l));
  const out: string[] = [];
  for (const c of cmds) if (!c.includes(`--urls ${LIST_FILE}`)) out.push(`a command does not name ${LIST_FILE}: ${c}`);
  const dry = cmds.findIndex((c) => /--dry-run\b/.test(c));
  const send = cmds.findIndex((c) => !/--dry-run\b/.test(c));
  if (dry < 0) out.push("no dry-run command");
  if (send < 0) out.push("no submission command");
  if (dry >= 0 && send >= 0 && dry > send) out.push("the submission is listed before the dry run");
  if (send >= 0) {
    const env = Object.fromEntries([...cmds[send].split(/\bnode\b/)[0].matchAll(/\b([A-Z_]+)=(\S+)/g)].map((m) => [m[1], m[2]]));
    if (!indexNowSendAllowed(env)) out.push(`the submission command would only list, not send: ${cmds[send]}`);
  }
  const counted = head.map((l) => /^(\d+) paths\.$/.exec(l)).find(Boolean);
  const n = urlsFromList(listText).length;
  if (!counted) out.push("no count line");
  else if (Number(counted[1]) !== n) out.push(`the header says ${counted[1]} paths, the list holds ${n}`);
  return out;
}

describe("the resubmission list carries every address an index was seen to hold", () => {
  it("reads real lists: the index-held address the audit found is in seen-in-search-indexes.txt", () => {
    expect(SEEN).toContain("/jobs/company/0ebd29d1-d85b-444e-b36b-430da3d7bc58");
    expect(COMPANY.length).toBeGreaterThan(1000);
    expect(POSTING.length).toBeGreaterThan(1000);
    expect(urlsFromList(LIST).length).toBeGreaterThan(2000);
  });

  it("every path in seen-in-search-indexes.txt, and every address the index held on 2026-11-18, is on the list", () => {
    expect(missingFrom(LIST, SEEN)).toEqual([]);
    expect(missingFrom(LIST, INDEX_HELD_2026_11_18)).toEqual([]);
  });

  it("the list is exactly the five named pages, the two published seeds and the seen addresses, each once", () => {
    const want = new Set([...NAMED, ...COMPANY, ...POSTING, ...SEEN].map(urlOfPath));
    const urls = urlsFromList(LIST);
    expect(new Set(urls)).toEqual(want);
    expect(urls.length).toBe(want.size);
  });

  it("each seen company path is in published-company-paths.txt too, so the list stays the five pages plus the two seeds (seo-bake-indexnow's count)", () => {
    expect(SEEN.filter((p) => p.startsWith("/jobs/company/") && !COMPANY.includes(p))).toEqual([]);
    expect(SEEN.filter((p) => p.startsWith("/jobs/posting/") && !POSTING.includes(p))).toEqual([]);
  });

  it("the header shows the dry run first, then a submission that really sends (INDEXNOW_SEND=1), and states its count", () => {
    expect(headerProblems(LIST)).toEqual([]);
  });

  it("teeth: a seen address dropped from the list, a send command without the go-ahead, a send before the dry run, and a stale count are each caught", () => {
    const uuid = "/jobs/company/0ebd29d1-d85b-444e-b36b-430da3d7bc58";
    const dropped = LIST.replace(`${uuid}\n`, "");
    expect(dropped).not.toBe(LIST);
    expect(missingFrom(dropped, SEEN)).toEqual([uuid]);
    const n = urlsFromList(LIST).length;
    const noGo = LIST.replace(/INDEXNOW_SEND=1 node scripts\/indexnow-ping\.mjs/, "node scripts/indexnow-ping.mjs");
    expect(noGo).not.toBe(LIST);
    expect(headerProblems(noGo)).toEqual([expect.stringMatching(/^the submission command would only list, not send: /)]);
    const lines = LIST.split("\n");
    const dryAt = lines.findIndex((l) => l.startsWith("#") && /--dry-run/.test(l));
    const sendAt = lines.findIndex((l) => l.startsWith("#") && /INDEXNOW_SEND=1 node/.test(l));
    expect(dryAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(dryAt);
    const swapped = [...lines];
    [swapped[dryAt], swapped[sendAt]] = [lines[sendAt], lines[dryAt]];
    expect(headerProblems(swapped.join("\n"))).toEqual(["the submission is listed before the dry run"]);
    expect(headerProblems(LIST.replace(`# ${n} paths.`, `# ${n - 1} paths.`))).toEqual([`the header says ${n - 1} paths, the list holds ${n}`]);
  });
});
