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
import { applyReadiness, worstSeverity } from "@/lib/applyReadiness";
import { deriveContact, fillGaps } from "@/lib/resumeContact";
import { resumeTextFrom } from "@/lib/resumeText";

const sb = supabase as unknown as {
  from: (t: string) => any;
  storage: { from: (b: string) => any };
};

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".pdf,.doc,.docx,.txt";

type Tri = boolean | null;

/**
 * The countries offerable as extra work authorisation.
 *
 * WHY THIS EXISTS AT ALL. `work_authorized` is one boolean, and it can only
 * honestly answer a question about the country the candidate said they live in.
 * Before this list existed the agent used it for every country, so a UK-based
 * candidate answered "Yes" to "Are you legally authorized to work in the US?" —
 * a false statement about someone's immigration status, made under their name.
 *
 * Every code here must be one the worker's matcher recognises; a code it cannot
 * resolve would read as an authorisation and behave as silence. `src/test/
 * question-match.test.ts` asserts that, importing the worker's own list rather
 * than trusting this file to have stayed in step.
 */
export const WORK_COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "US", name: "United States" }, { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" }, { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" }, { code: "NZ", name: "New Zealand" },
  { code: "DE", name: "Germany" }, { code: "FR", name: "France" },
  { code: "ES", name: "Spain" }, { code: "PT", name: "Portugal" },
  { code: "IT", name: "Italy" }, { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" }, { code: "CH", name: "Switzerland" },
  { code: "AT", name: "Austria" }, { code: "PL", name: "Poland" },
  { code: "SE", name: "Sweden" }, { code: "DK", name: "Denmark" },
  { code: "NO", name: "Norway" }, { code: "FI", name: "Finland" },
  { code: "IN", name: "India" }, { code: "SG", name: "Singapore" },
  { code: "AE", name: "United Arab Emirates" }, { code: "ZA", name: "South Africa" },
  { code: "MX", name: "Mexico" }, { code: "BR", name: "Brazil" },
  { code: "JP", name: "Japan" },
];

interface ApplyProfile {
  /**
   * On every form, and the address employers reply to. Filled from the account
   * rather than asked for — it is already verified there, and re-typing it is
   * the kind of question that made setup feel like work.
   */
  email: string;
  full_name: string; phone: string; linkedin: string; website: string;
  city: string; country: string; address: string; postcode: string; resume_file_url: string;
  work_authorized: Tri; requires_sponsorship: Tri; willing_to_relocate: Tri;
  /** Countries BEYOND their own that they may work in, as ISO-2 codes. */
  work_authorized_countries: string[];
  cover_note: string;
  tailor_cover_note: boolean;
  salary_expectation: string; earliest_start: string;
  share_demographics: boolean; consent_to_processing: boolean;
  apply_mode: "review" | "auto"; auto_apply_daily_cap: number;
}

const EMPTY: ApplyProfile = {
  email: "",
  full_name: "", phone: "", linkedin: "", website: "", city: "", country: "",
  address: "", postcode: "",
  resume_file_url: "", work_authorized: null, requires_sponsorship: null,
  willing_to_relocate: null, work_authorized_countries: [],
  cover_note: "", tailor_cover_note: false, salary_expectation: "", earliest_start: "",
  share_demographics: false, consent_to_processing: false, apply_mode: "review", auto_apply_daily_cap: 5,
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

type SaveError = { message?: string; code?: string } | null;

/**
 * Save, tolerating a column the database does not have yet.
 *
 * Same root cause as the `select("*")` above: the bundle ships in seconds and
 * migrations apply during a Lovable session, so this panel routinely knows
 * about a column Postgres does not. An ordinary upsert then fails with 42703
 * and the person cannot save their apply profile AT ALL — one pending column
 * takes the whole form down, and nothing on screen says why.
 *
 * Postgres names the offending column, so this drops it and retries. That value
 * is lost until the migration lands, which is correct — there is nowhere to put
 * it — and everything else saves.
 *
 * `consent_to_processing` is what exposed this. It defaults to false and gates
 * the agent accepting notices on somebody's behalf, so losing it in the gap
 * fails safe. A column whose absence failed the OTHER way would not be safe to
 * treat this leniently.
 */
export async function saveTolerantly(
  run: (values: Record<string, unknown>) => PromiseLike<{ error: SaveError }>,
  values: Record<string, unknown>,
): Promise<{ error: SaveError }> {
  const attempt: Record<string, unknown> = { ...values };
  for (let i = 0; i < 4; i++) {
    const { error } = await run(attempt);
    if (!error) return { error: null };
    // 42703 = undefined_column. Anything else is a real failure to surface.
    const missing = error.code === "42703"
      ? /column "?(?:[a-z_]+\.)?([a-z_]+)"? does not exist/i.exec(error.message ?? "")?.[1]
      : undefined;
    if (!missing || !(missing in attempt)) return { error };
    console.warn(`[applyProfile] "${missing}" is not in the database yet — saving without it`);
    delete attempt[missing];
  }
  return { error: { message: "too many unknown columns", code: "42703" } };
}

export function ApplyProfilePanel({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [p, setP] = useState<ApplyProfile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exists, setExists] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await sb.from("agent_mandates")
        // `*`, not a column list, on purpose. The bundle and the migrations do
        // not ship together — Lovable deploys the frontend in seconds and
        // applies migrations only during a session — so this panel routinely
        // knows about a column Postgres does not yet have. A named column that
        // is missing fails the whole query with 42703, and the person sees an
        // empty apply profile with no explanation. With `*` the column is
        // simply absent from the row and falls back to its EMPTY default.
        .select("*")
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
  // Replaces a four-field "still needed" list that named no consequence.
  //
  // A live dry run on 2026-08-01 measured why this matters: the SAME agent
  // against the SAME Pinpoint form reported five blockers with an empty
  // standing profile and ONE with a complete one. The profile, not the agent,
  // is the main thing deciding whether an application goes out — and a list of
  // field names does not tell anyone that. Each gap now carries the question an
  // employer's form actually asks.
  const readiness = applyReadiness(p);
  const worst = worstSeverity(readiness);

  /**
   * One writer for the row, so the résumé upload and the Save button cannot
   * disagree. Callers pass the object they just computed rather than relying on
   * `p`, whose state update has not landed yet — reading it here would persist
   * the PREVIOUS profile and silently drop everything just derived from the CV.
   *
   * Declared ABOVE `upload` deliberately: it sits in that callback's dependency
   * array, which React evaluates during render, so a `const` declared later
   * would throw on the temporal dead zone before anybody clicked anything.
   */
  const persist = useCallback(async (values: ApplyProfile): Promise<boolean> => {
    setSaving(true);
    const { error } = await saveTolerantly((v) => (exists
      ? sb.from("agent_mandates").update(v).eq("user_id", userId)
      : sb.from("agent_mandates").upsert({ user_id: userId, ...v }, { onConflict: "user_id" })
    ) as unknown as PromiseLike<{ error: SaveError }>, { ...values } as Record<string, unknown>);
    setSaving(false);
    if (error) { toast.error(t("applyProfile.saveFailed", "Could not save — try again")); return false; }
    setExists(true);
    return true;
  }, [userId, exists, t]);

  // Uploads to the PRIVATE `resumes` bucket and stores the path, not a URL.
  // The worker fetches it with the service key at submit time — the file is
  // never world-readable, which matters because a résumé is a home address, a
  // phone number and an employment history in one document.
  const upload = useCallback(async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error(t("applyProfile.tooBig", "That file is over 10 MB — most résumés are under 1 MB"));
      return;
    }
    setUploading(true);
    // Keyed by user id so the storage policy can prove ownership from the path.
    // upsert so replacing a résumé is one step, which people do constantly.
    const clean = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const path = `${userId}/${clean}`;
    const { error } = await sb.storage.from("resumes").upload(path, file, {
      upsert: true, contentType: file.type || "application/octet-stream",
    });
    setUploading(false);
    if (error) {
      // "Try again" is the wrong advice for the two failures most likely here.
      // A missing bucket and a missing storage policy are both permanent until
      // someone changes the project, and telling a candidate to retry hides a
      // broken deploy behind what looks like a flaky upload. Say which it is.
      const msg = String((error as { message?: string })?.message ?? "");
      const setupBroken = /bucket not found|not found|403|row-level security|policy/i.test(msg);
      console.error("[resume upload]", msg);
      toast.error(
        setupBroken
          ? t("applyProfile.uploadBlocked", "Résumé storage isn't set up on this account yet — retrying won't help. We've logged it.")
          : t("applyProfile.uploadFailed", "Upload failed — try again"),
      );
      return;
    }
    // THE UPLOAD IS THE WHOLE OF SETUP, so it reads the document rather than
    // handing back a form. Everything a CV states plainly — name, email, phone,
    // LinkedIn — is lifted out and filled in, and the file is saved immediately.
    //
    // "Attached — remember to save" was the old message, and it was the friction
    // in miniature: it turned a finished action into a pending chore. Nothing
    // here asks for a second step.
    //
    // Nothing legal or personal is ever inferred (work authorisation,
    // sponsorship, salary, start date, consent). Those are asked at the moment a
    // form actually needs them — see resumeContact for why guessing them would
    // be a false declaration made under somebody else's name.
    const text = await resumeTextFrom(file);
    const derived = deriveContact(text);
    const { next, filled } = fillGaps({ ...p, resume_file_url: path }, derived);

    // The account's own email beats parsing every time — it is verified, and it
    // is the address employers will actually reach them on.
    if (!String(next.email ?? "").trim()) {
      const { data: auth } = await supabase.auth.getUser();
      const accountEmail = auth?.user?.email;
      if (accountEmail) { next.email = accountEmail; filled.push("email"); }
    }

    setP(next);
    const ok = await persist(next);
    if (!ok) return;
    toast.success(filled.length
      ? t("applyProfile.uploadedAndRead", "Saved. We filled in {{count}} details from your CV — check them below.", { count: filled.length })
      : t("applyProfile.uploadedSaved", "Saved. Your CV is attached and the agent can start."));
  }, [userId, t, p, persist]);

  const save = useCallback(async () => {
    if (await persist(p)) toast.success(t("applyProfile.saved", "Saved"));
  }, [p, persist, t]);

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

      {readiness.gaps.length === 0 ? (
        <div className="mb-5 rounded-lg border border-primary/40 bg-primary/5 p-3 flex gap-2">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-foreground">
            {/* Carefully worded. Nothing WE HAVE MEASURED would stop a send —
                that is not the same as "no form will ever ask something new",
                and the agent still refuses unknown questions rather than
                answering them. Promising more than that here would be the
                claim-drift failure in its purest form. */}
            {t("applyReadiness.clear",
              "Nothing in your profile is holding applications back. If an employer asks something new, the agent still stops rather than guessing — it'll appear in your queue.")}
          </div>
        </div>
      ) : (
        <div className="mb-5 rounded-lg border border-warning/40 bg-warning/5 p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div className="text-sm text-foreground min-w-0">
            <div className="font-medium mb-1">
              {worst === "blocks-everything"
                ? t("applyReadiness.headBlocked", "Nothing can be sent yet")
                : worst === "blocks-some"
                  ? t("applyReadiness.headSome", "{{n}} things stop some applications", { n: readiness.gaps.filter((g) => g.severity !== "reduces-quality").length })
                  : t("applyReadiness.headQuality", "Applications will send, but read thinner than they could")}
            </div>
            <ul className="space-y-1.5 mt-2">
              {readiness.gaps.map((g) => (
                <li key={g.field} className="text-xs text-muted-foreground flex gap-2">
                  <span
                    aria-hidden
                    className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                      g.severity === "blocks-everything" ? "bg-destructive"
                        : g.severity === "blocks-some" ? "bg-warning" : "bg-muted-foreground/50"}`}
                  />
                  {/* The employer's own question, so the cost of the gap is
                      concrete rather than a field name the candidate has to
                      translate into a consequence themselves. */}
                  <span>{t(`applyReadiness.${g.field}`, g.consequence)}</span>
                </li>
              ))}
            </ul>
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
          // Measured on 29 live forms: "Zipcode" was required on 3 and was the
          // only thing left blocking all 3, and one Breezy form required a
          // residential address outright. Neither is derived — the agent will
          // not parse a postcode out of an address line or build an address
          // from city and country.
          ["address", t("applyProfile.address", "Street address"), "12 Example Street"],
          ["postcode", t("applyProfile.postcode", "Postcode / ZIP"), "LS1 4AP"],
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

      <div className="border-t border-border pt-5 mb-5">
        <h4 className="text-sm font-semibold text-foreground mb-1">
          {t("applyProfile.resumeTitle", "Résumé file")}
        </h4>
        <p className="text-xs text-muted-foreground mb-3">
          {t("applyProfile.resumeIntro",
            "The actual file employers receive. Almost every application form requires one, so without it the agent prepares everything and then stops at the last step.")}
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm cursor-pointer hover:border-foreground/40">
            {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
            {p.resume_file_url
              ? t("applyProfile.replaceResume", "Replace file")
              : t("applyProfile.chooseResume", "Choose file")}
            <input
              type="file" accept={ACCEPT} className="hidden" disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
            />
          </label>
          {p.resume_file_url && (
            <span className="text-xs text-success truncate max-w-[18rem]">
              {p.resume_file_url.split("/").slice(1).join("/")}
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-border pt-5 mb-5">
        <label className="block">
          <span className="text-sm font-medium text-foreground">
            {t("applyProfile.coverNote", "A short note to go with your applications")}
          </span>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">
            {/* THE HINT CHANGES WITH THE TOGGLE, because otherwise it goes false.
                It used to say flatly that this exact text reaches every employer
                and is never rewritten — true for as long as that was the only
                behaviour, and a lie the moment tailoring can be switched on.
                Copy that describes a behaviour has to be read off the same state
                the behaviour is, not written once and left to rot next to it. */}
            {p.tailor_cover_note
              ? t("applyProfile.coverNoteHintTailored",
                  "Optional. Some forms won't submit without one, and the agent stops rather than sending a blank. Because tailoring is on, the agent adapts this for each role using only what your résumé and the posting actually say — and if it can't do that honestly, your note is sent exactly as written.")
              : t("applyProfile.coverNoteHint",
                  "Optional. Some forms won't submit without one, and the agent stops rather than sending a blank. This exact text goes to every employer — it isn't rewritten per job — so keep it about you and your work, not about any one company.")}
          </p>
          <textarea
            value={p.cover_note}
            onChange={(e) => set("cover_note", e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder={t("applyProfile.coverNotePlaceholder",
              "e.g. I'm a data engineer with eight years building pipelines in Python and dbt, currently looking for a senior role where I can own a platform end to end.")}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-y"
          />
          <span className="text-xs text-muted-foreground">
            {t("applyProfile.coverNoteCount", "{{n}} of 2000 characters", { n: p.cover_note.length })}
          </span>
        </label>

        {/* OPT-IN, and off by default. Rewriting someone's words and sending
            the result to a stranger under their name is not a default anyone
            should be enrolled in silently — it is theirs to choose. */}
        <label className="flex items-start gap-2 text-sm text-muted-foreground mt-3">
          <input
            type="checkbox" checked={p.tailor_cover_note}
            onChange={(e) => set("tailor_cover_note", e.target.checked)}
            className="mt-1"
          />
          <span>
            {t("applyProfile.tailorCoverNote",
              "Adapt this note for each role. The agent rewrites it against the job posting using only facts already in your résumé — it can't add an employer, a school, a skill or a number that isn't there, and it never volunteers your visa status, salary or start date. Anything it can't ground, it drops: your note goes as written instead.")}
          </span>
        </label>
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
          label={p.country.trim()
            ? t("applyProfile.authorizedIn", "Are you authorised to work in {{country}}?",
                { country: p.country.trim() })
            : t("applyProfile.authorizedHome", "Are you authorised to work in the country you live in?")}
          hint={t("applyProfile.authorizedHint",
            "This answer covers your own country only. Anywhere else, tick it below — the agent will not assume it.")}
          value={p.work_authorized}
          onChange={(v) => set("work_authorized", v)}
        />

        <div className="mb-4">
          <div className="text-sm font-medium text-foreground mb-1">
            {t("applyProfile.otherCountries", "Anywhere else you may work without sponsorship")}
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {t("applyProfile.otherCountriesHint",
              "Optional, and safe to leave empty. Employers ask about a named country — \"authorised to work in the US?\" — and being authorised somewhere is not being authorised everywhere. Tick only what's true: on any country you haven't ticked, the agent stops and asks you rather than answering.")}
          </p>
          <div className="flex flex-wrap gap-1.5" role="group"
               aria-label={t("applyProfile.otherCountries", "Anywhere else you may work without sponsorship")}>
            {WORK_COUNTRIES.map((c) => {
              const on = p.work_authorized_countries.includes(c.code);
              return (
                <button
                  key={c.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set("work_authorized_countries", on
                    ? p.work_authorized_countries.filter((x) => x !== c.code)
                    : [...p.work_authorized_countries, c.code])}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                    on
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
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
            type="checkbox" checked={p.consent_to_processing}
            onChange={(e) => set("consent_to_processing", e.target.checked)}
            className="mt-1"
          />
          <span>
            {t("applyProfile.consent",
              "Let the agent accept employers' privacy notices and \u201Cthe information I have given is true\u201D declarations for me. Left off, any form asking one is sent to your queue so you can tick it yourself.")}
          </span>
        </label>

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
