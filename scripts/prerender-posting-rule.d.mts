// Types for scripts/prerender-posting-rule.mjs (the bake's rule 1, run by the
// bake and inside postingJsonLd).

/** The app's own modules the rule reads, as the bake's bundle or posting-page.ts hands them. */
export interface PostingRuleModules {
  postingPagePath: (id: string) => string | null;
  postingPathParts: (id: string) => { token: string } | null;
  postingEmployer: (job: { id: string; token?: string | null; company?: string | null }) => string;
  isCodeShapedName: (token: string | null | undefined, name: string | null | undefined) => boolean;
  isPostingLive: (job: never) => boolean;
}

export function postingRowEligible(job: unknown, D: PostingRuleModules): boolean;
