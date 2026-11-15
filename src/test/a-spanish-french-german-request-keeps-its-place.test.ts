// @vitest-environment node
/**
 * A SPANISH, FRENCH OR GERMAN REQUEST KEEPS ITS PLACE (connect W3, BR-07).
 *
 * Live 2026-11-07: "trabajo de enfermera en Madrid" and "emploi développeur web
 * à Paris" reached the board whole: "en Madrid" and "à Paris" were searched as
 * title words beside "trabajo" and "emploi", and found almost nothing. The
 * reader now knows the prepositions of the board's locales (en, à, au, aux,
 * em, bei, nahe, cerca de, près de) and their search filler (trabajo, empleos,
 * emploi, Stellen, vagas, vacatures...), but only before a place it knows by
 * name: "Ingeniero en Sistemas" and "Software Engineer bei SAP" are a title
 * and an employer, and stay whole.
 *
 * The city names come from agent-mcp/known-cities.ts, a mirror of the board's
 * own city table in job-board/normalize.ts (agent-mcp cannot import the
 * board's normalizer); the last test reads both and fails when they differ.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWN_CITIES } from "../../supabase/functions/agent-mcp/known-cities";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";

describe("a request in the board's other languages names its place", () => {
  it.each([
    ["trabajo de enfermera en Madrid", "enfermera", "Madrid"],
    ["ingeniero en Barcelona", "ingeniero", "Barcelona"],
    ["empleos de contador en Ciudad de México", "contador", "Ciudad de México"],
    ["emploi développeur web à Paris", "développeur web", "Paris"],
    ["infirmière à Lyon", "infirmière", "Lyon"],
    ["développeur près de Bordeaux", "développeur", "Bordeaux"],
    ["Softwareentwickler Stellen in München", "Softwareentwickler", "München"],
    ["Softwareentwickler bei Berlin", "Softwareentwickler", "Berlin"],
    ["Krankenpfleger nahe Köln", "Krankenpfleger", "Köln"],
    ["vagas de enfermeira em São Paulo", "enfermeira", "São Paulo"],
    ["vacatures verpleegkundige in Amsterdam", "verpleegkundige", "Amsterdam"],
  ])("%s searches %s in %s", (q, rest, place) => {
    expect(readQuery(q)).toMatchObject({ query: rest, location: place });
  });

  it.each([
    "Ingeniero en Sistemas",
    "Licenciado en Derecho",
    "Técnico em Enfermagem",
    "Responsable en Ressources Humaines",
    "Software Engineer bei SAP",
    "Werkstudent bei Siemens",
  ])("%s is a title and stays whole", (q) => {
    expect(readQuery(q)).toEqual({ query: q });
  });
});

describe("the reader's city names are the board's city names", () => {
  it("known-cities.ts holds exactly the names of job-board's CITY_COUNTRY table", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/normalize.ts"), "utf8");
    const start = src.indexOf("const CITY_COUNTRY = new Map<string, string>([");
    expect(start, "CITY_COUNTRY moved: point this test at it").toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("]);", start));
    const board = new Set([...body.matchAll(/\[\s*"([^"]+)"\s*,\s*"[A-Z]{2}"\s*\]/g)].map((m) => m[1]));
    expect(board.size).toBeGreaterThan(300);
    const mirror = new Set(KNOWN_CITIES);
    expect([...board].filter((c) => !mirror.has(c)), "on the board, missing from known-cities.ts").toEqual([]);
    expect([...mirror].filter((c) => !board.has(c)), "in known-cities.ts, not on the board").toEqual([]);
  });
});
