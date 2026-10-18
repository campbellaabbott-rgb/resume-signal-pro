/**
 * AN EMPLOYER'S FORM IS READ WHERE IT WAS PUBLISHED, AND NEVER GUESSED.
 *
 * apply_myself hands a person's own AI the employer's real application form
 * (_shared/application-form.ts). Five hiring systems publish one where a
 * server can read it; every other posting answers "no form published", never
 * an invented one. Each reader is run here against recorded payloads with an
 * injected fetch and cache:
 *
 *   - the answer options the employer wrote come through (Greenhouse
 *     `fields[].values`, Ashby `selectableValues` and booleans, Recruitee
 *     options, Breezy options, Pinpoint yes/no labels), and Greenhouse's
 *     compliance blocks are named in alsoOnForm;
 *   - it fails closed: a payload that does not parse is "absent", a vendor
 *     that is down is "unreachable" and is NOT cached, a host the posting does
 *     not name is never fetched;
 *   - the 24-hour cache answers a fresh read, re-reads a stale one, and
 *     caches "absent" the same way;
 *   - inside ChatGPT only the public-API pair is read (owner decision R2);
 *   - and the module never imports job-board's files.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FORM_CACHE_MS, FORM_READER_VENDORS, PUBLIC_API_FORM_VENDORS, externalIdOf, readApplicationForm,
  type FormCache, type FormCacheRow, type PostingRef,
} from "../../supabase/functions/_shared/application-form.ts";
import { realQuestionVendors } from "../../supabase/functions/_shared/apply-automation.ts";

const fixture = (name: string) => readFileSync(resolve(__dirname, "shared/__fixtures__", name), "utf8");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; body?: string };
function fetchFrom(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: typeof init?.body === "string" ? init.body : undefined });
    return answer(String(input), init);
  }) as typeof fetch;
  return { f, calls };
}
function memoryCache(rows: Record<string, FormCacheRow> = {}) {
  const puts: Array<{ id: string; vendor: string; ok: boolean; form: unknown }> = [];
  const cache: FormCache = {
    get: async (id) => rows[id] ?? null,
    put: async (id, vendor, ok, form) => { puts.push({ id, vendor, ok, form }); rows[id] = { vendor, ok, form, read_at: new Date().toISOString() }; },
  };
  return { cache, puts, rows };
}
const NOW = Date.parse("2026-10-12T10:00:00Z");
const ref = (id: string, applyUrl: string | null = null): PostingRef => {
  const [source, token] = id.split(":");
  return { id, source, token, applyUrl };
};

describe("which vendors are read, and where", () => {
  it("the readers are exactly the vendors the automation table says publish their questions", () => {
    expect([...FORM_READER_VENDORS].sort()).toEqual(realQuestionVendors());
    expect([...PUBLIC_API_FORM_VENDORS].sort()).toEqual(["greenhouse", "recruitee"]);
  });

  it("a vendor with no reader is answered 'no-reader' without a fetch", async () => {
    const { f, calls } = fetchFrom(() => json({}));
    expect(await readApplicationForm(ref("workday:acme~wd5~Careers:R1"), { fetch: f })).toEqual({ kind: "no-reader", vendor: "workday" });
    expect(calls).toEqual([]);
  });

  it("inside ChatGPT an Ashby, Breezy or Pinpoint form is withheld without a fetch", async () => {
    const { f, calls } = fetchFrom(() => json({}));
    for (const id of ["ashby:acme:uuid-1", "breezy:acme:1", "pinpoint:acme:1"]) {
      const r = await readApplicationForm(ref(id, "https://acme.breezy.hr/p/1"), { fetch: f, vendors: PUBLIC_API_FORM_VENDORS });
      expect(r.kind, id).toBe("withheld");
    }
    expect(calls).toEqual([]);
  });

  it("an id whose prefix does not match its row is read as no form, never fetched", async () => {
    expect(externalIdOf({ id: "greenhouse:other:1", source: "greenhouse", token: "acme", applyUrl: null })).toBeNull();
    const { f, calls } = fetchFrom(() => json({}));
    const r = await readApplicationForm({ id: "greenhouse:other:1", source: "greenhouse", token: "acme", applyUrl: null }, { fetch: f, now: () => NOW });
    expect(r.kind).toBe("absent");
    expect(calls).toEqual([]);
  });
});

describe("each reader returns the form as the employer wrote it", () => {
  it("Greenhouse: options from fields[].values, the description as a hint, compliance named; an EU tenant asks the EU host", async () => {
    const payload = {
      questions: [
        { label: "First Name", required: true, fields: [{ type: "input_text" }] },
        { label: "Resume/CV", required: true, fields: [{ type: "input_file" }] },
        { label: "Are you legally authorized to work in the UK?", required: true, fields: [{ type: "multi_value_single_select", values: [{ label: "Yes", value: 1 }, { label: "No", value: 0 }] }] },
        { label: "<p>Why do you want to join <b>Acme</b>?</p>", required: false, description: "<p>A few sentences.</p>", fields: [{ type: "textarea" }] },
      ],
      compliance: [{ type: "eeoc", questions: [] }],
      data_compliance: [{ type: "gdpr", requires_consent: true, requires_processing_consent: false, requires_retention_consent: false }],
    };
    const { f, calls } = fetchFrom(() => json(payload));
    const r = await readApplicationForm(ref("greenhouse:eu~acme:42"), { fetch: f, now: () => NOW });
    expect(calls[0].url).toBe("https://boards.eu.greenhouse.io/v1/boards/acme/jobs/42?questions=true");
    expect(r.kind).toBe("read");
    if (r.kind !== "read") return;
    expect(r.form.questions.map((q) => q.label)).toEqual(["First Name", "Resume/CV", "Are you legally authorized to work in the UK?", "Why do you want to join Acme?"]);
    expect(r.form.questions[2].options).toEqual(["Yes", "No"]);
    expect(r.form.questions[3].hint).toBe("A few sentences.");
    expect(r.form.documents).toEqual([{ name: "Resume/CV", required: true }]);
    expect(r.form.alsoOnForm).toEqual(["Voluntary self-identification (EEO) questions", "Data-protection consent (GDPR)"]);
  });

  it("Ashby: the public GraphQL with the tenant and posting, a boolean as Yes/No, selectable values as options", async () => {
    const payload = { data: { jobPosting: { applicationForm: { sections: [{ fieldEntries: [
      { isRequired: true, field: { title: "Do you require visa sponsorship?", type: "Boolean" } },
      { isRequired: false, field: { title: "Preferred office", type: "ValueSelect", selectableValues: [{ label: "London" }, { label: "Remote" }] } },
    ] }] } } } };
    const { f, calls } = fetchFrom(() => json(payload));
    const r = await readApplicationForm(ref("ashby:acme:uuid-9"), { fetch: f, now: () => NOW });
    expect(JSON.parse(calls[0].body!).variables).toEqual({ organizationHostedJobsPageName: "acme", jobPostingId: "uuid-9" });
    if (r.kind !== "read") throw new Error(r.kind);
    expect(r.form.questions.map((q) => q.options)).toEqual([["Yes", "No"], ["London", "Remote"]]);
  });

  it("Recruitee: open questions with their options and the document slots; a tenant that is not a plain subdomain is never fetched", async () => {
    const offer = { offer: { open_questions: [
      { body: "Notice period?", kind: "single_choice", required: true, open_question_options: [{ body: "None" }, { body: "1 month" }] },
      { body: "Anything else?", kind: "string", required: false },
    ], options_cv: "required", options_cover_letter: "optional", options_photo: "off" } };
    const { f, calls } = fetchFrom(() => json(offer));
    const r = await readApplicationForm(ref("recruitee:acme:77"), { fetch: f, now: () => NOW });
    expect(calls[0].url).toBe("https://acme.recruitee.com/api/offers/77");
    if (r.kind !== "read") throw new Error(r.kind);
    expect(r.form.questions[0].options).toEqual(["None", "1 month"]);
    expect(r.form.documents).toEqual([{ name: "Resume / CV", required: true }, { name: "Cover letter", required: false }]);
    const evil = await readApplicationForm({ id: "recruitee:evil.example/x:1", source: "recruitee", token: "evil.example/x", applyUrl: null }, { fetch: f, now: () => NOW });
    expect(evil.kind).toBe("absent");
    expect(calls).toHaveLength(1);
  });

  it("Breezy and Pinpoint: the posting's own apply page, only on the vendor's domain, parsed from the recorded pages", async () => {
    const { f, calls } = fetchFrom((url) => new Response(url.includes("breezy") ? fixture("breezy-apply.html") : fixture("pinpoint-apply.html"), { status: 200 }));
    const breezy = await readApplicationForm(ref("breezy:wealthy-recruiting:2ef4", "https://wealthy-recruiting.breezy.hr/p/2ef4f0cf615f-senior-sales-manager"), { fetch: f, now: () => NOW });
    expect(calls[0].url).toBe("https://wealthy-recruiting.breezy.hr/p/2ef4f0cf615f-senior-sales-manager/apply");
    expect(breezy.kind).toBe("read");
    const pinpoint = await readApplicationForm(ref("pinpoint:dnata:1", "https://dnata.pinpointhq.com/en/postings/ac538c02-dd11-4998-a58d-74749bf58c42"), { fetch: f, now: () => NOW });
    expect(pinpoint.kind).toBe("read");
    if (pinpoint.kind === "read") {
      const yesNo = pinpoint.form.questions.filter((q) => /yes.?no|boolean/i.test(q.type));
      for (const q of yesNo) expect(q.options?.length, q.label).toBe(2);
    }
    // A Breezy row whose apply URL is on someone else's host is not fetched.
    const before = calls.length;
    const offDomain = await readApplicationForm(ref("breezy:acme:1", "https://evil.example/p/1"), { fetch: f, now: () => NOW });
    expect(offDomain.kind).toBe("absent");
    expect(calls).toHaveLength(before);
  });
});

describe("it fails closed, and the cache keeps faults out", () => {
  it("a vendor that is down is unreachable and never cached; a 404 is absent and is cached", async () => {
    for (const answer of [() => json({}, 503), () => json({}, 429), () => { throw new TypeError("fetch failed"); }]) {
      const { cache, puts } = memoryCache();
      const r = await readApplicationForm(ref("greenhouse:acme:1"), { fetch: fetchFrom(answer as () => Response).f, cache, now: () => NOW });
      expect(r.kind).toBe("unreachable");
      expect(puts).toEqual([]);
    }
    const { cache, puts } = memoryCache();
    const r = await readApplicationForm(ref("greenhouse:acme:1"), { fetch: fetchFrom(() => json({}, 404)).f, cache, now: () => NOW });
    expect(r.kind).toBe("absent");
    expect(puts).toEqual([{ id: "greenhouse:acme:1", vendor: "greenhouse", ok: false, form: {} }]);
  });

  it("a payload that does not parse, or parses to nothing, is absent — never an empty form", async () => {
    for (const body of ["not json", JSON.stringify({ questions: [] })]) {
      const r = await readApplicationForm(ref("greenhouse:acme:2"), { fetch: fetchFrom(() => new Response(body, { status: 200 })).f, now: () => NOW });
      expect(r.kind, body).toBe("absent");
    }
  });

  it("a fresh cached read answers with no fetch; a stale one is read again", async () => {
    const form = { questions: [{ label: "Why us?", required: false, type: "textarea" }], documents: [], alsoOnForm: [] };
    const fresh = memoryCache({ "greenhouse:acme:3": { vendor: "greenhouse", ok: true, form, read_at: new Date(NOW - 3600_000).toISOString() } });
    const net = fetchFrom(() => json({ questions: [{ label: "New", required: true, fields: [{ type: "textarea" }] }] }));
    const hit = await readApplicationForm(ref("greenhouse:acme:3"), { fetch: net.f, cache: fresh.cache, now: () => NOW });
    expect(hit).toMatchObject({ kind: "read", cached: true });
    expect(net.calls).toEqual([]);
    const stale = memoryCache({ "greenhouse:acme:3": { vendor: "greenhouse", ok: true, form, read_at: new Date(NOW - FORM_CACHE_MS - 1).toISOString() } });
    const reread = await readApplicationForm(ref("greenhouse:acme:3"), { fetch: net.f, cache: stale.cache, now: () => NOW });
    expect(reread).toMatchObject({ kind: "read", cached: false });
    expect(net.calls).toHaveLength(1);
    expect(stale.puts).toHaveLength(1);
  });

  it("a cache that throws is read past and written past: slower, never wrong", async () => {
    const broken: FormCache = { get: async () => { throw new Error("db down"); }, put: async () => { throw new Error("db down"); } };
    const r = await readApplicationForm(ref("greenhouse:acme:4"), { fetch: fetchFrom(() => json({ questions: [{ label: "Q", fields: [{ type: "textarea" }] }] })).f, cache: broken, now: () => NOW });
    expect(r.kind).toBe("read");
  });
});

describe("the module stays light", () => {
  it("never imports job-board's files (its source list alone is megabytes)", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/application-form.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*job-board\//);
    expect(src).not.toMatch(/JOB_SOURCES/);
  });
});

/**
 * A Breezy or Pinpoint apply page that answers 200 with no screening
 * questions was answered as if the hiring system published no form ("does
 * not publish its application form where we can read it"), and the CV dropped
 * out of the documents. The review of 9fe3bc0d saw it on about half the Breezy
 * postings it sampled (breezy:mktg:a9bbdb4bcf25-brand-ambassador: 21,863
 * bytes, no questions). It still fails closed (no empty form), but says the
 * page was read, and names the CV to attach; the cache keeps the distinction.
 */
describe("an apply page read with no questions on it is not 'no published form'", () => {
  const PAGE = "<html><body><h1>Brand Ambassador</h1><form><input name='name'><input type='file' name='resume'></form></body></html>";

  it("Breezy and Pinpoint answer absent with pageRead, and the cache remembers it", async () => {
    for (const [id, url] of [
      ["breezy:mktg:a9bbdb4bcf25-brand-ambassador", "https://mktg.breezy.hr/p/a9bbdb4bcf25-brand-ambassador"],
      ["pinpoint:dnata:2", "https://dnata.pinpointhq.com/en/postings/2"],
    ] as const) {
      const { cache, puts } = memoryCache();
      // The memory cache stamps its rows with the wall clock, so this reads by it too.
      const r = await readApplicationForm(ref(id, url), { fetch: fetchFrom(() => new Response(PAGE, { status: 200 })).f, cache, now: Date.now });
      expect(r, id).toMatchObject({ kind: "absent", pageRead: true });
      expect(puts[0], id).toMatchObject({ ok: false, form: { pageRead: true } });
      const again = await readApplicationForm(ref(id, url), { fetch: fetchFrom(() => { throw new Error("no fetch on a fresh row"); }).f, cache, now: Date.now });
      expect(again, id).toMatchObject({ kind: "absent", pageRead: true, cached: true });
    }
  });

  it("a 404 apply page, or an off-domain URL, is plain absent, as before", async () => {
    const gone = await readApplicationForm(ref("breezy:mktg:x", "https://mktg.breezy.hr/p/x"), { fetch: fetchFrom(() => new Response("", { status: 404 })).f, now: () => NOW });
    expect(gone.kind).toBe("absent");
    expect((gone as { pageRead?: boolean }).pageRead).toBeUndefined();
  });

  it("apply_myself says the page was read and names the CV, instead of saying no form is published", async () => {
    const { applyMyselfAnswer } = await import("../../supabase/functions/agent-mcp/apply-myself.ts");
    const posting = { id: "breezy:mktg:a9bbdb4bcf25-brand-ambassador", title: "Brand Ambassador", company: "MKTG", location: null, pay: null, postedAt: null, applyUrl: "https://mktg.breezy.hr/p/a9bbdb4bcf25-brand-ambassador", siteUrl: "https://resumebooster.work/jobs?job=breezy:mktg:a9bbdb4bcf25-brand-ambassador" };
    const a = applyMyselfAnswer(posting, { kind: "absent", vendor: "breezy", readAt: "2026-10-12T10:00:00.000Z", cached: false, pageRead: true }, []);
    expect(a.form.note).not.toMatch(/does not publish/);
    expect(a.form.note).toMatch(/found no questions beyond your details and CV/);
    expect(a.form.documents).toEqual([{ name: "Resume / CV", required: false }]);
    expect(a.form.questions).toEqual([]);
    const plain = applyMyselfAnswer(posting, { kind: "absent", vendor: "breezy", readAt: "2026-10-12T10:00:00.000Z", cached: false }, []);
    expect(plain.form.note).toMatch(/does not publish/);
  });

  it("/v1 says the same, with its own reason", async () => {
    const { formBlock } = await import("../../supabase/functions/public-api/application.ts");
    const b = formBlock({ kind: "absent", vendor: "pinpoint", readAt: "2026-10-12T10:00:00.000Z", cached: false, pageRead: true })!;
    expect(b.reason).toBe("no-questions-found");
    expect(b.note).toMatch(/found no questions beyond the person's details and CV/);
    expect(b.documents).toEqual([{ name: "Resume / CV", required: false }]);
  });
});
