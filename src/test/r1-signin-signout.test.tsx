/**
 * R1: SIGN-OUT LEAVES NOTHING PERSONAL, AND THE ACCOUNT GUARD IS ASKED ONCE.
 *
 * Register CP-012: sign-out was global (the auth-js default) and left the
 * last person's address, résumé copies and cached reports behind, so the next
 * buyer's checkout opened with that address. Now:
 *   - signOut() is this device only; signOutEverywhere() is global;
 *   - a deliberate sign-out clears every key below, each held equal to the
 *     key its writer uses; an expired session clears none;
 *   - auth-signed-in is called once per session (single-flight, keyed by the
 *     token's session_id), with that session's own token, and its answer is
 *     exposed as guardResult; a cleared password is explained once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const h = vi.hoisted(() => ({
  listeners: [] as Array<(event: string, s: unknown) => void>,
  signOut: vi.fn(),
  invoke: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => { h.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: null } }),
      signOut: (...a: unknown[]) => h.signOut(...a),
    },
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
  },
}));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: async () => ({}) } } }));
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => h.toast(...a), useToast: () => ({ toast: h.toast }) }));

import { AuthProvider, PERSONAL_LOCAL_KEYS, PERSONAL_SESSION_KEYS, guardKey, useAuth } from "@/contexts/AuthContext";
import { PRESTORED_RESUME_KEY, CHECKOUT_RETRY_KEY } from "@/hooks/use-product-checkout";
import { JD_HANDOFF_KEY } from "@/lib/jd-handoff";
import { CREDIT_SESSIONS_KEY, FREELANCE_PURCHASE_KEY } from "@/lib/purchase-proofs";
import { PURCHASE_KEY as FREELANCE_PAGE_KEY } from "@/pages/FreelanceBoost";

const ROOT = resolve(__dirname, "../..");
const code = (rel: string) => codeOf(readFileSync(resolve(ROOT, rel), "utf8"));

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (claims: Record<string, unknown>) => `eyJhbGciOiJIUzI1NiJ9.${b64({ exp: 4_102_444_800, ...claims })}.sig`;
const sessionFor = (email: string, sid: string, method = "otp") => ({
  access_token: jwt({ sub: "u1", email, session_id: sid, amr: [{ method, timestamp: 1 }] }),
  refresh_token: "rt",
  user: { id: "u1", email },
});
const emit = (event: string, s: unknown) => act(() => { for (const cb of h.listeners) cb(event, s); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

function Probe() {
  const { signOut, signOutEverywhere, guardResult, setResetUnderway } = useAuth();
  return (
    <div>
      <span data-testid="guard">{`${guardResult.state}:${guardResult.proven}:${guardResult.passwordCleared}`}</span>
      <button onClick={() => void signOut()}>out</button>
      <button onClick={() => void signOutEverywhere()}>everywhere</button>
      <button onClick={() => void signOut({ keepLocalWork: true })}>reject</button>
      <button onClick={() => setResetUnderway(true)}>resetting</button>
    </div>
  );
}

beforeEach(() => {
  h.listeners = [];
  localStorage.clear();
  sessionStorage.clear();
  h.signOut.mockReset().mockResolvedValue({ error: null });
  h.invoke.mockReset().mockResolvedValue({ data: { proven: true, passwordCleared: false }, error: null });
  h.toast.mockReset();
});
afterEach(cleanup);

function fill() {
  const local: Record<string, string> = {
    rb_last_email: "last@example.com", scanCreditsEmail: "buyer@example.com", rb_auth_pending: "{}", rb_guard_seen: "{}",
    scanCreditsSessions: "[\"cs_live_ABCDEFGHIJKLMNOP\"]", freelanceBoostPurchase: "{\"at\":1}",
    resumeBuilderDraft: "{\"name\":\"Jordan Probe\"}", freelanceBoostIntake: "{}", rb_scan_history: "{}", rb_personalization_profile: "{}",
    resume_scan_cache_v2_abc: "{}", ai_summary_9f_tech: "{}",
    i18nextLng: "de", rb_visitor_id: "v_1", rb_dismissed_jobs: "[]",
  };
  for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
  for (const k of [...PERSONAL_SESSION_KEYS, "rb_url_stash"]) sessionStorage.setItem(k, "Jordan Probe");
  sessionStorage.setItem("session_start", "1");
}

describe("a deliberate sign-out", () => {
  it("is this device only, and clears every personal key while leaving the rest", async () => {
    fill();
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-out"));
    await act(async () => { fireEvent.click(screen.getByText("out")); });
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
    const left = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).sort();
    expect(left).toEqual(["i18nextLng", "rb_dismissed_jobs", "rb_signed_out_at", "rb_visitor_id"]);
    expect(Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i))).toEqual(["session_start"]);
    expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toMatch(/Jordan|@example\.com/);
  });

  it("everywhere is global", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { fireEvent.click(screen.getByText("everywhere")); });
    expect(h.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("an expired session clears nothing (the same person comes back to it)", async () => {
    fill();
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-exp"));
    emit("SIGNED_OUT", null);
    expect(localStorage.getItem("rb_last_email")).toBe("member@example.com");
    expect(localStorage.getItem("resumeBuilderDraft")).toContain("Jordan");
    expect(sessionStorage.getItem("rb_resume_text")).toBe("Jordan Probe");
  });
});

describe("a sign-out in another tab, and a session turned away", () => {
  it("another tab's deliberate sign-out clears this tab's personal session copies too (S12-181)", async () => {
    fill();
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "rb_signed_out_at", newValue: String(Date.now()) }));
    });
    expect(Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i))).toEqual(["session_start"]);
  });

  it("a session this tab held that another tab signed out on purpose takes its copies with it", async () => {
    fill();
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-tab2"));
    localStorage.setItem("rb_signed_out_at", String(Date.now()));
    emit("SIGNED_OUT", null);
    expect(sessionStorage.getItem("rb_resume_text")).toBeNull();
    expect(sessionStorage.getItem("session_start")).toBe("1");
  });

  it("'Not you?' signs that session out of this device and keeps the visitor's own work (review major)", async () => {
    fill();
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("attacker@evil.example", "sid-rej"));
    await act(async () => { fireEvent.click(screen.getByText("reject")); });
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(localStorage.getItem("resumeBuilderDraft"), "the visitor's own draft was wiped").toContain("Jordan");
    expect(localStorage.getItem("rb_scan_history")).toBe("{}");
    expect(sessionStorage.getItem("rb_resume_text")).toBe("Jordan Probe");
    expect(localStorage.getItem("rb_last_email")).toBeNull();
    expect(localStorage.getItem("rb_guard_seen")).toBeNull();
    expect(localStorage.getItem("rb_signed_out_at"), "another tab would clear its copies on this mark").toBeNull();
  });
});

describe("every key the sign-out clears is the key its writer uses", () => {
  it("local keys", () => {
    expect(PERSONAL_LOCAL_KEYS).toEqual(expect.arrayContaining(["rb_last_email", "scanCreditsEmail", CREDIT_SESSIONS_KEY, FREELANCE_PURCHASE_KEY]));
    expect(code("src/hooks/use-scan-credits.ts")).toContain("localStorage.setItem(CREDIT_SESSIONS_KEY");
    expect(code("src/hooks/use-scan-credits.ts")).toContain("from '@/lib/purchase-proofs'");
    expect(FREELANCE_PAGE_KEY).toBe(FREELANCE_PURCHASE_KEY);
    expect(code("src/components/EmailReportCapture.tsx")).toContain('localStorage.setItem("rb_last_email"');
    expect(code("src/hooks/use-scan-credits.ts")).toContain("localStorage.setItem('scanCreditsEmail'");
    expect(code("src/hooks/use-pro-subscription.ts")).toContain('localStorage.setItem("scanCreditsEmail"');
  });

  it("session keys", () => {
    const sessionResume = code("src/hooks/use-session-resume.ts");
    for (const k of ["rb_resume_text", "rb_linkedin_text", "rb_job_description_text", "rb_multi_column_detected"]) expect(sessionResume, k).toContain(`'${k}'`);
    expect(code("src/pages/Index.tsx")).toContain('sessionStorage.setItem("rb_resume_for_fit"');
    expect(code("src/pages/Index.tsx")).toContain('sessionStorage.setItem("rb_scan_industry"');
    expect(code("src/pages/Jobs.tsx")).toContain('sessionStorage.setItem("rb_board_resume"');
    expect(code("src/components/FreeKeywordResults.tsx")).toContain("sessionStorage.setItem('rb_scan_fixes'");
    expect(code("src/pages/ResumeBuilder.tsx")).toContain('sessionStorage.getItem("rb_boost_insert")');
    for (const k of [PRESTORED_RESUME_KEY, CHECKOUT_RETRY_KEY, JD_HANDOFF_KEY]) expect(PERSONAL_SESSION_KEYS as readonly string[], k).toContain(k);
  });
});

describe("the account guard", () => {
  it("is asked once per session, with that session's own token, and its answer is exposed", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    const s = sessionFor("member@example.com", "sid-g");
    emit("INITIAL_SESSION", s);
    emit("SIGNED_IN", s);
    emit("TOKEN_REFRESHED", { ...s, access_token: jwt({ sub: "u1", email: "member@example.com", session_id: "sid-g", amr: [{ method: "otp", timestamp: 1 }], iat: 2 }) });
    await flush();
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledWith("auth-signed-in", { method: "POST", body: {}, headers: { Authorization: `Bearer ${s.access_token}` } });
    await waitFor(() => expect(screen.getByTestId("guard").textContent).toBe("done:true:false"));
    expect(guardKey(s as never)).toBe("sid-g");
  });

  it("a new tab (a second provider) reuses the answer this browser already has", async () => {
    const s = sessionFor("member@example.com", "sid-tab");
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", s);
    await flush();
    cleanup();
    h.listeners = [];
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("INITIAL_SESSION", s);
    await flush();
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it("a new session is asked again", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-a"));
    await flush();
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-b"));
    await flush();
    expect(h.invoke).toHaveBeenCalledTimes(2);
  });

  it("a cleared password is explained once, and a refusal is never mistaken for a proof", async () => {
    h.invoke.mockResolvedValueOnce({ data: { proven: true, passwordCleared: true }, error: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-c"));
    await flush();
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.toast.mock.calls[0][0])).toMatch(/cleared a password set on this address before you proved you own it/);
    cleanup();
    h.listeners = [];
    h.invoke.mockResolvedValueOnce({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { status: 403, clone: () => ({ json: async () => ({ error: "forbidden", reason: "client_token" }) }) } } });
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-d"));
    await flush();
    await waitFor(() => expect(screen.getByTestId("guard").textContent).toBe("failed:false:false"));
  });

  it("a refused proof that still cleared the pre-proof password (409 changed_since_sign_in) is explained, and stays unproven", async () => {
    h.invoke.mockResolvedValueOnce({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { status: 409, clone: () => ({ json: async () => ({ error: "The account changed after this sign-in.", reason: "changed_since_sign_in", proven: false, passwordCleared: true }) }) } } });
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-409"));
    await flush();
    await waitFor(() => expect(screen.getByTestId("guard").textContent).toBe("failed:false:true"));
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.toast.mock.calls[0][0])).toMatch(/cleared a password set on this address before you proved you own it/);
  });

  it("during a reset the cleared-password notice stays quiet, judged when the answer arrives (minor: live recovery amr is otp)", async () => {
    h.invoke.mockResolvedValueOnce({ data: { proven: true, passwordCleared: true }, error: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { fireEvent.click(screen.getByText("resetting")); });
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-reset", "otp"));
    await flush();
    await waitFor(() => expect(screen.getByTestId("guard").textContent).toBe("done:true:true"));
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("a guard that ended every session says so and leaves this device quietly, keeping the visitor's work (minor: signedOut was ignored)", async () => {
    fill();
    h.invoke.mockResolvedValueOnce({ data: { proven: true, passwordCleared: true, signedOut: true, reason: "every_session_ended" }, error: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-ended"));
    await flush();
    await waitFor(() => expect(h.signOut).toHaveBeenCalledWith({ scope: "local" }));
    expect(JSON.stringify(h.toast.mock.calls[0]?.[0])).toMatch(/signed out every device, this one too/);
    expect(localStorage.getItem("resumeBuilderDraft")).toContain("Jordan");
  });

  it("never blocks the app: a guard that never answers leaves the session usable", async () => {
    h.invoke.mockReturnValue(new Promise(() => {}));
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-hang"));
    await flush();
    expect(screen.getByTestId("guard").textContent).toBe("pending:false:false");
    await act(async () => { fireEvent.click(screen.getByText("out")); });
    expect(h.signOut).toHaveBeenCalled();
  });
});
