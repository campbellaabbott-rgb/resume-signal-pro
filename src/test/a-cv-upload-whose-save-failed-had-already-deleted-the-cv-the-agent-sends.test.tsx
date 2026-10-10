/**
 * A CV UPLOAD WHOSE SAVE FAILED HAD ALREADY DELETED THE CV THE AGENT SENDS
 * (wave 3 review of payments-account; the L3-13 cleanup).
 *
 * WHAT WAS WRONG. Replacing the apply agent's CV removed every other file
 * under resumes/{user id}/ as soon as the upload finished, before the CV was
 * parsed and before the new path was saved to agent_mandates.resume_file_url.
 * When that save failed (or the tab closed during the parse) the mandate
 * still named the old file, which no longer existed: apply-broker signed a
 * URL for a missing object and the agent applied with no CV.
 *
 * WHAT HOLDS NOW, the panel mounted for real with storage and the database
 * faked: a failed save removes nothing, so the mandate's file is still there;
 * a successful save removes the old file only after the mandate names the new
 * one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const UID = "00000000-0000-4000-8000-0000000c0c01";
const { world } = vi.hoisted(() => ({
  world: {
    saveFails: false,
    files: [] as string[],
    events: [] as string[],
    mandate: {} as Record<string, unknown>,
  },
}));

vi.mock("@/lib/resumeText", () => ({ resumeTextFrom: async () => "" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const mandates = () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = async () => ({ data: { ...world.mandate }, error: null });
    q.update = (v: Record<string, unknown>) => ({
      eq: async () => {
        world.events.push("save");
        if (world.saveFails) return { error: { message: "network", code: "08006" } };
        Object.assign(world.mandate, v);
        return { error: null };
      },
    });
    q.upsert = q.update;
    return q;
  };
  const bucket = {
    upload: async (path: string) => { world.events.push("upload"); if (!world.files.includes(path)) world.files.push(path); return { data: { path }, error: null }; },
    list: async (prefix: string) => ({ data: world.files.filter((f) => f.startsWith(`${prefix}/`)).map((f) => ({ name: f.slice(prefix.length + 1) })), error: null }),
    remove: async (paths: string[]) => { world.events.push("remove"); world.files = world.files.filter((f) => !paths.includes(f)); return { data: null, error: null }; },
  };
  return {
    supabase: {
      from: () => mandates(),
      storage: { from: () => bucket },
      auth: { getUser: async () => ({ data: { user: { email: "member@example.com" } } }) },
    },
  };
});

import { ApplyProfilePanel } from "@/components/account/ApplyProfilePanel";

vi.setConfig(MOUNT_TEST_BUDGET);

beforeEach(() => {
  world.saveFails = false;
  world.files = [`${UID}/Jane_CV.pdf`];
  world.events = [];
  world.mandate = { user_id: UID, resume_file_url: `${UID}/Jane_CV.pdf`, email: "member@example.com" };
});
afterEach(cleanup);

async function replaceCv() {
  const { container } = render(<ApplyProfilePanel userId={UID} />);
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeNull());
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["%PDF-1.4"], "Jane_CV_2026.pdf", { type: "application/pdf" })] } });
  await waitFor(() => expect(world.events).toContain("save"));
  await new Promise((r) => setTimeout(r, 0));
}

describe("replacing the apply agent's CV", () => {
  it("a save that fails removes nothing: the file the mandate names is still stored", async () => {
    world.saveFails = true;
    await replaceCv();
    expect(world.mandate.resume_file_url).toBe(`${UID}/Jane_CV.pdf`);
    expect(world.files, "the mandate's CV was deleted before the save").toContain(world.mandate.resume_file_url);
    expect(world.events).not.toContain("remove");
  });

  it("a save that lands removes the old file, and only after the mandate names the new one", async () => {
    await replaceCv();
    await waitFor(() => expect(world.events).toContain("remove"));
    expect(world.mandate.resume_file_url).toBe(`${UID}/Jane_CV_2026.pdf`);
    expect(world.files).toEqual([`${UID}/Jane_CV_2026.pdf`]);
    expect(world.events).toEqual(["upload", "save", "remove"]);
    expect(screen.queryByText(/Jane_CV_2026/)).not.toBeNull();
  });
});
