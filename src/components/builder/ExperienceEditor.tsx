import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  BuilderExperienceEntry,
  createEmptyExperienceEntry,
} from "@/types/resume-builder";

interface ExperienceEditorProps {
  entries: BuilderExperienceEntry[];
  onChange: (entries: BuilderExperienceEntry[]) => void;
}

/**
 * The jobs on /builder.
 *
 * NB-45: each label is tied to its field (htmlFor/id), so a screen reader
 * names a field by its label, not by its sample text; each bullet is named
 * by its number, and every icon button says what it does.
 * S14X-035: every job has a delete button, the last one too (a résumé with
 * no work history can remove the blank job a new résumé starts with).
 * S14X-188: Move up and Move down replace the grip icon, which looked like a
 * drag handle and did nothing.
 */
export function ExperienceEditor({ entries, onChange }: ExperienceEditorProps) {
  const { t } = useTranslation();
  const uid = useId();
  const updateEntry = (id: string, patch: Partial<BuilderExperienceEntry>) => {
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const updateBullet = (id: string, index: number, value: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    const bullets = [...entry.bullets];
    bullets[index] = value;
    updateEntry(id, { bullets });
  };

  const addBullet = (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    updateEntry(id, { bullets: [...entry.bullets, ""] });
  };

  const removeBullet = (id: string, index: number) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    const bullets = entry.bullets.filter((_, i) => i !== index);
    updateEntry(id, { bullets: bullets.length > 0 ? bullets : [""] });
  };

  const addEntry = () => {
    onChange([...entries, createEmptyExperienceEntry()]);
  };

  const removeEntry = (id: string) => {
    onChange(entries.filter((e) => e.id !== id));
  };

  const moveEntry = (from: number, to: number) => {
    if (to < 0 || to >= entries.length) return;
    const next = [...entries];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };

  return (
    <div className="space-y-5">
      {entries.map((entry, idx) => {
        const fid = (name: string) => `${uid}-${idx}-${name}`;
        return (
          <div key={entry.id} className="rounded-xl border border-border p-4 space-y-3 bg-card/50">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  aria-label={t("builderPage.moveUp")}
                  disabled={idx === 0}
                  onClick={() => moveEntry(idx, idx - 1)}
                >
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  aria-label={t("builderPage.moveDown")}
                  disabled={idx === entries.length - 1}
                  onClick={() => moveEntry(idx, idx + 1)}
                >
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
                <span className="ml-1">{t("resumeBuilder.experience.role", { num: idx + 1 })}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-destructive hover:text-destructive"
                aria-label={t("builderPage.removeEntry")}
                onClick={() => removeEntry(entry.id)}
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={fid("title")} className="text-xs">{t("resumeBuilder.experience.jobTitle")}</Label>
                <Input
                  id={fid("title")}
                  value={entry.title}
                  onChange={(e) => updateEntry(entry.id, { title: e.target.value })}
                  placeholder={t("resumeBuilder.experience.placeholder.jobTitle")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={fid("company")} className="text-xs">{t("resumeBuilder.experience.company")}</Label>
                <Input
                  id={fid("company")}
                  value={entry.company}
                  onChange={(e) => updateEntry(entry.id, { company: e.target.value })}
                  placeholder={t("resumeBuilder.experience.placeholder.company")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={fid("location")} className="text-xs">{t("resumeBuilder.experience.location")}</Label>
                <Input
                  id={fid("location")}
                  value={entry.location}
                  onChange={(e) => updateEntry(entry.id, { location: e.target.value })}
                  placeholder={t("resumeBuilder.experience.placeholder.location")}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor={fid("start")} className="text-xs">{t("resumeBuilder.experience.startDate")}</Label>
                  <Input
                    id={fid("start")}
                    value={entry.startDate}
                    onChange={(e) => updateEntry(entry.id, { startDate: e.target.value })}
                    placeholder={t("resumeBuilder.experience.placeholder.startDate")}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={fid("end")} className="text-xs">{t("resumeBuilder.experience.endDate")}</Label>
                  <Input
                    id={fid("end")}
                    value={entry.endDate}
                    onChange={(e) => updateEntry(entry.id, { endDate: e.target.value })}
                    placeholder={t("resumeBuilder.experience.placeholder.endDate")}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2" role="group" aria-labelledby={fid("bullets")}>
              <Label id={fid("bullets")} className="text-xs">{t("resumeBuilder.experience.bulletPoints")}</Label>
              {entry.bullets.map((bullet, bIdx) => (
                <div key={bIdx} className="flex items-start gap-2">
                  <Textarea
                    value={bullet}
                    onChange={(e) => updateBullet(entry.id, bIdx, e.target.value)}
                    placeholder={t("resumeBuilder.experience.placeholder.bullet")}
                    aria-label={t("builderPage.bullet", { num: bIdx + 1 })}
                    className="min-h-[44px] text-sm resize-none"
                    rows={2}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 px-2 text-muted-foreground hover:text-destructive shrink-0"
                    aria-label={t("builderPage.removeBullet")}
                    onClick={() => removeBullet(entry.id, bIdx)}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => addBullet(entry.id)}>
                <Plus className="w-3.5 h-3.5" />
                {t("resumeBuilder.experience.addBullet")}
              </Button>
            </div>
          </div>
        );
      })}

      <Button type="button" variant="outline" className="w-full gap-2" onClick={addEntry}>
        <Plus className="w-4 h-4" />
        {t("resumeBuilder.experience.addWorkExperience")}
      </Button>
    </div>
  );
}
