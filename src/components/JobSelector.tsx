import { useState } from "react";
import { Check, Building2, MapPin, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface JobEntry {
  id: string;
  title: string;
  company: string;
  description: string;
  location?: string;
  url?: string;
}

interface JobSelectorProps {
  jobs: JobEntry[];
  selectedJobId: string | null;
  onSelect: (job: JobEntry) => void;
  onCancel: () => void;
}

export function JobSelector({ jobs, selectedJobId, onSelect, onCancel }: JobSelectorProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-semibold text-foreground">Select a Job to Analyze Against</h4>
          <p className="text-sm text-muted-foreground">
            Found {jobs.length} job{jobs.length !== 1 ? 's' : ''} in your spreadsheet
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
        {jobs.map((job) => {
          const isSelected = selectedJobId === job.id;
          const isExpanded = expandedId === job.id;
          const truncatedDesc = job.description.length > 150 
            ? job.description.slice(0, 150) + '...' 
            : job.description;

          return (
            <div
              key={job.id}
              className={cn(
                "rounded-xl border transition-all cursor-pointer",
                isSelected 
                  ? "border-success bg-success/5" 
                  : "border-border/50 hover:border-border bg-card/50 hover:bg-card"
              )}
            >
              <div 
                className="p-4"
                onClick={() => onSelect(job)}
              >
                <div className="flex items-start gap-3">
                  {/* Selection indicator */}
                  <div className={cn(
                    "mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                    isSelected 
                      ? "border-success bg-success" 
                      : "border-muted-foreground/30"
                  )}>
                    {isSelected && <Check className="w-3 h-3 text-success-foreground" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Title */}
                    <h5 className="font-medium text-foreground truncate">{job.title}</h5>
                    
                    {/* Company & Location */}
                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5" />
                        {job.company}
                      </span>
                      {job.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          {job.location}
                        </span>
                      )}
                    </div>

                    {/* Description preview */}
                    <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                      {isExpanded ? job.description : truncatedDesc}
                    </p>

                    {/* Expand/URL actions */}
                    <div className="flex items-center gap-2 mt-2">
                      {job.description.length > 150 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(job.id);
                          }}
                          className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="w-3 h-3" />
                              Show less
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3 h-3" />
                              Show more
                            </>
                          )}
                        </button>
                      )}
                      {job.url && (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View listing
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedJobId && (
        <div className="pt-2 border-t border-border/50">
          <p className="text-xs text-success flex items-center gap-1">
            <Check className="w-3 h-3" />
            Selected: {jobs.find(j => j.id === selectedJobId)?.title}
          </p>
        </div>
      )}
    </div>
  );
}
