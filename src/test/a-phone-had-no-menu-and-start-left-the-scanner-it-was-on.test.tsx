// A PHONE HAD NO MENU, AND START LEFT THE SCANNER IT WAS ON.
//
// 1. Under 640px the header's whole nav row is `hidden sm:flex` and there was
//    no menu: Explore, Guides, Pricing, Trust and What's New were reachable on
//    a phone only from the footer, beneath "Load more". And the action cluster
//    (language, an /agents icon, Sign in, credits, Start) overflowed at
//    375-390px and clipped Start (S8-093, measured live: Start spanned
//    x=328-408 on a 390px screen). The phone now gets one menu button that
//    holds the nav and Sign in; the /agents icon and the bar's Sign in moved
//    into it. (Measured in the browser pane at 375x812 after the change:
//    Start's right edge 364px, no horizontal overflow; at 360x740, 344px.)
//
// 2. S8-094. Start navigated anywhere off "/" to "/#upload". The scanner
//    landers (/resume-checker, /ats-resume-test, /resume-score,
//    /es/revisar-curriculum) render the uploader themselves, and the reused
//    Index never re-ran its mount-only hash effect, so the visitor was dropped
//    at the top of the homepage instead of the uploader they were on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import { Header } from "@/components/Header";

let where = "";
function Where() { const l = useLocation(); where = `${l.pathname}${l.hash}`; return null; }
function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="*" element={<><Header /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { where = ""; try { sessionStorage.clear(); } catch { /* blocked */ } });
afterEach(() => { document.getElementById("upload")?.remove(); });

describe("a phone had no menu", () => {
  it("one menu button opens every destination the hidden nav row holds, and Sign in; Escape and a choice close it", () => {
    mount("/jobs");
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("phone-nav")).toBeNull();

    fireEvent.click(button);
    const nav = screen.getByRole("navigation", { name: "Site menu" });
    const hrefs = within(nav).getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const to of ["/jobs", "/agents", "/explore", "/guides", "/pricing", "/trust", "/changelog", "/auth"]) {
      expect(hrefs, `the phone menu has no way to ${to}`).toContain(to);
    }
    expect(screen.getByRole("button", { name: "Close menu" }).getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.getElementById("phone-nav")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Site menu" })).getByRole("link", { name: "Explore" }));
    expect(where).toBe("/explore");
    expect(document.getElementById("phone-nav")).toBeNull();
  });
});

describe("Start left the scanner it was on", () => {
  it("on a scanner lander, Start scrolls to that page's uploader and stays on the page", () => {
    const upload = document.createElement("div");
    upload.id = "upload";
    const scroll = vi.fn();
    upload.scrollIntoView = scroll;
    document.body.appendChild(upload);
    mount("/resume-checker");
    fireEvent.click(screen.getByRole("button", { name: /Get started/ }));
    expect(scroll).toHaveBeenCalled();
    expect(where, "Start navigated away from the uploader the visitor was on").toBe("/resume-checker");
  });

  it("positive control: a page with no uploader still goes to the homepage's", () => {
    mount("/pricing");
    fireEvent.click(screen.getByRole("button", { name: /Get started/ }));
    expect(where).toBe("/#upload");
  });
});
