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
 */
import { describe, expect, it } from "vitest";
import {
  htmlToText,
  unescapeEntities,
  xmlText,
  xmlValue,
} from "../../supabase/functions/job-board/normalize";

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
