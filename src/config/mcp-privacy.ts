// WHAT EACH WAY OF REACHING US FROM AN AI RECEIVES AND STORES — the one table
// (connect spec §3.8, with the owner decisions of 2026-10-11 applied) that the
// Privacy page renders and the tool descriptions and directory answers are
// drawn from. DRAFT FOR COUNSEL REVIEW: owner action 9 has counsel approve the
// wording before the MCP address on our own domain publishes.
//
// The facts each row states, and where they are made true:
//   - search words: kept for 30 days from Claude and other connections, with
//     no record of which postings were shown (the 30-day prune for MCP
//     searches); NOT written from ChatGPT (job-board .93 honours the no-log
//     flag agent-mcp sets on the ChatGPT surface, only with the reader proof);
//   - the caller's address and ChatGPT's per-person id: only ever a hashed
//     allowance bucket, the address buckets kept 7 days and ChatGPT's dropped
//     when their day ends (mcp_anon_rate);
//   - host, tool and outcome: daily counts with no address or person
//     (mcp_calls_daily);
//   - a CV: no keyless tool or prompt takes one (the CV-matching prompt no
//     longer has a CV argument); fit_resume, on a key only and never on ChatGPT,
//     receives one in memory to score it and stores none of it.
// A row that goes false when its mechanism moves is the claim-drift pattern;
// src/test/the-privacy-page-says-what-each-ai-surface-receives-and-keeps.test.tsx
// pins the rows the page must carry.

export interface McpPrivacyRow {
  id: "search" | "job-ids" | "address" | "chatgpt-id" | "usage" | "cv" | "chat";
  what: string;
  claude: string;
  chatgpt: string;
  kept: string;
}

export const MCP_PRIVACY_ROWS: readonly McpPrivacyRow[] = [
  {
    id: "search",
    what: "Your search words and filters",
    claude: "Received",
    chatgpt: "Received",
    kept: "From Claude and other connections: the search words and filters, kept for 30 days, without a record of which postings were shown. From ChatGPT: not kept.",
  },
  {
    id: "job-ids",
    what: "The ids of postings your AI opens or checks",
    claude: "Received",
    chatgpt: "Received",
    kept: "Only daily totals, with nothing that identifies you.",
  },
  {
    id: "address",
    what: "The network address the call comes from",
    claude: "Received",
    chatgpt: "Received",
    kept: "Only as a one-way hashed allowance counter, kept for 7 days. From Claude and ChatGPT the address is the provider's server, not yours.",
  },
  {
    id: "chatgpt-id",
    what: "ChatGPT's anonymous per-person id, when ChatGPT sends one",
    claude: "Not applicable",
    chatgpt: "Received",
    kept: "Only as a one-way hashed allowance counter, deleted when its day ends.",
  },
  {
    id: "usage",
    what: "Which app called, which tool, and whether it answered",
    claude: "Received",
    chatgpt: "Received",
    kept: "Daily counts only, with no address and no person.",
  },
  {
    id: "cv",
    what: "Your CV or résumé",
    claude: "Never requested by any tool that works without a key. With a key, the résumé-fit tool receives a résumé to score it.",
    chatgpt: "Never requested",
    kept: "Never stored. The résumé-fit tool uses it in memory to score postings and keeps none of it.",
  },
  {
    id: "chat",
    what: "Your conversation with your AI",
    claude: "Never received",
    chatgpt: "Never received",
    kept: "Nothing: it never reaches us.",
  },
];
