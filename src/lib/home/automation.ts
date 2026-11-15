/**
 * IS THIS VISIT A PERSON? The homepage's live rows are one counted call to the
 * board for every visitor, made after first paint. A crawler reads the baked
 * page and a driven browser (navigator.webdriver) is a script: neither should
 * spend the board's anonymous budget, and neither sees a list it would index
 * as the page's content (corrected spec 4.2: "never for webdriver or crawler
 * user agents").
 */
// "bot" only where a crawler's token ends ("Googlebot/2.1", "Slackbot-", "bingbot;"),
// so a phone model with BOT in its name (CUBOT_X30) is still a person.
const CRAWLER_UA = /bot[/;)-]|crawl|spider|slurp|mediapartners|facebookexternalhit|embedly|lighthouse|headlesschrome|phantomjs|bingpreview|google-inspectiontool/i;

export interface AgentLike {
  userAgent?: string;
  webdriver?: boolean;
}

export function isAutomatedAgent(nav: AgentLike | null | undefined = typeof navigator === "undefined" ? null : navigator): boolean {
  if (!nav) return true;
  if (nav.webdriver === true) return true;
  return CRAWLER_UA.test(String(nav.userAgent ?? ""));
}

/**
 * A SEARCH ENGINE'S RENDERER IS SHOWN WHAT A PERSON IS (review 2026-11-15).
 * Googlebot, Google's inspection tool, bingbot and Applebot run the page's
 * JavaScript, and main.tsx mounts beside the baked page and removes it once
 * the route commits, so what they index is what React draws. A page that
 * skips a read for automated agents keeps making it for these, or the text
 * that read fills leaves the index. Matched on the user agent alone: a driven
 * renderer may also report navigator.webdriver.
 */
const SEARCH_RENDERER_UA = /googlebot|google-inspectiontool|bingbot|applebot/i;

export function isSearchRenderer(nav: AgentLike | null | undefined = typeof navigator === "undefined" ? null : navigator): boolean {
  return !!nav && SEARCH_RENDERER_UA.test(String(nav.userAgent ?? ""));
}
