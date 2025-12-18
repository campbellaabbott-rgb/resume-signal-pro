import { useState, useCallback, useEffect } from "react";
import { Upload, FileText, X, Loader2, CheckCircle2, Sparkles, CreditCard, Linkedin, Target, Zap, Link, Table2, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useCurrency } from "@/hooks/use-currency";
import { JobSelector, type JobEntry } from "@/components/JobSelector";
import { JobComparisonCTA } from "@/components/JobComparisonCTA";
const ANALYSIS_STEPS = [
  "Parsing resume content...",
  "Analyzing ATS compatibility...",
  "Evaluating formatting...",
  "Scanning keywords...",
  "Detecting industry...",
  "Calculating metrics...",
  "Generating insights...",
  "Finalizing report..."
];

const ESTIMATED_TIME_SECONDS = 90; // 1.5 minutes

function FreeScanProgress() {
  const [progress, setProgress] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedSeconds(elapsed);
      
      // Progress increases faster at first, then slows down (asymptotic approach to 95%)
      const newProgress = Math.min(95, (1 - Math.exp(-elapsed / 40)) * 100);
      setProgress(newProgress);
      
      // Cycle through steps based on progress
      const newStepIndex = Math.min(
        ANALYSIS_STEPS.length - 1,
        Math.floor((newProgress / 100) * ANALYSIS_STEPS.length)
      );
      setStepIndex(newStepIndex);
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const remainingSeconds = Math.max(0, ESTIMATED_TIME_SECONDS - elapsedSeconds);
  const remainingMinutes = Math.floor(remainingSeconds / 60);
  const remainingSecondsDisplay = remainingSeconds % 60;

  return (
    <div className="min-w-[320px] p-6 rounded-2xl border border-success/30 bg-success/5 space-y-4">
      <div className="flex items-center justify-center gap-3">
        <Loader2 className="w-5 h-5 text-success animate-spin" />
        <span className="text-sm font-medium text-foreground">Analyzing your resume...</span>
      </div>
      
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-success to-success/70 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{Math.round(progress)}% complete</span>
          <span>
            ~{remainingMinutes > 0 ? `${remainingMinutes}m ` : ''}{remainingSecondsDisplay}s remaining
          </span>
        </div>
      </div>

      {/* Current step */}
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="w-3.5 h-3.5 text-success" />
        <span>{ANALYSIS_STEPS[stepIndex]}</span>
      </div>
    </div>
  );
}

interface ResumeUploaderProps {
  onFileSelect: (file: File) => void;
  onTextSubmit: (text: string, linkedInText?: string, jobDescriptionText?: string) => void;
  onCheckout: (linkedInText?: string, jobDescriptionText?: string) => void;
  onFreeScan?: () => void;
  isLoading?: boolean;
  isFreeScanLoading?: boolean;
  hasContent?: boolean;
  linkedInText?: string;
  onLinkedInTextChange?: (text: string) => void;
  jobDescriptionText?: string;
  onJobDescriptionTextChange?: (text: string) => void;
  onJobsChange?: (jobs: JobEntry[]) => void;
}

export function ResumeUploader({ 
  onFileSelect, 
  onTextSubmit, 
  onCheckout,
  onFreeScan,
  isLoading,
  isFreeScanLoading,
  hasContent,
  linkedInText = "",
  onLinkedInTextChange,
  jobDescriptionText = "",
  onJobDescriptionTextChange,
  onJobsChange
}: ResumeUploaderProps) {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [textInput, setTextInput] = useState("");
  const [resumeMode, setResumeMode] = useState<"upload" | "paste">("upload");
  const [linkedInMode, setLinkedInMode] = useState<"upload" | "paste">("upload");
  const [linkedInFile, setLinkedInFile] = useState<File | null>(null);
  const [localLinkedInText, setLocalLinkedInText] = useState("");
  const [showLinkedIn, setShowLinkedIn] = useState(true);
  const [showJobDescription, setShowJobDescription] = useState(true);
  const [localJobDescriptionText, setLocalJobDescriptionText] = useState("");
  const [jobDescriptionMode, setJobDescriptionMode] = useState<"paste" | "url" | "spreadsheet">("paste");
  const [jobDescriptionUrl, setJobDescriptionUrl] = useState("");
  const [jobDescriptionFile, setJobDescriptionFile] = useState<File | null>(null);
  const [isParsingJobDescription, setIsParsingJobDescription] = useState(false);
  const [isParsingLinkedIn, setIsParsingLinkedIn] = useState(false);
  const [parsedJobs, setParsedJobs] = useState<JobEntry[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobEntry | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const isValidFileType = (file: File) => {
    const validTypes = [
      "application/pdf",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    return validTypes.includes(file.type) || file.name.endsWith(".docx");
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    const file = e.dataTransfer.files[0];
    if (file && isValidFileType(file)) {
      setSelectedFile(file);
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const clearFile = () => {
    setSelectedFile(null);
  };

  const handleLinkedInFileUpload = async (file: File) => {
    if (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
      return;
    }
    
    setLinkedInFile(file);
    setIsParsingLinkedIn(true);
    
    try {
      const formData = new FormData();
      formData.append("file", file);

      const { data, error } = await supabase.functions.invoke("parse-pdf", {
        body: formData,
      });

      if (error) throw error;

      if (data?.success && data?.text) {
        onLinkedInTextChange?.(data.text);
      } else {
        throw new Error(data?.error || "Failed to parse LinkedIn PDF");
      }
    } catch (error) {
      console.error("LinkedIn PDF parsing error:", error);
      setLinkedInFile(null);
    } finally {
      setIsParsingLinkedIn(false);
    }
  };

  const handleJobDescriptionSpreadsheetUpload = async (file: File) => {
    const validTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv"
    ];
    const isValid = validTypes.includes(file.type) || 
                   file.name.endsWith(".xlsx") || 
                   file.name.endsWith(".xls") || 
                   file.name.endsWith(".csv");
    
    if (!isValid) return;
    
    setJobDescriptionFile(file);
    setIsParsingJobDescription(true);
    setParsedJobs([]);
    setSelectedJob(null);
    
    try {
      // For CSV files, use the edge function to parse
      if (file.type === "text/csv" || file.name.endsWith(".csv")) {
        const formData = new FormData();
        formData.append("file", file);
        
        const { data, error } = await supabase.functions.invoke("parse-spreadsheet", {
          body: formData,
        });
        
        if (error) throw error;
        
        if (data?.success && data?.jobs?.length > 0) {
          setParsedJobs(data.jobs);
          onJobsChange?.(data.jobs);
          // If only one job, auto-select it
          if (data.jobs.length === 1) {
            handleJobSelect(data.jobs[0]);
          }
        } else if (data?.error) {
          console.error("Spreadsheet parsing error:", data.error);
          setLocalJobDescriptionText(`Error: ${data.error}\n\n${data.suggestion || ''}`);
        }
      } else {
        // For Excel files - show guidance
        setLocalJobDescriptionText(`[Spreadsheet uploaded: ${file.name}]\n\nFor best results with Excel files, please export as CSV:\n• In Excel: File > Save As > CSV\n• In Google Sheets: File > Download > CSV`);
      }
    } catch (error) {
      console.error("Spreadsheet parsing error:", error);
      setJobDescriptionFile(null);
    } finally {
      setIsParsingJobDescription(false);
    }
  };

  const handleJobSelect = (job: JobEntry) => {
    setSelectedJob(job);
    // Update parent with the selected job for CTAs
    onJobsChange?.([job]);
    // Format the job description for analysis
    const formattedJob = `Job Title: ${job.title}\nCompany: ${job.company}${job.location ? `\nLocation: ${job.location}` : ''}\n\nJob Description:\n${job.description}`;
    setLocalJobDescriptionText(formattedJob);
  };

  const handleCancelJobSelection = () => {
    setParsedJobs([]);
    onJobsChange?.([]);
    setSelectedJob(null);
    setJobDescriptionFile(null);
    setLocalJobDescriptionText("");
  };

  const getFinalJobDescriptionText = () => {
    if (jobDescriptionMode === "url" && jobDescriptionUrl.trim()) {
      return `[Job URL: ${jobDescriptionUrl.trim()}]\n\n${localJobDescriptionText}`;
    }
    return localJobDescriptionText || jobDescriptionText;
  };

  const handleTextPaste = () => {
    if (textInput.trim()) {
      const finalLinkedInText = linkedInMode === "paste" ? localLinkedInText : linkedInText;
      const finalJobDescriptionText = getFinalJobDescriptionText();
      onTextSubmit(textInput.trim(), finalLinkedInText || undefined, finalJobDescriptionText || undefined);
    }
  };

  const handleCheckoutClick = () => {
    const finalLinkedInText = linkedInMode === "paste" ? localLinkedInText : linkedInText;
    const finalJobDescriptionText = getFinalJobDescriptionText();
    onCheckout(finalLinkedInText || undefined, finalJobDescriptionText || undefined);
  };

  const canProceed = resumeMode === "upload" ? !!selectedFile : !!textInput.trim();
  const hasLinkedInContent = linkedInMode === "upload" ? !!linkedInText : !!localLinkedInText.trim();
  const hasJobDescriptionContent = !!localJobDescriptionText.trim() || !!jobDescriptionText || !!jobDescriptionUrl.trim() || !!jobDescriptionFile;

  return (
    <section 
      id="upload" 
      className="py-20 relative scroll-mt-20" 
      aria-labelledby="upload-heading"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent pointer-events-none" aria-hidden="true" />
      
      <div className="container relative">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <h2 id="upload-heading" className="text-2xl md:text-3xl font-bold mb-3">
              {t('uploader.title')}
            </h2>
            <p className="text-muted-foreground">
              {t('uploader.subtitle')} <span className="text-primary font-medium">{t('uploader.linkedinBonus')}</span>
            </p>
          </div>

          {/* Job Description Section - FIRST */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-success/10">
                  <Target className="w-4 h-4 text-success" />
                </div>
                <h3 className="font-semibold">{t('uploader.jobDescription.title')}</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">Free & Unlimited</span>
              </div>
              <button
                onClick={() => setShowJobDescription(!showJobDescription)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showJobDescription ? t('uploader.jobDescription.hide') : t('uploader.jobDescription.show')}
              </button>
            </div>

            {showJobDescription && (
              <div className="rounded-2xl bg-card/30 border border-border/30 p-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  <span className="text-success font-medium">✨ Unlimited free job comparisons!</span> {t('uploader.jobDescription.description')} <span className="text-foreground font-medium">{t('uploader.jobDescription.matchScore')}, extracted keywords,</span> {t('uploader.jobDescription.and')} {t('uploader.jobDescription.tailoredFeedback')}.
                </p>

                {/* Mode Tabs */}
                <div className="flex justify-start">
                  <div className="inline-flex rounded-xl bg-muted/50 border border-border p-1 flex-wrap">
                    <button
                      onClick={() => setJobDescriptionMode("paste")}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                        jobDescriptionMode === "paste"
                          ? "bg-success text-success-foreground shadow-md"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <FileText className="w-4 h-4" />
                      Paste Text
                    </button>
                    <button
                      onClick={() => setJobDescriptionMode("url")}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                        jobDescriptionMode === "url"
                          ? "bg-success text-success-foreground shadow-md"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <Link className="w-4 h-4" />
                      Job URL
                    </button>
                    <button
                      onClick={() => setJobDescriptionMode("spreadsheet")}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                        jobDescriptionMode === "spreadsheet"
                          ? "bg-success text-success-foreground shadow-md"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <Table2 className="w-4 h-4" />
                      Spreadsheet
                    </button>
                  </div>
                </div>

                {/* Paste Text Mode */}
                {jobDescriptionMode === "paste" && (
                  <div className="relative">
                    <textarea
                      value={localJobDescriptionText}
                      onChange={(e) => setLocalJobDescriptionText(e.target.value)}
                      placeholder={`${t('uploader.jobDescription.pasteHere')}\n\n${t('uploader.jobDescription.tip')}`}
                      className="w-full h-40 p-4 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-success/50 focus:border-success/50 resize-none text-sm leading-relaxed transition-all"
                    />
                    <div className="absolute bottom-3 right-3 px-2 py-1 rounded-lg bg-card border border-border text-xs text-muted-foreground">
                      {localJobDescriptionText.length.toLocaleString()} {t('uploader.resume.chars')}
                    </div>
                  </div>
                )}

                {/* URL Mode */}
                {jobDescriptionMode === "url" && (
                  <div className="space-y-3">
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">
                        <Link className="w-4 h-4" />
                      </div>
                      <input
                        type="url"
                        value={jobDescriptionUrl}
                        onChange={(e) => setJobDescriptionUrl(e.target.value)}
                        placeholder="https://linkedin.com/jobs/... or company career page URL"
                        className="w-full h-12 pl-11 pr-4 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-success/50 focus:border-success/50 text-sm transition-all"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      💡 Paste the job listing URL from LinkedIn, Indeed, Glassdoor, or any company career page
                    </p>
                    {/* Optional: additional notes textarea */}
                    <textarea
                      value={localJobDescriptionText}
                      onChange={(e) => setLocalJobDescriptionText(e.target.value)}
                      placeholder="Optional: Add any additional notes about the role..."
                      className="w-full h-24 p-4 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-success/50 focus:border-success/50 resize-none text-sm leading-relaxed transition-all"
                    />
                  </div>
                )}

                {/* Spreadsheet Mode */}
                {jobDescriptionMode === "spreadsheet" && (
                  <div className="space-y-3">
                    {/* Show job selector when multiple jobs are parsed */}
                    {parsedJobs.length > 1 && !selectedJob && (
                      <JobSelector
                        jobs={parsedJobs}
                        selectedJobId={selectedJob?.id || null}
                        onSelect={handleJobSelect}
                        onCancel={handleCancelJobSelection}
                      />
                    )}

                    {/* Show selected job or file upload */}
                    {selectedJob ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 p-3 rounded-xl bg-success/5 border border-success/20">
                          <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-success font-medium truncate block">{selectedJob.title}</span>
                            <span className="text-xs text-success/70">{selectedJob.company}</span>
                          </div>
                          <button
                            onClick={() => {
                              if (parsedJobs.length > 1) {
                                setSelectedJob(null);
                                setLocalJobDescriptionText("");
                              } else {
                                handleCancelJobSelection();
                              }
                            }}
                            className="p-1 hover:bg-success/10 rounded-lg transition-colors"
                          >
                            <X className="w-3 h-3 text-success" />
                          </button>
                        </div>
                        {parsedJobs.length > 1 && (
                          <p className="text-xs text-muted-foreground">
                            {parsedJobs.length - 1} other job{parsedJobs.length > 2 ? 's' : ''} available • <button onClick={() => setSelectedJob(null)} className="text-primary hover:underline">change selection</button>
                          </p>
                        )}
                      </div>
                    ) : jobDescriptionFile && parsedJobs.length === 0 ? (
                      <div className="flex items-center gap-2 p-3 rounded-xl bg-success/5 border border-success/20">
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                        <Table2 className="w-4 h-4 text-success shrink-0" />
                        <span className="text-sm text-success truncate">{jobDescriptionFile.name}</span>
                        <button
                          onClick={handleCancelJobSelection}
                          className="ml-auto p-1 hover:bg-success/10 rounded-lg transition-colors"
                        >
                          <X className="w-3 h-3 text-success" />
                        </button>
                      </div>
                    ) : parsedJobs.length === 0 && !jobDescriptionFile ? (
                      <label className={cn(
                        "flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all",
                        isParsingJobDescription 
                          ? "border-success/50 bg-success/5" 
                          : "border-border/50 hover:border-success/40 hover:bg-success/5"
                      )}>
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleJobDescriptionSpreadsheetUpload(file);
                          }}
                          className="hidden"
                          disabled={isParsingJobDescription}
                        />
                        {isParsingJobDescription ? (
                          <>
                            <Loader2 className="w-6 h-6 text-success animate-spin mb-2" />
                            <span className="text-sm text-muted-foreground">Processing spreadsheet...</span>
                          </>
                        ) : (
                          <>
                            <Table2 className="w-6 h-6 text-success mb-2" />
                            <span className="text-sm font-medium text-foreground">Upload job listing spreadsheet</span>
                            <span className="text-xs text-muted-foreground mt-1">CSV files (Excel coming soon)</span>
                            <span className="text-xs text-muted-foreground mt-2 text-center max-w-[280px]">
                              Include columns: Title, Company, Description
                            </span>
                            <a
                              href="/sample-jobs.csv"
                              download="sample-jobs.csv"
                              onClick={(e) => e.stopPropagation()}
                              className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 hover:underline transition-colors"
                            >
                              <Download className="w-3 h-3" />
                              Download sample CSV
                            </a>
                          </>
                        )}
                      </label>
                    ) : null}
                  </div>
                )}

                {/* Success indicator */}
                {hasJobDescriptionContent && jobDescriptionMode === "paste" && localJobDescriptionText.trim() && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-success/5 border border-success/20">
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                    <span className="text-sm text-success">Job description added</span>
                    <button
                      onClick={() => setLocalJobDescriptionText("")}
                      className="ml-auto p-1 hover:bg-success/10 rounded-lg transition-colors"
                    >
                      <X className="w-3 h-3 text-success" />
                    </button>
                  </div>
                )}
                
                {jobDescriptionMode === "url" && jobDescriptionUrl.trim() && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-success/5 border border-success/20">
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                    <span className="text-sm text-success">Job URL added</span>
                    <button
                      onClick={() => setJobDescriptionUrl("")}
                      className="ml-auto p-1 hover:bg-success/10 rounded-lg transition-colors"
                    >
                      <X className="w-3 h-3 text-success" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Resume Section */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 rounded-lg bg-primary/10">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <h3 className="font-semibold">{t('uploader.resume.title')}</h3>
              <span className="text-xs text-destructive">{t('uploader.resume.required')}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">{t('uploader.resume.freeIncluded')}</span>
            </div>

            <div className="flex justify-start mb-4" role="tablist" aria-label="Resume input method">
              <div className="inline-flex rounded-xl bg-card border border-border p-1 shadow-sm">
                <button
                  id="resume-upload-tab"
                  onClick={() => setResumeMode("upload")}
                  role="tab"
                  aria-selected={resumeMode === "upload"}
                  aria-controls="resume-upload-panel"
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 min-h-[44px] touch-manipulation",
                    resumeMode === "upload"
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Upload className="w-4 h-4" aria-hidden="true" />
                  {t('uploader.resume.upload')}
                </button>
                <button
                  id="resume-paste-tab"
                  onClick={() => setResumeMode("paste")}
                  role="tab"
                  aria-selected={resumeMode === "paste"}
                  aria-controls="resume-paste-panel"
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 min-h-[44px] touch-manipulation",
                    resumeMode === "paste"
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <FileText className="w-4 h-4" aria-hidden="true" />
                  {t('uploader.resume.paste')}
                </button>
              </div>
            </div>

            {resumeMode === "upload" ? (
              <div
                id="resume-upload-panel"
                role="tabpanel"
                aria-labelledby="resume-upload-tab"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  "relative rounded-2xl bg-card/50 backdrop-blur-sm p-6 sm:p-8 text-center cursor-pointer border-2 border-dashed transition-all duration-300",
                  dragOver 
                    ? "border-primary bg-primary/5 scale-[1.01]" 
                    : "border-border/50 hover:border-primary/40 hover:bg-card/80 active:bg-card/90",
                  selectedFile && "border-success/50 bg-success/5"
                )}
              >
                {selectedFile ? (
                  <div className="space-y-3 animate-scale-in">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-success/10">
                      <CheckCircle2 className="w-7 h-7 text-success" />
                    </div>
                    <p className="text-base font-medium text-success">Resume uploaded!</p>
                    <div className="inline-flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border max-w-full">
                      <FileText className="w-5 h-5 text-primary shrink-0" />
                      <span className="text-sm font-medium truncate">{selectedFile.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          clearFile();
                        }}
                        className="p-2 hover:bg-muted rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center touch-manipulation"
                        aria-label="Remove file"
                      >
                        <X className="w-5 h-5 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="block cursor-pointer">
                    <input
                      type="file"
                      accept=".pdf,.txt,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <div className="inline-flex items-center justify-center w-16 h-16 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 mb-4">
                      <Upload className="w-8 h-8 sm:w-7 sm:h-7 text-primary" />
                    </div>
                    <p className="text-lg sm:text-xl font-semibold mb-2">
                      Tap to upload resume
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t('uploader.resume.fileTypes')}
                    </p>
                    <div className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary/10 border border-primary/30 text-primary font-medium min-h-[48px] touch-manipulation active:bg-primary/20 transition-colors">
                      <FileText className="w-5 h-5" />
                      <span>Choose File</span>
                    </div>
                  </label>
                )}
              </div>
            ) : (
              <div id="resume-paste-panel" role="tabpanel" aria-labelledby="resume-paste-tab" className="relative">
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={t('uploader.resume.pasteHere')}
                  className="w-full h-48 p-4 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 resize-none text-sm leading-relaxed transition-all"
                />
                <div className="absolute bottom-3 right-3 px-2 py-1 rounded-lg bg-card/80 border border-border text-xs text-muted-foreground">
                  {textInput.length.toLocaleString()} {t('uploader.resume.chars')}
                </div>
              </div>
            )}
          </div>

          {/* LinkedIn Section */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-[#0A66C2]/10">
                <Linkedin className="w-4 h-4 text-[#0A66C2]" />
              </div>
              <h3 className="font-semibold">{t('uploader.linkedin.title')}</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#0A66C2]/10 text-[#0A66C2] font-medium">{t('uploader.linkedin.paidOnly')}</span>
            </div>
              <button
                onClick={() => setShowLinkedIn(!showLinkedIn)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showLinkedIn ? t('uploader.linkedin.hide') : t('uploader.linkedin.show')}
              </button>
            </div>

            {showLinkedIn && (
              <div className="rounded-2xl bg-card/30 border border-border/30 p-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t('uploader.linkedin.description')} <span className="text-foreground font-medium">{t('uploader.linkedin.benefits')}</span> {t('uploader.linkedin.andMore')}
                </p>

                <div className="flex justify-start">
                  <div className="inline-flex rounded-xl bg-muted/50 border border-border p-1">
                    <button
                      onClick={() => setLinkedInMode("upload")}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                        linkedInMode === "upload"
                          ? "bg-[#0A66C2] text-white shadow-md"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <Upload className="w-4 h-4" />
                      {t('uploader.linkedin.uploadPdf')}
                    </button>
                    <button
                      onClick={() => setLinkedInMode("paste")}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                        linkedInMode === "paste"
                          ? "bg-[#0A66C2] text-white shadow-md"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <FileText className="w-4 h-4" />
                      {t('uploader.resume.paste')}
                    </button>
                  </div>
                </div>

                {linkedInMode === "upload" ? (
                  <div className="space-y-3">
                    {linkedInFile && linkedInText ? (
                      <div className="flex items-center gap-2 p-3 rounded-xl bg-success/5 border border-success/20">
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                        <span className="text-sm text-success truncate max-w-[200px]">{linkedInFile.name}</span>
                        <span className="text-sm text-success">({linkedInText.length.toLocaleString()} {t('uploader.resume.chars')})</span>
                        <button
                          onClick={() => {
                            setLinkedInFile(null);
                            onLinkedInTextChange?.("");
                          }}
                          className="ml-auto p-1 hover:bg-success/10 rounded-lg transition-colors"
                        >
                          <X className="w-3 h-3 text-success" />
                        </button>
                      </div>
                    ) : (
                      <label className={cn(
                        "flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all",
                        isParsingLinkedIn 
                          ? "border-[#0A66C2]/50 bg-[#0A66C2]/5" 
                          : "border-border/50 hover:border-[#0A66C2]/40 hover:bg-[#0A66C2]/5"
                      )}>
                        <input
                          type="file"
                          accept=".pdf,application/pdf"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleLinkedInFileUpload(file);
                          }}
                          className="hidden"
                          disabled={isParsingLinkedIn}
                        />
                        {isParsingLinkedIn ? (
                          <>
                            <Loader2 className="w-6 h-6 text-[#0A66C2] animate-spin mb-2" />
                            <span className="text-sm text-muted-foreground">{t('uploader.linkedin.parsing')}</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-6 h-6 text-[#0A66C2] mb-2" />
                            <span className="text-sm font-medium text-foreground">{t('uploader.linkedin.uploadLinkedIn')}</span>
                            <span className="text-xs text-muted-foreground mt-1">{t('uploader.linkedin.exportTip')}</span>
                            <span className="text-xs text-muted-foreground mt-2 text-center max-w-[280px]">
                              PDF provides better analysis than a link. Click <span className="font-medium text-[#0A66C2]">Resources</span> tab on your LinkedIn profile to download.
                            </span>
                          </>
                        )}
                      </label>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <textarea
                      value={localLinkedInText}
                      onChange={(e) => setLocalLinkedInText(e.target.value)}
                      placeholder={`${t('uploader.linkedin.pasteHere')}\n\n${t('uploader.linkedin.includeTip')}`}
                      className="w-full h-40 p-4 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-[#0A66C2]/50 focus:border-[#0A66C2]/50 resize-none text-sm leading-relaxed transition-all"
                    />
                    <div className="absolute bottom-3 right-3 px-2 py-1 rounded-lg bg-card border border-border text-xs text-muted-foreground">
                      {localLinkedInText.length.toLocaleString()} {t('uploader.resume.chars')}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>


          {/* Job Comparison CTAs - show when jobs are uploaded */}
          {parsedJobs.length > 0 && canProceed && (
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
              <JobComparisonCTA
                jobTitles={parsedJobs.map(j => j.title)}
                onGetStarted={(jobTitle) => {
                  // Find and select the job if a specific title was clicked
                  if (jobTitle) {
                    const job = parsedJobs.find(j => j.title === jobTitle);
                    if (job) {
                      handleJobSelect(job);
                    }
                  }
                  // Trigger checkout
                  if (resumeMode === "paste") {
                    handleTextPaste();
                  } else {
                    handleCheckoutClick();
                  }
                }}
                isLoading={isLoading}
              />
            </div>
          )}

          {/* Submit Buttons */}
          <div className="text-center space-y-5">
            {onFreeScan && (
              <div className="space-y-4">
                {isFreeScanLoading ? (
                  <FreeScanProgress />
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="lg"
                      disabled={!canProceed}
                      onClick={onFreeScan}
                      className="w-full sm:w-auto sm:min-w-[320px] h-16 sm:h-14 text-lg sm:text-base gap-3 border-2 border-success bg-success/10 hover:bg-success/20 hover:border-success text-success font-bold shadow-[0_0_20px_rgba(34,197,94,0.3)] hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] transition-all touch-manipulation disabled:shadow-none disabled:border-success/40 disabled:text-success/70 disabled:bg-success/5 active:scale-[0.98]"
                    >
                      <Zap className="w-6 h-6 sm:w-5 sm:h-5 text-success fill-success/30" />
                      <span>Get Free Score</span>
                      <span className="px-3 py-1 rounded-full bg-success text-success-foreground text-xs font-bold uppercase tracking-wide animate-pulse">FREE</span>
                    </Button>
                    <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center justify-center gap-2 sm:gap-x-3 sm:gap-y-1 text-[11px] sm:text-xs text-muted-foreground max-w-lg mx-auto">
                      <span className="flex items-center gap-1"><span className="text-success">✓</span> ATS Score</span>
                      <span className="flex items-center gap-1"><span className="text-success">✓</span> Format</span>
                      <span className="flex items-center gap-1"><span className="text-success">✓</span> Keywords</span>
                      <span className="flex items-center gap-1"><span className="text-success">✓</span> Red Flags</span>
                      <span className="flex items-center gap-1"><span className="text-success">✓</span> Industry</span>
                      <span className="flex items-center gap-1"><span className="text-success">✓</span> +12 more</span>
                    </div>
                    <p className="text-xs text-muted-foreground/70">
                      4 free scans per day · Results in ~90 seconds
                    </p>
                  </>
                )}
              </div>
            )}

            {onFreeScan && (
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground font-medium">or get the full report</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}

            <Button
              variant="hero"
              size="xl"
              disabled={isLoading || !canProceed}
              onClick={resumeMode === "paste" ? handleTextPaste : handleCheckoutClick}
              className="min-w-[320px] h-14 text-base gap-3 shadow-xl shadow-primary/20 hover:shadow-primary/30 transition-shadow touch-manipulation"
              aria-busy={isLoading}
              aria-describedby="payment-info"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  <span>{t('uploader.actions.processing')}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" aria-hidden="true" />
                  <span>{t('uploader.actions.getFullAnalysis')} — $25{isLocalCurrency && ` ≈ ${formatPrice(25)}`}</span>
                </>
              )}
            </Button>
            
            <div id="payment-info" className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Secure payment via Stripe</span>
              </div>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/30" aria-hidden="true" />
              <span>Results delivered instantly</span>
            </div>
            
            {!hasLinkedInContent && !hasJobDescriptionContent && (
              <p className="text-xs text-muted-foreground">
                <span aria-hidden="true">💡</span> Add LinkedIn profile or job description for a more targeted analysis
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
