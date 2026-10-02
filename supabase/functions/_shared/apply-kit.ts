// WHICH PURCHASES INCLUDE THE APPLY KIT (generate-apply-package).
//
// Pure, no imports. The values are the product_type strings create-product-
// checkout actually writes into Stripe metadata -- snake_case, from its
// PRODUCTS table -- because that is the only spelling a session ever carries.
//
// THE INCIDENT. The gate shipped on 2026-07-11 accepting the FRONTEND's
// camelCase product keys (applyAssistant, premiumPackage, transitionPro).
// Stripe never sees those: create-product-checkout writes `apply_assistant`.
// The intersection with every minted value was empty, so the $7 Apply
// Assistant was refused for every buyer on every path from the day it went on
// sale, and the cross-file guard that would have compared the two spellings
// did not exist.
//
// WHY ONLY ONE. The old list also named the premium package and the freelance
// Transition Pro. Neither product's copy offers the job-tailored kit: the
// premium package promises a rewritten resume and cover letter (its own
// generator), Transition Pro a transition letter and LinkedIn About section
// (generate-freelance-boost). Accepting their sessions here would let one
// purchase redeem a second, different product. If the owner decides either
// should include the kit, its snake_case type is added here and nowhere else.
export const APPLY_KIT_PRODUCT_TYPES: readonly string[] = ["apply_assistant"];
