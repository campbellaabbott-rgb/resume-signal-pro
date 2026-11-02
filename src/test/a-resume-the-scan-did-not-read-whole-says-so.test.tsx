/**
 * A RÉSUMÉ THE SCAN DID NOT READ WHOLE SAYS SO, AND ONE THE SCAN WILL REFUSE
 * IS REFUSED BEFORE IT IS SENT (register S13-008, the page half).
 *
 * The scanner put only the first 20,000 characters of a CV in its prompt and
 * said nothing, so an 11-page CV was scored, keyword-gapped and page-counted
 * on its first half under a report that read as the whole document. The
 * scanner now reads up to its own cap and answers resumeTruncated: true when
 * anything was still cut; the report must say so. And the client let through
 * up to 100,000 characters against the scanner's 50,000, so a long CV
 * "uploaded" and was then refused with a 400.
 *
 * Review fix (2026-11-01). The client's cap was right but nothing on the free
 * scan's path read it. The uploader now says so under the box as soon as the
 * text is pasted or read (the homepage's refusal is held in
 * a-resume-longer-than-the-scan-reads-is-refused-before-it-is-sent).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
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
vi.mock("@/contexts/AuthContext", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useAuth: () => ({ session: null, user: null, loading: false }),
}));
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { MAX_RESUME_LENGTH, validateResumeBeforeSend } from "@/lib/resume-validation";
import { ResumeUploader } from "@/components/ResumeUploader";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const report = (extra: Record<string, unknown>) => render(
  <MemoryRouter>
    <FreeKeywordResults
      industry="healthcare"
      atsScoreEstimate={66}
      formatGrade="B"
      formatIssue="Clean single-column layout"
      resumeLength={"good" as never}
      redFlags={[]}
      keywords={[]}
      sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
      onGetFullAnalysis={vi.fn()}
      {...(extra as object)}
    />
  </MemoryRouter>,
);

describe("the report says when the scan did not read the whole résumé", () => {
  it("resumeTruncated: true shows the notice before anything else is read", () => {
    const { container } = report({ resumeTruncated: true });
    const banner = container.querySelector("[data-resume-truncated]");
    expect(banner, "a cut résumé was reported as read whole").not.toBeNull();
    expect(banner?.textContent).toContain(en.freeResults.resumeTruncated.title);
    expect(banner?.textContent).toContain(en.freeResults.resumeTruncated.body);
    // It leads the report: nothing scored comes before it.
    const text = container.textContent ?? "";
    expect(text.indexOf(en.freeResults.resumeTruncated.title)).toBeLessThan(text.indexOf("66"));
  });

  it("an older response without the field, or with it false, shows nothing", () => {
    for (const extra of [{}, { resumeTruncated: false }, { resumeTruncated: undefined }, { resumeTruncated: "true" }]) {
      const { container, unmount } = report(extra);
      expect(container.querySelector("[data-resume-truncated]"), JSON.stringify(extra)).toBeNull();
      unmount();
    }
  });

  it("the scan result reaches the report under exactly the name the scanner sends", () => {
    const index = read("src/pages/Index.tsx");
    expect(index).toMatch(/resumeTruncated=\{freeKeywordResult\.resumeTruncated === true\}/);
  });

  it("every locale says it in its own words", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("en"))) {
      const d = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
      expect(d.freeResults.resumeTruncated.title, file).not.toBe(en.freeResults.resumeTruncated.title);
      expect(d.freeResults.resumeTruncated.body, file).not.toBe(en.freeResults.resumeTruncated.body);
    }
  });
});

describe("the client refuses what the scanner refuses, before sending it", () => {
  it("its cap is the scanners' cap", () => {
    for (const rel of ["supabase/functions/free-keyword-scan/index.ts", "supabase/functions/free-keyword-scan-stream/index.ts"]) {
      expect(Number(/const MAX_RESUME_LENGTH = ([\d_]+);/.exec(read(rel))?.[1].replace(/_/g, "")), rel).toBe(MAX_RESUME_LENGTH);
    }
    expect(Number(/export const MAX_RESUME_LENGTH = ([\d_]+);/.exec(read("supabase/functions/_shared/input-limits.ts"))?.[1].replace(/_/g, ""))).toBe(MAX_RESUME_LENGTH);
    expect(MAX_RESUME_LENGTH).toBe(50_000);
  });
  it("a 50,000-character résumé passes and a 50,001-character one is refused", () => {
    const body = "Registered Nurse, 2015 - 2024. Led a ward of 30 beds. ";
    const at = (n: number) => body.repeat(Math.ceil(n / body.length)).slice(0, n);
    expect(validateResumeBeforeSend(at(50_000)).isValid).toBe(true);
    const over = validateResumeBeforeSend(at(50_001));
    expect(over.isValid).toBe(false);
    expect(over.errors.join(" ")).toMatch(/50,?000/);
  });
});

describe("the uploader says so under the box", () => {
  const LINE = "Registered Nurse, City Hospital, 2015 - 2024. Led a ward of 30 beds. ";
  const ofLength = (n: number) => LINE.repeat(Math.ceil(n / LINE.length)).slice(0, n);
  const paste = (text: string) => {
    const view = render(
      <MemoryRouter>
        <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={vi.fn()} isLoading={false} />
      </MemoryRouter>,
    );
    fireEvent.click(view.container.querySelector("#resume-paste-tab")!);
    fireEvent.change(view.container.querySelector("#resume-paste-panel textarea")!, { target: { value: text } });
    return view;
  };
  it("a 60,000-character paste is told its length and the cap", () => {
    const { container, unmount } = paste(ofLength(60_000));
    const note = container.querySelector("[data-resume-too-long]");
    expect(note, "a paste the scanner will refuse said nothing").not.toBeNull();
    expect(note?.getAttribute("role")).toBe("alert");
    expect(note?.textContent).toBe(en.uploader.resume.tooLong.replace("{{length}}", "60,000").replace("{{max}}", "50,000"));
    unmount();
  });
  it("one at the cap is not (the positive control)", () => {
    const { container, unmount } = paste(ofLength(MAX_RESUME_LENGTH));
    expect(container.querySelector("[data-resume-too-long]")).toBeNull();
    unmount();
  });
  it("every locale says the three refusals with the numbers interpolated", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const d = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
      expect(d.homepage.toast.resumeTooLong, file).toBeTruthy();
      for (const v of [d.homepage.toast.resumeTooLongDescription, d.uploader.resume.tooLong]) {
        expect(v, file).toContain("{{length}}");
        expect(v, file).toContain("{{max}}");
        expect(String(v).replace(/\{\{\w+\}\}/g, ""), `${file}: a typed cap`).not.toMatch(/\d/);
      }
      if (!file.startsWith("en")) expect(d.uploader.resume.tooLong, file).not.toBe(en.uploader.resume.tooLong);
    }
  });
});
