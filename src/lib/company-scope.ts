// THE MOST EMPLOYER TOKENS ONE /jobs SCOPE CAN CARRY.
//
// The board's `company` filter takes a comma-joined list, and the /jobs lander
// keeps at most this many of them (the same 12 as an Explore collection, so a
// hand-edited URL cannot turn a cheap query into an expensive one). The
// typeahead on /jobs holds the same line — a merged employer whose sub-boards
// do not fit is NOT partially applied — and so must every other surface that
// builds a `?company=` link from a merged row: /companies prints the SUM of a
// group's `open`, and a link to more tokens than the lander keeps would print
// a number the destination silently narrows. One constant, read by both
// sides; Jobs.tsx still spells the literal (its guards pin that spelling) and
// a mirror test holds the two together.
export const COMPANY_SCOPE_MAX = 12;
