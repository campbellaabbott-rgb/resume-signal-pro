// THE FREE KEY'S RATE, MIRRORED — the sibling of MCP_FREE_KEY_DAILY_QUOTA in
// src/config/mcp-tools.ts, kept in its own pure module so the prerender's
// data bundle (scripts/prerender-seo.mjs, esbuild over data-only files) can
// read it without pulling a React page in.
//
// api_key_issue sets every free key's row from two constants of its own,
// c_rate and c_quota (migration 20260826214700), and api_key_check enforces
// the row. This page and the prerender spelled the pair as "60
// requests/minute, 1,000/day per key" in five places — a fifth spelling of
// two constants (project_claim_drift), and false for a pass holder, whose
// row carries the pass overlay for its hours. Every sentence now
// interpolates {{ratePerMin}} and {{dailyQuota}} off these mirrors, and
// says the pass raises both. Pinned to the migration's c_rate by
// src/test/the-board-hands-a-job-and-a-search-to-the-agent.test.tsx (the
// daily quota is pinned to c_quota by a-first-call-with-no-key).
export const FREE_KEY_RATE_PER_MIN = 60;
