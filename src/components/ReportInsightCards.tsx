import { useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Share2, Wrench, ArrowRight, Scale } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/* ============================================================
 * New free-report insight cards:
 *  - ScoreSimulatorCard: interactive before/after — check fixes, watch the score move
 *  - AtsVendorChecksCard: how Workday/Greenhouse/Lever/iCIMS handle THIS resume
 *  - WeakestBulletsCard: 3 worst bullets, graded + rewritten
 *  - CareerBridgeCard: transferable-skills map for career changers
 *  - ScoreAuditCard: "why this score" — every point accounted for
 *  - ShareScoreCard: downloadable branded score-card image
 * ============================================================ */

// ---------- Score simulator ----------

export function ScoreSimulatorCard({
  atsScore,
  fixes,
}: {
  atsScore: number;
  fixes: Array<{ label: string; impact: number }>;
}) {
  const [checked, setChecked] = useState<boolean[]>(() => fixes.map(() => false));
  if (!fixes.length) return null;

  const gained = fixes.reduce((sum, f, i) => sum + (checked[i] ? f.impact : 0), 0);
  const projected = Math.min(95, atsScore + gained);
  const pct = (n: number) => `${Math.min(100, Math.max(0, n))}%`;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-1">
        <Wrench className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-foreground">What happens if you fix it?</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Check the fixes you're willing to make — this is the score a rescan should land near.
      </p>

      <div className="relative h-8 rounded-full bg-muted overflow-hidden mb-1" role="img" aria-label={`Score ${atsScore}, projected ${projected}`}>
        <div className="absolute inset-y-0 left-0 bg-primary/25 transition-all duration-500" style={{ width: pct(projected) }} />
        <div className="absolute inset-y-0 left-0 bg-primary transition-all duration-300" style={{ width: pct(atsScore) }} />
        <span className="absolute inset-y-0 flex items-center text-[11px] font-bold text-primary-foreground" style={{ left: `calc(${pct(atsScore)} - 28px)` }}>{atsScore}</span>
        {gained > 0 && (
          <span className="absolute inset-y-0 flex items-center text-[11px] font-bold text-primary" style={{ left: `calc(${pct(projected)} + 6px)` }}>
            → {projected}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        {gained > 0
          ? <>Projected: <span className="font-semibold text-foreground">{projected}</span> (+{gained} points)</>
          : "Your current score. Start checking fixes below."}
      </p>

      <div className="space-y-2">
        {fixes.map((f, i) => (
          <label key={i} className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-colors ${checked[i] ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/25"}`}>
            <input
              type="checkbox"
              checked={checked[i]}
              onChange={() => setChecked(prev => prev.map((c, j) => j === i ? !c : c))}
              className="mt-0.5 accent-[hsl(var(--primary))]"
            />
            <span className="text-xs text-foreground flex-1">{f.label}</span>
            <span className="text-xs font-semibold text-primary shrink-0">+{f.impact}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------- ATS vendor-specific parse checks ----------

interface VendorFinding { vendor: string; status: "pass" | "warn" | "fail"; note: string }

/** Static, well-documented vendor parsing behaviors applied to THIS resume's features. */
export function computeVendorChecks(input: {
  resumeText: string;
  multiColumnDetected?: boolean;
  hasTables?: boolean;
}): VendorFinding[] {
  const { resumeText, multiColumnDetected } = input;
  const text = resumeText || "";
  // Feature detection on the raw text
  const hasTabRuns = /\t{2,}|(?: {6,}\S+){2,}/m.test(text);
  const hasSpecialBullets = /[✦✧➤➣◆◇►▶✓☑]/.test(text);
  const nonStandardHeaders = !/(experience|employment|work history)/i.test(text) || !/(education|academic)/i.test(text);
  const longLines = text.split("\n").filter(l => l.length > 220).length > 3;

  const risk = (fail: boolean, warn: boolean, failNote: string, warnNote: string, passNote: string): { status: VendorFinding["status"]; note: string } =>
    fail ? { status: "fail", note: failNote } : warn ? { status: "warn", note: warnNote } : { status: "pass", note: passNote };

  return [
    {
      vendor: "Workday",
      ...risk(
        !!multiColumnDetected,
        hasTabRuns || hasSpecialBullets,
        "Multi-column layouts scramble Workday's parser — content reads out of order.",
        "Tab-aligned text or decorative bullets can merge fields in Workday's preview.",
        "Single-column, standard bullets — parses cleanly in Workday.",
      ),
    },
    {
      vendor: "Greenhouse",
      ...risk(
        false,
        !!multiColumnDetected || longLines,
        "",
        "Greenhouse keeps the PDF but its keyword search relies on extracted text — layout quirks reduce match hits.",
        "Greenhouse stores your original file; text extraction looks reliable here.",
      ),
    },
    {
      vendor: "Lever",
      ...risk(
        false,
        hasSpecialBullets || nonStandardHeaders,
        "",
        "Lever's section detection expects standard headers (Experience, Education) — creative headers may unsort your history.",
        "Standard section headers — Lever will thread your history correctly.",
      ),
    },
    {
      vendor: "iCIMS",
      ...risk(
        !!multiColumnDetected && hasTabRuns,
        !!multiColumnDetected || hasTabRuns,
        "Columns plus tab alignment is the worst case for iCIMS — fields land in the wrong boxes.",
        "iCIMS auto-fills application fields from the parse — verify the auto-filled form before submitting.",
        "Should auto-fill iCIMS application fields correctly.",
      ),
    },
  ];
}

export function AtsVendorChecksCard(props: { resumeText: string; multiColumnDetected?: boolean }) {
  const findings = useMemo(() => computeVendorChecks(props), [props.resumeText, props.multiColumnDetected]);
  if (!props.resumeText) return null;
  const icon = { pass: "✅", warn: "⚠️", fail: "🚫" } as const;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h3 className="font-semibold text-foreground mb-1">How the big ATS platforms read this resume</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Each system parses differently. These checks apply each vendor's documented quirks to your actual formatting.
      </p>
      <div className="grid sm:grid-cols-2 gap-2.5">
        {findings.map(f => (
          <div key={f.vendor} className={`rounded-xl border p-3 ${f.status === "fail" ? "border-destructive/30 bg-destructive/5" : f.status === "warn" ? "border-warning/30 bg-warning/5" : "border-border bg-background/40"}`}>
            <p className="text-xs font-semibold text-foreground mb-1">{icon[f.status]} {f.vendor}</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{f.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Weakest bullets ----------

export function WeakestBulletsCard({
  bullets,
}: {
  bullets: Array<{ original: string; grade: string; issues: string[]; rewrite: string }>;
}) {
  if (!bullets?.length) return null;
  const gradeColor = (g: string) =>
    /a/i.test(g) ? "text-success" : /b/i.test(g) ? "text-primary" : /c/i.test(g) ? "text-warning" : "text-destructive";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h3 className="font-semibold text-foreground mb-1">Your {bullets.length} weakest bullets, graded</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Quoted from your resume, graded on metrics + verbs + scope, and rewritten. Fill any [brackets] with your real numbers.
      </p>
      <div className="space-y-3">
        {bullets.map((b, i) => (
          <div key={i} className="rounded-xl border border-border p-3.5">
            <div className="flex items-start gap-3 mb-2">
              <span className={`text-2xl font-black shrink-0 ${gradeColor(b.grade)}`}>{b.grade.toUpperCase().slice(0, 2)}</span>
              <p className="text-xs text-muted-foreground italic line-through decoration-destructive/40 flex-1">"{b.original}"</p>
            </div>
            {b.issues?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {b.issues.slice(0, 3).map((iss, j) => (
                  <span key={j} className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-medium">{iss}</span>
                ))}
              </div>
            )}
            <div className="flex items-start gap-2 rounded-lg bg-success/5 border border-success/20 p-2.5">
              <ArrowRight className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
              <p className="text-xs text-foreground">{b.rewrite}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Career-change bridge ----------

export function CareerBridgeCard({
  bridge,
}: {
  bridge: { fromField: string; toField: string; carryOver: string[]; needsReframing: Array<{ current: string; reframed: string }>; gapToClose: string };
}) {
  if (!bridge) return null;
  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/5 to-transparent p-5 sm:p-6">
      <h3 className="font-semibold text-foreground mb-1">
        Your bridge: {bridge.fromField} → {bridge.toField}
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        Career changers get filtered when their resume speaks the old field's language. Here's what already transfers — and what to reword.
      </p>

      <p className="text-xs font-semibold text-foreground mb-1.5">✅ Carries over as-is</p>
      <ul className="space-y-1 mb-4">
        {bridge.carryOver.slice(0, 6).map((c, i) => (
          <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
            <span className="text-success shrink-0">•</span>{c}
          </li>
        ))}
      </ul>

      {bridge.needsReframing?.length > 0 && (
        <>
          <p className="text-xs font-semibold text-foreground mb-1.5">🔁 Reword for {bridge.toField}</p>
          <div className="space-y-2 mb-4">
            {bridge.needsReframing.slice(0, 3).map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2.5 text-xs">
                <p className="text-muted-foreground line-through decoration-muted-foreground/40 mb-1">{r.current}</p>
                <p className="text-foreground font-medium">{r.reframed}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="rounded-lg bg-warning/5 border border-warning/25 p-3">
        <p className="text-xs text-foreground"><span className="font-semibold">Biggest gap to close:</span> {bridge.gapToClose}</p>
      </div>
    </div>
  );
}

// ---------- Freelance / project-career guidance ----------

export function FreelanceGuidanceCard({
  guidance,
}: {
  guidance: { positioning: string; projectsAsExperience: Array<{ project: string; presentAs: string }>; employerTransition?: string };
}) {
  if (!guidance?.projectsAsExperience?.length) return null;
  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/5 to-transparent p-5 sm:p-6">
      <h3 className="font-semibold text-foreground mb-1">💼 Your freelance work, positioned like a career</h3>
      <p className="text-xs text-muted-foreground mb-4">
        ATS parsers and recruiters misread scattered gigs. Here's how to present yours as one coherent track — using your actual projects.
      </p>

      <div className="rounded-lg bg-background/50 border border-border p-3 mb-4">
        <p className="text-xs font-semibold text-foreground mb-1">Position it as</p>
        <p className="text-xs text-muted-foreground">{guidance.positioning}</p>
      </div>

      <p className="text-xs font-semibold text-foreground mb-2">Turn projects into experience bullets</p>
      <div className="space-y-2 mb-4">
        {guidance.projectsAsExperience.slice(0, 4).map((p, i) => (
          <div key={i} className="rounded-lg border border-border p-2.5 text-xs">
            <p className="text-muted-foreground mb-1">📁 {p.project}</p>
            <p className="text-foreground font-medium flex items-start gap-1.5">
              <ArrowRight className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
              <span>{p.presentAs}</span>
            </p>
          </div>
        ))}
      </div>

      {guidance.employerTransition && guidance.employerTransition.trim().length > 0 && (
        <div className="rounded-lg bg-warning/5 border border-warning/25 p-3">
          <p className="text-xs text-foreground">
            <span className="font-semibold">Moving to employment or a new field?</span> {guidance.employerTransition}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------- Score audit trail ----------

export function ScoreAuditCard({
  audit,
}: {
  audit: { total: number; items: Array<{ label: string; earned: number; possible: number; detail: string }> };
}) {
  const [open, setOpen] = useState(false);
  if (!audit?.items?.length) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 text-left" aria-expanded={open}>
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-foreground">Why {audit.total}? Every point, accounted for</h3>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          {audit.items.map((item, i) => (
            <div key={i}>
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-xs font-medium text-foreground">{item.label}</p>
                <p className="text-xs font-semibold text-foreground">{item.earned}<span className="text-muted-foreground font-normal">/{item.possible}</span></p>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-1">
                <div className={`h-full rounded-full ${item.earned / item.possible >= 0.7 ? "bg-success" : item.earned / item.possible >= 0.45 ? "bg-warning" : "bg-destructive"}`} style={{ width: `${Math.min(100, (item.earned / item.possible) * 100)}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground">{item.detail}</p>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">
            Component points are derived from the same sub-scores shown in the breakdown above and sum to your total.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------- Shareable score card ----------

export function ShareScoreCard({
  atsScore,
  industry,
  percentile,
}: {
  atsScore: number;
  industry: string;
  percentile?: number;
}) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = (): HTMLCanvasElement | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const W = 1200, H = 630;
    canvas.width = W; canvas.height = H;

    // Background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#0b1220");
    bg.addColorStop(1, "#101c33");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Accent ring with score
    const cx = 300, cy = H / 2, r = 170;
    ctx.lineWidth = 26;
    ctx.strokeStyle = "#1f2c47";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    const scoreColor = atsScore >= 75 ? "#34d399" : atsScore >= 55 ? "#fbbf24" : "#f87171";
    ctx.strokeStyle = scoreColor;
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * atsScore) / 100); ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 120px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(atsScore), cx, cy - 12);
    ctx.font = "600 30px system-ui, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("ATS SCORE", cx, cy + 70);

    // Right side text
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 52px system-ui, sans-serif";
    ctx.fillText("My resume, scanned.", 560, 200);
    ctx.font = "400 34px system-ui, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(`Industry: ${industry.replace(/_/g, " ")}`, 560, 280);
    if (typeof percentile === "number") {
      ctx.fillText(`Better than ${percentile}% of peers`, 560, 335);
    }
    ctx.fillStyle = scoreColor;
    ctx.font = "600 30px system-ui, sans-serif";
    ctx.fillText("Get your free scan → resumebooster.work", 560, 470);

    return canvas;
  };

  const download = () => {
    const canvas = draw();
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `resume-score-${atsScore}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
    toast({ title: "Score card saved", description: "Share it anywhere — the scan link is on the image." });
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-3">
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Share2 className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-foreground text-sm">Share your score</h3>
        </div>
        <p className="text-xs text-muted-foreground">Download a clean score card image — no resume content on it, just the number.</p>
      </div>
      <button onClick={download} className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
        <Download className="w-3.5 h-3.5" />
        Download PNG
      </button>
    </div>
  );
}
