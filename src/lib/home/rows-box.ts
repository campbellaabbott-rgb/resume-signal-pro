/**
 * THE HOMEPAGE LIST'S WINDOW AND ITS RESERVED BOX, as plain numbers, in a
 * module of their own: the list renders before its rows exist, and the code
 * that picks the rows (rows.ts, with the board's collision table and the
 * feed-read gate) loads only when the list call is made, after the first
 * paint. rows.ts re-exports these.
 */

/** How far back "posted in the last 7 days" reaches, in whole UTC days. */
export const HOME_ROWS_WINDOW_DAYS = 7;
/** Rows kept: at most five; the list shows as many whole rows as fit its reserved box. */
export const HOME_ROWS_MAX = 5;
/**
 * THE RESERVED LIST BOX (review P24). Its height is fixed before any row
 * arrives: rows are packed into it and a row that would not fit whole is not
 * shown, so the box never grows when the list lands. It shrinks to its last
 * row only where nobody can see anything move, its new bottom still at or
 * below the fold (list-box.ts packRows, review round 2026-10-26).
 *
 * Under 640px: three rows of the tallest card the corrected spec measured at
 * 375px (175px, here 11rem). From 640px: five rows of 7.5rem, measured over
 * 177 live rows on 2026-10-18 (median card 106px from 768px; 90th percentile
 * 132 to 150px), so five rows fit in the usual case and four in a tall one.
 */
export const HOME_ROWS_PHONE = 3;
export const HOME_LIST_BOX_PHONE_REM = HOME_ROWS_PHONE * 11 + (HOME_ROWS_PHONE - 1) * 0.5;
export const HOME_LIST_BOX_WIDE_REM = HOME_ROWS_MAX * 7.5 + (HOME_ROWS_MAX - 1) * 0.5;
