/**
 * WHERE THE HOMEPAGE'S SEARCH GOES. Jobs.tsx reads q, location and mode from
 * the address on mount, so the hero's form and its try chips are plain /jobs
 * links. "Remote" typed as the place, in English or in the reader's own word
 * for it, is the work mode, not a town called Remote.
 */
export const TRY_CHIPS: ReadonlyArray<{ key: string; to: string; optional?: boolean }> = [
  { key: "nurse", to: "/jobs?q=nurse" },
  { key: "dataAnalyst", to: "/jobs?q=data+analyst" },
  { key: "remote", to: "/jobs?mode=remote" },
  { key: "accountant", to: "/jobs?q=accountant", optional: true },
  { key: "warehouse", to: "/jobs?q=warehouse", optional: true },
];

export function searchHref(q: string, location: string, remoteWord: string): string {
  const params = new URLSearchParams();
  const query = q.trim();
  const place = location.trim();
  if (query) params.set("q", query);
  const isRemote = !!place && [remoteWord.trim().toLowerCase(), "remote"].includes(place.toLowerCase());
  if (isRemote) params.set("mode", "remote");
  else if (place) params.set("location", place);
  const s = params.toString();
  return s ? `/jobs?${s}` : "/jobs";
}
