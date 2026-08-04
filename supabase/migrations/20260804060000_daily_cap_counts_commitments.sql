-- THE CAP IS COUNTED CORRECTLY AND ENFORCED IN ONLY ONE PLACE.
--
-- 20260803120000 already fixed the COUNTING half: agent_sent_today counts
-- applications submitted today PLUS ones released today and not yet sent, so a
-- slow worker can no longer make the budget look untouched. That part is done
-- and this migration deliberately does not restate it.
--
-- What is still missing is ENFORCEMENT AT THE LAST GATE. decideRelease consults
-- the cap when apply-agent prepares. agent_claim_submission — the moment a
-- worker actually takes a packet to type into an employer's form — does not.
--
-- WHY THAT STILL MATTERS with the counting fixed. Release-time checking binds
-- release-time facts, and two things happen after it:
--
--   * A packet released at 23:50 under yesterday's budget is claimable at
--     00:10. It counts against yesterday's released_at window and against
--     today's submitted_at window — so it is charged to a day that is over,
--     and today's cap never sees it.
--   * A backlog that built while the sender was offline drains the moment it
--     returns. Every one of those was released legitimately on some earlier
--     day, and nothing between them and an employer re-asks whether that is
--     still within what the candidate asked for today.
--
-- IT IS THE STOP BUTTON SHAPE. apply-agent honoured `active`; apply-broker did
-- not; a paused agent drained anyway. The broker's own comment calls it "the
-- LAST gate before a packet is handed to a worker that will type it into an
-- employer's form" and re-checks entitlement, `active` and consent there for
-- exactly this reason. The cap was never added to that list.

CREATE OR REPLACE FUNCTION public.agent_claim_submission(p_worker text, p_lease_minutes integer DEFAULT 10)
RETURNS SETOF public.agent_submissions
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.agent_submissions s
  SET claimed_at = now(), claimed_by = p_worker, attempts = s.attempts + 1
  WHERE s.id = (
    SELECT c.id FROM public.agent_submissions c
    WHERE c.status = 'ready'
      AND c.released_at IS NOT NULL
      AND c.submitted_at IS NULL
      -- The cancel window (20260804050000). NULL is immediately claimable, so
      -- rows written before that column existed are not frozen.
      AND (c.claimable_at IS NULL OR c.claimable_at <= now())
      AND (c.claimed_at IS NULL OR c.claimed_at < now() - make_interval(mins => GREATEST(p_lease_minutes, 5)))
      AND c.attempts < 3
      -- THE CAP, AT THE LAST GATE.
      --
      -- Counts what has actually been SUBMITTED today — deliberately NOT the
      -- in-flight figure agent_sent_today returns, because the packet being
      -- claimed is itself in flight and would count against itself. Every
      -- packet would then be refused, producing a total outage that looks
      -- exactly like an empty queue.
      --
      -- Reads the candidate's own cap. The tier ceiling is applied by
      -- apply-agent at release; the job here is to stop a backlog draining past
      -- what they asked for, not to re-derive entitlement.
      --
      -- THE PARENTHESES ARE LOAD-BEARING. `A AND B OR C` parses as
      -- `(A AND B) OR C`, so writing this as a bare AND/OR would make every
      -- condition above optional whenever the cap clause was true — a gate that
      -- silently hands out unreleased, already-submitted and over-attempted
      -- packets. My first draft did exactly that; src/test/daily-cap-end-to-end
      -- scans for a top-level OR at paren depth zero because of it.
      AND (
        -- No mandate row means no cap to enforce here. Refusing would strand
        -- every packet whose mandate was deleted, permanently.
        NOT EXISTS (
          SELECT 1 FROM public.agent_mandates m WHERE m.user_id = c.user_id
        )
        OR (
          SELECT count(*) FROM public.agent_submissions d
           WHERE d.user_id = c.user_id
             AND d.submitted_at >= date_trunc('day', now())
        ) < COALESCE(
          (SELECT m.auto_apply_daily_cap FROM public.agent_mandates m
            WHERE m.user_id = c.user_id),
          2147483647
        )
      )
    ORDER BY c.released_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING s.*;
$$;

REVOKE ALL ON FUNCTION public.agent_claim_submission(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_claim_submission(text, integer) TO service_role;

COMMENT ON FUNCTION public.agent_claim_submission(text, integer) IS
  'Hands one ready packet to a worker. Gates: released, unsubmitted, past its cancel window, '
  'not leased, under 3 attempts, AND under the candidate''s daily cap counted on submissions '
  'today. The cap check is here as well as at release because release-time enforcement can be '
  'outrun by timing — a backlog draining across midnight is charged to a day that is over.';
