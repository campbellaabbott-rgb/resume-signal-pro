# Wave 2: entitlements (deploy note)

Branch `wave2/entitlements`. These are the owner decisions approved on 2026-10-04 ("go with your recommendations"). Wave 1 shipped only the parts that needed no decision. The register is `platform-debug-2026-10-04`. The verifier is `scripts/verify-deploy.d/65-wave2-entitlements.sh`.

| Register | What changes for a customer |
| --- | --- |
| **L3-04** (with L6-24, L13-08) | The Full Analysis is now part of Pro. A signed-in member whose plan can mint gets it with no $5 charge: create-checkout mints a `pro_` grant and analyze-resume redeems it once. The Morning Queue line moves to the Agent plan card. Pricing-truth now fails if a Pro perk names something only the agent's price unlocks. |
| **L6-08** | There is now one "is Pro" rule, `_shared/pro-standing.ts`, re-exported from `_shared/pro.ts`. It reads both caches by the verified account. A row is live while its status is active or trialing, with one day of grace. Every caller uses it: create-product-checkout, verify-product-purchase, generate-freelance-boost, generate-apply-package, free-keyword-scan, check-subscription, create-checkout and analyze-resume. `isProCached` is gone. |
| **L6-29** (with L13-43) | A trial unlocks the plan's ongoing features (unlimited scans, batch prep), but mints no consumables: no `pro_` grant, no scan pack. The agent trial is offered once per customer, checked by account id, by address, and by every Stripe customer behind the address. Every surface that sells the agent says the trial is "for first-time subscribers" and takes its length and price from the mirror of the checkout's constants: the board's two sentences, the Morning Queue paywall and its checkout button, and the prerendered /agent page. The welcome banner after checkout names a trial only when that checkout carried one (create-agent-checkout puts `welcome=trial` or `welcome=1` on the success URL). create-subscription-checkout offers no trial. |
| **L6-18** | A refund in full, or any dispute, takes back what the payment bought. Each of these happens once per payment intent: the session's claim, the Agent Pass and its unsent applications, unspent scan credits, and the Pro grants a subscription payment minted. A refunded or disputed subscription is cancelled immediately. A partial refund is reported to the owner and revokes nothing. Stripe keeps calling a refunded session "paid", so every function that verifies a session with Stripe refuses one named in `payment_revocations`: verify-product-purchase, analyze-resume, generate-freelance-boost, generate-ats-defense, generate-apply-package, and agent-pass-status (which would otherwise grant a pass from a refunded second-pass payment once the first pass closed). |
| **L9-13** | When an Agent Pass closes, every application it paid for that will not go out on its own is given back: packets that are failed, stale, blocked (unless a learned answer can still send them), held for a release, or exhausted at three attempts, and dismissed or expired queue rows that never became a packet. A request that can still finish is left to finish, as the pass page promises: an approved queue row with no packet (the preparer still prepares it after the clock), a released packet under three attempts, a block an answer can lift. When one of those later ends unsent, its application is given back then. A given-back application that is sent later is charged again. |
| **Mailbox switch** | `mailbox_proof_settings.confirmation_required_since` is now the one switch, for the scan side and the agent gates alike. `EMAIL_CONFIRMED_SINCE` is read only when that row cannot be read. |

## Apply the migrations first, in this order

Apply all three migrations before deploying the functions. Each one checks itself and is safe to re-run: 130000 binds Pro rows to accounts only in the run that adds the column, so a re-run binds nothing (a plan left unbound on purpose stays unbound).

1. `20261008130000_a_plan_is_read_by_the_account_that_bought_it_by_one_rule.sql`
   - Adds `pro_subscribers.user_id` and, in that same run only, binds existing rows to the account that holds each address now.
   - Adds `pro_entitlement_rows(uuid)`.
   - Adds `pro_grants.user_id` and `pro_grants.revoked_at`.
   - Depends on `account_mailbox_proven` and `agent_subscription_rows` from 20261005130000. Both were confirmed present in production on 2026-10-07: they answer anon with 42501.
2. `20261008131000_a_refunded_payment_takes_back_what_it_bought.sql`
   - Adds the `payment_revocations` table, `payment_revoke(...)` and `payment_revoke_credits(text, integer)`.
   - Uses `scan_credit_session_grants` from 20261005120000, which is present.
3. `20261008132000_a_closed_pass_gives_back_every_application_it_never_sent.sql`
   - Adds `agent_passes.settled_at`, `agent_pass_packet_gives_back(agent_submissions)` (the one rule), `agent_pass_settle(uuid)` and five triggers: the settle on close, the two that give back a settled pass's packet or queue row when it later ends unsent (including a retention delete), the stamp carried from a given-back queue row to a packet, and the re-charge on a late send.
   - Settles any pass that is already closed, leaving its approved requests to finish.

None of these functions can be called by a client role. Every one is SECURITY DEFINER, revoked from PUBLIC, anon and authenticated, and granted only to service_role. There is nothing to add to the client-callable census allowlist.

**Why the order matters.** The new functions call `pro_entitlement_rows`. If they deploy before migration 130000 lands, that call errors. The functions handle the error safely:

- create-checkout and create-product-checkout answer 503 to a signed-in buyer rather than charge a member for an included tool.
- check-subscription falls back to the address answer.
- The grant redeemers answer 503.

Anonymous checkouts are unaffected.

## Deploy these functions

| Function | Build | Why |
| --- | --- | --- |
| scan-credits | `scan-credits.2026-10-08.1` | The mailbox switch is the row |
| get-account-data | `get-account-data.2026-10-08.1` | The mailbox switch is the row |
| free-keyword-scan | `free-keyword-scan.2026-10-08.2` | The row switch; Pro is read by account (trial counts) |
| check-subscription | `check-subscription.2026-10-08.1` | Answers the account's standing: `trialing`, `consumablesIncluded`, `linkPending` |
| create-product-checkout | `create-product-checkout.2026-10-08.1` | Grants only when the plan may mint; grants carry `user_id`; 503 if the plan is unreadable |
| create-subscription-checkout | `create-subscription-checkout.2026-10-08.1` | Stamps the buyer's user id on the Pro subscription |
| create-portal-session | `create-portal-session.2026-10-08.1` | First build stamp; its cache refresh binds `user_id` |
| verify-product-purchase | `verify-product-purchase.2026-10-08.2` | Grant re-check by account (`proGrantRefusal`); refuses refunded sessions |
| generate-apply-package | `generate-apply-package.2026-10-08.2` | Batch prep for every live plan, trial included; refuses a refunded session |
| generate-freelance-boost | `generate-freelance-boost.2026-10-08.2` | Grant re-check by account; refuses a refunded session |
| generate-ats-defense | `generate-ats-defense.2026-10-08.1` | Refuses a refunded session (it read the rewritten claim as proof) |
| agent-pass-status | `agent-pass-status.2026-10-08.1` | Grants no pass from a refunded payment |
| create-agent-checkout | `create-agent-checkout.2026-10-08.2` | One trial per customer; the success URL says whether this checkout carried one |
| create-checkout | `create-checkout.2026-10-08.1` | A Pro member's Full Analysis grant |
| analyze-resume | `analyze-resume.2026-10-08.2` | Redeems the `pro_` grant once; refuses refunded sessions |
| stripe-webhook | `stripe-webhook.2026-10-08.2` | Refunds and disputes revoke; binds `user_id` on the Pro cache |

The shared modules also changed: `_shared/pro.ts`, `pro-standing.ts`, `mailbox-proof.ts`, `signed-in-email.ts`, `subscription-standing.ts`, `agent.ts` and the new `payment-revocation.ts`.

- agent-access and create-pass-checkout import `agent.ts`. They only gained new exports and behave the same, so a redeploy is optional.
- Deploy the frontend with the same commit. It carries the Pro card copy, the Agent card's Morning Queue line, the trial sentences (board, Morning Queue paywall and button, welcome banner), the pass page's refunded line, the Success page tracking change, and the prerendered /agent page.

## Tell the owner

1. **Stripe dashboard step for L6-18.** Add `charge.refunded` and `charge.dispute.created` to the webhook endpoint's events. Until then Stripe sends neither event, and refunds revoke nothing. The verifier prints this as INFO because no read can check it.
2. **Refund policy as built.**
   - A refund in full or any dispute revokes the purchase.
   - A partial refund only emails you. Refunding the rest later triggers the revocation.
   - A refunded subscription is cancelled at once, not at the period end.
   - The same payment is never taken back twice: a redelivery, or a dispute after a refund, is a no-op.
3. **Trial policy as built.**
   - **What a trial includes:** unlimited scans, batch application prep, and the agent itself, which sends at most 5 a day while trialing (that limit was already in place).
   - **What it does not include:** free one-off tools or scan packs. A trialing member who buys one pays the price.
   - **The judgment call.** Batch prep counts as an ongoing feature, because it mints no grant. If you would rather it count as a consumable, the change is one line in generate-apply-package: use `.consumables` instead of `.pro`.
4. **One trial per customer.** It is keyed on the account id, the account's address, and every Stripe customer behind that address. The payment-method fingerprint is **not** used yet. Someone with a new address, a new account and the same card still gets a trial.
5. **Mailbox switch.** The closing step is now one statement, run after turning on "Confirm email": `UPDATE public.mailbox_proof_settings SET confirmation_required_since = now();`. You do not need to set `EMAIL_CONFIRMED_SINCE`. If it is already set, it only matters when that row cannot be read.
6. **Plans bound to accounts.**
   - Every existing Pro row whose address belongs to an account was bound to that account by the migration.
   - From now on, the signed-in Pro checkout stamps the buyer.
   - If you create a subscription in the Stripe dashboard, add `metadata.user_id` with the buyer's auth user id to the subscription. Otherwise the plan answers only a Google or Apple sign-in for that address, or a confirmed mailbox after the switch. The Pro card says "not linked to this account yet" in that case.
7. **Old grants.** A `pro_` grant minted before the deploy and not yet redeemed has no `user_id`, so it is refused with "Open the tool again while signed in". The member gets a new grant in one click.

## Rollback

Functions:

- Redeploy the previous builds. These are listed in section 45; for example, `create-product-checkout.2026-10-05.2`.
- The new columns and functions are additive. The old builds never call them.

Migrations:

- **Do not drop** `payment_revocations`. It is the record of what was taken back.
- To stop revocation, redeploy the old stripe-webhook. It ignores the table.
- To stop settling passes, run `DROP TRIGGER agent_pass_settle_on_close_trg ON public.agent_passes; DROP TRIGGER agent_pass_settle_late_packet_trg ON public.agent_submissions; DROP TRIGGER agent_pass_settle_late_row_trg ON public.agent_queue; DROP TRIGGER agent_pass_settle_late_row_gone_trg ON public.agent_queue;`. The re-charge and carry-over triggers are harmless without them.
- `pro_subscribers.user_id` is only read by the new builds.

## What to measure after the deploy

- **`bash scripts/verify-deploy.sh`, section 65.** Every line should be PASS. The sixteen build lines need the functions deployed. The four `42501` lines and the table line need the migrations applied. The six English-strings lines and the crawler's /agent line need the frontend published.
- **Section 45:** the build lines for the functions above now read 2026-10-08. This is still a PASS, because build_ge accepts later builds.
- **Agent trial:** `checkout_starts.metadata->>'trial'` on `create-agent-checkout` rows. Expect `false` for a returning customer.
- **First refund after the Stripe events are subscribed:** a `payment_revocations` row, and an owner email whose subject starts "Refund issued" or "Dispute opened" and lists what was taken back.
- **Agent Passes:** `agent_passes.settled_at` is set on every closed pass. `applications_used` falls on close by the applications that will not go out on their own, and again later as a waiting request ends unsent. An approved `agent_queue` row with no packet keeps `pass_refunded_at` NULL after its pass closes, and is still prepared (apply-agent's `prepared` count for pass-only mandates).
- **Not covered:** a worker that dies holding a packet on its third attempt leaves it `ready` with a lapsed lease and writes nothing more, so nothing gives that application back unless the close came after the lease lapsed.
- **Refunded sessions:** a generator call with a refunded session answers 402 with `refunded: true`; the pass page shows "This payment was refunded, so it does not open a pass."
