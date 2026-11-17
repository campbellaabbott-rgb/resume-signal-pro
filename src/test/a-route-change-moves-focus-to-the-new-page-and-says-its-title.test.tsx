/**
 * A ROUTE CHANGE MOVES FOCUS TO THE NEW PAGE AND SAYS ITS TITLE (S14X-256).
 *
 * WHAT WAS WRONG. Every page is lazy and there is no layout that persists
 * across routes, so the link a keyboard user pressed was removed with the old
 * page and focus fell to <body>: the next Tab started from the top of the
 * document, and a screen reader said nothing at all about the new page.
 * ScrollToTop only scrolled; nothing focused the new page or announced it.
 *
 * WHAT HOLDS NOW, with the real ScrollToTop, the router, lazy pages and
 * Helmet titles:
 *   - when the path changes and the new page shows, a polite live region
 *     (#rb-route-announcer) reads the new title, and, when focus fell out of
 *     the old page, focus lands on the new page's <main> without scrolling;
 *   - a page still loading is waited for: focus never lands on the old page
 *     React hid while the new one's chunk arrives;
 *   - nothing moves on the first load, on an address with a fragment (that
 *     is scroll-to-fragment's), on a change of query alone, or while a modal
 *     dialog is open; focus the reader put somewhere that stayed is left
 *     there, and the title is still said.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense, lazy, type ReactNode } from "react";
import { Helmet, HelmetProvider } from "react-helmet-async";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ScrollToTop } from "@/components/ScrollToTop";

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.title = "";
  document.body.innerHTML = "";
});

function Page({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <main>
      <Helmet><title>{`Page ${name}`}</title></Helmet>
      <h1>{name}</h1>
      {children}
    </main>
  );
}

/** A page A whose query-filter link goes away once a query is set, as the board's chips do. */
function PageA() {
  const { search } = useLocation();
  return (
    <Page name="A">
      <Link to="/b">to B</Link>
      <Link to="/b#details">to B's details</Link>
      <Link to="/modal">to the modal page</Link>
      {!search && <Link to="/?q=1">filter</Link>}
    </Page>
  );
}

/** A lazy page whose chunk arrives after `ms`, as a page's code does over the network. */
const later = (node: () => JSX.Element, ms = 40) =>
  lazy(() => new Promise<{ default: () => JSX.Element }>((r) => setTimeout(() => r({ default: node }), ms)));

function app(entry = "/") {
  const B = later(() => <Page name="B"><p id="details">details</p></Page>);
  const Modal = later(() => (
    <Page name="Modal">
      <div role="dialog" aria-modal="true" aria-label="Choose"><button>Close</button></div>
    </Page>
  ));
  return (
    <HelmetProvider>
      <MemoryRouter initialEntries={[entry]}>
        <ScrollToTop />
        <nav><Link to="/b">B in the header</Link></nav>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<PageA />} />
            <Route path="/b" element={<B />} />
            <Route path="/modal" element={<Modal />} />
          </Routes>
        </Suspense>
      </MemoryRouter>
    </HelmetProvider>
  );
}

const announcer = () => document.getElementById("rb-route-announcer");
const settle = (ms = 150) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
function press(text: string) {
  const link = screen.getByText(text);
  link.focus();
  expect(document.activeElement).toBe(link);
  fireEvent.click(link);
}

describe("a route change", () => {
  it("lands focus on the new page's main and the announcer reads its title", async () => {
    render(app());
    expect(announcer(), "there is no route announcer").not.toBeNull();
    expect(announcer()!.getAttribute("aria-live")).toBe("polite");
    expect(announcer()!.getAttribute("aria-atomic")).toBe("true");
    press("to B");
    const h1 = await screen.findByRole("heading", { name: "B" });
    await waitFor(() => expect(document.activeElement, "focus fell to the body").toBe(h1.closest("main")));
    expect(document.title).toBe("Page B");
    expect(announcer()!.textContent).toBe(document.title);
    expect(h1.closest("main")!.getAttribute("tabindex")).toBe("-1");
  });

  it("never lands on the old page while the new one loads", async () => {
    render(app());
    const oldMain = screen.getByRole("heading", { name: "A" }).closest("main");
    const seen: Element[] = [];
    const watch = () => { if (document.activeElement && document.activeElement !== document.body) seen.push(document.activeElement); };
    document.addEventListener("focusin", watch);
    press("to B");
    await screen.findByRole("heading", { name: "B" });
    await settle();
    document.removeEventListener("focusin", watch);
    expect(seen.includes(oldMain as Element), "focus landed on the page React hid").toBe(false);
  });
});

describe("what moves nothing", () => {
  it("the first load", async () => {
    render(app());
    await settle();
    expect(document.activeElement).toBe(document.body);
    expect(announcer()!.textContent).toBe("");
  });

  it("an address with a fragment, which scroll-to-fragment owns", async () => {
    render(app());
    press("to B's details");
    await screen.findByRole("heading", { name: "B" });
    await settle();
    expect(document.activeElement).toBe(document.body);
    expect(announcer()!.textContent).toBe("");
  });

  it("a change of query alone", async () => {
    render(app());
    press("filter");
    await settle();
    expect(screen.queryByText("filter"), "the query did not change the page").toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(announcer()!.textContent).toBe("");
  });

  it("an open modal dialog keeps the focus and the voice", async () => {
    render(app());
    press("to the modal page");
    await screen.findByRole("heading", { name: "Modal" });
    await settle();
    expect(document.activeElement, "focus was taken from under an open dialog").toBe(document.body);
    expect(announcer()!.textContent).toBe("");
  });

  it("focus the reader left on a control that stayed stays there, and the title is still said", async () => {
    render(app());
    press("B in the header");
    await screen.findByRole("heading", { name: "B" });
    await settle();
    expect(document.activeElement).toBe(screen.getByText("B in the header"));
    await waitFor(() => expect(announcer()!.textContent).toBe("Page B"));
  });
});
