/**
 * THE SELLER LINE IN A MARKETING MAIL'S FOOTER, OR NOTHING.
 *
 * Renders the legal name and postal address from _shared/seller-identity.ts,
 * escaped, only when BOTH are set; an empty identity renders the empty string
 * so no mail prints a blank "Sent by" or an invented one.
 */
import { SELLER_IDENTITY } from "../_shared/seller-identity.ts"; // by this path, so a test can fill it

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c] as string));

export function sellerFooterHtml(identity: { legalName: string; postalAddress: string } = SELLER_IDENTITY): string {
  const name = identity.legalName.trim();
  const address = identity.postalAddress.trim();
  if (!name || !address) return "";
  return `<p style="font-size:11px;color:#94a3b8;text-align:center;margin:8px 0 0">${esc(name)} &middot; ${esc(address)}</p>`;
}
