import { useTranslation } from "react-i18next";
import { Plus, Trash2, GripVertical } from "lucide-react";
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

export function EducationEditor({ entries, onChange }: EducationEditorProps) {
  const { t } = useTranslation();
  const updateEntry = (id: string, patch: Partial<BuilderEducationEntry>) => {
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const addEntry = () => {
    onChange([...entries, createEmptyEducationEntry()]);
  };

  const removeEntry = (id: string) => {
    onChange(entries.filter((e) => e.id !== id));
  };

  return (
    <div className="space-y-5">
      {entries.map((entry, idx) => (
        <div key={entry.id} className="rounded-xl border border-border p-4 space-y-3 bg-card/50">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
              <GripVertical className="w-3.5 h-3.5" />
              {t("resumeBuilder.education.entry", { num: idx + 1 })}
            </div>
            {entries.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-destructive hover:text-destructive"
                onClick={() => removeEntry(entry.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("resumeBuilder.education.school")}</Label>
              <Input
                value={entry.school}
                onChange={(e) => updateEntry(entry.id, { school: e.target.value })}
                placeholder="University of California"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("resumeBuilder.education.degree")}</Label>
              <Input
                value={entry.degree}
                onChange={(e) => updateEntry(entry.id, { degree: e.target.value })}
                placeholder="B.S."
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("resumeBuilder.education.fieldOfStudy")}</Label>
              <Input
                value={entry.field}
                onChange={(e) => updateEntry(entry.id, { field: e.target.value })}
                placeholder="Computer Science"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">{t("resumeBuilder.education.startDate")}</Label>
                <Input
                  value={entry.startDate}
                  onChange={(e) => updateEntry(entry.id, { startDate: e.target.value })}
                  placeholder="2018"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("resumeBuilder.education.endDate")}</Label>
                <Input
                  value={entry.endDate}
                  onChange={(e) => updateEntry(entry.id, { endDate: e.target.value })}
                  placeholder="2022"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">{t("resumeBuilder.education.additionalDetails")}</Label>
            <Textarea
              value={entry.details}
              onChange={(e) => updateEntry(entry.id, { details: e.target.value })}
              placeholder="Relevant coursework, honors, GPA..."
              className="min-h-[44px] text-sm resize-none"
              rows={2}
            />
          </div>
        </div>
      ))}

      <Button variant="outline" className="w-full gap-2" onClick={addEntry}>
        <Plus className="w-4 h-4" />
        Add Education
      </Button>
    </div>
  );
}
