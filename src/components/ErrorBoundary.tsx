import { Component, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { postTrackEvent, getVisitorId } from "@/lib/track-transport";
import { crashVariant } from "@/lib/crash-variant";
import { AUTH_SUPPORT_EMAIL } from "@/config/auth-providers";

/**
 * THE APP'S CRASH SCREEN, IN THE VISITOR'S LANGUAGE (S12-138). It was English
 * for all nine locales, printed the raw JavaScript error as its second line,
 * and offered nothing but Refresh: a crash right after a payment was a dead
 * end. It now speaks through t() (English defaults until the locales carry
 * the keys), keeps the error behind a closed "Technical details" toggle, and
 * names where to write. It renders outside the router, so its link is a plain
 * mailto.
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

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
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

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
    // Fire-and-forget telemetry so crashes are diagnosable without asking
    // users to open devtools. No PII: message + trimmed stacks only.
    try {
      const visitorId = getVisitorId();
      postTrackEvent({
        testName: "client_error",
        // Within track-ab-event's 30 characters (S8-121) and one per crash,
        // so a visitor's second crash is not a duplicate of the first.
        variant: crashVariant("app", error?.message ?? "unknown"),
        eventType: "view",
        visitorId,
        metadata: {
          message: (error?.message ?? "unknown").slice(0, 300),
          stack: (error?.stack ?? "").slice(0, 600),
          componentStack: (info?.componentStack ?? "").slice(0, 600),
          path: window.location.pathname,
        },
      });
    } catch { /* never let telemetry crash the boundary */ }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return <CrashScreen error={this.state.error} />;
    }

    return this.props.children;
  }
}
