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
