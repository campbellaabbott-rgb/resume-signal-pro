/**
 * A SAVED SEARCH KEEPS THE LANGUAGE ITS OWNER READS THE SITE IN (S13-102, the
 * digest's half; found by the review of audit-rest).
 *
 * The digest is written in user_job_searches.locale. The first build filled
 * that column from the browser's first Accept-Language preference, so someone
 * who chose English on a German browser would have got a German digest, and
 * someone who chose Spanish on an English browser an English one. The site's
 * language is what they read, and the page knows it: every write the owner's
 * page makes to a saved search now carries it.
 *
 * The page publishes ahead of the migration. A database with no such column
 * refuses the write, so each writer goes again without the language: nothing
 * about saving a search, or turning its mail on, can fail on the rollout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { languages } from "@/i18n/languages";
import { digestLocaleOf, writeWithDigestLocale } from "@/lib/saved-search-locale";
import { codeOf } from "./helpers/strip-comments";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

type Call = { table: string; op: string; row: Record<string, unknown> };
const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; row: Record<string, unknown> }>,
  rows: [] as Array<Record<string, unknown>>,
  /** What a write answers, by the row it carries. */
  refuse: null as null | ((row: Record<string, unknown>, op: string) => { code?: string; message: string } | null),
  invoke: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    from: (table: string) => stubTable(table),
    rpc: async () => ({ data: [] }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "seeker@example.com" }, session: { user: { id: "user-1", email: "seeker@example.com" }, access_token: "t" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => h.toast(...a), useToast: () => ({ toast: h.toast, toasts: [] }) }));
vi.mock("@/lib/invoke-job-board", async (original) => ({
  ...(await original<typeof import("@/lib/invoke-job-board")>()),
  invokeJobBoard: (o: unknown) => h.invoke("job-board", o),
}));

function stubTable(table: string) {
  let current: Call | null = null;
  const th: Record<string, unknown> = {};
  const result = () => {
    if (current) {
      const error = table === "user_job_searches" && h.refuse ? h.refuse(current.row, current.op) : null;
      return { data: error ? null : [], error };
    }
    return { data: table === "user_job_searches" ? h.rows : [], error: null };
  };
  for (const op of ["insert", "update", "upsert", "delete"]) {
    th[op] = (row: Record<string, unknown>) => { current = { table, op, row: row ?? {} }; h.calls.push(current); return th; };
  }
  for (const k of ["select", "order", "not", "in", "is", "gte", "lte", "eq"]) th[k] = () => th;
  th.limit = async () => ({ data: table === "user_job_searches" ? h.rows : [], error: null });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void, bad?: (e: unknown) => void) => Promise.resolve(result()).then(ok, bad);
  return th;
}

import { SavedSearchesCard } from "@/components/account/SavedSearchesCard";
import { NotificationsPanel } from "@/components/account/NotificationsPanel";
import { SavedSearchPills } from "@/components/jobs/SavedSearchPills";
import Jobs from "../pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

const writes = () => h.calls.filter((c) => c.table === "user_job_searches");
/** PostgREST's answer for a body naming a column its schema does not have. */
const NO_COLUMN = { code: "PGRST204", message: "Could not find the 'locale' column of 'user_job_searches' in the schema cache" };
const refuseTheLanguage = (row: Record<string, unknown>) => ("locale" in row ? NO_COLUMN : null);
const row = (extra: Record<string, unknown> = {}) => ({
  id: "s1", name: "Nurse", params: { q: "nurse" }, last_seen_at: "2026-10-30T00:00:00Z", digest_opt_in: false, fit_threshold: 0, digest_cadence: "weekly", ...extra,
});

beforeEach(() => {
  h.calls.length = 0;
  h.rows = [row()];
  h.refuse = null;
  h.toast.mockReset();
  h.invoke.mockReset().mockResolvedValue({ data: { total: 0 } });
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

describe("the language a write carries", () => {
  const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
  const SQL = readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith("20261103240000_"))!), "utf8");
  const ALLOWED = [...(/CHECK \(locale IS NULL OR locale IN \(([^)]+)\)\)/.exec(SQL)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);

  it("is one the column accepts, for every language the picker offers", () => {
    expect(ALLOWED.length).toBe(9);
    for (const { code } of languages) expect(ALLOWED, code).toContain(digestLocaleOf(code));
    expect(digestLocaleOf("fr-CA")).toBe("fr");
    expect(digestLocaleOf("en-GB")).toBe("en-GB");
    expect(digestLocaleOf("en-US")).toBe("en");
    expect(digestLocaleOf("pt-BR")).toBe("pt");
  });

  it("is nothing for a language the site does not carry, so the write cannot break the column's check", () => {
    for (const v of ["ja", "cimode", "", null, undefined]) expect(digestLocaleOf(v)).toBeNull();
  });

  it("goes again without the language when the database refuses it, and only then", async () => {
    const seen: Array<Record<string, string>> = [];
    const noColumn = await writeWithDigestLocale("fr", async (l) => { seen.push(l); return { error: "locale" in l ? NO_COLUMN : null }; });
    expect(seen).toEqual([{ locale: "fr" }, {}]);
    expect(noColumn.error).toBeNull();

    seen.length = 0;
    await writeWithDigestLocale("fr", async (l) => { seen.push(l); return { error: "locale" in l ? { code: "23514", message: 'new row for relation "user_job_searches" violates check constraint "user_job_searches_locale_known"' } : null }; });
    expect(seen, "a refused language is never the reason a save fails").toEqual([{ locale: "fr" }, {}]);

    seen.length = 0;
    const dup = await writeWithDigestLocale("fr", async (l) => { seen.push(l); return { error: { code: "23505", message: 'duplicate key value violates unique constraint "user_job_searches_user_id_name_key"' } }; });
    expect(seen, "any other refusal is the caller's to read").toEqual([{ locale: "fr" }]);
    expect(dup.error?.code).toBe("23505");
  });

  it("sends nothing when the language is not one we carry", async () => {
    const seen: Array<Record<string, string>> = [];
    await writeWithDigestLocale("ja", async (l) => { seen.push(l); return { error: null }; });
    expect(seen).toEqual([{}]);
  });
});

describe("the account's saved-searches card", () => {
  it("turning a digest on names the language the page is read in", async () => {
    await i18n.changeLanguage("es");
    render(<MemoryRouter><SavedSearchesCard /></MemoryRouter>);
    const bell = await waitFor(() => { const b = document.querySelector<HTMLButtonElement>("button[aria-pressed], button[aria-label*='Nurse']"); expect(b).toBeTruthy(); return b!; }, SLOW);
    fireEvent.click(bell);
    await waitFor(() => expect(writes().some((c) => c.row.digest_opt_in === true)).toBe(true), SLOW);
    expect(writes().find((c) => c.row.digest_opt_in === true)!.row.locale).toBe("es");
  });

  it("with no such column yet it goes again without it, and the bell stays on", async () => {
    h.refuse = refuseTheLanguage;
    render(<MemoryRouter><SavedSearchesCard /></MemoryRouter>);
    const bell = await screen.findByLabelText("Email me weekly about Nurse", {}, SLOW);
    fireEvent.click(bell);
    await waitFor(() => expect(writes().filter((c) => c.row.digest_opt_in === true).length).toBe(2), SLOW);
    const [first, second] = writes().filter((c) => c.row.digest_opt_in === true);
    expect(first.row.locale).toBe("en");
    expect("locale" in second.row).toBe(false);
    expect(await screen.findByLabelText("Turn off weekly email for Nurse", {}, SLOW)).toBeTruthy();
  });
});

describe("the notifications panel", () => {
  it("its switch names the language the page is read in", async () => {
    await i18n.changeLanguage("de");
    render(<MemoryRouter><NotificationsPanel /></MemoryRouter>);
    const toggle = await waitFor(() => { const b = document.querySelector<HTMLElement>("[role=switch], input[type=checkbox]"); expect(b).toBeTruthy(); return b!; }, SLOW);
    fireEvent.click(toggle);
    await waitFor(() => expect(writes().some((c) => c.row.digest_opt_in === true)).toBe(true), SLOW);
    expect(writes().find((c) => c.row.digest_opt_in === true)!.row.locale).toBe("de");
  });
});

describe("opening a saved search", () => {
  it("an existing row takes the language its owner reads the site in at the next open", async () => {
    await i18n.changeLanguage("nl");
    h.rows = [row({ digest_opt_in: true })];
    render(<MemoryRouter><SavedSearchPills /></MemoryRouter>);
    const pill = await screen.findByRole("button", { name: /Nurse/ }, SLOW);
    fireEvent.click(pill);
    await waitFor(() => expect(writes().some((c) => "last_seen_at" in c.row)).toBe(true), SLOW);
    expect(writes().find((c) => "last_seen_at" in c.row)!.row.locale).toBe("nl");
  });
});

describe("the board's own saves", () => {
  const EMPTY = { jobs: [], total: 0, totalAllCompanies: 500000, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false };
  const mount = (path: string) => {
    window.history.replaceState({}, "", path);
    h.invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
      const b = o?.body ?? {};
      if (fn === "job-board" && (b.action === "list" || b.action === undefined)) return b.countOnly ? { data: { total: 0 } } : { data: EMPTY };
      return { data: {} };
    });
    return render(<MemoryRouter><Jobs /></MemoryRouter>);
  };
  const titles = () => h.toast.mock.calls.map((c) => String((c[0] as { title?: unknown }).title ?? ""));

  it("an alert saved on a French page is mailed in French, whatever the browser prefers", async () => {
    await i18n.changeLanguage("fr");
    mount("/jobs?q=underwater%20basket%20weaving");
    const cta = await waitFor(() => { const b = [...document.querySelectorAll("button")].find((x) => /alert/i.test(x.textContent ?? "") || /alerte/i.test(x.textContent ?? "")); expect(b).toBeTruthy(); return b!; }, SLOW);
    fireEvent.click(cta);
    await waitFor(() => expect(writes().some((c) => c.op === "insert")).toBe(true), SLOW);
    expect(writes().find((c) => c.op === "insert")!.row).toMatchObject({ digest_opt_in: true, locale: "fr" });
  });

  it("with no such column yet the save goes again without it and says it saved", async () => {
    h.refuse = refuseTheLanguage;
    mount("/jobs?q=underwater%20basket%20weaving");
    fireEvent.click(await screen.findByRole("button", { name: /Save this search/ }, SLOW));
    await waitFor(() => expect(writes().filter((c) => c.op === "insert").length).toBe(2), SLOW);
    const [first, second] = writes().filter((c) => c.op === "insert");
    expect(first.row.locale).toBe("en");
    expect("locale" in second.row).toBe(false);
    await waitFor(() => expect(h.toast).toHaveBeenCalled(), SLOW);
    expect(titles()).not.toContain("Couldn't save — try again.");
  });

  it("an alert with neither new column yet still saves, the digest on", async () => {
    h.refuse = (r) => ("locale" in r ? NO_COLUMN : "digest_cadence" in r ? { code: "PGRST204", message: "Could not find the 'digest_cadence' column" } : null);
    mount("/jobs?q=underwater%20basket%20weaving");
    fireEvent.click(await screen.findByRole("button", { name: /Alert me when this exists/ }, SLOW));
    await waitFor(() => expect(writes().some((c) => c.op === "insert" && !("locale" in c.row) && !("digest_cadence" in c.row))).toBe(true), SLOW);
    expect(writes().at(-1)!.row).toMatchObject({ digest_opt_in: true });
    await waitFor(() => expect(h.toast).toHaveBeenCalled(), SLOW);
    expect(titles()).not.toContain("Couldn't save — try again.");
  });

  it("an alert on a search already saved turns it on in the page's language", async () => {
    await i18n.changeLanguage("de");
    h.refuse = (_r, op) => (op === "insert" ? { code: "23505", message: 'duplicate key value violates unique constraint "user_job_searches_user_id_name_key"' } : null);
    mount("/jobs?q=underwater%20basket%20weaving");
    const cta = await waitFor(() => { const b = [...document.querySelectorAll("button")].find((x) => /alert|benachrichtig/i.test(x.textContent ?? "")); expect(b).toBeTruthy(); return b!; }, SLOW);
    fireEvent.click(cta);
    await waitFor(() => expect(writes().some((c) => c.op === "update")).toBe(true), SLOW);
    expect(writes().find((c) => c.op === "update")!.row).toMatchObject({ digest_opt_in: true, locale: "de" });
  });
});

describe("the board's other save", () => {
  it("Explore's slice goes through the same write", () => {
    const code = codeOf(readFileSync(resolve(__dirname, "../pages/Explore.tsx"), "utf8"));
    expect(code).toMatch(/writeWithDigestLocale\(i18n\.language, \(lang\) => searchesTable\(\)\.insert\(\{ user_id: user\.id, name, params, \.\.\.lang \}\)\)/);
    expect(code.match(/searchesTable\(\)\.insert/g)).toHaveLength(1);
  });
});
