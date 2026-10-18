# verify-deploy section files

Each `*.sh` file here is sourced by `scripts/verify-deploy.sh` just before it
prints `done.`, in name order. Name files `<NN>-<topic>.sh` (for example
`20-email-relays.sh`). Every line a file prints must start with `PASS`,
`FAIL` or `INFO`, every probe must be read-only, and the helpers `J`, `R`,
`MC`, `probe`, `build_ge` and `title`, plus `$K`, `$B`, `$SITE` and `$UA`, are
in scope.

- A build check is `build_ge FN "$HEADER" DATE MIN`: this build or a later one.
  A line that pins one exact build, or a date pattern, reads FAIL the day the
  function is rebuilt for any other reason.
- `probe FN '{json}'` asks for a refusal with a GET, which PostgREST runs in a
  read-only transaction: 42501 is PASS, and a function that turns out to be
  callable can only fail (25006), never write. Give it typed values; a GET
  cannot carry null.
- Writers are never called to watch them refuse. Prove a writer closed from
  the catalogue (section 40's `client_callable_census`) or by a GET probe.
- A PASS needs something that could have made it FAIL: a line computed over
  nothing (0 of 0, an empty object, a refusal with no reason) is INFO.
- One run at a time: the script holds `/tmp/vd_verify_deploy.lock.d` while it
  runs, because sections share fixed `/tmp/vd_*` files.
- The whole run is piped through `scripts/verify-deploy-tally.mjs` (S12-163):
  a section that prints no verdict, or hits a script error (a stack frame, a
  thrown error), is a FAIL in the tally, and every PASS is void when section
  0's positive control (job-board status answering as itself) did not pass.
  The script exits 1 on any FAIL. Guard every `JSON.parse` of an answer: a
  gateway's HTML body must print a FAIL that shows it, never crash the
  section into silence.
- A file a section reads back from `/tmp` is removed before the step that
  writes it, so a failed read can never hand the section an earlier run's
  answer (S12-165).
