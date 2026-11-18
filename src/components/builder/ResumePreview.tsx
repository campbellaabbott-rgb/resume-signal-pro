import { useTranslation } from "react-i18next";
import { BuilderResume } from "@/types/resume-builder";
import { educationEntryHasContent, experienceEntryHasContent } from "@/lib/builder-import";
import { resumeSectionLabels } from "@/lib/resume-section-labels";

function formatDateRange(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return "";
  if (!startDate) return endDate;
  if (!endDate) return startDate;
  return `${startDate} – ${endDate}`;
}

/**
 * The preview beside the editor shows what the exports print (S14X-187,
 * S14X-035): the headings come from the same resumeSectionLabels, so a
 * German résumé is headed in German here as in its PDF, whatever the
 * interface language; a blank entry and a section with none left are not
 * shown; an entry with no title is headed by its company (never an English
 * "Role"); and a line break in a bullet shows as one.
 */
export function ResumePreview({ resume }: { resume: BuilderResume }) {
  const { t, i18n } = useTranslation();
  const labels = resumeSectionLabels(resume, { uiLanguage: i18n.language });
  const experience = (resume.experience ?? []).filter(experienceEntryHasContent);
  const education = (resume.education ?? []).filter(educationEntryHasContent);
  const skills = (resume.skills ?? []).filter((s) => s.trim());
  const certifications = (resume.certifications ?? []).filter((s) => s.trim());
  const contactLine = [
    resume.contact.email,
    resume.contact.phone,
    resume.contact.location,
    resume.contact.linkedIn,
    resume.contact.website,
  ]
    .filter(Boolean)
    .join("  •  ");

  return (
    <div className="bg-white text-neutral-900 rounded-lg shadow-sm border border-border p-8 text-sm leading-relaxed font-serif min-h-[600px]">
      <h1 className="text-2xl font-bold tracking-tight">{resume.contact.fullName || t("resumeBuilder.preview.yourName")}</h1>
      {resume.contact.title && <p className="text-neutral-600 mt-0.5">{resume.contact.title}</p>}
      {contactLine && <p className="text-xs text-neutral-500 mt-1">{contactLine}</p>}

      {resume.summary?.trim() && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider border-b border-neutral-300 pb-1 mb-2">{labels.summary}</h2>
          <p className="whitespace-pre-wrap">{resume.summary}</p>
        </section>
      )}

      {experience.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider border-b border-neutral-300 pb-1 mb-2">{labels.experience}</h2>
          <div className="space-y-4">
            {experience.map((entry) => {
              const companyLine = [entry.title ? entry.company : "", entry.location].filter(Boolean).join(" — ");
              const bullets = (entry.bullets ?? []).filter((b) => b.trim());
              return (
                <div key={entry.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{entry.title || entry.company}</span>
                    <span className="text-xs text-neutral-500 shrink-0">{formatDateRange(entry.startDate, entry.endDate)}</span>
                  </div>
                  {companyLine && <p className="italic text-neutral-600 text-[13px]">{companyLine}</p>}
                  {bullets.length > 0 && (
                    <ul className="list-disc list-outside ml-4 mt-1 space-y-0.5">
                      {bullets.map((bullet, i) => (
                        <li key={i} className="whitespace-pre-wrap">{bullet}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {education.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider border-b border-neutral-300 pb-1 mb-2">{labels.education}</h2>
          <div className="space-y-3">
            {education.map((entry) => {
              const degreeLine = [entry.degree, entry.field].filter(Boolean).join(", ");
              return (
                <div key={entry.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{degreeLine || entry.school}</span>
                    <span className="text-xs text-neutral-500 shrink-0">{formatDateRange(entry.startDate, entry.endDate)}</span>
                  </div>
                  {degreeLine && entry.school && <p className="italic text-neutral-600 text-[13px]">{entry.school}</p>}
                  {entry.details && <p className="text-[13px] mt-0.5 whitespace-pre-wrap">{entry.details}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {skills.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider border-b border-neutral-300 pb-1 mb-2">{labels.skills}</h2>
          <p>{skills.join("  •  ")}</p>
        </section>
      )}

      {certifications.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider border-b border-neutral-300 pb-1 mb-2">{labels.certifications}</h2>
          <p>{certifications.join("  •  ")}</p>
        </section>
      )}
    </div>
  );
}
