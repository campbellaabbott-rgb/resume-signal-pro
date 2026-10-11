/**
 * A SELF-CHECK THAT A CLIENT CANNOT WRITE MUST START FROM SUPABASE'S GRANTS.
 *
 * Lovable's staged runner rolled wave 2 back twice at 20261008132000. That
 * file's self-check raises while the signed-in role can write one column of
 * agent_passes, and live it could: Supabase gives every new public table ALL
 * for anon, authenticated and service_role, the table's creating migration
 * revoked only from PUBLIC and anon, and a GRANT of SELECT never takes the
 * rest away. Every local test passed, because the pglite stand-ins never had
 * Supabase's default grants.
 *
 * This guard makes that class mechanical. For every migration in file order,
 * it finds each DO-block self-check that raises when anon or authenticated
 * HOLDS a table or column privilege, replays the lane from Supabase's default
 * grants up to the statement before that block (helpers/table-acl.ts), and
 * fails with the file, table, role and privilege when the role still holds it
 * -- that check WILL raise live. The evaluator is
 * helpers/client-hold-self-checks.ts; the cases below pin its behaviour on
 * small lanes before trusting its verdict on the real one.
 */
import { describe, expect, it } from "vitest";
import { describeRaise, evaluateClientHoldChecks, readLane, type LaneVerdict } from "./helpers/client-hold-self-checks";

const FIX = "20261008131500";
const CONTROL = "20261008132000";

const lane = readLane();
const full = evaluateClientHoldChecks(lane);
const withoutFix = evaluateClientHoldChecks(lane.filter((f) => !f.file.startsWith(FIX)));

const flags = (v: LaneVerdict) =>
  v.raises.map((r) => ({ file: r.file.slice(0, 14), table: r.table, role: r.role, privilege: r.privilege, column: r.column }));

/** A lane written inline, one string per migration, applied in order. */
const mini = (...files: string[]) =>
  evaluateClientHoldChecks(files.map((text, i) => ({ file: `2099010100000${i}_case.sql`, text })));
const CREATE = "CREATE TABLE IF NOT EXISTS public.t (id uuid, owner uuid, status text, score int);";
const raising = (cond: string) => `DO $$ BEGIN IF ${cond} THEN RAISE EXCEPTION 'self-check'; END IF; END $$;`;

describe("the evaluator, on lanes small enough to read", () => {
  it("a fresh public table carries Supabase's default ALL, so a check that anon cannot read it raises", () => {
    const v = mini(CREATE, raising("has_table_privilege('anon', 'public.t', 'SELECT')"));
    expect(flags(v)).toEqual([{ file: "20990101000001", table: "t", role: "anon", privilege: "SELECT", column: null }]);
  });

  it("a GRANT takes nothing away: revoking from PUBLIC and anon and granting SELECT leaves the signed-in role every write", () => {
    const v = mini(
      CREATE,
      "REVOKE ALL ON public.t FROM PUBLIC, anon; GRANT SELECT ON public.t TO authenticated;",
      raising("has_column_privilege('authenticated', 'public.t', 'status', 'UPDATE')"),
    );
    expect(flags(v)).toEqual([{ file: "20990101000002", table: "t", role: "authenticated", privilege: "UPDATE", column: "status" }]);
  });

  it("a column REVOKE never removes a table-level grant", () => {
    const v = mini(CREATE, "REVOKE UPDATE (score) ON public.t FROM authenticated;",
      raising("has_column_privilege('authenticated', 'public.t', 'score', 'UPDATE')"));
    expect(v.raises).toHaveLength(1);
  });

  it("a table REVOKE then a column GRANT gives that column and nothing else", () => {
    const v = mini(
      CREATE,
      "REVOKE ALL ON public.t FROM PUBLIC, anon, authenticated; GRANT SELECT ON public.t TO authenticated; GRANT UPDATE (status) ON public.t TO authenticated;",
      raising("has_column_privilege('authenticated', 'public.t', 'score', 'UPDATE')"),
      raising("has_table_privilege('authenticated', 'public.t', 'UPDATE')"),
      raising("has_column_privilege('authenticated', 'public.t', 'status', 'UPDATE')"),
    );
    expect(flags(v)).toEqual([{ file: "20990101000004", table: "t", role: "authenticated", privilege: "UPDATE", column: "status" }]);
  });

  it("a check is judged by what the lane had done when its block ran, not by the end state", () => {
    const early = mini(CREATE, raising("has_table_privilege('anon', 'public.t', 'INSERT')"), "REVOKE ALL ON public.t FROM anon;");
    expect(early.raises).toHaveLength(1);
    const inFile = mini(`${CREATE} REVOKE ALL ON public.t FROM anon; ${raising("has_table_privilege('anon', 'public.t', 'INSERT')")}`);
    expect(inFile.raises).toEqual([]);
  });

  it("skips what does not raise on a client role holding a privilege, and reads no comment", () => {
    const v = mini(CREATE, `DO $$ BEGIN
      IF NOT has_table_privilege('authenticated', 'public.t', 'SELECT') THEN RAISE EXCEPTION 'lost the read'; END IF;
      IF has_table_privilege('anon', 'public.t', 'SELECT') THEN RAISE NOTICE 'only a notice'; END IF;
      IF has_table_privilege('service_role', 'public.t', 'SELECT') THEN RAISE EXCEPTION 'not a client'; END IF;
      IF has_table_privilege('anon', 'public.t', 'SELECT') AND false THEN RAISE EXCEPTION 'one operand'; END IF;
      -- IF has_table_privilege('anon', 'public.t', 'INSERT') THEN RAISE EXCEPTION 'prose'; END IF;
      /* IF has_table_privilege('anon', 'public.t', 'DELETE') THEN RAISE EXCEPTION 'prose'; END IF; */
    END $$;`);
    expect(v.raises).toEqual([]);
    expect(v.sites.map((s) => s.kind)).toEqual(["negated", "does-not-raise", "not-a-client-role", "compound"]);
  });

  it("resolves the loop variables the lane writes: FOREACH, unnest cross joins, every column, concatenated names", () => {
    const v = mini(
      CREATE,
      "REVOKE ALL ON public.t FROM PUBLIC, anon, authenticated; GRANT TRUNCATE ON public.t TO authenticated; GRANT UPDATE (score) ON public.t TO authenticated;",
      `DO $$ DECLARE v_priv text; v_role text; v_col text; n text; BEGIN
        FOREACH v_priv IN ARRAY ARRAY['INSERT', 'TRUNCATE'] LOOP
          IF has_table_privilege('authenticated', 'public.t', v_priv) THEN RAISE EXCEPTION 'a %', v_priv; END IF;
        END LOOP;
        FOR v_role, v_priv IN SELECT ro.rolname, pv.privname FROM unnest(ARRAY['anon', 'authenticated']) ro(rolname)
                              CROSS JOIN unnest(ARRAY['SELECT', 'DELETE']) pv(privname) LOOP
          IF has_table_privilege(v_role, 'public.t', v_priv) THEN RAISE EXCEPTION 'b'; END IF;
        END LOOP;
        FOR v_col IN SELECT a.attname FROM pg_attribute a WHERE a.attrelid = 'public.t'::regclass AND a.attnum > 0 LOOP
          IF has_column_privilege('authenticated', 'public.t', v_col, 'UPDATE') THEN RAISE EXCEPTION 'c'; END IF;
        END LOOP;
        FOREACH n IN ARRAY ARRAY['t'] LOOP
          IF has_table_privilege('anon', 'public.' || n, 'SELECT') THEN RAISE EXCEPTION 'd'; END IF;
        END LOOP;
      END $$;`,
    );
    expect(v.sites.map((s) => [s.kind, s.combos.length])).toEqual([["evaluated", 2], ["evaluated", 4], ["evaluated", 1], ["evaluated", 1]]);
    expect(flags(v)).toEqual([
      { file: "20990101000002", table: "t", role: "authenticated", privilege: "TRUNCATE", column: null },
      { file: "20990101000002", table: "t", role: "authenticated", privilege: "UPDATE", column: "*" },
    ]);
  });

  it("an accumulator a later IF raises on counts as raising", () => {
    const v = mini(CREATE, `DO $$ DECLARE bad text := ''; BEGIN
      IF has_table_privilege('anon', 'public.t', 'SELECT') THEN bad := bad || 'readable '; END IF;
      IF bad <> '' THEN RAISE EXCEPTION 'not locked: %', bad; END IF;
    END $$;`);
    expect(v.raises).toHaveLength(1);
  });

  it("an argument it cannot read is reported unresolved, never passed", () => {
    const v = mini(CREATE, raising("has_table_privilege('anon', some_table_name(), 'SELECT')"),
      raising("has_table_privilege('anon', 'public.not_in_the_lane', 'SELECT')"));
    expect(v.sites.map((s) => s.kind)).toEqual(["unresolved", "unresolved"]);
    expect(v.raises).toEqual([]);
  });
});

describe("the migration lane", () => {
  it(`the control: without ${FIX}, ${CONTROL} raises on agent_passes / authenticated / UPDATE, and nothing else does`, () => {
    expect(flags(withoutFix)).toEqual([
      { file: CONTROL, table: "agent_passes", role: "authenticated", privilege: "UPDATE", column: "settled_at" },
    ]);
  });

  it(`with ${FIX}, the same check is evaluated and passes`, () => {
    const sites = full.sites.filter((s) => s.file.startsWith(CONTROL) && s.kind === "evaluated");
    expect(sites.map((s) => s.combos)).toEqual([[
      { role: "authenticated", table: "agent_passes", privilege: "UPDATE", column: "settled_at", holds: false },
    ]]);
  });

  it("reads every shape the lane writes (each would read as a pass if the evaluator went blind to it)", () => {
    const combos = (prefix: string) => full.sites.filter((s) => s.file.startsWith(prefix) && s.kind === "evaluated")
      .reduce((n, s) => n + s.combos.length, 0);
    expect(combos("20261004100000"), "nested FOREACH over tables, roles and privileges").toBe(24);
    expect(combos("20261003180000"), "FOR role, privilege IN an unnest cross join").toBe(14);
    expect(combos("20260918100000"), "a concatenated table name, into an accumulator").toBe(16);
    expect(combos(FIX), "a privilege array and an every-column loop").toBe(15);
    // The column model: agent_queue keeps UPDATE on two columns only
    // (20260917180000), so the owner cannot write the refund receipt.
    const queue = full.sites.find((s) => s.file.startsWith("20261005130000") && /agent_queue/.test(s.call));
    expect(queue?.combos).toEqual([{ role: "authenticated", table: "agent_queue", privilege: "UPDATE", column: "pass_refunded_at", holds: false }]);
  });

  it("every self-check that raises on a client role holding a privilege is one the guard could decide", () => {
    const unresolved = full.sites.filter((s) => s.kind === "unresolved").map((s) => `${s.file}: ${s.call} -- ${s.reason}`);
    expect(unresolved, "teach helpers/client-hold-self-checks.ts this shape; an unread check is not a passing one:\n" + unresolved.join("\n")).toEqual([]);
  });

  it("no self-check in the lane will raise live", () => {
    expect(full.raises.map(describeRaise), "revoke the table-level privilege from the role, then GRANT back only the columns it must write:\n"
      + full.raises.map(describeRaise).join("\n")).toEqual([]);
  });
});
