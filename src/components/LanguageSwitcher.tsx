import { useTranslation } from 'react-i18next';
import { Globe, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { languages } from '@/i18n';

interface LanguageSwitcherProps {
  variant?: 'default' | 'compact';
}

export function LanguageSwitcher({ variant = 'default' }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();

  // Find current language, fallback to first language
  const currentLanguage = languages.find((lang) => lang.code === i18n.language) || languages[0];

  const handleLanguageChange = (langCode: string) => {
    // Change language and persist to localStorage
    i18n.changeLanguage(langCode);
    // Force re-render by updating document lang attribute
    document.documentElement.lang = langCode;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={variant === 'compact' ? 'sm' : 'default'}
          className="gap-2 text-muted-foreground hover:text-foreground"
          aria-label={t('language.select', 'Select Language')}
        >
          <Globe className="w-4 h-4" />
          <span className="hidden sm:inline">{currentLanguage.flag} {currentLanguage.name}</span>
          <span className="sm:hidden">{currentLanguage.flag}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => handleLanguageChange(lang.code)}
            className={`flex items-center justify-between ${i18n.language === lang.code ? 'bg-accent' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span>{lang.flag}</span>
              <span>{lang.name}</span>
            </span>
            {i18n.language === lang.code && (
              <Check className="w-4 h-4 text-primary ml-2" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
