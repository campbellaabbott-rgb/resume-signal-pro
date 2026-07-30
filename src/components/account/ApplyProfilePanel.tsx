// The answers the agent needs before it can finish an application by itself.
//
// buildPacket blocks on any required FACTUAL question it has no answer for —
// work authorisation, sponsorship, salary, start date, relocation — because
// guessing at those can void an application outright. Stated once here, they
// stop being walls for every future application.
//
// THE ONE CONTROL DECISION THAT MATTERS: the three legal-status questions are
// TRINARY, and this UI renders them as three-way choices rather than checkboxes.
// A checkbox has no way to say "I haven't answered" — unticked and "No" look
// identical — and an unticked box would have the agent tell employers a
// candidate is not authorised to work when they simply never said. The database
// column is nullable for the same reason. Unknown is a real value here, and the
// whole packet pipeline treats it as one.
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as unknown as { from: (t: string) => any };

type Tri = boolean | null;

interface ApplyProfile {
  full_name: string; phone: string; linkedin: string; website: string;
  city: string; country: string; resume_file_url: string;
  work_authorized: Tri; requires_sponsorship: Tri; willing_to_relocate: Tri;
  salary_expectation: string; earliest_start: string;
  share_demographics: boolean;
  apply_mode: "review" | "auto"; auto_apply_daily_cap: number;
}

const EMPTY: ApplyProfile = {
  full_name: "", phone: "", linkedin: "", website: "", city: "", country: "",
  resume_file_url: "", work_authorized: null, requires_sponsorship: null,
  willing_to_relocate: null, salary_expectation: "", earliest_start: "",
  share_demographics: false, apply_mode: "review", auto_apply_daily_cap: 5,
};

/** Three-way control. `null` is a first-class option, never an absent tick. */
function TriToggle({ value, onChange, label, hint }: {
  value: Tri; onChange: (v: Tri) => void; label: string; hint?: string;
}) {
  const { t } = useTranslation();
  const opts: Array<{ v: Tri; k: string; d: string }> = [
    { v: true, k: "applyProfile.yes", d: "Yes" },
    { v: false, k: "applyProfile.no", d: "No" },
    { v: null, k: "applyProfile.unset", d: "Not stated" },
  ];
  return (
    <div className="mb-4">
      <div className="text-sm font-medium text-foreground mb-1">{label}</div>
      {hint && <div className="text-xs text-muted-foreground mb-2">{hint}</div>}
      <div className="flex gap-2" role="radiogroup" aria-label={label}>
        {opts.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            onClick={() => onChange(o.v)}
            className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
              value === o.v
                ? "border-primary bg-primary/10 text-primary font-semibold"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(o.k, o.d)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ApplyProfilePanel({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [p, setP] = useState<ApplyProfile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exists, setExists] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await sb.from("agent_mandates")
        .select("full_name,phone,linkedin,website,city,country,resume_file_url," +
          "work_authorized,requires_sponsorship,willing_to_relocate,salary_expectation," +
          "earliest_start,share_demographics,apply_mode,auto_apply_daily_cap")
        .eq("user_id", userId).maybeSingle();
      if (cancelled) return;
      if (data) { setP({ ...EMPTY, ...(data as ApplyProfile) }); setExists(true); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const set = <K extends keyof ApplyProfile>(k: K, v: ApplyProfile[K]) =>
    setP((prev) => ({ ...prev, [k]: v }));

  // Which required-everywhere answers are still missing. Shown as a count with
  // the consequence attached, because "3 fields empty" means nothing and
  // "3 answers missing, so those applications wait for you" means something.
  const missing: string[] = [];
  if (!p.full_name.trim()) missing.push(t("applyProfile.fName", "your name"));
  if (!p.resume_file_url.trim()) missing.push(t("applyProfile.fResume", "a résumé file"));
  if (p.work_authorized === null) missing.push(t("applyProfile.fAuth", "work authorisation"));
  if (p.requires_sponsorship === null) missing.push(t("applyProfile.fSponsor", "sponsorship"));

  const save = useCallback(async () => {
    setSaving(true);
    const row = { user_id: userId, ...p };
    const { error } = exists
      ? await sb.from("agent_mandates").update(p).eq("user_id", userId)
      : await sb.from("agent_mandates").upsert(row, { onConflict: "user_id" });
    setSaving(false);
    if (error) { toast.error(t("applyProfile.saveFailed", "Could not save — try again")); return; }
    setExists(true);
    toast.success(t("applyProfile.saved", "Saved"));
  }, [p, userId, exists, t]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("applyProfile.loading", "Loading your apply profile…")}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">
          {t("applyProfile.title", "Apply profile")}
        </h3>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        {t("applyProfile.intro",
          "Answer these once and the agent stops having to ask. Anything you leave blank isn't guessed at — applications that need it wait for you instead.")}
      </p>

      {missing.length > 0 && (
        <div className="mb-5 rounded-lg border border-warning/40 bg-warning/5 p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div className="text-sm text-foreground">
            {t("applyProfile.missing",
              "Still needed: {{list}}. Until then, applications asking for those will wait for you rather than be sent.",
              { list: missing.join(", ") })}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        {([
          ["full_name", t("applyProfile.name", "Full name"), "Alex Rivera"],
          ["phone", t("applyProfile.phone", "Phone"), "+1 555 0100"],
          ["linkedin", t("applyProfile.linkedin", "LinkedIn"), "linkedin.com/in/…"],
          ["website", t("applyProfile.website", "Website or portfolio"), ""],
          ["city", t("applyProfile.city", "City"), "Austin"],
          ["country", t("applyProfile.country", "Country"), "US"],
        ] as Array<[keyof ApplyProfile, string, string]>).map(([k, label, ph]) => (
          <label key={String(k)} className="block">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <input
              type="text"
              value={String(p[k] ?? "")}
              placeholder={ph}
              onChange={(e) => set(k, e.target.value as ApplyProfile[typeof k])}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        ))}
      </div>

      <div className="border-t border-border pt-5">
        <h4 className="text-sm font-semibold text-foreground mb-1">
          {t("applyProfile.legalTitle", "The questions a résumé can't answer")}
        </h4>
        <p className="text-xs text-muted-foreground mb-4">
          {t("applyProfile.legalIntro",
            "The agent never guesses at these — a wrong answer here can void an application. \"Not stated\" is a real answer: it means the agent waits for you on any form that asks.")}
        </p>

        <TriToggle
          label={t("applyProfile.authorized", "Are you authorised to work where you're applying?")}
          value={p.work_authorized}
          onChange={(v) => set("work_authorized", v)}
        />
        <TriToggle
          label={t("applyProfile.sponsorship", "Will you need visa sponsorship?")}
          value={p.requires_sponsorship}
          onChange={(v) => set("requires_sponsorship", v)}
        />
        <TriToggle
          label={t("applyProfile.relocate", "Are you willing to relocate?")}
          value={p.willing_to_relocate}
          onChange={(v) => set("willing_to_relocate", v)}
        />

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-foreground">
              {t("applyProfile.salary", "Salary expectation")}
            </span>
            <input
              type="text" value={p.salary_expectation}
              placeholder={t("applyProfile.salaryPh", "e.g. $120,000")}
              onChange={(e) => set("salary_expectation", e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-foreground">
              {t("applyProfile.start", "Earliest start")}
            </span>
            <input
              type="text" value={p.earliest_start}
              placeholder={t("applyProfile.startPh", "e.g. 2 weeks")}
              onChange={(e) => set("earliest_start", e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>
      </div>

      <div className="border-t border-border pt-5 mt-5">
        <h4 className="text-sm font-semibold text-foreground mb-3">
          {t("applyProfile.modeTitle", "How the agent works")}
        </h4>
        <div className="flex flex-col gap-2 mb-4">
          {([
            ["review", t("applyProfile.modeReview", "Prepare and wait for me"),
              t("applyProfile.modeReviewHint", "Everything filled in and ready; you release each one.")],
            ["auto", t("applyProfile.modeAuto", "Apply for me automatically"),
              t("applyProfile.modeAutoHint", "Only where nothing needs you — no CAPTCHA, no account to create, and only when the agent could fill every required field honestly.")],
          ] as Array<[ApplyProfile["apply_mode"], string, string]>).map(([v, label, hint]) => (
            <button
              key={v} type="button" role="radio" aria-checked={p.apply_mode === v}
              onClick={() => set("apply_mode", v)}
              className={`text-left rounded-lg border p-3 transition-colors ${
                p.apply_mode === v ? "border-primary bg-primary/5" : "border-border hover:border-foreground/30"
              }`}
            >
              <div className="text-sm font-medium text-foreground">{label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
            </button>
          ))}
        </div>

        {p.apply_mode === "auto" && (
          <label className="block mb-4">
            <span className="text-sm font-medium text-foreground">
              {t("applyProfile.cap", "Most applications per day")}
            </span>
            <input
              type="number" min={1} max={20} value={p.auto_apply_daily_cap}
              onChange={(e) => set("auto_apply_daily_cap",
                Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="mt-1 w-24 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        )}

        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox" checked={p.share_demographics}
            onChange={(e) => set("share_demographics", e.target.checked)}
            className="mt-1"
          />
          <span>
            {t("applyProfile.demographics",
              "Answer voluntary diversity questions myself. Left off, the agent declines them on your behalf — it never fills them in for you.")}
          </span>
        </label>
      </div>

      <button
        type="button" onClick={save} disabled={saving}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {t("applyProfile.save", "Save apply profile")}
      </button>
    </div>
  );
}
