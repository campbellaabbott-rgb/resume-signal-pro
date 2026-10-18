/**
 * R1: NO CREDENTIAL IN A URL AFTER THE FIRST SCRIPT (Account UX spec 10,
 * register CP-008, contract 5).
 *
 * The host injects an analytics script that records full URLs, fragments
 * included, and the address bar is what people copy. index.html's first
 * <head> script moves token-bearing URL parts into sessionStorage
 * (rb_url_stash) and rewrites the address. This file runs THAT script, read
 * out of index.html, against each kind of URL, and the reader functions the
 * pages use (src/lib/auth-fragment.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STASH_KEY, clearPendingSignIn, discardStashedSession, forgetStashedSessionFor, forgetStashedShare, maskEmail, newestAmr, peekStashed, readPendingSignIn,
  pendingMatches, safeNextPath, setPendingSignIn, stashShareFor, stashValueFor, stashedFragment, stashedSessionIdFor, stashedSessionIdThisLoad, stashedShareFor, stashedValueFor, takeStashed,
} from "@/lib/auth-fragment";
import { parseParametersFromURL } from "@supabase/auth-js/dist/module/lib/helpers";

const HTML = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const HEAD = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(HTML)?.[1] ?? "";
const FIRST = /<script\b([^>]*)>([\s\S]*?)<\/script>/i.exec(HEAD);
const SCRIPT = FIRST?.[2] ?? "";

function load(url: string) {
  window.history.replaceState(null, "", url);
  // The script exactly as the page ships it, run in this window's global scope.
  new Function(SCRIPT)();
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
const stash = () => JSON.parse(sessionStorage.getItem(STASH_KEY) ?? "null") as Record<string, string> | null;

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("the stash script's place in index.html", () => {
  it("is the first child of <head>, inline and classic (no src, module, defer or async)", () => {
    expect(FIRST, "index.html has no <script> in <head>").toBeTruthy();
    expect(/^\s*<script\b/i.test(HEAD), "something precedes the stash script in <head>").toBe(true);
    expect(FIRST![1]).not.toMatch(/\bsrc\s*=|\btype\s*=|\bdefer\b|\basync\b/i);
    expect(SCRIPT).toContain("rb_url_stash");
    expect(SCRIPT).toContain("history.replaceState");
  });

  it("is plain ASCII, so it cannot change how the page's bytes are decoded", () => {
    expect([...SCRIPT].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
  });
});

describe("what the script takes out of the address", () => {
  it("a provider's or a link's tokens in the fragment", () => {
    const at = load("/auth?mode=return#access_token=eyJ.a.b&refresh_token=rt1&expires_at=1999999999&expires_in=3600&token_type=bearer&type=magiclink&provider_token=pt");
    expect(at).toBe("/auth?mode=return");
    expect(stash()).toMatchObject({ access_token: "eyJ.a.b", refresh_token: "rt1", expires_at: "1999999999", expires_in: "3600", token_type: "bearer", type: "magiclink", provider_token: "pt", _path: "/auth" });
  });

  it("leaves a fragment's other parts in place", () => {
    expect(load("/auth?mode=return#state=s1&access_token=eyJ.a.b&refresh_token=rt1")).toBe("/auth?mode=return#state=s1");
  });

  it("an error the auth server sent back in the fragment", () => {
    expect(load("/auth?mode=return#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid")).toBe("/auth?mode=return");
    expect(stash()).toMatchObject({ error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid" });
  });

  it("our own mail's token_hash and type, keeping the mode and next", () => {
    expect(load("/auth?mode=confirm&token_hash=pkce_abc123&type=recovery&next=%2Fjobs")).toBe("/auth?mode=confirm&next=%2Fjobs");
    expect(stash()).toMatchObject({ token_hash: "pkce_abc123", type: "recovery" });
  });

  it("an authorization code in the query", () => {
    expect(load("/auth?code=0f1e2d")).toBe("/auth");
    expect(stash()).toMatchObject({ code: "0f1e2d" });
  });

  it("the Stripe session id on /product-success and /success, with the path it came from", () => {
    expect(load("/product-success?session_id=cs_test_a1&product=scanPack")).toBe("/product-success?product=scanPack");
    expect(stash()).toMatchObject({ session_id: "cs_test_a1", session_id_path: "/product-success" });
    sessionStorage.clear();
    expect(load("/success?session_id=cs_live_b2")).toBe("/success");
    expect(stash()).toMatchObject({ session_id: "cs_live_b2", session_id_path: "/success" });
  });

  it("the whole fragment on the unsubscribe and confirm pages", () => {
    for (const path of ["/email/unsubscribe", "/market-pulse/confirm", "/fix-plan/confirm"]) {
      sessionStorage.clear();
      expect(load(`${path}#t=${"a".repeat(64)}&x=1`)).toBe(path);
      expect(stash()?.fragment).toBe(`#t=${"a".repeat(64)}&x=1`);
    }
  });
});

describe("nothing the auth client would adopt survives the script (review of R1: login CSRF)", () => {
  // auth-js reads the fragment AND the query, decodes the key names, and adopts
  // any access_token + refresh_token it finds there (detectSessionInUrl stays on
  // in the generated client). Its own parser judges what is left.
  const leftForAuthJs = () => parseParametersFromURL(window.location.href);
  it.each([
    ["/?access_token=AT&refresh_token=RT&expires_in=3600&token_type=bearer"],
    ["/auth?mode=return&access_token=AT&refresh_token=RT&expires_in=3600&token_type=bearer"],
    ["/jobs#access%5Ftoken=AT&refresh%5Ftoken=RT&expires%5Fin=3600&token%5Ftype=bearer"],
    ["/jobs?q=nurse#state=s1&access_token=AT&refresh_token=RT"],
    ["/account?error_description=Email+link+is+invalid&error_code=otp_expired"],
  ])("%s", (url) => {
    load(url);
    const left = leftForAuthJs();
    expect(left.access_token, "an access token survived for auth-js to adopt").toBeUndefined();
    expect(left.refresh_token).toBeUndefined();
    expect(left.error_description).toBeUndefined();
    expect(stash()).toBeTruthy();
  });

  it("the stash keeps the decoded tokens, and the rest of the address stays", () => {
    expect(load("/jobs?q=nurse#access%5Ftoken=AT2&refresh%5Ftoken=RT2&expires%5Fin=3600&token%5Ftype=bearer")).toBe("/jobs?q=nurse");
    expect(stash()).toMatchObject({ access_token: "AT2", refresh_token: "RT2", expires_in: "3600", token_type: "bearer" });
    expect(load("/?access_token=AT3&refresh_token=RT3&utm_source=mail")).toBe("/?utm_source=mail");
    expect(stash()).toMatchObject({ access_token: "AT3", refresh_token: "RT3" });
  });

  it("blocked storage still takes a sign-in's parts out of the address (that sign-in is lost, never adopted unasked)", () => {
    const real = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", { get() { throw new Error("blocked"); }, configurable: true });
    try {
      expect(load("/auth?mode=return#access_token=AT4&refresh_token=RT4&type=magiclink")).toBe("/auth?mode=return");
      expect(load("/?access_token=AT5&refresh_token=RT5&session_id=cs_test_kept")).toBe("/?session_id=cs_test_kept");
      expect(leftForAuthJs().access_token).toBeUndefined();
    } finally {
      if (real) Object.defineProperty(window, "sessionStorage", real);
      else delete (window as unknown as Record<string, unknown>).sessionStorage;
    }
  });
});

describe("every credential-bearing URL the sweep lists (S12-090)", () => {
  it("a Stripe session id on any return path, with the path it came from", () => {
    for (const [url, path, rest] of [
      ["/freelance-boost?session_id=cs_test_fb1", "/freelance-boost", "/freelance-boost"],
      ["/agents/pass?session_id=cs_test_pass1", "/agents/pass", "/agents/pass"],
      ["/account?pro=success&session_id=cs_test_pro1", "/account", "/account?pro=success"],
      ["/?scan_pack_success=true&session_id=cs_test_sp1", "/", "/?scan_pack_success=true"],
    ] as const) {
      sessionStorage.clear();
      expect(load(url)).toBe(rest);
      expect(stash()).toMatchObject({ session_id: url.split("session_id=")[1], session_id_path: path });
    }
  });

  it("the share id on /success (it reads and deletes the analysis)", () => {
    expect(load("/success?share=abc123share")).toBe("/success");
    expect(stash()).toMatchObject({ share: "abc123share", share_path: "/success" });
    expect(stashedValueFor("share", "/success", null)).toEqual({ value: "abc123share", fromStash: true });
    expect(stashedValueFor("share", "/jobs", null).value).toBeNull();
  });

  it("the API key link's #confirm on /data-api, leaving the page's own anchors", () => {
    const tok = "b".repeat(64);
    expect(load(`/data-api#confirm=${tok}`)).toBe("/data-api");
    expect(stashedFragment("", "/data-api")).toBe(`#confirm=${tok}`);
    expect(stashedFragment("", "/market-pulse/confirm"), "a fragment stashed on one page is not another page's").toBe("");
  });

  it("a page that learns a share after the load keeps it in the stash, not the address", () => {
    expect(stashValueFor("share", "/success", "late-share")).toBe(true);
    expect(stashedValueFor("share", "/success", null).value).toBe("late-share");
  });
});

describe("what the script leaves alone", () => {
  it.each([
    ["/account#orders"],
    ["/jobs?type=full-time&q=nurse"],
    ["/agents#claude"],
    ["/data-api#pricing"],
    ["/jobs?share=board"],
    ["/jobs?error=none"],
    ["/"],
  ])("%s", (url) => {
    expect(load(url)).toBe(url);
    expect(stash()).toBeNull();
  });
});

describe("one tab's stash across loads", () => {
  it("a reload with a clean address keeps what the first load stashed", () => {
    load("/product-success?session_id=cs_test_keep&product=coverLetter");
    expect(load("/product-success?product=coverLetter")).toBe("/product-success?product=coverLetter");
    expect(stash()?.session_id).toBe("cs_test_keep");
  });

  it("a sign-in return keeps a payment session id, and replaces an older sign-in's parts as a group", () => {
    load("/product-success?session_id=cs_test_keep2&product=coverLetter");
    load("/auth?mode=confirm&token_hash=old_hash&type=signup");
    load("/auth?mode=return#access_token=eyJ.n.n&refresh_token=rt2&type=magiclink");
    expect(stash()).toMatchObject({ session_id: "cs_test_keep2", access_token: "eyJ.n.n", refresh_token: "rt2", type: "magiclink" });
    expect(stash()?.token_hash, "an older link's token_hash survived a newer sign-in").toBeUndefined();
  });

  it("a new purchase on /success drops the share the tab held, in the same write (S13-002)", () => {
    load("/success?session_id=cs_live_first");
    expect(stashShareFor("/success", "share-of-first", "cs_live_first")).toBe(true);
    expect(load("/success?session_id=cs_live_second")).toBe("/success");
    expect(stash()).toMatchObject({ session_id: "cs_live_second", session_id_path: "/success" });
    expect(stash()?.share, "the first purchase's share survived the second purchase's arrival").toBeUndefined();
    expect(stash()?.share_path).toBeUndefined();
    expect(stash()?.share_session).toBeUndefined();
  });

  it("a share link on /success replaces the purchase the tab held for /success, and a share that arrives with its purchase names it", () => {
    load("/success?session_id=cs_live_held");
    expect(load("/success?share=link-share")).toBe("/success");
    expect(stash()).toMatchObject({ share: "link-share", share_path: "/success", share_session: "" });
    expect(stash()?.session_id, "a share link was read as the tab's old purchase").toBeUndefined();
    load("/product-success?session_id=cs_test_other&product=scanPack");
    load("/success?share=link-share-2");
    expect(stash()?.session_id, "a share link on /success dropped another page's purchase").toBe("cs_test_other");
    expect(load("/success?session_id=cs_live_pair&share=pair-share")).toBe("/success");
    expect(stash()).toMatchObject({ session_id: "cs_live_pair", share: "pair-share", share_session: "cs_live_pair" });
  });

  it("blocked storage leaves the address untouched, so the page still finds its parts there", () => {
    const real = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    const blocked = { getItem: () => null, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    Object.defineProperty(window, "sessionStorage", { value: blocked, configurable: true });
    try {
      expect(load("/product-success?session_id=cs_test_blocked&product=scanPack")).toBe("/product-success?session_id=cs_test_blocked&product=scanPack");
    } finally {
      if (real) Object.defineProperty(window, "sessionStorage", real);
      else delete (window as unknown as Record<string, unknown>).sessionStorage;
    }
  });
});

describe("the readers the pages use", () => {
  it("peek leaves a value, take removes it, discard drops a whole sign-in", () => {
    load("/auth?mode=return#access_token=eyJ.p.q&refresh_token=rt3&type=recovery");
    load("/product-success?session_id=cs_test_z&product=scanPack");
    expect(peekStashed("access_token")).toBe("eyJ.p.q");
    expect(peekStashed("access_token")).toBe("eyJ.p.q");
    expect(takeStashed("refresh_token")).toBe("rt3");
    expect(peekStashed("refresh_token")).toBeNull();
    discardStashedSession();
    expect(peekStashed("access_token")).toBeNull();
    expect(peekStashed("type")).toBeNull();
    expect(peekStashed("session_id")).toBe("cs_test_z");
  });

  it("a payment page prefers an id still in the address, else the stash's from its own path", () => {
    load("/success?session_id=cs_live_from_success");
    expect(stashedSessionIdFor("/product-success", null)).toEqual({ id: null, fromStash: false });
    expect(stashedSessionIdFor("/success", null)).toEqual({ id: "cs_live_from_success", fromStash: true });
    expect(stashedSessionIdFor("/success", "cs_in_url")).toEqual({ id: "cs_in_url", fromStash: false });
  });

  it("a session id honoured only on the load that captured it: this document's capture yes, an earlier document's no (S13-082)", () => {
    const at = (origin: number) => Object.defineProperty(performance, "timeOrigin", { configurable: true, get: () => origin });
    try {
      at(Date.now() - 100);
      load("/freelance-boost?session_id=cs_live_boost_once");
      expect(stashedSessionIdThisLoad("/freelance-boost", null)).toEqual({ id: "cs_live_boost_once", fromStash: true });
      expect(stashedSessionIdThisLoad("/freelance-boost", "cs_in_the_address"), "an id still in the address always wins").toEqual({ id: "cs_in_the_address", fromStash: false });
      at(Date.now() + 60_000);
      load("/freelance-boost");
      expect(stashedSessionIdThisLoad("/freelance-boost", null), "a later load read the old purchase back").toEqual({ id: null, fromStash: false });
      expect(stashedSessionIdFor("/freelance-boost", null).id, "the reload-keeping reader still finds it (the success page needs that)").toBe("cs_live_boost_once");
      forgetStashedSessionFor("/success");
      expect(peekStashed("session_id"), "forgetting another page's purchase dropped this one").toBe("cs_live_boost_once");
      forgetStashedSessionFor("/freelance-boost");
      expect(peekStashed("session_id")).toBeNull();
    } finally {
      delete (performance as unknown as Record<string, unknown>).timeOrigin;
    }
  });

  it("a stashed share is honoured only for the purchase it was made for (S13-002)", () => {
    stashShareFor("/success", "share-a", "cs_live_a");
    expect(stashedShareFor("/success", "cs_live_a")).toBe("share-a");
    expect(stashedShareFor("/success", "cs_live_b"), "another purchase was handed this purchase's analysis").toBeNull();
    expect(stashedShareFor("/success", null), "with no purchase named, the share is a link to that analysis alone").toBe("share-a");
    expect(stashedShareFor("/jobs", null)).toBeNull();
    stashValueFor("share", "/success", "share-written-before-the-hotfix");
    expect(stashedShareFor("/success", "cs_live_a"), "a share whose purchase is not known was handed to a purchase").toBeNull();
    forgetStashedShare();
    expect(stashedShareFor("/success", null)).toBeNull();
    expect(peekStashed("share_session")).toBeNull();
  });

  it("a confirm page reads the address's fragment first, else the stash's", () => {
    load(`/market-pulse/confirm#t=${"c".repeat(64)}`);
    expect(stashedFragment("")).toBe(`#t=${"c".repeat(64)}`);
    expect(stashedFragment("#t=x")).toBe("#t=x");
  });
});

describe("the pending-sign-in marker and the helpers beside it", () => {
  it("holds a safe next: an hour for a typed address, ten minutes for a marker that names none (a provider press), and only a same-origin path", () => {
    setPendingSignIn("/jobs?q=nurse", 1_000_000, "me@example.com");
    expect(readPendingSignIn(1_000_000 + 59 * 60_000)).toEqual({ at: 1_000_000, next: "/jobs?q=nurse", email: "me@example.com", provider: false });
    expect(readPendingSignIn(1_000_000 + 61 * 60_000)).toBeNull();
    setPendingSignIn("/jobs?q=nurse", 1_000_000);
    expect(readPendingSignIn(1_000_000 + 9 * 60_000)).toEqual({ at: 1_000_000, next: "/jobs?q=nurse", email: null, provider: true });
    expect(readPendingSignIn(1_000_000 + 11 * 60_000), "a marker that can vouch for nobody in particular outlived ten minutes").toBeNull();
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example/x", "javascript:alert(1)", "/a b"]) {
      setPendingSignIn(bad, 5);
      expect(readPendingSignIn(5)?.next, bad).toBe("/account");
    }
    localStorage.setItem("rb_auth_pending", JSON.stringify({ at: 7, next: "//evil.example" }));
    expect(readPendingSignIn(7)?.next, "a marker written by hand is re-checked on read").toBe("/account");
    clearPendingSignIn();
    expect(readPendingSignIn()).toBeNull();
    expect(safeNextPath("/oauth/consent?authorization_id=1")).toBe("/oauth/consent?authorization_id=1");
  });

  it("a marker that names the address asked for matches only that address", () => {
    setPendingSignIn("/jobs", 2_000, "Jane@Example.com");
    const p = readPendingSignIn(2_000);
    expect(p).toEqual({ at: 2_000, next: "/jobs", email: "jane@example.com", provider: false });
    expect(pendingMatches(p, "jane@example.com")).toBe(true);
    expect(pendingMatches(p, "attacker@evil.example"), "a link for another address rode the marker").toBe(false);
    setPendingSignIn("/jobs", 3_000);
    expect(pendingMatches(readPendingSignIn(3_000), "anyone@example.com"), "a provider press cannot name the address").toBe(true);
    expect(pendingMatches(null, "jane@example.com")).toBe(false);
  });

  it("masks an address to its first character and domain", () => {
    expect(maskEmail("jane.doe@gmail.com")).toBe("j***@gmail.com");
    expect(maskEmail("j***@gmail.com")).toBe("j***@gmail.com");
    expect(maskEmail("")).toBe("");
  });

  it("reads the newest authentication method from a token", () => {
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const tok = `h.${b64({ amr: [{ method: "password", timestamp: 10 }, { method: "recovery", timestamp: 20 }] })}.s`;
    expect(newestAmr(tok)).toBe("recovery");
    expect(newestAmr("not-a-jwt")).toBeNull();
  });
});
