/**
 * A CRASH IN THE BROWSER IS WRITTEN TO THE ERROR LOG (NB-42).
 *
 * The error boundaries sent a crash as an A/B event through the analytics
 * transport, which sends nothing until a visitor allows analytics: most
 * visitors never answer the banner, so most crashes were never reported, and
 * those that were sat in the owner's A/B test list with no message. Nothing
 * listened for window errors or unhandled rejections at all.
 *
 * Now every crash (a boundary's, an uncaught error's, an unhandled
 * rejection's) is one error_telemetry row through log_error_telemetry, the
 * operational log /errors reads: type "client", code CRASH_<where>, the
 * message, the route (in function_name, the log's "where" column, and in the
 * context) and the first stack frames. It carries no visitor id and is sent
 * whatever the analytics choice; the Privacy page lists error logs under the
 * log data every visit leaves. The writer itself caps the text and budgets
 * each address.
 *
 * Not a crash, so never written: a deploy (a chunk that cannot be fetched,
 * a page reloading for the new build: src/lib/new-version-reload.ts), a
 * cross-origin "Script error." that says nothing, an extension's own error,
 * the ResizeObserver notice, and a request the network refused or the page
 * aborted. One crash is written once a page, and at most
 * MAX_CRASH_REPORTS_PER_PAGE a page. Its text keeps no e-mail address, no
 * token and no query or fragment of an address.
 */
import { supabase } from "@/integrations/supabase/client";
import { isChunkLoadError, isReloadingForNewVersion } from "@/lib/new-version-reload";

/** Where the crash was caught: the app's boundary, a page's, a card's, the window, a promise. */
export type CrashSource = "app" | "page" | "card" | "window" | "promise";

export const CRASH_ERROR_TYPE = "client";
export const MAX_CRASH_REPORTS_PER_PAGE = 5;

const MESSAGE_MAX = 300;
const FRAMES = 6;
const FRAMES_MAX = 600;
const ROUTE_MAX = 128;

export interface CrashReport {
  source: CrashSource;
  error: unknown;
  /** React's component stack, for a boundary's crash. */
  componentStack?: string | null;
  /** A card boundary's section. */
  place?: string;
  /** The script a window error came from. */
  filename?: string;
}

export interface CrashRow {
  p_error_type: string;
  p_error_code: string;
  p_error_message: string;
  p_function_name: string;
  p_context: { route: string; source: CrashSource; stack: string; place?: string; componentStack?: string };
}

/** No e-mail address, no token, and no query or fragment of an address. */
export function scrubCrashText(text: string): string {
  return String(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[token]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>()]*)[?#][^\s"'<>():]*/gi, "$1");
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  if (error === undefined || error === null) return "";
  try {
    return String(error);
  } catch {
    return "";
  }
}

const firstLines = (text: string, n: number, max: number) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n)
    .map((l) => scrubCrashText(l).slice(0, 200))
    .join("\n")
    .slice(0, max);

const EXTENSION = /\b(chrome|moz|safari(-web)?|ms-browser)-extension:\/\//i;
const NETWORK = /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|Network request failed)$/i;

/** A deploy, the browser's noise, or a request that never reached us: not a crash of ours. */
export function isNotACrash(report: CrashReport, message: string): boolean {
  const { error, filename } = report;
  if (isReloadingForNewVersion() || isChunkLoadError(error) || isChunkLoadError({ message })) return true;
  if (/^Script error\.?$/i.test(message.trim())) return true;
  if (/^ResizeObserver loop/i.test(message.trim())) return true;
  if ((error as { name?: unknown } | null)?.name === "AbortError") return true;
  if (NETWORK.test(message.trim())) return true;
  const stack = typeof (error as { stack?: unknown } | null)?.stack === "string" ? String((error as { stack: string }).stack) : "";
  const firstFrame = stack.split("\n").find((l) => /:\/\//.test(l)) ?? "";
  if (EXTENSION.test(filename ?? "") || EXTENSION.test(firstFrame)) return true;
  return false;
}

/** The row a crash writes, or null when it is not a crash. */
export function crashRow(report: CrashReport, route: string = currentRoute()): CrashRow | null {
  const raw = messageOf(report.error);
  if (isNotACrash(report, raw)) return null;
  const message = scrubCrashText(raw.trim() || "(no message)").slice(0, MESSAGE_MAX);
  const stackText = typeof (report.error as { stack?: unknown } | null)?.stack === "string" ? String((report.error as { stack: string }).stack) : "";
  const context: CrashRow["p_context"] = { route, source: report.source, stack: firstLines(stackText, FRAMES, FRAMES_MAX) };
  if (report.place) context.place = report.place.slice(0, 64);
  if (report.componentStack) context.componentStack = firstLines(report.componentStack, FRAMES, FRAMES_MAX);
  return {
    p_error_type: CRASH_ERROR_TYPE,
    p_error_code: `CRASH_${report.source.toUpperCase()}`,
    p_error_message: message,
    p_function_name: route,
    p_context: context,
  };
}

function currentRoute(): string {
  try {
    return scrubCrashText(window.location.pathname || "/").slice(0, ROUTE_MAX);
  } catch {
    return "/";
  }
}

const written = new Set<string>();
let count = 0;

/** Write a crash to the error log, once a page and within the page's cap. Answers whether it was sent. Never throws. */
export function reportClientCrash(report: CrashReport): boolean {
  try {
    const row = crashRow(report);
    if (!row) return false;
    const key = `${report.source}|${report.place ?? ""}|${row.p_error_message}`;
    if (written.has(key) || count >= MAX_CRASH_REPORTS_PER_PAGE) return false;
    written.add(key);
    count++;
    void supabase.rpc("log_error_telemetry", row).then(
      () => undefined,
      () => undefined,
    );
    return true;
  } catch {
    // Reporting a crash must never be one.
    return false;
  }
}

/** Listen for what no boundary catches: an uncaught error and an unhandled rejection. Returns the uninstaller. */
export function installWindowCrashReporting(win: Window = window): () => void {
  const onError = (e: Event) => {
    const ev = e as ErrorEvent;
    reportClientCrash({ source: "window", error: ev.error ?? ev.message, filename: ev.filename });
  };
  const onRejection = (e: Event) => {
    reportClientCrash({ source: "promise", error: (e as PromiseRejectionEvent).reason });
  };
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  return () => {
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Tests only. */
export function resetCrashReportsForTests(): void {
  written.clear();
  count = 0;
}
