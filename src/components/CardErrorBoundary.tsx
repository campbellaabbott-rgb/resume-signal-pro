// Per-section error boundary for the scan report. One malformed card must
// degrade to nothing (or a small notice) — never blank the other 25 sections.

import { Component, type ReactNode } from "react";
import { postTrackEvent } from "@/lib/track-transport";

interface Props {
  children: ReactNode;
  /** Shown instead of the crashed section; omit to render nothing */
  fallback?: ReactNode;
  /** Name used in the console and telemetry */
  section?: string;
}

interface State {
  hasError: boolean;
  message: string | null;
}

export class CardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message ?? null };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(`[CardErrorBoundary] section "${this.props.section ?? 'unknown'}" crashed:`, error);
    try {
      let visitorId = "unknown";
      try { visitorId = localStorage.getItem("rb_visitor_id") ?? "unknown"; } catch { /* ignore */ }
      postTrackEvent({
        testName: "client_error",
        variant: `${this.props.section ?? "section"}: ${(error?.message ?? "unknown").slice(0, 100)}`,
        eventType: "view",
        visitorId,
        metadata: {
          stack: (error?.stack ?? "").slice(0, 600),
          componentStack: (info?.componentStack ?? "").slice(0, 600),
          path: window.location.pathname,
        },
      });
    } catch { /* telemetry must never crash the boundary */ }
  }

  render() {
    if (this.state.hasError) {
      return (
        <>
          {this.props.fallback ?? null}
          {this.state.message && (
            <p className="mt-2 rounded-lg bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground break-words">
              {String(this.state.message).slice(0, 300)}
            </p>
          )}
        </>
      );
    }
    return this.props.children;
  }
}
