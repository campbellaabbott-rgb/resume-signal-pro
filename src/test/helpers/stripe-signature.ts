/**
 * A STRIPE FAKE THAT CHECKS THE SIGNATURE THE WAY STRIPE DOES (S11-050).
 *
 * Every webhook fake in the suite was `constructEventAsync: async (body) =>
 * JSON.parse(body)`: it accepted any signature, so deleting the webhook's
 * signature check, or its missing-header 400, failed nothing. This one is
 * Stripe's scheme: the header is `t=<unix seconds>,v1=<hex>` and v1 is
 * HMAC-SHA256(secret, `${t}.${body}`); a header without a matching v1, or a
 * timestamp outside the five-minute tolerance, throws as the real library
 * does.
 *
 *   STRIPE_WEBHOOKS_REAL_SHAPE  JS for an edge-harness stub: an object with
 *                               constructEventAsync, using Web Crypto
 *   signStripePayload(body, secret, t?)  the header a real Stripe would send
 */
import { createHmac } from "node:crypto";

export function signStripePayload(body: string, secret: string, t: number = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export const STRIPE_WEBHOOKS_REAL_SHAPE = `{
  constructEventAsync: async (body, header, secret, tolerance = 300) => {
    const parts = Object.fromEntries(String(header || "").split(",").map((p) => p.split("=")).filter((p) => p.length === 2));
    const t = Number(parts.t);
    if (!Number.isFinite(t) || !parts.v1) throw new Error("Unable to extract timestamp and signatures from header");
    if (Math.abs(Date.now() / 1000 - t) > tolerance) throw new Error("Timestamp outside the tolerance zone");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + body)));
    const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== parts.v1) throw new Error("No signatures found matching the expected signature for payload");
    return JSON.parse(body);
  },
}`;
