/**
 * THE PRIVACY PAGE SAYS WHAT EACH AI SURFACE RECEIVES AND KEEPS (connect spec
 * §3.8, with the owner decisions of 2026-10-11 applied).
 *
 * The spec found the earlier privacy statements false: the CV did reach us
 * through a prompt argument and fit_resume, and search words are stored. One
 * table now states what each way of reaching us from an AI receives and what
 * we keep, and the Privacy page renders it. The decisions it must carry:
 * Claude-surface searches are kept 30 days without the postings shown;
 * ChatGPT searches are not kept; address and ChatGPT ids only as hashed
 * allowance counters; no keyless tool asks for a CV and fit_resume keeps none;
 * chat history never reaches us; we never submit an application.
 *
 * The section is a DRAFT FOR COUNSEL REVIEW, marked in a code comment and
 * never in the visible copy. Rendered for real, judged by the DOM.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import en from "../i18n/locales/en.json";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import Privacy from "../pages/Privacy";
import { CONNECTOR_SEARCH_LOG_CHANGED, MCP_PRIVACY_ROWS, MCP_SEARCH_PRUNE_LIVE, writtenDay } from "@/config/mcp-privacy";
import { PRIVACY_LAST_UPDATED } from "@/config/seller";

afterEach(cleanup);
const mount = () => render(<HelmetProvider><MemoryRouter initialEntries={["/privacy"]}><Privacy /></MemoryRouter></HelmetProvider>);
const row = (id: string) => document.querySelector(`[data-privacy-row="${id}"]`) as HTMLTableRowElement;
const cells = (id: string) => [...row(id).querySelectorAll("td")].map((td) => td.textContent ?? "");

describe("the MCP section of the Privacy page", () => {
  it("renders under its heading, with one row per fact in the table", () => {
    mount();
    const section = document.querySelector("[data-privacy-mcp]")!;
    expect(section, "the section is on the page").not.toBeNull();
    expect(section.querySelector("h2")!.textContent).toBe(en.privacy.sections.mcp);
    expect(section.querySelectorAll("tbody tr").length).toBe(MCP_PRIVACY_ROWS.length);
    for (const id of ["search", "job-ids", "address", "chatgpt-id", "usage", "cv", "chat"]) expect(row(id), id).not.toBeNull();
  });

  it("search words: kept 30 days from Claude without the postings shown, and not kept from ChatGPT", () => {
    mount();
    const [, claude, chatgpt, kept] = cells("search");
    expect(claude).toBe("Received");
    expect(chatgpt).toBe("Received");
    const day = writtenDay(CONNECTOR_SEARCH_LOG_CHANGED);
    if (MCP_SEARCH_PRUNE_LIVE) {
      expect(kept).toMatch(/kept for 30 days/);
    } else {
      // The review of 9fe3bc0d: the 30-day prune is held for the second
      // deploy message, so until it runs the page must not claim 30 days.
      expect(kept).not.toMatch(/30 days/);
      expect(kept).toMatch(/kept for up to 180 days/);
      // Searches logged before the deploy still name the postings shown, and
      // ChatGPT's were logged like any other (the live .92 wrote shown ids for
      // every caller and ignored the no-log flag): the page says so.
      expect(kept).toContain(`searches made from ${day} on keep no record of which postings were shown, and earlier ones still do.`);
      expect(kept).toContain(`From ChatGPT: searches made from ${day} on are not kept; earlier ones are kept like the site's own search log.`);
    }
    expect(kept).toContain(`From ChatGPT: searches made from ${day} on are not kept`);
  });

  // THE FINAL RECHECK OF LAND/ALL (2026-10-31). The cell said "searches made
  // after this policy's last update keep no record of which postings were
  // shown. From ChatGPT: not kept." under "Last updated: October 12, 2026",
  // written for job-board .93, which never served: the live .92 kept writing
  // the postings shown for every connector search and ignored ChatGPT's no-log
  // flag, so every connector search from 12 October to the deploy contradicted
  // it. The cell now names the day the log changes, never the policy's date,
  // and the ledger refuses a deploy message whose day is not the deploy day.
  it("names the day the connector log changes, which the page's own date is not earlier than, and the ledger checks both at the deploy", () => {
    mount();
    const kept = cells("search")[3];
    expect(kept).not.toMatch(/this policy's last update/);
    expect(CONNECTOR_SEARCH_LOG_CHANGED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(writtenDay("2026-10-31")).toBe("October 31, 2026");
    expect(writtenDay("2026-11-02")).toBe("November 2, 2026");
    expect(PRIVACY_LAST_UPDATED >= CONNECTOR_SEARCH_LOG_CHANGED, "the page's Last updated is not earlier than the change its text dates").toBe(true);
    const ledger = JSON.parse(readFileSync(resolve(__dirname, "../../docs/deploy-ledger.json"), "utf8")) as { datedAtDeploy?: Array<{ file: string; constant: string; whenDeploying: string }> };
    const dated = (ledger.datedAtDeploy ?? []).map((d) => `${d.file}#${d.constant}@${d.whenDeploying}`);
    expect(dated).toEqual(expect.arrayContaining([
      "src/config/mcp-privacy.ts#CONNECTOR_SEARCH_LOG_CHANGED@fn:job-board@2026-09-09.93",
      "src/config/seller.ts#PRIVACY_LAST_UPDATED@fn:job-board@2026-09-09.93",
    ]));
  });

  it("claims the 30-day limit only once its prune is released from the ledger's hold", () => {
    const ledger = JSON.parse(readFileSync(resolve(__dirname, "../../docs/deploy-ledger.json"), "utf8")) as { holdUntilVerified?: Array<{ stamp: string }> };
    const held = (ledger.holdUntilVerified ?? []).some((h) => h.stamp === "20261011103000");
    if (held) expect(MCP_SEARCH_PRUNE_LIVE, "the 30-day prune is still held; the page may not claim it").toBe(false);
    expect(readdirSync(resolve(__dirname, "../../supabase/migrations")).some((f) => f.startsWith("20261011103000_")), "the prune's migration exists").toBe(true);
  });

  it("a CV is never requested without a key, and never stored", () => {
    mount();
    const [, claude, chatgpt, kept] = cells("cv");
    expect(claude).toMatch(/^Never requested by any tool that works without a key/);
    expect(chatgpt).toBe("Never requested");
    expect(kept).toMatch(/^Never stored/);
  });

  it("addresses and ChatGPT ids are only hashed counters; chat history never reaches us", () => {
    mount();
    expect(cells("address")[3]).toMatch(/one-way hashed allowance counter, kept for 7 days/);
    expect(cells("chatgpt-id")[3]).toMatch(/one-way hashed allowance counter, deleted when its day ends/);
    expect(cells("chat").slice(1)).toEqual(["Never received", "Never received", "Nothing: it never reaches us."]);
  });

  it("says we never submit an application", () => {
    mount();
    expect(document.querySelector("[data-privacy-mcp]")!.textContent).toMatch(/Resume Booster never submits a job application for you/);
  });

  it("is marked for counsel in a code comment, and never in the visible copy", () => {
    const src = readFileSync(resolve(__dirname, "../pages/Privacy.tsx"), "utf8");
    expect(src).toMatch(/\{\/\* DRAFT FOR COUNSEL REVIEW/);
    mount();
    expect(document.body.textContent ?? "").not.toMatch(/draft|counsel/i);
  });
});
