# Pro Redesign: Job-Application Workspace ($45/mo)

**Status: design only — gated.** Do not build until Pro has organic subscribers
or funnel data supports the investment (owner decision). This doc exists so the
build can start immediately once the gate clears.

## The problem with the current pitch

`ProSubscriptionCard.tsx` sells Pro as a tool-bundle discount: "every paid tool
included." That framing invites the buyer to price-compare against one-off
purchases and conclude Pro only pays off at heavy usage. A job seeker doesn't
want tools; they want a job. The subscription should sell the *loop* — tailor,
apply, track, learn what worked — which no one-off product can offer.

## New value proposition

> **Your job search, in one workspace.** Tailor a resume version to every job,
> track every application against the exact version you sent, and see which
> resumes actually get interviews.

Four pillars, in the order they appear on the card:

1. **Unlimited JD-tailored resume versions.** Paste a job description, get a
   tailored version, saved and named. (Backed by existing keyword-fix engine +
   `user_scans` labels; new `resume_versions` concept keyed by the resume hash
   already computed in `free-keyword-scan/index.ts`.)
2. **Application tracking tied to the resume you sent.** The existing
   `user_applications` tracker gains a `resume_version` link, so every
   applied/interviewing/offer/rejected status is correlated with a specific
   version.
3. **Rescan diffs between versions.** "Version B scores 12 points higher for
   this JD and adds these 6 keywords." `scan_industry_pins` + resume hashing
   already give stable identity across rescans; the report cache
   (`scan_report_cache`) makes diffing cheap.
4. **Real efficacy data.** Recording interview outcomes (already a tracker
   status) per version builds the dataset for claims like "resumes tailored
   with Pro got interviews 2.1× more often" — a marketing asset no competitor
   discount bundle produces.

The tool bundle doesn't disappear — it becomes the footnote ("all paid tools
included"), not the headline.

## Build scope (when gated open)

- **Schema:** `resume_versions` (user, hash, label, source JD, created_at);
  add `resume_version_id` FK to `user_applications`; outcome timestamps.
- **Scan function:** on scan, upsert the version row (hash already computed at
  `free-keyword-scan/index.ts:1497`); expose prior-version scores for diffing.
- **Account page:** version picker in the tracker's add-application form;
  per-version stats row (sent / interviews).
- **ProSubscriptionCard:** rewrite `PRO_PERKS` + header copy to the four
  pillars above; badge "All-access" → "Workspace".
- **Analytics:** aggregate outcome rates per version (server-side, opt-in for
  any cross-user claims).

## Gate checklist (owner)

- [ ] ≥1 organic Pro subscriber, or
- [ ] funnel data showing Pro-card views → checkout starts at a rate where
      better conversion would matter (i.e., traffic exists, framing is the
      bottleneck)

## Owner decision (2026-07-05)

Gate remains **closed**: zero Pro subscribers so far. Owner requirement for
whenever this ships: the all-access element — every paid product *and every
future product* included — must stay a headline part of the Pro pitch, not a
footnote. Amend pillar ordering accordingly at build time: workspace loop
first, "everything we make, now and future, included" as the co-headline
rather than fine print. Until the workspace features exist, the live
`ProSubscriptionCard` copy stays on the all-access framing (do not advertise
unbuilt features).
