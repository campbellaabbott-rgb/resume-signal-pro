/**
 * WHICH BOARD TOKENS ARE ONE EMPLOYER (sweep S8-021).
 *
 * A Workday tenant publishes several career sites (tenant~wdN~site), and
 * those fold into one employer. No other '~' token does: for Greenhouse and
 * Lever EU (eu~<board>) and UKG (recruiting~<tenant>, recruiting2~<tenant>)
 * the first segment is a host, shared by hundreds of unrelated employers.
 * Keying a per-employer cache by the first segment handed every eu~ lander
 * the first eu~ employer's headcount and filings. This is the same rule the
 * company-lander readers apply in SQL (20261009160200).
 */
const WORKDAY_TOKEN = /^[^~]+~wd\d+~/;

export function employerGroupKey(token: string): string {
  return WORKDAY_TOKEN.test(token) ? `wd:${token.split("~")[0]}` : token;
}
