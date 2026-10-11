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
import {
  RESUME_LINES,
  type ZipClass,
  RTF_RENAMED,
  softBreaksDocx,
  strictDocx,
  textBoxNoFallbackDocx,
  transitionalDocx,
} from "./docx-fixtures.ts";

const Zip = JSZip as unknown as ZipClass;
const read = (bytes: Uint8Array) => readDocxBody(bytes, { mammoth, JSZip });
const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

Deno.test("S11-034: a Strict Open XML document is read", async () => {
  const { body } = await read(await strictDocx(Zip));
  assertEquals(lines(body), [RESUME_LINES.name, RESUME_LINES.email, RESUME_LINES.heading, RESUME_LINES.role, RESUME_LINES.bullet]);
});

Deno.test("S11-034: a text box in mc:AlternateContent with no mc:Fallback does not throw", async () => {
  const { body } = await read(await textBoxNoFallbackDocx(Zip));
  for (const l of [RESUME_LINES.name, RESUME_LINES.heading, RESUME_LINES.role, RESUME_LINES.bullet]) assert(body.includes(l), l);
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
