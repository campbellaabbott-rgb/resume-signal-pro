/**
 * A REWRITE LANDS ONLY ON ITS OWN BULLET, IN ANY SCRIPT, AND NEVER AS A
 * TEMPLATE (registers S13-025 and S13-038, the page half).
 *
 * S13-025. builder-import normalised bullets with [^a-z0-9], so a Devanagari
 * or Cyrillic bullet collapsed to its digits or to ''. A Hindi rewrite for
 * "halved the release cycle in 6 months" overwrote "led a team of 6
 * engineers" (both keyed "6"), a bullet with no digits was skipped forever,
 * and the toast still counted the fix. Keys now keep every script's letters
 * and marks, and a key with fewer than two letters never matches.
 *
 * S13-038. When the scan could not ground a rewrite it sent an instruction
 * template as the rewrite ("Led [what you did] for ..., achieving [metric] —
 * rewrite this bullet ..."), and "Open in builder with fixes applied" wrote it
 * over the person's real bullet. The scanner now sends rewrite: null and the
 * template as rewriteTemplate. The report hands the builder only a real
 * rewrite, never one with an unfilled [placeholder] (older stored reports
 * carry them), and the builder refuses them too. The card shows a template as
 * guidance, never as the rewrite.
 *
 * Review fix (2026-11-01). The box still promised "fixes applied" over a
 * report whose every rewrite was refused, and the builder then applied
 * nothing. It now counts the rewrites it hands over and, with none, offers
 * the résumé and the missing keywords instead; the guidance template is said
 * in the reader's language from the scanner's code (S13-122).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createEmptyResume, type BuilderResume } from "@/types/resume-builder";
import { applyScanRewrites, isUsableRewrite } from "@/lib/builder-import";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import en from "@/i18n/locales/en.json";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  Object.assign(chain, {
    select: q, eq: q, in: q, order: q, limit: q, gte: q, lte: q, insert: q, upsert: q, update: q,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { WeakestBulletsCard } from "@/components/ReportInsightCards";

const withBullets = (bullets: string[]): BuilderResume => {
  const r = createEmptyResume();
  r.experience = [{ ...r.experience[0], title: "Role", company: "Co", bullets }];
  return r;
};

describe("S13-025: a key keeps every script's letters", () => {
  const cases: Array<[string, string[], Array<{ before: string; after: string }>]> = [
    ["Hindi", [
      "6 इंजीनियरों की टीम का नेतृत्व किया",
      "6 महीनों में रिलीज़ चक्र आधा किया",
      "ग्राहकों की शिकायतों का समाधान किया",
    ], [
      { before: "6 महीनों में रिलीज़ चक्र आधा किया", after: "6 महीनों में रिलीज़ चक्र 50% घटाया, 4 टीमों के साथ" },
      { before: "ग्राहकों की शिकायतों का समाधान किया", after: "हर हफ़्ते 40 ग्राहक शिकायतें 24 घंटे में सुलझाईं" },
    ]],
    ["Russian", [
      "Руководил командой из 6 инженеров",
      "Сократил цикл релиза вдвое за 6 месяцев",
      "Решал жалобы клиентов",
    ], [
      { before: "Сократил цикл релиза вдвое за 6 месяцев", after: "Сократил цикл релиза на 50% за 6 месяцев вместе с 4 командами" },
      { before: "Решал жалобы клиентов", after: "Закрывал 40 жалоб клиентов в неделю в течение 24 часов" },
    ]],
    ["English control", [
      "Led a team of 6 engineers",
      "Halved the release cycle in 6 months",
      "Handled customer complaints",
    ], [
      { before: "Halved the release cycle in 6 months", after: "Cut the release cycle 50% in 6 months across 4 teams" },
      { before: "Handled customer complaints", after: "Resolved 40 customer complaints a week within 24 hours" },
    ]],
  ];
  for (const [name, bullets, rewrites] of cases) {
    it(`${name}: each rewrite replaces its own bullet and the first is untouched`, () => {
      const { resume, applied } = applyScanRewrites(withBullets(bullets), rewrites);
      expect(applied).toBe(2);
      expect(resume.experience[0].bullets).toEqual([bullets[0], rewrites[0].after, rewrites[1].after]);
    });
  }

  it("a key with fewer than two letters never pairs, so digits alone cannot match", () => {
    const bullets = ["2019", "+44 20 7946 0000", "Led a team of 6 engineers"];
    const { resume, applied } = applyScanRewrites(withBullets(bullets), [
      { before: "2019", after: "Rewritten year" },
      { before: "+44 20 7946 0000", after: "Rewritten phone" },
    ]);
    expect(applied).toBe(0);
    expect(resume.experience[0].bullets).toEqual(bullets);
  });
});

describe("S13-038: a template or an unfilled placeholder is never written over a bullet", () => {
  const TEMPLATE = "Led [what you did] for Office Coordinator, achieving [metric] — rewrite this bullet to open with an action verb and end with a number.";
  it("isUsableRewrite refuses null, blanks and bracket placeholders", () => {
    expect(isUsableRewrite(null)).toBe(false);
    expect(isUsableRewrite(undefined)).toBe(false);
    expect(isUsableRewrite("   ")).toBe(false);
    expect(isUsableRewrite(TEMPLATE)).toBe(false);
    expect(isUsableRewrite("Cut costs by [X]% in a year")).toBe(false);
    expect(isUsableRewrite("Cut vendor costs 12% in a year")).toBe(true);
    expect(isUsableRewrite("Shipped v2 [beta] to 3 clients")).toBe(false);
  });

  it("the builder keeps the real bullet when a stored handoff still carries a template", () => {
    const bullets = ["Helped the office manager reconcile insurance claims every week", "Assisted patients at the front desk"];
    const { resume, applied } = applyScanRewrites(withBullets(bullets), [
      { before: bullets[0], after: TEMPLATE },
      { before: bullets[1], after: "Checked in 60 patients a day at the front desk" },
    ]);
    expect(applied).toBe(1);
    expect(resume.experience[0].bullets).toEqual([bullets[0], "Checked in 60 patients a day at the front desk"]);
  });
});

describe("S13-038: the report hands the builder only real rewrites", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => cleanup());

  const RESUME = "Jordan Probe\nOffice Coordinator, Desert Dental Group, 2019 - Present\n- Helped the office manager reconcile insurance claims every week\n- Assisted patients at the front desk\n- Responsible for scheduling appointments\n".repeat(2);
  const bullets = [
    { original: "Helped the office manager reconcile insurance claims every week", grade: "D", issues: ["weak verb"], rewrite: null, rewriteTemplate: "Led [what you did] for Office Coordinator, achieving [metric] — rewrite this bullet…" },
    { original: "Responsible for scheduling appointments", grade: "D", issues: ["no number"], rewrite: "Scheduled [X] appointments a week" },
    { original: "Assisted patients at the front desk", grade: "C", issues: ["no number"], rewrite: "Checked in 60 patients a day at the front desk" },
  ];

  it("writes only the grounded, filled rewrite into the handoff", () => {
    render(
      <MemoryRouter>
        <FreeKeywordResults
          industry="healthcare" atsScoreEstimate={58} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
          redFlags={[]} keywords={[]} resumeText={RESUME}
          sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
          weakestBullets={bullets as never}
          additionalRewrites={[{ before: "Assisted patients at the front desk", after: "Led [what you did]", improvement: "x" }]}
          onGetFullAnalysis={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Open in builder: 1 rewrite to apply →"));
    const fixes = JSON.parse(sessionStorage.getItem("rb_scan_fixes") ?? "null");
    expect(fixes?.rewrites).toEqual([{ before: "Assisted patients at the front desk", after: "Checked in 60 patients a day at the front desk" }]);
  });

  it("the card shows a template as guidance, not as the rewrite", () => {
    const { container } = render(<WeakestBulletsCard bullets={bullets as never} />);
    const rewrites = [...container.querySelectorAll("[data-bullet-rewrite]")].map((e) => e.textContent);
    const guides = [...container.querySelectorAll("[data-bullet-rewrite-template]")].map((e) => e.textContent);
    expect(rewrites.some((r) => r?.includes("[what you did]")), "a template was shown as a rewrite").toBe(false);
    expect(guides.some((g) => g?.includes("[what you did]"))).toBe(true);
    expect(rewrites).toContain("Checked in 60 patients a day at the front desk");
  });

  const mountReport = (weakest: unknown[], extra: unknown[] = []) => render(
    <MemoryRouter>
      <FreeKeywordResults
        industry="healthcare" atsScoreEstimate={58} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
        redFlags={[]} keywords={[{ keyword: "medical billing", reason: "Named in the posting", impact: "high", category: "skill" }] as never} resumeText={RESUME}
        sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
        weakestBullets={weakest as never}
        additionalRewrites={extra as never}
        onGetFullAnalysis={vi.fn()}
      />
    </MemoryRouter>,
  );

  it("the box says how many rewrites it hands over, and hands over exactly those", () => {
    const { container } = mountReport(bullets, [
      { before: "Responsible for scheduling appointments", after: "Booked 120 appointments a week for 4 dentists", improvement: "x" },
    ]);
    const box = container.querySelector("[data-builder-handoff]")!;
    // A ceiling, not a count of what lands: the builder applies a rewrite
    // only where its bullet is in the draft (S13-038 recheck).
    expect(box.textContent).toContain("this report's 2 bullet rewrites applied wherever they match your bullets");
    expect(box.textContent).not.toMatch(/already applied/);
    fireEvent.click(screen.getByText("Open in builder: 2 rewrites to apply →"));
    const fixes = JSON.parse(sessionStorage.getItem("rb_scan_fixes") ?? "null");
    expect(fixes?.rewrites).toHaveLength(2);
    expect(box.textContent).not.toMatch(/fixes applied/);
  });

  it("with no rewrite to apply, it offers the résumé and the missing keywords, and promises no fix", () => {
    const templatesOnly = bullets.filter((b) => b.rewrite === null || /\[/.test(b.rewrite ?? ""));
    const { container } = mountReport(templatesOnly);
    const box = container.querySelector("[data-builder-handoff]")!;
    expect(box.textContent).toContain(en.freeResults.builderHandoff.bodyNoRewrites);
    expect(box.textContent).not.toMatch(/applied →|fixes applied/);
    fireEvent.click(screen.getByText(en.freeResults.builderHandoff.ctaNoRewrites));
    const fixes = JSON.parse(sessionStorage.getItem("rb_scan_fixes") ?? "null");
    expect(fixes?.rewrites).toEqual([]);
    expect(fixes?.keywords).toEqual(["medical billing"]);
    expect(sessionStorage.getItem("rb_resume_text")).toBe(RESUME);
  });

  it("every locale words the box, the translations their own", () => {
    const dir = resolve(__dirname, "../i18n/locales");
    const enBox = en.freeResults.builderHandoff as Record<string, string>;
    for (const loc of ["de", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const box = JSON.parse(readFileSync(resolve(dir, `${loc}.json`), "utf8")).freeResults.builderHandoff as Record<string, string>;
      for (const k of ["title", "bodyRewrites_one", "bodyRewrites_other", "bodyNoRewrites", "ctaRewrites_one", "ctaRewrites_other", "ctaNoRewrites"]) {
        expect(box[k], `${loc} ${k}`).toBeTruthy();
        if (k.startsWith("bodyRewrites") || k.startsWith("ctaRewrites")) expect(box[k], `${loc} ${k}`).toContain("{{count}}");
        if (loc !== "en-GB") expect(box[k], `${loc} ${k} is the English`).not.toBe(enBox[k]);
      }
    }
  });

  it("a scanner template code is said in the reader's language, not the English text it carries", () => {
    const { container } = render(<WeakestBulletsCard bullets={[
      { original: "Helped with billing", grade: "D", issues: ["weak verb"], rewrite: null, rewriteTemplate: "ENGLISH FALLBACK [x]", rewriteTemplateCode: "verbAndNumber" },
    ] as never} />);
    const guide = container.querySelector("[data-bullet-rewrite-template]")?.textContent ?? "";
    expect(guide).toContain(en.freeResults.weakestBullets.template.verbAndNumber);
    expect(guide).not.toContain("ENGLISH FALLBACK");
  });
});
