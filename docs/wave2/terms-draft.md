# Wave 2: terms-draft (L4-07)

## What changed
- `docs/legal/terms-section-4-draft.md`: the proposed replacement for Terms
  of Service section 4, built from the products mirror. It also covers the
  section 5 bots carve-out, removal of the section 8 $5 liability floor, and
  the static "Last updated" date (2.33 / L1-09). It is marked DRAFT FOR
  COUNSEL.
- `scripts/verify-deploy.d/67-wave2-terms-draft.sh`: a single INFO line.

## Deploy
Nothing deploys. There are no functions, no migrations and no frontend
change. The live `/terms` page (`src/pages/Terms.tsx`) is untouched by
design.

## Tell the owner
- The draft goes to counsel. Section 8 of the draft lists 12 counsel
  questions (Q-C1 to Q-C12) and 11 owner decisions (Q-O1 to Q-O11).
- Seven clauses describe behaviour the code on main does not have yet.
  Ship the fix, or reword the clause, before it goes live:
  - 4.4(b), L6-29: one trial per customer.
  - 4.4(c), L6-29: a trial includes no consumables.
  - 4.4(c), L6-08: a trial includes batch application prep. On main a
    trialing subscriber gets a 402 from `generate-apply-package`.
  - 4.6(d), L6-18: a refund or dispute revokes what it bought.
  - 4.5(e), L9-13 / L6-07: every never-sent pass application is given back.
  - 4.3(e) Option B, L6-30: deleting an account cancels the plan.
  - 4.3(f): we email subscribers before a price change. No mailer exists,
    and the clause is a firm "we will". The owner commits to sending it by
    hand, or a mailer ships first (Q-O10).
- Two point-of-sale problems to settle in the same release:
  - Q-O9: two product bullets have no code behind them, "Priority
    processing" and the ATS Defense "30-day guarantee". 4.2 no longer makes
    product-page promises part of the Terms, but counsel may say they bind
    anyway (Q-C12).
  - Q-O11: the trial copy ("7 mornings free, then $99/month — everything in
    Pro included") contradicts 4.4(b) and 4.4(c).
- `wave2/entitlements` is not merged. It carries commits that address
  L6-29 and L6-08 (`550f9e2b`, `6b29fc45`), L6-18 (`122e0143`), L9-13
  (`e991862b`) and L3-04, the Full Analysis in Pro (`7411c247`, which
  answers Q-O3). When it merges and deploys, re-tag those clauses against
  the new code before adoption.
- Check these four things in the Stripe dashboard (they are A-3 to A-6 in the
  draft):
  - the amounts on the stored Price objects;
  - that the trial collects a card;
  - that the portal cancels at the end of the period with no proration;
  - that the webhook is subscribed to `charge.refunded` and
    `charge.dispute.created`.

## Rollback
Not applicable, because nothing is live.

## Measure
Nothing to measure until the approved text ships. When it does, use the
implementation notes in section 9 of the draft: an interpolation test that
pins every printed number to the charging constants, and a behaviour test
for the static date.
