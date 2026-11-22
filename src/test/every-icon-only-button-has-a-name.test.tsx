/**
 * EVERY ICON-ONLY BUTTON HAS A NAME (sweep SH-06).
 *
 * Seven buttons on the scan page and the builder were a bare cross: the five
 * that clear a chosen job, a spreadsheet, a pasted posting and a profile PDF
 * in the uploader, the one that closes the industry list in the industry
 * indicator, and the one that removes a tag in the builder's tag lists. A
 * screen reader announced each as "button". Each now says what it does,
 * through t(), in the reader's language.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

import i18n from "@/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ResumeUploader } from "@/components/ResumeUploader";
import { IndustryConfidenceIndicator } from "@/components/IndustryConfidenceIndicator";
import { TagListEditor } from "@/components/builder/TagListEditor";

const ROOT = resolve(__dirname, "../..");
const FILES = ["src/components/ResumeUploader.tsx", "src/components/IndustryConfidenceIndicator.tsx", "src/components/builder/TagListEditor.tsx"];
afterEach(() => cleanup());

/**
 * Every <button> in a file whose content is icons alone and that carries no
 * aria-label. The content counts as words when it holds a t() call, a value
 * in braces, or a letter outside a tag.
 */
function unnamedButtons(file: string): string[] {
  const code = codeOf(readFileSync(resolve(ROOT, file), "utf8"));
  const out: string[] = [];
  const open = /<button\b/g;
  for (let m = open.exec(code); m; m = open.exec(code)) {
    const end = code.indexOf("</button>", m.index);
    const block = code.slice(m.index, end);
    // The opening tag ends at the first '>' outside braces.
    let depth = 0, i = 0;
    for (; i < block.length; i++) {
      const c = block[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && block[i - 1] !== "=") break;
    }
    const tag = block.slice(0, i);
    const inner = block.slice(i + 1).replace(/\{\s*\}/g, "");
    const words = /\{\s*t\(|\{[^}]*\b[a-zA-Z_]\w*\b[^}]*\}/.test(inner.replace(/<[^>]*>/g, "")) || /[A-Za-z]/.test(inner.replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, ""));
    if (!/\baria-label=/.test(tag) && !words) out.push(`${file}:${code.slice(0, m.index).split("\n").length}`);
  }
  return out;
}

describe("in the source", () => {
  it("no button in the three files is icons alone without a name", () => {
    expect(FILES.flatMap(unnamedButtons)).toEqual([]);
  });

  it("each of the seven names is a key, written in all nine languages", () => {
    const keys = ["removeJob", "removeSpreadsheet", "clearPosting", "removeProfilePdf", "closeIndustryList"];
    for (const lng of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const a11y = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/shards/free-scan-page/${lng}.json`), "utf8")).freeScanPage.a11y;
      for (const k of keys) expect(typeof a11y[k], `${lng} ${k}`).toBe("string");
      const builder = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/shards/builder/${lng}.json`), "utf8")).builderPage;
      expect(builder.removeTag, lng).toMatch(/\{\{tag\}\}/);
    }
    const uploader = readFileSync(resolve(ROOT, "src/components/ResumeUploader.tsx"), "utf8");
    for (const k of keys.slice(0, 4)) expect(uploader, k).toContain(`t('freeScanPage.a11y.${k}')`);
  });
});

describe("rendered", () => {
  it("the industry list's close button says it closes the list", () => {
    render(
      <TooltipProvider>
        <IndustryConfidenceIndicator industry="healthcare" industryDetection={{ detected: "healthcare", confidence: "low", signals: ["RN"] }} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(i18n.t("industryConfidence.no")) }));
    expect(screen.getByRole("button", { name: i18n.t("freeScanPage.a11y.closeIndustryList") })).toBeTruthy();
  });

  it("the pasted posting's clear button says it clears the posting", () => {
    render(
      <MemoryRouter>
        <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={vi.fn()} isLoading={false} hasContent resumeText="Jane Doe" />
      </MemoryRouter>,
    );
    const toggle = screen.getAllByRole("button").find((b) => b.hasAttribute("aria-expanded"))!;
    if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
    fireEvent.change(screen.getByRole("textbox", { name: i18n.t("uploader.jobDescription.title") }), {
      target: { value: "Senior analyst. You will own the monthly close, lead two analysts and report to the CFO. SQL required." },
    });
    const clear = screen.getByRole("button", { name: i18n.t("freeScanPage.a11y.clearPosting") });
    fireEvent.click(clear);
    expect((screen.getByRole("textbox", { name: i18n.t("uploader.jobDescription.title") }) as HTMLTextAreaElement).value).toBe("");
  });

  it("a tag's remove button names the tag", () => {
    render(<TagListEditor tags={["Python"]} onChange={vi.fn()} label="Skills" />);
    expect(screen.getByRole("button", { name: i18n.t("builderPage.removeTag", { tag: "Python" }) })).toBeTruthy();
  });
});
