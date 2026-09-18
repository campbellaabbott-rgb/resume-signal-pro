import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import {
  AUTHORIZATION_SERVER_METADATA_URL, SIGN_IN_META_KEY, SIGN_IN_OFF_TTL_MS, SIGN_IN_ON_TTL_MS, SIGN_IN_PROBE_TIMEOUT_MS,
  cachedSignIn, noCredentialAnswer, noCredentialLog, probeSignIn, resetSignInCache, signInGuideSection, signInSentence,
  type SignInState, type SignInVerdict,
} from "../../supabase/functions/agent-mcp/as-probe";
import { AUTH_ISSUER, MCP_URL, bearerChallenge, unauthorized } from "../../supabase/functions/agent-mcp/oauth";

/**
 * A CHALLENGE IS ANSWERED ONLY WHILE THE SIGN-IN SERVICE IS ON.
 *
 * A keyed tool called with no credential answers the sign-in challenge a
 * host turns into its Connect card. The card is honest only while an
 * authorization server stands behind it — and that server is a dashboard
 * toggle the owner flips, which on 2026-09-16 still answered "disabled". A
 * challenge into a dead sign-in strands the person on every host at once;
 * the old in-band refusal, which names the unkeyed tools and the mint page,
 * strands nobody. So the server now asks ONE fact before it challenges — a
 * cached probe of the authorization server's metadata document — and
 * publishes the same fact on its initialize result for the page to read.
 *
 * What is pinned here, and how:
 *   - the probe's verdicts, by calling it with a stubbed fetch: a disabled
 *     answer, a full document, a document missing any one of the three
 *     things a public client needs, a gateway error, a timeout, a network
 *     failure — each with the reason it names;
 *   - the cache: a positive verdict believed five minutes, a negative or
 *     unknown one sixty seconds, one fetch shared by concurrent first calls,
 *     the log line written on a real fetch and never on a cache hit;
 *   - the decision the dispatcher takes from the verdict, and the shape of
 *     the dispatcher's two challenge sites around it, read off comment-
 *     stripped source: the probe, the log, the in-band return with no cue,
 *     THEN the hedge, THEN the transport challenge — inside one guard;
 *   - the initialize result carrying the fact under the reverse-DNS key and
 *     the one sentence appended to its instructions, rendered under the
 *     truncation one host applies in every state;
 *   - the small honesty items that shipped in the same version: every keyed
 *     tool's description closes with the credential it needs, a shortlist
 *     read with no ids is an argument error, an unrecognised key on an
 *     unkeyed tool still answers, and the transport-edge strings say what
 *     to do next.
 * Every property has a teeth case that hands the parser a broken copy.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripTs = (s: string) => s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
const MCP_RAW = read("supabase/functions/agent-mcp/index.ts");
const MCP = stripTs(MCP_RAW);
const PROBE = stripTs(read("supabase/functions/agent-mcp/as-probe.ts"));

const between = (src: string, from: string, to: string): string => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`anchor "${from}" is gone — RE-ANCHOR this guard`);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`anchor "${to}" after "${from}" is gone — RE-ANCHOR this guard`);
  return src.slice(a, b);
};
/** A top-level function's text, to its own closing brace at column zero. */
function functionText(code: string, fn: string): string {
  const m = new RegExp(`\\n(?:async )?function ${fn}\\(`).exec(code);
  if (!m) throw new Error(`function ${fn} is not declared`);
  const end = code.indexOf("\n}\n", m.index);
  return code.slice(m.index, end < 0 ? code.length : end + 2);
}

// ── a stubbed authorization server ──────────────────────────────────────────

const FULL_DOCUMENT = {
  issuer: AUTH_ISSUER,
  registration_endpoint: `${AUTH_ISSUER}/oauth/clients/register`,
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
};
const DISABLED = { error_code: "feature_disabled", msg: "OAuth server is disabled" };

type Stub = { fetch: typeof fetch; calls: string[] };
/** A fetch that answers one HTTP status and body for every call, recording each URL it was asked for. */
function answering(status: number, body: unknown): Stub {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}
/** A fetch that never answers and rejects only when the caller's signal aborts. */
function hanging(): Stub {
  const calls: string[] = [];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input));
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}
/** A fetch that fails before any HTTP answer. */
function unreachable(): Stub {
  const calls: string[] = [];
  const fetchFn = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.reject(new TypeError("fetch failed"));
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

let clock = Date.UTC(2026, 8, 16, 22, 0, 0);
const now = () => clock;
const logged: string[] = [];
const log = (line: string) => { logged.push(line); };
const probe = (stub: Stub) => probeSignIn({ fetch: stub.fetch, now, log });

beforeEach(() => {
  resetSignInCache();
  clock = Date.UTC(2026, 8, 16, 22, 0, 0);
  logged.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

// ── the verdicts ────────────────────────────────────────────────────────────

describe("the probe reads the RFC 8414 document for the issuer and judges it by what a public client needs", () => {
  it("probes the authorization-server metadata URL derived from the server's own origin — never the OpenID document", () => {
    const issuer = new URL(AUTH_ISSUER);
    expect(issuer.origin).toBe(new URL(MCP_URL).origin);
    expect(AUTHORIZATION_SERVER_METADATA_URL).toBe(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`);
    expect(AUTHORIZATION_SERVER_METADATA_URL).not.toMatch(/openid-configuration/);
    // The module spells no second server URL: the issuer is read off oauth.ts.
    expect(PROBE).toMatch(/import \{ AUTH_ISSUER \} from "\.\/oauth\.ts";/);
    expect(PROBE).not.toMatch(/https:\/\/[a-z]+\.supabase\.co/);
  });

  it("a disabled server is off, with the reason the gateway names", async () => {
    const stub = answering(404, DISABLED);
    const v = await probe(stub);
    expect(v.state).toBe("off");
    expect(v.reason).toBe("feature_disabled");
    expect(stub.calls).toEqual([AUTHORIZATION_SERVER_METADATA_URL]);
    expect(v.authorizationServer).toBe(AUTH_ISSUER);
    expect(new Date(v.checkedAt).toISOString()).toBe(v.checkedAt);
  });

  it("a full document — registration, S256, a public token endpoint — is on", async () => {
    const v = await probe(answering(200, FULL_DOCUMENT));
    expect(v).toMatchObject({ state: "on", reason: null });
  });

  it("a 200 that lacks any one of the three is off, naming the first missing piece", async () => {
    const { registration_endpoint: _dropped, ...noRegistration } = FULL_DOCUMENT;
    expect((await probe(answering(200, noRegistration))).reason).toBe("no_registration_endpoint");
    resetSignInCache();
    expect((await probe(answering(200, { ...FULL_DOCUMENT, registration_endpoint: "" }))).reason).toBe("no_registration_endpoint");
    resetSignInCache();
    expect((await probe(answering(200, { ...FULL_DOCUMENT, code_challenge_methods_supported: ["plain"] }))).reason).toBe("no_s256");
    resetSignInCache();
    expect((await probe(answering(200, { ...FULL_DOCUMENT, token_endpoint_auth_methods_supported: ["client_secret_basic"] }))).reason).toBe("no_none_auth");
    resetSignInCache();
    expect(await probe(answering(200, "<html>not json</html>"))).toMatchObject({ state: "off", reason: "no_registration_endpoint" });
  });

  it("any other HTTP answer is off with its status; a timeout or a network failure is unknown", async () => {
    expect(await probe(answering(502, "bad gateway"))).toMatchObject({ state: "off", reason: "http_502" });
    resetSignInCache();
    expect(await probe(unreachable())).toMatchObject({ state: "unknown", reason: "network" });
    resetSignInCache();
    vi.useFakeTimers();
    const pending = probe(hanging());
    await vi.advanceTimersByTimeAsync(SIGN_IN_PROBE_TIMEOUT_MS + 1);
    expect(await pending).toMatchObject({ state: "unknown", reason: "timeout" });
    expect(SIGN_IN_PROBE_TIMEOUT_MS).toBe(1500);
  });
});

// ── the cache ───────────────────────────────────────────────────────────────

describe("the fact is cached: five minutes when on, a minute otherwise, one fetch per burst, one log line per real fetch", () => {
  it("two calls inside five minutes on a positive verdict fetch once; the next after five minutes fetches again", async () => {
    const stub = answering(200, FULL_DOCUMENT);
    await probe(stub);
    clock += SIGN_IN_ON_TTL_MS - 1;
    await probe(stub);
    expect(stub.calls).toHaveLength(1);
    clock += 1;
    await probe(stub);
    expect(stub.calls).toHaveLength(2);
    expect(SIGN_IN_ON_TTL_MS).toBe(5 * 60 * 1000);
  });

  it("a negative verdict is re-probed after sixty seconds and not before, so the owner's toggle is noticed within a minute", async () => {
    const stub = answering(404, DISABLED);
    await probe(stub);
    clock += SIGN_IN_OFF_TTL_MS - 1;
    await probe(stub);
    expect(stub.calls).toHaveLength(1);
    clock += 1;
    await probe(stub);
    expect(stub.calls).toHaveLength(2);
    expect(SIGN_IN_OFF_TTL_MS).toBe(60 * 1000);
    expect(SIGN_IN_OFF_TTL_MS).toBeLessThan(SIGN_IN_ON_TTL_MS);
  });

  it("an unknown verdict is cached like a negative one", async () => {
    const stub = unreachable();
    await probe(stub);
    clock += SIGN_IN_OFF_TTL_MS - 1;
    await probe(stub);
    expect(stub.calls).toHaveLength(1);
    clock += 1;
    await probe(stub);
    expect(stub.calls).toHaveLength(2);
  });

  it("ten concurrent first calls share one fetch and all read the same verdict", async () => {
    const stub = answering(200, FULL_DOCUMENT);
    const verdicts = await Promise.all(Array.from({ length: 10 }, () => probe(stub)));
    expect(stub.calls).toHaveLength(1);
    expect(new Set(verdicts.map((v) => v.checkedAt)).size).toBe(1);
    expect(verdicts.every((v) => v.state === "on")).toBe(true);
    // The slot is released: a call after the TTL fetches again.
    clock += SIGN_IN_ON_TTL_MS;
    await probe(stub);
    expect(stub.calls).toHaveLength(2);
  });

  it("the log line names the state, the status, the reason and the time, once per real fetch and never on a cache hit", async () => {
    const stub = answering(404, DISABLED);
    clock = 1_000;
    const fetchFn = (async (input: string | URL | Request) => {
      clock += 37;
      return stub.fetch(input);
    }) as typeof fetch;
    await probeSignIn({ fetch: fetchFn, now, log });
    await probeSignIn({ fetch: fetchFn, now, log });
    await probeSignIn({ fetch: fetchFn, now, log });
    expect(stub.calls).toHaveLength(1);
    expect(logged).toEqual(["[AGENT-MCP] as probe off (404 feature_disabled) 37ms"]);
    resetSignInCache();
    await probeSignIn({ fetch: answering(200, FULL_DOCUMENT).fetch, now, log });
    expect(logged[1]).toMatch(/^\[AGENT-MCP\] as probe on \(200\) \d+ms$/);
    // The synchronous reader sees the verdict the last probe cached.
    expect(cachedSignIn()?.state).toBe("on");
    resetSignInCache();
    expect(cachedSignIn()).toBeNull();
  });
});

// ── the decision ────────────────────────────────────────────────────────────

describe("the decision: a challenge only while on — every other state answers in band for every caller", () => {
  it("on: the transport challenge, or the in-band cue for the caller that reads it there; off and unknown: in band, cue or not", () => {
    expect(noCredentialAnswer("on", false)).toBe("challenge");
    expect(noCredentialAnswer("on", true)).toBe("challenge_in_band");
    for (const state of ["off", "unknown"] as SignInState[]) {
      expect(noCredentialAnswer(state, false)).toBe("in_band");
      expect(noCredentialAnswer(state, true)).toBe("in_band");
    }
  });

  it("the transport challenge the on-state reaches is the module's 401 with the header, unchanged", async () => {
    const res = unauthorized({});
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(bearerChallenge());
  });

  it("the log line per decision keeps the word a log reader greps for, names the transport the challenge took, and names the state that decided the in-band answer", () => {
    expect(noCredentialLog("no bearer", "key_status", "on", false)).toBe("[AGENT-MCP] no bearer on key_status: 401 challenge");
    // The caller that reads its cue in band got a 200, not a 401: the line says so.
    expect(noCredentialLog("no bearer", "key_status", "on", true)).toBe("[AGENT-MCP] no bearer on key_status: in-band challenge");
    expect(noCredentialLog("no bearer", "key_status", "off", false)).toBe("[AGENT-MCP] no bearer on key_status: in-band, sign-in off");
    expect(noCredentialLog("no bearer", "key_status", "off", true)).toBe("[AGENT-MCP] no bearer on key_status: in-band, sign-in off");
    expect(noCredentialLog("oauth refused (aud)", "get_job", "unknown", false)).toBe("[AGENT-MCP] oauth refused (aud) on get_job: in-band, sign-in unknown");
  });
});

// ── the dispatcher around it ────────────────────────────────────────────────

/**
 * Each transport-challenge site with the text of its own guard region: from
 * the `if (` that names the unkeyed set back to and including the site. The
 * region must hold, in order: the awaited probe, the decision log, the
 * in-band branch (returning a plain tool refusal, no cue), the hedge site,
 * and only then the challenge — so a caller reaches the 401 by passing
 * through the state check and nothing else.
 */
function challengeRegionsOf(code: string): string[] {
  const regions: string[] = [];
  for (const m of code.matchAll(/return unauthorized\(cors\);/g)) {
    const guard = code.lastIndexOf("!ANON_TOOLS.includes(toolName)) {\n    const { state } = await probeSignIn();", m.index!);
    regions.push(guard < 0 ? "" : code.slice(guard, m.index! + m[0].length));
  }
  return regions;
}
const ORDERED_MARKS = [
  "const { state } = await probeSignIn();",
  "console.log(noCredentialLog(",
  'if (noCredentialAnswer(state, hedgeInBand(params)) === "in_band") {',
  "const [why, how] = signInNotOn();",
  "return read ? readRefused(id, why, how, {}) : json(rpcResult(id, toolErr(why, how)));",
  "hedgeInBand(params)) {",
  "return json(rpcResult(id, inBandChallenge(toolName)));",
  "return unauthorized(cors);",
];
function inOrder(text: string, marks: readonly string[]): boolean {
  let at = 0;
  for (const mark of marks) {
    const i = text.indexOf(mark, at);
    if (i < 0) return false;
    at = i + mark.length;
  }
  return true;
}

describe("both challenge sites probe first and answer in band unless the fact is on", () => {
  const regions = challengeRegionsOf(MCP);

  it("there are exactly two sites — no bearer, and a bearer that failed verification — and each region carries the probe, the decision and the in-band branch before the hedge and the challenge", () => {
    expect(regions).toHaveLength(2);
    for (const r of regions) {
      expect(r, "a challenge site is not preceded by the probe inside its guard").not.toBe("");
      expect(inOrder(r, ORDERED_MARKS)).toBe(true);
      // The in-band branch carries no sign-in cue of any kind.
      const inBand = between(r, 'if (noCredentialAnswer(state, hedgeInBand(params)) === "in_band") {', "\n    }");
      expect(inBand).not.toMatch(/_meta|bearerChallenge|inBandChallenge|unauthorized/);
    }
    // The second region is the refused-token site: it names the refusal in its log cause.
    expect(regions[1]).toMatch(/noCredentialLog\(`oauth refused \(\$\{verdict\.reason\}\)`, toolName, state, hedgeInBand\(params\)\)/);
    expect(regions[0]).toMatch(/noCredentialLog\("no bearer", toolName, state, hedgeInBand\(params\)\)/);
  });

  it("the in-band refusal is the spec's two strings, every name and URL read off the registry", () => {
    const fn = functionText(MCP, "signInNotOn");
    expect(MCP).toMatch(/const SIGN_IN_NOT_ON = "Sign-in through this server is not switched on yet, so this tool needs a key\.";/);
    expect(fn).toMatch(/SIGN_IN_NOT_ON,/);
    const fix = /`([^`]*)`/.exec(fn)?.[1] ?? "";
    expect(fix).toContain("${ANON_TOOLS.join(\", \")}");
    expect(fix).toContain("${MINT_URL}");
    const anon = [...(/const ANON_TOOLS: readonly string\[\] = \[([^\]]*)\]/.exec(MCP)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    const mint = /const MINT_URL = "([^"]+)";/.exec(MCP)?.[1] ?? "";
    const rendered = fix.replace("${ANON_TOOLS.join(\", \")}", anon.join(", ")).replace("${MINT_URL}", mint);
    expect(rendered).toBe(
      `Tools that answer with no key: ${anon.join(", ")}. A free key (${mint}) works from Claude Code, Cursor, VS Code or any client that can send Authorization: Bearer <key>.`,
    );
    // No tool name typed into the fix: the list is the registry's.
    expect(fix.replace(/\$\{[^}]*\}/g, "")).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
  });

  it("the metadata document is still served in every state, and the securitySchemes on tools/list are untouched", () => {
    const get = between(MCP, 'if (req.method === "GET") {', "405);");
    expect(get).toMatch(/isProtectedResourceMetadataPath\(/);
    expect(get).not.toMatch(/probeSignIn|cachedSignIn/);
    const list = between(MCP, 'if (method === "tools/list") {', "\n  }\n");
    expect(list).toMatch(/securitySchemes = ANON_TOOLS\.includes\(t\.name\) \? \[\{ type: "noauth" \}, withToken\] : \[withToken\]/);
    expect(list).not.toMatch(/probeSignIn|cachedSignIn/);
  });
});

// ── the initialize result ───────────────────────────────────────────────────

/**
 * initialize.instructions rendered as a host receives it: the base
 * paragraph evaluated with the registry's own constants (parsed out of the
 * same source, the way the-attach-menu guard renders it), then the sentence
 * the wrapper appends for a given state.
 */
function renderInstructions(code: string, state: SignInState): string {
  const expr = between(code, "instructions:\n", "\n    }));").replace(/^instructions:\n/, "").trim().replace(/,$/, "");
  const list = (name: string) => [...(new RegExp(`const ${name}: readonly string\\[\\] = \\[([^\\]]*)\\]`).exec(code)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  const num = (name: string) => Number(new RegExp(`const ${name} = (\\d+);`).exec(code)?.[1] ?? NaN);
  const str = (name: string) => new RegExp(`const ${name} = "([^"]+)";`).exec(code)?.[1] ?? "";
  const tools = [...between(code, "const TOOLS = [", "\n];").matchAll(/\n {4}name: "([a-z_]+)",/g)].map((m) => m[1]);
  const ANON_TOOLS = list("ANON_TOOLS"), PAID_TOOLS = list("PAID_TOOLS"), ACCOUNT_TOOLS = list("ACCOUNT_TOOLS");
  const KEY_ONLY_READ_TOOLS = tools.filter((n) => !ANON_TOOLS.includes(n) && !PAID_TOOLS.includes(n) && !ACCOUNT_TOOLS.includes(n));
  const scheme = /const RESOURCE_SCHEME = "([^"]+)";/.exec(code)?.[1] ?? "";
  const GUIDE_URI = scheme + (/const GUIDE_URI = `\$\{RESOURCE_SCHEME\}([^`]+)`;/.exec(code)?.[1] ?? "");
  const DOCS_URL = /websiteUrl: "([^"]+)"/.exec(code)?.[1] ?? "";
  const tool = (n: string) => { if (!tools.includes(n)) throw new Error(`unregistered ${n}`); return n; };
  const fn = new Function(
    "tool", "ANON_TOOLS", "PAID_TOOLS", "ACCOUNT_TOOLS", "KEY_ONLY_READ_TOOLS", "ANON_SEARCH_LIMIT", "ANON_IP_CAP_PER_DAY",
    "ANON_GLOBAL_CAP_PER_DAY", "FREE_KEY_DAILY_QUOTA", "GET_JOBS_MAX", "KEYED_SEARCH_LIMIT", "CHECK_JOBS_OPEN_MAX",
    "MINT_URL", "PASS_URL", "DOCS_URL", "GUIDE_URI",
    `return (${expr});`,
  );
  const base = fn(
    tool, ANON_TOOLS, PAID_TOOLS, ACCOUNT_TOOLS, KEY_ONLY_READ_TOOLS, num("ANON_SEARCH_LIMIT"), num("ANON_IP_CAP_PER_DAY"),
    num("ANON_GLOBAL_CAP_PER_DAY"), num("FREE_KEY_DAILY_QUOTA"), num("GET_JOBS_MAX"), num("KEYED_SEARCH_LIMIT"), num("CHECK_JOBS_OPEN_MAX"),
    str("MINT_URL"), str("PASS_URL"), DOCS_URL, GUIDE_URI,
  ) as string;
  // The wrapper's own template, applied as written.
  const wrapper = functionText(code, "initializeResult");
  expect(wrapper).toMatch(/instructions: `\$\{base\.instructions\}\\n\$\{signInSentence\(signIn\.state, ANON_TOOLS\.length\)\}`,/);
  return `${base}\n${signInSentence(state, ANON_TOOLS.length)}`;
}
const STATES: SignInState[] = ["on", "off", "unknown"];

describe("initialize carries the fact and one sentence for it, under the truncation in every state", () => {
  it("the handler awaits the probe and hands the verdict to the wrapper, which sets _meta under the module's key", () => {
    const init = between(MCP, 'if (method === "initialize") {', "\n  }\n");
    expect(init).toMatch(/const signIn = await probeSignIn\(\);/);
    expect(init.indexOf("await probeSignIn()")).toBeLessThan(init.indexOf("initializeResult(id, signIn, {"));
    const wrapper = functionText(MCP, "initializeResult");
    expect(wrapper).toMatch(/_meta: \{ \[SIGN_IN_META_KEY\]: signIn \},/);
    // The key is reverse-DNS under the site's own domain — the spec reserves
    // the mcp/ and modelcontextprotocol/ prefixes — and the published shape is
    // exactly the four fields the page contract names.
    expect(SIGN_IN_META_KEY).toMatch(/^[a-z]+\.[a-z]+\/[a-z-]+$/);
    expect(SIGN_IN_META_KEY.startsWith("mcp/")).toBe(false);
    const shape: SignInVerdict = { state: "off", checkedAt: "", authorizationServer: "", reason: null };
    expect(Object.keys(shape).sort()).toEqual(["authorizationServer", "checkedAt", "reason", "state"]);
  });

  it("the sentence per state, rendered from the registry's unkeyed count", () => {
    expect(signInSentence("on", 4)).toBe("A keyed tool called with no key answers a sign-in challenge (HTTP 401); a host that supports sign-in opens it.");
    for (const s of ["off", "unknown"] as SignInState[]) {
      expect(signInSentence(s, 4)).toBe("Sign-in through this server is not switched on yet: a keyed tool called with no key answers in words, and the four unkeyed tools still work.");
    }
    expect(signInSentence("off", 5)).toContain("the five unkeyed tools");
  });

  it("the rendered instructions stay under 2,048 bytes in all three states, and end with the sentence", () => {
    for (const state of STATES) {
      const text = renderInstructions(MCP, state);
      expect(Buffer.byteLength(text, "utf8"), `state ${state}`).toBeLessThan(2048);
      expect(text.endsWith(signInSentence(state, 4))).toBe(true);
    }
  });

  it("the guide renders the same sentence and the state's own refusal row, from the verdict the read site probed first", () => {
    const words = { notOn: "NOT-ON-STRING", unkeyedTools: ["a", "b"], mintUrl: "https://example.test/mint" };
    for (const state of STATES) {
      const section = signInGuideSection(state, 4, words);
      expect(section).toContain(signInSentence(state, 4));
      expect(section.startsWith("## Sign-in today")).toBe(true);
      if (state === "on") {
        expect(section).toMatch(/Connect card/);
        expect(section).not.toContain(words.notOn);
      } else {
        expect(section).toContain(`"${words.notOn}"`);
        expect(section).toContain("`a`, `b`");
      }
      expect(section).toContain(words.mintUrl);
    }
    const guide = functionText(MCP, "guideText");
    expect(guide).toMatch(/signInGuideSection\(cachedSignIn\(\)\?\.state \?\? "unknown", ANON_TOOLS\.length, \{ notOn: SIGN_IN_NOT_ON, unkeyedTools: ANON_TOOLS, mintUrl: MINT_URL \}\)/);
    expect(guide).toMatch(/## If something refuses/);
    // Both guide reads warm the cache before the synchronous render.
    const reads = [...MCP.matchAll(/guideText\(\)\)/g)];
    expect(reads.length).toBe(2);
    for (const site of reads) {
      const before = MCP.slice(Math.max(0, site.index! - 160), site.index!);
      expect(before, `a guide read at ${site.index} does not probe first`).toMatch(/await probeSignIn\(\);/);
    }
  });
});

// ── the small honesty items in the same version ─────────────────────────────

type ToolReg = { name: string; description: string };
/** Every registered tool with the source of its description expression. */
function toolsOf(code: string): ToolReg[] {
  const arr = between(code, "const TOOLS = [", "\n];");
  const marks = [...arr.matchAll(/\n {4}name: "([a-z_]+)",/g)];
  return marks.map((m, i) => {
    const block = arr.slice(m.index!, i + 1 < marks.length ? marks[i + 1].index! : arr.length);
    const d = block.indexOf("description:");
    const e = block.slice(d).search(/\n {4}(?:annotations|inputSchema|outputSchema|_meta):/);
    return { name: m[1], description: block.slice(d, d + e).replace(/^description:\s*/, "").trim().replace(/,$/, "") };
  });
}
const anonOf = (code: string) => [...(/const ANON_TOOLS: readonly string\[\] = \[([^\]]*)\]/.exec(code)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
/** Whether a description expression closes with the shared sentence (get_job may add its fetch clause after it). */
const closesWithSentence = (t: ToolReg): boolean =>
  /(?:\+ KEYED_TOOL_SENTENCE|\$\{KEYED_TOOL_SENTENCE\}`)$/.test(t.description) ||
  (t.name === "get_job" && /\$\{KEYED_TOOL_SENTENCE\} With neither, call fetch with the same id\.`$/.test(t.description));

describe("every keyed tool says what it needs, a shortlist read with no ids is an argument error, and the edge strings say what to do", () => {
  it("every tool outside the unkeyed set closes its description with the one sentence; no unkeyed tool does", () => {
    expect(/const KEYED_TOOL_SENTENCE = "Needs a key or a sign-in\.";/.test(MCP)).toBe(true);
    const anon = anonOf(MCP);
    const tools = toolsOf(MCP);
    expect(tools.length).toBeGreaterThan(10);
    for (const t of tools) {
      expect(closesWithSentence(t), `${t.name}: ${t.description.slice(-80)}`).toBe(!anon.includes(t.name));
    }
    // get_job's own clause: the keyless reader is sent to the alias that answers.
    expect(tools.find((t) => t.name === "get_job")!.description).toMatch(/With neither, call fetch with the same id\./);
  });

  it("get_jobs with no ids throws the argument error, naming the cap from its constant", () => {
    const fn = functionText(MCP, "runGetJobs");
    expect(fn).toMatch(/if \(!asked\.length\) \{\s*throw new ToolArgumentError\(`ids is required — an array of job ids from search_jobs \(up to \$\{GET_JOBS_MAX\}\)\.`, "Send \{ids: \[\.\.\.\]\}\."\);/);
    expect(fn).not.toMatch(/throw new Error\("ids is required/);
    expect(fn).not.toMatch(/up to \d+\)/);
    // The other shortlist tool has the same argument, and the guide's row
    // names both: a plain Error there would reach the caller as "internal".
    const open = functionText(MCP, "runCheckJobsOpen");
    expect(open).toMatch(/throw new ToolArgumentError\(`ids is required — an array of job ids from search_jobs \(up to \$\{CHECK_JOBS_OPEN_MAX\}\)\.`, "Send \{ids: \[\.\.\.\]\}\."\);/);
    expect(MCP).not.toMatch(/throw new Error\(`ids is required/);
  });

  /**
   * The key gate — from the note's declaration to the unkeyed answer —
   * EXECUTED with a stubbed key check, because a fall-through that the next
   * statement swallows reads correctly and does nothing (the first cut of
   * .7 shipped exactly that: `d = null` followed by `if (!d || …) refuse`).
   * Returns what the gate returned, or the unkeyed answer it reached.
   */
  function runKeyGate(toolName: string, decision: Record<string, unknown> | null): Promise<unknown> {
    const gate = between(MCP, "  let unknownKeyNote = \"\";", "    await noteActivatedVia(");
    const src = `
      const ANON_TOOLS = ${JSON.stringify(anonOf(MCP))};
      const UNKNOWN_KEY_NOTE = "NOTE";
      const FREE_KEY_DAILY_QUOTA = 1000;
      const FREE_KEY_RATE_PER_MIN = 60;
      const KEY_REFUSALS = { rate_limited: (l) => ["rate " + l, "wait"], quota_exceeded: (l) => ["quota " + l, "wait"], revoked: ["revoked", "mint"], unknown_key: ["That key is not recognised.", "fix"] };
      const toolErr = (m, f) => ({ isError: true, message: m, fix: f });
      const readRefused = (id, m, f, h) => ({ read: true, message: m });
      const rpcResult = (id, r) => r;
      const json = (body, status, headers) => ({ body, status, headers });
      const secondsToMidnightUtc = () => 1;
      const withUnkeyedNote = (rpc, note) => ({ ...rpc, note });
      const answerUnkeyed = async () => ({ rpc: { unkeyed: true }, headers: { "X-Unkeyed-Remaining": "1" } });
      return async function run(toolName, decision) {
        const id = 1, read = false, toolArgs = {}, params = {}, keyHash = "hash";
        const client = { rpc() { return { maybeSingle: async () => ({ data: decision, error: null }) }; } };
        const req = { headers: { get() { return ""; } } };
        let d = null;
        let rateHeaders = {};
        ${gate}
        } catch (e) { throw e; }
        return "REACHED_THE_KEYED_PATH";
      };
    `;
    const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    return (new Function(js)() as (t: string, dec: unknown) => Promise<unknown>)(toolName, decision);
  }
  const deny = (reason: string) => ({ is_allowed: false, deny_reason: reason, rate_limit: 60, rate_used: 61, quota_limit: 1000, quota_used: 0 });

  it("an unrecognised key on an unkeyed tool runs unkeyed and says so; on a keyed tool, and for rate, quota and revoked, the refusal stands — the gate executed, not read", async () => {
    // The unkeyed tool reaches the unkeyed answer with the note; nothing was refused.
    const ran = await runKeyGate("search_jobs", deny("unknown_key")) as { body: { note?: string; unkeyed?: boolean; isError?: boolean }; status: number };
    expect(ran.body.isError).toBeUndefined();
    expect(ran.body).toEqual({ unkeyed: true, note: "NOTE" });
    expect(ran.status).toBe(200);
    // The same bad key on a keyed tool is refused with the unknown-key string.
    const refusedKeyed = await runKeyGate("key_status", deny("unknown_key")) as { body: { message: string } };
    expect(refusedKeyed.body.message).toBe("That key is not recognised.");
    // Recognised keys that are over their limits are refused on the unkeyed tools too.
    for (const reason of ["rate_limited", "quota_exceeded", "revoked"]) {
      const refused = await runKeyGate("search_jobs", deny(reason)) as { body: { isError?: boolean; message: string } };
      expect(refused.body.isError, reason).toBe(true);
      expect(refused.body.message, reason).not.toBe("That key is not recognised.");
    }
    // A good key goes on to the keyed path.
    expect(await runKeyGate("key_status", { is_allowed: true, rate_limit: 60, rate_used: 0, quota_limit: 1000, quota_used: 0 })).toBe("REACHED_THE_KEYED_PATH");
    const gate = between(MCP, "let unknownKeyNote = \"\";", "const friendly: Record<string, [string, string]> = {");
    expect(gate).not.toMatch(/"rate_limited"|"quota_exceeded"|"revoked"/);
    expect(MCP).toMatch(/const UNKNOWN_KEY_NOTE = "The key sent was not recognised \(keys start with rb_live_\); this call ran without it\.";/);
    expect(MCP).toMatch(/return json\(unknownKeyNote \? withUnkeyedNote\(rpc, unknownKeyNote\) : rpc, 200, headers\);/);
    // The note lands in the unkeyed block of a real answer, and a refusal is untouched: run the builder itself.
    const src = `${between(MCP, "const toolOk = (data: unknown) =>", "\nconst toolErr")}\n${functionText(MCP, "withUnkeyedNote")}\nreturn withUnkeyedNote;`;
    const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const run = new Function(js)() as (rpc: unknown, note: string) => { result: { content: { type: string; text?: string }[]; structuredContent: { unkeyed: { note?: string; callsLeftToday: number } } } };
    const answer = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "{}" }, { type: "resource_link", uri: "x" }], structuredContent: { jobs: [], unkeyed: { callsLeftToday: 3 } } } };
    const noted = run(answer, "NOTE");
    expect(noted.result.structuredContent.unkeyed).toEqual({ callsLeftToday: 3, note: "NOTE" });
    expect(noted.result.content.map((c) => c.type)).toEqual(["text", "resource_link"]);
    expect(JSON.parse(noted.result.content[0].text!).unkeyed.note).toBe("NOTE");
    const refused = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "{}" }], isError: true } };
    expect(run(refused, "NOTE")).toBe(refused);
  });

  it("the transport edge: a browser gets the not-a-web-page line on GET and any other method; a non-JSON body, an unknown tool and an unknown method each say what to do", () => {
    expect(MCP).toMatch(/const NOT_A_WEB_PAGE = `This is an MCP server for AI agents, not a web page\. Paste this address into your agent; the how-to is at \$\{DOCS_URL\}\.`;/);
    expect(MCP.match(/json\(\{ error: NOT_A_WEB_PAGE, docs: DOCS_URL \}, 405\)/g)?.length).toBe(2);
    expect(MCP).not.toMatch(/POST-only|"method not allowed"/);
    expect(MCP).toMatch(/rpcError\(null, -32700, "The request body is not JSON\. Send one JSON-RPC 2\.0 message per POST\."\), 400\)/);
    expect(MCP).not.toMatch(/-32700, "parse error"/);
    expect(MCP.match(/`unknown tool: \$\{toolName\} — call tools\/list for the names`/g)?.length).toBe(3);
    expect(MCP).not.toMatch(/`unknown tool: \$\{toolName\}`/);
    const methods = [...(/const SUPPORTED_METHODS = \[([^\]]*)\] as const;/.exec(MCP)?.[1] ?? "").matchAll(/"([a-z/]+)"/g)].map((m) => m[1]);
    expect(methods).toEqual(["initialize", "tools/list", "tools/call", "prompts/list", "prompts/get", "resources/list", "resources/read"]);
    for (const m of methods) expect(MCP, `${m} is not handled`).toMatch(new RegExp(`method [!=]== "${m.replace("/", "\\/")}"`));
    expect(MCP).toMatch(/`method not found: \$\{String\(method\)\} — supported: \$\{SUPPORTED_METHODS\.join\(", "\)\}`/);
  });

  it("the version names the release with the switch in it", () => {
    expect(between(MCP, "const SERVER_INFO = {", "\n};")).toMatch(/version: "2026-09-04\.8"/);
  });
});

// ── teeth ───────────────────────────────────────────────────────────────────

describe("teeth: each property fails on a copy that reintroduces the old behaviour", () => {
  it("a site that challenges without asking the fact is caught: no region, or the marks out of order", () => {
    // The old shape: the hedge and the challenge with no probe before them.
    const site = 'if (!bearer && !ANON_TOOLS.includes(toolName)) {\n    const { state } = await probeSignIn();';
    expect(MCP).toContain(site);
    const old = MCP.replace(site, "if (false) {\n    const { state } = await probeSignIn();");
    expect(old).not.toBe(MCP);
    expect(challengeRegionsOf(old)[0]).toBe("");
    // The in-band branch moved BELOW the challenge answers nobody.
    const region = challengeRegionsOf(MCP)[0];
    const inBand = between(region, 'if (noCredentialAnswer(state, hedgeInBand(params)) === "in_band") {', "\n    }") + "\n    }";
    const moved = MCP.replace(region, region.replace(inBand, "") + "\n" + inBand);
    expect(moved).not.toBe(MCP);
    expect(inOrder(challengeRegionsOf(moved)[0], ORDERED_MARKS)).toBe(false);
    // An in-band branch that smuggles the cue back is caught.
    const cued = region.replace("json(rpcResult(id, toolErr(why, how)))", "json(rpcResult(id, { ...toolErr(why, how), _meta: {} }))");
    expect(cued).not.toBe(region);
    expect(between(cued, 'if (noCredentialAnswer(state, hedgeInBand(params)) === "in_band") {', "\n    }")).toMatch(/_meta/);
  });

  it("a decision that treats unknown as on is not this module's", () => {
    // The pure function is the decision; a copy that opened the challenge on
    // unknown would answer differently here. This is the property the
    // dispatcher inherits by calling it.
    expect(noCredentialAnswer("unknown", false)).not.toBe("challenge");
    expect(noCredentialAnswer("unknown", true)).not.toBe("challenge_in_band");
  });

  it("a probe answered from the OpenID document, or a metadata document missing registration, would read on — and is read off here", async () => {
    // The OpenID document answers 200 today with no registration endpoint:
    // exactly the document the checks refuse.
    const openid = { issuer: AUTH_ISSUER, authorization_endpoint: `${AUTH_ISSUER}/oauth/authorize`, code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] };
    expect(await probe(answering(200, openid))).toMatchObject({ state: "off", reason: "no_registration_endpoint" });
  });

  it("a description that drops the sentence is caught by the registry walk, and an unkeyed tool that gains it too", () => {
    const tools = toolsOf(MCP);
    const keyStatus = tools.find((t) => t.name === "key_status")!;
    expect(closesWithSentence({ ...keyStatus, description: keyStatus.description.replace(/ \+ KEYED_TOOL_SENTENCE$/, "") })).toBe(false);
    const boardStats = tools.find((t) => t.name === "board_stats")!;
    expect(closesWithSentence(boardStats)).toBe(false);
    expect(closesWithSentence({ ...boardStats, description: `${boardStats.description} + KEYED_TOOL_SENTENCE` })).toBe(true);
  });

  it("a get_jobs that throws a plain Error again, or types the cap, is caught", () => {
    const fn = functionText(MCP, "runGetJobs");
    const plain = fn.replace("throw new ToolArgumentError(`ids is required", "throw new Error(`ids is required");
    expect(plain).not.toBe(fn);
    expect(plain).not.toMatch(/throw new ToolArgumentError\(`ids is required/);
    const typed = fn.replace("(up to ${GET_JOBS_MAX})", "(up to 10)");
    expect(typed).not.toBe(fn);
    expect(typed).toMatch(/up to \d+\)/);
  });

  it("instructions that grow past the truncation in the off state are caught on the rendered text", () => {
    const grown = MCP.replace("`The guide: ${GUIDE_URI}.`,", "`The guide: ${GUIDE_URI}. " + "x".repeat(40) + "`,");
    expect(grown).not.toBe(MCP);
    expect(Buffer.byteLength(renderInstructions(grown, "off"), "utf8")).toBeGreaterThanOrEqual(2048);
  });

  it("a guide read that renders before probing is caught", () => {
    const warmed = "await probeSignIn();\n        return json(rpcResult(id, contentsOf(GUIDE_URI, read.resource.mimeType, guideText())));";
    expect(MCP).toContain(warmed);
    const cold = MCP.replace(warmed, "return json(rpcResult(id, contentsOf(GUIDE_URI, read.resource.mimeType, guideText())));");
    expect(cold).not.toBe(MCP);
    const site = cold.indexOf("contentsOf(GUIDE_URI, read.resource.mimeType, guideText())");
    expect(cold.slice(Math.max(0, site - 160), site)).not.toMatch(/await probeSignIn\(\);/);
  });
});
