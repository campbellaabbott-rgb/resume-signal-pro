/**
 * THE AGENT CARD SAID IT APPLIES ON SEVEN SYSTEMS, AND IT SENDS ON FOUR.
 *
 * Commercial readiness 2026-10-08, item 7. With the sender online, the $99
 * card's "Applies for you automatically on ..." bullet and the front page's
 * "We apply for you" card were built from the CAPTCHA-free tier (Workday,
 * SmartRecruiters, Breezy, Oracle, Teamtailor, Personio, Pinpoint). The
 * worker can submit only where it has an adapter that reaches a submit
 * (SENDABLE_VENDORS: Breezy, Personio, Pinpoint, Teamtailor); on the other
 * three the release logic answers "prepared for you to send".
 *
 * Both components mounted for real with the sender online; the backend is
 * faked. The sending claims must name exactly the sendable list, and the
 * three CAPTCHA-free systems the worker cannot finish must be named where the
 * card promises preparation instead.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";
import { SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation";
import { ATS_VENDORS } from "@/config/ats-vendors";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "absent in the harness" } }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: true, checked: true }) }));

import { AgentSubscriptionCard } from "@/components/AgentSubscriptionCard";
import { AtsCoverage } from "@/components/AtsCoverage";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(cleanup);

const label = (key: string) => ATS_VENDORS.find((v) => v.key === key)?.label ?? key;
const SENDABLE_LABELS = SENDABLE_VENDORS.map(label).sort();
/** CAPTCHA-free on the measurement, but the worker has no submit path. */
const NOT_SENDABLE_LABELS = ATS_VENDORS.filter((v) => !SENDABLE_VENDORS.includes(v.key)).map((v) => v.label);

/** The names a "... on {{names}}" line interpolated, read back off the page. */
const namesIn = (template: string, rendered: string): string[] => {
  const lead = template.split("{{names}}")[0]!;
  expect(rendered.startsWith(lead), `"${rendered}" does not start with "${lead}"`).toBe(true);
  return rendered.slice(lead.length).split(",").map((s) => s.trim()).filter(Boolean).sort();
};

describe("the $99 card names only the systems the agent can send on", () => {
  it("the auto-apply bullet names exactly the sendable systems", () => {
    render(<MemoryRouter><AgentSubscriptionCard /></MemoryRouter>);
    const lead = en.agentPlan.perkAutoApply.split("{{names}}")[0]!;
    const line = screen.getByText((_, el) => el?.tagName === "SPAN" && (el.textContent ?? "").startsWith(lead));
    expect(namesIn(en.agentPlan.perkAutoApply, line.textContent ?? "")).toEqual(SENDABLE_LABELS);
  });

  it("the preparation bullet names every system the agent cannot finish, Workday and Oracle included", () => {
    render(<MemoryRouter><AgentSubscriptionCard /></MemoryRouter>);
    const lead = en.agentPlan.perkOneClick.split("{{names}}")[0]!;
    const line = screen.getByText((_, el) => el?.tagName === "SPAN" && (el.textContent ?? "").startsWith(lead));
    expect(namesIn(en.agentPlan.perkOneClick, line.textContent ?? "")).toEqual([...NOT_SENDABLE_LABELS].sort());
  });
});

// THE FRONT PAGE'S HALF OF THIS GUARD, after the apply pivot (owner decision
// 2026-10-11): the server-side apply agent is switched off, so the platform
// panel names no system as one "we apply" on — not the sendable four, not the
// seven — even with the sender reporting online. (The $99 card above is no
// longer rendered on any page; its own claims stay pinned for the day the
// owner revives it.)
describe("the front page claims sending on no system, with the sender online", () => {
  it("the full panel has no 'We apply for you' card and no 'you press send' card", async () => {
    const { container } = render(<AtsCoverage />);
    await waitFor(() => expect(screen.getByText("Workday")).toBeTruthy());
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/We apply for you|Filled in, you press send|submits the application/i);
    for (const n of [...SENDABLE_LABELS, ...NOT_SENDABLE_LABELS]) expect(screen.getAllByText(n).length, `${n} still listed as a source`).toBeGreaterThan(0);
  });

  it("the strip marks no system with the agent's icon", async () => {
    const { container } = render(<AtsCoverage variant="strip" />);
    await waitFor(() => expect(screen.getByText("Workday")).toBeTruthy());
    expect(container.querySelectorAll("li svg.lucide-bot").length).toBe(0);
  });
});
