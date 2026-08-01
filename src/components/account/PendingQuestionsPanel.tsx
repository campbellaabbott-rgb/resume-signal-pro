/**
 * The questions the agent stopped on, and the one place they get answered.
 *
 * This closes a loop that was measured before it was reachable. The matcher and
 * the learned-answer store shipped first and scored well — 16 of 29 harvested
 * forms completable, 25 of 29 once each question had been answered once. But
 * nothing wrote the questions out and there was nowhere to answer them, so the
 * 25 described a capability nobody could use. Production was still 16.
 *
 * WHAT APPEARS HERE IS NARROW ON PURPOSE. Only refusals that mean "we do not
 * hold this". The worker filters on the same allow-list the matcher uses, so an
 * ID number, a date of birth or a referee's phone number never reaches this
 * screen — those are refused for what they are, and putting them in front of
 * someone with an input box is exactly how a safeguard turns into a feature.
 *
 * The question is shown in the EMPLOYER'S words, with the options the form
 * actually offered. A paraphrase would mean the candidate answers one question
 * and the agent submits the answer to a different one.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * The generated types are produced from the LIVE schema, and these two tables
 * arrive in migrations that apply during a Lovable session — after this bundle
 * has already shipped. So the types lag the code by design, not by mistake, and
 * a typed client rejects table names Postgres will have by the time anyone
 * loads this. Same escape hatch the sibling panels use, for the same reason.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (t: string) => any };

type Pending = {
  id: number;
  question_key: string;
  question_label: string;
  answer_kind: "fill" | "choose" | "check";
  options: string[];
  refusal_reason: string;
  company: string | null;
  seen_count: number;
};

export function PendingQuestionsPanel({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Pending[]>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // select("*") rather than a column list, for the same reason the mandate
    // panel does: the bundle ships in seconds and migrations apply during a
    // Lovable session, so this component routinely knows about a column
    // Postgres does not yet have. A named list would 42703 the whole read.
    const { data, error } = await sb
      .from("agent_pending_questions")
      .select("*")
      .order("seen_count", { ascending: false })
      .limit(50);
    if (error) {
      // Absent table is the normal pre-migration state, not a fault worth
      // shouting about — the panel simply has nothing to show.
      if (error.code !== "42P01") console.warn("[pendingQuestions]", error.message);
      setRows([]);
    } else {
      setRows(((data ?? []) as unknown as Pending[]).map((r) => ({ ...r, options: r.options ?? [] })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const answer = async (row: Pending, value: string) => {
    if (row.answer_kind !== "check" && !value.trim()) return;
    setBusy(row.id);
    // Store the answer FIRST. If this write succeeds and the delete fails, the
    // candidate sees the question once more and answers it again — harmless.
    // The other order loses the answer and leaves nothing to show for it.
    const { error: upErr } = await sb.from("agent_learned_answers").upsert({
      user_id: userId,
      question_key: row.question_key,
      question_label: row.question_label,
      answer_kind: row.answer_kind,
      answer_value: row.answer_kind === "check" ? "checked" : value.trim(),
    }, { onConflict: "user_id,question_key" });
    if (upErr) {
      toast.error(t("pendingQ.saveFailed", "Could not save that answer — nothing was changed"));
      setBusy(null);
      return;
    }
    await sb.from("agent_pending_questions").delete().eq("id", row.id);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    setBusy(null);
    toast.success(t("pendingQ.saved", "Saved — the agent will use this answer from now on"));
  };

  if (loading) return null;
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-1">
          {t("pendingQ.title", "Questions the agent stopped on")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("pendingQ.empty",
            "Nothing waiting. When an employer asks something your profile can't answer, the agent stops rather than guessing — and asks you here.")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-5">
      <h3 className="text-sm font-semibold text-foreground mb-1">
        {t("pendingQ.title", "Questions the agent stopped on")}
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        {t("pendingQ.intro",
          "The agent won't answer these for you — they're about you, and a wrong answer goes to an employer under your name. Answer each once and it will use it on every form that asks again.")}
      </p>

      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
            <div className="text-sm font-medium text-foreground">{r.question_label}</div>
            <div className="text-xs text-muted-foreground mt-0.5 mb-2">
              {r.company
                ? t("pendingQ.askedBy", "Asked by {{company}}", { company: r.company })
                : t("pendingQ.askedGeneric", "Asked on an application form")}
              {r.seen_count > 1 && " · " + t("pendingQ.seenN", "blocked {{n}} applications", { n: r.seen_count })}
            </div>

            {r.answer_kind === "choose" && r.options.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {r.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => void answer(r, o)}
                    className="px-2.5 py-1 rounded-full border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary transition-colors disabled:opacity-50"
                  >
                    {o}
                  </button>
                ))}
              </div>
            ) : r.answer_kind === "check" ? (
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => void answer(r, "checked")}
                className="px-3 py-1.5 rounded-md border border-primary bg-primary/10 text-primary text-sm font-semibold disabled:opacity-50"
              >
                {t("pendingQ.confirm", "Yes, that's true of me")}
              </button>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={draft[r.id] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                  placeholder={t("pendingQ.placeholder", "Your answer, in your own words")}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy === r.id || !(draft[r.id] ?? "").trim()}
                  onClick={() => void answer(r, draft[r.id] ?? "")}
                  className="px-3 py-2 rounded-md border border-primary bg-primary/10 text-primary text-sm font-semibold disabled:opacity-40"
                >
                  {t("pendingQ.save", "Save")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
