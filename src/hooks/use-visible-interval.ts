import { useEffect, useRef } from 'react';

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * POLL ONLY WHILE SOMEONE CAN SEE THE PAGE (CW2-HB1). The owner dashboards
 * re-read every 30 to 60 s whether their tab was shown or not: one
 * /health-check left open behind other tabs cost about 1,620 edge calls, 120
 * gateway probes and 120 Stripe calls an hour, read by nobody.
 *
 * Calls `tick` every `ms` while the document is visible. When the tab is
 * hidden the timer stops; when it is shown again `tick` runs once at once and
 * the timer restarts from there, so the page is current the moment it is
 * looked at. `ms` null stops polling (a paused Live switch). The first read is
 * the caller's own: this hook only polls.
 */
export function useVisibleInterval(tick: () => unknown, ms: number | null): void {
  const latest = useRef(tick);
  latest.current = tick;

  useEffect(() => {
    if (ms === null) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const run = () => { void latest.current(); };
    const start = () => { if (id === null) id = setInterval(run, ms); };
    const stop = () => { if (id !== null) { clearInterval(id); id = null; } };
    const onVisibility = () => {
      if (isHidden()) { stop(); return; }
      if (id !== null) return;
      run();
      start();
    };
    if (!isHidden()) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [ms]);
}
