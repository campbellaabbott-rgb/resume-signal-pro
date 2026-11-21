/**
 * AN ACCOUNT TEXT BOX IS NAMED BY MORE THAN ITS PLACEHOLDER (SH-07, the
 * account half).
 *
 * WHAT WAS WRONG. The tracker's Company and Role boxes, the version-name box,
 * the matching-résumé and posting paste boxes on /account, and the morning
 * queue's search name, roles, places, salary floor and CV paste boxes had a
 * placeholder and nothing else. A placeholder is a hint, not a name: it is
 * gone the moment the person types, and a screen reader that reads it at all
 * reads it as a hint, so each box was announced as an unnamed edit field.
 *
 * WHAT HOLDS NOW: each of those boxes carries an accessible name that reuses
 * its placeholder's string, so it is named in every language the placeholder
 * is. Proved two ways: mounted (the page with the queue's criteria showing,
 * every box with a placeholder typed into and then named with the hint set
 * aside), and over the source of both files, so a box that only shows after
 * a click, or behind the agent's switch, cannot be left out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { computeAccessibleName } from "dom-accessibility-api";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined, success: () => undefined }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => {
      if (p === "then") return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok, bad);
      if (p === "maybeSingle" || p === "single") return async () => ({ data: null, error: null });
      return () => chain;
    },
  });
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      functions: {
        invoke: async (fn: string) => (fn === "get-account-data"
          ? { data: { credits: 0, purchases: [], passes: [], orders: [], mailboxProven: true }, error: null }
          : { data: null, error: null }),
      },
      storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
      auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
const auth = vi.hoisted(() => ({
  session: { access_token: "jwt", user: { id: "u1" } },
  user: { id: "u1", email: "u@example.com", created_at: "2026-01-05T10:00:00Z" },
  loading: false,
  signOut: async () => undefined,
}));
const pro = vi.hoisted(() => ({ pro: { active: false } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/use-pro-subscription", () => ({ useProSubscription: () => pro }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: true }) }));
// The queue's criteria render only with the agent's switch on, as the agent
// suites load the panel; the source sweep below covers the shipped build.
vi.mock("../../supabase/functions/_shared/apply-agent-switch", () => ({ APPLY_AGENT_ON: true, AGENT_PRODUCTS_ON_SALE: true, APPLY_ASSISTANT_ON_SALE: false }));
vi.mock("@/pages/Jobs", async () => ({ FILL_RATE_MIN_TRACKING_DAYS: (await import("@/lib/hiring-record-gate")).FILL_RATE_MIN_TRACKING_DAYS }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/ProSubscriptionCard", () => ({ ProSubscriptionCard: () => null }));
vi.mock("@/components/account/SavedSearchesCard", () => ({ SavedSearchesCard: () => null }));
vi.mock("@/components/account/ApplyKitPanel", () => ({ ApplyKitPanel: () => null }));
vi.mock("@/components/account/ApplyCopilotPanel", () => ({ ApplyCopilotPanel: () => null }));
vi.mock("@/components/account/ApplyProfilePanel", () => ({ ApplyProfilePanel: () => null }));
vi.mock("@/components/account/PendingQuestionsPanel", () => ({ PendingQuestionsPanel: () => null }));
vi.mock("@/components/account/ApplyQueuePanel", () => ({ ApplyQueuePanel: () => null }));
vi.mock("@/components/account/AccountNav", () => ({ AccountNav: () => null }));
vi.mock("@/components/account/GapReport", () => ({ GapReport: () => null }));
vi.mock("@/components/account/InterviewsHub", () => ({ InterviewsHub: () => null }));
vi.mock("@/components/account/SetupChecklist", () => ({ SetupChecklist: () => null }));
vi.mock("@/components/account/AgentBridgeCard", () => ({ AgentBridgeCard: () => null }));
vi.mock("@/components/account/AgentStatusBand", () => ({ AgentStatusBand: () => null }));
vi.mock("@/components/account/NotificationsPanel", () => ({ NotificationsPanel: () => null }));
vi.mock("@/components/account/CreditsAndPurchases", () => ({ CreditsAndPurchases: () => null }));
vi.mock("@/components/account/SecurityCard", () => ({ SecurityCard: () => null }));
vi.mock("@/components/account/DataPrivacyCard", () => ({ DataPrivacyCard: () => null }));
vi.mock("@/components/account/ConnectedAIsCard", () => ({ AccountSettingsCards: () => null }));
vi.mock("@/components/account/WithdrawalPanel", () => ({ WithdrawalPanel: () => null }));
vi.mock("@/components/account/ClosedReplacementsPanel", () => ({ ClosedReplacementsPanel: () => null }));
vi.mock("@/components/account/LocalHistoryOffer", () => ({ LocalHistoryOffer: () => null }));

import Account from "../pages/Account";

vi.setConfig(MOUNT_TEST_BUDGET);

const ROOT = resolve(__dirname, "../..");
const FILES = ["src/pages/Account.tsx", "src/components/account/MorningQueuePanel.tsx"];

/** The name a box has once its hint is gone: computed with the placeholder set aside. */
function nameAfterTyping(el: HTMLElement): string {
  const hint = el.getAttribute("placeholder");
  el.removeAttribute("placeholder");
  try { return computeAccessibleName(el).trim(); } finally { if (hint !== null) el.setAttribute("placeholder", hint); }
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

describe("mounted: every box with a placeholder keeps a name after typing", () => {
  it("the tracker's boxes and the morning queue's criteria are each named by their placeholder's words", async () => {
    render(<MemoryRouter><Account /></MemoryRouter>);
    await act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
    const boxes = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[placeholder], textarea[placeholder]")];
    // Company and Role on the tracker; roles and places in the queue's criteria.
    expect(boxes.length).toBeGreaterThanOrEqual(4);
    const unnamed: string[] = [];
    for (const box of boxes) {
      const hint = box.getAttribute("placeholder") ?? "";
      fireEvent.change(box, { target: { value: "x" } });
      const name = nameAfterTyping(box);
      if (name !== hint.trim()) unnamed.push(`"${hint}" is named "${name}"`);
    }
    expect(unnamed).toEqual([]);
  });
});

describe("in the source: no box in the two files is named by its placeholder alone", () => {
  type Box = { file: string; line: number; tag: string; placeholderKey: string | null; nameKey: string | null; named: boolean };

  /** The t() key a JSX attribute's value asks for, or null when it is not a t("key", ...) call. */
  const keyOf = (attr: ts.JsxAttribute | undefined): string | null => {
    const init = attr?.initializer;
    if (!init || !ts.isJsxExpression(init) || !init.expression || !ts.isCallExpression(init.expression)) return null;
    const call = init.expression;
    if (!ts.isIdentifier(call.expression) || call.expression.text !== "t") return null;
    const first = call.arguments[0];
    return first && ts.isStringLiteral(first) ? first.text : null;
  };

  const boxesOf = (file: string): Box[] => {
    const src = readFileSync(resolve(ROOT, file), "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const out: Box[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName.getText(sf);
        if (tag === "input" || tag === "textarea") {
          const attrs = new Map<string, ts.JsxAttribute>();
          for (const p of node.attributes.properties) if (ts.isJsxAttribute(p)) attrs.set(p.name.getText(sf), p);
          if (attrs.has("placeholder")) {
            const named = attrs.has("aria-label") || attrs.has("aria-labelledby");
            out.push({
              file, tag,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              placeholderKey: keyOf(attrs.get("placeholder")),
              nameKey: keyOf(attrs.get("aria-label")),
              named,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  };

  const boxes = FILES.flatMap(boxesOf);

  it("finds the boxes it judges: five on the account page and five in the morning queue", () => {
    expect(boxes.filter((b) => b.file === FILES[0]).length).toBeGreaterThanOrEqual(5);
    expect(boxes.filter((b) => b.file === FILES[1]).length).toBeGreaterThanOrEqual(5);
  });

  it("each one carries a name, from the same string as its placeholder", () => {
    const bad = boxes
      .filter((b) => !b.named || (b.placeholderKey !== null && b.nameKey !== b.placeholderKey))
      .map((b) => `${b.file}:${b.line} <${b.tag}> placeholder ${b.placeholderKey ?? "(not a t() call)"}, name ${b.named ? b.nameKey ?? "(not a t() call)" : "none"}`);
    expect(bad).toEqual([]);
  });
});
