import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import i18next from "i18next";
import { codeOf } from "./helpers/strip-comments";
import {
  isPostingLive,
  postingEmployer,
  postingJsonLd,
  postingPageDescription,
  postingPagePath,
  postingPageTitle,
  postingPathParts,
  type PostingRow,
} from "@/components/jobs/posting-page";
import { boardName, employerName, isCodeShapedName, possessive } from "@/lib/company-display";
import { bakeLanders, landerRobots, postingRowEligible, postingStubEntry, postingStubPage } from "../../scripts/prerender-pages.mjs";

/**
 * WHAT WAS WRONG, measured 2026-10-08 with a Googlebot user-agent (SEO report,
 * F1): 292 of the 399 posting pages and 169 of the 487 company pages named the
 * employer by its Workday tenant code, capitalised. Morgan Stanley's postings
 * told Google for Jobs that "Ms" was hiring; the RMIT posting's JSON-LD said
 * `"hiringOrganization":{"name":"Rmit"}` over a description that opens "RMIT
 * University is seeking". The database already held the real names for some
 * of these (company_name_overrides), but the page builder printed the row's
 * stored name, and eight company pages printed "Domino's's".
 *
 * These run the functions the bake and the React posting page both call, on
 * the row the live board returns for ms~wd5~external (company "Ms").
 */

const NOW = new Date("2026-10-09T12:00:00Z");
const row = (over: Partial<PostingRow> = {}): PostingRow => ({
  id: "workday:ms~wd5~external:JR014245",
  title: "Performance Analyst",
  company: "Ms",
  token: "ms~wd5~external",
  location: "Tempe, Arizona",
  country: "US",
  workMode: null,
  postedAt: "2026-10-05T00:00:00+00:00",
  missingSince: null,
  ...over,
});
const DESC = "The role ".repeat(40);

describe("a posting names the employer by the name it uses", () => {
  it("hiringOrganization and the identifier name Morgan Stanley, not its tenant code", () => {
    const ld = postingJsonLd(row(), DESC, { site: "https://resumebooster.work", now: NOW }) as Record<string, Record<string, unknown>>;
    expect(ld).not.toBeNull();
    expect(ld.hiringOrganization.name).toBe("Morgan Stanley");
    expect(ld.identifier.name).toBe("Morgan Stanley");
  });

  it("the page title and the meta description name it too", () => {
    expect(postingPageTitle(row())).toContain("Morgan Stanley");
    expect(postingPageTitle(row())).not.toMatch(/\bMs\b/);
    expect(postingPageDescription(row())).toContain("at Morgan Stanley");
    expect(postingPageDescription(row())).not.toMatch(/\bMs\b/);
  });

  it("an id alone is enough: the token comes out of the board id when the row carries none", () => {
    expect(postingEmployer({ id: "workday:rmit~wd3~RMIT_Careers:JR1", company: "Rmit", token: null })).toBe("RMIT University");
  });

  it("a name the overrides do not cover is printed as stored", () => {
    expect(postingEmployer(row({ id: "greenhouse:acme:1", token: "acme", company: "Acme Health" }))).toBe("Acme Health");
  });

  it("a federal posting keeps its own agency; only the whole board is called USAJOBS", () => {
    expect(employerName("usajobs", "Veterans Health Administration")).toBe("Veterans Health Administration");
    expect(boardName("usajobs", "Western Area Power Administration")).toBe("USAJOBS");
  });
});

describe("a possessive never doubles", () => {
  it("Domino's is its own possessive, Siemens takes an apostrophe, the rest take 's", () => {
    expect(possessive("Domino's")).toBe("Domino's");
    expect(possessive("Raising Cane’s")).toBe("Raising Cane’s");
    expect(possessive("Siemens")).toBe("Siemens'");
    expect(possessive("Morgan Stanley")).toBe("Morgan Stanley's");
  });

  it("the meta description of a Domino's posting says Domino's own job board", () => {
    const d = postingPageDescription(row({ id: "smartrecruiters:dominos:1", token: "dominos", company: "Domino's", title: "Driver", location: "Ann Arbor" }));
    expect(d).toContain("Domino's own job board");
    expect(d).not.toContain("Domino's's");
  });
});

describe("a name that is still a tenant code is recognisable as one", () => {
  it("flags the capitalised tenant code of a compound token", () => {
    expect(isCodeShapedName("uoflhealth~wd1~UofLHealthCareers", "Uoflhealth")).toBe(true);
    expect(isCodeShapedName("r1rcm~wd1~R1RCM", "R1rcm")).toBe(true);
  });

  it("does not flag an employer whose real name equals its tenant code, nor a board name the employer chose", () => {
    expect(isCodeShapedName("target~wd5~targetcareers", "Target")).toBe(false);
    expect(isCodeShapedName("nike~wd1~nke", "Nike")).toBe(false);
    expect(isCodeShapedName("carvana", "Carvana")).toBe(false);
    expect(isCodeShapedName("ms~wd5~external", employerName("ms~wd5~external", "Ms"))).toBe(false);
  });

  // S11-013 (2026-10-11): a one-word employer named by its code is the common
  // case. The rule flagged any name equal to the code bar a 49-name
  // allowlist: 2,821 of 5,841 compound tokens on the live facets (153k open
  // roles), Intel, Mastercard, Medtronic, Tapestry and Menasha among them, so
  // their company pages went noindex and their posting pages were retired.
  it("positive controls: real one-word employers named by their code keep their pages", () => {
    for (const [token, stored] of [
      ["intel~wd1~External", "Intel"], ["adient~wd3~External", "Adient"], ["mastercard~wd1~CorporateCareers", "Mastercard"],
      ["menasha~wd12~MenashaCorp", "Menasha"], ["medtronic~wd1~MedtronicCareers", "Medtronic"], ["tapestry~wd108~Tapestry_Careers", "Tapestry"],
      ["gartner~wd5~EXT", "Gartner"], ["hitachi~wd1~hitachi", "Hitachi"], ["fielmann~wd3~External", "Fielmann"],
      // a printed initialism is the employer's own style
      ["gsk~wd5~GSKCareers", "GSK"], ["3m~wd1~Search", "3M"],
    ]) expect(isCodeShapedName(token, employerName(token, stored)), `${token} "${stored}"`).toBe(false);
  });

  it("flags a reviewed code, and a vowelless code the display could not make an initialism", () => {
    expect(isCodeShapedName("abercrombie~wd108~anf", employerName("abercrombie~wd108~anf", "Abercrombie"))).toBe(true);
    expect(isCodeShapedName("bb~wd3~BlackBerry", employerName("bb~wd3~BlackBerry", "Bb"))).toBe(true);
    expect(isCodeShapedName("bcbsnc~wd5~BCBSNC", employerName("bcbsnc~wd5~BCBSNC", "Bcbsnc"))).toBe(true);
  });
});

describe("a tenant code the display name uppercased is still a tenant code", () => {
  // Reviewer, 2026-10-10: the check compared the PRINTED name to
  // Capitalize(slug), case-sensitively, after companyDisplayName had already
  // uppercased a vowelless code. "Shm" printed as "SHM" and "Pfg" as "PFG",
  // both passed as real names, and both had indexable company pages and
  // posting pages naming the code as hiringOrganization (225 and 230 open
  // roles in the committed facets snapshot).
  it("SHM, PFG and BCBS are flagged on the name a page would print", () => {
    expect(employerName("shm~wd5~Summit_CityMD", "Shm")).toBe("SHM");
    expect(isCodeShapedName("shm~wd5~Summit_CityMD", employerName("shm~wd5~Summit_CityMD", "Shm"))).toBe(true);
    expect(isCodeShapedName("pfg~wd3~SaveonfoodsCareers", employerName("pfg~wd3~SaveonfoodsCareers", "Pfg"))).toBe(true);
    expect(isCodeShapedName("bcbs~wd1~External", employerName("bcbs~wd1~External", "Bcbs"))).toBe(true);
  });

  it("a name someone wrote, with a space, is not a code even when it folds to one", () => {
    expect(isCodeShapedName("drivenbrands~wd1~External", "Driven Brands")).toBe(false);
  });
});

describe("the bake applies the tenant-code rule to company pages and posting pages", () => {
  // The two places the bake judges F1 were inline: deleting either left the
  // whole suite green while Uoflhealth got an indexable page. They now run
  // through these two functions, called here with the app's own modules,
  // the bundle the bake builds.
  const NOW2 = new Date("2026-10-09T12:00:00Z");
  const D = {
    boardName, employerName, isCodeShapedName, postingEmployer, postingPagePath, postingPathParts,
    isPostingLive: (j: PostingRow) => isPostingLive(j, NOW2),
  };
  const facet = [
    { token: "shm~wd5~Summit_CityMD", name: "Shm", open: 225, count: 300 },
    { token: "uoflhealth~wd1~UofLHealthCareers", name: "Uoflhealth", open: 120, count: 130 },
    { token: "ms~wd5~external", name: "Ms", open: 400, count: 420 },
    { token: "target~wd5~targetcareers", name: "Target", open: 260, count: 270 },
  ];
  const landers = bakeLanders(facet, { D, openOf: (c: { open: number }) => c.open });
  const by = Object.fromEntries(landers.map((c: { token: string }) => [c.token, c]));

  it("a code-named board gets a page that is never indexable; a named one keeps its index", () => {
    for (const t of ["shm~wd5~Summit_CityMD", "uoflhealth~wd1~UofLHealthCareers"]) {
      expect(by[t].unreadable, t).toBe(true);
      expect(landerRobots({ isPrimary: true, unreadable: by[t].unreadable, answered: true, ownContent: true }), t).toBe("noindex, follow");
    }
    expect(by["ms~wd5~external"].name).toBe("Morgan Stanley");
    expect(by["ms~wd5~external"].unreadable).toBe(false);
    expect(by["target~wd5~targetcareers"].unreadable).toBe(false);
  });

  it("a posting on a code-named board gets no page; the same posting under a real name does", () => {
    const shm = row({ id: "workday:shm~wd5~Summit_CityMD:JR9", token: "shm~wd5~Summit_CityMD", company: "Shm" });
    expect(postingRowEligible(shm, D)).toBe(false);
    expect(postingRowEligible({ ...shm, token: null }, D), "the token is read from the id when the row has none").toBe(false);
    expect(postingRowEligible(row(), D), "Morgan Stanley's posting is eligible").toBe(true);
    expect(postingRowEligible(row({ agency: true } as Partial<PostingRow>), D), "a staffing agency's row is not").toBe(false);
  });
});

describe("a posting's noindex page names the employer too", () => {
  // Reviewer, 2026-10-10: the "no longer listed", "retired" and "unchecked"
  // pages took the raw stored name from the detail's gone payload (and the
  // ledger kept it), so they said "Performance Analyst at Ms is no longer
  // listed" and linked "Ms' open roles".
  const esc = (x: string) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const tokenOf = (id: string) => postingPathParts(id)?.token ?? null;
  const id = "workday:ms~wd5~external:JR014245";

  it("the gone payload's stored name is printed as Morgan Stanley, and the ledger keeps that", () => {
    const e = postingStubEntry({ stub: { id, state: "gone", title: "Performance Analyst", company: "Ms" }, prior: {}, today: "2026-10-10", employerName, tokenOf });
    expect(e.company).toBe("Morgan Stanley");
    const page = postingStubPage({ path: "/x", id, state: "gone", since: e.since, title: e.title, company: e.company, companyLink: "", windowDays: 30, esc });
    expect(page.content).toContain("Performance Analyst at Morgan Stanley is no longer listed");
    expect(page.description).not.toMatch(/\bMs\b/);
  });

  it("an older ledger's stored name is renamed too, and a held state keeps its date", () => {
    const e = postingStubEntry({ stub: { id, state: "gone", title: null, company: null }, prior: { state: "gone", since: "2026-10-01", first: "2026-09-20", title: "Analyst", company: "Ms", token: "ms~wd5~external" }, today: "2026-10-10", employerName, tokenOf });
    expect(e).toMatchObject({ company: "Morgan Stanley", since: "2026-10-01", first: "2026-09-20", title: "Analyst" });
  });
});

describe("the React company page names the employer and its possessive the way the baked page does", () => {
  // Reviewer, 2026-10-10: once React loaded (Google renders it), the company
  // page took its name from the first row's stored company ("Is Ms hiring?")
  // and four locale strings hard-coded "{{company}}'s", so Domino's read as
  // "Domino's's" in the head description, the subtitle and the hiring answer.
  const dir = resolve(__dirname, "../i18n/locales");
  const jobs = codeOf(readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8"));
  // Pass B (2026-10-12): the lander is the company vocabulary's (CompanyHeader),
  // whose possessive sentences live in the company shard; the head description
  // stays in the main locale, read by Jobs.tsx for the SEO tag.
  const LANDER_KEYS = ["companySeoDescription"];
  const shardDir = resolve(__dirname, "../i18n/shards/company");
  const SHARD_KEYS = ["subtitle", "zero.older_other", "zero.empty", "zero.unread"];
  const leaf = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);

  it("no locale builds an English possessive by appending 's to the name", () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const page = JSON.parse(readFileSync(resolve(dir, file), "utf8")).jobsPage;
      for (const k of LANDER_KEYS) expect(page[k], `${file} ${k}`).not.toMatch(/\{\{company\}\}['’]s/);
      const shard = JSON.parse(readFileSync(resolve(shardDir, file), "utf8")).companyProfile;
      for (const k of SHARD_KEYS) {
        const v = leaf(shard, k);
        expect(typeof v, `${file} companyProfile.${k}`).toBe("string");
        expect(String(v), `${file} companyProfile.${k}`).not.toMatch(/\{\{company\}\}['’]s/);
      }
    }
  });

  it("rendered for Domino's, the English strings never say Domino's's", async () => {
    const en = JSON.parse(readFileSync(resolve(dir, "en.json"), "utf8"));
    const shard = JSON.parse(readFileSync(resolve(shardDir, "en.json"), "utf8"));
    const i18n = i18next.createInstance();
    await i18n.init({ lng: "en", resources: { en: { translation: { ...en, ...shard } } }, interpolation: { escapeValue: false } });
    const vars = { company: "Domino's", companyPossessive: possessive("Domino's"), count: 12, n: "10,000", total: "31", days: 30, date: "12 Oct 2026", ago: "5 hr ago" };
    for (const k of LANDER_KEYS) {
      const out = i18n.t(`jobsPage.${k}`, vars);
      expect(out, k).toContain("Domino's own");
      expect(out, k).not.toMatch(/Domino's's|\{\{/);
    }
    for (const k of SHARD_KEYS) {
      const out = i18n.t(`companyProfile.${k}`, vars);
      expect(out, k).toMatch(/Domino's (own|board|job board|whole board)/);
      expect(out, k).not.toMatch(/Domino's's|\{\{/);
    }
  });

  it("every call of a key that needs the possessive passes it, and the name is the board's own", () => {
    for (const k of LANDER_KEYS) {
      let at = jobs.indexOf(`t("jobsPage.${k}"`);
      expect(at, k).toBeGreaterThan(-1);
      while (at > -1) {
        let depth = 0, end = at;
        for (let i = jobs.indexOf("(", at); i < jobs.length; i++) {
          if (jobs[i] === "(") depth++;
          else if (jobs[i] === ")" && --depth === 0) { end = i; break; }
        }
        expect(jobs.slice(at, end), k).toMatch(/companyPossessive: possessive\(landerCompanyName/);
        at = jobs.indexOf(`t("jobsPage.${k}"`, end);
      }
    }
    // The header builds its possessive from the model's name once, through the same helper.
    const header = codeOf(readFileSync(resolve(__dirname, "../components/jobs/company/CompanyHeader.tsx"), "utf8"));
    expect(header).toMatch(/const companyPossessive = own \? possessive\(name!\) : "";/);
    expect(header).not.toMatch(/\$\{name\}'s|name \+ "'s"/);
    expect(jobs).toMatch(/return boardName\(landerCompany, jobs\.find/);
  });
});
