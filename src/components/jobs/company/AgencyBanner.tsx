// A STAFFING AGENCY'S BOARD SAYS WHOSE ROLES THESE ARE.
//
// /jobs/company/remote-recruitment carried "Staffing agency" on every card
// while its header said "straight from Remote Recruitment's own job board",
// "hires mostly in Finance & Accounting", "Filled 42 roles" and offered a claim
// (audit CP14). On an agency's board the header carries this banner as its one
// status element, and the page drops every employer-language block: the
// hiring record, perks, the claim and SEC figures. The flag is per board, so
// the banner speaks about the board, never about one posting.
import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function AgencyBanner() {
  const { t } = useTranslation();
  return (
    <p
      role="note"
      data-agency-banner=""
      className="flex items-start gap-2 rounded-md border border-border-strong bg-card px-3 py-2 text-meta text-foreground"
    >
      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{t("companyProfile.agency.banner", "This is a staffing agency's board. Roles here are usually for its clients.")}</span>
    </p>
  );
}
