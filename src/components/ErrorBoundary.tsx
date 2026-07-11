import { Component, ReactNode } from "react";
import { postTrackEvent } from "@/lib/track-transport";

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
      let visitorId = "unknown";
      try { visitorId = localStorage.getItem("rb_visitor_id") ?? "unknown"; } catch { /* ignore */ }
      postTrackEvent({
        testName: "client_error",
        variant: (error?.message ?? "unknown").slice(0, 120),
        eventType: "view",
        visitorId,
        metadata: {
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

      return (
        <div className="flex min-h-screen items-center justify-center p-8 text-center">
          <div className="max-w-md space-y-4">
            <h1 className="text-2xl font-semibold text-gray-900">Something went wrong</h1>
            <p className="text-gray-600">
              An unexpected error occurred. Please refresh the page to try again.
            </p>
            {this.state.error?.message && (
              <p className="rounded-lg bg-gray-100 px-3 py-2 text-left font-mono text-xs text-gray-500 break-words">
                {String(this.state.error.message).slice(0, 300)}
              </p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Refresh page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
