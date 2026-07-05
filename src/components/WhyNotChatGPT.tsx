import { Ruler, FileSearch, BarChart3, History, FileDown, MessageSquareOff } from "lucide-react";

// Answers the question skeptical visitors actually ask: "why not just paste
// my resume into ChatGPT?" Every claim here must be structurally true — things
// a chat window cannot do by design, not things it merely does worse. Keep it
// honest or it converts nobody.
const DIFFERENCES = [
  {
    icon: Ruler,
    title: "Measurements, not opinions",
    chat: "Regenerate the answer and the critique changes — it's improvising.",
    us: "Format checks, ATS parse simulation, timeline math, and vendor checks are computed. Same resume, same result, every time.",
  },
  {
    icon: FileSearch,
    title: "Every quote is verified",
    chat: "Will confidently discuss a bullet you never wrote.",
    us: "Before your report renders, every quoted line is checked against your actual resume. What it can't back up gets removed.",
  },
  {
    icon: BarChart3,
    title: "A score that shows its work",
    chat: "Ask for a score and it invents one on the spot — different each time.",
    us: "Your score is anchored to a rule-based calculation with an audit trail — every point accounted for, reproducible on rescan.",
  },
  {
    icon: History,
    title: "It remembers your search",
    chat: "Every conversation starts from zero.",
    us: "Score history, rescan comparisons, fix checklists, and application tracking — a job search is a campaign, not one question.",
  },
  {
    icon: FileDown,
    title: "Finished documents",
    chat: "Gives you text to re-typeset yourself.",
    us: "The Resume Builder exports professionally typeset PDF and DOCX files, ready to submit.",
  },
  {
    icon: MessageSquareOff,
    title: "No prompting skill required",
    chat: "The quality of the answer depends on knowing what to ask.",
    us: "The scan runs 24+ checks in the right order, calibrated to your industry — including the questions you didn't know to ask.",
  },
] as const;

export function WhyNotChatGPT() {
  return (
    <section id="why-not-chatgpt" className="py-16 border-t border-border scroll-mt-24" aria-labelledby="why-not-chat-heading">
      <div className="container max-w-5xl">
        <div className="text-center mb-10">
          <h2 id="why-not-chat-heading" className="text-2xl md:text-3xl font-bold mb-3">
            "Can't I just paste my resume into ChatGPT?"
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
            You can — and it will give you fluent, plausible advice. Here's what a chat window structurally cannot do,
            no matter how good the model gets. (We use frontier AI too — wrapped in verification it doesn't have on its own.)
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {DIFFERENCES.map((d) => (
            <div key={d.title} className="rounded-2xl border border-border bg-card/60 p-5 flex flex-col">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <d.icon className="w-4 h-4 text-primary" />
                </div>
                <p className="text-sm font-semibold text-foreground">{d.title}</p>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                <span className="font-medium text-muted-foreground/80">Chatbot:</span> {d.chat}
              </p>
              <p className="text-xs text-foreground">
                <span className="font-medium text-primary">Here:</span> {d.us}
              </p>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8 max-w-xl mx-auto">
          The honest version: for a quick opinion on one bullet, a chatbot is great. For a diagnosis you can verify,
          track, and act on across a whole job search — that's what this is built for.
        </p>
      </div>
    </section>
  );
}
