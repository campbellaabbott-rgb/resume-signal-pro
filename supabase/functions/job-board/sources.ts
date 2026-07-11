// The job board's company allowlist. Every entry was LIVE-VERIFIED against
// the ATS's official public job-board API before shipping (200 + >0 postings
// on 2026-07-11). These endpoints are published by the vendors for exactly
// this consumption — no scraping, no auth, no ToS gray zone:
//   Greenhouse: https://boards-api.greenhouse.io/v1/boards/{token}/jobs
//   Lever:      https://api.lever.co/v0/postings/{token}?mode=json
//   Ashby:      https://api.ashbyhq.com/posting-api/job-board/{token}
// Tokens rot when companies migrate ATSs; the fetcher tolerates failures and
// reports failedSources so a dead token degrades, never breaks, the board.

export type JobSourceKind = "greenhouse" | "lever" | "ashby";

export interface JobSource {
  name: string; // display name
  source: JobSourceKind;
  token: string; // the company's board token on that ATS
}

export const JOB_SOURCES: JobSource[] = [
  { name: "Affirm", source: "greenhouse", token: "affirm" },
  { name: "Airbnb", source: "greenhouse", token: "airbnb" },
  { name: "Airtable", source: "greenhouse", token: "airtable" },
  { name: "Amplitude", source: "greenhouse", token: "amplitude" },
  { name: "Anthropic", source: "greenhouse", token: "anthropic" },
  { name: "Asana", source: "greenhouse", token: "asana" },
  { name: "Astronomer", source: "ashby", token: "astronomer" },
  { name: "Axios", source: "greenhouse", token: "axios" },
  { name: "Betterment", source: "greenhouse", token: "betterment" },
  { name: "Brex", source: "greenhouse", token: "brex" },
  { name: "Calm", source: "greenhouse", token: "calm" },
  { name: "Carta", source: "greenhouse", token: "carta" },
  { name: "Checkr", source: "greenhouse", token: "checkr" },
  { name: "Chime", source: "greenhouse", token: "chime" },
  { name: "Cloudflare", source: "greenhouse", token: "cloudflare" },
  { name: "Coinbase", source: "greenhouse", token: "coinbase" },
  { name: "Cursor", source: "ashby", token: "cursor" },
  { name: "Databricks", source: "greenhouse", token: "databricks" },
  { name: "Datadog", source: "greenhouse", token: "datadog" },
  { name: "Discord", source: "greenhouse", token: "discord" },
  { name: "Docker", source: "ashby", token: "docker" },
  { name: "Dropbox", source: "greenhouse", token: "dropbox" },
  { name: "Duolingo", source: "greenhouse", token: "duolingo" },
  { name: "ElevenLabs", source: "ashby", token: "elevenlabs" },
  { name: "Faire", source: "greenhouse", token: "faire" },
  { name: "Figma", source: "greenhouse", token: "figma" },
  { name: "Flexport", source: "greenhouse", token: "flexport" },
  { name: "GitLab", source: "greenhouse", token: "gitlab" },
  { name: "Glossier", source: "greenhouse", token: "glossier" },
  { name: "Gusto", source: "greenhouse", token: "gusto" },
  { name: "Instacart", source: "greenhouse", token: "instacart" },
  { name: "Linear", source: "ashby", token: "linear" },
  { name: "Mercury", source: "greenhouse", token: "mercury" },
  { name: "Modal", source: "ashby", token: "modal" },
  { name: "MongoDB", source: "greenhouse", token: "mongodb" },
  { name: "Notion", source: "ashby", token: "notion" },
  { name: "Octopus Energy", source: "lever", token: "octoenergy" },
  { name: "Okta", source: "greenhouse", token: "okta" },
  { name: "Oscar Health", source: "greenhouse", token: "oscar" },
  { name: "Palantir", source: "lever", token: "palantir" },
  { name: "Peloton", source: "greenhouse", token: "peloton" },
  { name: "Pinterest", source: "greenhouse", token: "pinterest" },
  { name: "Ramp", source: "ashby", token: "ramp" },
  { name: "Reddit", source: "greenhouse", token: "reddit" },
  { name: "Replit", source: "ashby", token: "replit" },
  { name: "Robinhood", source: "greenhouse", token: "robinhood" },
  { name: "Scale AI", source: "greenhouse", token: "scaleai" },
  { name: "Sierra", source: "ashby", token: "sierra" },
  { name: "SoFi", source: "greenhouse", token: "sofi" },
  { name: "Squarespace", source: "greenhouse", token: "squarespace" },
  { name: "Stripe", source: "greenhouse", token: "stripe" },
  { name: "Supabase", source: "ashby", token: "supabase" },
  { name: "Toast", source: "greenhouse", token: "toast" },
  { name: "Twilio", source: "greenhouse", token: "twilio" },
  { name: "Veeva", source: "lever", token: "veeva" },
  { name: "Vercel", source: "greenhouse", token: "vercel" },
];
