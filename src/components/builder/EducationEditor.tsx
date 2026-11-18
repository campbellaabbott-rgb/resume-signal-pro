import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  BuilderEducationEntry,
  createEmptyEducationEntry,
} from "@/types/resume-builder";

interface EducationEditorProps {
  entries: BuilderEducationEntry[];
  onChange: (entries: BuilderEducationEntry[]) => void;
}

/**
 * The schools on /builder. Labels tied to their fields (NB-45), a delete
 * button on every school, the last one too (S14X-035), and Move up and Move
 * down in place of the grip icon that did nothing (S14X-188).
 */
export function EducationEditor({ entries, onChange }: EducationEditorProps) {
  const { t } = useTranslation();
  const uid = useId();
  const updateEntry = (id: string, patch: Partial<BuilderEducationEntry>) => {
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const addEntry = () => {
    onChange([...entries, createEmptyEducationEntry()]);
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
                <span className="ml-1">{t("resumeBuilder.education.entry", { num: idx + 1 })}</span>
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
                <Label htmlFor={fid("school")} className="text-xs">{t("resumeBuilder.education.school")}</Label>
                <Input
                  id={fid("school")}
                  value={entry.school}
                  onChange={(e) => updateEntry(entry.id, { school: e.target.value })}
                  placeholder={t("resumeBuilder.education.placeholder.school")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={fid("degree")} className="text-xs">{t("resumeBuilder.education.degree")}</Label>
                <Input
                  id={fid("degree")}
                  value={entry.degree}
                  onChange={(e) => updateEntry(entry.id, { degree: e.target.value })}
                  placeholder={t("resumeBuilder.education.placeholder.degree")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={fid("field")} className="text-xs">{t("resumeBuilder.education.fieldOfStudy")}</Label>
                <Input
                  id={fid("field")}
                  value={entry.field}
                  onChange={(e) => updateEntry(entry.id, { field: e.target.value })}
                  placeholder={t("resumeBuilder.education.placeholder.field")}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor={fid("start")} className="text-xs">{t("resumeBuilder.education.startDate")}</Label>
                  <Input
                    id={fid("start")}
                    value={entry.startDate}
                    onChange={(e) => updateEntry(entry.id, { startDate: e.target.value })}
                    placeholder="2018"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={fid("end")} className="text-xs">{t("resumeBuilder.education.endDate")}</Label>
                  <Input
                    id={fid("end")}
                    value={entry.endDate}
                    onChange={(e) => updateEntry(entry.id, { endDate: e.target.value })}
                    placeholder="2022"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor={fid("details")} className="text-xs">{t("resumeBuilder.education.additionalDetails")}</Label>
              <Textarea
                id={fid("details")}
                value={entry.details}
                onChange={(e) => updateEntry(entry.id, { details: e.target.value })}
                placeholder={t("resumeBuilder.education.placeholder.details")}
                className="min-h-[44px] text-sm resize-none"
                rows={2}
              />
            </div>
          </div>
        );
      })}

      <Button type="button" variant="outline" className="w-full gap-2" onClick={addEntry}>
        <Plus className="w-4 h-4" />
        {t("resumeBuilder.education.addEducation")}
      </Button>
    </div>
  );
}
