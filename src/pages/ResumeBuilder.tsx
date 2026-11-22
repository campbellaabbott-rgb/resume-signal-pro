import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SEO } from "@/components/seo/SEO";
import { Loader2, Download, FileText, RotateCcw, Sparkles, AlertTriangle } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getResumeFromSession } from "@/hooks/use-session-resume";
import {
  BuilderResume,
  createEmptyResume,
  createEmptyExperienceEntry,
  normalizeBuilderResume,
} from "@/types/resume-builder";
import { ExperienceEditor } from "@/components/builder/ExperienceEditor";
import { EducationEditor } from "@/components/builder/EducationEditor";
import { TagListEditor } from "@/components/builder/TagListEditor";
import { ResumePreview } from "@/components/builder/ResumePreview";
import {
  IMPORTED_FROM_KEY,
  MIN_IMPORT_CHARS,
  applyScanRewrites,
  builderResumeHasContent,
  builderResumeToText,
  importDecision,
  isUsableRewrite,
  textFingerprint,
} from "@/lib/builder-import";
import { IMPORT_MAX_CHARS } from "../../supabase/functions/parse-resume-structured/import-slice";

const DRAFT_STORAGE_KEY = "resumeBuilderDraft";

/**
 * The paid rewrite's one-shot hand-off (RC-S12-110). "Open in builder" after
 * a paid rewrite used to write the rewrite over rb_resume_text, the tab's copy
 * of the person's own scan, so every page after it read the rewrite as the
 * résumé they uploaded. The builder reads this key first and removes it at
 * once; a page that still writes rb_resume_text is read as before.
 */
export const BUILDER_SEED_KEY = "rb_builder_seed";

/** The scan→builder hand-off of the report's fixes (FreeKeywordResults, GapReport). */
const SCAN_FIXES_KEY = "rb_scan_fixes";

/** AuthContext's SIGN_OUT_MARK_KEY: the time of the last deliberate sign-out in this browser. */
const SIGN_OUT_MARK = "rb_signed_out_at";

// A draft with nothing in it is no draft (L3-11): the empty starting résumé
// is never saved, and one saved before this change reads as absent.
function loadDraft(): BuilderResume | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as BuilderResume;
    return builderResumeHasContent(draft) ? draft : null;
  } catch {
    return null;
  }
}

/** What the draft key holds for this résumé: its JSON, or nothing when it is empty. */
const draftValue = (resume: BuilderResume): string | null =>
  builderResumeHasContent(resume) ? JSON.stringify(resume) : null;

/**
 * Writes the draft, or removes an empty one. False when the browser refused
 * the write (S14X-129: a full storage used to be swallowed as "not worth
 * surfacing", and the person lost the draft on the next reload unwarned).
 */
function saveDraft(resume: BuilderResume): boolean {
  try {
    if (builderResumeHasContent(resume)) localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(resume));
    else localStorage.removeItem(DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function removeDraft(): void {
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* storage blocked: nothing kept */ }
}

/**
 * True when localStorage is the browser's own Storage. The storage guard
 * (src/lib/storage-guard.ts, S8-104) swaps in an in-memory stand-in when the
 * browser blocks site storage: the site still runs, but nothing written there
 * outlives the page.
 */
function browserKeepsStorage(): boolean {
  try {
    return typeof Storage !== "function" || window.localStorage instanceof Storage;
  } catch {
    return false;
  }
}

/** The scan the draft was imported from, or last offered (see builder-import). */
function readImportedFrom(): string | null {
  try { return localStorage.getItem(IMPORTED_FROM_KEY); } catch { return null; }
}
function writeImportedFrom(text: string) {
  try { localStorage.setItem(IMPORTED_FROM_KEY, textFingerprint(text)); } catch { /* storage blocked */ }
}

/** True when a deliberate sign-out happened at or after `since` (an import that lands after it writes nothing). */
function signedOutSince(since: number): boolean {
  try {
    const at = Number(localStorage.getItem(SIGN_OUT_MARK));
    return Number.isFinite(at) && at > 0 && at >= since;
  } catch {
    return false;
  }
}

// Scan→builder handoff payload written by the report's "Open in builder with
// fixes applied" button. Rewrites are applied to matching bullets after AI
// extraction; keywords render as a suggestion strip (never auto-inserted —
// only the user can honestly claim a skill).
interface ScanFixes {
  rewrites: Array<{ before: string; after: string }>;
  keywords: string[];
  reportId: string | null;
  /**
   * builder-import's textFingerprint of the résumé the report was made for
   * (S14X-285). A hand-off made for another résumé is dropped; one without
   * (from a page not yet updated) is used as before.
   */
  fingerprint?: string;
}

function removeFixes(): void {
  try { sessionStorage.removeItem(SCAN_FIXES_KEY); } catch { /* ignore */ }
}

/** The report's hand-off, when it was made for this text; a hand-off for another résumé is dropped. */
function readFixes(text: string): ScanFixes | null {
  let fixes: ScanFixes | null = null;
  try {
    const raw = sessionStorage.getItem(SCAN_FIXES_KEY);
    if (raw) fixes = JSON.parse(raw) as ScanFixes;
  } catch { /* malformed payload — treat as absent */ }
  if (!fixes || typeof fixes !== "object") return null;
  if (typeof fixes.fingerprint === "string" && fixes.fingerprint !== textFingerprint(text)) {
    removeFixes();
    return null;
  }
  return fixes;
}

/** A hand-off that waits for Try again is bound to the text it failed on, so it can never reach another résumé. */
function bindFixes(fixes: ScanFixes, text: string): void {
  if (typeof fixes.fingerprint === "string") return;
  try { sessionStorage.setItem(SCAN_FIXES_KEY, JSON.stringify({ ...fixes, fingerprint: textFingerprint(text) })); } catch { /* ignore */ }
}

const usableRewrites = (fixes: ScanFixes | null): number =>
  Array.isArray(fixes?.rewrites) ? fixes!.rewrites.filter((r) => isUsableRewrite(r?.after)).length : 0;

type ImportFailureKind = "dailyLimit" | "busy" | "paused" | "tooLong" | "generic";

/**
 * Why the import failed (S14X-070), from the answer parse-resume-structured
 * and its spend gate give: 429 rate_limited_function is the 15-a-day limit,
 * any other 429 and a 503 are busy, 402 is credits out, 504 (the model's
 * time ran out) and 422 (a reply cut off) mean the résumé took too long to
 * read. supabase-js puts the Response on error.context.
 */
async function importFailureKind(error: unknown): Promise<ImportFailureKind> {
  const res = (error as { context?: unknown } | null)?.context as { status?: unknown; clone?: () => Response } | undefined;
  const status = typeof res?.status === "number" ? res.status : 0;
  let code = "";
  try {
    const body = res && typeof res.clone === "function" ? await res.clone().json() : null;
    if (body && typeof body.code === "string") code = body.code;
  } catch { /* no JSON body */ }
  if (status === 429) return code === "rate_limited_function" || code === "rate_limited_session" ? "dailyLimit" : "busy";
  if (status === 503) return "busy";
  if (status === 402) return "paused";
  if (status === 504 || status === 422) return "tooLong";
  return "generic";
}

interface ImportFailure {
  kind: ImportFailureKind;
  text: string;
  fixes: ScanFixes | null;
}

export default function ResumeBuilder() {
  const { t, i18n } = useTranslation();
  const [resume, setResume] = useState<BuilderResume>(() => loadDraft() || createEmptyResume());
  const [isPrefilling, setIsPrefilling] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [scanKeywords, setScanKeywords] = useState<string[]>([]);
  const [showRescanCta, setShowRescanCta] = useState(false);
  const [importFailure, setImportFailure] = useState<ImportFailure | null>(null);
  const [truncation, setTruncation] = useState<{ imported: number; total: number } | null>(null);
  const [otherTabDraft, setOtherTabDraft] = useState<{ raw: string; resume: BuilderResume } | null>(null);
  const [otherTabCleared, setOtherTabCleared] = useState(false);
  const [storageKept, setStorageKept] = useState<boolean>(() => browserKeepsStorage());
  const [latestScan] = useState<string | null>(() => {
    const text = getResumeFromSession().resumeText;
    return text && text.trim().length >= MIN_IMPORT_CHARS ? text : null;
  });
  const hasAttemptedPrefillRef = useRef(false);
  const mountedRef = useRef(true);
  /** Bumped by each import and by a clear from another tab: an import whose number is not current is dropped. */
  const importGenRef = useRef(0);
  /** The draft value this tab last wrote or adopted, to tell an in-sync tab from a diverged one. */
  const syncedRef = useRef<string | null>(null);
  const resumeRef = useRef(resume);
  resumeRef.current = resume;
  const { toast } = useToast();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /**
   * Imports `text` through parse-resume-structured.
   *
   * S14X-127: the scan is marked imported only together with its saved
   * draft, when the import lands, mounted or not: both or neither. A failure
   * writes nothing. Nothing lands after a sign-out that came after the import
   * started, or after another tab cleared the draft (S14X-096).
   * S14X-070: a failure says why, with Try again; the report's hand-off is
   * kept for it, bound to this text (S14X-285).
   * S14X-071: an import that left part of the résumé out says how much.
   */
  const runImport = (text: string, fixes: ScanFixes | null) => {
    const gen = ++importGenRef.current;
    const startedAt = Date.now();
    const stale = () => importGenRef.current !== gen || signedOutSince(startedAt);
    const fail = (kind: ImportFailureKind) => {
      if (stale()) return;
      if (fixes) bindFixes(fixes, text);
      if (mountedRef.current) setImportFailure({ kind, text, fixes });
    };
    setImportFailure(null);
    setIsPrefilling(true);
    let call: Promise<{ data: unknown; error: unknown }>;
    try {
      call = Promise.resolve(supabase.functions.invoke("parse-resume-structured", { body: { resumeText: text } })) as Promise<{ data: unknown; error: unknown }>;
    } catch (err) {
      call = Promise.reject(err);
    }
    call
      .then(async ({ data: raw, error }) => {
        const data = raw as (Record<string, unknown> & { success?: boolean; resumeTruncated?: unknown; importedChars?: unknown; totalChars?: unknown }) | null;
        if (stale()) return;
        if (error || !data?.success) {
          console.error("[ResumeBuilder] Prefill failed:", error || data?.error);
          fail(error ? await importFailureKind(error) : "generic");
          return;
        }
        let next = normalizeBuilderResume(data);
        let appliedCount = 0;
        if (fixes?.rewrites?.length) {
          const result = applyScanRewrites(next, fixes.rewrites);
          next = result.resume;
          appliedCount = result.applied;
        }
        // The draft and the mark, together: written even when the page was
        // left mid-import, and the mark only once the draft is kept.
        const saved = saveDraft(next);
        if (saved) writeImportedFrom(text);
        removeFixes();

        const imported = Number(data.importedChars);
        const total = Number(data.totalChars);
        const cut = data.resumeTruncated === true && Number.isFinite(imported) && Number.isFinite(total) && total > imported
          ? { imported, total }
          // A function that predates these fields read the first IMPORT_MAX_CHARS.
          : typeof data.resumeTruncated !== "boolean" && text.length > IMPORT_MAX_CHARS
            ? { imported: IMPORT_MAX_CHARS, total: text.length }
            : null;

        if (!mountedRef.current) return;
        if (saved) syncedRef.current = draftValue(next);
        else setStorageKept(false);
        if (fixes?.keywords?.length) setScanKeywords(fixes.keywords);
        setTruncation(cut);
        setResume(next);
        const usable = usableRewrites(fixes);
        toast(
          appliedCount > 0
            ? { title: t("resumeBuilder.toast.importedWithFixesTitle", { count: appliedCount }), description: t("resumeBuilder.toast.importedWithFixesDescription") }
            : usable > 0
              // The report's rewrites came with the import and none landed
              // (S14X-286): said, never passed off as "imported" alone.
              ? { title: t("builderPage.importedNoneMatchedTitle"), description: t("builderPage.importedNoneMatchedDescription", { count: usable }) }
              : { title: t("resumeBuilder.toast.importedTitle"), description: t("resumeBuilder.toast.importedDescription") },
        );
      })
      .catch((err) => {
        console.error("[ResumeBuilder] Prefill error:", err);
        fail("generic");
      })
      .finally(() => {
        if (mountedRef.current && importGenRef.current === gen) setIsPrefilling(false);
      });
  };

  // On first load, prefill from this tab's scan via AI extraction: at once when
  // there is no draft with content; with a confirmation over a real draft when
  // the scan is one it was not imported from (or the report's "fixes applied"
  // handoff is present). See lib/builder-import (L3-11).
  useEffect(() => {
    if (hasAttemptedPrefillRef.current) return;
    hasAttemptedPrefillRef.current = true;

    // Freelance Boost handoff: append the purchased experience section to
    // whatever draft exists (never overwrites — these are ADDITIONAL entries,
    // placed after the person's own, S14X-188).
    // Takes priority over prefill because the user explicitly clicked insert.
    try {
      const boostRaw = sessionStorage.getItem("rb_boost_insert");
      if (boostRaw) {
        sessionStorage.removeItem("rb_boost_insert");
        const boost = JSON.parse(boostRaw) as {
          header: string; structure: string; scopeStatement?: string;
          projects: Array<{ clientLabel: string; bullets: string[] }>;
        };
        const isUmbrella = boost.structure.startsWith("consolidated") || boost.structure === "fractional_portfolio";
        const entries = isUmbrella
          ? [{
              ...createEmptyExperienceEntry(),
              title: boost.header,
              company: boost.structure === "fractional_portfolio" ? "Independent practice" : "Independent / Freelance",
              bullets: [
                ...(boost.scopeStatement ? [boost.scopeStatement] : []),
                ...boost.projects.flatMap(p => p.bullets),
              ],
            }]
          : boost.projects.map(p => ({
              ...createEmptyExperienceEntry(),
              title: boost.header,
              company: p.clientLabel,
              bullets: p.bullets,
            }));
        const base = loadDraft() || createEmptyResume();
        // Drop the placeholder empty entry a fresh builder starts with.
        const existing = base.experience.filter(e => e.title || e.company || e.bullets.some(Boolean));
        setResume({ ...base, experience: [...existing, ...entries] });
        toast({
          title: t("resumeBuilder.toast.freelanceInsertedTitle", { count: entries.length }),
          description: t("resumeBuilder.toast.freelanceInsertedDescription"),
        });
        return;
      }
    } catch (e) {
      console.error("[ResumeBuilder] Boost insert failed:", e);
    }

    // The paid rewrite's one-shot hand-off goes first, and is removed at once.
    let seed: string | null = null;
    try {
      seed = sessionStorage.getItem(BUILDER_SEED_KEY);
      if (seed !== null) sessionStorage.removeItem(BUILDER_SEED_KEY);
    } catch { /* storage blocked */ }
    const sourceText = seed && seed.trim() ? seed : getResumeFromSession().resumeText;
    const fixes = sourceText ? readFixes(sourceText) : null;

    const decision = importDecision({
      draft: loadDraft(),
      sessionText: sourceText,
      hasFixes: !!fixes,
      lastOffered: readImportedFrom(),
    });
    if (decision === "none" || decision === "keep") return;
    if (decision === "ask" || decision === "ask-fixes") {
      // A hand-off with no rewrite (a report with none the builder can use,
      // or the gap report's keywords) asks about the keywords, not fixes it
      // does not carry (S13-038 recheck).
      const carriesRewrites = Array.isArray(fixes?.rewrites) && fixes!.rewrites.length > 0;
      const replace = window.confirm(
        decision === "ask-fixes"
          ? t(carriesRewrites ? "resumeBuilder.replaceWithFixes" : "resumeBuilder.replaceWithKeywords")
          : t("resumeBuilder.replaceWithLatestScan"),
      );
      if (!replace) {
        // Asked once per scan: a "no" is remembered, so the next visit opens
        // the draft without asking again about the same scan. Only a "no":
        // a "yes" whose import then failed must be offered again (S14X-127).
        writeImportedFrom(sourceText!);
        removeFixes();
        // A "no" to the report's handoff keeps the draft but not at the cost
        // of the fixes (S13-126): each rewrite whose bullet is in the draft
        // replaces it, the keyword strip shows, and the toast says how many
        // landed, none included.
        if (decision === "ask-fixes" && fixes) {
          const kept = loadDraft();
          if (kept) {
            const { resume: merged, applied } = applyScanRewrites(kept, Array.isArray(fixes.rewrites) ? fixes.rewrites : []);
            if (applied > 0) setResume(merged);
            if (Array.isArray(fixes.keywords) && fixes.keywords.length) setScanKeywords(fixes.keywords);
            if (Array.isArray(fixes.rewrites) && fixes.rewrites.length) {
              toast(applied > 0
                ? { title: t("resumeBuilder.toast.mergedTitle", { count: applied }), description: t("resumeBuilder.toast.mergedDescription") }
                : { title: t("resumeBuilder.toast.mergedNoneTitle"), description: t("resumeBuilder.toast.mergedNoneDescription") });
            }
          }
        }
        return;
      }
    }
    runImport(sourceText!, fixes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (saveDraft(resume)) syncedRef.current = draftValue(resume);
    else setStorageKept(false);
  }, [resume]);

  // Another tab's write to the draft (S14X-096). A sign-out elsewhere clears
  // it (clearLocalResumeCopies): this tab empties itself, says so, and drops
  // an import still running, so its next keystroke cannot write the résumé
  // back. A change elsewhere is taken without asking by a tab that held what
  // was stored (or nothing); a tab holding something else asks.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== DRAFT_STORAGE_KEY) return;
      if (e.storageArea && e.storageArea !== window.localStorage) return;
      if (e.newValue === null) {
        importGenRef.current += 1;
        syncedRef.current = null;
        setIsPrefilling(false);
        setImportFailure(null);
        setTruncation(null);
        setScanKeywords([]);
        setOtherTabDraft(null);
        setResume(createEmptyResume());
        setOtherTabCleared(true);
        return;
      }
      let incoming: BuilderResume | null = null;
      try {
        const parsed = JSON.parse(e.newValue) as BuilderResume;
        incoming = builderResumeHasContent(parsed) ? parsed : null;
      } catch { /* not a draft */ }
      if (!incoming) return;
      if (e.oldValue === syncedRef.current || !builderResumeHasContent(resumeRef.current)) {
        syncedRef.current = e.newValue;
        setOtherTabDraft(null);
        setOtherTabCleared(false);
        setResume(incoming);
        return;
      }
      setOtherTabDraft({ raw: e.newValue, resume: incoming });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // A browser that keeps nothing (S14X-129): leaving with a résumé asks first.
  const hasContent = builderResumeHasContent(resume);
  useEffect(() => {
    if (storageKept || !hasContent) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [storageKept, hasContent]);

  const handleStartOver = () => {
    if (!window.confirm(t("resumeBuilder.confirmStartOver"))) return;
    setResume(createEmptyResume());
    removeDraft();
    setTruncation(null);
    setImportFailure(null);
    setOtherTabDraft(null);
    setOtherTabCleared(false);
    // The clear sticks (S11-144): the tab's scan counts as offered, so the
    // next visit opens the empty builder instead of re-importing it.
    const scanned = getResumeFromSession().resumeText;
    if (scanned && scanned.trim()) writeImportedFrom(scanned);
  };

  // Import the tab's scan on request (S14X-127): a browser the old order had
  // marked a scan offered before its import failed can import it here.
  const handleImportLatest = () => {
    if (!latestScan) return;
    if (builderResumeHasContent(resume) && !window.confirm(t("resumeBuilder.replaceWithLatestScan"))) return;
    runImport(latestScan, readFixes(latestScan));
  };

  const failureReason = (kind: ImportFailureKind) =>
    kind === "dailyLimit" ? t("builderPage.importFailed.dailyLimit")
      : kind === "busy" ? t("builderPage.importFailed.busy")
        : kind === "paused" ? t("builderPage.importFailed.paused")
          : kind === "tooLong" ? t("builderPage.importFailed.tooLong")
            : t("builderPage.importFailed.generic");

  const fixesWaiting = (f: ScanFixes | null) =>
    !!f && ((Array.isArray(f.rewrites) && f.rewrites.length > 0) || (Array.isArray(f.keywords) && f.keywords.length > 0));

  const formatCount = (n: number) => {
    try { return n.toLocaleString(i18n.language); } catch { return String(n); }
  };

  // A résumé with no name is refused by the exporter (no "Your Name" header
  // goes to an employer, S12-030): the person is asked for it.
  const missingName = (err: unknown) => (err as { code?: string } | null)?.code === "missing_name";
  const askForName = () => toast({
    title: t("resumeBuilder.toast.addNameTitle", "Add your name first"),
    description: t("resumeBuilder.toast.addNameDescription", "Your résumé needs your name at the top before it can be downloaded."),
    variant: "destructive",
  });

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      // The PDF's built-in fonts draw only Windows-1252. A résumé they cannot
      // draw (Łukasz, ₹) is saved as a Word file instead, never as a garbled
      // PDF (S12-006), and the person is told why. Each character is named
      // with its code point, so an invisible one is never named as nothing.
      const { exportResumeBuilderPDF } = await import("@/lib/resume-builder-export");
      const saved = await exportResumeBuilderPDF(resume, { uiLanguage: i18n.language });
      if (saved?.format === "docx") {
        const chars = saved.unsupported.slice(0, 5)
          .map((c) => `${c} (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`)
          .join(", ");
        toast({
          title: t("resumeBuilder.toast.savedAsWordTitle", "Saved as a Word file"),
          description: t("resumeBuilder.toast.savedAsWordDescription", "The PDF's fonts can't draw {{chars}}, so we saved a Word file, which keeps every character.", { chars }),
        });
      }
      setShowRescanCta(true);
    } catch (err) {
      if (missingName(err)) { askForName(); return; }
      console.error("[ResumeBuilder] PDF export failed:", err);
      toast({ title: t("resumeBuilder.toast.exportFailedTitle"), description: t("resumeBuilder.toast.exportPdfFailed"), variant: "destructive" });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportDocx = async () => {
    setIsExportingDocx(true);
    try {
      const { exportResumeBuilderDocx } = await import("@/lib/resume-builder-export");
      await exportResumeBuilderDocx(resume, { uiLanguage: i18n.language });
      setShowRescanCta(true);
    } catch (err) {
      if (missingName(err)) { askForName(); return; }
      console.error("[ResumeBuilder] DOCX export failed:", err);
      toast({ title: t("resumeBuilder.toast.exportFailedTitle"), description: t("resumeBuilder.toast.exportDocxFailed"), variant: "destructive" });
    } finally {
      setIsExportingDocx(false);
    }
  };

  const contactId = (name: string) => `builder-contact-${name}`;

  return (
    <div className="min-h-screen bg-background">
      <SEO title={t("resumeBuilder.seo.title")} description={t("resumeBuilder.seo.description")} path="/builder" />
      <Header />
      <main className="pt-16 pb-20">
        <div className="container max-w-6xl">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold mb-1">{t("resumeBuilder.title")}</h1>
              <p className="text-muted-foreground text-sm">{t("resumeBuilder.subtitle")}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {latestScan && !isPrefilling && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleImportLatest}>
                  <Sparkles className="w-3.5 h-3.5" />
                  {t("builderPage.importLatest")}
                </Button>
              )}
              <Button variant="outline" size="sm" className="gap-1.5" disabled={isPrefilling} onClick={handleStartOver}>
                <RotateCcw className="w-3.5 h-3.5" />
                {t("resumeBuilder.startOver")}
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" disabled={isExportingDocx} onClick={handleExportDocx}>
                {isExportingDocx ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                {t("resumeBuilder.exportDocx")}
              </Button>
              <Button size="sm" className="gap-1.5" disabled={isExportingPdf} onClick={handleExportPdf}>
                {isExportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {t("resumeBuilder.exportPdf")}
              </Button>
            </div>
          </div>

          {!storageKept && (
            <div role="status" className="mb-6 flex items-start gap-2 px-4 py-3 rounded-lg bg-warning/10 border border-warning/40 text-sm text-foreground">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
              <p>{t("builderPage.storageBlocked")}</p>
            </div>
          )}

          {isPrefilling && (
            <div className="mb-6 flex items-center gap-2 px-4 py-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground">
              <Sparkles className="w-4 h-4 text-primary animate-pulse shrink-0" />
              {t("resumeBuilder.importing")}
            </div>
          )}

          {importFailure && (
            <div role="alert" className="mb-6 px-4 py-3 rounded-lg bg-destructive/5 border border-destructive/30 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="text-sm">
                <p className="font-semibold text-foreground">{t("builderPage.importFailed.title")}</p>
                <p className="text-muted-foreground">{failureReason(importFailure.kind)}</p>
                {fixesWaiting(importFailure.fixes) && <p className="text-muted-foreground mt-1">{t("builderPage.importFailed.fixesWaiting")}</p>}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => runImport(importFailure.text, readFixes(importFailure.text) ?? importFailure.fixes)}
              >
                {t("builderPage.importFailed.retry")}
              </Button>
            </div>
          )}

          {truncation && (
            <div role="status" className="mb-6 flex items-start gap-2 px-4 py-3 rounded-lg bg-warning/10 border border-warning/40 text-sm text-foreground">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
              <p>{t("builderPage.importTruncated", { imported: formatCount(truncation.imported), total: formatCount(truncation.total) })}</p>
            </div>
          )}

          {otherTabCleared && (
            <div role="status" className="mb-6 flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-card border border-border text-sm">
              <p>{t("builderPage.otherTab.cleared")}</p>
              <button onClick={() => setOtherTabCleared(false)} className="text-xs text-muted-foreground hover:text-foreground shrink-0">{t("builderPage.dismiss")}</button>
            </div>
          )}

          {otherTabDraft && (
            <div role="alert" className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3 justify-between px-4 py-3 rounded-lg bg-card border border-border text-sm">
              <p>{t("builderPage.otherTab.changed")}</p>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  onClick={() => {
                    syncedRef.current = otherTabDraft.raw;
                    setResume(otherTabDraft.resume);
                    setOtherTabDraft(null);
                  }}
                >
                  {t("builderPage.otherTab.load")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    // This tab's version goes back into the draft.
                    if (saveDraft(resumeRef.current)) syncedRef.current = draftValue(resumeRef.current);
                    else setStorageKept(false);
                    setOtherTabDraft(null);
                  }}
                >
                  {t("builderPage.otherTab.keep")}
                </Button>
              </div>
            </div>
          )}

          {showRescanCta && (
            <div className="mb-6 px-4 py-3 rounded-lg bg-success/5 border border-success/30 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">{t("resumeBuilder.rescan.title")}</p>
                <p className="text-xs text-muted-foreground">{t("resumeBuilder.rescan.body")}</p>
              </div>
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => {
                  // The rescan's text IS this draft (S11-143): marked as the
                  // draft's source, so coming back does not offer to replace
                  // the draft with a re-parse of its own export.
                  const builderText = builderResumeToText(resume);
                  try { sessionStorage.setItem("rb_resume_text", builderText); } catch { /* ignore */ }
                  writeImportedFrom(builderText);
                  window.location.href = "/resume-checker?rescan=1#upload";
                }}
              >
                {t("resumeBuilder.rescan.button")}
              </Button>
            </div>
          )}

          {scanKeywords.length > 0 && (
            <div className="mb-6 px-4 py-3 rounded-lg bg-card border border-border">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs font-semibold text-foreground">{t("resumeBuilder.keywords.title")}</p>
                <button onClick={() => setScanKeywords([])} className="text-xs text-muted-foreground hover:text-foreground shrink-0">{t("resumeBuilder.keywords.dismiss")}</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {scanKeywords.map((k) => (
                  <span key={k} className="px-2.5 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs text-foreground">{k}</span>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">{t("resumeBuilder.keywords.note")}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Editor column: held while an import runs (S14X-128), so nothing
                typed meanwhile is replaced when the parsed résumé lands. */}
            <fieldset disabled={isPrefilling} aria-busy={isPrefilling} className="m-0 min-w-0 border-0 p-0 space-y-8">
              <section className="space-y-3">
                <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("resumeBuilder.section.contact")}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={contactId("fullName")} className="text-xs">{t("resumeBuilder.contact.fullName")}</Label>
                    <Input
                      id={contactId("fullName")}
                      value={resume.contact.fullName}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, fullName: e.target.value } })}
                      placeholder={t("resumeBuilder.placeholder.fullName")}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={contactId("title")} className="text-xs">{t("resumeBuilder.contact.title")}</Label>
                    <Input
                      id={contactId("title")}
                      value={resume.contact.title}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, title: e.target.value } })}
                      placeholder={t("resumeBuilder.placeholder.title")}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={contactId("email")} className="text-xs">{t("resumeBuilder.contact.email")}</Label>
                    <Input
                      id={contactId("email")}
                      value={resume.contact.email}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, email: e.target.value } })}
                      placeholder={t("resumeBuilder.placeholder.email")}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={contactId("phone")} className="text-xs">{t("resumeBuilder.contact.phone")}</Label>
                    <Input
                      id={contactId("phone")}
                      value={resume.contact.phone}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, phone: e.target.value } })}
                      placeholder={t("resumeBuilder.placeholder.phone")}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={contactId("location")} className="text-xs">{t("resumeBuilder.contact.location")}</Label>
                    <Input
                      id={contactId("location")}
                      value={resume.contact.location}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, location: e.target.value } })}
                      placeholder={t("resumeBuilder.placeholder.location")}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={contactId("linkedIn")} className="text-xs">{t("resumeBuilder.contact.linkedIn")}</Label>
                    <Input
                      id={contactId("linkedIn")}
                      value={resume.contact.linkedIn}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, linkedIn: e.target.value } })}
                      placeholder={t("resumeBuilder.placeholder.linkedIn")}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor={contactId("website")} className="text-xs">{t("resumeBuilder.contact.website")}</Label>
                    <Input
                      id={contactId("website")}
                      value={resume.contact.website}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, website: e.target.value } })}
                      placeholder={t("resumeBuilder.placeholder.website")}
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h2 id="builder-summary-heading" className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("resumeBuilder.section.summary")}</h2>
                <Textarea
                  aria-labelledby="builder-summary-heading"
                  value={resume.summary}
                  onChange={(e) => setResume({ ...resume, summary: e.target.value })}
                  placeholder={t("resumeBuilder.placeholder.summary")}
                  className="min-h-[100px]"
                />
              </section>

              <section className="space-y-3">
                <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("resumeBuilder.section.experience")}</h2>
                <ExperienceEditor
                  entries={resume.experience}
                  onChange={(experience) => setResume({ ...resume, experience })}
                />
              </section>

              <section className="space-y-3">
                <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("resumeBuilder.section.education")}</h2>
                <EducationEditor
                  entries={resume.education}
                  onChange={(education) => setResume({ ...resume, education })}
                />
              </section>

              <section className="space-y-3">
                <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("resumeBuilder.section.skills")}</h2>
                <TagListEditor
                  tags={resume.skills}
                  onChange={(skills) => setResume({ ...resume, skills })}
                  placeholder={t("resumeBuilder.placeholder.skill")}
                  label={t("resumeBuilder.section.skills")}
                />
              </section>

              <section className="space-y-3">
                <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("resumeBuilder.section.certifications")}</h2>
                <TagListEditor
                  tags={resume.certifications}
                  onChange={(certifications) => setResume({ ...resume, certifications })}
                  placeholder={t("resumeBuilder.placeholder.certification")}
                  label={t("resumeBuilder.section.certifications")}
                />
              </section>
            </fieldset>

            {/* Live preview column */}
            <div className="lg:sticky lg:top-24 lg:self-start">
              <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3">{t("resumeBuilder.section.preview")}</h2>
              <ResumePreview resume={resume} />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
