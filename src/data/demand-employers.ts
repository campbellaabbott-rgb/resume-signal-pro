/**
 * THE EMPLOYERS PEOPLE SEARCH FOR BY NAME, WHOSE BOARDS ARE TOO SMALL FOR THE
 * VOLUME CUT (SEO audit 2026-11-18, OPP-1; owner yes 2026-11-19 under D7,
 * "up to 2,000 indexed company pages").
 *
 * The bake gives a company page to the 500 boards with the most open roles,
 * and the cut sat near 300 roles, so the AI and start-up employers a job
 * seeker types into a search box never made it: on 2026-11-18, of 126 AI and
 * tech boards on the board, one had a live page (Anduril), 31 had noindex
 * stubs search engines already knew (OpenAI 265 open roles, Stripe 264,
 * Databricks 172, Anthropic 172) and 94 had no page at all.
 *
 * A board named here gets a page when it carries at least
 * DEMAND_EMPLOYER_MIN_OPEN open roles, up to DEMAND_EMPLOYER_CAP of them,
 * counted ABOVE the 500 ceiling (selectLanders `demand`), so no page chosen
 * by volume loses its slot. Every other rule still judges it: the name gate,
 * the duplicate rule and the thin rule (too few openings on its listing goes
 * noindex). The list: the 31 stubs, then the boards with 50 or more roles
 * that had no page, each by its board token, in the audit's order (open roles
 * on 2026-11-18, most first). It names employers, never ranks them: the bake
 * orders pages by their own open roles.
 */
export const DEMAND_EMPLOYER_MIN_OPEN = 50;
export const DEMAND_EMPLOYER_CAP = 40;

export const DEMAND_EMPLOYER_TOKENS: readonly string[] = Object.freeze([
  // The 31 noindex stubs (audit 2026-11-18, ai-tech-boards-vs-company-pages.json).
  "openai", // OpenAI (Ashby)
  "stripe", // Stripe
  "zscaler", // Zscaler
  "databricks", // Databricks
  "anthropic", // Anthropic
  "samsara", // Samsara
  "harvey", // Harvey (Ashby)
  "snowflake", // Snowflake (Ashby)
  "cloudflare", // Cloudflare
  "elastic", // Elastic
  "mongodb", // MongoDB
  "gitlab", // GitLab
  "okta", // Okta
  "airbnb", // Airbnb
  "waymo", // Waymo
  "veeva", // Veeva (Lever)
  "brex", // Brex
  "coinbase", // Coinbase
  "datadog", // Datadog
  "zoox", // Zoox (Lever)
  "pinterest", // Pinterest
  "lyft", // Lyft
  "elevenlabs", // ElevenLabs (Ashby)
  "applied", // Applied (Ashby)
  "coreweave", // CoreWeave
  "twilio", // Twilio
  "asana", // Asana
  "reddit", // Reddit
  "1x", // 1x (Ashby)
  "palantir", // Palantir (Lever)
  "shieldai", // Shieldai (Lever)
  // Boards with 50 or more open roles and no page of their own.
  "cursor", // Cursor (Ashby)
  "xai", // xAI
  "ramp", // Ramp (Ashby)
  "robinhood", // Robinhood
  "notion", // Notion (Ashby)
  "figma", // Figma
  "clickhouse", // ClickHouse (Ashby)
  "sierra", // Sierra (Ashby)
]);
