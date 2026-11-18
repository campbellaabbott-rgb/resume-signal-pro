/**
 * THE PREPARED-APPLICATIONS PANEL: what would be sent, read plainly.
 *
 * S14X-165 (the last describe, mounted): with the apply agent switched off,
 * as it ships, an unsent packet no longer reads "Ready — nothing needs you"
 * or "Needs you", and the headline counts it nowhere. It says it was not
 * sent and to apply from the link, and says when its pass application was
 * given back. The positive control switches the agent on and finds the old
 * lines.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";

/** The switch, as it ships unless a test turns it on (the positive control). */
const sw = vi.hoisted(() => ({ on: null as boolean | null }));
vi.mock("../../supabase/functions/_shared/apply-agent-switch", async (importActual) => {
  const actual = await importActual<typeof import("../../supabase/functions/_shared/apply-agent-switch")>();
  return {
    ...actual,
    get APPLY_AGENT_ON() { return sw.on ?? actual.APPLY_AGENT_ON; },
  };
});
/** The packets agent_submissions answers, and the columns the panel asked for. */
const db = vi.hoisted(() => ({ rows: [] as unknown[], selected: "" }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => {
      if (p === "then") return (ok: (v: unknown) => void) => Promise.resolve({ data: db.rows, error: null }).then(ok);
      if (p === "select") return (cols: string) => { db.selected = cols; return chain; };
      return () => chain;
    },
  });
  return { supabase: { from: () => chain, functions: { invoke: async () => ({ data: null, error: null }) } } };
});

import { ApplyQueuePanel } from "@/components/account/ApplyQueuePanel";
import accountEn from "../i18n/shards/account/en.json";

const root = resolve(__dirname, "../..");
const panel = readFileSync(resolve(root, "src/components/account/ApplyQueuePanel.tsx"), "utf8");
const en = JSON.parse(readFileSync(resolve(root, "src/i18n/locales/en.json"), "utf8"));

describe("a reviewer can see exactly what would be sent in their name", () => {
  // The product rests on someone letting an agent act as them. That consent is
  // only meaningful if they can read the payload first.
  it("renders every field with its provenance", () => {
    expect(panel).toContain("applyQueue.willSend");
    expect(panel).toMatch(/Object\.entries\(p\.fields/);
    // a fact and a generated sentence must be distinguishable at a glance
    expect(panel).toContain("applyQueue.src.");
    for (const s of ["profile", "standing", "resume", "drafted", "declined"]) {
      expect(en.applyQueue.src[s], `src.${s} label`).toBeTruthy();
    }
    expect(en.applyQueue.src.drafted).toMatch(/drafted/i);
  });

  it("prints every blocker in full rather than just saying 'blocked'", () => {
    // "Needs you: work authorisation" is useful; "blocked" is not. A queue that
    // says something is stuck without saying why is one people stop reading.
    expect(panel).toMatch(/p\.blockers\.map/);
    expect(panel).toMatch(/\{b\.detail\}/);
  });

  it("says when a form was inferred rather than published", () => {
    // Only Greenhouse publishes real questions. Presenting a guessed form as the
    // employer's actual one is the same class of lie as an invented count.
    expect(panel).toContain("questions_are_real");
    expect(en.applyQueue.inferred).toMatch(/doesn't publish/i);
    expect(en.applyQueue.inferred).toMatch(/may ask more/i);
  });
});

describe("recording a send is a report of fact, not a decision", () => {
  it("stamps a timestamp and a source together", () => {
    // The database trigger refuses `submitted` without both, so a partial write
    // cannot record an application that never happened.
    const i = panel.indexOf('status: "submitted"');
    expect(i).toBeGreaterThan(-1);
    const near = panel.slice(i, i + 220);
    expect(near).toContain("submitted_at");
    expect(near).toContain("submitted_via");
  });

  it("never offers to re-mark something already sent", () => {
    expect(panel).toMatch(/p\.status !== "submitted" &&/);
  });
});

describe("the states read plainly and are fully translated", () => {
  it("names all six packet states", () => {
    for (const s of ["sReady", "sBlocked", "sSent", "sStale", "sPreparing", "sFailed"]) {
      expect(en.applyQueue[s], s).toBeTruthy();
    }
    expect(en.applyQueue.sReady).toMatch(/nothing needs you/i);
    expect(en.applyQueue.sStale).toMatch(/already applied/i);
  });

  it("is translated into all nine locales, nested src labels included", () => {
    const keys = Object.keys(en.applyQueue).filter((k) => k !== "src");
    for (const loc of ["en-GB", "es", "fr", "de", "pt", "nl", "hi", "tl"]) {
      const j = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${loc}.json`), "utf8"));
      expect(j.applyQueue, `${loc} missing applyQueue`).toBeTruthy();
      for (const k of keys) expect(j.applyQueue[k], `${loc}.applyQueue.${k}`).toBeTruthy();
      for (const s of ["profile", "standing", "resume", "drafted", "declined"]) {
        expect(j.applyQueue.src?.[s], `${loc}.applyQueue.src.${s}`).toBeTruthy();
      }
    }
  });

  it("actually translates rather than shipping English nine times", () => {
    for (const loc of ["es", "fr", "de", "hi"]) {
      const j = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${loc}.json`), "utf8"));
      expect(j.applyQueue.sBlocked).not.toBe(en.applyQueue.sBlocked);
      expect(j.applyQueue.src.drafted).not.toBe(en.applyQueue.src.drafted);
    }
  });
});

describe("S14X-165: with the agent switched off, no unsent packet reads as about to go", () => {
  const packet = (over: Record<string, unknown>) => ({
    id: 1, posting_id: "greenhouse:acme:1", title: "Data Engineer", company: "Acme", apply_url: "https://boards.greenhouse.io/acme/jobs/1",
    source: "greenhouse", status: "ready", fields: {}, questions: [], questions_are_real: true, blockers: [], fit_pct: 40,
    prepared_at: "2026-10-01T10:00:00Z", submitted_at: null, submitted_via: null, sent_answers: null, sent_evidence: null,
    release_refusal: null, attempts: 0, claimed_at: null, released_at: null, claimable_at: null, pass_refunded_at: null, ...over,
  });
  const mount = async () => {
    render(createElement(ApplyQueuePanel, { userId: "u1" }));
    await act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); });
    return document.body.textContent ?? "";
  };
  afterEach(() => { cleanup(); sw.on = null; db.rows = []; });

  it("a ready packet says it was not sent and to apply from the link, with no ready count", async () => {
    db.rows = [packet({ id: 1 }), packet({ id: 2, status: "blocked", blockers: [{ kind: "missing-standing", detail: "Add your notice period" }] })];
    const text = await mount();
    expect(text.split(accountEn.accountView.queueRetired).length - 1).toBe(2);
    expect(text).not.toContain(en.applyQueue.sReady);
    expect(text).not.toContain(en.applyQueue.sBlocked);
    expect(text).not.toContain(en.applyQueue.cReady.replace("{{n}}", "1"));
    expect(text).not.toContain("Add your notice period");
    // Stopping it stays: nothing is taken away from a past buyer.
    expect(text).toContain(en.applyQueue.cancelSend);
  });

  it("a packet whose pass application was given back says so, and the panel asks for that column", async () => {
    db.rows = [packet({ pass_refunded_at: "2026-10-12T10:00:00Z" })];
    const text = await mount();
    expect(text).toContain(accountEn.accountView.queueGivenBack);
    expect(db.selected.split(",")).toContain("pass_refunded_at");
  });

  it("an unconfirmed send keeps its own line", async () => {
    db.rows = [packet({ status: "blocked", attempts: 99, blockers: [{ kind: "uncertain-submit", detail: "Submit pressed, outcome unknown" }] })];
    const text = await mount();
    expect(text).toContain(accountEn.accountView.queueUncertain);
    expect(text).not.toContain(accountEn.accountView.queueRetired);
  });

  it("positive control: with the agent on, the ready line and the counts are back", async () => {
    sw.on = true;
    db.rows = [packet({})];
    const text = await mount();
    expect(text).toContain(en.applyQueue.sReady);
    expect(text).toContain(en.applyQueue.cReady.replace("{{n}}", "1"));
    expect(text).not.toContain(accountEn.accountView.queueRetired);
  });
});
