# DRAFT FOR COUNSEL: Terms of Service, section 4, and the clauses it touches

> **DRAFT FOR COUNSEL. This is not legal advice, and it is not approved or live.**
> Prepared 2026-10-07 from the code at `origin/main` `acd64c4c` for register
> item L4-07 (with the date fix from 2.33 / L1-09). The live page,
> `src/pages/Terms.tsx`, is **unchanged**. Nothing here applies until counsel
> has reviewed it, the owner has answered the questions in section 8, and the
> code items marked **NOT YET** have shipped or their clauses have been
> reworded.

---

## 0. How to read this draft

- **Baseline.** Every "Source" line cites `file:line` at `acd64c4c` (2026-10-07).
  Line numbers drift, so re-find the code before you rely on a number.
- **Code status.** Every clause carries one of these:
  - **ENFORCED**: the code does this today.
  - **PARTIAL**: the code does some of it. The gap is named.
  - **NOT YET**: the code does not do it. Before the clause goes live, either
    the named register item ships, or the clause is reworded as a right we
    may exercise by hand (the wording below already does this where it can).
  - **DASHBOARD**: this is decided in Stripe's dashboard, not in the
    repository, and nobody can verify it from code. The owner must confirm it.
- **Brackets.** `[Counsel: ...]` and `[Owner: ...]` mark choices or wording
  for those people to settle. Each one points to a numbered question in
  section 8.
- **Numbers.** The text below prints today's values so it reads cleanly. On
  the live page every price, hour and count must be **interpolated from the
  mirrors** (`PRODUCTS`, `SUBSCRIPTIONS` and `PASS` in `src/config/products.ts`),
  as `Terms.tsx:11` already does for the Full Analysis price, and never typed.
  Copy goes false when the thing it describes changes in another runtime
  (memory: claim drift). Schedule A maps every number to its constant.
- **AI hosts.** This page is read by job seekers, so the proposed text names
  only Claude, ChatGPT and Claude Code as examples of AI hosts.

## 1. Why section 4 has to change (L4-07)

Measured on `acd64c4c`:

1. `Terms.tsx:57` says the Service "costs $5.00 USD per analysis". That
   figure is interpolated from `PRODUCTS.fullAnalysis`. Checkout actually
   sells 13 one-off products from $2 to $59, two monthly plans and a $29
   pass (Schedule A).
2. The page says nothing about subscriptions, automatic renewal, the
   Agent plan's 7-day free trial, trial conversion or cancellation. A search
   of `Terms.tsx` for subscri/renew/trial/cancel finds nothing.
3. `Terms.tsx:60` reads "All sales are final ... you are waiving any right to
   a refund". The pass page promises refunds the Terms do not mention: a
   second pass payment is refunded (`en.json:5112`), and an application that
   was never sent goes back to the pass (`en.json:5092`).
4. `Terms.tsx:102` sets the liability floor at "{fullAnalysisPrice}", which
   is $5 today. Any change to that product's price silently changes the
   contract's liability cap.
5. `Terms.tsx:75` forbids "automated scripts, bots, or other means to access
   the Service". The site sells and gives away exactly that kind of access:
   a keyed data API (`/v1`), an MCP server for AI agents (with or without a
   key), and the Agent Pass, which exists for an agent to use. Every API and
   MCP customer is technically in breach.
6. `Terms.tsx:29` renders "Last updated" as `new Date()`, so every visitor
   is told the terms changed today (2.33 / L1-09). Section 18 (`Terms.tsx:178`)
   promises the date marks real changes.

---

## 2. Proposed text: section 4

> Heading: keep the existing key `terms.sections.payment`
> ("4. Payment Terms and Refund Policy"), which is already translated in nine
> locales. A new heading means changing all nine locale files (see section 9).

### 4.1 Prices and payment

> Prices for each paid tool, plan and pass are shown on our Pricing page and
> at checkout. The price shown at checkout when you buy is the price you pay.
> Schedule A lists the prices in force on the "Last updated" date of these
> Terms. Prices are in US dollars, except that the Full Resume Analysis may be
> offered in your local currency, in which case the amount and currency shown
> at checkout apply. Payments are processed by Stripe; we never receive or
> store your full card number. By completing a purchase you authorise us,
> through Stripe, to charge your payment method the amount shown at checkout
> and, for a plan, the recurring charges described in 4.3. Promotion codes,
> where offered, apply only on the terms stated when the code is issued.
> [Counsel: taxes, Q-C7.]

- Source: catalogue `src/config/products.ts:7-214`, `SUBSCRIPTIONS` `:270-273`,
  `PASS` `:283-294`. Pricing page `src/pages/Pricing.tsx:48-92, 179-221`.
  USD everywhere except Full Analysis, which is converted through a
  hand-maintained rate table (`supabase/functions/create-checkout/index.ts:108`
  `BASE_PRICE_USD`, `:114` `CURRENCY_RATES`, `:171` `calculateAmount`). Every
  checkout is a hosted Stripe Checkout session (`stripe.checkout.sessions.create`),
  so card details never reach our servers. Every checkout sets
  `allow_promotion_codes: true` (for example
  `create-agent-checkout/index.ts:126`). `automatic_tax` is disabled
  (`create-pass-checkout/index.ts:211`, `create-product-checkout/index.ts:295`).
- Code status: **ENFORCED** for currency and promotion codes. **DASHBOARD**
  for the nine products billed through a stored Stripe Price object: their
  charged amount is whatever that object says (Schedule A, A-3).

### 4.2 One-off tools and scan credits

> Each one-off tool listed in Schedule A is a single purchase of a single
> deliverable, paid once. It never renews and never starts a subscription.
> Deliverables are generated and delivered digitally, normally straight after
> payment. Scan credits are sold in packs. One credit is used by one résumé
> scan; credits do not expire, have no cash value, and cannot be transferred
> or exchanged. Where a product's page makes a promise specific to that
> product (for example, the 30-day re-optimisation offered with ATS Defense
> Complete), that promise is part of these Terms for that purchase. If you
> are not satisfied with a paid tool's output, contact us (for example by
> replying to your purchase receipt) and we will regenerate the deliverable
> free of charge.

- Source: products `src/config/products.ts:9-213`. Scan credits
  `:24-36` ("Never expires" `:34`), `create-scan-pack-checkout/index.ts:22`
  (`PRICE_PER_CREDIT_CENTS`) and `:28-29` (`MIN_CREDITS`/`MAX_CREDITS`). ATS
  Defense guarantee `products.ts:125`. The regeneration remedy is the owner
  decision of 2026-07-10 (commit `8193b4b8`), already live at
  `Terms.tsx:60` and `en.json:2804`.
- Code status: **ENFORCED** as copy. Whether every deliverable is actually
  delivered is a separate matter (Q-O6).

### 4.3 Subscription plans: Pro and the Apply Agent plan

> **(a) Plans.** We offer two monthly plans: **Pro**, at US$45 a month, and
> the **Apply Agent plan** (also called the Morning Queue), at US$99 a month.
> The Apply Agent plan includes everything in Pro. What each plan includes is
> described on the Pricing page at the time you subscribe.
> [Owner: whether Pro includes the Full Resume Analysis, Q-O3.]
>
> **(b) Automatic renewal.** A plan renews automatically each month until you
> cancel. At the start of each monthly period we charge the plan's
> then-current price to the payment method on file. Your first period starts
> when you subscribe, or, for the Apply Agent plan, when its free trial ends
> (4.4).
>
> **(c) One plan at a time.** An account holds one plan at a time. To move
> from Pro to the Apply Agent plan, first cancel Pro. Pro stays on until the
> end of the period you have already paid for and is not charged again, and
> you can start the Apply Agent plan straight away.
>
> **(d) Failed payments.** If a renewal payment fails, our payment processor
> may retry it, and we may suspend the plan's features until it succeeds.
> While a payment is due, update your card from *Manage subscription*. We
> will not sell you a second plan while one is unpaid.
>
> **(e) Cancellation.** You can cancel at any time from your Account page
> (*Manage subscription*) or by writing to us. Cancellation takes effect at
> the end of the current monthly period: you keep the plan's features until
> then and are not charged again. We do not refund the unused part of a
> period, except where the law requires it. [Counsel: Q-C3.]
> [Owner, pick one, Q-O5. **Option A** (today's code): *Deleting your Resume
> Booster account does not cancel a plan. Cancel the plan first.*
> **Option B** (once L6-30 ships): *Deleting your account cancels any plan
> immediately.*]
>
> **(f) Price changes.** We may change a plan's price for future periods. We
> will email you at least [30] days before a new price applies to you; if you
> do not want to pay it, cancel before it takes effect. [Counsel: Q-C4.]

- Source: prices `products.ts:270-273`, which mirror
  `supabase/functions/_shared/pro.ts:15` (`PRO_PRICE_CENTS`) and
  `supabase/functions/_shared/agent.ts:21` (`AGENT_PRICE_CENTS`); pinned by
  `src/test/pricing-truth.test.ts`. Monthly interval:
  `create-subscription-checkout/index.ts:93` and
  `create-agent-checkout/index.ts:116`. Agent includes Pro:
  `_shared/agent.ts:1-6` and `_shared/pro.ts:198-213`. One plan at a time and
  the Pro-to-Agent switch: `_shared/subscription-standing.ts:136-148`
  (`checkoutVerdict`); its message at `:162-166` already tells the buyer that
  Pro "stays on until its period ends". Failed payments: the
  `needs_payment_update` verdict (`:144-145`). Cancellation: the
  *Manage subscription* button opens Stripe's billing portal
  (`create-portal-session/index.ts:55-58`); the Pro card says "Cancel anytime
  from your account" (`src/components/ProSubscriptionCard.tsx:18-25`). Access
  continues to the period end plus one day of grace (`_shared/pro.ts:184-191`).
- Code status: **ENFORCED** for (a)-(d). **DASHBOARD** for (e): whether the
  portal cancels at the period end or at once, and whether it prorates, is a
  portal setting (A-5). **NOT YET** for (e) Option B (L6-30). **NOT YET** for
  (f): no price-change email exists. Changing `AGENT_PRICE_CENTS` would also
  de-entitle every existing Agent subscriber, because entitlement matches on
  amount (`_shared/agent.ts:50-74`). A price change is therefore an
  engineering task as well as a notice.

### 4.4 The Apply Agent plan's free trial

> **(a) Length and conversion.** The Apply Agent plan starts with a free trial
> of 7 days. We collect a payment method when you start the trial. Unless you
> cancel before the trial ends, it becomes the paid plan automatically when
> the trial ends: we charge US$99 then, and every month after, as in 4.3.
>
> **(b) One trial per customer.** Each customer may have one free trial of the
> Apply Agent plan, once. We may treat a trial as already used if the account,
> email address or payment method has had one before. In that case the plan
> starts without a trial and is charged from the first day.
> [Owner/Counsel: Q-O1 and Q-C5.]
>
> **(c) What a trial includes.** During the trial you get the plan's ongoing
> features: for example, the morning shortlist, unlimited scans and batch
> application prep. **A trial does not include consumables.** One-off tools
> and scan credits that a paid plan includes are not issued during the trial;
> they become available with the first paid period. During the trial, the
> daily number of applications the agent may send for you is lower than on
> the paid plan, and your account shows the limit.
>
> **(d) Cancelling during the trial.** If you cancel during the trial you are
> not charged. [Owner: you keep the trial until its scheduled end / the
> trial ends at once. This depends on the portal setting, A-5.]

- Source: 7 days, `create-agent-checkout/index.ts:134`
  (`trial_period_days: 7`). The card is collected because the session does
  not set `payment_method_collection`, so Stripe's subscription-mode default
  applies (A-4). Trial copy: `en.json:4725` ("7 mornings free, then $99/month
  ... Cancel anytime."). Lower send limit during the trial:
  `_shared/agent-entitlement.ts:215-222` (`TIER_SEND_CEILING`, trialing vs
  active). No consumables during a trial: `_shared/pro-standing.ts` on branch
  `wave2/entitlements`, commit `550f9e2b` (not yet on main).
- Code status:
  - (a) **ENFORCED**, plus **DASHBOARD** for the card collection.
  - (b) **NOT YET** (L6-29). Every Agent checkout that passes
    `checkoutVerdict` currently gets a trial. The verdict refuses a trial only
    to an address whose plan is live or owes money
    (`subscription-standing.ts:141-145`). Until L6-29 ships, (b) works only as
    a right we exercise by hand: refuse, or bill from day one. The wording
    above does not promise that the refusal is automatic.
  - (c) **PARTIAL**. The lower send limit is enforced on main. "No
    consumables" is enforced only once `wave2/entitlements` is merged and
    deployed. On main today, a trialing plan counts as Pro for the whole paid
    catalogue (L6-29).

### 4.5 The Agent Pass

> **(a) What it is.** The Agent Pass is a one-time purchase (US$29). For six
> hours, an AI agent you connect (such as Claude, ChatGPT or Claude Code) can
> use our MCP server at raised limits and request up to 10 job applications
> for you. It never renews and does not start a subscription.
>
> **(b) Bound to your account.** You must be signed in to buy a pass. The pass
> belongs to the account that bought it and cannot be transferred, shared or
> resold.
>
> **(c) When the clock starts.** The six hours start at your agent's first call
> to our MCP server that uses your agent key or sign-in, not at purchase.
> Checking your key's status or reading our guide does not start the clock.
> Once started, the clock runs for six hours whether or not your agent is
> working, and cannot be paused.
>
> **(d) A pass you never start.** A pass that is never started expires
> [30] days after purchase and is not refunded. [Owner/Counsel: Q-O4 and
> Q-C6.]
>
> **(e) Applications.** Each application request of your agent's that we
> accept uses one of the pass's applications. A request we refuse uses none.
> If an accepted application is never sent, its application is given back.
> [Owner, pick one, Q-O2. **Option A** (what the pass page says): *it is
> returned to the pass while the pass is open*. **Option B**: *it is refunded
> in money, pro rata, after the pass closes*.] Applications requested before
> the clock ends are finished after it ends. Applications and time you do not
> use lapse when the clock ends and are not refunded.
>
> **(f) No stacking.** An account can hold one open pass (not started, or
> running) at a time. You cannot buy a pass while your account has an active
> Apply Agent plan, which already includes applications. If two pass payments
> complete for one account at the same moment, only one creates a pass and we
> refund the other.
>
> **(g) Limits and scope.** While a pass is running, the higher call limits
> shown on the pass page apply to your agent's calls to our MCP server. A pass
> is not a data licence: it does not unlock the paid features of our data API
> (5, second carve-out).

- Source: price, hours, applications, shelf life, product type and tier are
  in `supabase/functions/_shared/pass.ts:24, 31, 38, 56, 63, 69`, mirrored by
  `products.ts:283-294` and pinned by `pricing-truth.test.ts`. "Never
  renews": the receipt line at `create-pass-checkout/index.ts:192-194`, the
  pricing line `Pricing.tsx:219` and `en.json:5069`. Sign-in required and
  bound to `user_id`: `create-pass-checkout/index.ts:107-118`, and migration
  `20260917100000_a_pass_is_a_row_with_its_own_clock.sql` (header, "BOUND TO
  user_id"). Activation: `20260917230000_a_look_at_the_guide_does_not_start_the_clock.sql:141-151`
  (`p_endpoint <> '/mcp/key_status' AND NOT LIKE '/mcp/resource/%'`; the clock
  is `now() + session_hours`). The overlay applies only to `/mcp/` endpoints
  (`:83`). Shelf life `pass.ts:49-56`, shown to buyers in `en.json:5070`.
  Applications: `en.json:5092` and the refund trigger
  `20260917170000_a_pass_refund_is_the_pipelines_to_give_never_the_owners_to_take.sql:45-53`.
  Lapse and finishing late: `en.json:5105-5106`. No stacking: the partial
  unique index `20260917100000_...sql:81-83`, refused at checkout while a pass
  is open (`create-pass-checkout/index.ts:149-175`) or a plan is active
  (`:140-147`). Duplicate refund promise: `en.json:5112`, rendered at
  `src/pages/AgentPass.tsx:226`. Raised limits: `pass.ts:46-47`. Not a `/v1`
  licence: `supabase/functions/_shared/key-tier.ts:25-33` (the pass reads as
  unpaid to every `/v1` gate).
- Code status:
  - (a)-(c), (f) and (g) **ENFORCED**.
  - (d) **ENFORCED** as a lazy close, but `pass.ts:49-55` marks 30 days
    as a **GUESS** with no measured basis.
  - (e) **PARTIAL**. Applications go back only for the statuses the trigger
    recognises. Some never-sent applications are not given back
    (L9-13, L6-07, both open in the agents-api group). Option B has no code
    at all.
  - The duplicate refund in (f) is **manual**: the owner is alerted and
    refunds by hand.

### 4.6 Refunds, chargebacks and disputes

> **(a) One-off tools and scan credits.** Each tool is generated and delivered
> straight away, so sales of one-off tools and scan credits are final.
> The exceptions are a right to a refund or to cancel that the law gives you
> and that cannot be waived, and the remedies in this section 4. If a paid
> deliverable is not delivered, contact us and we will deliver it or refund
> it. [Owner: Q-O6. Counsel: Q-C2.]
>
> **(b) Plans and the trial.** See 4.3(e) and 4.4(d).
>
> **(c) The Agent Pass.** See 4.5(d) to (f).
>
> **(d) What a refund or dispute does.** If we refund a payment, or a payment
> is reversed, charged back or disputed, we may withdraw what that payment
> bought. That can mean closing an Agent Pass with its remaining time and
> applications, removing unused scan credits, withdrawing access to the
> tool, or ending the plan or its current period.
>
> **(e) Contact us first.** Please write to resumeboostersupp@gmail.com before
> you dispute a charge with your bank; we can usually fix the problem faster.
> If you dispute a charge without contacting us, we may suspend your access to
> paid features while the dispute is open, and we may contest it with
> evidence of what we delivered. [Counsel: Q-C8.]

- Source: "final" plus the regeneration remedy, `Terms.tsx:59-61` (owner
  decision 2026-07-10, `8193b4b8`). Chargeback wording today:
  `Terms.tsx:62-64`. Refunds and disputes in the webhook:
  `supabase/functions/stripe-webhook/index.ts:1109-1137` (it alerts the owner
  and changes no entitlement). The schema already allows `close_reason
  'refunded'` on a pass
  (`20260917100000_...sql:78`), but nothing writes it.
- Code status: (d) **NOT YET** (L6-18). Nothing is revoked automatically. The
  clause says "may" so the owner can apply it by hand, which works only if
  the webhook endpoint is subscribed to `charge.refunded` and
  `charge.dispute.created` (**DASHBOARD**, A-6).
- **Removed on purpose:** "By completing a purchase, you acknowledge and agree
  that you are waiving any right to a refund" (`Terms.tsx:60`). See Q-C2
  before keeping any waiver.

---

## 3. Conforming changes outside section 4

### 3.1 Section 5: the bots clause gets a carve-out

Replace the bullet at `Terms.tsx:75` ("Not use automated scripts, bots, or
other means to access the Service") with:

> Not use automated scripts, bots, scrapers or crawlers to access the Service,
> except:
> (i) our data API, using an API key issued to you, within its published rate
> limits and quotas;
> (ii) our MCP server, through an AI assistant or agent you connect (such as
> Claude, ChatGPT or Claude Code), within its published limits, with or
> without an agent key or sign-in, including under an Agent Pass or the Apply
> Agent plan;
> (iii) the apply agent included in the Apply Agent plan or used under an
> Agent Pass, acting on your instructions; and
> (iv) search-engine crawlers that follow our robots.txt.
> You may not use these interfaces to get around a limit, to collect what an
> interface does not return, or to share one key or pass among several people.

Replace the bullet at `Terms.tsx:77` ("Not resell, redistribute, or
commercially exploit our analysis services without written consent") with:

> Not resell, redistribute or commercially exploit our tools or our data
> without our written consent, except as the terms published with our data
> API allow. [Owner: Q-O7.] Data from a source whose own terms forbid
> redistribution is not available through the API and may not be
> redistributed from the site.

- Source: the free key and its limits `src/pages/DataApi.tsx:216-243` and
  `src/config/mcp-tools.ts:139-141` (unkeyed MCP calls per network address,
  and the free-key daily quota). Licensing tiers, including commercial use as
  a custom licence: `DataApi.tsx:301-327`. The federal feed is excluded from
  `/v1` because of its terms of use: `supabase/functions/public-api/index.ts:168`
  and `DataApi.tsx:50`. The crawler policy is `public/robots.txt`.
- Code status: **ENFORCED** (the limits, the exclusion and the robots rules
  all exist). The carve-out only brings the contract into line with what is
  sold.

### 3.2 Section 8: drop the $5 liability floor

At `Terms.tsx:102`, replace "OR {fullAnalysisPrice}, WHICHEVER IS GREATER"
with "OR US$[100], WHICHEVER IS GREATER" [Counsel: amount, or no floor; Q-C9],
and remove the interpolation, so that a product price can never move the cap
again.

### 3.3 The "Last updated" date (2.33 / L1-09)

This is **not applied**: the live page stays untouched until counsel
signs off. Proposed implementation:

```ts
// src/config/legal.ts (new). Change a date only with a real change to the text.
export const TERMS_LAST_UPDATED = "2026-07-10";   // git: 8193b4b8, the last change to Terms.tsx
export const PRIVACY_LAST_UPDATED = "2026-10-04"; // git: ad07204f, the last change to Privacy.tsx
```

Render it at `Terms.tsx:29` and `Privacy.tsx:28` with
`new Date(TERMS_LAST_UPDATED).toLocaleDateString(dateLocale, { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })`.
**`timeZone: "UTC"` is required.** A date-only ISO string parses as UTC
midnight, so without it every visitor in the Americas would see the day
before. When the new section 4 goes live, set `TERMS_LAST_UPDATED` to the
adoption date. Prove the fix with a behaviour test: render each page under
two different fake system dates and expect the same date text. That test
fails on today's `new Date()`. The other half of 2.33 is separate
(seo-content-i18n, L1-09): `/terms` and `/privacy` have no prerendered page,
so crawlers get the homepage.

---

## 4. Schedule A: price list at `acd64c4c`

| Product | Price (USD) | Billing | Where the charged amount lives | Mirror |
|---|---|---|---|---|
| Full Resume Analysis | 5 | one-off; local currency possible | `create-checkout/index.ts:108` + rate table `:114` | `products.ts:13` |
| Scan credits | 0.20 each, 3-100 per purchase (pack of 10 = 2) | one-off | inline, `create-scan-pack-checkout/index.ts:22,28-29`; or Stripe Price `price_1Sgv2T...` via product checkout | `products.ts:28-30` |
| Interview Coach | 5 | one-off | Stripe Price object (**DASHBOARD**) | `products.ts:43` |
| Career Path Simulator | 5 | one-off | Stripe Price object (**DASHBOARD**) | `products.ts:58` |
| Basic Keyword Fix (hidden from pricing, still purchasable) | 3 | one-off | Stripe Price object (**DASHBOARD**) | `products.ts:75, 230-235` |
| Cover Letter Generator | 4 | one-off | Stripe Price object (**DASHBOARD**) | `products.ts:87` |
| Premium Resume Package | 12 | one-off | Stripe Price object (**DASHBOARD**) | `products.ts:100` |
| ATS Defense Complete (30-day re-optimisation) | 15 | one-off | Stripe Price object (**DASHBOARD**) | `products.ts:116, 125` |
| Career Snapshot | 25 | one-off | Stripe Price object (**DASHBOARD**) | `products.ts:133` |
| Graduate Game Plan | 10 | one-off | Stripe Price object (**DASHBOARD**) | `products.ts:150` |
| Apply Assistant | 7 | one-off | inline, `create-product-checkout/index.ts:72-76` | `products.ts:167` |
| Freelance Boost | 29 | one-off | inline, `create-product-checkout/index.ts:77-81` | `products.ts:184` |
| Freelance Boost: Transition Pro | 59 | one-off | inline, `create-product-checkout/index.ts:82-86` | `products.ts:203` |
| Pro | 45 / month | auto-renewing, no trial | inline, `_shared/pro.ts:15`; `create-subscription-checkout/index.ts:85-106` | `products.ts:271` |
| Apply Agent plan (Morning Queue) | 99 / month after a 7-day free trial | auto-renewing | inline, `_shared/agent.ts:21`; trial `create-agent-checkout/index.ts:134` | `products.ts:272` |
| Agent Pass | 29 once: 6 hours, 10 applications, expires unused after 30 days | one-off, never renews | inline, `_shared/pass.ts:24,31,38,56` | `products.ts:283-294` |

Free and unpaid access the carve-out covers: the résumé scan, the job
board, unkeyed MCP calls (a daily allowance per network address), and a free
data-API key. The values are in `src/config/mcp-tools.ts:139-141`; the
free-key retirement rules are at `DataApi.tsx:240`.

## 5. Where each term comes from (summary)

| Clause | Primary source | Status |
|---|---|---|
| 4.1 prices, currency, promo codes | `products.ts`, `create-checkout:108-171`, checkouts' `allow_promotion_codes` | ENFORCED / DASHBOARD (Price objects) |
| 4.2 one-off, credits never expire, regeneration | `products.ts:9-213, 34`; `Terms.tsx:60`; `en.json:2804` | ENFORCED |
| 4.3(a) plans and prices | `_shared/pro.ts:15`, `_shared/agent.ts:21`, `pricing-truth.test.ts` | ENFORCED |
| 4.3(b) monthly auto-renewal | `create-subscription-checkout:93`, `create-agent-checkout:116` | ENFORCED |
| 4.3(c) one plan, Pro to Agent | `subscription-standing.ts:136-148, 162-166` | ENFORCED |
| 4.3(d) failed payment | `subscription-standing.ts:144-145, 155-161` | ENFORCED |
| 4.3(e) cancel via portal, at period end | `create-portal-session:55-58`; `ProSubscriptionCard.tsx:24` | DASHBOARD |
| 4.3(e) account deletion | `delete-account` (no Stripe call), L6-30 | NOT YET (Option B) |
| 4.3(f) price-change notice | none | NOT YET |
| 4.4(a) 7-day trial, converts | `create-agent-checkout:134`; `en.json:4725` | ENFORCED + DASHBOARD |
| 4.4(b) one trial per customer | L6-29 | NOT YET |
| 4.4(c) trial: no consumables; lower send limit | `wave2/entitlements` `550f9e2b`; `agent-entitlement.ts:215-222` | PARTIAL |
| 4.5(a)-(c) pass, account-bound, clock at first call | `pass.ts`; `create-pass-checkout:107-118`; `20260917230000:141-151` | ENFORCED |
| 4.5(d) unstarted pass expires | `pass.ts:49-56` (GUESS); `en.json:5070` | ENFORCED (value provisional) |
| 4.5(e) applications given back | `20260917170000:45-53`; `en.json:5092`; L9-13, L6-07 | PARTIAL |
| 4.5(f) no stacking, duplicate refunded | index `20260917100000:81-83`; `create-pass-checkout:140-175`; `en.json:5112` | ENFORCED (refund manual) |
| 4.5(g) not a data licence | `key-tier.ts:25-33`; overlay `20260917230000:83` | ENFORCED |
| 4.6(d) refund or dispute revokes | `stripe-webhook:1109-1137`; L6-18 | NOT YET (manual) |
| 5 carve-out | `DataApi.tsx`, `mcp-tools.ts:139-141`, `public-api:168`, `robots.txt` | ENFORCED |
| 8 liability floor | `Terms.tsx:102` | text only |
| Last-updated date | `Terms.tsx:29`, `Privacy.tsx:28` | proposed, not applied |

## 6. Assumptions

- **A-1.** The contracting party is "Resume Booster", as the live Terms say.
  No legal entity, address or registration number appears anywhere in the
  repository (Q-C1).
- **A-2.** Prices are what `products.ts` mirrors. `pricing-truth.test.ts`
  proves this only for Pro, the Agent plan and the pass.
- **A-3.** The nine products billed through stored Stripe Price objects
  (Schedule A) are charged the amounts `products.ts` shows. The repository
  cannot prove this; only the Stripe dashboard can.
- **A-4.** The Agent checkout collects a card for the trial, because it does
  not set `payment_method_collection` and Stripe's default for subscription
  mode is to collect one. `_shared/subscription-standing.ts:34` mentions a
  `paused` state for a trial that ended without a payment method, so the
  owner should confirm in the dashboard.
- **A-5.** The Stripe billing portal is configured to cancel **at the period
  end, without proration**. The code assumes this (the switch message says
  Pro "stays on until its period ends", `subscription-standing.ts:165`), but
  the setting lives in the dashboard.
- **A-6.** Refunds are issued by the owner by hand in Stripe. The webhook
  only reports `charge.refunded` and `charge.dispute.created`, and Stripe sends
  them only if the endpoint is subscribed (`stripe-webhook/index.ts:1115-1116`).
- **A-7.** "One trial per customer", "a trial does not unlock consumables",
  "refunded or disputed payments revoke what they bought", and the pass's
  activation, length, no-stacking and given-back applications are the
  positions this draft was asked to take (wave-2 brief, consistent with the
  owner decision recorded in commit `550f9e2b`). The owner should confirm
  each one in Q-O1, Q-O2 and Q-O6.
- **A-8.** The Terms body stays English-only, as `terms.legalNotice` says in
  every locale. Only headings are translated.
- **A-9.** The pass is used through the MCP server only. Its raised limits
  do not apply to `/v1` (`20260917230000:83`; `key-tier.ts`).
- **A-10.** Stripe receipts (a dashboard setting) are the only purchase or
  subscription confirmation a customer gets. The webhook sends no
  subscription acknowledgment email of its own (Q-C3).

## 7. Out of scope here, noticed in passing (not drafted)

- **Section 3** describes only "AI-powered resume analysis". It does not
  mention the job board, the apply agent that submits applications in the
  user's name, the data API or the MCP server. The agent needs an
  authority-and-responsibility clause: who is responsible for what is
  submitted, the review and auto modes, and the CAPTCHA boundary
  (`en.json:4885`).
- **Section 10** names no arbitration provider ("a mutually agreed-upon
  arbitration service").
- **Section 18** makes changes "effective immediately upon posting". That
  conflicts with the notice period proposed in 4.3(f) for plan prices.

---

## 8. Open questions

### For counsel

- **Q-C1. Contracting entity.** Who is the seller (entity, address,
  registration)? Several consumer-protection regimes require these on the
  order page.
- **Q-C2. Withdrawal right and "all sales final".** The site ships German,
  French, Dutch, Spanish, Portuguese and British-English locales, so EU and UK
  consumers buy here. Can digital deliverables be final without an express
  consent to immediate supply, and an acknowledgment that the right of
  withdrawal is lost, captured at checkout (which today has no such step)?
  Is the current "you are waiving any right to a refund" sentence
  (`Terms.tsx:60`) enforceable anywhere we sell?
- **Q-C3. Automatic-renewal laws.** Do 4.3 and 4.4 satisfy state
  automatic-renewal laws (for example California's, as amended)? That covers
  clear and conspicuous disclosure next to the purchase button (the Pro and
  Agent cards say "Cancel anytime" and "7 mornings free, then $99/month", but
  the checkout itself is Stripe's page), affirmative consent, an
  acknowledgment that states how to cancel (A-10), online cancellation (the
  Stripe portal), and any refund duty for the unused part of a period.
- **Q-C4. Price-change notice.** What notice period and method suit a monthly
  plan, and does section 18's "effective immediately upon posting" need a
  carve-out for prices?
- **Q-C5. One trial per customer.** Can we enforce it on the account, email
  and payment-method fingerprint? Can a trial already granted be ended early
  or converted to billing when we find a prior trial?
- **Q-C6. The unstarted-pass expiry.** Is forfeiting an unstarted prepaid
  pass after a fixed period (30 days today) lawful without a refund, and
  does any prepaid or stored-value rule apply?
- **Q-C7. Tax.** `automatic_tax` is off and no tax line appears. Are listed
  prices tax-inclusive, and does selling digital services to US states, the
  EU or the UK create collection duties that the Terms (and checkout) must
  reflect?
- **Q-C8. Chargebacks.** Is "suspend paid features while a dispute is open"
  (proposed) better than today's "permanent suspension" (`Terms.tsx:63`)?
  Is either enforceable against a consumer exercising a card-network right?
- **Q-C9. Liability floor.** What amount, if any, should replace the floor
  that tracked the $5 product price (3.2)?
- **Q-C10. Language.** Is an English-only contract (A-8) enforceable against
  consumers using the de/fr/es/nl/pt/hi/tl interfaces, or must the body be
  translated?
- **Q-C11. The data-API and MCP carve-out.** Should the API and MCP terms be
  a separate document incorporated by reference (as section 15 allows),
  rather than living inside section 5?

### For the owner (business decisions the text depends on)

- **Q-O1. Trial policy (L6-29).** Confirm one free Agent trial per customer,
  ever, keyed on account, email and payment method. If someone has already
  had a trial: refuse the plan, or sell it without a trial (as drafted)?
  Ship the checkout change before 4.4(b) goes live.
- **Q-O2. Pass applications never sent (L9-13).** Option A (returned to the
  pass while it is open, as the pass page says) or Option B (refunded in
  money afterwards)? Under Option A, an application given back after the
  clock ends is worth nothing. Either way, the code must give back every
  never-sent case (L9-13, L6-07) before 4.5(e) goes live, or the clause must
  narrow to the cases the trigger handles.
- **Q-O3. Is the Full Analysis part of Pro (L3-04)?** The Pro checkout
  description says "Every Resume Booster tool included — full analysis ...",
  and `create-checkout` still charges a Pro member $5.
- **Q-O4. Shelf life of an unstarted pass.** 30 days is a placeholder
  (`pass.ts:49-55`). Fix the number before it is contractual.
- **Q-O5. Account deletion (L6-30).** Should deleting an account cancel the
  plan (Option B, needs code), or should the Terms tell the customer to
  cancel first (Option A, true today)?
- **Q-O6. Refund and dispute policy (L6-18).** Confirm that a refund or
  dispute revokes what it bought, and say what happens to a pass, unused
  credits, tools and plans. Confirm the non-delivery remedy in 4.6(a)
  ("deliver or refund"). Subscribe the webhook endpoint to `charge.refunded`
  and `charge.dispute.created`.
- **Q-O7. Data-API licence.** May free-key data be used commercially? Is
  attribution required (the press tier requires it, `DataApi.tsx:534`)? Where
  are the API terms published?
- **Q-O8. Stripe dashboard checks.** Confirm A-3 (Price object amounts), A-4
  (trial collects a card), A-5 (portal cancels at the period end with no
  proration), and whether Stripe sends trial-ending reminders and receipts.

## 9. Implementation notes, for after sign-off

1. Ship the code that the **NOT YET** clauses depend on first (L6-29, L6-18,
   L9-13/L6-07, L6-30), or keep those clauses in their "we may" wording.
2. Interpolate every number from `PRODUCTS`, `SUBSCRIPTIONS` and `PASS`. Add a
   behaviour test, in the style of `src/test/pricing-truth.test.ts`, that
   renders the Terms page and fails if a printed price, hour or count differs
   from the Deno constants that charge (`_shared/pro.ts`, `_shared/agent.ts`,
   `_shared/pass.ts`, `create-agent-checkout`'s trial length).
3. Keep the heading key `terms.sections.payment`, or change it in all nine
   locale files and keep `src/i18n/index.test.ts` passing.
4. Apply 3.3 (the static date) in the same change, set to the adoption date.
5. Add a changelog entry in `src/i18n/changelog/` for the new terms, and
   email existing subscribers about the change if counsel advises it (Q-C4).
