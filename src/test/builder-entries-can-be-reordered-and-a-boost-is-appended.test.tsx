/**
 * BUILDER ENTRIES CAN BE REORDERED, AND A BOOST IS APPENDED (S14X-188: M-S14-165).
 *
 * WHAT WAS WRONG. Freelance Boost's "insert into my résumé" promised to add
 * its entries after the ones already there (the hand-off's own comment says
 * so), but put them first: the freelance work went above the person's
 * current job. And the grip icon beside each entry looked like a drag handle
 * but did nothing, so there was no way to put the jobs back in order.
 *
 * WHAT HOLDS NOW. The boost entries are appended, and every job and school
 * has Move up and Move down buttons (disabled at the ends) in place of the
 * dead grip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { createEmptyResume } from "@/types/resume-builder";
import { EducationEditor } from "@/components/builder/EducationEditor";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));

import ResumeBuilder from "@/pages/ResumeBuilder";

vi.setConfig(MOUNT_TEST_BUDGET);

const jobTitles = () => screen.getAllByPlaceholderText(i18n.t("resumeBuilder.experience.placeholder.jobTitle")).map((e) => (e as HTMLInputElement).value);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  invoke.mockReset();
});
afterEach(() => cleanup());

describe("the Freelance Boost hand-off", () => {
  it("is appended after the current job", async () => {
    const draft = createEmptyResume();
    draft.contact.fullName = "Kept Name";
    draft.experience = [{ ...draft.experience[0], title: "Current Job", company: "Keep Co", bullets: ["Kept bullet."] }];
    localStorage.setItem("resumeBuilderDraft", JSON.stringify(draft));
    sessionStorage.setItem("rb_boost_insert", JSON.stringify({ header: "Freelance Consultant", structure: "per_client", projects: [{ clientLabel: "Client A", bullets: ["Did a thing."] }] }));
    render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
    await waitFor(() => expect(jobTitles()).toEqual(["Current Job", "Freelance Consultant"]));
  });
});

describe("move up and move down", () => {
  it("swap neighbouring jobs, and are disabled at the ends", async () => {
    const draft = createEmptyResume();
    draft.contact.fullName = "Kept Name";
    draft.experience = [
      { ...draft.experience[0], id: "a", title: "First Job" },
      { ...draft.experience[0], id: "b", title: "Second Job" },
    ];
    localStorage.setItem("resumeBuilderDraft", JSON.stringify(draft));
    render(<MemoryRouter><ResumeBuilder /></MemoryRouter>);
    const ups = screen.getAllByRole("button", { name: i18n.t("builderPage.moveUp") }) as HTMLButtonElement[];
    const downs = screen.getAllByRole("button", { name: i18n.t("builderPage.moveDown") }) as HTMLButtonElement[];
    expect(ups[0].disabled).toBe(true);
    expect(downs[downs.length - 1].disabled).toBe(true);
    fireEvent.click(downs[0]);
    await waitFor(() => expect(jobTitles()).toEqual(["Second Job", "First Job"]));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("resumeBuilderDraft")!).experience.map((e: { title: string }) => e.title)).toEqual(["Second Job", "First Job"]));
  });

  it("swap neighbouring schools", () => {
    const onChange = vi.fn();
    const school = (id: string, s: string) => ({ id, school: s, degree: "", field: "", startDate: "", endDate: "", details: "" });
    render(<EducationEditor entries={[school("a", "First School"), school("b", "Second School")]} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("button", { name: i18n.t("builderPage.moveUp") })[1]);
    expect(onChange.mock.calls[0][0].map((e: { school: string }) => e.school)).toEqual(["Second School", "First School"]);
  });
});
