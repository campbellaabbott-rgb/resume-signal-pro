/**
 * A FILE AS IT STOOD AT AN OLDER COMMIT, VENDORED, NEVER READ FROM GIT.
 *
 * CI's checkout is one commit deep, so a test that asks git for an older
 * commit's file throws "invalid object name" there and passes on every laptop
 * (no-test-names-a-commit-ci-does-not-check-out guards that). A STALE BEFORE
 * case that runs a verify section as main deployed it reads the copy in
 * src/test/fixtures/ instead: { about, commit, path, blob, text }, where blob
 * is the file's git object id at that commit. The text is checked against it
 * here (a git blob id is sha1("blob <bytes>\0" + content)), so an edited copy
 * fails loudly, and anyone with the history can check the id itself.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type VendoredFile = { about: string; commit: string; path: string; blob: string; text: string };

export function gitBlobId(text: string): string {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${body.length}\0`, "utf8"), body])).digest("hex");
}

/** The vendored file's text, after checking it is the blob it names. */
export function vendoredAt(fixture: string): string {
  const f = JSON.parse(readFileSync(resolve(__dirname, "../fixtures", fixture), "utf8")) as VendoredFile;
  const id = gitBlobId(f.text);
  if (id !== f.blob) throw new Error(`${fixture}: the vendored ${f.path} hashes to ${id}, not ${f.blob} (its blob at ${f.commit}); it was edited after it was copied`);
  return f.text;
}
