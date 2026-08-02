// The queue surface: what the agent has prepared, what it is waiting on, and
// what it has actually sent.
//
// The whole product promise of an apply agent rests on a person being willing to
// let it act in their name. That willingness comes from being able to see
// exactly what will be sent BEFORE it goes — so every packet here can be opened
// and read field by field, with each value labelled by where it came from: a
// profile fact, a standing answer, or a sentence the model drafted. A reviewer
// should never have to guess which is which.
//
// The states are deliberately plain. "Needs you: work authorisation" is useful;
// "blocked" is not. Every blocker the packet carries is printed in full, because
// a queue that says something is stuck without saying why is a queue people stop
// reading.
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Clock, AlertTriangle, Send, ExternalLink, Loader2, Inbox, PauseCircle, Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { refusalFace } from "@/lib/refusalCopy";

const sb = supabase as unknown as { from: (t: string) => any };

type Status = "preparing" | "ready" | "blocked" | "submitted" | "failed" | "stale";

interface Packet {
  id: number; posting_id: string; title: string; company: string; apply_url: string;
  source: string; status: Status;
  fields: Record<string, { value: string; source: string }>;
  questions: Array<{ label: string; required?: boolean }>;
  questions_are_real: boolean;
  blockers: Array<{ kind: string; detail: string }>;
  fit_pct: number | null;
  prepared_at: string | null; submitted_at: string | null; submitted_via: string | null;
  /**
   * WHY it was not sent, as a decideRelease code. Ten possible values, every one
   * of them written by apply-agent onto this row — and not read here until
   * 2026-08-02, so "our sender is offline", "below your own fit floor" and
   * "you already applied" all rendered as the same grey blocked row.
   */
  release_refusal: string | null;
}

const TONE: Record<Status, string> = {
  ready: "border-success/40 bg-success/5",
  blocked: "border-warning/40 bg-warning/5",
  submitted: "border-border bg-muted/30",
  stale: "border-border bg-muted/30",
  preparing: "border-border",
  failed: "border-destructive/40 bg-destructive/5",
};

export function ApplyQueuePanel({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Packet[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await sb.from("agent_submissions")
      .select("id,posting_id,title,company,apply_url,source,status,fields,questions," +
        "questions_are_real,blockers,fit_pct,prepared_at,submitted_at,submitted_via," +
        "release_refusal")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    setRows((data ?? []) as Packet[]);
    setLoading(false);
  }, [userId]);
  useEffect(() => { void load(); }, [load]);

  // Marking a send is the candidate reporting a FACT, not the app deciding one.
  // The database trigger refuses `submitted` without both a timestamp and a
  // source, so this cannot record an application that did not happen.
  const markSent = useCallback(async (p: Packet) => {
    setBusy(p.id);
    const { error } = await sb.from("agent_submissions").update({
      status: "submitted", submitted_at: new Date().toISOString(), submitted_via: "manual",
    }).eq("id", p.id);
    setBusy(null);
    if (error) { toast.error(t("applyQueue.markFailed", "Could not record that — try again")); return; }
    toast.success(t("applyQueue.marked", "Recorded as sent"));
    void load();
  }, [load, t]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("applyQueue.loading", "Loading what the agent has prepared…")}
      </div>
    );
  }

  const counts = {
    ready: rows.filter((r) => r.status === "ready").length,
    blocked: rows.filter((r) => r.status === "blocked").length,
    sent: rows.filter((r) => r.status === "submitted").length,
  };

  return (
    <div className="rounded-xl border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Inbox className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">
          {t("applyQueue.title", "Prepared applications")}
        </h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {t("applyQueue.intro",
          "Everything the agent has filled in for you. Open any one to read exactly what would be sent before it goes.")}
      </p>

      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          {t("applyQueue.empty",
            "Nothing prepared yet. The agent works overnight — approve picks in your queue and they'll appear here ready to go.")}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 mb-4 text-xs">
            <span className="text-success font-semibold">
              {t("applyQueue.cReady", "{{n}} ready", { n: counts.ready })}
            </span>
            <span className="text-warning font-semibold">
              {t("applyQueue.cBlocked", "{{n}} need you", { n: counts.blocked })}
            </span>
            <span className="text-muted-foreground">
              {t("applyQueue.cSent", "{{n}} sent", { n: counts.sent })}
            </span>
          </div>

          <ul className="space-y-3">
            {rows.map((p) => {
              const isOpen = open === p.id;
              return (
                <li key={p.id} className={`rounded-lg border p-3 ${TONE[p.status] ?? "border-border"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{p.title}</div>
                      <div className="text-sm text-muted-foreground truncate">{p.company}</div>

                      <div className="mt-1.5 text-xs flex items-center gap-1.5">
                        {p.status === "ready" && (
                          <><CheckCircle2 className="w-3.5 h-3.5 text-success" />
                            <span className="text-success font-medium">
                              {t("applyQueue.sReady", "Ready — nothing needs you")}
                            </span></>
                        )}
                        {p.status === "blocked" && (
                          <><AlertTriangle className="w-3.5 h-3.5 text-warning" />
                            <span className="text-warning font-medium">
                              {t("applyQueue.sBlocked", "Needs you")}
                            </span></>
                        )}
                        {p.status === "submitted" && (
                          <><Send className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">
                              {t("applyQueue.sSent", "Sent {{when}}", {
                                when: p.submitted_at ? new Date(p.submitted_at).toLocaleDateString() : "",
                              })}
                            </span></>
                        )}
                        {p.status === "stale" && (
                          <span className="text-muted-foreground">
                            {t("applyQueue.sStale", "You already applied to this one")}
                          </span>
                        )}
                        {p.status === "preparing" && (
                          <><Clock className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">{t("applyQueue.sPreparing", "Preparing…")}</span></>
                        )}
                        {p.status === "failed" && (
                          <span className="text-destructive">
                            {t("applyQueue.sFailed", "Couldn't prepare this one")}
                          </span>
                        )}
                      </div>

                      {/* WHY IT HAS NOT GONE OUT — the decideRelease reason.
                          Distinct from `status`: a packet can be perfectly READY
                          and still be held because our sender is down, or because
                          the fit is under the floor this person set themselves.
                          Status alone rendered all of those identically, and
                          "Ready — nothing needs you" on a packet that has sat
                          unsent for a day is the kind of true-but-useless line
                          that makes people stop trusting the screen.

                          Blame is separated deliberately. `on-us` must not be
                          coloured like a warning the candidate can act on, and
                          `by-design` must not be coloured at all — the dedupe
                          guard refusing to apply twice is the product working. */}
                      {(() => {
                        const face = refusalFace(p.release_refusal);
                        if (!face) return null;
                        const Icon = face.severity === "needs-you" ? AlertTriangle
                          : face.severity === "on-us" ? PauseCircle : Info;
                        const tone = face.severity === "needs-you" ? "text-warning" : "text-muted-foreground";
                        return (
                          <div className={`mt-1.5 flex items-start gap-1.5 text-xs ${tone}`}>
                            <Icon className="w-3.5 h-3.5 shrink-0 mt-[1px]" aria-hidden />
                            <span>{t(face.key, face.fallback)}</span>
                          </div>
                        );
                      })()}

                      {/* Every blocker in full. A queue that says something is
                          stuck without saying why is a queue people stop reading. */}
                      {p.blockers?.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {p.blockers.map((b, i) => (
                            <li key={i} className="text-xs text-foreground/80">• {b.detail}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {typeof p.fit_pct === "number" && (
                        <span className="text-xs text-muted-foreground">{Math.round(p.fit_pct)}%</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : p.id)}
                        className="text-xs underline text-muted-foreground hover:text-foreground"
                      >
                        {isOpen ? t("applyQueue.hide", "Hide") : t("applyQueue.review", "Review")}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-3 border-t border-border pt-3">
                      {/* Provenance is the point. A reviewer must be able to tell
                          a fact from a generated sentence at a glance. */}
                      <div className="text-xs font-semibold text-foreground mb-2">
                        {t("applyQueue.willSend", "What would be sent")}
                      </div>
                      <dl className="space-y-1.5 mb-3">
                        {Object.entries(p.fields ?? {}).map(([k, v]) => (
                          <div key={k} className="text-xs">
                            <dt className="text-muted-foreground">{k}</dt>
                            <dd className="text-foreground break-words">
                              {v.value}
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                                {t(`applyQueue.src.${v.source}`, v.source)}
                              </span>
                            </dd>
                          </div>
                        ))}
                      </dl>

                      {!p.questions_are_real && (
                        <div className="text-xs text-muted-foreground mb-3">
                          {t("applyQueue.inferred",
                            "This employer doesn't publish its application form, so these are the fields we expect — the real form may ask more.")}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <a
                          href={p.apply_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {t("applyQueue.openForm", "Open the application")}
                        </a>
                        {p.status !== "submitted" && (
                          <button
                            type="button" onClick={() => markSent(p)} disabled={busy === p.id}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-60"
                          >
                            {busy === p.id && <Loader2 className="w-3 h-3 animate-spin" />}
                            {t("applyQueue.markSent", "I sent this")}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
