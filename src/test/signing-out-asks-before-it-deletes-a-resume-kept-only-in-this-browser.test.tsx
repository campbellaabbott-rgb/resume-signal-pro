/**
 * SIGNING OUT ASKS BEFORE IT DELETES A RÉSUMÉ KEPT ONLY IN THIS BROWSER
 * (S14X-097).
 *
 * WHAT WAS WRONG. A deliberate sign-out clears what the person left in this
 * browser (CP-012), and that list includes the builder's résumé and Freelance
 * Boost's intake, which have no copy anywhere else. The account page's two
 * sign-out buttons deleted them without a word.
 *
 * WHAT HOLDS NOW, with the real provider and the account page's security card
 * (only the Supabase client faked): with a builder draft here, either button
 * asks first. "Keep it on this device" signs out and keeps the two drafts
 * while every other personal key goes; "Delete it" signs out and deletes them
 * (the old behaviour, now chosen); "Open the builder" signs nothing out. With
 * no draft, or a Freelance Boost form saved empty on a visit, it signs out at
 * once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const h = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => {
        setTimeout(() => cb("SIGNED_IN", { access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.sig", refresh_token: "rt", user: { id: "u-1", email: "member@example.com" } }), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({ data: { session: null } }),
      signOut: (...a: unknown[]) => h.signOut(...a),
    },
    functions: { invoke: async () => ({ data: { proven: true, passwordCleared: false }, error: null }) },
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: async () => ({}) } } }));
vi.mock("@/hooks/use-toast", () => ({ toast: () => undefined, useToast: () => ({ toast: () => undefined }) }));

import { AuthProvider } from "@/contexts/AuthContext";
import { SecurityCard } from "@/components/account/SecurityCard";
import { localWork } from "@/lib/local-resume-copies";

vi.setConfig(MOUNT_TEST_BUDGET);

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}
const mount = async () => {
  render(
    <MemoryRouter initialEntries={["/account"]}>
      <AuthProvider>
        <Routes>
          <Route path="/account" element={<SecurityCard />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  await screen.findByText("Signed in as member@example.com");
};
const press = async (name: RegExp | string) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };

const DRAFT = JSON.stringify({ personalInfo: { fullName: "Jordan Probe" }, experience: [] });
const EMPTY_INTAKE = JSON.stringify({
  projects: [{ clientType: "", problem: "", deliverable: "", toolsSkills: "", outcome: "", duration: "", paymentBand: "", repeatOrReferral: "" }],
  targetRole: "", jobPosting: "", employmentTimeline: "", situation: "alongside", workMode: "freelance",
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.signOut.mockReset().mockResolvedValue({ error: null });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ mailer_autoconfirm: true }), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("S14X-097: the sign-out buttons and a résumé kept only here", () => {
  it("asks first, and signs nothing out until answered", async () => {
    localStorage.setItem("resumeBuilderDraft", DRAFT);
    await mount();
    await press(/Sign out of this device/);
    expect(h.signOut, "the draft was deleted with no question").not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Your builder résumé is saved only in this browser, and signing out deletes it.");
    expect(localStorage.getItem("resumeBuilderDraft")).toBe(DRAFT);
  });

  it("'Keep it on this device' signs out and keeps the drafts, while the other personal keys go", async () => {
    localStorage.setItem("resumeBuilderDraft", DRAFT);
    await mount();
    localStorage.setItem("rb_last_email", "member@example.com");
    await press(/Sign out of this device/);
    await press("Keep it on this device and sign out");
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(localStorage.getItem("resumeBuilderDraft")).toBe(DRAFT);
    expect(localStorage.getItem("rb_last_email")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
  });

  it("'Delete it and sign out' deletes them, everywhere too", async () => {
    localStorage.setItem("resumeBuilderDraft", DRAFT);
    await mount();
    await press("Sign out everywhere");
    await press("Delete it and sign out");
    expect(h.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(localStorage.getItem("resumeBuilderDraft")).toBeNull();
  });

  it("'Open the builder' signs nothing out and goes to the builder", async () => {
    localStorage.setItem("resumeBuilderDraft", DRAFT);
    await mount();
    await press(/Sign out of this device/);
    await press("Open the builder to download it");
    expect(h.signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId("where").textContent).toBe("/builder");
    expect(localStorage.getItem("resumeBuilderDraft")).toBe(DRAFT);
  });

  it("with no draft, or a Freelance Boost form saved empty on a visit, it signs out at once", async () => {
    localStorage.setItem("freelanceBoostIntake", EMPTY_INTAKE);
    await mount();
    await press(/Sign out of this device/);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("a Freelance Boost intake with typed answers counts, and is named", async () => {
    expect(localWork()).toEqual({ builder: false, freelance: false });
    localStorage.setItem("freelanceBoostIntake", EMPTY_INTAKE.replace('"targetRole":""', '"targetRole":"Fractional CFO"'));
    expect(localWork()).toEqual({ builder: false, freelance: true });
    await mount();
    await press(/Sign out of this device/);
    expect(screen.getByRole("dialog")).toHaveTextContent("Your Freelance Boost details are saved only in this browser, and signing out deletes them.");
    expect(screen.queryByRole("button", { name: "Open the builder to download it" })).toBeNull();
  });
});
