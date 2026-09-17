import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A NAMESPACE IS PROVEN BY A KEY THE SITE SERVES.
 *
 * The official MCP registry lists this board's server under
 * work.resumebooster/jobs (the install repo's server.json). A reverse-domain
 * namespace is granted only to whoever proves control of the domain, and the
 * proof we chose is the HTTP method: the registry fetches
 * https://resumebooster.work/.well-known/mcp-registry-auth and expects one
 * line, `v=MCPv1; k=<algorithm>; p=<base64 public key>`, whose private half
 * signs the login. The private key lives outside every repository; the
 * public half is this static file, copied by vite from public/ into dist/.
 *
 * WHAT THIS GUARDS. The file exists, is one line, and has the registry's
 * exact shape with an algorithm the registry names (ed25519 or ecdsap384) and
 * a public key of the length that algorithm produces (32 bytes for Ed25519;
 * 49 bytes, a compressed P-384 point, for ECDSA). A later publish of a new
 * version must log in against this same key: if the file is edited to
 * something the registry cannot parse, or removed, the namespace stops being
 * ours the next time anyone runs mcp-publisher login, and nothing in the build
 * would say so.
 */

const ROOT = resolve(__dirname, "../..");
const FILE = resolve(ROOT, "public/.well-known/mcp-registry-auth");

describe("a namespace is proven by a key the site serves", () => {
  it("public/.well-known/mcp-registry-auth exists", () => {
    expect(existsSync(FILE), "the registry's HTTP domain proof is missing; publishing under work.resumebooster/* needs it").toBe(true);
  });

  it("carries exactly the registry's record shape with a key of the algorithm's length", () => {
    const text = readFileSync(FILE, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length);
    expect(lines, "one record, nothing else").toHaveLength(1);
    const m = /^v=MCPv1; k=(ed25519|ecdsap384); p=([A-Za-z0-9+/]+=*)$/.exec(lines[0]);
    expect(m, `unparseable record: ${lines[0]}`).not.toBeNull();
    const bytes = Buffer.from(m![2], "base64").length;
    const want = m![1] === "ed25519" ? 32 : 49;
    expect(bytes, `${m![1]} public key must be ${want} bytes, got ${bytes}`).toBe(want);
  });
});
