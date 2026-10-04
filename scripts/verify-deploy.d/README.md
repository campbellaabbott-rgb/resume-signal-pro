# verify-deploy section files

Each `*.sh` file here is sourced by `scripts/verify-deploy.sh` just before it
prints `done.`, in name order. Name files `<NN>-<topic>.sh` (for example
`20-email-relays.sh`). Every line a file prints must start with `PASS`,
`FAIL` or `INFO`, every probe must be read-only, and the helpers `J`, `R`,
`MC`, `probe` and `title`, plus `$K`, `$B`, `$SITE` and `$UA`, are in scope.
