import { useState, useCallback } from "react";
import { Upload, FileText, X, Loader2, CheckCircle2, Sparkles, CreditCard, Linkedin, Target, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

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
  onJobDescriptionTextChange
}: ResumeUploaderProps) {
  const { t } = useTranslation();
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
  const [isParsingLinkedIn, setIsParsingLinkedIn] = useState(false);

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

  const handleTextPaste = () => {
    if (textInput.trim()) {
      const finalLinkedInText = linkedInMode === "paste" ? localLinkedInText : linkedInText;
      const finalJobDescriptionText = localJobDescriptionText || jobDescriptionText;
      onTextSubmit(textInput.trim(), finalLinkedInText || undefined, finalJobDescriptionText || undefined);
    }
  };

  const handleCheckoutClick = () => {
    const finalLinkedInText = linkedInMode === "paste" ? localLinkedInText : linkedInText;
    const finalJobDescriptionText = localJobDescriptionText || jobDescriptionText;
    onCheckout(finalLinkedInText || undefined, finalJobDescriptionText || undefined);
  };

  const canProceed = resumeMode === "upload" ? !!selectedFile : !!textInput.trim();
  const hasLinkedInContent = linkedInMode === "upload" ? !!linkedInText : !!localLinkedInText.trim();
  const hasJobDescriptionContent = !!localJobDescriptionText.trim() || !!jobDescriptionText;

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
                  "relative rounded-2xl bg-card/50 backdrop-blur-sm p-8 text-center cursor-pointer border-2 border-dashed transition-all duration-300",
                  dragOver 
                    ? "border-primary bg-primary/5 scale-[1.01]" 
                    : "border-border/50 hover:border-primary/40 hover:bg-card/80",
                  selectedFile && "border-success/50 bg-success/5"
                )}
              >
                {selectedFile ? (
                  <div className="space-y-3 animate-scale-in">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success/10">
                      <CheckCircle2 className="w-6 h-6 text-success" />
                    </div>
                    <div className="inline-flex items-center gap-3 px-4 py-2 rounded-xl bg-card border border-border">
                      <FileText className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium max-w-[200px] truncate">{selectedFile.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          clearFile();
                        }}
                        className="p-1 hover:bg-muted rounded-lg transition-colors"
                      >
                        <X className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 mb-4">
                      <Upload className="w-7 h-7 text-primary" />
                    </div>
                    <p className="text-lg font-semibold mb-1">
                      {t('uploader.resume.dropHere')}
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t('uploader.resume.fileTypes')}
                    </p>
                    <label>
                      <input
                        type="file"
                        accept=".pdf,.txt,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <Button variant="outline" size="sm" className="gap-2" asChild>
                        <span>
                          <FileText className="w-4 h-4" />
                          {t('uploader.resume.browse')}
                        </span>
                      </Button>
                    </label>
                  </>
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

          {/* Job Description Section */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-success/10">
                  <Target className="w-4 h-4 text-success" />
                </div>
                <h3 className="font-semibold">{t('uploader.jobDescription.title')}</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">New!</span>
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
                  {t('uploader.jobDescription.description')} <span className="text-foreground font-medium">{t('uploader.jobDescription.matchScore')}, extracted keywords,</span> {t('uploader.jobDescription.and')} {t('uploader.jobDescription.tailoredFeedback')}.
                </p>

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

                {localJobDescriptionText.trim() && (
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
              </div>
            )}
          </div>

          {/* Submit Buttons */}
          <div className="text-center space-y-5">
            {onFreeScan && (
              <div className="space-y-3">
                <Button
                  variant="outline"
                  size="lg"
                  disabled={isFreeScanLoading || !canProceed}
                  onClick={onFreeScan}
                  className="min-w-[320px] h-14 text-base gap-2 border border-success/50 bg-success/10 hover:bg-success/20 hover:border-success/70 text-success font-medium shadow-[0_0_12px_rgba(34,197,94,0.25)] hover:shadow-[0_0_18px_rgba(34,197,94,0.4)] transition-all touch-manipulation disabled:shadow-[0_0_12px_rgba(34,197,94,0.25)] disabled:border-success/40 disabled:text-success/70 disabled:bg-success/5"
                >
                  {isFreeScanLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-foreground">{t('uploader.actions.processing')}</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5 text-success fill-success/30" />
                      <span>{t('uploader.actions.freeScan')}</span>
                      <span className="ml-1 px-2.5 py-1 rounded-full bg-success text-success-foreground text-xs font-bold uppercase tracking-wide">17 Insights Free</span>
                    </>
                  )}
                </Button>
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground max-w-lg mx-auto">
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> ATS Score</span>
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> Format</span>
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> Metrics %</span>
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> Verbs</span>
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> Pages</span>
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> Words</span>
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> Sections</span>
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> Contact</span>
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> Level</span>
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> Strength</span>
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> Red Flags</span>
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> Keywords</span>
                  <span className="flex items-center gap-1"><span className="text-success">✓</span> Industry</span>
                </div>
                <p className="text-xs text-muted-foreground/70">
                  4 free scans per day
                </p>
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
                  <span>{t('uploader.actions.getFullAnalysis')} — $25</span>
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
