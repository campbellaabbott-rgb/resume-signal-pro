/**
 * SHORTLIST REDACTION READ PERSONAL DETAILS ONLY IN ENGLISH (S14X-022).
 *
 * WHAT WAS WRONG. The labelled-field rule knew English labels only, so a
 * German Lebenslauf's "Geburtsdatum: 15.03.1970", "Familienstand:
 * verheiratet" and "Konfession: katholisch", a French "Date de naissance",
 * a Spanish "Estado civil", a Dutch "Burgerlijke staat" and a Chinese
 * "性别：女" or "政治面貌：党员" reached the scorer whole, as did a label
 * set off by a tab or spaces instead of a colon, "Schwerbehindert (GdB 50)",
 * "54 Jahre alt", "Elternzeit" and the honorifics Frau, Mme, Sra. and Mevr.
 * The site serves all of these languages.
 *
 * WHAT HOLDS NOW: the values go and the labels stay, in German, French,
 * Spanish, Portuguese, Dutch, Chinese and Japanese, with a colon, a tab or a
 * run of spaces; the inline terms and honorifics go too; and a German line of
 * job evidence that starts like a heading ("Ausbildung zum Fachinformatiker")
 * or a Japanese IT outage line ("システム障害対応") stays.
 */
import { describe, expect, it } from "vitest";
import { redactForScoring } from "../../supabase/functions/shortlist-evaluate/redaction";

const run = (t: string) => redactForScoring(t);
const has = (r: ReturnType<typeof run>, f: string) => r.exclusionsApplied.some((e) => e.feature === f);

describe("a personal-details block in another language loses its values and keeps its labels", () => {
  it("German: birth date and place, nationality, family, faith, age and sex", () => {
    const r = run("Jane Okafor\nPERSÖNLICHE DATEN\nGeburtsdatum: 15.03.1970\nGeburtsort: Lagos\nStaatsangehörigkeit: nigerianisch\nFamilienstand: verheiratet, 2 Kinder\nKonfession: katholisch\nAlter: 54\nGeschlecht: weiblich");
    expect(r.redacted).not.toMatch(/1970|Lagos|nigerianisch|verheiratet|katholisch|Alter: 54|weiblich/);
    expect(r.redacted).toContain("Geburtsdatum: [REDACTED]");
    expect(r.redacted).toContain("Konfession: [REDACTED]");
    for (const f of ["date_of_birth", "national_origin", "family_status", "religion", "explicit_age", "gendered_terms"]) expect(has(r, f), f).toBe(true);
  });

  it("French, Spanish, Portuguese and Dutch labels", () => {
    const r = run([
      "Jane Okafor",
      "Date de naissance : 15/03/1970", "Nationalité : française", "Situation familiale : mariée, 2 enfants", "Âge : 54 ans",
      "Fecha de nacimiento: 15/03/1970", "Nacionalidad: mexicana", "Estado civil: casada", "Sexo: mujer", "Religión: católica",
      "Data de nascimento: 15/03/1970", "Nacionalidade: brasileira",
      "Geboortedatum: 15-03-1970", "Nationaliteit: Nederlandse", "Burgerlijke staat: gehuwd",
    ].join("\n"));
    expect(r.redacted).not.toMatch(/1970|française|mariée|54 ans|mexicana|casada|mujer|católica|brasileira|Nederlandse|gehuwd/);
    expect(r.redacted).toContain("Burgerlijke staat: [REDACTED]");
  });

  it("Chinese and Japanese labels, with full-width colons", () => {
    const zh = run("王小明\n性别：女\n民族：汉族\n出生日期：1970年3月15日\n婚姻状况：已婚\n政治面貌：党员\n籍贯：湖南\n年龄：54岁\n宗教：佛教");
    expect(zh.redacted).not.toMatch(/：女|汉族|1970|已婚|党员|湖南|54岁|佛教/);
    expect(has(zh, "political_affiliation")).toBe(true);
    const ja = run("山田花子\n生年月日：1970年3月15日（満54歳）\n性別：女\n配偶者：有\n扶養家族：2人\n国籍：日本");
    expect(ja.redacted).not.toMatch(/1970|満54歳|：女|配偶者：有|2人|：日本/);
  });

  it("a known label set off by a tab or a run of spaces is read like one with a colon", () => {
    const r = run("Jane Okafor\nGeburtsdatum\t15.03.1970\nFamilienstand    verheiratet\nNationality   Nigerian");
    expect(r.redacted).not.toMatch(/1970|verheiratet|Nigerian/);
    expect(r.redacted).toContain("Geburtsdatum\t[REDACTED]");
  });
});

describe("inline terms and honorifics in those languages go", () => {
  it("disability, age, leave and honorifics", () => {
    const r = run("Jane Okafor\nSchwerbehindert (GdB 50)\n54 Jahre alt\nElternzeit 2019 – 2020\nFrau Okafor leitete das Team.\nMme Okafor a dirigé l'équipe.\nSra. Okafor dirigió el equipo.\nMevr. Okafor leidde het team.\nNée le 15 mars 1970 à Lyon");
    expect(r.redacted).not.toMatch(/Schwerbehindert|GdB|54 Jahre|Elternzeit|Frau|Mme|Sra\.|Mevr\.|1970/);
    expect(r.redacted).toContain("Career break 2019 – 2020");
    expect(has(r, "disability_mention")).toBe(true);
  });
});

describe("job evidence in those languages stays", () => {
  const lines = [
    "Ausbildung zum Fachinformatiker, IHK Berlin",
    "Herr der Ringe fan club newsletter editor",
    "Schulungen zum Mutterschutzgesetz für Führungskräfte",
    "He trabajado como analista de datos durante cinco años",
    "システム障害対応と再発防止策の策定",
    "Proficient in MS Office and SQL",
  ];
  for (const line of lines) {
    it(`keeps "${line}"`, () => {
      expect(run(`Jane Okafor\n\nBERUFSERFAHRUNG\n${line}\nNext line stays too`).redacted).toContain(`${line}\nNext line stays too`);
    });
  }

  it("a localized Education heading opens the education section and Berufserfahrung closes it", () => {
    const r = run("Jane Okafor\nAusbildung\nB.Sc. Informatik, TU Berlin, 2012\nBerufserfahrung\nEntwicklerin, Acme, 2014-2020");
    expect(r.redacted).not.toMatch(/2012/);
    expect(r.redacted).toContain("Entwicklerin, Acme, 2014-2020");
  });
});
