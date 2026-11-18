/**
 * THE INTERVIEW COACH SAYS A REFUSAL IN THE READER'S LANGUAGE (S14X-058).
 *
 * A refused prep set or score toasted the client library's own English
 * sentence, "Edge Function returned a non-2xx status code", whatever the
 * refusal was: a spent day, a missing sign-in, a limit. The coach now words
 * a 401 or 429 with the writing tools' shared refusal copy, in the page's
 * language, and any other failure with its own sentence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }), toast }));

import i18n from "@/i18n";
import { InterviewCoach } from "@/components/InterviewCoach";

const de = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/de.json"), "utf8"));
const RESUME = "Senior engineer with ten years of payments work at Acme. ".repeat(4);
const refused = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: new Response(JSON.stringify(body), { status }) }),
});
const said = () => toast.mock.calls.map(([arg]) => `${arg?.title ?? ""} ${arg?.description ?? ""}`).join("\n");

beforeEach(async () => {
  i18n.addResourceBundle("de", "translation", de, true, true);
  await i18n.changeLanguage("de");
});
afterEach(async () => {
  invoke.mockReset();
  toast.mockReset();
  await i18n.changeLanguage("en");
});

describe("a refused prep set, in German", () => {
  it("a spent day is the day's allowance in German, never the client library's sentence", async () => {
    invoke.mockResolvedValue(refused(429, { error: "daily_limit", tier: "free", limit: 1 }));
    render(<InterviewCoach resumeText={RESUME} />);
    fireEvent.click(screen.getByRole("button", { name: de.interviewCoach.startButton }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0].description).toBe(de.writingRefusal.dailyNoTime);
    expect(said()).not.toMatch(/non-2xx/);
  });

  it("a missing sign-in asks for one in German", async () => {
    invoke.mockResolvedValue(refused(401, { error: "sign_in_required" }));
    render(<InterviewCoach resumeText={RESUME} />);
    fireEvent.click(screen.getByRole("button", { name: de.interviewCoach.startButton }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0].description).toBe(de.writingRefusal.signIn);
    expect(said()).not.toMatch(/non-2xx/);
  });

  it("positive control: any other failure keeps the coach's own sentence", async () => {
    invoke.mockResolvedValue(refused(500, { error: "boom" }));
    render(<InterviewCoach resumeText={RESUME} />);
    fireEvent.click(screen.getByRole("button", { name: de.interviewCoach.startButton }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0].description).toBe(de.interviewCoach.generateFailed);
    expect(said()).not.toMatch(/non-2xx|boom/);
  });
});
