// @vitest-environment node
/**
 * THE DATA EXPORT NAMED THE STORED CV BUT LEFT OUT THE CV (platform sweep
 * L3-14, finished in the wave 3 review of payments-account).
 *
 * WHAT WAS WRONG. "Download all my data" listed each file under
 * resumes/{user id}/ by name, timestamps and size. That is metadata about the
 * CV, not the CV: the document the agent sends employers in the member's
 * name, which an access or portability request has to return.
 *
 * WHAT HOLDS NOW, the collector run against a fake client: each stored file
 * comes with a link to the file itself, signed by the member's own session
 * (the owner read policy covers their folder) and good for CV_LINK_SECONDS,
 * with when it stops working; a file the storage would not sign says why
 * instead of exporting a dead entry silently; another account's folder is
 * never asked for.
 */
import { describe, expect, it } from "vitest";
import { collectAccountExport, CV_LINK_SECONDS, type ExportClient } from "@/lib/account-export";

const UID = "00000000-0000-4000-8000-0000000e4e01";
const NOW = Date.parse("2026-10-09T12:00:00Z");

function client(sign: (paths: string[], expiresIn: number) => { data: unknown; error: { message: string } | null }) {
  const asked: Array<{ paths: string[]; expiresIn: number }> = [];
  const listed: string[] = [];
  const c: ExportClient = {
    from: () => {
      const q = { select: () => q, eq: () => q, range: async () => ({ data: [], error: null }) };
      return q;
    },
    storage: {
      from: () => ({
        list: async (path: string) => {
          listed.push(path);
          return { data: [{ name: "Jane_CV_2026.pdf", created_at: "2026-10-01T00:00:00Z", metadata: { size: 48_213 } }], error: null };
        },
        createSignedUrls: async (paths: string[], expiresIn: number) => {
          asked.push({ paths, expiresIn });
          return sign(paths, expiresIn) as never;
        },
      }),
    },
  };
  return { c, asked, listed };
}

describe("the stored CV in the data export", () => {
  it("comes with a link to the file itself, signed for the member's own folder, and when the link stops working", async () => {
    const { c, asked, listed } = client((paths) => ({ data: paths.map((path) => ({ path, signedUrl: `https://storage.test/sign/${path}?token=t`, error: null })), error: null }));
    const out = await collectAccountExport(c, UID, NOW);
    expect(listed).toEqual([UID]);
    expect(asked).toEqual([{ paths: [`${UID}/Jane_CV_2026.pdf`], expiresIn: CV_LINK_SECONDS }]);
    expect(out.cvFiles).toEqual([{
      name: "Jane_CV_2026.pdf", createdAt: "2026-10-01T00:00:00Z", updatedAt: null, bytes: 48_213,
      downloadUrl: `https://storage.test/sign/${UID}/Jane_CV_2026.pdf?token=t`,
      downloadUrlExpiresAt: new Date(NOW + CV_LINK_SECONDS * 1000).toISOString(),
    }]);
  });

  it("a file the storage would not sign says why, rather than exporting a name with nothing behind it", async () => {
    const { c } = client(() => ({ data: null, error: { message: "permission denied" } }));
    const out = await collectAccountExport(c, UID, NOW);
    expect(out.cvFiles).toEqual([expect.objectContaining({ name: "Jane_CV_2026.pdf", downloadUrl: null, downloadUrlExpiresAt: null, downloadError: "permission denied" })]);
  });
});
