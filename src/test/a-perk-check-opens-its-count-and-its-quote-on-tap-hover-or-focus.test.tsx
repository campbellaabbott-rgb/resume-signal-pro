/**
 * A PERK CHECK OPENS ITS COUNT AND ITS QUOTE ON TAP, HOVER OR FOCUS.
 *
 * The owner chose a checkmark list for perks on the company lander (D1,
 * 2026-10-11) and asked for it to be built honestly. A bare check reads as
 * "this employer offers it"; what we hold is "at least k of n open postings
 * in one country that we could read state it, read on a date, in these
 * words". So this file renders the block and holds:
 *
 *   1. PUBLISHED KEYS SHOW CHECKS, and a tap, a hover or keyboard focus on a
 *      check shows the count, the verbatim line and a link to the posting it
 *      came from; the heading and the "not listed is not refused" line sit
 *      above the list; countries are grouped only when more than one
 *      qualifies; the eligibility and legal-minimum tags are on the check.
 *   2. UNPUBLISHED AND EXPIRED KEYS RENDER NOTHING: no placeholder, no
 *      "being checked", no heading. A row the reader returns for a key it
 *      does not name live, or below the threshold, is not a check either.
 *   3. COLLISION, AGENCY AND FRANCHISE BOARDS render no check: only the
 *      reason, and only while some key is live (nothing at all otherwise).
 *   4. ACCESSIBILITY: each check is a button with aria-expanded and
 *      aria-controls naming its panel and aria-describedby naming the count,
 *      reachable by Tab, opened by focus, kept open while focus is inside the
 *      panel, closed by Escape with focus returned to the check.
 *   5. THE PAGE MOUNTS IT on the company lander, and calls the one reader.
 *   6. EVERY STRING IS IN ALL NINE LOCALES with the same placeholders, and no
 *      threshold is typed into the copy.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const rpcCalls: Array<{ fn: string; args: unknown }> = [];
const rpcAnswer: { data: unknown } = { data: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return { data: rpcAnswer.data };
    },
  },
}));

import { CompanyPerks, CompanyPerksView } from "@/components/jobs/CompanyPerks";
import { readEmployerPerks } from "@/lib/employer-perks";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");

const AS_OF = "2026-10-12T12:00:00Z"; // midday UTC: the same calendar day in every timezone the suite runs in
const row = (o: Record<string, unknown>) => ({
  source: "greenhouse", country: "US", perk: "health", k: 212, n: 240, qualified_share: 0, standard_text: false, as_of: AS_OF,
  quote: "Comprehensive medical, dental and vision insurance for you and your family", quote_posting_id: "greenhouse:acme:4012345",
  baseline: null, ...o,
});
const answer = (o: Record<string, unknown> = {}) => ({
  token: "acme", collision: false, expiry_days: 45, published_keys: ["dental", "health", "pto"], withheld: [],
  perks: [
    row({}),
    row({ perk: "dental", k: 180, quote: "Dental and vision plans from day one", quote_posting_id: null, qualified_share: 0.4 }),
  ],
  ...o,
});
const UK_PTO = row({
  country: "GB", perk: "pto", k: 9, n: 30, quote: "25 days annual leave plus bank holidays", quote_posting_id: "greenhouse:acme:9",
  baseline: { statute: "Working Time Regulations 1998, regulations 13 and 13A", minimum: "5.6 weeks", note: "This line may describe that minimum.",
              source_url: "https://www.legislation.gov.uk/uksi/1998/1833/regulation/13A", read_on: "2026-10-10" },
});

function show(data: unknown) {
  return render(
    <MemoryRouter>
      <CompanyPerksView answer={readEmployerPerks(data)} />
    </MemoryRouter>,
  );
}

describe("published keys show checks, and each opens its basis", () => {
  it("prints the heading, the not-listed line and one check per live key above the threshold", () => {
    show(answer());
    expect(screen.getByRole("heading", { level: 2, name: "Perks stated in their job postings" })).toBeInTheDocument();
    expect(screen.getByText(/A perk not listed here doesn't mean it isn't offered/)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Health insurance", "Dental coverageconditions stated"]);
    // One country qualifies: no country subheading, the count names it instead.
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("a hover shows the count, the verbatim line and a link to the live posting it came from", async () => {
    const user = userEvent.setup();
    show(answer());
    const check = screen.getByRole("button", { name: /Health insurance/ });
    const panel = document.getElementById(check.getAttribute("aria-controls")!)!;
    expect(panel).not.toBeVisible();
    expect(check).toHaveAttribute("aria-expanded", "false");
    await user.hover(check);
    expect(panel).toBeVisible();
    expect(check).toHaveAttribute("aria-expanded", "true");
    expect(within(panel).getByText(/^Stated in at least 212 of 240 open United States postings we could read, read Oct 12, 2026\.$/)).toBeInTheDocument();
    expect(within(panel).getByText("“Comprehensive medical, dental and vision insurance for you and your family”")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "See the posting this line comes from" })).toHaveAttribute("href", "/jobs/posting/greenhouse/acme/4012345");
    await user.unhover(check);
    expect(panel).not.toBeVisible();
  });

  it("a tap pins it open and a second tap closes it", async () => {
    const user = userEvent.setup();
    show(answer());
    const check = screen.getByRole("button", { name: /Health insurance/ });
    const panel = document.getElementById(check.getAttribute("aria-controls")!)!;
    await user.pointer({ keys: "[TouchA]", target: check });
    expect(panel).toBeVisible();
    expect(check).toHaveAttribute("aria-expanded", "true");
    await user.pointer({ keys: "[TouchA]", target: check });
    expect(panel).not.toBeVisible();
    expect(check).toHaveAttribute("aria-expanded", "false");
  });

  it("a mouse click pins it, so leaving does not close it; a second click does", async () => {
    const user = userEvent.setup();
    show(answer());
    const check = screen.getByRole("button", { name: /Health insurance/ });
    const panel = document.getElementById(check.getAttribute("aria-controls")!)!;
    await user.click(check);
    await user.unhover(check);
    expect(panel).toBeVisible();
    await user.click(check);
    expect(panel).not.toBeVisible();
  });

  it("a quoted posting that left the board is said, not linked; the eligibility tag carries its count", async () => {
    const user = userEvent.setup();
    show(answer());
    const check = screen.getByRole("button", { name: /Dental coverage/ });
    await user.click(check);
    const panel = document.getElementById(check.getAttribute("aria-controls")!)!;
    expect(within(panel).queryByRole("link")).toBeNull();
    expect(within(panel).getByText("The posting this line was quoted from is no longer on the board.")).toBeInTheDocument();
    expect(within(panel).getByText("72 of these 180 postings hedge it or limit who is eligible.")).toBeInTheDocument();
  });

  it("groups by country when more than one qualifies, and the UK row links its statute", async () => {
    const user = userEvent.setup();
    show(answer({ perks: [row({}), UK_PTO] }));
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["United States", "United Kingdom"]);
    const check = screen.getByRole("button", { name: /Paid time off/ });
    expect(check).toHaveTextContent("may be the legal minimum");
    await user.click(check);
    const panel = document.getElementById(check.getAttribute("aria-controls")!)!;
    expect(within(panel).getByText(/This country's law sets a minimum for this, and this line may describe that minimum:/)).toBeInTheDocument();
    const law = within(panel).getByRole("link", { name: /Working Time Regulations 1998/ });
    expect(law).toHaveAttribute("href", "https://www.legislation.gov.uk/uksi/1998/1833/regulation/13A");
    expect(law).toHaveAttribute("target", "_blank");
  });

  it("a stated visa limit is listed apart, with no checkmark, and needs three postings", () => {
    const visa = row({ perk: "visa_not_offered", k: 3, n: 12, quote: "This role is not eligible for visa sponsorship." });
    const { container } = show(answer({ published_keys: ["health", "visa_not_offered"], perks: [row({}), visa] }));
    // One country: the limits heading sits directly under the h2, so it is an h3.
    expect(screen.getByRole("heading", { level: 3, name: "Stated limits" })).toBeInTheDocument();
    const limit = screen.getByRole("button", { name: /Visa sponsorship: stated as not available/ });
    expect(limit.closest("li")?.querySelector(".lucide-check")).toBeNull();
    expect(container.querySelectorAll(".lucide-check")).toHaveLength(1);
    const two = row({ perk: "visa_not_offered", k: 2, n: 12, quote: "No visa sponsorship." });
    const again = show(answer({ published_keys: ["health", "visa_not_offered"], perks: [row({}), two] }));
    expect(within(again.container).queryByRole("button", { name: /Visa sponsorship/ })).toBeNull();
  });
});

describe("unpublished and expired keys render nothing", () => {
  it("no live key: nothing at all, though the rows arrived", () => {
    const { container } = show(answer({ published_keys: [] }));
    expect(container).toBeEmptyDOMElement();
  });

  it("an expired key is a key the reader no longer names: its row is not a check, and alone it is nothing", () => {
    const { container } = show(answer({ published_keys: ["pto"] }));
    expect(container).toBeEmptyDOMElement();
    const partly = show(answer({ published_keys: ["health"] }));
    expect(within(partly.container).getAllByRole("button").map((b) => b.textContent)).toEqual(["Health insurance"]);
  });

  it("an answer without the live-key list names no key: nothing (fail closed)", () => {
    const old = { ...answer() } as Record<string, unknown>;
    delete old.published_keys;
    expect(show(old).container).toBeEmptyDOMElement();
  });

  it("a withheld key is never a check even if a row arrives for it, and a row below the threshold is not either", () => {
    const flex = row({ perk: "flex", quote: "Flexible working" });
    const thin = row({ perk: "dental", k: 2, n: 30 });
    const { container } = show(answer({ published_keys: ["flex", "dental"], perks: [flex, thin] }));
    expect(container).toBeEmptyDOMElement();
  });

  it("a reader that has not answered, or answered nothing usable, renders nothing", () => {
    expect(show(null).container).toBeEmptyDOMElement();
    expect(show({ error: "PGRST202" }).container).toBeEmptyDOMElement();
  });
});

describe("collision and agency boards render nothing but the reason", () => {
  const withheld = (o: Record<string, unknown>) => answer({ perks: [], ...o });

  it("a token two vendors share: no check, the reason", () => {
    const { container } = show(withheld({ collision: true }));
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(container.querySelector("[data-perks-withheld='collision']")).not.toBeNull();
    expect(screen.getByText(/more than one hiring system carries a board with this name, and we can't tell whether they are one employer/)).toBeInTheDocument();
  });

  it("an agency's board: no check, the reason", () => {
    show(withheld({ withheld: [{ source: "greenhouse", reason: "agency", share: 1 }] }));
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.getByText(/describe the agency's own package or each client's/)).toBeInTheDocument();
  });

  it("a franchise board names its share; a vendor whose text we drop says so", () => {
    show(withheld({ withheld: [{ source: "greenhouse", reason: "franchise", share: 0.333 }] }));
    expect(screen.getByText(/33% of the postings we could read say the location is independently owned and operated/)).toBeInTheDocument();
    show(withheld({ withheld: [{ source: "lever", reason: "vendor_text_not_stored", share: null }] }));
    expect(screen.getByText(/puts benefits in a part of the posting we don't store yet/)).toBeInTheDocument();
  });

  it("with no key live anywhere, a withheld board renders nothing at all: a reason would be a placeholder", () => {
    expect(show(withheld({ collision: true, published_keys: [] })).container).toBeEmptyDOMElement();
    expect(show(withheld({ published_keys: [], withheld: [{ source: "greenhouse", reason: "agency", share: 1 }] })).container).toBeEmptyDOMElement();
  });

  it("a collision withholds even when rows arrive with it", () => {
    show(answer({ collision: true }));
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

describe("each check is an accessible disclosure", () => {
  it("a button naming its panel and its count, with the count as its description", () => {
    show(answer());
    const check = screen.getByRole("button", { name: /Health insurance/ });
    expect(check.tagName).toBe("BUTTON");
    expect(check).toHaveAttribute("type", "button");
    const panelId = check.getAttribute("aria-controls")!;
    const countId = check.getAttribute("aria-describedby")!;
    expect(document.getElementById(panelId)).not.toBeNull();
    expect(document.getElementById(panelId)!.contains(document.getElementById(countId))).toBe(true);
    expect(check).toHaveAccessibleDescription(/Stated in at least 212 of 240 open United States postings we could read/);
  });

  it("Tab reaches the check and opens it; Tab into the posting link keeps it open; Escape closes it and returns focus", async () => {
    const user = userEvent.setup();
    show(answer());
    const check = screen.getByRole("button", { name: /Health insurance/ });
    const panel = document.getElementById(check.getAttribute("aria-controls")!)!;
    await user.tab();
    expect(check).toHaveFocus();
    expect(check).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    await user.tab();
    expect(within(panel).getByRole("link")).toHaveFocus();
    expect(panel).toBeVisible();
    await user.keyboard("{Escape}");
    expect(check).toHaveFocus();
    expect(panel).not.toBeVisible();
    expect(check).toHaveAttribute("aria-expanded", "false");
  });

  it("Tab past the panel closes it and opens the next check", async () => {
    const user = userEvent.setup();
    show(answer());
    const health = screen.getByRole("button", { name: /Health insurance/ });
    const dental = screen.getByRole("button", { name: /Dental coverage/ });
    await user.tab();
    await user.tab();
    await user.tab();
    expect(dental).toHaveFocus();
    expect(health).toHaveAttribute("aria-expanded", "false");
    expect(dental).toHaveAttribute("aria-expanded", "true");
  });

  it("every Enter on a focused check flips what is shown, so each activation is announced", async () => {
    const user = userEvent.setup();
    show(answer());
    const check = screen.getByRole("button", { name: /Health insurance/ });
    const panel = document.getElementById(check.getAttribute("aria-controls")!)!;
    await user.tab();
    // Focus shows the count (owner decision D1)...
    expect(check).toHaveAttribute("aria-expanded", "true");
    // ...and the first Enter is a change a screen reader can announce.
    await user.keyboard("{Enter}");
    expect(check).toHaveFocus();
    expect(check).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
    await user.keyboard("{Enter}");
    expect(check).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    await user.keyboard(" ");
    expect(check).toHaveAttribute("aria-expanded", "false");
  });
});

describe("one panel at a time, in the flow, always dismissible", () => {
  const panelOf = (b: HTMLElement) => document.getElementById(b.getAttribute("aria-controls")!)!;

  it("the panel sits in the flow at every width: it never overlays the checks below it", () => {
    show(answer());
    for (const b of screen.getAllByRole("button")) {
      const cls = panelOf(b).className;
      expect(cls, "an absolutely positioned panel covers the checks under it").not.toMatch(/(^|\s)(sm:|md:|lg:)?(absolute|fixed)(\s|$)/);
      expect(b.closest("li")!.className).not.toMatch(/(^|\s)relative(\s|$)/);
    }
  });

  it("opening a second check closes the first, and a press outside closes the one open", async () => {
    const user = userEvent.setup();
    show(answer());
    const health = screen.getByRole("button", { name: /Health insurance/ });
    const dental = screen.getByRole("button", { name: /Dental coverage/ });
    await user.click(health);
    expect(health).toHaveAttribute("aria-expanded", "true");
    await user.click(dental);
    expect(dental).toHaveAttribute("aria-expanded", "true");
    expect(health, "two panels open at once").toHaveAttribute("aria-expanded", "false");
    expect(document.querySelectorAll("[id$='-basis']:not([hidden])")).toHaveLength(1);
    await user.click(document.body);
    expect(dental, "a pinned panel survived a click elsewhere").toHaveAttribute("aria-expanded", "false");
    await user.pointer({ keys: "[TouchA]", target: health });
    expect(health).toHaveAttribute("aria-expanded", "true");
    await user.pointer({ keys: "[TouchA]", target: document.body });
    expect(health, "a tapped panel survived a tap elsewhere").toHaveAttribute("aria-expanded", "false");
  });

  it("a panel opened by hover closes on Escape while the pointer stays over it and focus is elsewhere (WCAG 1.4.13)", async () => {
    const user = userEvent.setup();
    show(answer());
    const health = screen.getByRole("button", { name: /Health insurance/ });
    await user.hover(health);
    expect(panelOf(health)).toBeVisible();
    expect(document.activeElement).toBe(document.body);
    await user.keyboard("{Escape}");
    expect(panelOf(health)).not.toBeVisible();
    expect(health).toHaveAttribute("aria-expanded", "false");
  });

  it("with several countries, each limits heading sits under its country's h3", () => {
    const visa = row({ perk: "visa_not_offered", k: 3, n: 12, quote: "This role is not eligible for visa sponsorship." });
    show(answer({ published_keys: ["health", "pto", "visa_not_offered"], perks: [row({}), visa, UK_PTO] }));
    const outline = Array.from(document.querySelectorAll("h2, h3, h4")).map((h) => `${h.tagName}:${h.textContent}`);
    expect(outline).toEqual(["H2:Perks stated in their job postings", "H3:United States", "H4:Stated limits", "H3:United Kingdom"]);
  });
});

describe("the block's own sentences claim no more than it knows", () => {
  it("the not-listed line gives no cause for a missing perk: a published key, an unpublished key and a withheld key all look alike", () => {
    // dental is stated in 38 of 40 postings and is simply not a live key here.
    show(answer({ published_keys: ["health"], perks: [row({ k: 30, n: 40 }), row({ perk: "dental", k: 38, n: 40 })] }));
    const line = screen.getByText(/A perk not listed here doesn't mean it isn't offered/).textContent ?? "";
    expect(screen.queryByRole("button", { name: /Dental/ })).toBeNull();
    expect(line, "the line says why dental is missing, and the reason is false").not.toMatch(/didn't find it|not stated in enough|stated in too few/);
    expect(line).toMatch(/We list only perks whose reading we have checked/);
  });

  it("no locale keeps the old causal clause or the collision claim that two employers share the name", () => {
    const OLD_CAUSE: Record<string, RegExp> = {
      en: /it means we didn't find/, "en-GB": /it means we didn't find/, de: /Wir haben sie nur nicht/, nl: /we vonden het alleen niet/,
      fr: /nous ne l'avons simplement pas trouvé/, es: /significa que no lo encontramos/, pt: /quer dizer que não o encontramos/,
      hi: /इसका मतलब बस इतना है/, tl: /ibig sabihin lang, hindi namin ito nakitang/,
    };
    const OLD_COLLISION: Record<string, RegExp> = {
      en: /two employers use/, "en-GB": /two employers use/, de: /Zwei Arbeitgeber nutzen/, nl: /twee werkgevers gebruiken/,
      fr: /deux employeurs utilisent/, es: /dos empleadores usan/, pt: /dois empregadores usam/, hi: /दो नियोक्ता इस बोर्ड नाम/, tl: /dalawang employer ang gumagamit/,
    };
    const dir = resolve(ROOT, "src/i18n/locales");
    for (const l of Object.keys(OLD_CAUSE)) {
      const perks = JSON.parse(readFileSync(resolve(dir, `${l}.json`), "utf8")).jobsPage.perks as Record<string, string>;
      expect(perks.notListed, `${l} notListed`).not.toMatch(OLD_CAUSE[l]);
      expect(perks.withheldCollision, `${l} withheldCollision`).not.toMatch(OLD_COLLISION[l]);
    }
  });

  it("a stated visa limit carries its share on the label, before anyone opens it", () => {
    const visa = row({ perk: "visa_not_offered", k: 3, n: 30, quote: "This role is not eligible for visa sponsorship." });
    show(answer({ published_keys: ["health", "visa_not_offered"], perks: [row({}), visa] }));
    const limit = screen.getByRole("button", { name: /Visa sponsorship/ });
    expect(limit.textContent).toContain("Visa sponsorship: stated as not available in at least 3 of 30 postings");
    expect(limit).toHaveAttribute("aria-expanded", "false");
  });

  it("the basis line says only postings written in English are read", () => {
    show(answer());
    expect(screen.getByText(/Read from the text of their own open postings written in English; postings in other languages are not read yet\./)).toBeInTheDocument();
  });

  it("a statute narrower than the country names where it applies and links the law for the rest", async () => {
    const user = userEvent.setup();
    const gb = { ...UK_PTO, baseline: { ...(UK_PTO.baseline as Record<string, unknown>), applies_in: "Great Britain",
      also: { statute: "Working Time Regulations (Northern Ireland) 2016, regulations 15 and 16", applies_in: "Northern Ireland",
              source_url: "https://www.legislation.gov.uk/nisr/2016/49/regulation/16" } } };
    show(answer({ published_keys: ["pto"], perks: [gb] }));
    const check = screen.getByRole("button", { name: /Paid time off/ });
    await user.click(check);
    const panel = document.getElementById(check.getAttribute("aria-controls")!)!;
    expect(panel.textContent).toContain("Working Time Regulations 1998, regulations 13 and 13A (Great Britain); Working Time Regulations (Northern Ireland) 2016, regulations 15 and 16 (Northern Ireland)");
    expect(within(panel).getByRole("link", { name: /Northern Ireland\) 2016/ })).toHaveAttribute("href", "https://www.legislation.gov.uk/nisr/2016/49/regulation/16");
    // Half a citation is none: a GB-only statute without the law for the rest is not shown.
    const half = { ...UK_PTO, baseline: { ...(UK_PTO.baseline as Record<string, unknown>), applies_in: "Great Britain" } };
    const again = show(answer({ published_keys: ["pto"], perks: [half] }));
    expect(within(again.container).getByRole("button", { name: /Paid time off/ })).not.toHaveTextContent("may be the legal minimum");
  });
});

describe("the lander mounts it and asks the one reader", () => {
  it("CompanyPerks calls get_employer_perks with the board token and renders its answer", async () => {
    rpcCalls.length = 0;
    rpcAnswer.data = answer();
    render(<MemoryRouter><CompanyPerks companyToken="acme" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", { name: /Health insurance/ })).toBeInTheDocument());
    expect(rpcCalls).toEqual([{ fn: "get_employer_perks", args: { p_token: "acme" } }]);
  });

  it("Jobs.tsx mounts it on the company lander, in code and not only in a comment, and never on a token two hiring systems carry", () => {
    const jobs = codeOf(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));
    expect(jobs).toMatch(/import \{ CompanyPerks \} from "@\/components\/jobs\/CompanyPerks";/);
    expect(jobs).toMatch(/\{landerCompany && !landerCollision && <CompanyPerks companyToken=\{landerCompany\} \/>\}/);
    // Every mount carries the collision term: no second, ungated mount.
    const mounts = jobs.match(/<CompanyPerks\b/g) ?? [];
    expect(mounts.length).toBe(1);
  });
});

describe("every perks string is in all nine locales", () => {
  const LOCALES_DIR = resolve(ROOT, "src/i18n/locales");
  const LOCALES = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  const perksOf = (l: string) => (JSON.parse(readFileSync(resolve(LOCALES_DIR, `${l}.json`), "utf8")).jobsPage?.perks ?? {}) as Record<string, string>;
  const placeholders = (v: string) => [...v.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
  const COMPONENT = codeOf(readFileSync(resolve(ROOT, "src/components/jobs/CompanyPerks.tsx"), "utf8"));
  const calls = [...COMPONENT.matchAll(/(?<![A-Za-z0-9_.])t\(\s*"jobsPage\.perks\.([A-Za-z0-9_]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => ({ key: m[1], fallback: JSON.parse(`"${m[2]}"`) as string }));

  it("covers the nine locales and found the component's calls (guards the guard)", () => {
    expect(LOCALES).toEqual(["de", "en", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"]);
    expect(calls.length).toBeGreaterThanOrEqual(25);
  });

  it("every key the component calls is in English, with the component's own default as its value", () => {
    const en = perksOf("en");
    for (const { key, fallback } of calls) {
      expect(en[key], `jobsPage.perks.${key} is missing from en.json`).toBeDefined();
      expect(en[key], `jobsPage.perks.${key}: the inline default and en.json disagree`).toBe(fallback);
    }
    const called = new Set(calls.map((c) => c.key));
    expect(Object.keys(en).filter((k) => !called.has(k)), "keys in en.json nothing renders").toEqual([]);
  });

  it("every locale has every key, with exactly English's placeholders, and is not English left in place", () => {
    const en = perksOf("en");
    for (const l of LOCALES) {
      const other = perksOf(l);
      expect(Object.keys(other).sort(), `${l}: key set`).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(en)) {
        expect(placeholders(other[k]), `${l} ${k}: placeholders`).toEqual(placeholders(v));
        expect(other[k].trim().length, `${l} ${k}: empty`).toBeGreaterThan(0);
      }
      if (!l.startsWith("en") && l !== "tl") {
        for (const k of ["title", "notListed", "count", "legal", "withheldAgency", "basis"]) {
          expect(other[k], `${l} ${k}: still English`).not.toBe(en[k]);
        }
      }
    }
  });

  it("no threshold, count or date is typed into the copy: each is a placeholder the page fills", () => {
    for (const l of LOCALES) {
      for (const [k, v] of Object.entries(perksOf(l))) {
        const bare = v.replace(/\{\{[^}]*\}\}/g, "");
        expect(bare, `${l} ${k}`).not.toMatch(/\d/);
      }
    }
  });
});
