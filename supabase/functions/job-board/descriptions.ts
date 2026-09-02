export const DETAIL_DESC_SOURCES = ["workday", "smartrecruiters", "bamboohr", "oracle", "breezy", "rippling", "paylocity", "adp", "ukg"] as const;
export const BOARD_DESC_SOURCES = ["workable", "pinpoint", "icims"] as const;
export const NO_DESC_SOURCES = [] as const;
export function buildEmbedInput(
  title: string | null | undefined,
  company: string | null | undefined,
  location: string | null | undefined,
  description: string | null | undefined,
): string {
  const parts = [
    (title ?? "").trim(),
    [company, location].filter((x) => (x ?? "").trim()).join(" — ").trim(),
    (description ?? "").replace(/\s+/g, " ").trim().slice(0, 1200),
  ].filter(Boolean);
  return parts.join("\n").slice(0, 1600);
}
export function clusterKey(companyKey: string, title: string): string {
  const companyKey0 = (companyKey || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const t = (title || "")
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .replace(/#?\b(?:jr|r|req|job)?[-\s]?\d[\d-]{3,}\b/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${companyKey0} ${t}`;
}
export function workdayCxsUrl(applyUrl: string): string | null {
  const m = (applyUrl || "").match(
    /^https:\/\/([a-z0-9][a-z0-9-]*)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[a-z]{2}\/)?([^/?#]+)(\/job\/[^?#]+)/i,
  );
  if (!m) return null;
  const [, tenant, wd, site, path] = m;
  return `https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}${path}`;
}
export function jobPostingLdDescription(html: string): string | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of (html || "").matchAll(re)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      const n = node as { "@type"?: unknown; description?: unknown } | null;
      if (n && n["@type"] === "JobPosting" && typeof n.description === "string" && n.description.length > 100) {
        return n.description;
      }
    }
  }
  return null;
}
