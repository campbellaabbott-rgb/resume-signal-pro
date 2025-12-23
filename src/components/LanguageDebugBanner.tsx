import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { X, Globe, Bug } from 'lucide-react';
import { languages } from '@/i18n';

export function LanguageDebugBanner() {
  const { i18n } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  
  // Only show in development mode
  if (import.meta.env.PROD || dismissed) {
    return null;
  }
  
  const currentLang = languages.find(l => l.code === i18n.language);
  const storedLang = localStorage.getItem('i18nextLng');
  
  return (
    <div className="fixed bottom-4 left-4 z-[100] max-w-xs">
      <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-xs">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Bug className="w-3.5 h-3.5" />
            <span className="font-medium">i18n Debug</span>
          </div>
          <button 
            onClick={() => setDismissed(true)}
            className="text-muted-foreground hover:text-foreground p-0.5"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        
        <div className="space-y-1.5 text-muted-foreground">
          <div className="flex items-center gap-2">
            <Globe className="w-3 h-3" />
            <span>Active: </span>
            <span className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded">
              {currentLang?.flag} {i18n.language}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="w-3" />
            <span>Stored: </span>
            <span className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded">
              {storedLang || 'none'}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="w-3" />
            <span>Browser: </span>
            <span className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded">
              {navigator.language}
            </span>
          </div>
          
          <div className="pt-1.5 border-t border-border mt-1.5">
            <span className="text-muted-foreground/70">
              {languages.length} languages available
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
