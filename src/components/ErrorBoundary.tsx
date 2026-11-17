import { Component, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { AUTH_SUPPORT_EMAIL } from "@/config/auth-providers";
import { isChunkLoadError, isReloadingForNewVersion } from "@/lib/new-version-reload";
import { reportClientCrash } from "@/lib/client-crash-report";

/**
 * THE APP'S CRASH SCREEN, IN THE VISITOR'S LANGUAGE (S12-138). It was English
 * for all nine locales, printed the raw JavaScript error as its second line,
 * and offered nothing but Refresh: a crash right after a payment was a dead
 * end. It now speaks through t() (English defaults until the locales carry
 * the keys), keeps the error behind a closed "Technical details" toggle, and
 * names where to write. It renders outside the router too (the root
 * boundary), so its links are plain anchors: a mailto, and the homepage
 * (NB-40), which loads the site afresh.
 */
export function CrashScreen({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  const detail = error?.message ? String(error.message).slice(0, 300) : "";
  return (
    // Theme tokens, not gray-900 on the near-black body (~1.1:1): the
    // headline was invisible in the dark theme (sweep S8-117).
    <div className="flex min-h-screen items-center justify-center bg-background p-8 text-center text-foreground">
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">{t("crashScreen.title", "Something went wrong")}</h1>
        <p className="text-muted-foreground">
          {t("crashScreen.body", "An unexpected error stopped this page. Refreshing usually fixes it.")}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
        >
          {t("crashScreen.refresh", "Refresh page")}
        </button>
        <p>
          <a className="text-sm text-primary underline" href="/">{t("siteShell.crashHome", "Go to the homepage")}</a>
        </p>
        <p className="text-sm text-muted-foreground">
          {t("crashScreen.supportLead", "Still stuck, or did this happen right after a payment? Write to us:")}{" "}
          <a className="text-primary underline" href={`mailto:${AUTH_SUPPORT_EMAIL}`}>{AUTH_SUPPORT_EMAIL}</a>
        </p>
        {detail && (
          <details className="text-left">
            <summary className="cursor-pointer text-xs text-muted-foreground">{t("crashScreen.details", "Technical details")}</summary>
            <p className="mt-2 rounded-lg bg-muted px-3 py-2 font-mono text-xs text-muted-foreground break-words">{detail}</p>
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * WHAT A TAB ON ITS WAY TO THE NEW BUILD SHOWS (NB-41): not the crash screen.
 * The reload is already under way; the button is for a chunk that is still
 * missing after it.
 */
export function NewVersionScreen() {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex min-h-screen items-center justify-center bg-background p-8 text-center text-foreground">
      <div className="max-w-md space-y-4">
        <p className="text-lg">{t("siteShell.newVersion.loading", "Loading the new version…")}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
        >
          {t("siteShell.newVersion.reload", "Reload now")}
        </button>
      </div>
    </div>
  );
}

/** A deploy, not a crash: the page is reloading for the new build, or a chunk could not be fetched. */
const isNewVersion = (error: unknown): boolean => isReloadingForNewVersion() || isChunkLoadError(error);

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * A new value clears a caught error and renders the children again. The
   * route boundary passes the pathname, so Back, a link or the address bar
   * leaves a crashed page (NB-40).
   */
  resetKey?: unknown;
  /** Where this boundary sits, for the error log: the app's (the default) or a page's. */
  source?: "app" | "page";
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // A deploy is not a crash: nothing is filed for it (NB-41).
    if (isNewVersion(error)) {
      console.warn("[ErrorBoundary] a chunk of the previous build is gone; loading the new version:", error?.message);
      return;
    }
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
    // To the error log /errors reads, whatever the analytics choice and with
    // no visitor id; never to the A/B list (NB-42, src/lib/client-crash-report.ts).
    reportClientCrash({ source: this.props.source ?? "app", error, componentStack: info?.componentStack });
  }

  render() {
    if (this.state.hasError) {
      if (isNewVersion(this.state.error)) return <NewVersionScreen />;
      if (this.props.fallback) return this.props.fallback;

      return <CrashScreen error={this.state.error} />;
    }

    return this.props.children;
  }
}

/**
 * THE PAGES' OWN BOUNDARY, INSIDE THE ROUTER (NB-40). The only boundary was
 * the root one, outside the router: one render error on any page replaced the
 * whole site with the crash screen, and since its state was never cleared,
 * Back changed the address and left the crash screen where it was. This one
 * wraps the routes, so the rest of the shell stays mounted, and it clears
 * itself when the path changes. The root boundary stays as the last resort.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname} source="page">{children}</ErrorBoundary>;
}
