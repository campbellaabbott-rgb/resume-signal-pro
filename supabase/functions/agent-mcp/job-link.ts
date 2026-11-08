// A JOB ID, OR THE LINK A PERSON PASTES FOR ONE (connect W1, CJ-04 and BR-03).
//
// One reader for every tool that takes a job: get_job, get_jobs, fetch,
// apply_myself and check_jobs_open. Before it, get_job read only the ?job=
// parameter of a pasted link, so the board's own posting page
// (resumebooster.work/jobs/posting/<source>/<token>/<key>, the page Google and
// AI search show) was refused as "not a job id from this board" while the
// posting was open; and check_jobs_open read no link at all, so a pasted
// ?job= link came back "closed".
//
// Accepted, each turned into the board's own id (<source>:<token>:<key>):
//   - the id itself;
//   - resumebooster.work/jobs?job=<id> (any path on the site with ?job=);
//   - resumebooster.work/jobs/posting/<source>/<token>/<key>[/], each segment
//     URL-decoded, and the older single-segment /jobs/posting/<id>;
//   - an employer's own Greenhouse, Lever or Ashby posting link, whose path
//     names the board token and the posting key the board stores.
//
// Pure: no I/O.

/** The shape of a board id: three or more colon-separated parts, the first two non-empty. */
export function isJobIdShape(id: string): boolean {
  const parts = id.split(":");
  return parts.length >= 3 && !!parts[0] && !!parts[1] && !!parts.slice(2).join(":") && id.length <= 400;
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** The board's id for an employer link the board can name, or null. */
function employerLink(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean).map(decode);
  // job-boards.greenhouse.io/<token>/jobs/<id>, boards.greenhouse.io/<token>/jobs/<id>
  if (/(?:^|\.)greenhouse\.io$/.test(host)) {
    if (seg.length >= 3 && seg[1] === "jobs" && /^\d+$/.test(seg[2])) return `greenhouse:${seg[0]}:${seg[2]}`;
    // boards.greenhouse.io/embed/job_app?for=<token>&token=<id>
    const forToken = u.searchParams.get("for");
    const jobId = u.searchParams.get("token");
    if (forToken && jobId && /^\d+$/.test(jobId)) return `greenhouse:${forToken}:${jobId}`;
    return null;
  }
  // jobs.lever.co/<token>/<uuid>[/apply], jobs.eu.lever.co/<token>/<uuid>
  if (/(?:^|\.)lever\.co$/.test(host) && seg.length >= 2 && /^[0-9a-f-]{36}$/i.test(seg[1])) return `lever:${seg[0]}:${seg[1]}`;
  // jobs.ashbyhq.com/<token>/<uuid>[/application]
  if (/(?:^|\.)ashbyhq\.com$/.test(host) && seg.length >= 2 && /^[0-9a-f-]{36}$/i.test(seg[1])) return `ashby:${seg[0]}:${seg[1]}`;
  return null;
}

/** The board id a pasted id or link names, or null when it names none. */
export function parseJobId(raw: unknown): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s) && /^(?:www\.)?resumebooster\.work\//i.test(s)) s = `https://${s}`;
  if (/^https?:\/\//i.test(s)) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    const fromParam = u.searchParams.get("job");
    if (fromParam && isJobIdShape(fromParam.trim())) return fromParam.trim();
    const seg = u.pathname.split("/").filter(Boolean).map(decode);
    if (seg[0] === "jobs" && seg[1] === "posting") {
      if (seg.length === 5) {
        const id = `${seg[2]}:${seg[3]}:${seg[4]}`;
        return isJobIdShape(id) ? id : null;
      }
      if (seg.length === 3 && isJobIdShape(seg[2])) return seg[2];
      return null;
    }
    return employerLink(u);
  }
  return isJobIdShape(s) ? s : null;
}
