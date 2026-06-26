import { BuilderResume } from "@/types/resume-builder";

function formatDateRange(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return "";
  if (!startDate) return endDate;
  if (!endDate) return startDate;
  return `${startDate} – ${endDate}`;
}

export function ResumePreview({ resume }: { resume: BuilderResume }) {
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
      <h1 className="text-2xl font-bold tracking-tight">{resume.contact.fullName || "Your Name"}</h1>
      {resume.contact.title && <p className="text-neutral-600 mt-0.5">{resume.contact.title}</p>}
      {contactLine && <p className="text-xs text-neutral-500 mt-1">{contactLine}</p>}

      {resume.summary && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider border-b border-neutral-300 pb-1 mb-2">Summary</h2>
          <p className="whitespace-pre-wrap">{resume.summary}</p>
        </section>
      )}

      {resume.experience.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider border-b border-neutral-300 pb-1 mb-2">Experience</h2>
          <div className="space-y-4">
            {resume.experience.map((entry) => (
              <div key={entry.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{entry.title || "Role"}</span>
                  <span className="text-xs text-neutral-500 shrink-0">{formatDateRange(entry.startDate, entry.endDate)}</span>
                </div>
                {(entry.company || entry.location) && (
                  <p className="italic text-neutral-600 text-[13px]">
                    {[entry.company, entry.location].filter(Boolean).join(" — ")}
                  </p>
                )}
                {entry.bullets.filter((b) => b.trim()).length > 0 && (
                  <ul className="list-disc list-outside ml-4 mt-1 space-y-0.5">
                    {entry.bullets
                      .filter((b) => b.trim())
                      .map((bullet, i) => (
                        <li key={i}>{bullet}</li>
                      ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {resume.education.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider border-b border-neutral-300 pb-1 mb-2">Education</h2>
          <div className="space-y-3">
            {resume.education.map((entry) => {
              const degreeLine = [entry.degree, entry.field].filter(Boolean).join(", ");
              return (
                <div key={entry.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{degreeLine || entry.school}</span>
                    <span className="text-xs text-neutral-500 shrink-0">{formatDateRange(entry.startDate, entry.endDate)}</span>
                  </div>
                  {degreeLine && entry.school && <p className="italic text-neutral-600 text-[13px]">{entry.school}</p>}
                  {entry.details && <p className="text-[13px] mt-0.5">{entry.details}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {resume.skills.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider border-b border-neutral-300 pb-1 mb-2">Skills</h2>
          <p>{resume.skills.join("  •  ")}</p>
        </section>
      )}

      {resume.certifications.length > 0 && (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider border-b border-neutral-300 pb-1 mb-2">Certifications</h2>
          <p>{resume.certifications.join("  •  ")}</p>
        </section>
      )}
    </div>
  );
}
