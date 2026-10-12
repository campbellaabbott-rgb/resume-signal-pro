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
import { MCP_PRIVACY_ROWS, MCP_SEARCH_PRUNE_LIVE } from "@/config/mcp-privacy";

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
    if (MCP_SEARCH_PRUNE_LIVE) {
      expect(kept).toMatch(/kept for 30 days, without a record of which postings were shown/);
    } else {
      // The review of 9fe3bc0d: the 30-day prune is held for the second
      // deploy message, so until it runs the page must not claim 30 days.
      expect(kept).not.toMatch(/30 days/);
      expect(kept).toMatch(/kept for up to 180 days/);
      expect(kept).toMatch(/searches made after this policy's last update keep no record of which postings were shown/);
    }
    expect(kept).toMatch(/From ChatGPT: not kept\./);
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
