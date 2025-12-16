import { useState, useCallback } from "react";
import { Upload, FileText, X, Loader2, CheckCircle2, Sparkles, CreditCard, Linkedin, Link2, Globe, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ResumeUploaderProps {
  onFileSelect: (file: File) => void;
  onTextSubmit: (text: string, linkedInText?: string, jobDescriptionText?: string) => void;
  onCheckout: (linkedInText?: string, jobDescriptionText?: string) => void;
  isLoading?: boolean;
  hasContent?: boolean;
  linkedInText?: string;
  onLinkedInTextChange?: (text: string) => void;
  isScrapingLinkedIn?: boolean;
  onScrapeLinkedIn?: (url: string) => Promise<void>;
  jobDescriptionText?: string;
  onJobDescriptionTextChange?: (text: string) => void;
}

export function ResumeUploader({ 
  onFileSelect, 
  onTextSubmit, 
  onCheckout,
  isLoading,
  hasContent,
  linkedInText = "",
  onLinkedInTextChange,
  isScrapingLinkedIn,
  onScrapeLinkedIn,
  jobDescriptionText = "",
  onJobDescriptionTextChange
}: ResumeUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [textInput, setTextInput] = useState("");
  const [resumeMode, setResumeMode] = useState<"upload" | "paste">("upload");
  const [linkedInMode, setLinkedInMode] = useState<"url" | "paste">("url");
  const [linkedInUrl, setLinkedInUrl] = useState("");
  const [localLinkedInText, setLocalLinkedInText] = useState("");
  const [showLinkedIn, setShowLinkedIn] = useState(true);
  const [showJobDescription, setShowJobDescription] = useState(true);
  const [localJobDescriptionText, setLocalJobDescriptionText] = useState("");

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

  const handleLinkedInScrape = async () => {
    if (linkedInUrl.trim() && onScrapeLinkedIn) {
      await onScrapeLinkedIn(linkedInUrl.trim());
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
  const hasLinkedInContent = linkedInMode === "url" ? !!linkedInText : !!localLinkedInText.trim();
  const hasJobDescriptionContent = !!localJobDescriptionText.trim() || !!jobDescriptionText;

  return (
    <section 
      id="upload" 
      className="py-20 relative scroll-mt-20" 
      aria-labelledby="upload-heading"
    >
      {/* Section background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent pointer-events-none" aria-hidden="true" />
      
      <div className="container relative">
        <div className="max-w-3xl mx-auto">
          {/* Section header */}
          <div className="text-center mb-10">
            <h2 id="upload-heading" className="text-2xl md:text-3xl font-bold mb-3">
              Upload Your Resume & LinkedIn
            </h2>
            <p className="text-muted-foreground">
              Get a comprehensive analysis of your resume <span className="text-primary font-medium">+ LinkedIn profile optimization</span>
            </p>
          </div>

          {/* Resume Section */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 rounded-lg bg-primary/10">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <h3 className="font-semibold">Your Resume</h3>
              <span className="text-xs text-destructive">*Required</span>
            </div>

            {/* Resume Mode Toggle */}
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
                  Upload
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
                  Paste
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
                      Drop your resume here
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      PDF, DOCX, or TXT (max 10MB)
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
                          Browse files
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
                  placeholder="Paste your resume content here..."
                  className="w-full h-48 p-4 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 resize-none text-sm leading-relaxed transition-all"
                />
                <div className="absolute bottom-3 right-3 px-2 py-1 rounded-lg bg-card/80 border border-border text-xs text-muted-foreground">
                  {textInput.length.toLocaleString()} chars
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
                <h3 className="font-semibold">Your LinkedIn Profile</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">Included free!</span>
              </div>
              <button
                onClick={() => setShowLinkedIn(!showLinkedIn)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showLinkedIn ? "Hide" : "Show"}
              </button>
            </div>

            {showLinkedIn && (
              <div className="rounded-2xl bg-card/30 border border-border/30 p-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Add your LinkedIn for <span className="text-foreground font-medium">headline optimization, About section rewrite, SEO keywords,</span> and visibility tips.
                </p>

                {/* LinkedIn Mode Toggle */}
                <div className="flex justify-start">
                  <div className="inline-flex rounded-xl bg-muted/50 border border-border p-1">
                    <button
                      onClick={() => setLinkedInMode("url")}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                        linkedInMode === "url"
                          ? "bg-[#0A66C2] text-white shadow-md"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <Link2 className="w-4 h-4" />
                      URL
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
                      Paste
                    </button>
                  </div>
                </div>

                {linkedInMode === "url" ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          type="url"
                          value={linkedInUrl}
                          onChange={(e) => setLinkedInUrl(e.target.value)}
                          placeholder="linkedin.com/in/yourprofile"
                          className="w-full h-11 pl-10 pr-4 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-[#0A66C2]/50 focus:border-[#0A66C2]/50 text-sm transition-all"
                        />
                      </div>
                      <Button
                        variant="outline"
                        onClick={handleLinkedInScrape}
                        disabled={!linkedInUrl.trim() || isScrapingLinkedIn}
                        className="h-11 px-4 border-[#0A66C2]/30 hover:bg-[#0A66C2]/10 hover:border-[#0A66C2]/50"
                      >
                        {isScrapingLinkedIn ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Fetch"
                        )}
                      </Button>
                    </div>
                    {linkedInText && (
                      <div className="flex items-center gap-2 p-3 rounded-xl bg-success/5 border border-success/20">
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                        <span className="text-sm text-success">Profile fetched ({linkedInText.length.toLocaleString()} chars)</span>
                        <button
                          onClick={() => onLinkedInTextChange?.("")}
                          className="ml-auto p-1 hover:bg-success/10 rounded-lg transition-colors"
                        >
                          <X className="w-3 h-3 text-success" />
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <textarea
                      value={localLinkedInText}
                      onChange={(e) => setLocalLinkedInText(e.target.value)}
                      placeholder="Copy and paste your LinkedIn profile content here...&#10;&#10;Include: Headline, About section, Experience descriptions, Skills"
                      className="w-full h-40 p-4 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-[#0A66C2]/50 focus:border-[#0A66C2]/50 resize-none text-sm leading-relaxed transition-all"
                    />
                    <div className="absolute bottom-3 right-3 px-2 py-1 rounded-lg bg-card border border-border text-xs text-muted-foreground">
                      {localLinkedInText.length.toLocaleString()} chars
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Submit Button */}
          <div className="text-center space-y-4">
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
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" aria-hidden="true" />
                  <span>Analyze Resume {hasLinkedInContent ? "+ LinkedIn" : ""} — $25</span>
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
            
            {!hasLinkedInContent && (
              <p className="text-xs text-muted-foreground">
                <span aria-hidden="true">💡</span> Add your LinkedIn profile above for a more comprehensive analysis
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
