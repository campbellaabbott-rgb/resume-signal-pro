/**
 * AN ASHBY POSTING ON THE SITE ASKS JOB-BOARD FOR NO APPLICATION QUESTIONS
 * (OD14-ASHBY, owner option "stop", 2026-11-18; the website's half).
 *
 * WHAT HAPPENED. The connector and /v1 stopped reading Ashby's application
 * forms, and the shared reader answers an Ashby posting "withheld" before any
 * request. The website did not stop. Its answers kit (ApplicationAnswers, on
 * the board's Prepare dialog and the account co-pilot) listed Ashby among the
 * vendors whose real questions it asks job-board for, and job-board answers
 * that action for an Ashby id by POSTing to Ashby's form API, under a path
 * Ashby's robots file disallows (read 2026-11-18). So a visitor opening
 * Prepare on an Ashby posting made us send Ashby that request. The board's
 * Prep answers button was offered on Ashby postings from the same list, and
 * How applying works printed its "we read this posting's screening
 * questions" line for Ashby from the shared table's flag.
 *
 * THE PROPERTY. The kit asks job-board for a posting's questions only when
 * asksForRealQuestions accepts its id, and that refuses every vendor on the
 * stop list (MCP_FORM_NOT_READ_HERE, the one list the connector's mirror
 * already holds equal to agent-mcp's). An Ashby posting's kit is drafted
 * from the posting, labelled as inferred, and job-board is asked nothing, so
 * Ashby is sent nothing. REAL_QUESTION_PREFIXES, which gates the board's
 * Prep answers button, names no stopped vendor; How applying works prints no
 * questions line for one; and a vendor the shared reader stopped
 * (FORM_STOPPED_VENDORS) is on the site's stop list too. No frontend file
 * but the kit sends job-board that action, so no other caller goes round the
 * gate.
 *
 * TEETH. The same mocks and the same mount hear a Greenhouse kit ask, so
 * "asked nothing" is not a deaf recorder; Greenhouse is put on the stop list
 * at run time and its kit then asks nothing and How applying works drops its
 * line, so the stop list is what answers, not only a prefix left out; the
 * caller scan is shown finding the kit's own call and flagging a fixture that
 * sends the action from code, while passing one that names it only in a
 * comment.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const invoke = vi.hoisted(() => vi.fn());
const invokeJobBoard = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/lib/invoke-job-board", () => ({ invokeJobBoard }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ApplicationAnswers, REAL_QUESTION_PREFIXES, asksForRealQuestions, forgetKeptDrafts } from "@/components/apply/ApplicationAnswers";
import { HowApplyingWorks } from "@/components/jobs/HowApplyingWorks";
import { applyMechanics, screeningQuestionVendors } from "@/lib/apply-mechanics";
import { MCP_FORM_NOT_READ_HERE } from "@/config/mcp-tools";
import { FORM_STOPPED_VENDORS } from "../../supabase/functions/_shared/application-form";

const ROOT = resolve(__dirname, "../..");
const ACTION = ["application", "questions"].join("-");
const ASHBY_ID = "ashby:acme:5f2c9a1e-1b2c-4d3e-8f90-0a1b2c3d4e5f";
const GREENHOUSE_ID = "greenhouse:acme:4012345";
const RESUME = "Sam Park, Software Engineer, Initech, 2019-2024: built billing services in Go and Postgres.";

const drafted = (text: string, inferred: boolean) => ({
  data: { answers: [{ question: "Why Acme?", answer: text, supported: true, note: "" }], skipped: [], inferred, undrafted: [] },
  error: null,
});
const questionAsks = () => invokeJobBoard.mock.calls.filter(([o]) => (o as { body?: { action?: string } } | undefined)?.body?.action === ACTION);
const draftBodies = () => invoke.mock.calls.filter(([fn]) => fn === "generate-application-answers").map(([, o]) => (o as { body: Record<string, unknown> }).body);
const open = (jobId: string) =>
  render(<ApplicationAnswers autoStart resumeText={RESUME} jobTitle="Engineer" jobCompany="Acme" jobDescription="We hire engineers who write Go." jobId={jobId} />);
const lines = () => [...document.querySelectorAll("[data-line]")].map((l) => l.getAttribute("data-line"));

/** The stop list, mutable at run time for the TEETH cases and restored after each. */
const stop = MCP_FORM_NOT_READ_HERE as string[];
const savedStop = [...stop];

afterEach(() => {
  cleanup();
  invoke.mockReset();
  invokeJobBoard.mockReset();
  forgetKeptDrafts();
  stop.splice(0, stop.length, ...savedStop);
});

describe("the answers kit on an Ashby posting", () => {
  it("is drafted from the posting, labelled as inferred, and job-board is asked for no questions", async () => {
    invoke.mockResolvedValue(drafted("Because of the billing work.", true));
    open(ASHBY_ID);
    expect(await screen.findByText("Because of the billing work.")).toBeTruthy();
    expect(questionAsks(), "the kit asked job-board for an Ashby posting's questions").toEqual([]);
    expect(invokeJobBoard).not.toHaveBeenCalled();
    expect(draftBodies()).toHaveLength(1);
    expect(draftBodies()[0].questions).toBeUndefined();
    expect(screen.getByText(/Likely questions for this role \(we did not read this employer's form\)/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/real questions/i);
  });

  it("TEETH: a Greenhouse posting's kit, on the same mocks, still asks job-board and drafts to what it read", async () => {
    invokeJobBoard.mockResolvedValue({ data: { supported: true, questions: [{ label: "Why Acme?", required: true, type: "textarea" }], requirements: [] }, error: null });
    invoke.mockResolvedValue(drafted("Because Acme ships billing.", false));
    open(GREENHOUSE_ID);
    expect(await screen.findByText("Because Acme ships billing.")).toBeTruthy();
    expect(questionAsks()).toEqual([[{ body: { action: ACTION, id: GREENHOUSE_ID } }]]);
    expect(draftBodies()[0].questions).toEqual([{ label: "Why Acme?", required: true, type: "textarea" }]);
  });

  it("TEETH: the stop list is what answers: Greenhouse put on it at run time asks nothing", async () => {
    stop.push("greenhouse");
    expect(asksForRealQuestions(GREENHOUSE_ID)).toBe(false);
    invoke.mockResolvedValue(drafted("Drafted from the posting.", true));
    open(GREENHOUSE_ID);
    expect(await screen.findByText("Drafted from the posting.")).toBeTruthy();
    expect(questionAsks()).toEqual([]);
    expect(draftBodies()[0].questions).toBeUndefined();
  });
});

describe("the lists every other surface reads", () => {
  it("the stop list names Ashby, and holds every vendor the shared reader stopped", () => {
    expect([...MCP_FORM_NOT_READ_HERE]).toContain("ashby");
    expect(FORM_STOPPED_VENDORS.length, "the shared stop list is empty: the next line would check nothing").toBeGreaterThan(0);
    for (const v of FORM_STOPPED_VENDORS) expect([...MCP_FORM_NOT_READ_HERE], `${v} is stopped in the shared reader but read on the site`).toContain(v);
  });

  it("no stopped vendor's posting is offered Prep answers or asked for its questions", () => {
    for (const v of MCP_FORM_NOT_READ_HERE) {
      const id = `${v}:acme:1`;
      expect(REAL_QUESTION_PREFIXES.some((p) => id.startsWith(p)), `${v}: the board's Prep answers button is gated on this list`).toBe(false);
      expect(asksForRealQuestions(id), v).toBe(false);
    }
    expect(asksForRealQuestions(GREENHOUSE_ID)).toBe(true);
    expect(asksForRealQuestions(null)).toBe(false);
    expect(asksForRealQuestions("ashby")).toBe(false);
  });

  it("How applying works prints no questions line for Ashby, and still prints it for Greenhouse", () => {
    for (const v of MCP_FORM_NOT_READ_HERE) expect(applyMechanics(v).readsScreeningQuestions, v).toBe(false);
    expect(screeningQuestionVendors()).not.toContain("ashby");
    render(<HowApplyingWorks systemKey="ashby" systemLabel="Ashby" />);
    expect(screen.getByText("Applications go through Ashby.")).toBeTruthy();
    expect(lines()).not.toContain("questions");
    expect(document.body.textContent).not.toMatch(/screening questions/i);
    cleanup();
    render(<HowApplyingWorks systemKey="greenhouse" systemLabel="Greenhouse" />);
    expect(lines()).toContain("questions");
  });

  it("TEETH: Greenhouse put on the stop list loses How applying works' questions line", () => {
    stop.push("greenhouse");
    expect(applyMechanics("greenhouse").readsScreeningQuestions).toBe(false);
    expect(screeningQuestionVendors()).not.toContain("greenhouse");
    render(<HowApplyingWorks systemKey="greenhouse" systemLabel="Greenhouse" />);
    expect(lines()).not.toContain("questions");
  });
});

/** Every frontend source file outside the tests, as code with its comments stripped. */
function frontendFiles(): Array<{ name: string; src: string }> {
  const out: Array<{ name: string; src: string }> = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        if (e === "test" || e === "node_modules") continue;
        walk(p);
      } else if (/\.(?:ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) {
        out.push({ name: relative(ROOT, p), src: readFileSync(p, "utf8") });
      }
    }
  };
  walk(resolve(ROOT, "src"));
  return out;
}

/** The files whose code sends job-board the questions action: the action as a body value. */
const sendersOf = (files: Array<{ name: string; src: string }>) =>
  files.filter((f) => new RegExp(`action:\\s*["'\`]${ACTION}["'\`]`).test(codeOf(f.src))).map((f) => f.name);

describe("no frontend caller goes round the gate", () => {
  it("only the answers kit sends job-board the questions action", () => {
    expect(sendersOf(frontendFiles())).toEqual(["src/components/apply/ApplicationAnswers.tsx"]);
  });

  it("TEETH: the scan reads the real tree, and flags a sender in code but not one in a comment", () => {
    const files = frontendFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files.map((f) => f.name)).toContain("src/pages/Jobs.tsx");
    const inCode = { name: "in-code.tsx", src: `const go = (id: string) => invokeJobBoard({ body: { action: "${ACTION}", id } });` };
    const inComment = { name: "in-comment.tsx", src: `// once: invokeJobBoard({ body: { action: "${ACTION}", id } })\nconst go = () => null;` };
    expect(sendersOf([inCode, inComment])).toEqual(["in-code.tsx"]);
  });
});
