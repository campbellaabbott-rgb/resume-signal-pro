/**
 * THE APPLY SECTION AS A CRAWLER READS IT (APPLY-1107-12, 2026-11-07).
 *
 * The React section (ApplyYourself.tsx) told a visitor how to finish an
 * application with their own AI: the four steps, the form-reading allowance,
 * and how Claude in Chrome and ChatGPT's agent fill a form with you. The
 * baked /agents carried one sentence of it and /agent two, so an AI search
 * engine or a crawler never read the browser guidance at all. This module
 * fills the same nine-locale strings (the main locale bundle's agentConnect
 * keys, which the bake already loads) with the same mirror values the
 * component uses, and writes the HTML both baked pages print. A missing
 * string or placeholder is a build error, never a blank.
 */
import {
  formVendorPhrase, formsAllowanceIn, MCP_FORM_VENDORS_ON_CHATGPT, MCP_STEPS_CHECKED,
} from "@/config/mcp-tools";

export interface ApplyYourselfCopy {
  title: string;
  free: string;
  chatgpt: string;
  steps: string[];
  allowance: string;
  never: string;
  browsersTitle: string;
  browsers: string[];
  checked: string;
}

const fill = (strings: Record<string, unknown>, key: string, vals: Record<string, string | number> = {}): string => {
  const s = strings[key];
  if (typeof s !== "string" || !s) throw new Error(`apply-yourself copy: agentConnect.${key} is missing`);
  return s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    if (!(k in vals)) throw new Error(`apply-yourself copy: agentConnect.${key} has no value for {{${k}}}`);
    return String(vals[k]);
  });
};

/** The section's sentences in `lang`, from that language's agentConnect strings. */
export function applyYourselfCopy(strings: Record<string, unknown>, lang = "en"): ApplyYourselfCopy {
  const checked = new Date(`${MCP_STEPS_CHECKED}T12:00:00Z`).toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return {
    title: fill(strings, "applyTitle"),
    free: fill(strings, "selfApplyFree", { vendors: formVendorPhrase(lang) }),
    chatgpt: fill(strings, "selfApplyChatgpt", { vendors: formVendorPhrase(lang, MCP_FORM_VENDORS_ON_CHATGPT) }),
    steps: ["applyStep1", "applyStep2", "applyStep3", "applyStep4"].map((k) => fill(strings, k)),
    allowance: fill(strings, "applyAllowance", formsAllowanceIn(lang)),
    never: fill(strings, "applyNever"),
    browsersTitle: fill(strings, "applyBrowsersTitle"),
    browsers: ["applyChrome", "applyChatgpt", "applyFreePlans"].map((k) => fill(strings, k)),
    checked: fill(strings, "applyChecked", { date: checked }),
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The section's body as baked HTML, under a heading the caller writes (each
 * page has its own heading level and anchor). Nothing here links the retired
 * pass page: the bake carries nothing retired.
 */
export function applyYourselfBakeHtml(strings: Record<string, unknown>): string {
  const c = applyYourselfCopy(strings, "en");
  return [
    `<p class="text-sm text-muted-foreground mb-3">${esc(c.free)} ${esc(c.chatgpt)}</p>`,
    `<ol class="list-decimal pl-5 space-y-2 text-sm text-muted-foreground mb-3">${c.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`,
    `<p class="text-sm text-muted-foreground mb-3" data-forms-allowance>${esc(c.allowance)}</p>`,
    `<p class="text-sm font-medium text-foreground mb-3">${esc(c.never)}</p>`,
    `<h3 class="font-semibold mb-2">${esc(c.browsersTitle)}</h3>`,
    `<ul class="text-sm text-muted-foreground space-y-2 mb-2">${c.browsers.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`,
    `<p class="text-xs text-muted-foreground">${esc(c.checked)}</p>`,
  ].join("\n            ");
}
