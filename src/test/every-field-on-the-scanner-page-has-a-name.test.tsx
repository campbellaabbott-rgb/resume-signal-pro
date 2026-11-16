/**
 * EVERY FIELD ON THE SCANNER PAGE HAS A NAME (NB-45).
 *
 * The résumé paste box, the posting and LinkedIn boxes, the report's email
 * box and the intent block's target-role field had only a placeholder, which
 * a screen reader does not announce as the field's name once the field has
 * text; the situation chips toggled with no pressed state. Each field now
 * has an accessible name in the reader's language, and each chip says
 * whether it is pressed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "neq", "in", "is", "not", "or", "order", "limit", "range", "gte", "lte", "insert", "upsert", "update", "delete"]) chain[k] = () => chain;
  Object.assign(chain, {
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import i18n from "@/i18n";
import { ResumeUploader } from "@/components/ResumeUploader";
import { EmailReportCapture } from "@/components/EmailReportCapture";

afterEach(() => cleanup());

const RESUME = "Jane Doe\nData Engineer, Acme Corp, Jan 2020 - Present\n- Built pipelines that moved two billion rows a day\n- Led a team of five engineers across three regions";

describe("the uploader", () => {
  it("names the résumé paste box and the posting box", () => {
    render(<MemoryRouter><ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={vi.fn()} hasContent resumeText={RESUME} jobDescriptionText="Own the pipelines." /></MemoryRouter>);
    fireEvent.click(document.getElementById("resume-paste-tab")!);
    expect(screen.getByRole("textbox", { name: i18n.t("freeScanPage.a11y.resumeText") })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: i18n.t("uploader.jobDescription.title") })).toBeTruthy();
  });
});

describe("the report's email box", () => {
  it("is named in the full capture", () => {
    render(<EmailReportCapture payload={{ score: 70, projectedScore: null, scoreBreakdown: null, peerPercentile: null, applicationPassRate: null, redFlags: [], fixRoadmap: null, industry: "technology" }} />);
    expect(screen.getByRole("textbox", { name: i18n.t("freeScanPage.a11y.emailAddress") })).toBeTruthy();
  });
});

// The intent block's target-role name and the chips' pressed state are
// checked on the mounted page in
// the-parse-note-says-its-findings-in-the-readers-language.test.tsx.
