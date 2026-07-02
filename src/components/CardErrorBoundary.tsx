// Per-section error boundary for the scan report. One malformed card must
// degrade to nothing (or a small notice) — never blank the other 25 sections.

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Shown instead of the crashed section; omit to render nothing */
  fallback?: ReactNode;
  /** Name used in the console for debugging */
  section?: string;
}

interface State {
  hasError: boolean;
}

export class CardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[CardErrorBoundary] section "${this.props.section ?? 'unknown'}" crashed:`, error);
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
