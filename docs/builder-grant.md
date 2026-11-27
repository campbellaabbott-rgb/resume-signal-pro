# Granting the Builder API by hand

**Status: PENDING the owner's answer to OD-A8.** Run nothing on this page until
the owner has said yes. Until then, a written request is answered the way the
/data-api card answers it today: the plan is not open yet, and the request is
counted.

The database half is migration
`supabase/migrations/20261206120000_a_builder_key_is_granted_by_a_written_request_and_recorded.sql`.
`src/test/a-builder-grant-is-the-servers-alone-and-recorded.test.ts` holds it to
what this page says.

## The policy (OD-A8, recommended, not yet answered)

- A **written request** for the Builder API gets a **30-day free Builder
  grant** on the requester's existing key.
- Each grant counts as **one price-test signal** for the planned $49 card
  (`src/config/builder-plan.ts`).
- The reply asks whether they would pay $49 a month for it. **Billing is built
  when one requester says yes.** Until then there is no checkout, no Stripe
  link and no buy button. The card stays "planned".

A written request is an email. The card's link opens one with the subject
`Builder API plan`, so requests can be counted by subject. A call, a chat
message or a comment is not a written request: it leaves nothing to point to.

## What a grant gives, and for how long

| | Free key (as issued) | During a grant |
|---|---|---|
| Tier the API reads | `free` | `builder` |
| Calls a minute | 60 | 120 |
| Calls a day | 1,000 | 5,000 |
| Ranked search (`engine=ranked`) | 402 | yes |
| `/v1/changes` closure history | 3 days | 180 days |
| `POST /v1/fit` | 25 a day (confirmed key) | 1,000 a day |

- The numbers are the card's (`BUILDER_PROPOSED` in
  `supabase/functions/public-api/index.ts`).
- A grant never lowers a limit: a key already above 120 a minute or 5,000 a day
  keeps its own number.
- The rest follows from the tier. `isPaidKeyTier("builder")` is already true in
  `_shared/key-tier.ts`, so no gate changes.
- After **30 days** the key goes back to exactly the limits it had before the
  grant. The grant row stores them.

## Steps

Every statement runs in **More > Cloud > SQL editor**. The SQL editor and the
server's service role are the only callers that can run the function. The
publishable key and a signed-in user get "permission denied".

### 1. Find the requester's key

```sql
SELECT id, key_prefix, name, tier, rate_per_min, daily_quota, created_at, last_used_at
  FROM public.api_keys
 WHERE owner_email = lower('<the address the request came from>')
   AND revoked_at IS NULL;
```

- **No row:** reply with the /data-api link to get a free key, and grant once
  it exists. A grant goes on a key, never on an address.
- **More than one row:** use the key the requester names by its prefix
  (`rb_live_...`). If they named none, ask which one.

### 2. Grant

```sql
SELECT public.api_key_grant_tier('<key id>', 'builder', 'written request YYYY-MM-DD by email; price test');
```

- **The note says why.** Give the request's date and channel. **Never** put the
  requester's name or address in the note. The key row already links them,
  and deleting an account blanks that row's address but would leave a note as
  it is.
- **The answer** looks like this:

  ```json
  {"ok": true, "reason": "granted", "grant_id": "...", "key_tier": "builder",
   "rate_per_min": 120, "daily_quota": 5000, "expires_at": "...", "lapsed": 0}
  ```

  `lapsed` counts other grants that this call closed because they were past
  their expiry (see step 5).
- **A refusal changes nothing.** It answers `"ok": false` with a reason:

  | reason | what to do |
  |---|---|
  | `unknown_key` | Check the id from step 1. |
  | `key_revoked` | The requester rotated or lost the key. Use their live one. |
  | `not_free` | The key is on another tier already. Do not grant over it. |
  | `already_granted` | The answer carries the open grant and its `expires_at`. |
  | `note_required`, `note_too_long` | Write a note of 1 to 500 characters. |
  | `unknown_tier` | The tier is `builder` (grant) or `free` (revoke). |

### 3. Reply to the requester

Tell them:

- the key prefix;
- the Builder limits;
- the date the grant ends (`expires_at`);
- that it is free while the plan is planned.

Then ask the price-test question: **would you pay $49 a month for this?** Keep
their answer with the request thread. **The first yes is the trigger for
building billing.**

### 4. Revoke early (only if needed)

```sql
SELECT public.api_key_grant_tier('<key id>', 'free', '<why, e.g. requester asked to stop>');
```

- The key's pre-grant limits come back, and the grant row records the end:
  `end_reason = 'revoked'`, who ran it, the note, and `restored = true`.
- Something else may have changed the key's limits since the grant (by hand,
  for instance). Then the revoke leaves the key as it is, still closes the
  grant, and records `restored = false`. Look at the key before doing
  anything else.
- A revoke with nothing open answers `no_open_grant` and changes nothing.

### 5. Expiry is automatic

No cron, and no step for the operator. A grant ends in one of two ways:

- **The key's first allowed call after the expiry.** That call still runs on
  the Builder limits; the next call runs on the old limits. The row says
  `end_reason = 'expired'`, `ended_by = 'expiry'`.
- **The next grant or revoke call, for a key that has made no call since.**
  Every `api_key_grant_tier` call closes the overdue grants first.

Until one of those happens, an idle key's row still reads `builder`. It serves
nothing, because it is not being called. To read whether a grant is in force,
use `api_tier_grants`, not `api_keys.tier`.

### 6. If the requester rotates their key

A new key from /data-api is a free key, and the grant stays with the old,
revoked key. To carry it over:

1. Revoke the old grant with the note `moved to the rotated key`.
2. Grant the new key with the note `same request as grant <old grant id>`.

The new grant starts its own 30 days. Shorten it only by revoking it early.

## Reading the record

`public.api_tier_grants` keeps one row per grant and is never deleted. The
service role can read it; only the function and the expiry trigger write it.

Grants in force:

```sql
SELECT g.id, k.key_prefix, g.granted_at, g.expires_at, g.granted_by, g.note
  FROM public.api_tier_grants g JOIN public.api_keys k ON k.id = g.key_id
 WHERE g.ended_at IS NULL AND g.expires_at > now()
 ORDER BY g.expires_at;
```

The price-test count. A moved grant is the same request, so it is not counted
twice:

```sql
SELECT count(*) FILTER (WHERE note NOT LIKE 'same request as grant %') AS written_requests_granted,
       count(*) AS grants,
       count(*) FILTER (WHERE end_reason = 'revoked') AS revoked,
       count(*) FILTER (WHERE end_reason = 'expired') AS expired
  FROM public.api_tier_grants;
```

One key's history:

```sql
SELECT granted_at, expires_at, granted_by, note, ended_at, end_reason, ended_by, end_note, restored
  FROM public.api_tier_grants WHERE key_id = '<key id>' ORDER BY granted_at;
```

## Never

- **Never `UPDATE api_keys SET tier = 'builder'` by hand.** It leaves no
  record, never ends, and the expiry only ends grants the function made.
- **Never grant without a written request.** The count is the price test, and
  a grant nobody asked for is a false signal.
- **Never take money for a grant.** No checkout exists, and the card stays
  non-selling (`src/test/the-builder-card-asks-for-interest-and-sells-nothing.test.tsx`).
- **Never put an address or a name in a note** (step 2).
