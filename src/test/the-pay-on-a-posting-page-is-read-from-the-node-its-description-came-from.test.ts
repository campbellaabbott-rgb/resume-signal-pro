/**
 * THE PAY PAYLOCITY AND BREEZY ALREADY PUBLISH ON A PAGE WE ALREADY DOWNLOAD.
 *
 * WHAT THIS GUARDS, and why each part of it exists.
 *
 * 1. THE PAY COMES FROM THE NODE THE DESCRIPTION CAME FROM. Both vendors
 *    server-render a schema.org JobPosting block for Google Jobs, and the
 *    description half of it is the only description source either vendor has.
 *    The pay half was read by nothing. EACH RATE WITH ITS OWN DENOMINATOR, never
 *    merged into one sentence: PAYLOCITY 90 of 240 captured pages (37.5%) and 46
 *    of 150 on an independent draw (30.7%), spread over many tenants. BREEZY 33
 *    of 60 (55.0%) and 33 of 80 (41.3%) — and 29 of those 33 are ONE tenant,
 *    home-genius-exteriors, emitting the identical node across duplicate
 *    subcontractor postings. So the Breezy figure is a fact about one employer's
 *    posting habits and not a vendor coverage rate; quoted as the latter it is
 *    the merged-facet-versus-single-token trap. Any published number must give
 *    Paylocity and Breezy separately with their denominators. Measured
 *    2026-09-26/27. One reader returns both halves precisely so a second walk
 *    cannot pick a different node — a page's pay and its description must
 *    describe the same requisition.
 *
 * 2. THE DESCRIPTION CONTRACT CANNOT MOVE. Widening the reader put the pay on
 *    the critical path of every Breezy and Paylocity description in the board.
 *    The cases here assert, on real captured pages, that deleting the pay node
 *    leaves the description byte-identical — the defect's own state, per the
 *    rule that a guard must break the property where the defect would live,
 *    not where it is convenient to break it.
 *
 * 3. THE VENDOR'S PERIOD LABEL IS EMPLOYER-TYPED AND MEASURABLY WRONG. Three of
 *    41 measured annual-labelled nodes are hourly rates called annual: Purcell
 *    Tire 24–28, Valley Behavioral 45.31–56.64 (whose own posting text prints
 *    "$94,244.88 annually", i.e. 45.31 x 2080), Lindt Sprüngli 16.95. Publishing
 *    one of those understates a wage by a factor of 2,080. Both live Paylocity
 *    rows are fixtures here and both must be refused.
 *
 * 3b. AND EVERY LABEL THE READER ADMITS MUST HAVE A BOUND. The first version of
 *    this reader mapped five period labels and bounded two of them, so DAY, WEEK
 *    and MONTH reached the formatter behind nothing but the shared parser's own
 *    windows — which are exactly the bands a figure of a DIFFERENT period lands
 *    in. The bound now comes from a table typed over every period, so a label
 *    cannot be admitted without a band, and day/week/month state that no band has
 *    been measured and are refused. The Home Genius fixture is why: 5 of 5
 *    measured WEEK nodes are one subcontractor crew's weekly volume, its own
 *    description states no figure at all, and published it became 260,000 in the
 *    column the pay floor, the pay ceiling and the pay sort all read. The case
 *    below asserts the REFUSAL and the annual it would otherwise have produced —
 *    an earlier version of this file pinned the text as correct and never asked
 *    what that text became.
 *
 * 4. A SINGLE FIGURE IS A SINGLE BOUND. Breezy's Oil Changers team member
 *    states 16 to 16 per hour; Robinson Oil states a lone value of 22. Neither
 *    is a range and neither may be printed as one.
 *
 * 5. NOTHING IS ANNUALISED HERE, and the part-time guard is in the path. 7 of 90
 *    measured hourly nodes carry a part-time or casual signal. Robinson Oil's
 *    live row is "Part-time Cashier" at 22.00 per hour: the wage must reach the
 *    card and the 2,080-hour annual must not.
 *
 * 6. THE WRITE FILLS AND NEVER OVERWRITES. Of 90 rows that already state pay, 47
 *    carry this node and 9 disagree with what we hold — two with a period label
 *    that is wrong where our prose parse is right, three on figures in both
 *    directions with no arbiter. Blanket precedence would rewrite 5 of 47
 *    correct ranges. The write site's own expression is pinned below, against
 *    comment-stripped code.
 *
 * Every fixture under fixtures/stated-pay-pages is a live capture; only the
 * structured-data scripts were kept and every byte inside them is the vendor's.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { jobPostingLd } from "../../supabase/functions/job-board/descriptions";
import { ldBaseSalaryText } from "../../supabase/functions/job-board/normalize";
import { parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const page = (name: string) => readFileSync(resolve(ROOT, "src/test/fixtures/stated-pay-pages", name), "utf8");

const PURCELL = "paylocity-purcell-tire-annual-label-on-an-hourly-rate.html";
const VALLEY = "paylocity-valley-behavioral-annual-label-on-an-hourly-rate.html";
const ROBINSON = "paylocity-robinson-oil-part-time-hourly-point.html";
const SUNSHINE = "paylocity-little-sunshines-hourly-range.html";
const PATHFINDER = "paylocity-pathfinder-bank-annual-range.html";
const NO_PAY = "paylocity-no-pay-node.html";
const OIL_CHANGERS = "breezy-oil-changers-equal-bounds.html";
const DRHOUSE = "breezy-drhouse-hourly-at-two-hundred.html";
const HOME_GENIUS = "breezy-home-genius-weekly-point.html";
const ALL = [PURCELL, VALLEY, ROBINSON, SUNSHINE, PATHFINDER, NO_PAY, OIL_CHANGERS, DRHOUSE, HOME_GENIUS];

const payOf = (name: string) => ldBaseSalaryText(jobPostingLd(page(name)).pay);

describe("the pay on a posting page is read from the node its description came from", () => {
  it("reads both halves of the same node on both vendors", () => {
    const paylocity = jobPostingLd(page(SUNSHINE));
    expect(paylocity.description?.length).toBeGreaterThan(100);
    expect(paylocity.pay).toEqual({ currency: "USD", min: 18, max: 22, point: null, unitText: "HOUR" });
    // Breezy pages emit a WebSite node FIRST — the reason the walk checks every
    // node — and the pay must come off the posting node, not that one.
    const breezy = jobPostingLd(page(OIL_CHANGERS));
    expect(breezy.description?.length).toBeGreaterThan(100);
    expect(breezy.pay?.unitText).toBe("HOUR");
  });

  it("leaves the description byte-identical when the pay node is taken away", () => {
    // BREAK THE PROPERTY IN THE STATE THE DEFECT WOULD LIVE IN. A reader that
    // returns the pay by restructuring the walk could change which node wins,
    // or return null for a page whose pay node is malformed, and the symptom
    // would be a missing DESCRIPTION on two whole vendors.
    // The break renames the one key and changes no other byte of the page, so
    // a difference in the description can only have come from the reader.
    for (const name of ALL) {
      const html = page(name);
      const withPay = jobPostingLd(html);
      const blinded = html.replace(/"baseSalary"/g, '"notThePaySalary"');
      expect(blinded.length, name).toBe(html.length + (html.includes('"baseSalary"') ? 5 : 0));
      const withoutPay = jobPostingLd(blinded);
      expect(withoutPay.description, name).toBe(withPay.description);
      expect(withoutPay.pay, name).toBeNull();
    }
    // And the break really did take something away on the pages that carry pay,
    // or the loop above would be asserting nothing on them.
    expect(ALL.filter((n) => jobPostingLd(page(n)).pay !== null).length).toBe(8);
  });

  it("refuses an hourly rate the employer labelled annual", () => {
    // Both live. Without this the board publishes 24.00 as a year's pay.
    expect(jobPostingLd(page(PURCELL)).pay).toEqual({ currency: "USD", min: 24, max: 28, point: null, unitText: "YEAR" });
    expect(payOf(PURCELL)).toBeNull();
    expect(jobPostingLd(page(VALLEY)).pay?.min).toBe(45.31);
    expect(payOf(VALLEY)).toBeNull();
    // Valley's own posting text states the annual equivalent, which is what
    // makes the node's label provably the wrong one rather than merely odd.
    expect(jobPostingLd(page(VALLEY)).description).toContain("94,244.88");
  });

  it("refuses an annual label in the band the shared parser would have accepted", () => {
    // THE PART OF THE ANNUAL RULE THE LIVE ROWS DO NOT REACH, asserted on its
    // own so it cannot be deleted silently. Both fixtures above sit under the
    // parser's own annual floor, so the parser alone refuses them; between that
    // floor and this one the parser accepts the figure and only this bound
    // stops it. No measured node occupies that band (0 of 41 annual-labelled
    // nodes), which is the honest reason it is asserted here rather than as a
    // capture: a full-time annual below 20,000 is beneath the US federal
    // minimum for a full-time year, so the label is the likelier mistake.
    expect(parseSalaryStructured("USD 15,000.00 – 18,000.00 per year", "US", null)?.annualMin).toBe(15000);
    expect(ldBaseSalaryText({ currency: "USD", min: 15000, max: 18000, point: null, unitText: "YEAR" })).toBeNull();
    expect(ldBaseSalaryText({ currency: "USD", min: 21000, max: 24000, point: null, unitText: "YEAR" }))
      .toBe("USD 21,000.00 – 24,000.00 per year");
  });

  it("publishes a label that agrees with its magnitude", () => {
    expect(payOf(SUNSHINE)).toBe("USD 18.00 – 22.00 per hour");
    expect(payOf(PATHFINDER)).toBe("USD 80,000.00 – 115,000.00 per year");
  });

  it("refuses a period label no measured population gave a bound to", () => {
    // THE LIVE ONE. Home Genius Exteriors states {value: 5000, unitText: "WEEK"}
    // on subcontractor crew postings whose own description states no figure at
    // all ("Competitive pay rates and prompt payment"), and 29 of the 33 Breezy
    // nodes found on no-stated-pay rows are this one tenant. The node is read —
    // the reader is not blind to it — and it is refused at the label.
    expect(jobPostingLd(page(HOME_GENIUS)).pay).toMatchObject({ point: 5000, unitText: "WEEK" });
    expect(payOf(HOME_GENIUS)).toBeNull();
    // AND WHAT THE REFUSAL IS WORTH, which pinning the text alone never asked:
    // the sentence this reader used to emit annualises through the shared parser
    // to 260,000 — in salary_min_annual, which salary_rank_usd is generated from,
    // so the row would have entered the pay floor, the pay ceiling and the
    // highest-pay sort at $260k on a figure no employer stated as a wage.
    expect(parseSalaryStructured("USD 5,000.00 per week", "US", null)?.annualMin).toBe(260000);
    // The other two unbounded labels, each with what it would have published.
    expect(ldBaseSalaryText({ currency: "USD", min: 600, max: 720, point: null, unitText: "DAY" })).toBeNull();
    expect(parseSalaryStructured("USD 600.00 – 720.00 per day", "US", null)?.annualMin).toBe(156000);
    expect(ldBaseSalaryText({ currency: "USD", min: 30000, max: null, point: null, unitText: "MONTH" })).toBeNull();
    expect(parseSalaryStructured("USD 30,000.00 per month", "US", null)?.annualMin).toBe(360000);
    // The two labels that DO have a measured band still publish, so this is a
    // bound per label and not the reader switched off.
    expect(payOf(SUNSHINE)).not.toBeNull();
    expect(payOf(PATHFINDER)).not.toBeNull();
  });

  it("cannot admit a period without deciding its band", () => {
    // THE PROPERTY, NOT THE LIST. The bound table is typed over every period the
    // formatter can take, so adding a label to the map without a band is a type
    // error rather than an ungated arm — which is the shape the first version
    // had. Asserted against comment-stripped code: the table's own paragraph
    // names every period, so a guard reading the raw file would pass on prose.
    const NORM = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/normalize.ts"), "utf8"));
    const table = NORM.slice(NORM.indexOf("const LD_PERIOD_BAND"));
    const decl = table.slice(0, table.indexOf("};") + 2);
    expect(decl.length).toBeGreaterThan(60);
    expect(decl).toContain("Record<StatedPayPeriod, { lo: number; hi: number } | null>");
    for (const p of ["hour", "day", "week", "month", "year"]) expect(decl, p).toContain(`${p}:`);
    expect(decl.match(/null,/g)?.length).toBe(3);
  });

  it("refuses an hourly label at or above the magnitude where periods stop being distinguishable", () => {
    // A cost, stated: DrHouse's telemedicine physician at 100–200 per hour is
    // plausible and is thrown away — 3 of 124 measured hourly nodes, one
    // employer. 200 is where an hourly figure stops being separable from a
    // weekly or daily one on magnitude alone, and an employer who mislabels a
    // period is the employer whose figure we cannot check.
    expect(jobPostingLd(page(DRHOUSE)).pay).toEqual({ currency: "USD", min: 100, max: 200, point: null, unitText: "HOUR" });
    expect(payOf(DRHOUSE)).toBeNull();
  });

  it("prints one figure as one bound, never as a range", () => {
    // Equal ends (Oil Changers, live) and a lone value (Robinson Oil, live).
    expect(jobPostingLd(page(OIL_CHANGERS)).pay).toMatchObject({ min: 16, max: 16 });
    expect(payOf(OIL_CHANGERS)).toBe("USD 16.00 per hour");
    expect(payOf(OIL_CHANGERS)).not.toContain("–");
    expect(jobPostingLd(page(ROBINSON)).pay).toMatchObject({ min: null, max: null, point: 22 });
    expect(payOf(ROBINSON)).toBe("USD 22.00 per hour");
    expect(parseSalaryStructured(payOf(ROBINSON), "US", null)?.max).toBeNull();
  });

  it("keeps a lone point a point when a ceiling arrives beside it", () => {
    // THE ARM NO FIXTURE REACHES, and breaking it composes a range out of two
    // different fields: `value` 22 as the floor and `maxValue` 30 as the ceiling,
    // a pair of ends the employer never stated as a pair. Mutating the line that
    // drops the ceiling left all fifteen cases in this file green, which is why
    // the property is asserted here as "a point stays a point" rather than as a
    // refusal — the figure the employer DID state must still reach the card.
    expect(ldBaseSalaryText({ currency: "USD", min: null, max: 30, point: 22, unitText: "HOUR" })).toBe("USD 22.00 per hour");
    expect(ldBaseSalaryText({ currency: "USD", min: null, max: 30, point: 22, unitText: "HOUR" })).not.toContain("30");
  });

  it("says nothing at all when the currency cannot be read", () => {
    // A bare unlabelled number is not a pay statement. This used to be what
    // falling off the end of the ISO-code test produced: the card printed a
    // figure whose unit of account nothing knew, salary_min_annual was written,
    // and the row counted as an employer who disclosed pay.
    expect(ldBaseSalaryText({ currency: "US Dollar", min: 20, max: 22, point: null, unitText: "HOUR" })).toBeNull();
    expect(ldBaseSalaryText({ currency: "$", min: 20, max: 22, point: null, unitText: "HOUR" })).toBeNull();
    expect(ldBaseSalaryText({ currency: null, min: 20, max: 22, point: null, unitText: "HOUR" })).toBeNull();
    // A three-letter code IS published even when the parser can label no
    // currency from it — it is the employer's own answer, and the column then
    // stays null so nothing ranks or filters the row.
    expect(ldBaseSalaryText({ currency: "XYZ", min: 20, max: 22, point: null, unitText: "HOUR" })).toBe("XYZ 20.00 – 22.00 per hour");
    expect(parseSalaryStructured("XYZ 20.00 – 22.00 per hour", "US", null)?.currency).toBeNull();
  });

  it("refuses a numeric string whose comma could be either separator", () => {
    // THE HEADLINE DEFECT OF THIS BUNDLE, one module over. The node's figure is a
    // JSON number on all 127 live nodes, but the type is the vendor's to change,
    // and the reader used to normalise a string by stripping commas — deciding
    // that every comma is a thousands group, which is the exact reading the
    // comma-decimal fix in the shared parser exists to undo. "1,50" became 150
    // and a EUR 1.50 figure would have been served as a EUR 312,000 job.
    const node = (v: unknown) => jobPostingLd(
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        description: "d".repeat(200),
        baseSalary: { "@type": "MonetaryAmount", currency: "EUR", value: { "@type": "QuantitativeValue", value: v, unitText: "HOUR" } },
      })}</script>`,
    );
    expect(node("1,50").pay).toBeNull();
    expect(node("45,50").pay).toBeNull();
    expect(node("3.500,00").pay).toBeNull();
    // The shapes that are not ambiguous are still read, so this is a refusal of
    // one reading and not of numeric strings.
    expect(node("18.50").pay).toMatchObject({ point: 18.5 });
    expect(node(18.5).pay).toMatchObject({ point: 18.5 });
    expect(node("0").pay).toBeNull();
  });

  it("refuses a lone ceiling, a contradicted pair and an unreadable unit", () => {
    // A maximum with no minimum is "up to", which is not this job's pay.
    expect(ldBaseSalaryText({ currency: "USD", min: null, max: 40, point: null, unitText: "HOUR" })).toBeNull();
    expect(ldBaseSalaryText({ currency: "USD", min: 40, max: 30, point: null, unitText: "HOUR" })).toBeNull();
    expect(ldBaseSalaryText({ currency: "USD", min: 20, max: 30, point: null, unitText: "FORTNIGHT" })).toBeNull();
    expect(ldBaseSalaryText({ currency: "USD", min: 20, max: 30, point: null, unitText: null })).toBeNull();
    // Below the parser's own hourly floor, which this reader does not restate.
    expect(ldBaseSalaryText({ currency: "USD", min: 4, max: 6, point: null, unitText: "HOUR" })).toBeNull();
    expect(ldBaseSalaryText(null)).toBeNull();
  });

  it("states the vendor's currency rather than one derived from the row's country", () => {
    // A bare "$" resolves through the row's country, so a Canadian row carrying
    // a USD field would have been relabelled CAD. The ISO code the vendor stated
    // is what the parser reads back.
    expect(parseSalaryStructured(payOf(SUNSHINE), "CA", null)?.currency).toBe("USD");
    expect(parseSalaryStructured("$18.00 – 22.00 per hour", "CA", null)?.currency).toBe("CAD");
  });

  it("keeps a part-time wage visible and its annual refused", () => {
    // Live: Robinson Oil's "Part-time Cashier (RR33 Santa Clara)" at 22.00 per
    // hour. Annualising that at 2,080 hours is the $44/hr → $91,520 defect.
    const ld = jobPostingLd(page(ROBINSON));
    const text = ldBaseSalaryText(ld.pay);
    const read = parseSalaryStructured(text, "US", { title: "Part-time Cashier (RR33 Santa Clara)", description: ld.description });
    expect(read?.min).toBe(22);
    expect(read?.annualMin).toBeNull();
    expect(read?.partTimeSignal).toBe("part-time");
    // Same figure on a full-time posting keeps its annual, so the suppression
    // is about this posting and not about the reader.
    expect(parseSalaryStructured(text, "US", { title: "Cashier", description: null })?.annualMin).toBe(45760);
  });

  it("annualises through the shared parser and never by its own arithmetic", () => {
    // The reader emits a sentence; the parser owns every multiplier. The only
    // multiplication asserted here is the one the parser publishes.
    const read = parseSalaryStructured(payOf(SUNSHINE), "US", null);
    expect(read?.period).toBe("hour");
    expect(read?.annualMin).toBe(37440);
    expect(read?.annualMax).toBe(45760);
    expect(read?.annualMultiplier).toBe(2080);
  });

  it("says nothing on a page whose employer stated nothing", () => {
    expect(jobPostingLd(page(NO_PAY)).description?.length).toBeGreaterThan(100);
    expect(jobPostingLd(page(NO_PAY)).pay).toBeNull();
    expect(payOf(NO_PAY)).toBeNull();
  });

  it("is wired on exactly the two vendors whose page carries the node", () => {
    // jazzhr emits the same block but reaches it through its own parser, and no
    // other branch of the detail fetch has a node to read — a third call site
    // here would mean some vendor's payload is being read as a shape it is not.
    const CODE = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
    expect(CODE.match(/ldBaseSalaryText\(ld\.pay\)/g)?.length).toBe(2);
    expect(CODE.match(/const ld = jobPostingLd\(await res\.text\(\)\)/g)?.length).toBe(2);
  });

  it("fills the pay column and never overwrites what the posting's own text gave us", () => {
    // THE PRECEDENCE INVERSION, PINNED. This field is a second free-typed box in
    // the same employer form as the prose and its error rate is higher than our
    // parse of that prose, so it loses to both the text this hop mined and the
    // text the row already held. The whole expression is pinned, not a key
    // another key could contain, and against comment-stripped code so the
    // paragraph explaining the rule cannot satisfy the guard.
    const CODE = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
    expect(CODE).toContain("const statedPay = minedSalary ?? (row.salary ? null : vendorPay);");
    // The row's own stored pay has to be SELECTED for that rule to be a fact
    // rather than an assumption about which writers can reach the row. PINNED AS
    // THE PROPERTY, NOT THE LIST: this file's first draft pinned the whole
    // eleven-column literal, which is the guard shape the same bundle had to
    // loosen one file over — the next column added for an unrelated reason turns
    // a whole-list pin red on correct work. What matters is that the select
    // carrying the description-null predicate also carries `salary`.
    expect(CODE).toMatch(/\.select\("[^"]*\bsalary\b[^"]*"\)[\s\S]{0,400}\.is\("description", null\)/);
    // One parse, with the same page's description as part-time context.
    expect(CODE).toContain("const statedParse = statedPay ? parseSalaryStructured(statedPay, salaryCountry, { title: (row as { title?: string | null }).title ?? null, description: clean }) : null;");
    expect(CODE).toContain("salary: statedPay,");
  });

  it("does not fetch the pay in the reader-facing lane and then throw it away", () => {
    // THE LEAK THAT WAS PERMANENT PER ROW. The demand-weighted `detail` action
    // fetches the same page, and it used to destructure only the text. Every
    // writer that can fill these vendors' descriptions is gated on description
    // being null, so once this lane persisted the description the row left the
    // desc sweep for good — and the SALARY_PARSE_VERSION re-sweep cannot recover
    // it either, because that lane re-reads stored salary TEXT and this row's
    // salary is null. Measured description-null backlog 2026-09-27: paylocity
    // 2,578, breezy 512, and the prose miner finds pay on 0 of these rows.
    //
    // Pinned as three facts about the lane, each an expression: the reader
    // returns both halves, the CACHE carries both (a hit must answer the same
    // question a miss does, or the leak returns intermittently), and the write
    // applies the SAME fill-only rule as the sweep.
    const CODE = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
    expect(CODE).toContain("const { text, pay } = await fetchVendorDetail(src, id, externalId, applyUrl);");
    expect(CODE).toContain("detailCache.set(id, { at: Date.now(), text, pay });");
    expect(CODE).toContain("if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return { text: hit.text, pay: hit.pay };");
    expect(CODE).toContain("const statedPay = minedSalary ?? (jobRow.salary ? null : vendorPay);");
    expect(CODE).toContain("const vendorPay = fetched?.pay ?? null;");
    // Two lanes, two fill-only expressions, and they are the same rule written
    // over each lane's own row variable — not one lane's rule inferred from the
    // other's. A third writer of this field would break the count.
    expect(CODE.match(/minedSalary \?\? \((?:row|jobRow)\.salary \? null : vendorPay\)/g)?.length).toBe(2);
    // And the salvage branch — a payload with pay but no usable description,
    // measured 0 of 356 pages — carries it rather than dropping it silently.
    expect(CODE).toContain("if (vendorPay && !row.salary) {");
    expect(CODE).toContain("const q = salv.salary ? q0.is(\"salary\", null) : q0;");
  });

  it("reads pay through the shared parser rather than a second copy of its rules", () => {
    // WHY THERE IS NO PIN ON THE PARSE VERSION HERE. This change writes NEW pay
    // text and changes nothing about how STORED text is read, so it needs no
    // re-sweep of the stored column — but the version that governs that sweep is
    // not this change's to assert either, and a guard pinning its number would
    // go red the next time someone correctly moves it. Pinning a value another
    // change legitimately owns is how guards teach people to edit guards.
    //
    // The property that IS this change's: the magnitude windows, the
    // annualisation and the part-time rule have exactly one implementation, and
    // these readers reach it rather than restating it. So neither reader may
    // carry a multiplier or a threshold of its own.
    const NORM = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/normalize.ts"), "utf8"));
    const reader = NORM.slice(NORM.indexOf("export function ldBaseSalaryText"));
    const body = reader.slice(0, reader.indexOf("\n}\n") + 3);
    // An empty slice would satisfy every assertion below it.
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain("statedPayText(");
    // NO NUMBER OF ITS OWN, ASSERTED AS WRITTEN. The first version of this case
    // claimed the reader "may not carry a multiplier or a threshold of its own"
    // and then forbade only multipliers — while the body held 200 and 20_000, two
    // thresholds, documented as such three lines above them. The bounds now live
    // in one table and the reader has NO numeric literal at all, so the stated
    // property and the assertion are the same thing and a threshold added back
    // here goes red.
    expect(body).not.toMatch(/\d/);
    expect(NORM).toContain('import { LOAD_DEPENDENT_PERIODS, parseSalaryStructured } from "../_shared/salary-extract.ts";');
  });
});
