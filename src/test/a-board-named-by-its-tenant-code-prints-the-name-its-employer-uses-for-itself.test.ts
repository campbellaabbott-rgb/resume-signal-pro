/**
 * A BOARD NAMED BY ITS TENANT CODE PRINTS THE NAME ITS EMPLOYER USES FOR
 * ITSELF (SEO/GEO audit 2026-11-07, B05: findings F04, NAME-06, SD-02).
 *
 * The audit read indexable pages titled by a Workday tenant code: company
 * pages ("Nyuhs", "Papajohns"), JobPosting hiringOrganizations ("Newbalance",
 * "Atd") and data-table rows ("Rivhs"), four of them naming the wrong company
 * ("Starfish" is Torch Technologies). Each board below was read on the
 * employer's own Workday site on 2026-11-08 (its CXS sidebar and a posting),
 * and migration 20261108100000 writes the name with the words read beside it
 * in public.company_name_evidence; src/lib/employer-names.ts mirrors it (the
 * mirror test, an-employer-named-by-its-system-code-gets-the-name-it-uses,
 * holds the two equal).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { boardName, employerName } from "@/lib/company-display";
import { employerNameOverride } from "@/lib/employer-names";
import { unpublishableNameReason } from "../../scripts/prerender-names.mjs";

/** [a catalogue token the audit saw, the name its employer uses]. */
const OBSERVED: ReadonlyArray<[string, string]> = [
  // Company pages.
  ["nyuhs~wd12~nyuhscareers1", "United Health Services"],
  ["papajohns~wd1~PapaJohnsCareers", "Papa John's"],
  ["wvumedicine~wd1~WVUH", "WVU Medicine"],
  ["wvumedicine~wd1~UHA", "University Health Associates"],
  ["ssctech~wd1~ssctechnologies", "SS&C Technologies"],
  ["signetjewelers~wd1~SignetCorporateCareers", "Signet Jewelers"],
  ["signetjewelers~wd1~Banter", "Banter by Piercing Pagoda"],
  ["signetjewelers~wd1~BlueNile", "Blue Nile"],
  ["bakertilly~wd5~btcareers", "Baker Tilly US"],
  ["ensemblehp~wd5~EnsembleHealthPartnersCareers", "Ensemble Health Partners"],
  ["globalfoundries~wd1~External", "GlobalFoundries"],
  ["hubinternational~wd1~HUBInternational", "HUB International"],
  ["ivyrehab~wd5~Ivy_Rehab", "Ivy Health"],
  ["pyebarkerfire~wd1~PB_V2", "Pye-Barker Fire & Safety"],
  // Postings.
  ["newbalance~wd1~Careers", "New Balance"],
  ["clearchanneloutdoor~wd5~CCO", "Clear Channel Outdoor"],
  ["airproducts~wd5~AP0001", "Air Products"],
  ["villeroyboch~wd3~careers", "Villeroy & Boch"],
  ["harbourvest~wd5~HVP", "HarbourVest"],
  ["worldmarket~wd5~cost_plus_world_market_jobs", "World Market"],
  ["borgwarner~wd5~BorgWarner_Careers", "BorgWarner"],
  ["tcbrands~wd1~TravisMathew-Careers", "TravisMathew"],
  ["tcbrands~wd1~callaway-careers", "Callaway Golf"],
  ["surbanajurong~wd3~SJ_Careers", "Surbana Jurong"],
  ["surbanajurong~wd3~careersatsmec", "SMEC"],
  ["surbanajurong~wd3~RobertBirdGroup_Careers", "Robert Bird Group"],
  ["quirchfoods~wd12~Quirch_Foods", "Quirch Foods"],
  ["kaweahhealth~wd1~Careers", "Kaweah Health"],
  ["hfecorp~wd503~palace_jobs", "Herschend"],
  ["goldenagri~wd3~SMART_Careers", "PT SMART Tbk."],
  ["aampower~wd1~AAM-Career-Site", "Dauch Corporation"],
  ["zrsmanagement~wd5~ZRS_Careers", "ZRS Management"],
  ["wfscorp~wd5~wfscareers", "World Fuel Services"],
  ["abcfinancial~wd5~ABCFinancialServices", "ABC Fitness"],
  ["rsmaus~wd105~RSMCareers", "RSM Australia"],
  ["uvmhealth~wd1~EXTERNAL", "University of Vermont Medical Center"],
  ["uvmhealth~wd1~AHMC", "Alice Hyde Medical Center"],
  ["atd~wd1~American_Tire_Distributors", "American Tire Distributors"],
  ["aes~wd1~AES_US", "AES"],
  ["rumcsi~wd5~RUMC", "Richmond University Medical Center"],
  // The wrong company.
  ["starfish~wd501~Careers", "Torch Technologies"],
  ["stars~wd1~Search", "Stars Behavioral Health Group"],
  ["aaregional~wd503~Search", "Piedmont Airlines"],
  ["djeholdings~wd5~edelman-careers-E200", "Edelman"],
  ["djeholdings~wd5~ZenoCareers", "Zeno Group"],
  // Tables.
  ["rivhs~wd1~ProviderRHS", "Riverside Health"],
  ["baystatehealth~wd12~External_Careers", "Baystate Health"],
  ["denverhealth~wd1~dhha-main", "Denver Health"],
  ["cngholdingsinc~wd5~CNG", "CNG Holdings"],
];

const slugTitled = (token: string) => {
  const s = token.split("~")[0];
  return s[0].toUpperCase() + s.slice(1);
};

describe("each board the audit saw named by its tenant code prints its employer's name", () => {
  it.each(OBSERVED)("%s prints %s, not its capitalised slug", (token, name) => {
    const stored = slugTitled(token);
    expect(employerName(token, stored)).toBe(name);
    expect(boardName(token, stored)).toBe(name);
    expect(employerName(token, stored)).not.toBe(stored);
    expect(unpublishableNameReason(name)).toBeNull();
  });

  it("names one career site, never the tenant, where the tenant hosts more than one employer", () => {
    // ebi carries four companies' sites; only Ensign-Bickford Aerospace &
    // Defense's was read, so the other three keep their stored name.
    expect(employerNameOverride("ebi~wd5~ebadcareers")).toBe("Ensign-Bickford Aerospace & Defense Company");
    expect(employerNameOverride("ebi~wd5~afbcareers")).toBeNull();
    expect(employerNameOverride("tcbrands~wd1~some-other-site")).toBeNull();
    expect(employerNameOverride("surbanajurong~wd3~some-other-site")).toBeNull();
    expect(employerNameOverride("djeholdings~wd5~some-other-site")).toBeNull();
  });

  it("leaves the Saskatchewan site its own name: its requisitions name two employers", () => {
    expect(employerNameOverride("emqk~ca3~CX_1")).toBeNull();
    expect(employerName("emqk~ca3~CX_1", "HealthCareersInSask.ca")).toBe("HealthCareersInSask.ca");
  });
});

describe("the migration carries each name with the employer's own words", () => {
  const DIR = resolve(__dirname, "../../supabase/migrations");
  const file = readdirSync(DIR).find((f) => f.startsWith("20261108100000_"));
  const sql = file ? readFileSync(resolve(DIR, file), "utf8") : "";
  const evidenceBlock = sql.slice(sql.indexOf("INSERT INTO public.company_name_evidence"));
  const lit = (s: string) => s.slice(1, -1).replace(/''/g, "'");
  const rows = [...evidenceBlock.matchAll(/^\s*\(('(?:[^']|'')*'), ('(?:[^']|'')*'), ARRAY\[([^\]]*)\], ('(?:[^']|'')*'), DATE '2026-11-08'\)/gm)]
    .map((m) => ({ slug: lit(m[1]), name: lit(m[2]), links: [...m[3].matchAll(/'([^']*)'/g)].map((x) => x[1]), quote: lit(m[4]) }));

  it("is the file the ledger reserved for this round", () => {
    expect(file).toBeTruthy();
  });

  it("writes one evidence row per override, read on the employer's own Workday site", () => {
    expect(rows.length).toBe(59);
    for (const r of rows) {
      expect(employerNameOverride(r.slug.includes("~") ? r.slug : `${r.slug}~wd1~x`), r.slug).toBe(r.name);
      expect(r.links.length, r.slug).toBeGreaterThanOrEqual(1);
      for (const l of r.links) expect(l, r.slug).toMatch(/^https:\/\/[a-z0-9]+\.wd\d+\.myworkdayjobs\.com\/wday\/cxs\/\S+$/);
    }
  });

  it("quotes words that contain the name it writes", () => {
    const missing = rows.filter((r) => !r.quote.toLowerCase().includes(r.name.toLowerCase())).map((r) => `${r.slug}: "${r.name}" not in "${r.quote}"`);
    expect(missing).toEqual([]);
  });

  it("re-arms the name-sync lane after the names exist, so the stored rows are renamed", () => {
    const code = sql.replace(/^\s*--.*$/gm, "");
    const insert = code.indexOf("INSERT INTO public.company_name_overrides");
    const rearm = code.indexOf("DELETE FROM public.job_board_meta WHERE k IN ('name_sync_version', 'name_sync_progress')");
    expect(insert).toBeGreaterThan(-1);
    expect(rearm).toBeGreaterThan(insert);
  });
});
