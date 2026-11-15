# REFRESH PASS: terms-section-4-draft.md, re-baselined 2026-11-15

**Read this before the draft.** It re-scopes
`docs/legal/terms-section-4-draft.md` (prepared 2026-10-07 against `acd64c4c`)
to the product line and the code as they stand at `origin/main` `5ef5e1a7`.

The draft is still the drafting work. This memo says which of it survives, and
cuts the open-question list from **11 owner questions to 4**. Nothing here is
legal advice and nothing here is approved; it changes what counsel is asked, not
what the Terms say.

Register: S14X-013 (bug round 2026-11-08), owner-gated. Live state confirmed
2026-11-15 with a Googlebot UA: `/terms` contains **0** occurrences of "renew",
"cancel", "subscription" and "withdraw", and **1** of "per analysis".
`TERMS_VERSION` is `2026-07-10` in both `src/config/terms.ts` and
`_shared/checkout-policy.ts` (which restamps 19 importers).

---

## 1. What changed under the draft: the apply pivot

The draft was written four days before the owner decision of **2026-10-11**
that retired the Agent products. The retirement is implemented as **switches,
not deletions** — `supabase/functions/_shared/apply-agent-switch.ts`:

```
export const APPLY_AGENT_ON: boolean = false;
export const AGENT_PRODUCTS_ON_SALE: boolean = false;
export const APPLY_ASSISTANT_ON_SALE: boolean = false;
```

`create-agent-checkout`, `create-pass-checkout` and `create-product-checkout`'s
`applyAssistant` row answer **HTTP 410** with a machine-readable reason and one
localized sentence (`_shared/apply-agent-retired.ts`). `SUBSCRIPTIONS.agent`
("Morning Queue", $99/month, `trialDays: 7`) and `PASS` ($29, six hours, ten
applications, 30-day shelf life) are **still declared** in
`src/config/products.ts` — because the switch, not the config, is what retired
them, and because past buyers keep what they bought.

**Consequence for the Terms.** A section that sets out purchase terms for a
product whose checkout returns 410 describes something nobody can buy. That is
the same defect in the other direction as the one section 4 exists to fix.

## 2. Section-by-section verdict

| Draft section | Verdict | Why |
|---|---|---|
| **4.1** Prices and payment | **KEEP** | Applies to everything still sold. Interpolate from `PRODUCTS`/`SUBSCRIPTIONS` per Q-C2. |
| **4.2** One-off tools and scan credits | **KEEP, re-check the list** | Live, but the catalogue has moved: `HIDDEN_PRODUCT_IDS` now carries `applyAssistant` (retired) plus the 2026-10-12 product-line cuts, whose checkouts answer 410 from `_shared/product-cuts.ts`. The clause must cover *sold today* and *bought before* separately. |
| **4.3** Subscription plans: Pro **and the Apply Agent plan** | **NARROW to Pro** | Pro ($45/month) is live. Every Agent-plan sentence describes a 410. |
| **4.4** The Apply Agent plan's free trial | **CUT** | The plan is not on sale; a trial for it cannot be entered. |
| **4.5** The Agent Pass | **CUT as purchase terms, REPLACE with a holders clause** | Not purchasable. But holders exist and keep what they bought, so the Terms need a short clause for *existing* passes — not the six-page purchase, trial and forfeiture machinery. |
| **4.6** Refunds, chargebacks and disputes | **KEEP** | Live, and its webhook dependency is now satisfied (§4 below). |
| **3.1** bots-clause carve-out | **KEEP** | Unaffected. |
| **3.2** drop the $5 liability floor | **KEEP, now more urgent** | A $5 floor never fitted a $45/month plan. |
| **3.3** the "Last updated" date | **KEEP** | Still the 2.33 / L1-09 fix. |

Cutting 4.4 and 4.5's purchase machinery removes roughly 160 lines
(draft 205–367) and, with them, four of the eleven owner questions.

## 3. The eleven owner questions, re-judged

**Moot — the product is not on sale (switch `false`, checkout 410):**

- **Q-O1** Agent trial policy (one trial per customer, and what happens to
  someone who already had one).
- **Q-O2** Pass applications never sent — returned to the pass, or refunded in
  money. *Partly survives:* nothing new is sold, but if any pass was open when
  the switch went off, the holders clause in 4.5 must say what happened to it.
  That is a one-sentence question, not the A/B it was.
- **Q-O4** Shelf life of an unstarted pass (the 30-day placeholder).
- **Q-O11** Trial sales copy (`agentQueue.payBoundary` and friends).

**Resolved in code since the draft — state it as fact, do not ask:**

- **Q-O3** *Is the Full Analysis part of Pro?* **Yes.** `create-checkout` no
  longer charges a Pro member for it: "Never a charge for an included tool"
  (`:551`), and the double-charge the question described is gone (`:473`).
- **Q-O5** *Does deleting an account cancel the plan?* **Yes — Option B is
  implemented.** `delete-account` reads the account's plans, **cancels them via
  `stripe.subscriptions.cancel` before anything else is deleted**, refuses with
  503 if Stripe is unreadable ("refusing rather than leaving a plan billing"),
  and answers 409 with portal instructions when the address holds a
  subscription not linked to the account. The Terms should state this, not ask
  it.
- **Q-O6, webhook half** *Subscribe the endpoint to `charge.refunded` and
  `charge.dispute.created`.* **Done** — `stripe-webhook` handles
  `charge.refunded`, `charge.dispute.created`, `invoice.payment_failed` and
  `customer.subscription.deleted`.
- **Q-O9** *Product-page promises with no code behind them.* **Gone.**
  "Priority processing", "30-day guarantee" and "re-optimize guarantee" no
  longer appear in `products.ts`. The question's instruction to audit every
  other bullet still stands as hygiene, but it blocks nothing.

**Genuinely open — these four are the owner's list:**

- **Q-O6, policy half.** What a refund or a dispute revokes: confirm it takes
  back what it bought, and say what happens to unused credits, tools and plans.
  Confirm the "deliver or refund" remedy in 4.6(a). *Wording, not code.*
- **Q-O7. Data-API licence.** May free-key data be used commercially? Is
  attribution required (the press tier requires it, `DataApi.tsx:534`)? Where
  are the API terms published?
- **Q-O8. Stripe dashboard confirmations.** Price object amounts, whether the
  portal cancels at period end without proration, and which Stripe emails are
  on. Nobody can verify these from code — and **S14X-086 is the same kind of
  item**, so settle them in one sitting in the dashboard.
- **Q-O10. Price-change notice (4.3(f)).** **No mailer exists** —
  `_shared/email-templates` holds `auth-parts.tsx`, `auth-strings.ts` and
  `email-change-notice.tsx`, and nothing for a price change. Either commit to
  mailing every subscriber by hand at least 30 days before a new price applies,
  or ship a mailer, or reword (f) before adoption.

## 4. What this does to the draft's own gates

The draft's header blocks adoption until counsel has reviewed it, the owner has
answered section 8, **and the NOT YET clauses have shipped**. The draft counted
13 NOT YET and 16 DASHBOARD clauses. Four of the five Q-O items resolved above
were NOT YET dependencies, and every NOT YET clause that sits inside 4.4 or 4.5
leaves with those sections. The NOT YET list must be re-walked against
`5ef5e1a7` before counsel sees it; this memo re-walked the ones the owner
questions named, not all thirteen.

## 5. Suggested order

1. Cut 4.4 and 4.5's purchase terms from the draft; write the one holders
   clause 4.5 needs. Narrow 4.3 to Pro.
2. Fold the four resolved answers in as statements of fact.
3. Re-walk the remaining NOT YET clauses against `5ef5e1a7`.
4. Owner answers the four questions in §3.
5. Counsel.
6. Then, and only then: `TERMS_VERSION` bump plus the payments-lane code
   (`Terms.tsx`, `src/config/terms.ts`, `_shared/checkout-policy.ts`).

Step 1 is drafting legal text and is deliberately **not** done in this memo.
