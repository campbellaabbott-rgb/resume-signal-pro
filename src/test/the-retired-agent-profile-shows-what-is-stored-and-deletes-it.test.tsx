/**
 * THE RETIRED AGENT'S PROFILE SHOWS WHAT IS STORED, AND DELETES IT (S14X-199).
 *
 * WHAT WAS WRONG. With the apply agent switched off, /agent?tab=settings still
 * rendered the apply profile as a live form: a CV upload whose toast said
 * "Your CV is attached and the agent can start", "Apply for me automatically"
 * with a daily cap, and the consent and diversity switches. The page went on
 * collecting CVs for an agent that sends nothing, and offered no way to remove
 * the one it already held.
 *
 * WHAT HOLDS NOW, the panel mounted for real with storage and the database
 * faked, and the switch as it ships (off):
 *   - the panel says the agent is off and nothing is sent, and shows the
 *     stored answers as text, with no upload, mode, cap or checkbox;
 *   - "Delete my stored CV and answers" asks first, then removes every file
 *     under resumes/<user id>/ and clears the answers (the account address
 *     stays, for the morning list's mandate);
 *   - a failed removal says so and clears nothing;
 *   - with nothing stored it says so and offers no delete.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import accountEn from "../i18n/shards/account/en.json";

const UID = "00000000-0000-4000-8000-0000000c0c02";
const { world, toasts } = vi.hoisted(() => ({
  world: {
    files: [] as string[],
    removeFails: false,
    mandate: null as Record<string, unknown> | null,
    updates: [] as Array<Record<string, unknown>>,
  },
  toasts: { success: [] as string[], error: [] as string[] },
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => { toasts.success.push(m); }, error: (m: string) => { toasts.error.push(m); } },
}));
vi.mock("@/integrations/supabase/client", () => {
  const mandates = () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = async () => ({ data: world.mandate ? { ...world.mandate } : null, error: null });
    q.update = (v: Record<string, unknown>) => ({
      eq: async () => { world.updates.push(v); Object.assign(world.mandate ?? {}, v); return { error: null }; },
    });
    return q;
  };
  const bucket = {
    list: async (prefix: string) => ({ data: world.files.filter((f) => f.startsWith(`${prefix}/`)).map((f) => ({ name: f.slice(prefix.length + 1) })), error: null }),
    remove: async (paths: string[]) => {
      if (world.removeFails) return { data: null, error: { message: "storage unavailable" } };
      world.files = world.files.filter((f) => !paths.includes(f));
      return { data: null, error: null };
    },
    upload: async () => { throw new Error("nothing uploads while the agent is off"); },
  };
  return { supabase: { from: () => mandates(), storage: { from: () => bucket }, auth: { getUser: async () => ({ data: { user: null } }) } } };
});

import { ApplyProfilePanel } from "@/components/account/ApplyProfilePanel";

vi.setConfig(MOUNT_TEST_BUDGET);
const v = accountEn.accountView;

beforeEach(() => {
  world.files = [`${UID}/Jane_CV.pdf`, `${UID}/old.pdf`, "someone-else/cv.pdf"];
  world.removeFails = false;
  world.updates = [];
  world.mandate = {
    user_id: UID, email: "member@example.com", full_name: "Jane Doe", phone: "+44 20 7946 0000", city: "Leeds",
    salary_expectation: "£60,000", work_authorized: true, resume_file_url: `${UID}/Jane_CV.pdf`, apply_mode: "auto", auto_apply_daily_cap: 7,
  };
  toasts.success = []; toasts.error = [];
});
afterEach(cleanup);

const mount = async () => {
  const view = render(<ApplyProfilePanel userId={UID} />);
  await waitFor(() => expect(view.container.querySelector("[data-profile-retired]")).not.toBeNull());
  return view;
};

describe("with the agent switched off, as it ships", () => {
  it("shows the stored answers as text, and no upload, mode, cap or checkbox", async () => {
    const { container } = await mount();
    const text = container.textContent ?? "";
    expect(text).toContain(v.agentProfileRetired);
    for (const stored of ["Jane Doe", "+44 20 7946 0000", "Leeds", "£60,000", "Jane_CV.pdf"]) expect(text).toContain(stored);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.querySelector("input, textarea")).toBeNull();
    expect(text).not.toMatch(/Apply for me automatically|the agent can start/);
  });

  it("deletes the stored CV files and the answers only after the confirm", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: v.deleteStoredStart }));
    expect(world.files).toHaveLength(3);
    expect(screen.getByText(v.deleteStoredConfirmBody)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: v.deleteStoredConfirm })); });
    await waitFor(() => expect(toasts.success).toContain(v.deleteStoredDone));
    expect(world.files).toEqual(["someone-else/cv.pdf"]);
    expect(world.updates).toHaveLength(1);
    expect(world.updates[0]).toMatchObject({ full_name: "", phone: "", city: "", salary_expectation: "", resume_file_url: "", work_authorized: null });
    expect(world.updates[0]).not.toHaveProperty("email");
    expect(screen.getByText(v.profileNothingStored)).toBeTruthy();
  });

  it("a removal that fails says so and clears no answer", async () => {
    world.removeFails = true;
    await mount();
    fireEvent.click(screen.getByRole("button", { name: v.deleteStoredStart }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: v.deleteStoredConfirm })); });
    await waitFor(() => expect(toasts.error).toContain(v.deleteStoredFailed));
    expect(world.updates).toHaveLength(0);
    expect(screen.getByText("Jane Doe")).toBeTruthy();
  });

  it("with nothing stored, says so and offers no delete", async () => {
    world.mandate = null;
    world.files = [];
    await mount();
    expect(screen.getByText(v.profileNothingStored)).toBeTruthy();
    expect(screen.queryByRole("button", { name: v.deleteStoredStart })).toBeNull();
  });
});
