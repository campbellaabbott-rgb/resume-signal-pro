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
