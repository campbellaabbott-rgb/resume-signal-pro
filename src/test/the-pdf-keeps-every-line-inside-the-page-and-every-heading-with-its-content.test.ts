// @vitest-environment node
/**
 * THE PDF KEEPS EVERY LINE INSIDE THE PAGE, AND EVERY HEADING WITH ITS
 * CONTENT (S14X-186: M-S14-162, C-S14-043; S14X-287: C-S14-138).
 *
 * S14X-186. Skills, certifications and the contact line are laid out by hand
 * so the " • " separator sits only between two items. An item that did not
 * fit moved to the next line whole, and the first item was never measured at
 * all, so one long skill ("Languages & Frameworks: TypeScript, JavaScript,
 * ...") was drawn as a single run that ended 40 mm past the edge of an A4
 * page. Now an item wider than the text column is wrapped on its own.
 *
 * S14X-287. A section heading reserved room for itself only. With a summary
 * of the wrong length the EXPERIENCE heading was the last thing on page 1 and
 * its first job opened page 2. A heading now reserves room for the first
 * thing under it, and moves to the next page with it.
 *
 * The real jsPDF draws; every text() call is recorded with the page it lands
 * on and its measured width.
 */
import { describe, expect, it, vi } from "vitest";
import type { BuilderResume } from "../types/resume-builder";

type Draw = { s: string; x: number; y: number; align?: string; page: number; w: number };
const draws: Draw[] = [];

vi.mock("jspdf", async (importOriginal) => {
  const m = await importOriginal<typeof import("jspdf")>();
  function Recording(this: unknown, ...args: unknown[]) {
    const pdf = new (m.jsPDF as unknown as new (...a: unknown[]) => InstanceType<typeof m.jsPDF>)(...args);
    const text = pdf.text.bind(pdf) as (...a: unknown[]) => unknown;
    (pdf as unknown as { text: (...a: unknown[]) => unknown }).text = (s: unknown, x: number, y: number, o?: { align?: string }, ...rest: unknown[]) => {
      for (const line of Array.isArray(s) ? s : [String(s)]) {
        draws.push({ s: String(line), x, y, align: o?.align, page: pdf.getCurrentPageInfo().pageNumber, w: pdf.getTextWidth(String(line)) });
      }
      return text(s, x, y, o, ...rest);
    };
    return pdf;
  }
  return { ...m, default: Recording, jsPDF: Recording };
});

import { buildResumePdf } from "../lib/resume-builder-export";

const base = (): BuilderResume => ({
  contact: { fullName: "Jordan Probe", title: "Analyst", email: "jordan@example.com", phone: "", location: "Austin, TX", linkedIn: "", website: "" },
  summary: "Analyst with five years of work in the team and the role.",
  experience: [{ id: "e1", company: "Acme", title: "Analyst", location: "", startDate: "2020", endDate: "2024", bullets: ["Built the weekly report for the team and cut the time it takes by half."] }],
  education: [{ id: "d1", school: "State University", degree: "BS", field: "Economics", startDate: "", endDate: "2019", details: "" }],
  skills: ["SQL", "Python"],
  certifications: [],
});

async function drawn(r: BuilderResume) {
  draws.length = 0;
  const pdf = await buildResumePdf(r);
  return { d: draws.slice(), pageWidth: pdf.internal.pageSize.getWidth() };
}

const MARGIN = 18; // the modern template's margin, in mm

describe("every line ends inside the right margin (S14X-186)", () => {
  it("a skill, a certification and a contact item wider than the page are wrapped", async () => {
    const r = base();
    r.skills = ["Languages & Frameworks: TypeScript, JavaScript, Python, Go, Rust, React, Next.js, Node.js, Express, Django, FastAPI, Kubernetes, Terraform, PostgreSQL", "SQL"];
    r.certifications = ["AWS Certified Solutions Architect – Professional, Google Cloud Professional Data Engineer, Certified Kubernetes Administrator"];
    r.contact.website = "https://example.com/portfolio/a-very-long-path/that-keeps-going/and-going/until-it-is-wider-than-the-page";
    const { d, pageWidth } = await drawn(r);
    const ends = d.map((x) => ({ s: x.s, end: x.align === "right" ? x.x : x.x + x.w }));
    const widest = ends.reduce((a, b) => (b.end > a.end ? b : a));
    expect(widest.end, `"${widest.s}" ends at ${widest.end.toFixed(1)} mm`).toBeLessThanOrEqual(pageWidth - MARGIN + 1.5);
    // Nothing was dropped: every word of the long skill is drawn somewhere.
    const all = d.map((x) => x.s).join(" ");
    for (const w of ["Languages", "Kubernetes", "PostgreSQL", "Administrator", "until-it-is"]) expect(all).toContain(w);
  });

  it("short items still share a line, separated only between items", async () => {
    const r = base();
    r.skills = ["SQL", "Python", "Tableau"];
    const { d } = await drawn(r);
    expect(d.some((x) => x.s === "SQL  •  Python  •  Tableau")).toBe(true);
  });
});

describe("a heading moves to the next page with its first entry (S14X-287)", () => {
  it("the EXPERIENCE heading is never the last thing on a page, for summaries of 1 to 70 lines", async () => {
    const orphaned: number[] = [];
    for (let n = 1; n <= 70; n++) {
      const r = base();
      r.summary = Array.from({ length: n }, (_, i) => `Line ${i + 1} of the summary.`).join("\n");
      const { d } = await drawn(r);
      const i = d.findIndex((x) => x.s === "EXPERIENCE");
      expect(i, `no EXPERIENCE heading with ${n} lines`).toBeGreaterThanOrEqual(0);
      if (d[i + 1] && d[i + 1].page !== d[i].page) orphaned.push(n);
    }
    expect(orphaned, "summary lengths that left the heading alone at a page foot").toEqual([]);
  });

  it("the EDUCATION and SKILLS headings keep their first line too", async () => {
    const orphaned: string[] = [];
    for (let n = 1; n <= 70; n++) {
      const r = base();
      r.experience[0].bullets = Array.from({ length: n }, (_, i) => `Bullet ${i + 1} of the job.`);
      const { d } = await drawn(r);
      for (const h of ["EDUCATION", "SKILLS"]) {
        const i = d.findIndex((x) => x.s === h);
        if (i >= 0 && d[i + 1] && d[i + 1].page !== d[i].page) orphaned.push(`${h} at ${n}`);
      }
    }
    expect(orphaned).toEqual([]);
  });
});
