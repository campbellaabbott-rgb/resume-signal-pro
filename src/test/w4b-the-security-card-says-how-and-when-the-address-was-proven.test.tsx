/**
 * THE SECURITY CARD SAYS HOW AND WHEN THE ADDRESS WAS PROVEN (Account UX spec
 * 6, Security: "How the address was proven, and when"; plan CP-H, CP-047).
 *
 * WHAT WAS WRONG. Whether the address was proven decided what the account page
 * showed (purchases under the address, the mailing lists), but nothing on the
 * page said whether it was, how, or when: a person whose purchases did not
 * appear could not tell that the address was the reason.
 *
 * WHAT HOLDS NOW.
 *   - get-account-data answers mailboxProof {how, at} for a proven address
 *     (w4b-get-account-data-says-how-and-when-the-address-was-proven.test.ts);
 *   - the Security card says the address was proven by a sign-in code on that
 *     day, says an unproven address is unproven, and says nothing before the
 *     account read is in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
      reauthenticate: async () => ({ data: {}, error: null }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-1", email: "member@example.com" },
    session: { access_token: "t" },
    signOut: async () => {},
    signOutEverywhere: async () => {},
    ensureGuard: async () => ({ state: "done" }),
  }),
}));

import { SecurityCard } from "@/components/account/SecurityCard";

// The card asks the auth server whether address changes are confirmed; no
// network in a test.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ mailer_autoconfirm: true }), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the Security card says it", () => {
  const card = (props: React.ComponentProps<typeof SecurityCard>) => render(<MemoryRouter><SecurityCard {...props} /></MemoryRouter>);

  it("a code proof names the code and the day", () => {
    card({ proven: true, proof: { how: "code", at: "2026-10-12T09:30:00Z" } });
    const line = document.querySelector("[data-proof-line]");
    expect(line?.getAttribute("data-proof-line")).toBe("code");
    expect(line?.textContent).toMatch(/^Your address was proven by a sign-in code we emailed to it on .*2026\.$/);
  });

  it("a provider proof with no date still says how", () => {
    card({ proven: true, proof: { how: "provider", at: null } });
    expect(screen.getByText("Your address was proven by a Google or Apple sign-in that verified it.")).toBeInTheDocument();
  });

  it("an unproven address is said to be unproven", () => {
    card({ proven: false, proof: null });
    expect(document.querySelector("[data-proof-line]")?.getAttribute("data-proof-line")).toBe("unproven");
    expect(document.body.textContent).toMatch(/isn't proven yet/);
  });

  it("before the account read is in, it says nothing about the address", () => {
    card({});
    expect(document.querySelector("[data-proof-line]")).toBeNull();
  });
});
