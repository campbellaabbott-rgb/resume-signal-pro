import { Plus, Trash2, GripVertical } from "lucide-react";
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

export function ExperienceEditor({ entries, onChange }: ExperienceEditorProps) {
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

  return (
    <div className="space-y-5">
      {entries.map((entry, idx) => (
        <div key={entry.id} className="rounded-xl border border-border p-4 space-y-3 bg-card/50">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
              <GripVertical className="w-3.5 h-3.5" />
              Role {idx + 1}
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
              <Label className="text-xs">Job Title</Label>
              <Input
                value={entry.title}
                onChange={(e) => updateEntry(entry.id, { title: e.target.value })}
                placeholder="Senior Software Engineer"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Company</Label>
              <Input
                value={entry.company}
                onChange={(e) => updateEntry(entry.id, { company: e.target.value })}
                placeholder="Acme Corp"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Location</Label>
              <Input
                value={entry.location}
                onChange={(e) => updateEntry(entry.id, { location: e.target.value })}
                placeholder="Remote"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Start Date</Label>
                <Input
                  value={entry.startDate}
                  onChange={(e) => updateEntry(entry.id, { startDate: e.target.value })}
                  placeholder="Jan 2022"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End Date</Label>
                <Input
                  value={entry.endDate}
                  onChange={(e) => updateEntry(entry.id, { endDate: e.target.value })}
                  placeholder="Present"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Bullet Points</Label>
            {entry.bullets.map((bullet, bIdx) => (
              <div key={bIdx} className="flex items-start gap-2">
                <Textarea
                  value={bullet}
                  onChange={(e) => updateBullet(entry.id, bIdx, e.target.value)}
                  placeholder="Led a team of 5 engineers to ship..."
                  className="min-h-[44px] text-sm resize-none"
                  rows={2}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeBullet(entry.id, bIdx)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => addBullet(entry.id)}>
              <Plus className="w-3.5 h-3.5" />
              Add Bullet
            </Button>
          </div>
        </div>
      ))}

      <Button variant="outline" className="w-full gap-2" onClick={addEntry}>
        <Plus className="w-4 h-4" />
        Add Work Experience
      </Button>
    </div>
  );
}
