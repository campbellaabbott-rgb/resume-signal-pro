/**
 * THE TRUST PAGE LISTS EVERY COPY OF A RÉSUMÉ WITH ITS CLOCK -- rendered, so
 * the numbers a reader sees are the interpolated ones and never a
 * {{placeholder}} or a key. The copy-level guards are in
 * a-resume-never-rides-a-stripe-session.test.ts; this is the page itself.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import Trust from "@/pages/Trust";
import { AI_CACHE_MAX_HOURS, PRIVACY_EMAIL, REPORT_CACHE_DAYS, SHARED_ANALYSIS_DAYS, TEMP_RESUME_HOURS } from "@/lib/resume-retention";

// The page's neighbours are not what this test is about, and several of them
// read the network; each renders as nothing.
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/SocialProof", () => ({ SocialProof: () => null }));
vi.mock("@/components/HowItWorks", () => ({ HowItWorks: () => null }));
vi.mock("@/components/FAQ", () => ({ FAQ: () => null }));
vi.mock("@/components/ResumeBeforeAfter", () => ({ ResumeBeforeAfter: () => null }));
vi.mock("@/hooks/use-scan-totals", () => ({ useScanTotals: () => null }));

function renderTrust() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/trust"]}>
        <Trust />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe("/trust retention table", { timeout: 30_000 }, () => {
  it("renders every store with the clock the code enforces, and no placeholder", () => {
    const { container } = renderTrust();
    const section = container.querySelector("#retention") as HTMLElement;
    expect(section, "the #retention section is missing").toBeTruthy();
    const table = within(section).getByRole("table");
    const text = table.textContent ?? "";

    expect(within(table).getAllByRole("row").length).toBe(1 + 14);
    expect(text).toContain(`${TEMP_RESUME_HOURS} hours, then deleted`);
    expect(text).toContain(`${REPORT_CACHE_DAYS} days, then deleted`);
    expect(text).toContain(`${SHARED_ANALYSIS_DAYS} days, or until you press “Delete My Data” on the results page`);
    expect(text).toContain(PRIVACY_EMAIL);
    expect(text).toContain("Stripe receives no resume text, and no reference to it");
    // The AI cache is a store of its own, with its own clock.
    expect(text).toContain(`Up to ${AI_CACHE_MAX_HOURS} hours, then deleted`);
    // Local storage outlives the tab, and says so.
    expect(text).toContain("This browser's local storage, on your device");
    expect(text).toContain("signing out on this device clears it");
    expect(text).toContain("the Clear Browser Data button on a paid results page");
    expect(container.textContent).not.toMatch(/\{\{|\}\}|trustPage\./);
  });

  it("the free-scan card states both clocks", () => {
    renderTrust();
    expect(screen.getByText(new RegExp(`for ${TEMP_RESUME_HOURS} hours, so a checkout can use it.*for ${REPORT_CACHE_DAYS} days`))).toBeInTheDocument();
  });

  it("makes no categorical never-stored claim anywhere on the page", () => {
    const { container } = renderTrust();
    expect(container.textContent).not.toMatch(/never stored|zero storage|immediately discarded|in memory/i);
  });
});

/**
 * The review of 9fe3bc0d: the Trust page still said, in all nine locales, that
 * a CV leaves us for "the employers it applies to for you" when the apply
 * agent is turned on, and kept it "while you use the agent, which sends it to
 * the employers it applies to for you". The agent is switched off (the
 * 2026-10-11 apply pivot); both sentences now say so, and say how long a CV
 * given to it earlier is kept.
 */
describe("/trust says the apply agent is switched off and sends nothing", () => {
  const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
  // The old send claim, as each locale spelled it.
  const OLD: Record<(typeof LOCALES)[number], RegExp> = {
    en: /applies to for you/, "en-GB": /applies to for you/, de: /bei denen er sich für dich bewirbt/,
    es: /se postula por ti/, fr: /il postule pour vous/, hi: /आपकी ओर से आवेदन करता है/,
    nl: /namens jou solliciteert/, pt: /se candidata por si/, tl: /inaaplayan nito para sa iyo/,
  };
  const OFF: Record<(typeof LOCALES)[number], RegExp> = {
    en: /switched off/, "en-GB": /switched off/, de: /abgeschaltet/, es: /desactivado/, fr: /désactivé/,
    hi: /बंद है/, nl: /staat uit/, pt: /desligado/, tl: /Naka-off/,
  };

  it.each(LOCALES)("%s: neither sentence says the agent applies for the person, and both say it is off", async (l) => {
    const { default: d } = await import(`../i18n/locales/${l}.json`);
    for (const v of [d.trustPage.security.neverSold.description, d.trustPage.retention.rows.agent.howLong] as string[]) {
      expect(v).not.toMatch(OLD[l]);
      expect(v).toMatch(OFF[l]);
    }
    expect(d.trustPage.retention.rows.agent.howLong).toContain("{{email}}");
  });

  it("the rendered page says the agent sends nothing to employers", () => {
    const { container } = renderTrust();
    expect(container.textContent).toMatch(/Our apply agent is switched off and sends nothing to employers/);
    expect(container.textContent).not.toMatch(/applies to for you/);
  });
});

/**
 * S14X-232: the agent row told a reader that deleting the account erases the
 * CV's text but that the FILE needs an email. delete-account removes the
 * file too (it lists the person's folder in the private résumé bucket and
 * removes every object), so the row says the account deletion erases both,
 * and the email is for erasure without deleting the account. The source
 * check below turns the sentence red if the delete ever stops removing it.
 */
describe("/trust says deleting the account erases the agent's CV file too", () => {
  const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
  // The old clause, as each locale spelled it: the file needed an email.
  const FILE_NEEDS_EMAIL: Record<(typeof LOCALES)[number], RegExp> = {
    en: /to have the file erased/, "en-GB": /to have the file erased/, de: /um die Datei löschen zu lassen/,
    es: /para que borremos el archivo/, fr: /pour faire effacer le fichier/, hi: /फ़ाइल मिटवाने के लिए/,
    nl: /om het bestand te laten wissen/, pt: /para apagar o ficheiro/, tl: /para ipabura ang file/,
  };
  // The account deletion names the file, in each locale's word for it.
  const DELETION_ERASES_FILE: Record<(typeof LOCALES)[number], RegExp> = {
    en: /erases both the text and the file/, "en-GB": /erases both the text and the file/, de: /entfernt den Text und die Datei/,
    es: /borra el texto y el archivo/, fr: /efface le texte et le fichier/, hi: /टेक्स्ट और फ़ाइल दोनों मिट जाते हैं/,
    nl: /wist zowel de tekst als het bestand/, pt: /apaga o texto e o arquivo/, tl: /bumubura sa text at sa file/,
  };

  it.each(LOCALES)("%s: the row says the deletion erases the file, and no longer asks for an email to erase it", async (l) => {
    const { default: d } = await import(`../i18n/locales/${l}.json`);
    const row = d.trustPage.retention.rows.agent.howLong as string;
    expect(row).not.toMatch(FILE_NEEDS_EMAIL[l]);
    expect(row).toMatch(DELETION_ERASES_FILE[l]);
    expect(row).toContain("{{email}}");
  });

  it("Portuguese is written in the Brazilian forms the program uses", async () => {
    const { default: d } = await import("../i18n/locales/pt.json");
    const row = d.trustPage.retention.rows.agent;
    expect(`${row.what} ${row.howLong}`).not.toMatch(/ficheiro|eliminar a conta/);
  });

  it("delete-account still removes every file in the person's folder of the résumé bucket", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/delete-account/index.ts"), "utf8");
    expect(src).toMatch(/const RESUME_BUCKET = "resumes";/);
    expect(src).toMatch(/storage\.from\(RESUME_BUCKET\)/);
    expect(src).toMatch(/bucket\.list\(user\.id\b/);
    expect(src).toMatch(/bucket\.remove\(/);
  });
});

/**
 * S14X-097, its copy half: the browser-storage row named the results page's
 * clear button and the browser's own setting, but not signing out, which
 * clears the same keys (and, since the sign-out asks first, may keep a
 * résumé that exists only on this device). Each language now names signing
 * out and quotes the clear button by the label that page gives it.
 */
describe("/trust says signing out clears what this browser keeps", () => {
  const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
  const SIGNING_OUT: Record<(typeof LOCALES)[number], RegExp> = {
    en: /signing out on this device/, "en-GB": /signing out on this device/, de: /Abmelden auf diesem Gerät/,
    es: /cerrar sesión en este dispositivo/, fr: /la déconnexion sur cet appareil/, hi: /इस डिवाइस पर साइन आउट/,
    nl: /uitloggen op dit apparaat/, pt: /sair da conta neste dispositivo/, tl: /pag-sign out sa device na ito/,
  };
  // The paid results page's button, by the label it carries in each language.
  const BUTTON: Record<(typeof LOCALES)[number], string> = {
    en: "Clear Browser Data", "en-GB": "Clear Browser Data", de: "Browserdaten löschen", es: "Borrar datos del navegador",
    fr: "Effacer les données du navigateur", hi: "ब्राउज़र डेटा साफ़ करें", nl: "Browsergegevens wissen",
    pt: "Limpar dados do navegador", tl: "I-clear ang Browser Data",
  };

  it.each(LOCALES)("%s: the row names signing out and quotes the button's own label", async (l) => {
    const { default: d } = await import(`../i18n/locales/${l}.json`);
    const row = d.trustPage.retention.rows.browserLocal.howLong as string;
    expect(row).toMatch(SIGNING_OUT[l]);
    expect(row).toContain(BUTTON[l]);
  });

  it.each(LOCALES)("%s: the quoted label is the one the paid results page shows, once that page's strings carry it", async (l) => {
    const { default: shard } = await import(`../i18n/shards/paid/${l}.json`);
    const label = (shard as { paidAnalysis?: { page?: { clearTitle?: string } } }).paidAnalysis?.page?.clearTitle;
    if (label !== undefined) expect(label).toBe(BUTTON[l]);
  });

  it("signing out still runs the clear that removes every local copy", () => {
    const src = readFileSync(resolve(__dirname, "../contexts/AuthContext.tsx"), "utf8");
    const clear = src.slice(src.indexOf("export function clearPersonalBrowserData("));
    expect(clear.slice(0, clear.indexOf("\n}\n")), "clearPersonalBrowserData no longer clears the local copies").toMatch(/clearLocalResumeCopies\(/);
    const start = src.indexOf("const signOut = async");
    expect(start, "AuthContext has no signOut").toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("const signOutEverywhere", start));
    expect(body, "signOut no longer calls clearPersonalBrowserData").toMatch(/clearPersonalBrowserData\(/);
  });
});
