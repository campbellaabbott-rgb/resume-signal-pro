// Is the H-1B wage data actually in the database?
//
// get_company_h1b is called by DeclaredWagesCard and employer-context, but no
// migration in this repo defines it — the SQL was never written, so the RPC
// 404s on every call and re-running migrations cannot fix it. The harvest is
// blocked upstream: the DOL 403s every programmatic LCA download, which is
// tracked as its own task and needs a manual download to unblock.
//
// Both call sites already fail soft, so nothing user-visible is wrong. What was
// wrong is that they fired a guaranteed-404 request on every employer page view
// and read, in the source, like a working feature. This flag makes the absence
// deliberate and gives the eventual harvest exactly one line to flip.
//
// Flip to true in the SAME commit that ships the CREATE FUNCTION migration.
export const H1B_DATA_AVAILABLE = false;
