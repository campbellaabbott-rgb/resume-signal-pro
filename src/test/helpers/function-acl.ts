/**
 * WHO CAN EXECUTE EACH PUBLIC FUNCTION, REPLAYED FROM THE MIGRATION LANE.
 *
 * WHY THIS EXISTS. Every earlier exposure guard in this repository answered a
 * narrower question with a regex: "was this name ever revoked from PUBLIC?",
 * "does a definer function taking a uuid have a REVOKE somewhere?". Each was
 * right about its slice and blind to the rest, and the 2026-08 audit still
 * found 107 of 121 SECURITY DEFINER functions open to the publishable key.
 * The question that matters is the END STATE: after every CREATE, DROP, GRANT
 * and REVOKE in the order the database applied them, which functions can the
 * `anon` and `authenticated` roles execute? Only a replay answers that.
 *
 * THE MODEL, and each rule is a fact about this database that has bitten it:
 *
 *   1. A FRESH function in `public` is executable by PUBLIC (Postgres's own
 *      default) AND by anon, authenticated and service_role directly
 *      (Supabase's default privileges). 20260808134902 measured the direct
 *      anon grant on two functions whose PUBLIC grant had been revoked.
 *   2. CREATE OR REPLACE of a function that already exists KEEPS its grants.
 *      A DROP followed by a CREATE starts again from rule 1 -- which is how a
 *      return-type change silently reopens a function that was locked.
 *   3. anon can execute when anon OR PUBLIC holds EXECUTE; same for
 *      authenticated. Revoking PUBLIC alone closes nothing (rule 1).
 *   4. Statements are applied in FILE ORDER and, inside a file, in statement
 *      order. Processing all creates and then all drops makes a
 *      DROP-then-CREATE pair cancel, the trap project_schema_drift records.
 *   5. Comments are removed by a real tokenizer (strings and dollar-quoted
 *      bodies kept whole), because the migration that closes a hole quotes the
 *      hole in its prose.
 *   6. The catalogue-driven DO blocks this repository writes -- `FOR r IN
 *      SELECT ... FROM pg_proc WHERE proname = ... LOOP EXECUTE 'REVOKE/GRANT/
 *      DROP ...' || r.sig` -- are interpreted, not skipped. Skipping them would
 *      report every function locked that way as open, and every function
 *      dropped that way as still present.
 *
 * WHAT IT CANNOT SEE. Functions created outside this folder (Lovable can run
 * DDL directly; project_schema_drift proved one). The migration that closes
 * functions therefore also scans pg_proc at apply time and NOTICEs any
 * anon-executable definer it did not expect.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");

export type Grantee = "PUBLIC" | "anon" | "authenticated" | "service_role";
const GRANTEES: Grantee[] = ["PUBLIC", "anon", "authenticated", "service_role"];

export interface FnState {
  /** Function name, lower case, no schema. */
  name: string;
  /** Identity argument TYPES, normalised, comma-separated: `text,integer`. */
  args: string;
  /** `public.name(args)` -- the key everything else uses. */
  sig: string;
  definer: boolean;
  acl: Record<Grantee, boolean>;
  /** File that holds the LATEST definition. */
  file: string;
  /** File whose CREATE started the current grant history (rule 2). */
  createdIn: string;
  /** Function body (the dollar-quoted string), comments removed. */
  body: string;
  /** RETURNS clause, as written. */
  returns: string;
  language: string;
}

export const anonCan = (f: FnState) => f.acl.anon || f.acl.PUBLIC;
export const authenticatedCan = (f: FnState) => f.acl.authenticated || f.acl.PUBLIC;

// ---------------------------------------------------------------------------
// Tokenising
// ---------------------------------------------------------------------------

/**
 * Split SQL into top-level statements with comments removed. Strings, quoted
 * identifiers and dollar-quoted bodies are copied whole, so a `;` or `--`
 * inside a function body is never mistaken for structure.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === "-" && d === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl;
      cur += " ";
      continue;
    }
    if (c === "/" && d === "*") {
      // Postgres block comments nest.
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; continue; }
        i++;
      }
      cur += " ";
      continue;
    }
    if (c === "'") {
      // E'...' strings honour backslash escapes; plain strings only ''.
      const escaped = /[eE]$/.test(cur) && !/[\w$]$/.test(cur.slice(0, -1));
      let j = i + 1;
      while (j < n) {
        if (escaped && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue; }
          break;
        }
        j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$" && !/[\w$]$/.test(cur)) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const stop = close === -1 ? n : close + tag.length;
        cur += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Index of the paren that closes the one at `open`, honouring quotes. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') {
      const close = s.indexOf(c, i + 1);
      i = close === -1 ? s.length : close;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The quoted strings of the `ARRAY[ ... ]` whose `[` sits at `open`, read
 * quote-aware so a `]` inside a string (`'f(text[])'`) does not end it.
 */
export function arrayLiteralAt(s: string, open: number): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") { j += 2; continue; }
        if (s[j] === "'") break;
        j++;
      }
      if (depth === 1) out.push(s.slice(i + 1, j).replace(/''/g, "'"));
      i = j;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) break; }
  }
  return out;
}

/** Split on commas that are not inside parens, brackets or quotes. */
function splitTopLevel(s: string, sep = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') {
      const close = s.indexOf(c, i + 1);
      const stop = close === -1 ? s.length - 1 : close;
      cur += s.slice(i, stop + 1);
      i = stop;
      continue;
    }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === sep && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Types and signatures
// ---------------------------------------------------------------------------

const TYPE_ALIASES: Record<string, string> = {
  int: "integer", int4: "integer", integer: "integer",
  int8: "bigint", bigint: "bigint",
  int2: "smallint", smallint: "smallint",
  float8: "double precision", "double precision": "double precision",
  float4: "real", real: "real", float: "double precision",
  bool: "boolean", boolean: "boolean",
  varchar: "character varying", "character varying": "character varying",
  char: "character", character: "character", bpchar: "character",
  timestamptz: "timestamp with time zone",
  "timestamp with time zone": "timestamp with time zone",
  timestamp: "timestamp without time zone",
  "timestamp without time zone": "timestamp without time zone",
  timetz: "time with time zone", "time with time zone": "time with time zone",
  time: "time without time zone", "time without time zone": "time without time zone",
  decimal: "numeric", numeric: "numeric",
};

/** One argument TYPE, normalised: aliases resolved, typmods and schema dropped. */
export function normType(t: string): string {
  let s = t.trim().toLowerCase().replace(/"/g, "");
  s = s.replace(/\s+/g, " ");
  let arr = "";
  // `text[]`, `text []`, `integer[][]`, `text array`
  const am = /((\s*\[\s*\d*\s*\])+|\s+array)$/.exec(s);
  if (am) {
    arr = "[]";
    s = s.slice(0, am.index).trim();
  }
  // typmods: varchar(255), numeric(10,2)
  s = s.replace(/\s*\([^)]*\)/g, "");
  // schema prefix: public.x, extensions.vector
  s = s.replace(/^(public|extensions|pg_catalog)\./, "");
  s = TYPE_ALIASES[s] ?? s;
  return s + arr;
}

const TYPE_STARTERS = new Set(["double", "character", "char", "timestamp", "time", "bit", "interval", "national"]);

/** Parse one argument declaration into {mode, type}. */
function parseArg(raw: string): { mode: string; type: string } {
  let a = raw.trim();
  // Drop the default: `= expr` or `DEFAULT expr` at top level.
  const parts = splitTopLevel(a.replace(/\s+DEFAULT\s+/i, "\u0000"), "\u0000");
  a = parts[0];
  const eq = splitTopLevel(a, "=");
  a = eq[0].trim();
  let mode = "in";
  const mm = /^(IN|OUT|INOUT|VARIADIC)\s+/i.exec(a);
  if (mm) {
    mode = mm[1].toLowerCase();
    a = a.slice(mm[0].length).trim();
  }
  const toks = a.split(/\s+/);
  if (toks.length === 1) return { mode, type: normType(a) };
  if (TYPE_STARTERS.has(toks[0].toLowerCase().replace(/"/g, ""))) {
    return { mode, type: normType(a) };
  }
  return { mode, type: normType(toks.slice(1).join(" ")) };
}

/** Identity argument types (OUT excluded), normalised and comma-joined. */
export function identityArgs(argList: string): string {
  return splitTopLevel(argList)
    .map(parseArg)
    .filter((a) => a.mode !== "out")
    .map((a) => (a.mode === "variadic" ? "variadic " : "") + a.type)
    .join(",");
}

/** `public.fn(...)`, `fn(...)` or `"public"."fn"` -> {name, args|null}. */
export function parseSigRef(ref: string): { name: string; args: string | null } | null {
  const s = ref.trim();
  const m = /^((?:"?[A-Za-z_][\w]*"?)\s*\.\s*)?"?([A-Za-z_][\w]*)"?\s*(\(|$)/.exec(s);
  if (!m) return null;
  const schema = m[1] ? m[1].replace(/[\s."]/g, "").toLowerCase() : "public";
  if (schema !== "public") return null;
  const name = m[2].toLowerCase();
  if (m[3] !== "(") return { name, args: null };
  const open = s.indexOf("(", m[0].length - 1);
  const close = matchParen(s, open);
  return { name, args: identityArgs(s.slice(open + 1, close)) };
}

export const sigOf = (name: string, args: string) => `public.${name}(${args})`;

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface Replay {
  fns: Map<string, FnState>;
  /** Every event that touched a signature, for failure messages. */
  history: Map<string, string[]>;
}

function freshAcl(): Record<Grantee, boolean> {
  return { PUBLIC: true, anon: true, authenticated: true, service_role: true };
}

function granteesIn(list: string): Grantee[] {
  return splitTopLevel(list)
    .map((g) => g.replace(/"/g, "").trim())
    .map((g) => GRANTEES.find((x) => x.toLowerCase() === g.toLowerCase()))
    .filter((g): g is Grantee => !!g);
}

function privilegeCoversExecute(privs: string): boolean {
  return /\b(EXECUTE|ALL)\b/i.test(privs);
}

export function replayMigrations(files?: Array<{ file: string; text: string }>): Replay {
  const list = files ?? readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, text: readFileSync(resolve(MIGRATIONS_DIR, file), "utf8") }));

  const fns = new Map<string, FnState>();
  const history = new Map<string, string[]>();
  const note = (sig: string, what: string) => {
    if (!history.has(sig)) history.set(sig, []);
    history.get(sig)!.push(what);
  };

  /** Signatures matching a reference; args === null means every overload. */
  const resolveRef = (name: string, args: string | null): string[] => {
    if (args !== null) {
      const s = sigOf(name, args);
      return fns.has(s) ? [s] : [];
    }
    return [...fns.values()].filter((f) => f.name === name).map((f) => f.sig);
  };

  const applyAcl = (sigs: string[], grant: boolean, grantees: Grantee[], where: string) => {
    for (const s of sigs) {
      const f = fns.get(s);
      if (!f) continue;
      for (const g of grantees) f.acl[g] = grant;
      note(s, `${where}: ${grant ? "GRANT" : "REVOKE"} ${grantees.join(",")}`);
    }
  };

  const handleCreate = (stmt: string, file: string) => {
    const m = /^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+/i.exec(stmt);
    if (!m) return;
    const rest = stmt.slice(m[0].length);
    const open = rest.indexOf("(");
    if (open < 0) return;
    const ref = parseSigRef(rest.slice(0, open) + "()");
    if (!ref) return; // another schema
    const close = matchParen(rest, open);
    const args = identityArgs(rest.slice(open + 1, close));
    const tail = rest.slice(close + 1);
    const bodyMatch = /(\$[A-Za-z_]*\$)([\s\S]*?)\1/.exec(tail);
    let body = bodyMatch ? bodyMatch[2] : "";
    if (!bodyMatch) {
      const q = /\bAS\s+'((?:[^']|'')*)'/i.exec(tail);
      if (q) body = q[1].replace(/''/g, "'");
    }
    const header = bodyMatch ? tail.replace(bodyMatch[0], " ") : tail;
    const definer = /\bSECURITY\s+DEFINER\b/i.test(header);
    const returns = (/\bRETURNS\s+([\s\S]*?)(?=\bLANGUAGE\b|\bAS\b|\bSECURITY\b|\bSTABLE\b|\bIMMUTABLE\b|\bVOLATILE\b|\bSET\b|\bPARALLEL\b|\bSTRICT\b|$)/i
      .exec(header)?.[1] ?? "").trim();
    const language = (/\bLANGUAGE\s+(\w+)/i.exec(header)?.[1] ?? "").toLowerCase();
    const sig = sigOf(ref.name, args);
    const existing = fns.get(sig);
    const bodyCode = splitStatements(body).join(";\n");
    if (existing && m[1]) {
      existing.definer = definer;
      existing.file = file;
      existing.body = bodyCode;
      existing.returns = returns;
      existing.language = language;
      note(sig, `${file}: CREATE OR REPLACE (grants kept)`);
    } else {
      fns.set(sig, {
        name: ref.name, args, sig, definer, acl: freshAcl(), file, createdIn: file,
        body: bodyCode, returns, language,
      });
      note(sig, `${file}: CREATE (default grants: PUBLIC, anon, authenticated, service_role)`);
    }
  };

  const handleGrantRevoke = (stmt: string, where: string) => {
    const m = /^(GRANT|REVOKE)\s+(GRANT\s+OPTION\s+FOR\s+)?([\s\S]+?)\s+ON\s+(FUNCTION|ROUTINE|ALL\s+FUNCTIONS\s+IN\s+SCHEMA|ALL\s+ROUTINES\s+IN\s+SCHEMA)\s+([\s\S]+?)\s+(TO|FROM)\s+([\s\S]+?)(\s+CASCADE|\s+RESTRICT|\s+WITH\s+GRANT\s+OPTION|\s+GRANTED\s+BY\s+\w+)?\s*$/i.exec(stmt);
    if (!m) return;
    if (m[2]) return; // GRANT OPTION FOR does not change EXECUTE
    if (!privilegeCoversExecute(m[3])) return;
    const grant = m[1].toUpperCase() === "GRANT";
    const grantees = granteesIn(m[7]);
    if (/^ALL/i.test(m[4])) {
      if (m[5].trim().toLowerCase().replace(/"/g, "") !== "public") return;
      applyAcl([...fns.keys()], grant, grantees, where);
      return;
    }
    for (const ref of splitTopLevel(m[5])) {
      const r = parseSigRef(ref);
      if (!r) continue;
      applyAcl(resolveRef(r.name, r.args), grant, grantees, where);
    }
  };

  const handleDrop = (stmt: string, where: string) => {
    const m = /^DROP\s+FUNCTION\s+(IF\s+EXISTS\s+)?([\s\S]+?)(\s+CASCADE|\s+RESTRICT)?\s*$/i.exec(stmt);
    if (!m) return;
    for (const ref of splitTopLevel(m[2])) {
      const r = parseSigRef(ref);
      if (!r) continue;
      for (const s of resolveRef(r.name, r.args)) {
        fns.delete(s);
        note(s, `${where}: DROP`);
      }
    }
  };

  const handleAlter = (stmt: string, where: string) => {
    const m = /^ALTER\s+FUNCTION\s+([\s\S]+?\))\s+([\s\S]+)$/i.exec(stmt);
    if (!m) return;
    const r = parseSigRef(m[1]);
    if (!r) return;
    const action = m[2];
    for (const s of resolveRef(r.name, r.args)) {
      const f = fns.get(s)!;
      if (/\bSECURITY\s+DEFINER\b/i.test(action)) { f.definer = true; note(s, `${where}: ALTER SECURITY DEFINER`); }
      if (/\bSECURITY\s+INVOKER\b/i.test(action)) { f.definer = false; note(s, `${where}: ALTER SECURITY INVOKER`); }
      const rn = /^RENAME\s+TO\s+"?(\w+)"?/i.exec(action);
      if (rn) {
        fns.delete(s);
        f.name = rn[1].toLowerCase();
        f.sig = sigOf(f.name, f.args);
        fns.set(f.sig, f);
        note(f.sig, `${where}: RENAMED from ${s}`);
      }
    }
  };

  /**
   * The catalogue-driven loops: `FOR r IN SELECT ... FROM pg_proc ... WHERE
   * proname <filter> LOOP EXECUTE <ddl> || r.sig ... END LOOP`.
   */
  const handleDo = (body: string, where: string) => {
    // Static statements inside the block (e.g. `IF to_regprocedure(...) IS NOT
    // NULL THEN REVOKE ...; END IF;`).
    for (const frag of splitStatements(body)) {
      const sm = /(?:^|\bTHEN\b|\bELSE\b|\bBEGIN\b|\bLOOP\b)\s*((?:GRANT|REVOKE|DROP\s+FUNCTION|ALTER\s+FUNCTION)\b[\s\S]*)$/i.exec(frag);
      if (sm && !/\|\||%s|%I/.test(sm[1])) dispatch(sm[1].trim(), where);
    }
    const declared = new Map<string, string>();
    for (const d of body.matchAll(/\b(\w+)\s+(?:CONSTANT\s+)?text\s*:=\s*'((?:[^']|'')*)'/gi)) {
      declared.set(d[1].toLowerCase(), d[2]);
    }
    // `v_x text[] := ARRAY['public.f(integer)', ...]` -- the literal list a
    // signature loop walks. Read quote-aware: a signature like `f(text[])`
    // carries its own brackets, and a lazy `\[.*?\]` would stop inside it.
    const declaredArrays = new Map<string, string[]>();
    for (const d of body.matchAll(/\b(\w+)\s+text\[\]\s*:=\s*ARRAY\s*\[/gi)) {
      declaredArrays.set(d[1].toLowerCase(), arrayLiteralAt(body, d.index! + d[0].length - 1));
    }
    // FOREACH s IN ARRAY <v_x | ARRAY[...]> LOOP ... EXECUTE format('REVOKE ...
    // ON FUNCTION %s FROM ...', to_regprocedure(s)) ... END LOOP: the exact-
    // signature form 20261004110000 closes 56 functions with.
    for (const fe of body.matchAll(/\bFOREACH\s+(\w+)\s+IN\s+ARRAY\s+(ARRAY\s*\[|\w+)/gi)) {
      const items = /^ARRAY/i.test(fe[2])
        ? arrayLiteralAt(body, fe.index! + fe[0].length - 1)
        : declaredArrays.get(fe[2].toLowerCase()) ?? [];
      const loopAt = body.slice(fe.index!).search(/\bLOOP\b/i);
      if (loopAt < 0) continue;
      const rest = body.slice(fe.index! + loopAt);
      const endAt = rest.search(/\bEND\s+LOOP\b/i);
      const loopBody = endAt < 0 ? rest : rest.slice(0, endAt);
      for (const ex of loopBody.matchAll(/EXECUTE\s+format\s*\(\s*'([^']*)'/gi)) {
        const g = /^(GRANT|REVOKE)\s+([\s\S]+?)\s+ON\s+FUNCTION\s+%s\s+(TO|FROM)\s+([\s\S]+)$/i.exec(ex[1].trim());
        if (!g || !privilegeCoversExecute(g[2])) continue;
        for (const it of items) {
          const ref = parseSigRef(it);
          if (!ref) continue;
          applyAcl(resolveRef(ref.name, ref.args), g[1].toUpperCase() === "GRANT", granteesIn(g[4]), `${where} (signature loop)`);
        }
      }
    }
    for (const loop of body.matchAll(/\bFOR\s+(\w+)\s+IN\s+([\s\S]*?)\bLOOP\b([\s\S]*?)\bEND\s+LOOP\b/gi)) {
      const select = loop[2];
      const actions = loop[3];
      if (!/\bpg_proc\b/i.test(select)) continue;
      const names = new Set<string>();
      for (const f of select.matchAll(/proname\s*=\s*'(\w+)'/gi)) names.add(f[1].toLowerCase());
      for (const f of select.matchAll(/proname\s+IN\s*\(([^)]*)\)/gi)) {
        for (const q of f[1].matchAll(/'(\w+)'/g)) names.add(q[1].toLowerCase());
      }
      for (const f of select.matchAll(/proname\s*=\s*ANY\s*\(\s*ARRAY\s*\[([\s\S]*?)\]/gi)) {
        for (const q of f[1].matchAll(/'(\w+)'/g)) names.add(q[1].toLowerCase());
      }
      if (!names.size) continue;
      const definerOnly = /\bprosecdef\b(?!\s*=\s*false)/i.test(select);
      let keep: string | null = null;
      const km = /pg_get_function_identity_arguments\s*\([^)]*\)\s*(?:IS\s+DISTINCT\s+FROM|<>|!=)\s*(?:'((?:[^']|'')*)'|(\w+))/i.exec(select);
      if (km) keep = identityArgs((km[1] ?? declared.get((km[2] ?? "").toLowerCase()) ?? "").replace(/''/g, "'"));
      const targets = () => [...fns.values()]
        .filter((f) => names.has(f.name) && (!definerOnly || f.definer) && (keep === null || f.args !== keep))
        .map((f) => f.sig);
      for (const ex of actions.matchAll(/EXECUTE\s+(?:format\s*\(\s*)?'([^']*)'/gi)) {
        const ddl = ex[1].trim();
        const sigs = targets();
        if (/^DROP\s+FUNCTION/i.test(ddl)) {
          for (const s of sigs) { fns.delete(s); note(s, `${where}: DROP (catalogue loop)`); }
          continue;
        }
        const g = /^(GRANT|REVOKE)\s+([\s\S]+?)\s+ON\s+FUNCTION\s+%s\s+(TO|FROM)\s+([\s\S]+)$/i.exec(ddl);
        if (g && privilegeCoversExecute(g[2])) {
          applyAcl(sigs, g[1].toUpperCase() === "GRANT", granteesIn(g[4]), `${where} (catalogue loop)`);
        }
      }
    }
  };

  const dispatch = (stmt: string, where: string) => {
    if (/^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(stmt)) return handleCreate(stmt, where);
    if (/^(GRANT|REVOKE)\b/i.test(stmt)) return handleGrantRevoke(stmt, where);
    if (/^DROP\s+FUNCTION\b/i.test(stmt)) return handleDrop(stmt, where);
    if (/^ALTER\s+FUNCTION\b/i.test(stmt)) return handleAlter(stmt, where);
    const doM = /^DO\s*(?:LANGUAGE\s+\w+\s*)?(\$[A-Za-z_]*\$)([\s\S]*?)\1/i.exec(stmt);
    if (doM) return handleDo(doM[2], where);
  };

  for (const { file, text } of list) {
    for (const stmt of splitStatements(text)) {
      // BEGIN/COMMIT wrappers are their own statements and fall through.
      dispatch(stmt, file);
    }
  }
  return { fns, history };
}

let cached: Replay | null = null;
/** The replay of the repository's migration lane, computed once per process. */
export function migrationReplay(): Replay {
  if (!cached) cached = replayMigrations();
  return cached;
}
