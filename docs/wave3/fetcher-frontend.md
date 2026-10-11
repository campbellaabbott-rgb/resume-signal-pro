# Wave 3 round 2: fetcher + frontend (S11 sweep, 2026-10-11)

Branch `w31/fetcher-frontend`, built on `origin/wave3/integration`. Four
register items: S11-032, S11-008, S11-020, S11-037. Verifier:
`scripts/verify-deploy.d/79-wave3-fetcher-frontend.sh`.

## Builds

| function | build | why |
|---|---|---|
| fetch-job-posting (NEW) | `fetch-job-posting.2026-10-09.1` | S11-032 |
| free-keyword-scan | `free-keyword-scan.2026-10-09.4` | ignores a link sent as the job description |
| free-keyword-scan-stream | `free-keyword-scan-stream.2026-10-09.4` | the same |
| analyze-resume | `analyze-resume.2026-10-09.3` | the same, for the $5 analysis |
| job-board | stays `2026-09-09.92` | S11-020 (NEW `uncarried.ts`, +1.9 KB raw source) |

`docs/deploy-ledger.json` names `w31/` as a wave 3 branch prefix, so
`--against origin/wave3/integration` accepts the shared `.92` reservation.
No migrations. No new SQL function: the fetcher calls `check_rate_limit` and
`job_board_anon_check`, both with the service role.

## What ships

- **S11-032, the Job URL tab reads the posting** (owner decision: build a safe
  fetcher). `fetch-job-posting` takes `{url}` and answers the posting's
  description as plain text, from the vendor's public API where it has one
  (Greenhouse, Lever, SmartRecruiters, BambooHR, Rippling, Recruitee, Workday,
  Oracle, ADP) or the page's schema.org JobPosting (Ashby, Teamtailor,
  Personio, Breezy, Paylocity, iCIMS and others), and UKG's and JazzHR's own
  markup. Read live on 2026-10-11: 18 of 20 vendors returned a description
  (Workable answered 429 to a plain GET, USAJOBS carries no JobPosting; both
  ask for the text). The fence: https and port 443 only, no credentials, the
  vendors the board reads and employers' careers subdomains of them (never a
  custom domain, LinkedIn or Indeed); every address a host resolves to must be
  public (private, loopback, link-local, CGNAT, multicast, documentation, IPv6
  ULA and link-local, IPv4 dressed as IPv6 are refused), checked before every
  request and again after its headers (rebinding); redirects followed by hand,
  at most 3, each hop held to the whole rule; 3 MB and 9 s per read, body
  included. Two meters before anything outbound: `check_rate_limit` (20 an
  hour per address; a limiter error refuses) and the board's day
  (`job_board_anon_check`, the same bucket and caps job-board uses; fails open
  like the board). An unlisted host answers `unsupported_host` with no meter
  touched. The uploader's tab has a "Get job description" button; the text
  lands in the paste box with a Job Title / Company / Source header. Pressing
  the free scan with a link waiting reads it first; the $5 analysis reads it
  and stops, so the next press buys with the text on screen. A bare link
  pasted in the text box is offered the same read. A link is never sent as the
  description (`src/lib/job-description-input.ts`), and the three scan servers
  ignore one anyway (`_shared/job-description-input.ts`). The copy (all nine
  locales) no longer advertises LinkedIn, Indeed or Glassdoor links.
- **S11-008**: a posting handed to the scanner ("Check my fit", the posting
  page) is the one the scan scores; the restored session no longer overwrites
  it, and the hand-off is written to the session at once.
- **S11-020**: `/jobs/company/<token the board does not carry>` says "We don't
  carry <X>", noindex, with no not-hiring sentence and no claim offer. The
  list answers `unknownCompanies` when every employer a request scopes to is
  outside the catalogue (before any database read).
- **S11-037**: "Alert me when this exists" / "Email me new matches" on a search
  already saved turns the digest on for that row (daily) and says so.

## Order

1. Deploy `fetch-job-posting` (config.toml: `verify_jwt = false`) before or
   with the frontend. A frontend that ships first is safe: the tab says it
   could not read the link and asks for the text.
2. free-keyword-scan, free-keyword-scan-stream, analyze-resume and job-board
   in any order.
3. `bash scripts/verify-deploy.sh`: section 79 PASS.

## Notes for the owner

- DNS: the fetcher uses the runtime's `Deno.resolveDns`, and Cloudflare's
  DNS-over-HTTPS where the runtime offers none. If neither answers, every read
  says it could not read the link (safe). After deploy, paste one Greenhouse
  link into the Job URL tab once to see a real read.
- The board's country rule needs `cf-ipcountry`, which never reaches Supabase;
  job-board's mainland-China registry is not bundled into the fetcher. Blocked
  networks and the address cap apply.

## Rollback

Delete `fetch-job-posting` (the tab then asks for the text), redeploy the
previous builds of the three scan functions, and job-board from
`origin/wave3/integration` before this branch.
