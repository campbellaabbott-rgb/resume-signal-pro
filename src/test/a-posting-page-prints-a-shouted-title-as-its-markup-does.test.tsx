// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * A POSTING PAGE PRINTS A SHOUTED TITLE AS ITS MARKUP DOES (SEO check
 * 2026-11-15, F12, review of the same day).
 *
 * The job markup gave a title its employer typed in capitals in title case
 * ("MFG PEE PH PR TECH" is "Mfg PEE PH PR Tech"), but the page's heading, its
 * <title> and its meta description still printed the capitals. Google's
 * content policy for job postings asks for no all caps, and asks that the
 * markup say what the page shows. postingTitleText is the one spelling: the
 * markup, the <title> (the bake and the hydrated page both call
 * postingPageTitle), the meta description and the posting page's heading all
 * print it. The board's own card and pane keep the employer's casing.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: [] }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import { PostingDetail } from "@/components/jobs/listing/PostingDetail";
import type { ListingJob } from "@/lib/listing/types";
import {
  postingJsonLd,
  postingPageDescription,
  postingPageTitle,
  postingPageTitleAvoiding,
  postingTitleText,
} from "@/components/jobs/posting-page";

const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

/** The report's Micron title, on a Greenhouse-shaped row. */
const ROW = {
  id: "greenhouse:acme:4401", title: "MFG PEE PH PR TECH", company: "Acme Manufacturing",
  token: "acme", source: "greenhouse", location: "Dayton, OH", country: "US", workMode: null,
  postedAt: at(2), missingSince: null, recheckedAt: new Date(Date.now() - 600_000).toISOString(),
  applyUrl: "https://job-boards.greenhouse.io/acme/jobs/4401", salary: null, agency: false,
} satisfies ListingJob;
const SHOWN = "Mfg PEE PH PR Tech";
const DESC = "Acme Manufacturing is hiring a process engineering technician for its Dayton plant, working on the press line with the quality team. ".repeat(4);

beforeAll(() => {
  i18n.addResourceBundle("en", "translation", enListing, true, true);
  setLanderManifestForTests("*");
});
afterEach(() => cleanup());

describe("the head and the markup print one spelling", () => {
  it("is the title-cased title", () => {
    expect(postingTitleText(ROW.title)).toBe(SHOWN);
    expect(postingTitleText("Process Tech - PEE Line")).toBe("Process Tech - PEE Line");
  });

  it("starts the <title>, the de-duplicated <title> and the meta description", () => {
    expect(postingPageTitle(ROW).startsWith(SHOWN)).toBe(true);
    expect(postingPageTitleAvoiding(ROW, new Set([postingPageTitle(ROW)])).startsWith(SHOWN)).toBe(true);
    expect(postingPageDescription(ROW).startsWith(SHOWN)).toBe(true);
    for (const s of [postingPageTitle(ROW), postingPageDescription(ROW)]) expect(s).not.toContain("MFG PEE");
  });

  it("is what the job markup names", () => {
    expect(postingJsonLd(ROW, DESC, { site: "https://resumebooster.work" })?.title).toBe(SHOWN);
  });
});

describe("the posting page's heading", () => {
  it("prints the title as the markup names it", () => {
    render(<MemoryRouter><PostingDetail job={ROW} surface="page" description={{ text: DESC, state: "loaded" }} /></MemoryRouter>);
    const h1 = document.querySelector("h1");
    expect(h1?.textContent).toBe(SHOWN);
  });

  it("leaves the board's pane in the employer's casing", () => {
    render(<MemoryRouter><PostingDetail job={ROW} surface="board" description={{ text: DESC, state: "loaded" }} onClose={() => {}} /></MemoryRouter>);
    expect(document.querySelector("h2")?.textContent).toBe("MFG PEE PH PR TECH");
  });
});
