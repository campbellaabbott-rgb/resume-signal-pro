import { Bot, BookOpen, Briefcase, Building2, ChevronDown, Compass, CreditCard, Megaphone, Menu, Shield, User as UserIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Logo } from "@/components/Logo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ScanCreditsCounter } from "@/components/ScanCreditsCounter";
import { postTrackEvent, getVisitorId } from "@/lib/track-transport";
import { cn } from "@/lib/utils";

/**
 * THE SITE HEADER, BY BREAKPOINT (design spec 3.1).
 *
 *   lg and up   logo · Jobs, Companies, For AI chats, Pricing, More ▾ ·
 *               language · credits · Sign in · Get started. Under xl the
 *               language shows as its code and Sign in as a named icon.
 *   under lg    logo · credits (a named icon button) · Start · Menu. The menu
 *               is a sheet holding every link, the language list and the
 *               account link, each 44 px tall (an important utility: the base
 *               a[href] floor outranks a single class). From sm up the
 *               account icon also stays in the bar.
 *
 * The call to action never shrinks and never clips: in German, French, Dutch
 * and Hindi the measured header at 1024 and 1280 keeps it whole (audit: the
 * German "Get Started" was cut off at 1280). The phone CTA's accessible name
 * is its visible word, "Start".
 *
 * Layer 40: every sheet and dialog (50) sits above it, so a sheet's close
 * button can never sit under the header.
 *
 * THE QUIET VARIANT (homepage and pricing spec of 2026-10-17, section 3): a
 * page whose own content carries its one filled button (the board-first
 * homepage's "Search jobs", the pricing page's "Create a free account")
 * mounts <Header variant="quiet" />. It has no filled button: no Get started
 * and no Start. Sign in is a plain link in the row, and when the row does not
 * fit it moves into the Menu sheet, which then shows at every width. Whether
 * it fits is MEASURED on the row (useSignInFits), never read off a fixed
 * breakpoint: the row's width depends on the language, the text size, the
 * account label and a credits balance. At the default text size the row is
 * tightest at 375 to 383 px in Spanish, French and Tagalog (below 375 px the
 * wordmark is screen-reader only), and a larger text size fills it at wider
 * widths. The quiet header shows a credits control only to a browser with a
 * proven balance: Scan Packs are no longer sold and neither page sells
 * credits, so a visitor with none sees no "My credits" explainer.
 */

/**
 * How many pixels wider the row would have to be for everything in it to
 * fit, or 0 when it fits. Three ways it can fail to fit, each measured:
 * content past the row's box (scrollWidth past clientWidth); the right-hand
 * group ending inside the row's right padding, which a flex row that does
 * not scroll never reports as overflow; and a nav squeezed narrower than its
 * links (it may shrink, so its links overlap the group while the row's own
 * widths still agree).
 */
function rowDeficit(el: HTMLElement): number {
  const scroll = el.scrollWidth - el.clientWidth;
  let gutter = 0;
  const actions = el.querySelector<HTMLElement>("[data-header-actions]");
  if (actions) {
    const pad = parseFloat(getComputedStyle(el).paddingRight) || 0;
    const end = actions.getBoundingClientRect().right;
    const limit = el.getBoundingClientRect().right - pad;
    // Sub-pixel layout never counts: a full pixel inside the gutter does.
    if (end - limit >= 1) gutter = Math.ceil(end - limit);
  }
  const nav = el.querySelector<HTMLElement>("[data-header-nav]");
  const squeezed = nav ? nav.scrollWidth - nav.clientWidth : 0;
  return Math.max(0, scroll, gutter, squeezed);
}

/**
 * True while the quiet row has room for Sign in. A row that does not fit
 * moves it out and remembers how wide the full row needed to be; it comes
 * back only once the row is at least that wide again, so it never flickers
 * at the edge. The measure runs again whenever what is in the row can
 * change, not only when the row's box does:
 *   - on every render of the header;
 *   - when the row, any of its children or any control in them changes size
 *     (a credits badge that arrives after mount, a longer label);
 *   - on a new language or account label, from the full row (Sign in back in
 *     the row first), even when it already was there.
 * Off (always true) for the default header.
 */
function useSignInFits(row: RefObject<HTMLElement>, enabled: boolean, remeasureKey: string): boolean {
  const [fits, setFits] = useState(true);
  const fitsNow = useRef(true);
  const fullWidth = useRef<number | null>(null);
  const check = useCallback(() => {
    const el = row.current;
    if (!enabled || !el) return;
    if (fitsNow.current) {
      const deficit = rowDeficit(el);
      if (deficit > 0) {
        fullWidth.current = el.clientWidth + deficit;
        fitsNow.current = false;
        setFits(false);
      }
    } else if (fullWidth.current !== null && el.clientWidth >= fullWidth.current) {
      fitsNow.current = true;
      setFits(true);
    }
  }, [row, enabled]);
  // A new language or account: measure again from the full row.
  useLayoutEffect(() => {
    fullWidth.current = null;
    if (!fitsNow.current) {
      fitsNow.current = true;
      setFits(true);
    }
  }, [remeasureKey]);
  // Every render: what the row holds may have changed without its box.
  useLayoutEffect(() => { check(); });
  useLayoutEffect(() => {
    const el = row.current;
    if (!enabled || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => check());
    observer.observe(el);
    for (const child of Array.from(el.children)) {
      observer.observe(child);
      for (const control of Array.from(child.children)) observer.observe(control);
    }
    return () => observer.disconnect();
  }, [row, enabled, fits, check]);
  return !enabled || fits;
}

export function Header({ variant = "default" }: { variant?: "default" | "quiet" } = {}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const quiet = variant === "quiet";
  const row = useRef<HTMLDivElement>(null);
  const signInInRow = useSignInFits(row, quiet, `${i18n.language}|${session ? "account" : "signin"}`);

  // The menu closes on any navigation, and on Escape wherever focus is.
  useEffect(() => { setMenuOpen(false); }, [location.pathname, location.search, location.hash]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // The one nav item with an event: arrivals at /agents from the header are
  // measured (nav_agents → ab_test_events). Fire-and-forget, no-op locally.
  const trackNavAgents = () => {
    postTrackEvent({ testName: "nav", variant: "nav_agents", eventType: "view", visitorId: getVisitorId() });
  };

  const scrollToUpload = () => {
    // THE UPLOADER ON THIS PAGE FIRST (S8-094): the scanner landers render
    // their own uploader, so Start scrolls to it instead of leaving the page.
    const uploadSection = document.getElementById("upload");
    if (uploadSection) {
      uploadSection.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // Anywhere else, the scanner's own address: since the homepage
    // switch-over "/" is the job board and has no uploader to scroll to.
    navigate("/resume-checker#upload");
  };

  const accountTo = session ? "/account" : "/auth";
  const accountLabel = session ? t("header.account", "Account") : t("header.signIn", "Sign in");

  const primary = [
    { to: "/jobs", label: t("header.jobs", "Jobs"), icon: Briefcase },
    { to: "/companies", label: t("header.companies", "Companies"), icon: Building2 },
    { to: "/agents", label: t("header.forAiChats", "For AI chats"), icon: Bot, onClick: trackNavAgents },
    { to: "/pricing", label: t("header.pricing", "Pricing"), icon: CreditCard },
  ];
  const more = [
    { to: "/explore", label: t("header.explore", "Explore"), icon: Compass },
    { to: "/guides", label: t("header.guides", "Guides"), icon: BookOpen },
    { to: "/trust", label: t("header.trust", "Trust"), icon: Shield },
    { to: "/changelog", label: t("header.changelog", "What's New"), icon: Megaphone },
  ];

  const isCurrent = (to: string) => location.pathname === to || (to !== "/" && location.pathname.startsWith(`${to}/`));

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/90 backdrop-blur-sm" role="banner">
      <div ref={row} data-header-row className="container flex h-14 items-center gap-2 lg:h-16 lg:gap-4">
        <Link
          to="/"
          onClick={(e) => {
            if (window.location.pathname === "/") {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          className="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={t("header.homeAriaLabel")}
        >
          <Logo className="h-7 w-7" />
          {/* The wordmark gives way under 375px so the actions never clip. */}
          <span className="text-base font-bold tracking-tight max-[374px]:sr-only lg:text-lg">
            Resume <span className="text-primary">Booster</span>
          </span>
        </Link>

        <nav data-header-nav className="hidden min-w-0 items-center gap-0.5 lg:flex" aria-label={t("header.mainNavAriaLabel")}>
          {primary.map(({ to, label, onClick }) => (
            <Link
              key={to}
              to={to}
              onClick={onClick}
              aria-current={isCurrent(to) ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center whitespace-nowrap rounded-md px-2.5 text-sm font-medium transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isCurrent(to) ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </Link>
          ))}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("header.more", "More")}
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[12rem]">
              {more.map(({ to, label, icon: Icon }) => (
                <DropdownMenuItem key={to} asChild>
                  <Link to={to} className="flex items-center gap-2">
                    <Icon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                    {label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        <div data-header-actions className="ml-auto flex shrink-0 items-center gap-1 lg:gap-2">
          <div className="hidden lg:block">
            <LanguageSwitcher variant="compact" />
          </div>
          {/* Quiet: only a proven balance, never the explainer about buying
              credits (nothing on the quiet pages sells them). */}
          <ScanCreditsCounter balanceOnly={quiet} />
          {quiet ? (
            // Quiet: Sign in by its word, a plain link, while the row has
            // room; otherwise it is in the Menu sheet below.
            signInInRow && (
              <Link
                to={accountTo}
                data-header-signin=""
                className="flex h-9 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11"
              >
                {accountLabel}
              </Link>
            )
          ) : (
            <>
              {/* The account icon: in the bar from sm up, named at every width. */}
              <Link
                to={accountTo}
                className="hidden sm:flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11"
              >
                <UserIcon aria-hidden="true" className="h-4 w-4" />
                <span className="sr-only xl:not-sr-only">{accountLabel}</span>
              </Link>
              {/* Named by its visible word, as the phone's Start is: the old
                  aria-label ("Empezar - desplazarse a la sección de carga") did
                  not contain the visible "Comenzar" in Spanish or Portuguese
                  (WCAG 2.5.3 Label in Name). */}
              <Button
                onClick={scrollToUpload}
                size="sm"
                className="hidden shrink-0 lg:inline-flex"
                data-header-cta="desktop"
              >
                {t("header.getStarted")}
              </Button>
              <Button onClick={scrollToUpload} size="sm" className="shrink-0 lg:hidden">
                {t("header.start")}
              </Button>
            </>
          )}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <IconButton
                aria-label={t("header.menu", "Menu")}
                aria-expanded={menuOpen}
                aria-controls="phone-nav"
                className={quiet && !signInInRow ? undefined : "lg:hidden"}
              >
                <Menu />
              </IconButton>
            </SheetTrigger>
            <SheetContent
              side="right"
              title={t("header.phoneNavAriaLabel", "Site menu")}
              closeLabel={t("header.closeMenu", "Close menu")}
              closeProps={{ "aria-expanded": true, "aria-controls": "phone-nav" }}
            >
              <nav id="phone-nav" aria-label={t("header.phoneNavAriaLabel", "Site menu")}>
                <ul className="grid gap-1">
                  {[...primary, ...more, { to: accountTo, label: accountLabel, icon: UserIcon }].map(({ to, label, icon: Icon, onClick }: { to: string; label: string; icon: typeof UserIcon; onClick?: () => void }) => (
                    <li key={to}>
                      <Link
                        to={to}
                        aria-current={isCurrent(to) ? "page" : undefined}
                        onClick={() => { onClick?.(); setMenuOpen(false); }}
                        className="flex !min-h-11 items-center gap-3 rounded-md px-3 text-base text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="mt-6 border-t border-border pt-4">
                <LanguageSwitcher variant="list" />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
