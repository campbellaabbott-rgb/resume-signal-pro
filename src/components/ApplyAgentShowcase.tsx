import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bot, PenLine, MessagesSquare, ShieldCheck, CalendarClock, ArrowRight } from "lucide-react";

// Homepage showcase for the AI apply agent. Every claim here describes what
// the product does TODAY (kits, real application questions, the honesty
// check, prep + tracker rhythm) — and the "you review and hit send" line is
// the positioning, not a disclaimer: auto-blasted applications are exactly
// what employers now filter out, and we say so.
export function ApplyAgentShowcase() {
  const { t } = useTranslation();

  const features = [
    {
      icon: PenLine,
      title: t("applyAgent.f1Title", "Writes your tailored application"),
      body: t(
        "applyAgent.f1Body",
        "A cover letter and application answers written for that specific posting, drawn from your actual resume — in seconds, in your language.",
      ),
    },
    {
      icon: MessagesSquare,
      title: t("applyAgent.f2Title", "Answers the employer's real questions"),
      body: t(
        "applyAgent.f2Body",
        "For supported job boards the agent pulls the application form's actual questions and drafts an answer to each one — not generic filler.",
      ),
    },
    {
      icon: ShieldCheck,
      title: t("applyAgent.f3Title", "Sworn to honesty"),
      body: t(
        "applyAgent.f3Body",
        "The agent never invents experience you don't have. Every claim it writes is checked against your resume before you ever see the draft.",
      ),
    },
    {
      icon: CalendarClock,
      title: t("applyAgent.f4Title", "Preps you, tracks it, nudges you"),
      body: t(
        "applyAgent.f4Body",
        "Interview prep for each application, a pipeline that tells you what to do next, and a quiet-application reminder when it's time to follow up.",
      ),
    },
  ];

  return (
    <section className="py-12 sm:py-16" aria-labelledby="apply-agent-heading">
      <div className="container">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 mb-4">
              <Bot className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-primary">{t("applyAgent.badge", "Your AI apply agent")}</span>
            </div>
            <h2 id="apply-agent-heading" className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3">
              {t("applyAgent.headline", "An AI agent does the heavy lifting on every application")}
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
              {t(
                "applyAgent.subhead",
                "It writes, tailors, preps, and tracks — you review and hit send. Employers filter out auto-blasted applications; yours won't be one of them.",
              )}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            {features.map((f) => (
              <div key={f.title} className="rounded-2xl border border-border bg-card/60 p-5 hover:border-primary/40 transition-colors">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10 shrink-0">
                    <f.icon className="w-[18px] h-[18px] text-primary" />
                  </span>
                  <h3 className="font-semibold text-foreground">{f.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>

          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              {t(
                "applyAgent.control",
                "You stay in control: the agent drafts, you approve, and you press send on the company's own site.",
              )}
            </p>
            <Link
              to="/jobs"
              className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-primary/10 border border-primary/40 text-primary font-semibold px-6 py-3.5 hover:bg-primary/15 transition-colors"
            >
              {t("applyAgent.cta", "Pick a job and watch it work")}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
