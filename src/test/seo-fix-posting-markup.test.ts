/**
 * THE SEO ROUND'S REVIEW, POSTING MARKUP (2026-10-24). Every case is a page the
 * round's own bake wrote and the review read back:
 *   - /jobs/posting/workday/alation~wd503~ExternalSite/R10000775, location
 *     "USA-REMOTE", shipped addressLocality "USA-" (a town called "USA-") and
 *     lost its remote reading;
 *   - /jobs/posting/workday/grpr~wd3~parques_reunidos/JR108112, "Movie Park
 *     Germany, Warner Allee 1, 46244 Bottrop-Kirchhellen, Germany", shipped
 *     addressLocality "Movie Park Germany" (the town is Bottrop-Kirchhellen);
 *   - a "China - Remote" medical representative whose description asks for
 *     twelve hospital visits a day shipped TELECOMMUTE with no vendor flag
 *     (the spec's rule: TELECOMMUTE only on the hiring system's own field);
 *   - three pages carried datePosted = the bake's day and validThrough counted
 *     from the employer's later stated day: a 31-day window;
 *   - an all-Chinese description was served lang="en";
 *   - Workday descriptions carried a literal line "undefined".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  jdParagraphs,
  postingDatePosted,
  postingPageDescription,
  postingPageTitle,
  postingJsonLd,
  postingLanguage,
  postingPostalAddress,
  postingRemoteBasis,
  postingValidThrough,
  remoteLocationNamesAPlace,
  type PostingRow,
} from "@/components/jobs/posting-page";
import { prepareDescription } from "@/lib/listing/description";

const SITE = "https://resumebooster.work";
const NOW = new Date("2026-10-24T12:00:00Z");
const DESC = "We are hiring for this role and you will work with our team on the work that matters to the people we serve. ".repeat(6);
const row = (over: Partial<PostingRow> = {}): PostingRow => ({
  id: "workday:alation~wd503~ExternalSite:R10000775",
  title: "Senior Solutions Engineer",
  company: "Alation",
  location: "USA-REMOTE",
  country: "US",
  workMode: "remote",
  remote: true,
  postedAt: "2026-10-20T00:00:00+00:00",
  missingSince: null,
  token: "alation~wd503~ExternalSite",
  ...over,
});
const ld = (job: PostingRow, desc = DESC) => postingJsonLd(job, desc, { site: SITE, now: NOW });
const address = (d: Record<string, unknown> | null) => (d?.jobLocation as { address?: Record<string, unknown> } | undefined)?.address;

describe("a punctuation-joined work mode is not a town (USA-REMOTE)", () => {
  it("reads 'USA-REMOTE' as remote in the US naming no place, with no locality", () => {
    expect(remoteLocationNamesAPlace(row())).toBe(false);
    expect(postingRemoteBasis(row())).toBe("place-free");
    const a = postingPostalAddress(row()) as Record<string, unknown>;
    expect(a).toEqual({ "@type": "PostalAddress", addressCountry: "US" });
  });
  it("keeps every locality free of a leading or trailing dash", () => {
    for (const location of ["USA-REMOTE", "REMOTE-USA", "US-Remote", "Remote-Texas", "Canada-Remote"]) {
      const country = /canada/i.test(location) ? "CA" : "US";
      const a = postingPostalAddress(row({ location, country, workMode: null })) as Record<string, unknown>;
      const loc = a.addressLocality as string | undefined;
      expect(loc === undefined || !/^[-–_/,.:]|[-–_/,.:]$/.test(loc), `${location} -> ${loc}`).toBe(true);
    }
    expect(postingPostalAddress(row({ location: "Remote-Texas", workMode: null }))).toMatchObject({ addressRegion: "TX" });
  });
});

describe("a locality never carries a country's name", () => {
  const park = row({
    id: "workday:grpr~wd3~parques_reunidos:JR108112",
    token: "grpr~wd3~parques_reunidos",
    company: "Parques Reunidos",
    title: "Mitarbeiter Gastronomie",
    location: "Movie Park Germany, Warner Allee 1, 46244 Bottrop-Kirchhellen, Germany",
    country: "DE",
    workMode: null,
    remote: false,
  });
  it("takes the town from the '<postal code> <town>' segment", () => {
    const a = postingPostalAddress(park) as Record<string, unknown>;
    expect(a.addressLocality).toBe("Bottrop-Kirchhellen");
    expect(a.postalCode).toBe("46244");
    expect(a.addressCountry).toBe("DE");
  });
  it("refuses a phrase that contains a country as a word, and keeps the cities named after one", () => {
    const addr = (location: string, country: string) => postingPostalAddress(row({ location, country, workMode: null, company: "Acme" })) as Record<string, unknown>;
    expect(addr("Movie Park Germany", "DE").addressLocality).toBeUndefined();
    expect(addr("Movie Park Germany, Bottrop", "DE").addressLocality).toBeUndefined();
    expect(addr("Panama City, FL", "US")).toMatchObject({ addressLocality: "Panama City", addressRegion: "FL" });
    expect(addr("Mexico City", "MX")).toMatchObject({ addressLocality: "Mexico City" });
    expect(addr("Kuwait City", "KW")).toMatchObject({ addressLocality: "Kuwait City" });
  });
});

describe("TELECOMMUTE only on the hiring system's own remote field (SEO-003's guard)", () => {
  const rep = row({
    id: "workday:abbott~wd5~abbottcareers:31140324",
    token: "abbott~wd5~abbottcareers",
    company: "Abbott",
    title: "Medical Representative",
    location: "China - Remote",
    country: "CN",
  });
  it("marks a place-free remote label up as its country, not as work from anywhere", () => {
    const d = ld(rep)!;
    expect(d, "no markup at all: every assertion below would pass vacuously").toBeTruthy();
    expect(d.jobLocationType).toBeUndefined();
    expect(d.applicantLocationRequirements).toBeUndefined();
    expect(address(d)).toEqual({ "@type": "PostalAddress", addressCountry: "CN" });
    const us = ld(row())!;
    expect(us.jobLocationType).toBeUndefined();
    expect(address(us)).toEqual({ "@type": "PostalAddress", addressCountry: "US" });
    // A remote row with no location at all still states its country.
    expect(address(ld(row({ location: "" }))!)).toEqual({ "@type": "PostalAddress", addressCountry: "US" });
  });
  it("keeps TELECOMMUTE where the hiring system's own field said remote", () => {
    const d = ld({ ...rep, workModeSource: "vendor" })!;
    expect(d.jobLocationType).toBe("TELECOMMUTE");
    expect(d.applicantLocationRequirements).toEqual({ "@type": "Country", name: "CN" });
  });
  it("is the rule the bake's markup guard and section 98 read back", () => {
    const bake = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toMatch(/ld\.jobLocationType === "TELECOMMUTE" && job\.workModeSource !== "vendor"\) wrong\.push/);
    expect(bake).toMatch(/D\.localityProblem\(locality\)/);
    const verify = readFileSync(resolve(__dirname, "../../scripts/verify-deploy.d/98-seo-round.sh"), "utf8");
    expect(verify).toMatch(/localityProblem\(a\.addressLocality\)/);
  });
});

describe("the markup's window starts on the day its datePosted states", () => {
  it("counts validThrough from the clamped day for a posting the employer dates tomorrow", () => {
    const job = row({ location: "Munich", country: "DE", workMode: null, postedAt: "2026-10-25T00:00:00+00:00" });
    expect(postingDatePosted(job.postedAt!, NOW)).toBe("2026-10-24");
    expect(postingValidThrough(job, NOW)).toBe("2026-11-23");
    const d = ld(job)!;
    const span = (Date.parse(String(d.validThrough).slice(0, 10)) - Date.parse(String(d.datePosted))) / 86_400_000;
    expect(span).toBe(30);
  });
  it("leaves a posting dated in the past exactly as before", () => {
    expect(postingValidThrough(row({ postedAt: "2026-10-01T00:00:00+00:00" }), NOW)).toBe("2026-10-31");
  });
});

describe("a Chinese, Japanese or Korean description says so", () => {
  it("reads CJK script", () => {
    const zh = "主要工作职责及内容：负责医院的学术推广工作，每周拜访医院，与医生沟通产品信息。任职资格：本科及以上学历，医学或药学相关专业优先。".repeat(4);
    expect(postingLanguage(zh)).toBe("zh");
    const ja = "仕事内容：お客様のご要望をお伺いし、最適な提案を行います。応募資格：営業経験のある方を歓迎します。".repeat(4);
    expect(postingLanguage(ja)).toBe("ja");
    const ko = "주요 업무: 고객 관리 및 영업 지원 업무를 담당합니다. 자격 요건: 관련 경력 3년 이상인 분을 우대합니다.".repeat(4);
    expect(postingLanguage(ko)).toBe("ko");
    expect(postingLanguage(DESC)).toBe("en");
  });
  it("gives the bake an og:locale for each", () => {
    const bake = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toMatch(/zh: "zh_CN", ja: "ja_JP", ko: "ko_KR"/);
  });
});

describe("a carried posting whose employer name the gate refuses names no employer (D7 keeps its index, not its name)", () => {
  const axia = row({ id: "ukg:recruiting~REG1001RWHM~3f9058a6:238cdd44", token: "recruiting~REG1001RWHM~3f9058a6", company: "", title: "Certified Medical Assistant (CMA) II", location: "Phoenix, AZ", workMode: null });
  it("prints a head with no 'at ,' and 'the employer' in its own sentence", () => {
    const d = postingPageDescription(axia);
    expect(d).toMatch(/^Certified Medical Assistant \(CMA\) II, Phoenix, AZ\./);
    expect(d).toContain("Straight from the employer's own job board.");
    expect(d).not.toMatch(/ at [,.]/);
    expect(postingPageTitle(axia)).toBe("Certified Medical Assistant (CMA) II — Phoenix, AZ");
  });
  it("is how the bake writes it: the markup withheld, the page kept, the name not printed", () => {
    const bake = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toMatch(/const job = nameRefused \? \{ \.\.\.rawJob, company: "" \} : rawJob;/);
    expect(bake).toMatch(/const ld = nameRefused \? null : D\.postingJsonLd\(job, description, \{ site: SITE \}\);/);
    expect(bake).toMatch(/if \(!path \|\| \(!ld && !\(\(mismatchOnly \|\| nameOnly\) && carried\)\)\) \{/);
    expect(bake).toMatch(/const nm = nameRefused \? "the employer" : D\.postingEmployer\(job\);/);
  });
});

describe("a stray 'undefined' line from the Workday description assembly is dropped", () => {
  const raw = `${DESC}\n\nWe run the related service processes.\nundefined\nThis role is suitable for you.`;
  it("leaves it out of the visible paragraphs and of the markup's description", () => {
    expect(jdParagraphs(raw).join("\n")).not.toMatch(/^undefined$/m);
    expect(jdParagraphs(raw).join("\n")).toContain("This role is suitable for you.");
    const d = ld(row({ location: "Munich", country: "DE", workMode: null }), raw)!;
    expect(String(d.description)).not.toMatch(/^\s*undefined\s*$/m);
    expect(String(d.description)).toContain("This role is suitable for you.");
  });
  it("and out of the React posting page's text", () => {
    const prepared = prepareDescription(raw);
    expect(prepared.text).not.toMatch(/^\s*undefined\s*$/m);
    expect(prepared.text).toContain("This role is suitable for you.");
  });
});
