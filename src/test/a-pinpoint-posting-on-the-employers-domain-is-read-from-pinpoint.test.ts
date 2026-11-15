/**
 * A PINPOINT POSTING ON THE EMPLOYER'S DOMAIN IS READ FROM PINPOINT
 * (connect W4, APPLY-1107-08).
 *
 * About a quarter of Pinpoint postings carry an apply link on the employer's
 * own domain (careers.eastwestrail.co.uk/en/postings/<uuid>). The reader
 * fetched only pinpointhq.com hosts, so it refused them and the answer said
 * the employer published no form. The same form is served at
 * https://{token}.pinpointhq.com plus the posting's path. The token is the
 * row's, label-checked as the Recruitee reader checks its own, so every
 * fetch still goes to Pinpoint's domain and never to the employer's.
 *
 * The real reader over a recorded East West Rail apply page (fixtures/forms).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readApplicationForm, type PostingRef } from "../../supabase/functions/_shared/application-form";
import { pinpointVendorPostingUrl } from "../../supabase/functions/_shared/form-readers-extra";

const PAGE = readFileSync(resolve(__dirname, "fixtures/forms/pinpoint-eastwestrail-612221.html"), "utf8");
const UUID = "f4e1b6a1-b3f1-47ec-8c82-433203558a6e";
const ref = (token: string, applyUrl: string): PostingRef => ({ id: `pinpoint:${token}:612221`, source: "pinpoint", token, applyUrl });
const recorder = () => {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(String(u));
    return String(u) === `https://eastwestrail.pinpointhq.com/en/postings/${UUID}/applications/new` ? new Response(PAGE, { status: 200 }) : new Response("", { status: 404 });
  }) as typeof fetch;
  return { f, urls };
};

describe("an employer-domain Pinpoint link", () => {
  it("is read from the token's pinpointhq.com host: four required questions", async () => {
    const { f, urls } = recorder();
    const r = await readApplicationForm(ref("eastwestrail", `https://careers.eastwestrail.co.uk/en/postings/${UUID}`), { fetch: f });
    expect(r.kind).toBe("read");
    if (r.kind !== "read") return;
    expect(r.form.questions).toHaveLength(4);
    expect(r.form.questions.every((q) => q.required)).toBe(true);
    expect(urls).toEqual([`https://eastwestrail.pinpointhq.com/en/postings/${UUID}/applications/new`]);
  });

  it("never fetches the employer's own domain", async () => {
    const { f, urls } = recorder();
    await readApplicationForm(ref("eastwestrail", `https://careers.eastwestrail.co.uk/en/postings/${UUID}`), { fetch: f });
    expect(urls.every((u) => new URL(u).hostname.endsWith(".pinpointhq.com"))).toBe(true);
  });

  it("a token that is not a host label is refused before any fetch", async () => {
    for (const token of ["evil.com/x", "a..b", "-lead", "x".repeat(70), "eastwestrail.pinpointhq.com@evil"]) {
      expect(pinpointVendorPostingUrl(token, `https://careers.eastwestrail.co.uk/en/postings/${UUID}`), token).toBeNull();
      const { f, urls } = recorder();
      const r = await readApplicationForm(ref(token, `https://careers.eastwestrail.co.uk/en/postings/${UUID}`), { fetch: f });
      expect(r.kind, token).not.toBe("read");
      expect(urls.filter((u) => !new URL(u).hostname.endsWith(".pinpointhq.com")), token).toEqual([]);
    }
  });

  it("a link with no posting path is not guessed at", () => {
    expect(pinpointVendorPostingUrl("eastwestrail", "https://careers.eastwestrail.co.uk/")).toBeNull();
    expect(pinpointVendorPostingUrl("eastwestrail", "https://careers.eastwestrail.co.uk/en/postings/not-a-uuid")).toBeNull();
  });
});
