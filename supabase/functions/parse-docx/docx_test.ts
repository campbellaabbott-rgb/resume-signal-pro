// THE .DOCX PARSER, RUN ON THE BUILDS IT DEPLOYS (registers S11-010, S11-033,
// S11-034). The Node suite has npm mammoth 1.6.0; production runs the esm.sh
// build ./libs.ts imports. These run THAT build, so a version pin that cannot
// read a Strict document, or that breaks under Deno (1.13.0 does: it throws on
// every document here), fails here before it ships. (Named *_test.ts, Deno's
// suffix, so vitest never sweeps it up.)
//
// Run: deno test --allow-env --allow-read supabase/functions/parse-docx/

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { JSZip, mammoth } from "./libs.ts";
import { DamagedDocxError, readDocxBody } from "./docx-text.ts";
import { normalizeIntakeText } from "../_shared/text-validation.ts";
import {
  ALT_CHUNK,
  altChunkDocx,
  damagedPartDocx,
  HYPHENS,
  hyphensDocx,
  LINKS,
  linksDocx,
  LIST_STYLE_BULLETS,
  NESTED,
  nestedTextBoxDocx,
  numStyleLinkBulletsDocx,
  RESUME_LINES,
  type ZipClass,
  RTF_RENAMED,
  softBreaksDocx,
  strictDocx,
  textBoxNoFallbackDocx,
  TRACKED_MOVE,
  trackedMoveDocx,
  transitionalDocx,
  WORD_BULLETS,
  wordBulletsDocx,
} from "./docx-fixtures.ts";

const Zip = JSZip as unknown as ZipClass;
const read = (bytes: Uint8Array) => readDocxBody(bytes, { mammoth, JSZip });
const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

Deno.test("S11-034: a Strict Open XML document is read", async () => {
  const { body } = await read(await strictDocx(Zip));
  assertEquals(lines(body), [RESUME_LINES.name, RESUME_LINES.email, RESUME_LINES.heading, RESUME_LINES.role, RESUME_LINES.bullet]);
});

Deno.test("S11-034, S12-128: a text box in mc:AlternateContent with no mc:Fallback is read, its email included", async () => {
  const { body } = await read(await textBoxNoFallbackDocx(Zip));
  for (const l of [RESUME_LINES.name, RESUME_LINES.email, RESUME_LINES.heading, RESUME_LINES.role, RESUME_LINES.bullet]) assert(body.includes(l), l);
  assertEquals(lines(body), [RESUME_LINES.name, RESUME_LINES.email, RESUME_LINES.heading, RESUME_LINES.role, RESUME_LINES.bullet]);
});

Deno.test("the ordinary document still reads one line per paragraph", async () => {
  const { body } = await read(await transitionalDocx(Zip));
  assertEquals(lines(body).length, 5);
});

Deno.test("S11-010: soft line breaks are lines on the deployed mammoth too", async () => {
  const { body, softBreaks } = await read(await softBreaksDocx(Zip));
  assertEquals(softBreaks, 3);
  const L = RESUME_LINES;
  assertEquals(lines(body), [L.name, L.email, L.heading, L.role, L.dates, L.bullet]);
});

Deno.test("S11-033: an RTF renamed .docx is a damaged file, not a crash", async () => {
  const e = await assertRejects(() => read(RTF_RENAMED), DamagedDocxError);
  assertEquals((e as DamagedDocxError).reason, "not_a_zip");
});

Deno.test("S13-037: Word's own bullets keep a bullet mark on the deployed mammoth, and nothing else gets one", async () => {
  const { body, listBullets } = await read(await wordBulletsDocx(Zip));
  const B = WORD_BULLETS;
  assertEquals(lines(body), [
    RESUME_LINES.name,
    B.heading,
    RESUME_LINES.role,
    ...B.bullets.map((t) => `\u2022 ${t}`),
    `\u2022 ${B.styled}`,
    B.removed,
    B.wasBullet,
    ...B.numbered,
  ]);
  assertEquals(listBullets, 4);
});

// The bug round of 2026-11-08, on the builds parse-docx deploys.

Deno.test("S14X-124: a part whose deflated bytes are damaged is a damaged file, not a crash", async () => {
  for (const part of ["word/document.xml", "word/numbering.xml"] as const) {
    const e = await assertRejects(async () => read(await damagedPartDocx(Zip, part)), DamagedDocxError);
    assertEquals((e as DamagedDocxError).reason, "unreadable_document");
  }
});

Deno.test("S14X-125: a tracked move reads its text once, where it went", async () => {
  const { body } = await read(await trackedMoveDocx(Zip));
  assertEquals(body.split(TRACKED_MOVE.moved).length, 2);
  assert(lines(body).indexOf(TRACKED_MOVE.moved) > lines(body).indexOf("EXPERIENCE"));
});

Deno.test("S14X-126: a text box holding a drawing keeps its email", async () => {
  for (const inner of ["fallback", "choiceOnly", "none"] as const) {
    const { body } = await read(await nestedTextBoxDocx(Zip, inner));
    assert(body.includes(NESTED.email), inner);
    assert(lines(body).includes(NESTED.phone), inner);
  }
});

Deno.test("S14X-281: a document exported as web content reads its lines", async () => {
  const { body, altChunks } = await read(await altChunkDocx(Zip));
  assertEquals(lines(body), ALT_CHUNK.lines);
  assertEquals(altChunks, { read: 1, unreadable: 0 });
});

Deno.test("RC-S13-037: bullets defined through a list style keep their bullets", async () => {
  const { body, listBullets } = await read(await numStyleLinkBulletsDocx(Zip));
  assertEquals(listBullets, 3);
  for (const t of LIST_STYLE_BULLETS) assert(lines(body).includes(`\u2022 ${t}`), t);
});

Deno.test("S14X-147: linked contact details end the text with their addresses", async () => {
  const { body } = await read(await linksDocx(Zip));
  assertEquals(lines(body).at(-1), `Links: ${LINKS.email} | ${LINKS.linkedin} | ${LINKS.github}`);
});

Deno.test("S14X-280: Word's non-breaking and optional hyphens read as plain words", async () => {
  const text = normalizeIntakeText((await read(await hyphensDocx(Zip))).body);
  assert(text.includes(HYPHENS.cofounded));
  assert(text.includes(HYPHENS.implemented));
});
