// Explore's writer was held only by a pattern over its source, which a local stub could keep while sending no language: this presses the real Save button.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; row: Record<string, unknown> }>,
  refuse: null as null | ((row: Record<string, unknown>) => { code?: string; message: string } | null),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async (_fn: string, o?: { body?: Record<string, unknown> }) => {
      if (o?.body?.action === "facets") return { data: { jobs: [], total: 1000, categories: { healthcare: 500, engineering: 500 }, refreshedAt: "2026-10-30T00:00:00Z" }, error: null };
      return { data: { jobs: [], total: 0 }, error: null };
    } },
    from: (table: string) => stub(table),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "s@example.com" }, session: { user: { id: "user-1" }, access_token: "t" } }),
}));
function stub(table: string) {
  let current: { row: Record<string, unknown> } | null = null;
  const th: Record<string, unknown> = {};
  th.insert = (row: Record<string, unknown>) => { current = { row }; h.calls.push({ table, op: "insert", row }); return th; };
  for (const k of ["select", "order", "eq", "not", "update", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void, bad?: (e: unknown) => void) =>
    Promise.resolve({ data: [], error: current && h.refuse ? h.refuse(current.row) : null }).then(ok, bad);
  return th;
}
import Explore from "../pages/Explore";
vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(async () => { cleanup(); h.calls.length = 0; h.refuse = null; await i18n.changeLanguage("en"); });
const inserts = () => h.calls.filter((c) => c.table === "user_job_searches" && c.op === "insert");
const press = async () => {
  const path = "/explore?f=healthcare";
  window.history.replaceState({}, "", path);
  render(<MemoryRouter initialEntries={[path]}><Explore /></MemoryRouter>);
  
  const b = await waitFor(() => { const label = i18n.t("explore.saveSlice", "Save this slice"); const x = [...document.querySelectorAll("button")].find((n) => (n.textContent ?? "").includes(label)); expect(x, `no button reading ${label}; buttons: ${[...document.querySelectorAll("button")].length}`).toBeTruthy(); return x!; }, SLOW);
  fireEvent.click(b);
};
describe("Explore's real save press", () => {
  it("names the page's language on a French page", async () => {
    await i18n.changeLanguage("fr");
    await press();
    await waitFor(() => expect(inserts().length).toBe(1), SLOW);
    expect(inserts()[0].row).toMatchObject({ user_id: "user-1", locale: "fr" });
  });
  it("goes again without it when the column is not there yet", async () => {
    h.refuse = (r) => ("locale" in r ? { code: "PGRST204", message: "Could not find the 'locale' column of 'user_job_searches' in the schema cache" } : null);
    await press();
    await waitFor(() => expect(inserts().length).toBe(2), SLOW);
    expect(inserts()[0].row.locale).toBe("en");
    expect("locale" in inserts()[1].row).toBe(false);
  });
});
