/**
 * AN EDGE ERROR IS SAID IN THE READER'S LANGUAGE (S14X-183, S14X-109 and
 * S14X-110, their copy halves).
 *
 * src/lib/edge-function-errors.ts turns a function's refusal into the toast's
 * title and sentence for sixteen call sites. Every one of its titles was an
 * English literal, so a German reader whose upload was refused read "Too many
 * requests"; a parser refusal (422) had no entry and was titled "Error"; the
 * AI provider running out of credits reached a past buyer as "Payment
 * required", not retryable, because the gateway's 402 sentences were not in
 * the map; and a busy model on a paid analysis was given the upload toast's
 * "hourly limit ... paste your résumé text" sentence, because the module never
 * read the answer's machine code.
 *
 * Held here: the titles and sentences come from the edgeErrors namespace, in
 * all nine languages; the answer's code is read before its sentence and its
 * status; the gateway's 402 sentences are an outage, never a payment; and the
 * telemetry codes stay the values the error dashboard already groups by.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ data: null, error: null })) } }));

import i18n from "@/i18n";
import { leafKeys } from "@/i18n/merge-shards";
import * as edge from "@/lib/edge-function-errors";
import { LOCALE_FILES, readLocale } from "./helpers/locale-strings";

const { parseEdgeFunctionError, parseEdgeFunctionErrorSync } = edge;
const http = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const parse = (e: unknown) => parseEdgeFunctionError(e, undefined, false);

const de = readLocale("de.json") as Record<string, Record<string, Record<string, string>>>;
const en = readLocale("en.json") as Record<string, Record<string, Record<string, string>>>;

beforeAll(() => {
  i18n.addResourceBundle("de", "translation", readLocale("de.json"), true, true);
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

async function inLanguage<T>(lng: string, fn: () => Promise<T> | T): Promise<T> {
  await i18n.changeLanguage(lng);
  try { return await fn(); } finally { await i18n.changeLanguage("en"); }
}

describe("the edge-error copy is a namespace served in nine languages", () => {
  it("names every entry the module can answer with", () => {
    const ids = (edge as { EDGE_ERROR_IDS?: readonly string[] }).EDGE_ERROR_IDS;
    expect(Array.isArray(ids) && ids.length, "the module exports no EDGE_ERROR_IDS").toBeGreaterThan(20);
    // The fallbacks and the parser refusal are entries too.
    for (const id of ["unknown", "network", "relay", "non2xx", "status422", "aiOutage", "busyShort", "busyLong"]) {
      expect(ids, id).toContain(id);
    }
  });

  it.each(LOCALE_FILES)("%s carries a title and a sentence for every entry", (file) => {
    const ids = (edge as { EDGE_ERROR_IDS?: readonly string[] }).EDGE_ERROR_IDS ?? [];
    const bundle = readLocale(file);
    const have = new Set(leafKeys(bundle));
    const missing: string[] = [];
    for (const id of ids) {
      if (!have.has(`edgeErrors.${id}.title`)) missing.push(`edgeErrors.${id}.title`);
      if (id !== "plain" && !have.has(`edgeErrors.${id}.description`)) missing.push(`edgeErrors.${id}.description`);
    }
    expect(missing).toEqual([]);
  });

  it("a translated entry is not the English one (spot check, every non-English language)", () => {
    for (const file of LOCALE_FILES.filter((f) => !f.startsWith("en"))) {
      const b = readLocale(file) as typeof en;
      expect(b.edgeErrors?.status429?.title, file).toBeTruthy();
      expect(b.edgeErrors.status429.title, file).not.toBe(en.edgeErrors.status429.title);
      expect(b.edgeErrors.network.description, file).not.toBe(en.edgeErrors.network.description);
    }
  });
});

describe("a German reader is told in German", () => {
  it("a 503 with a short server sentence is titled by the 503 entry, in German", async () => {
    const r = await inLanguage("de", () => parse(http(503, { error: "x" })));
    expect(r.title).toBe(de.edgeErrors.status503.title);
    expect(r.title).not.toBe("Service busy");
    expect(r.description).toBe("x");
    expect(r.errorCode).toBe("SERVICE_UNAVAILABLE");
  });

  it("a status with no sentence gives the entry's German title and sentence", async () => {
    const r = await inLanguage("de", () => parse(http(500, "{}")));
    expect(r).toMatchObject({ title: de.edgeErrors.status500.title, description: de.edgeErrors.status500.description, errorCode: "SERVER_ERROR", isRetryable: true });
  });

  it("a network failure and a relay failure are German, and so is the synchronous twin", async () => {
    const net = await inLanguage("de", () => parse(new FunctionsFetchError(new Error("offline"))));
    expect(net).toMatchObject({ title: de.edgeErrors.network.title, errorCode: "NETWORK_ERROR" });
    const relay = await inLanguage("de", () => parse(new FunctionsRelayError(new Error("relay"))));
    expect(relay).toMatchObject({ title: de.edgeErrors.relay.title, errorCode: "RELAY_ERROR" });
    const sync = await inLanguage("de", () => parseEdgeFunctionErrorSync(http(429, "{}")));
    expect(sync).toMatchObject({ title: de.edgeErrors.status429.title, errorCode: "RATE_LIMIT" });
    const nothing = await inLanguage("de", () => parse(null));
    expect(nothing).toMatchObject({ title: de.edgeErrors.unknown.title, errorCode: "UNKNOWN" });
  });

  it("in English the words are today's (the defaults and the English bundle agree)", async () => {
    expect((await parse(http(429, "{}"))).title).toBe("Too many requests");
    expect((await parse(new FunctionsFetchError(new Error("x")))).title).toBe("Connection error");
    expect(en.edgeErrors.status429.title).toBe("Too many requests");
  });
});

describe("a parser refusal (422) has its own entry (M-S14-159)", () => {
  it("a 422 with the parser's English sentence is not titled 'Error'", async () => {
    const r = await parse(http(422, { error: "We could not read any text in that PDF." }));
    expect(r.title).not.toBe("Error");
    expect(r.title).toBe(en.edgeErrors.status422.title);
    expect(r.description).toBe("We could not read any text in that PDF.");
    expect(r.isRetryable).toBe(false);
  });

  it("a 422 with no sentence names what to try", async () => {
    const r = await parse(http(422, "{}"));
    expect(r.description).toBe(en.edgeErrors.status422.description);
    expect(r.description).toMatch(/\.docx|paste/);
  });
});

describe("the AI provider out of credits is an outage, never a payment (S14X-109)", () => {
  const OUTAGES: Array<[number, Record<string, unknown>]> = [
    [402, { error: "Service temporarily unavailable." }],
    [402, { error: "AI service credits depleted. Please try again later.", retryable: false }],
    [402, { error: "AI service credits depleted. Please contact support.", retryable: false }],
    [503, { error: "The AI service can't take requests right now. Try again in a few minutes.", code: "ai_unavailable", retryable: true }],
  ];
  it.each(OUTAGES)("%s %j is a retryable AI outage, in English and German", async (status, body) => {
    for (const lng of ["en", "de"]) {
      const r = await inLanguage(lng, () => parse(http(status, body)));
      expect(r.errorCode, lng).toBe("AI_UNAVAILABLE");
      expect(r.isRetryable, lng).toBe(true);
      expect(r.title, lng).not.toBe("Payment required");
      expect(r.title, lng).not.toBe(lng === "de" ? de.edgeErrors.paymentRequired.title : "Payment required");
      expect(r.title, lng).toBe((lng === "de" ? de : en).edgeErrors.aiOutage.title);
    }
  });

  it("our own purchase refusal stays a payment refusal (control)", async () => {
    const r = await parse(http(402, { error: "Payment verification required." }));
    expect(r).toMatchObject({ errorCode: "PAYMENT_REQUIRED", isRetryable: false, title: "Payment required" });
  });

  it("the same sentence on a 503 from a limiter is not called an AI outage (control)", async () => {
    const r = await parse(http(503, { error: "Service temporarily unavailable." }));
    expect(r.errorCode).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("a busy model or limiter is a busy answer, never the upload's hourly sentence (S14X-110)", () => {
  const BUSY: Array<[number, Record<string, unknown>, string]> = [
    [429, { error: "AI service is temporarily busy. Please try again in a few moments.", code: "model_busy", retryable: true }, "AI_BUSY"],
    [503, { error: "Service temporarily unavailable. Please try again later.", code: "model_busy", retryable: true }, "AI_BUSY"],
    [429, { code: "model_busy" }, "AI_BUSY"],
    [503, { code: "limiter_unavailable" }, "SERVICE_UNAVAILABLE"],
    [503, { error: "This tool is temporarily unavailable. Please try again in a minute.", code: "limiter_unavailable", retryable: true }, "SERVICE_UNAVAILABLE"],
    [429, { error: "This tool is very busy right now. Please try again later.", code: "rate_limited_global", retryable: true }, "RATE_LIMIT"],
    [429, { code: "rate_limited_network" }, "RATE_LIMIT"],
    [429, { code: "rate_limited_budget" }, "RATE_LIMIT"],
  ];
  it.each(BUSY)("%s %j is retryable and says nothing of an hourly limit or pasting", async (status, body, code) => {
    for (const lng of ["en", "de"]) {
      const r = await inLanguage(lng, () => parse(http(status, body)));
      expect(r.isRetryable, lng).toBe(true);
      expect(r.errorCode, lng).toBe(code);
      expect(r.description, lng).not.toMatch(/hourly limit|paste your/i);
      expect(r.description, lng).not.toBe(en.edgeErrors.status429.description);
      expect(r.description, lng).not.toBe(de.edgeErrors.status429.description);
    }
  });

  it("a reached per-tool limit keeps the hourly sentence, which is what it means (control)", async () => {
    const r = await parse(http(429, { code: "rate_limited_function" }));
    expect(r).toMatchObject({ errorCode: "RATE_LIMIT", description: en.edgeErrors.status429.description });
  });
});

describe("the telemetry codes are the values the dashboard already groups by", () => {
  // Today's errorCode for each input, read from the module before this change.
  const SAME: Array<[unknown, string]> = [
    [http(400, "{}"), "BAD_REQUEST"],
    [http(401, "{}"), "UNAUTHORIZED"],
    [http(402, "{}"), "PAYMENT_REQUIRED"],
    [http(403, "{}"), "FORBIDDEN"],
    [http(404, "{}"), "NOT_FOUND"],
    [http(409, "{}"), "CONFLICT"],
    [http(429, "{}"), "RATE_LIMIT"],
    [http(500, "{}"), "SERVER_ERROR"],
    [http(502, "{}"), "BAD_GATEWAY"],
    [http(503, "{}"), "SERVICE_UNAVAILABLE"],
    [http(504, "{}"), "GATEWAY_TIMEOUT"],
    [http(418, "{}"), "UNKNOWN"],
    [http(429, { error: "Too many requests. Please try again later." }), "RATE_LIMIT"],
    [http(400, { error: "Invalid input provided." }), "INVALID_INPUT"],
    [http(409, { error: "This session has already been used." }), "SESSION_USED"],
    [http(504, { error: "The AI took too long to respond. Please try again." }), "AI_TIMEOUT"],
    [http(500, { error: "AI service temporarily unavailable. Please try again in a few moments." }), "AI_UNAVAILABLE"],
    [http(418, { error: "A short sentence." }), "BACKEND_ERROR"],
    [new Error("Edge Function returned a non-2xx status code"), "NON_2XX"],
    [new Error("Short message"), "GENERIC_ERROR"],
    [new Error("Payment verification required."), "PAYMENT_REQUIRED"],
  ];
  it.each(SAME)("%#: the same errorCode as before", async (input, code) => {
    expect((await parse(input)).errorCode).toBe(code);
  });

  it("a parser refusal is counted under its own new code, not as an unknown", async () => {
    expect((await parse(http(422, "{}"))).errorCode).toBe("UNPROCESSABLE");
  });
});
