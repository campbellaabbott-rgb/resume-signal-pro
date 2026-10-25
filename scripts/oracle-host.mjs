// The Oracle Recruiting Cloud host a catalogue token names, for the census and
// merge tooling that runs under plain node. The board's own builder is
// oracleHost in supabase/functions/job-board/normalize.ts; this is its mirror,
// held equal to it over every catalogue token by
// src/test/a-host-with-no-region-is-still-an-oracle-host.test.ts.
//
// A token is tenant~region~site. The region is EMPTY on a host that has no
// region label: JPMorgan Chase's board is jpmc.fa.oraclecloud.com, token
// jpmc~~CX_1001 (2026-10-25). That host is a DNS alias of an Oracle pod whose
// own name fails the certificate check, so the region-less name is the only
// one that can be fetched.

/** "{tenant}.fa.{region}.oraclecloud.com", or "{tenant}.fa.oraclecloud.com" when the region is empty; "" for any other shape. */
export const oracleHost = (token) => {
  const [t, r, s] = String(token ?? "").split("~");
  return t && s ? `${t}.fa.${r ? r + "." : ""}oraclecloud.com` : "";
};

/** A careers host: one tenant label, "fa", then an optional region label. */
export const ORACLE_HOST_RE = /^([a-z0-9-]+)\.fa\.(?:([a-z0-9-]+)\.)?oraclecloud\.com$/;

/** A careers host back to the catalogue's token shape (the site is not in the host); null for anything else. */
export const oracleTokenOfHost = (host, site = "CX_1") => {
  const m = ORACLE_HOST_RE.exec(String(host ?? "").toLowerCase());
  return m ? `${m[1]}~${m[2] ?? ""}~${site}` : null;
};
