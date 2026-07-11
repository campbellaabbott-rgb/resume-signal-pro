import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { languages } from "@/i18n";

interface ResumeLanguageSuggestionProps {
  /** Server payload shape has varied across engine versions (string code,
      object with/without fields, cached older formats) — accept them all. */
  detectedLanguage?: { code?: string | null; name?: string | null } | string | null;
}

/** Maps common language codes from AI to our supported i18n codes */
const LANGUAGE_CODE_MAP: Record<string, string> = {
  en: "en",
  es: "es",
  hi: "hi",
  tl: "tl",
  de: "de",
  fr: "fr",
  nl: "nl",
  pt: "pt",
  "pt-BR": "pt",
  "pt-PT": "pt",
  "fr-CA": "fr-CA",
  "en-GB": "en-GB",
  "en-US": "en",
};

export function ResumeLanguageSuggestion({ detectedLanguage }: ResumeLanguageSuggestionProps) {
  const { i18n, t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  if (!detectedLanguage || dismissed) return null;

  // Cached scan payloads have carried this as a plain string OR an object
  // that may lack `code` — a missing field must mean "no suggestion",
  // never a crash (it took the whole report down via the error boundary).
  const rawCode = typeof detectedLanguage === "string" ? detectedLanguage : detectedLanguage.code;
  const rawName = typeof detectedLanguage === "string" ? detectedLanguage : detectedLanguage.name;
  if (!rawCode || typeof rawCode !== "string") return null;

  // Normalize the detected code to our supported codes
  const detectedCode = LANGUAGE_CODE_MAP[rawCode]
    || LANGUAGE_CODE_MAP[rawCode.split("-")[0]]
    || null;

  // Don't show if we can't map it, or if it already matches current language
  if (!detectedCode || detectedCode === i18n.language) return null;
  
  // Also skip if the base languages match (e.g. en vs en-GB)
  if (detectedCode.split("-")[0] === i18n.language.split("-")[0]) return null;

  const targetLang = languages.find(l => l.code === detectedCode);
  if (!targetLang) return null;

  const currentLang = languages.find(l => l.code === i18n.language);

  const handleSwitch = () => {
    i18n.changeLanguage(detectedCode);
    document.documentElement.lang = detectedCode;
    setDismissed(true);
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-primary/20 bg-primary/5 text-sm animate-fade-in">
      <Globe className="w-4 h-4 text-primary flex-shrink-0" />
      <p className="flex-1 text-muted-foreground">
        {t("languageDetection.detected", { language: rawName || targetLang.name })}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={handleSwitch}
        className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10 flex-shrink-0"
      >
        {targetLang.flag} {t("languageDetection.switchButton", { language: targetLang.name })}
        <ArrowRight className="w-3 h-3" />
      </Button>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground p-1"
        aria-label={t("languageDetection.dismiss", { current: currentLang?.name || "English" })}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
