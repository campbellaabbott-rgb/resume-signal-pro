/**
 * A LABEL NOTHING CAN EMIT IS NOT A COHORT.
 *
 * detectTrafficSource could never return 'organic'. The referral test ran
 * first and returned for ANY external referrer, so the search test below it
 * was unreachable for every input that existed. The value was in the type, in
 * the cohort reader and on the dashboard, and no visitor could ever be given
 * it.
 *
 * WHAT IT COST. 30 days to 2026-10-01: 131,336 direct / 22 referral / 15
 * social, and no organic row at all — the 22 being every external referrer
 * there is, search and blogs together. The one channel capable of growing
 * this was not a small number on a chart; it was unrepresentable, so a whole
 * SEO programme could not be judged by the funnel it was meant to move.
 *
 * WHY NO GUARD CAUGHT IT. There was none. The function had no test of any
 * kind, so the dead branch read exactly like the live ones. Both halves of
 * that matter, and this file holds both:
 *
 *   1. REACHABILITY, as a property over the whole label set rather than a
 *      list of cases. Every value the type admits must be produced by some
 *      input. That is the assertion that fails on the old ordering no matter
 *      which engine or which position the bug takes, and it keeps failing if
 *      a future label is added to the union and nothing emits it.
 *   2. The classifications themselves, including the ones that must NOT be a
 *      search visit.
 *
 * MATCHED ON THE HOST, NOT A SUBSTRING. The old code tested
 * `referrer.includes('google')` against the entire referrer URL, so a link
 * from https://example.com/?q=google counted as Google, and
 * `referrer.includes(window.location.hostname)` counted
 * https://notresumebooster.work.example.com as our own page. Those are in the
 * cases below, because a classifier that is right about the happy path and
 * credulous about a crafted host still reports the wrong number.
 */
import { describe, expect, it, afterEach } from "vitest";
import { detectTrafficSource, TRAFFIC_SOURCES } from "@/hooks/use-cohort-tracking";

/** Put the page on a known host with a known query, and the visitor behind a
 *  known referrer. jsdom's document.referrer is read-only, hence defineProperty. */
function visit(referrer: string, search = "") {
  window.history.replaceState({}, "", `/${search}`);
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
  return detectTrafficSource();
}
afterEach(() => {
  Object.defineProperty(document, "referrer", { value: "", configurable: true });
  window.history.replaceState({}, "", "/");
});

const SELF = () => window.location.hostname;

describe("every label the type admits can actually be produced", () => {
  // THE ASSERTION THAT WOULD HAVE CAUGHT THIS, and that keeps catching it.
  // One witness per label, discovered by running the real function rather
  // than asserted from the code's shape.
  const witnesses: Record<string, () => string> = {
    organic: () => visit("https://www.google.com/"),
    paid: () => visit("https://www.google.com/", "?utm_medium=cpc"),
    social: () => visit("https://www.linkedin.com/feed/"),
    referral: () => visit("https://someblog.example/post/ats-tips"),
    direct: () => visit(""),
    email: () => visit("", "?utm_medium=email"),
  };

  it("names a witness for every label, so the set cannot drift past this file", () => {
    expect(Object.keys(witnesses).sort()).toEqual([...TRAFFIC_SOURCES].sort());
  });

  it.each([...TRAFFIC_SOURCES])("%s is reachable", (label) => {
    expect(
      witnesses[label](),
      `nothing can produce '${label}' — it is a label on the dashboard that no visitor ` +
        "can ever be given, which is what hid the absence of search traffic for a month",
    ).toBe(label);
  });
});

describe("a search visit is a search visit, whichever engine and whichever country", () => {
  it.each([
    "https://www.google.com/",
    "https://www.google.co.uk/",          // GB is a first-class market for this board
    "https://www.google.de/search?q=ats",
    "https://www.bing.com/search?q=ats",
    "https://duckduckgo.com/",
    "https://search.brave.com/search?q=x",
    "https://uk.search.yahoo.com/",
    "https://yandex.ru/search/",
    "https://www.ecosia.org/search",
  ])("%s -> organic", (ref) => {
    expect(visit(ref)).toBe("organic");
  });

  it.each([
    ["https://mail.google.com/mail/u/0/", "a link pasted in Gmail is not a search result"],
    ["https://docs.google.com/document/d/1", "a link in a shared doc is not a search result"],
    ["https://news.google.com/articles/x", "an aggregator placement is not a search result"],
  ])("%s -> referral (%s)", (ref) => {
    expect(visit(ref)).toBe("referral");
  });
});

describe("the host decides, not a substring of the URL", () => {
  it("a page that merely mentions an engine in its query string is a referral", () => {
    // The old code did referrer.includes('google') on the whole URL.
    expect(visit("https://example.com/?q=google")).toBe("referral");
    expect(visit("https://notbing.example/page")).toBe("referral");
  });

  it("a host that merely ends with our name is not us", () => {
    // The old code did referrer.includes(window.location.hostname).
    expect(visit(`https://${SELF()}.example.com/landing`)).toBe("referral");
  });

  it("our own pages are not a referral to ourselves", () => {
    expect(visit(`https://${SELF()}/jobs`)).toBe("direct");
    expect(visit(`https://www.${SELF()}/jobs`)).toBe("direct");
  });

  it("a referrer that is not a URL at all is direct, not a crash", () => {
    expect(visit("not a url")).toBe("direct");
  });
});

describe("a campaign outranks the page that linked it", () => {
  // A paid click and an email click both normally carry a referrer too, so
  // these must not be read as whatever site served the ad.
  it("paid wins over the search engine that served the ad", () => {
    expect(visit("https://www.google.com/", "?utm_medium=cpc")).toBe("paid");
  });
  it("email wins over a webmail referrer", () => {
    expect(visit("https://mail.google.com/", "?utm_source=email")).toBe("email");
  });
  it("social wins over a plain referrer when the campaign names it", () => {
    expect(visit("https://t.co/abc", "?utm_source=twitter")).toBe("social");
  });
});

describe("the ordering bug itself, so its shape is on record", () => {
  // The old body, verbatim in its original order, kept as the thing this file
  // exists to refuse. It is run here rather than described, because the whole
  // lesson is that reading the code is what failed to notice.
  const OLD = (referrer: string, host: string) => {
    const social = ["facebook", "twitter", "linkedin", "instagram", "tiktok", "youtube", "reddit", "pinterest"];
    if (referrer && social.some((s) => referrer.includes(s))) return "social";
    if (referrer && !referrer.includes(host)) return "referral";
    const engines = ["google", "bing", "yahoo", "duckduckgo", "baidu"];
    if (referrer && engines.some((s) => referrer.includes(s))) return "organic";
    return "direct";
  };

  it("could not emit organic for ANY engine in its own list", () => {
    const reachable = ["google", "bing", "yahoo", "duckduckgo", "baidu"]
      .map((e) => OLD(`https://www.${e}.com/`, "resumebooster.work"));
    expect(reachable).toEqual(["referral", "referral", "referral", "referral", "referral"]);
    expect(reachable).not.toContain("organic");
  });

  it("and the live classifier does", () => {
    expect(visit("https://www.google.com/")).toBe("organic");
  });
});
