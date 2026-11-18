// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild, which refuses
// jsdom's TextEncoder (helpers/edge-harness.ts).
/**
 * A PARSER'S FAILURE ALERT CARRIES NO UPLOADER ADDRESS (S14X-101, the
 * owner's answer: owner alerts carry counts or a reference only, no raw IP).
 *
 * parse-pdf and parse-docx mail the owner when an upload fails or runs very
 * slowly (trackPerformance -> sendAlert, through Resend). The mail's details
 * carried `ip`, the uploader's address, so every refused résumé put a
 * visitor's address in an inbox. Now the details say what happened (the
 * operation, the reason, the timing) and nothing about who.
 *
 * Run on the shipped handlers with only their network faked: a refused upload
 * from a documentation address (RFC 5737) must still send its alert (the
 * control: the mail path ran), and no alert body may hold the address.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mailsSent, parserEnv, parserHarness, type ParserHarness } from "./helpers/parser-handlers";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ADDRESS = "203.0.113.7";
let pdf: ParserHarness;
let docx: ParserHarness;
beforeAll(async () => {
  parserEnv.RESEND_API_KEY = "re_harness_key";
  pdf = await parserHarness("parse-pdf");
  docx = await parserHarness("parse-docx");
});

describe("a refused upload's alert", () => {
  for (const [fn, name] of [["parse-pdf", "resume.pdf"], ["parse-docx", "resume.docx"]] as const) {
    it(`${fn}: an empty file from ${ADDRESS} is refused, the owner is mailed, and the mail does not hold the address`, async () => {
      const h = fn === "parse-pdf" ? pdf : docx;
      const before = mailsSent.length;
      const r = await h.upload(name, new Uint8Array(0), undefined, { "cf-connecting-ip": ADDRESS });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe("empty_file");
      await h.settle();
      const mails = mailsSent.slice(before);
      expect(mails.length, "the alert was sent").toBeGreaterThan(0);
      expect(mails.some((m) => m.body.includes(`${fn}_error`)), "the alert names its operation").toBe(true);
      for (const m of mails) expect(m.body).not.toContain(ADDRESS);
    });
  }
});
