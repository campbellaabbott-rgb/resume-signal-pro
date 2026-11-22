import { useTranslation } from "react-i18next";
import { useState, KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TagListEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  /**
   * The input's accessible name: the heading of the section it sits under
   * (NB-45). A placeholder is no name; it is gone once the reader types.
   * The builder passes it for every list it mounts.
   */
  label?: string;
  className?: string;
}

export function TagListEditor({ tags, onChange, placeholder, label, className }: TagListEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  const commitDraft = () => {
    const value = draft.trim();
    if (value && !tags.includes(value)) {
      onChange([...tags, value]);
    }
    setDraft("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && !draft && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={t("builderPage.removeTag", { tag })}
              className="hover:text-destructive transition-colors"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitDraft}
        placeholder={placeholder || t("resumeBuilder.tagList.typeToAdd")}
        aria-label={label}
        className="h-9"
      />
    </div>
  );
}
