/**
 * A FEED ENTITY IS DECODED ONCE (S14X-216, the interface half).
 *
 * An XML feed escapes the text it carries, so a title read straight out of the
 * element arrives as "R&amp;D Engineer". The row half of this item (titles and
 * departments read decoded) and the log half (a title that differs from the
 * stored one only by entities is our reading, not an employer edit) both need
 * two things from normalize.ts that it did not export: a reader that decodes
 * an element's text exactly once, and the decode itself, so the log half can
 * compare a stored title with a fresh one under the same rule.
 *
 * ONCE, NOT TWICE. htmlToText decodes twice because HTML that travels inside an
 * escaped payload carries a second layer. A title is text, not HTML: one decode
 * is the XML layer and a second would turn an employer's own escaped text into
 * something else. Description HTML is the opposite case. It must stay on the
 * raw element value, because htmlToText already supplies both decodes it needs,
 * and a third (decoding first) turns escaped text into markup and drops it.
 *
 * THE ROW HALF. normalizePersonio and normalizeTeamtailor read the title and the
 * department through xmlText, so "R&amp;D Engineer" reaches the board as "R&D
 * Engineer". Descriptions are read in index.ts on the raw value, as above.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  htmlToText,
  normalizePersonio,
  normalizeTeamtailor,
  unescapeEntities,
  xmlText,
  xmlValue,
} from "../../supabase/functions/job-board/normalize";
import { codeOf } from "./helpers/strip-comments";

describe("a feed entity is decoded once", () => {
  it("normalize.ts exports the decode htmlToText applies, and a reader that applies it to one element", () => {
    expect(typeof unescapeEntities, "unescapeEntities is not exported from normalize.ts").toBe("function");
    expect(typeof xmlText, "xmlText is not exported from normalize.ts").toBe("function");
  });

  it("a title read through xmlText has its entities decoded, where xmlValue leaves them", () => {
    const item = "<item><title>A &amp; B</title><tt:department>R&amp;D &#8211; Lab</tt:department></item>";
    expect(xmlValue(item, "title")).toBe("A &amp; B");
    expect(xmlText(item, "title")).toBe("A & B");
    expect(xmlText(item, "tt:department")).toBe("R&D – Lab");
  });

  it("the decode runs once: an employer's doubly escaped title keeps its second layer", () => {
    expect(xmlText("<name>R&amp;amp;D</name>", "name")).toBe("R&amp;D");
    expect(unescapeEntities("R&amp;amp;D")).toBe("R&amp;D");
  });

  it("CDATA is unwrapped first, as xmlValue does, then decoded once", () => {
    expect(xmlText("<name><![CDATA[Sales &amp; Marketing]]></name>", "name")).toBe("Sales & Marketing");
  });

  it("an absent element, or one that decodes to nothing but space, reads null like xmlValue", () => {
    expect(xmlText("<item><title>x</title></item>", "department")).toBeNull();
    expect(xmlText("<item><department>&nbsp;</department></item>", "department")).toBeNull();
    expect(xmlText("<item><title> &nbsp;Engineer&nbsp; </title></item>", "title")).toBe("Engineer");
  });

  it("htmlToText is the same decode applied twice, so the export is the rule the description path already uses", () => {
    const plain = "R&amp;amp;D &#8211; Lab";
    expect(htmlToText(plain)).toBe(unescapeEntities(unescapeEntities(plain)));
    expect(htmlToText(plain)).toBe("R&D – Lab");
  });

  it("description HTML stays on the raw value: decoding it first would make an escaped tag real and drop it", () => {
    const item = "<item><description>Use &amp;amp;lt;br&amp;amp;gt; here</description></item>";
    // The XML layer plus the HTML layer: two decodes, which htmlToText supplies.
    expect(htmlToText(xmlValue(item, "description") ?? "")).toBe("Use &lt;br&gt; here");
    // Through xmlText first it is three, the escaped tag becomes a line break and the text changes.
    expect(htmlToText(xmlText(item, "description") ?? "")).not.toBe("Use &lt;br&gt; here");
  });
});

describe("a Personio or Teamtailor row carries its title and department decoded once", () => {
  const fixture = (f: string) => readFileSync(resolve(__dirname, "fixtures", f), "utf8");

  it("Teamtailor: an escaped title and department reach the row as the employer wrote them", () => {
    const rss = `<rss xmlns:tt="https://teamtailor.com/locations"><channel><item>
      <title>R&amp;D Engineer &#8211; Batteries</title><description>&lt;p&gt;Build &amp;amp; test&lt;/p&gt;</description>
      <pubDate>Tue, 25 Aug 2026 10:48:06 +0200</pubDate><link>https://acme.teamtailor.com/jobs/8264989-r-d-engineer</link>
      <remoteStatus>none</remoteStatus><tt:city>Lund</tt:city><tt:country>Sweden</tt:country>
      <tt:department>Research &amp; Development</tt:department></item></channel></rss>`;
    const [row] = normalizeTeamtailor(rss, "Acme", "acme");
    expect(row.title).toBe("R&D Engineer – Batteries");
    expect(row.department).toBe("Research & Development");
    expect(row.title).not.toContain("&amp;");
  });

  it("Personio: an escaped name and department reach the row decoded, and a doubly escaped one keeps its second layer", () => {
    const xml = `<workzag-jobs><position><id>2245</id><office>Berlin</office>
      <department>Sales &amp; Marketing</department><name>Head of R&amp;D (m/w/d)</name>
      <jobDescriptions><jobDescription><name>Stelle</name><value>&lt;p&gt;x&lt;/p&gt;</value></jobDescription></jobDescriptions>
      <createdAt>2026-11-01T10:00:00+00:00</createdAt></position><position><id>2246</id><office>Berlin</office>
      <name>Q&amp;amp;A Lead</name><createdAt>2026-11-01T10:00:00+00:00</createdAt></position></workzag-jobs>`;
    const [a, b] = normalizePersonio(xml, "Acme", "acme", "jobs.personio.de");
    expect(a.title).toBe("Head of R&D (m/w/d)");
    expect(a.department).toBe("Sales & Marketing");
    expect(b.title).toBe("Q&amp;A Lead");
  });

  it("the shipped fixtures, which carry no escaped title, read exactly as before", () => {
    const tt = normalizeTeamtailor(fixture("teamtailor-jobs.rss"), "Capio", "capio");
    expect(tt.length).toBeGreaterThan(1);
    expect(tt[0].title).toBe("Allmänspecialist/ leg läkare till Capio vårdcentral Båstad");
    expect(tt[0].department).toBe("Läkare");
    const px = normalizePersonio(fixture("personio-stated-pay.xml"), "Acme", "acme", "jobs.personio.de");
    expect(px.map((r) => r.title)).toContain("Minijobber (m/w/d) Sales");
    expect(px.map((r) => r.department)).toContain("Retail");
  });

  it("titles and departments go through xmlText; a description is never read through it", () => {
    const code = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/job-board/normalize.ts"), "utf8"));
    expect(code).toContain('const title = xmlText(block, "name")');
    expect(code).toContain('const department = xmlText(block, "department")');
    expect(code).toContain('const title = xmlText(item, "title")');
    expect(code).toContain('department: xmlText(item, "tt:department")');
    expect(code).not.toMatch(/xmlText\([^)]*"(?:description|value|jobDescription)"/);
    const index = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8"));
    expect(index).not.toMatch(/xmlText\([^)]*"(?:description|value)"/);
  });
});
