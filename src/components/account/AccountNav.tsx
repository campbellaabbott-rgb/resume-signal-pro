// Sticky section navigation for the account HQ — the page grew into a deep
// stack of tools, and findability is the upgrade: four stable jump points,
// always visible, matching the section ids in Account.tsx.

import { useTranslation } from "react-i18next";

export function AccountNav() {
  const { t } = useTranslation();
  const items: Array<[string, string]> = [
    ["#hq", t("accountPage.navOverview", "Overview")],
    ["#pipeline", t("accountPage.navPipeline", "Pipeline")],
    ["#searches", t("accountPage.navSearches", "Searches")],
    ["#resume-tools", t("accountPage.navResume", "Résumé")],
  ];
  return (
    <nav
      aria-label={t("accountPage.navLabel", "Account sections")}
      className="sticky top-16 z-20 -mx-1 px-1 py-2 mb-4 bg-background/80 backdrop-blur-md flex items-center gap-2 overflow-x-auto"
    >
      {items.map(([href, label]) => (
        <a
          key={href}
          href={href}
          className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
