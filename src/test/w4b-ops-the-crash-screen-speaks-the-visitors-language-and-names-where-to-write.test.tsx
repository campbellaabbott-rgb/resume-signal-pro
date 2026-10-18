/**
 * THE CRASH SCREEN SPEAKS THE VISITOR'S LANGUAGE AND NAMES WHERE TO WRITE
 * (S12-138).
 *
 * WHAT WAS WRONG. The app-wide crash screen was English in all nine locales,
 * printed the raw JavaScript error as its second line ("Cannot read
 * properties of undefined (reading 'map')"), and offered only Refresh: a
 * crash on the page after a payment left the buyer nowhere to go.
 *
 * WHAT HOLDS NOW: every sentence comes through t() (English defaults until the
 * locales carry the keys, so a locale that does carry them is used), the error
 * sits behind a closed "Technical details" toggle, and the screen links the
 * support address the footer and help button use.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { AUTH_SUPPORT_EMAIL } from "@/config/auth-providers";

vi.mock("@/lib/track-transport", () => ({ postTrackEvent: vi.fn(), getVisitorId: () => "v" }));

import { ErrorBoundary } from "@/components/ErrorBoundary";

const Boom = (): JSX.Element => { throw new Error("Cannot read properties of undefined (reading 'map')"); };
const crash = () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  return render(<ErrorBoundary><Boom /></ErrorBoundary>);
};

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });

describe("the app's crash screen", () => {
  it("keeps the raw error behind a closed Technical details toggle, never as a line of the page", () => {
    crash();
    const raw = screen.getByText(/Cannot read properties of undefined/);
    const details = raw.closest("details");
    expect(details, "the raw error is printed outside any toggle").toBeTruthy();
    expect(details!.open).toBe(false);
    expect(details!.querySelector("summary")?.textContent).toBe("Technical details");
  });

  it("links the support address, so a crash after a payment is not a dead end", () => {
    crash();
    const link = screen.getByRole("link", { name: AUTH_SUPPORT_EMAIL });
    expect(link.getAttribute("href")).toBe(`mailto:${AUTH_SUPPORT_EMAIL}`);
    expect(screen.getByRole("button", { name: "Refresh page" })).toBeTruthy();
  });

  it("speaks through t(): a locale that carries the keys is what the visitor reads", async () => {
    i18n.addResourceBundle("fr", "translation", {
      crashScreen: { title: "Une erreur est survenue", body: "Une erreur inattendue a arrêté cette page.", refresh: "Actualiser la page", supportLead: "Toujours bloqué ? Écrivez-nous :", details: "Détails techniques" },
    }, true, true);
    await i18n.changeLanguage("fr");
    crash();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Une erreur est survenue");
    expect(screen.getByRole("button", { name: "Actualiser la page" })).toBeTruthy();
    expect(screen.getByText("Détails techniques")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("positive control: in English, with no locale value, it reads the English defaults", () => {
    crash();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Something went wrong");
    expect(screen.getByText(/An unexpected error stopped this page/)).toBeTruthy();
  });
});
