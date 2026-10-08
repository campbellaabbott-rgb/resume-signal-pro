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
- The draft goes to counsel. Section 8 of the draft lists 11 counsel
  questions (Q-C1 to Q-C11) and 8 owner decisions (Q-O1 to Q-O8).
- Four clauses describe behaviour the code does not have yet. Ship the
  fix, or keep the clause's "we may" wording:
  - L6-29: one trial per customer.
  - L6-18: a refund or dispute revokes what it bought.
  - L9-13 / L6-07: every never-sent pass application is given back.
  - L6-30: deleting an account cancels the plan.
- "A trial does not unlock consumables" becomes true only when
  `wave2/entitlements` (550f9e2b) is merged and deployed.
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
