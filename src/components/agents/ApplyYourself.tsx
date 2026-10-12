// APPLY YOURSELF, WITH YOUR AI'S HELP — the /agents section for the one apply
// path there is (owner decision 2026-10-11, the apply pivot).
//
// The Agent plan, the Agent Pass and the Apply Assistant are retired and the
// server-side apply agent is switched off. What is left, and what this
// section says, is the honest flow: the person's own AI reads the posting
// and, for the hiring systems whose form can be read (MCP_FORM_VENDORS), the
// application form; Resume Booster's instructions tell it to ask the person
// every factual question and to draft only answers about their work, from the
// CV they gave it; the person submits on the employer's own site. We never
// submit anything.
//
// THREE RULES THE COPY KEEPS (connect spec §3.7):
//   - form reading is SCOPED to the systems that publish one — the vendor
//     names come off the mirror through formVendorPhrase(), never typed into
//     a locale string;
//   - model behaviour is said as OUR INSTRUCTION ("Resume Booster tells your
//     AI to…"), never as a guarantee about what a model will do;
//   - nothing here says or implies that we send an application.
//
// Every sentence is an i18n key in all nine locales. No section here carries
// an `id`: the switchboard's guard reads "a section with an id" as an open
// host panel, so the anchor sits on the heading.
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ClipboardCheck, Globe, ShieldCheck } from "lucide-react";
import { formVendorPhrase, MCP_STEPS_CHECKED } from "@/config/mcp-tools";

/** The checked date in the reader's language, from the mirror's ISO day. */
const checkedOn = (lang: string) =>
  new Date(`${MCP_STEPS_CHECKED}T12:00:00Z`).toLocaleDateString(lang || "en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function ApplyYourself() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "en";
  const steps = [
    t("agentConnect.applyStep1", "Give your AI your CV in the chat: paste it or attach it."),
    t("agentConnect.applyStep2", "Ask it to help you apply to a job: paste the job's link from the board, or pick one from a search."),
    t("agentConnect.applyStep3", "Resume Booster tells your AI to ask you every factual question — work authorisation, sponsorship, salary, start date, references, gaps — and to use your words; never to answer demographic questions or tick consent boxes for you; and to draft only answers about your work, from your CV, showing you each draft first."),
    t("agentConnect.applyStep4", "You submit on the employer's own site: by hand, or with Claude in Chrome or ChatGPT's agent filling it in with you. You attach your CV, create any employer account and press Submit."),
  ];
  return (
    <section aria-labelledby="apply-yourself" data-apply-yourself className="p-6 rounded-2xl bg-card border border-border">
      <h2 id="apply-yourself" className="text-2xl font-bold mb-3 flex items-center gap-2">
        <ClipboardCheck className="w-5 h-5 text-primary" aria-hidden /> {t("agentConnect.applyTitle", "Apply yourself, with your AI's help")}
      </h2>
      <p className="text-muted-foreground mb-4" data-self-apply-free>
        {t("agentConnect.selfApplyFree", "Applying yourself is free. Your AI reads the posting and, when the employer uses {{vendors}}, the application form too. Resume Booster tells it to ask you every factual question and to draft only open-ended answers from your CV; you check everything and press submit.", { vendors: formVendorPhrase(lang) })}
      </p>
      <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground mb-4">
        {steps.map((s, i) => <li key={i} className="pl-1">{s}</li>)}
      </ol>
      <p className="text-sm font-medium text-foreground mb-5 flex items-center gap-2" data-we-never-submit>
        <ShieldCheck className="w-4 h-4 text-success shrink-0" aria-hidden /> {t("agentConnect.applyNever", "Resume Booster never submits anything for you.")}
      </p>
      <h3 className="font-semibold mb-2 flex items-center gap-2">
        <Globe className="w-4 h-4 text-primary" aria-hidden /> {t("agentConnect.applyBrowsersTitle", "If your AI can use a browser")}
      </h3>
      <ul className="text-sm text-muted-foreground space-y-2 mb-2">
        <li>• {t("agentConnect.applyChrome", "Claude in Chrome (paid Claude plans, Chrome on a computer): choose manual approval for application forms. Claude may ask before entering your details. Attach your CV yourself if Claude can't. You create employer accounts and solve CAPTCHAs. Resume Booster tells Claude to stop before Submit.")}</li>
        <li>• {t("agentConnect.applyChatgpt", "ChatGPT's browser asks before submitting and can't upload files, so attach your CV yourself.")}</li>
        <li>• {t("agentConnect.applyFreePlans", "Free plans and phones: ask your AI for the answers as a list, and paste them into the employer's form yourself.")}</li>
      </ul>
      <p className="text-xs text-muted-foreground">{t("agentConnect.applyChecked", "Checked against Anthropic's and OpenAI's help pages on {{date}}.", { date: checkedOn(lang) })}</p>
      <p className="text-xs text-muted-foreground mt-3">
        <Link to="/agents/pass" className="text-primary hover:underline">{t("agentConnect.retiredLink", "Bought a pass or a plan from us before? Read what changed.")}</Link>
      </p>
    </section>
  );
}
