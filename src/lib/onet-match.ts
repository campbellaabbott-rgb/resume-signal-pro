/**
 * Whether an industry's O*NET occupation may be cited on a ROLE's page
 * (register L1-05, S11-152).
 *
 * Each industry maps to one representative O*NET occupation, and every role
 * page in that industry printed it as "Core skills per the U.S. Department of
 * Labor": /roles/pilot cited 49-3011.00 Aircraft Mechanics, the dentist page
 * Dental Hygienists, the professor page Elementary School Teachers, the
 * plumber page Electricians. 120 of 174 role pages attributed someone else's
 * occupation to a government source.
 *
 * A word-overlap test replaced that, and was wrong both ways (S11-152): it
 * dropped words under three letters and stemmed asymmetrically, so /roles/rn,
 * /roles/cpa and /roles/attorney lost their own occupation, and it matched
 * "engineer" alone, so the civil and electrical engineer pages cited
 * Mechanical Engineers, and the HR manager page HR Specialists.
 *
 * Now the page cites the occupation only when this table names the role's
 * slug with that occupation's O*NET-SOC code: a reviewed statement that the
 * role is a job title of that occupation (its own name, or a title O*NET
 * reports for it). A slug with no row, or a row whose code is not the
 * industry entry's, cites nothing. A test holds every row to an existing
 * role and to its industry entry's code.
 */
export const ROLE_ONET_SOC: ReadonlyMap<string, string> = new Map([
  ["lecturer", "25-1099.00"],
  ["administrative-assistant", "43-6011.00"],
  ["admin-assistant", "43-6011.00"],
  ["executive-assistant", "43-6011.00"],
  ["farm-manager", "11-9013.00"],
  ["ranch-manager", "11-9013.00"],
  ["research-scientist", "19-1029.00"],
  ["construction-manager", "11-9021.00"],
  ["construction-project-manager", "11-9021.00"],
  ["project-manager-construction", "11-9021.00"],
  ["business-analyst", "13-1111.00"],
  ["strategy-analyst", "13-1111.00"],
  ["consultant", "13-1111.00"],
  ["graphic-designer", "27-1024.00"],
  ["chef", "35-1011.00"],
  ["customer-service-representative", "43-4051.00"],
  ["customer-support-specialist", "43-4051.00"],
  ["security-analyst", "15-1212.00"],
  ["soc-analyst", "15-1212.00"],
  ["data-scientist", "15-2051.00"],
  ["dental-hygienist", "29-1292.00"],
  ["teacher", "25-2021.00"],
  ["mechanical-engineer", "17-2141.00"],
  ["accountant", "13-2011.00"],
  ["cpa", "13-2011.00"],
  ["fitness-instructor", "39-9031.00"],
  ["personal-trainer", "39-9031.00"],
  ["registered-nurse", "29-1141.00"],
  ["rn", "29-1141.00"],
  ["hotel-manager", "11-9081.00"],
  ["insurance-agent", "41-3021.00"],
  ["insurance-broker", "41-3021.00"],
  ["patrol-officer", "33-3051.00"],
  ["police-officer", "33-3051.00"],
  ["lawyer", "23-1011.00"],
  ["attorney", "23-1011.00"],
  ["counsel", "23-1011.00"],
  ["logistics-coordinator", "13-1081.00"],
  ["production-manager", "11-3051.00"],
  ["plant-manager", "11-3051.00"],
  ["marketing-director", "11-2021.00"],
  ["marketing-manager", "11-2021.00"],
  ["journalist", "27-3023.00"],
  ["reporter", "27-3023.00"],
  ["pharmacist", "29-1051.00"],
  ["pharmacy-manager", "29-1051.00"],
  ["real-estate-agent", "41-9022.00"],
  ["realtor", "41-9022.00"],
  ["retail-manager", "41-1011.00"],
  ["store-manager", "41-1011.00"],
  ["sales-representative", "41-3091.00"],
  ["account-executive", "41-3091.00"],
  ["electrician", "47-2111.00"],
  ["social-worker", "21-1021.00"],
  ["full-stack-developer", "15-1252.00"],
  ["software-developer", "15-1252.00"],
  ["software-engineer", "15-1252.00"],
  ["veterinary-technician", "29-2056.00"],
  ["vet-tech", "29-2056.00"],
]);

/** True when the table names this role with this occupation's code. */
export function onetCitesRole(roleSlug: string, onet: { code: string } | null | undefined): boolean {
  return !!onet && typeof onet.code === "string" && ROLE_ONET_SOC.get(String(roleSlug ?? "")) === onet.code;
}

/** The industry's O*NET entry when the table names this role with it, else null. */
export function onetForRole<T extends { code: string }>(role: { slug: string }, onet: T | null | undefined): T | null {
  return onet && onetCitesRole(role?.slug, onet) ? onet : null;
}
