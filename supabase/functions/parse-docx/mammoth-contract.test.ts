// Regression test for the exact bug that took every .docx upload down: mammoth's
// extractRawText() forwards its input straight to unzip.openZip(), which only
// recognizes a `buffer`, `path`, or `file` key — never `arrayBuffer`. Passing
// `{ arrayBuffer }` always failed with "Could not find file in options".
//
// This locks in the library's actual contract using the real npm package (not a
// mock), so a future change to parse-docx/index.ts that regresses back to the
// wrong key — or a mammoth version bump that changes this contract — fails CI
// immediately instead of silently shipping to every user uploading a resume.
import { describe, it, expect } from "vitest";
import mammoth from "mammoth";
import JSZip from "jszip";

async function buildMinimalDocx(text: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  );

  // Generating directly as "arraybuffer" avoids a Node Buffer-pool aliasing
  // gotcha where slicing a pooled nodebuffer's .buffer property can produce an
  // ArrayBuffer JSZip doesn't recognize as a clean, standalone instance.
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("mammoth extractRawText input contract", () => {
  it("FAILS with the exact production bug's call shape: { arrayBuffer }", async () => {
    // mammoth uses Bluebird internally, which tracks "possibly unhandled
    // rejection" on its own schedule independent of whether the consumer
    // (this test) does eventually catch it — without this listener, vitest
    // reports the run as having an unhandled error even though the assertion
    // below passes correctly. Scoped to just this one expected rejection.
    const onUnhandledRejection = (err: unknown) => {
      if (err instanceof Error && err.message === "Could not find file in options") return;
      throw err;
    };
    process.on("unhandledRejection", onUnhandledRejection);

    const arrayBuffer = await buildMinimalDocx("Regression test content");
    let caughtError: unknown;
    try {
      await mammoth.extractRawText({ arrayBuffer } as never);
    } catch (e) {
      caughtError = e;
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe("Could not find file in options");
  });

  it("succeeds with { buffer: <raw ArrayBuffer> }", async () => {
    const arrayBuffer = await buildMinimalDocx("Regression test content");
    const result = await mammoth.extractRawText({ buffer: arrayBuffer });
    expect(result.value.trim()).toBe("Regression test content");
  });

  it("succeeds with { buffer: <Uint8Array> } — the exact call shape live in production", async () => {
    const arrayBuffer = await buildMinimalDocx("Regression test content");
    const docxBuffer = new Uint8Array(arrayBuffer);
    const result = await mammoth.extractRawText({ buffer: docxBuffer });
    expect(result.value.trim()).toBe("Regression test content");
  });
});
