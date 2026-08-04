/**
 * WHERE THE AGENT MAY NOT APPLY — the controls, not just the enforcement.
 *
 * migration 20260804030000 added blocked_companies, paused_until and
 * employer_cooldown_days, and apply-agent honours all three. Until this panel
 * there was NO WAY TO SET THEM. A guard nobody can reach is not a feature, and
 * shipping enforcement without controls is the half of the work that looks done
 * from the database and does nothing for a person.
 *
 * The blocklist is the one with career consequences. For anyone currently
 * employed, an application to their own employer is not an inconvenience — it
 * is how they find out they are job hunting. So it is first, it is explained in
 * those terms, and it does not hide behind an accordion.
 *
 * PAUSE IS A DATE, NOT A SWITCH. `active=false` already exists and is an
 * indefinite off that somebody has to remember to reverse. What people actually
 * want is "back on Monday", and a pause you must remember to end is one that
 * quietly becomes permanent.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, ShieldBan, PauseCircle, Timer } from "lucide-react";

interface Controls {
  blocked_companies: string[];
  paused_until: string | null;
  pause_reason: string;
  employer_cooldown_days: number;
}

const DEFAULTS: Controls = {
  blocked_companies: [], paused_until: null, pause_reason: "", employer_cooldown_days: 14,
};

/** Local midnight N days out, as an ISO instant. */
const daysOut = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};

export function AgentControlsPanel({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [c, setC] = useState<Controls>(DEFAULTS);
  const [company, setCompany] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await supabase
        .from("agent_mandates")
        .select("blocked_companies,paused_until,pause_reason,employer_cooldown_days")
        .eq("user_id", userId).maybeSingle();
      if (!live) return;
      if (data) {
        setC({
          // Columns are permissive-when-missing everywhere else in this chain;
          // the UI must not be the one place that reads absent as restrictive.
          blocked_companies: Array.isArray(data.blocked_companies) ? data.blocked_companies : [],
          paused_until: data.paused_until ?? null,
          pause_reason: data.pause_reason ?? "",
          employer_cooldown_days: data.employer_cooldown_days ?? 14,
        });
      }
      setLoaded(true);
    })();
    return () => { live = false; };
  }, [userId]);

  const save = useCallback(async (patch: Partial<Controls>) => {
    setBusy(true);
    const next = { ...c, ...patch };
    setC(next); // optimistic — reverted below if the write fails
    const { error } = await supabase.from("agent_mandates").update(patch).eq("user_id", userId);
    setBusy(false);
    if (error) {
      setC(c);
      toast.error(t("agentControls.saveError", "Couldn't save that — please try again."));
      return false;
    }
    return true;
  }, [c, userId, t]);

  const addCompany = async () => {
    const v = company.trim();
    if (!v) return;
    // Case-insensitive dedupe, because apply-agent matches that way. Storing
    // "Acme" and "acme" would look like two rules and behave as one.
    if (c.blocked_companies.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setCompany("");
      return;
    }
    if (await save({ blocked_companies: [...c.blocked_companies, v] })) setCompany("");
  };

  const paused = !!c.paused_until && new Date(c.paused_until).getTime() > Date.now();

  if (!loaded) return <div className="h-48 animate-pulse rounded-xl bg-muted" />;

  return (
    <section className="space-y-6 rounded-xl border border-border p-5">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldBan className="h-4 w-4" aria-hidden="true" />
          {t("agentControls.blocklist.title", "Never apply to these employers")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("agentControls.blocklist.help",
            "Add your current employer first. The agent will skip every posting from these companies, and it matches the name however it is capitalised.")}
        </p>

        <div className="mt-3 flex gap-2">
          <Input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addCompany(); } }}
            placeholder={t("agentControls.blocklist.placeholder", "Company name")}
            aria-label={t("agentControls.blocklist.placeholder", "Company name")}
            disabled={busy}
          />
          <Button type="button" onClick={() => void addCompany()} disabled={busy || !company.trim()}>
            {t("agentControls.add", "Add")}
          </Button>
        </div>

        {c.blocked_companies.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {c.blocked_companies.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => void save({ blocked_companies: c.blocked_companies.filter((x) => x !== name) })}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 py-1 pl-3 pr-2 text-sm hover:bg-muted"
                  aria-label={t("agentControls.blocklist.remove", { defaultValue: "Remove {{name}}", name })}
                >
                  {name}
                  <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <PauseCircle className="h-4 w-4" aria-hidden="true" />
          {t("agentControls.pause.title", "Pause, with a date it comes back")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {paused
            ? t("agentControls.pause.active", {
                defaultValue: "Paused until {{when}}. It resumes on its own — nothing to remember.",
                when: new Date(c.paused_until!).toLocaleDateString(undefined, { dateStyle: "medium" }),
              })
            : t("agentControls.pause.help",
                "Going on holiday, or interviewing somewhere already? Pause it and it switches itself back on.")}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {paused ? (
            <Button type="button" variant="secondary" disabled={busy}
              onClick={() => void save({ paused_until: null, pause_reason: "" })}>
              {t("agentControls.pause.resumeNow", "Resume now")}
            </Button>
          ) : (
            [
              [7, t("agentControls.pause.1w", "1 week")],
              [14, t("agentControls.pause.2w", "2 weeks")],
              [30, t("agentControls.pause.1m", "1 month")],
            ].map(([n, label]) => (
              <Button key={String(n)} type="button" variant="outline" disabled={busy}
                onClick={() => void save({ paused_until: daysOut(n as number) })}>
                {label as string}
              </Button>
            ))
          )}
        </div>
      </div>

      <div className="border-t border-border pt-5">
        <Label htmlFor="cooldown" className="flex items-center gap-2 text-sm font-semibold">
          <Timer className="h-4 w-4" aria-hidden="true" />
          {t("agentControls.cooldown.title", "Days between applications to the same employer")}
        </Label>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("agentControls.cooldown.help",
            "Stops several applications landing on one recruiter's desk in a week. 0 turns it off.")}
        </p>
        <Input
          id="cooldown"
          type="number"
          min={0}
          max={365}
          className="mt-3 w-28"
          value={c.employer_cooldown_days}
          disabled={busy}
          onChange={(e) => setC({ ...c, employer_cooldown_days: Number(e.target.value) })}
          // Saved on blur, not per keystroke: a write per digit would make "30"
          // pass through 3 on its way, and 3 is a real setting.
          onBlur={(e) => {
            const n = Math.max(0, Math.min(365, Number(e.target.value) || 0));
            void save({ employer_cooldown_days: n });
          }}
        />
      </div>
    </section>
  );
}
