/**
 * NOTHING TYPED DURING AN IMPORT IS OVERWRITTEN (S14X-128: M-S14-102, C-S14-135).
 *
 * WHAT WAS WRONG. An import takes up to two minutes, and the editor stayed
 * open the whole time. Whatever the person typed meanwhile was replaced, with
 * no word, by the parsed résumé when the import landed; Start Over pressed
 * during the import was undone the same way.
 *
 * WHAT HOLDS NOW. While the import runs the editor is held (its fieldset is
 * disabled, under the "Importing" banner) and Start Over is disabled. Both
 * come back, holding the imported résumé, when it lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));

import ResumeBuilder from "@/pages/ResumeBuilder";

vi.setConfig(MOUNT_TEST_BUDGET);

const nameInput = () => screen.getByPlaceholderText(i18n.t("resumeBuilder.placeholder.fullName")) as HTMLInputElement;
const startOver = () => screen.getByRole("button", { name: new RegExp(i18n.t("resumeBuilder.startOver")) }) as HTMLButtonElement;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
});
afterEach(() => cleanup());

describe("while the import runs", () => {
  it("the editor and Start Over are held, and come back with the imported résumé", async () => {
    let land!: (v: unknown) => void;
    invoke.mockReturnValueOnce(new Promise((r) => { land = r; }));
    sessionStorage.setItem("rb_resume_text", "Jordan Probe\nProduct analyst at Acme. ".padEnd(160, "A"));
    render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(screen.getByText(i18n.t("resumeBuilder.importing"))).toBeTruthy();
    expect(nameInput().matches(":disabled"), "the name field took typing during the import").toBe(true);
    expect(startOver().disabled).toBe(true);
    await act(async () => {
      land({ data: { success: true, contact: { fullName: "Parsed Name" }, experience: [], education: [], skills: [] }, error: null });
    });
    await waitFor(() => expect(nameInput().value).toBe("Parsed Name"));
    expect(nameInput().matches(":disabled")).toBe(false);
    expect(startOver().disabled).toBe(false);
  });

  it("with no import, nothing is held", () => {
    render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
    expect(nameInput().matches(":disabled")).toBe(false);
    expect(startOver().disabled).toBe(false);
  });
});
