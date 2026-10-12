/**
 * WHICH HOST ANSWERS A GREENHOUSE TENANT.
 *
 * A board token carrying the `eu~` prefix is a tenant hosted in Greenhouse's
 * EU region, and its public board API answers only on the EU host: asking the
 * US host for one of its postings reads as "no public form" for every EU
 * posting. The board's own copy lives in job-board/normalize.ts; this one is
 * for readers outside job-board (the apply_myself form reader in
 * _shared/application-form.ts), which must never import job-board's files.
 * The function below is held BYTE-IDENTICAL to normalize.ts's by
 * src/test/the-greenhouse-host-rule-is-one-rule-in-two-files.test.ts until
 * job-board imports it from here.
 */
export function greenhouseApi(token: string): { host: string; token: string } {
  return token.startsWith("eu~")
    ? { host: "boards.eu.greenhouse.io", token: token.slice(3) }
    : { host: "boards-api.greenhouse.io", token };
}
