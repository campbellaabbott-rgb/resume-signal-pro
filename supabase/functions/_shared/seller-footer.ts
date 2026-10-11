/**
 * THE SELLER LINE IN A MARKETING MAIL'S FOOTER, OR NOTHING.
 *
 * The legal name and postal address from _shared/seller-identity.ts, escaped,
 * only when BOTH are set; an empty identity renders the empty string so no
 * mail prints a blank "Sent by" or an invented one. One builder for every
 * mailer: this module hands on _shared/seller.ts's (wave 3 integration: the
 * email-ops and payments-account groups each wrote one).
 */
export { sellerFooterHtml } from "../_shared/seller.ts";
