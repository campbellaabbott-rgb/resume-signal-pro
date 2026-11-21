// Per-section error boundary for the scan report. One malformed card must
// degrade to nothing (or a small notice) — never blank the other 25 sections.

import { Component, type ReactNode } from "react";
import { reportClientCrash } from "@/lib/client-crash-report";

interface Props {
  children: ReactNode;
  /** Shown instead of the crashed section; omit to render nothing */
  fallback?: ReactNode;
  /** Name used in the console and the error log */
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
    // To the error log, with its section; never to the A/B list (NB-42).
    reportClientCrash({ source: "card", place: this.props.section ?? "section", error, componentStack: info?.componentStack });
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
