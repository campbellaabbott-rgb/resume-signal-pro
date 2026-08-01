# Where the apply worker runs

Everything else in the paid apply agent was already built. `apply-agent` writes
packets, the worker claims and sends them, `wake-sender` pokes a host,
`assertPaidSession` gates it. **Nothing ran the worker.** A customer who bought
it got packets prepared, marked `ready`, and queued forever.

That was not a bug. `wake-sender` was written host-agnostic so the hosting
decision could be made deliberately rather than by accident. This is the
decision: **GitHub Actions**, because the worker needs a real browser (so it
cannot live in a Deno edge function) and does nothing at all most of the time
(so paying for an idle VM is the wrong shape). It is a job, not a service.

`WORKER_IDLE_EXIT_MS` already existed for exactly this — the worker drains the
queue and exits.

## Activating it

Two places, five secrets. None of them can be set by the agent that wrote this;
the `service_role` key in particular is yours to handle.

**1. GitHub → Settings → Secrets and variables → Actions**

| secret | value |
|---|---|
| `SUPABASE_URL` | the project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the worker reads private résumés from storage and writes submission outcomes — the anon key cannot do either |

**2. Supabase → Edge Functions → Secrets**

| secret | value |
|---|---|
| `WORKER_START_URL` | `https://api.github.com/repos/<owner>/<repo>/actions/workflows/apply-worker.yml/dispatches` |
| `WORKER_START_TOKEN` | a fine-grained PAT, **Actions: read and write**, scoped to this repository only |
| `WORKER_START_BODY` | `{"ref":"main"}` |

`WORKER_START_BODY` is the one that is easy to miss. GitHub's dispatch endpoint
requires a `ref` and rejects a body without one with **422**. The default body
is a human-readable reason, which suits a plain webhook and which GitHub will
not accept. Wake failures are swallowed by design, so getting this wrong shows
up only as applications never being sent — which is why there is a test pinning
it.

## Checking it works

Probe the behaviour, not the reachability. These two states look identical from
outside and mean opposite things:

```bash
gh workflow run apply-worker.yml -f reason=smoke
gh run list --workflow=apply-worker.yml --limit 3
```

A run that starts, logs `idle 60s — stopping`, and exits green means the worker
booted, authenticated against Supabase, found an empty queue and shut down
properly. A run that exits green in ten seconds having logged nothing means it
never reached Supabase at all.

To confirm the wake path rather than the workflow, release a packet and watch
for a run appearing within a few seconds without anyone pressing anything.

## What happens when the wake fails

Nothing is lost. The workflow also runs on a 30-minute schedule, so a packet
whose wake never fired is sent late rather than never. That is the same
reasoning as `wake-sender` swallowing its own errors: waking is an optimisation
on a system that already drains without it, and a broken webhook must never be
able to stop applications being prepared.

## Cost

Free tier. Public repositories get unlimited Actions minutes; private ones get
2,000 a month. At the configured 20-second gap between submissions plus about a
minute of boot, a run that sends ten applications costs roughly four minutes.

## Things to know before this carries real load

- **The gap between submissions is politeness, not throughput.** `APPLY_GAP_MS`
  is 20s in the workflow. A burst from one datacentre IP is exactly what makes a
  legitimate tool look like an attack, and the four vendors the agent drives
  have no bot wall — that is a courtesy to respect, not an absence to exploit.
- **One worker at a time**, enforced by the `concurrency` group. Two runners
  claiming the same queue is not corruption (claims are atomic) but it doubles
  the request rate for no gain.
- **Screenshots of uncertain outcomes** upload as a run artifact with 14-day
  retention. Those are cases where the agent submitted but could not confirm,
  and they are the evidence for whether an application actually landed.
- **The service key is in GitHub's secret store.** That is a real trust
  decision about where customers' résumé data can flow, and it should be a
  conscious one. Fly Machines is the alternative if it should not touch GitHub.
