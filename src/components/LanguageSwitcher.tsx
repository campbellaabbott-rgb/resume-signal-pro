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
import { cn } from '@/lib/utils';

interface LanguageSwitcherProps {
  /**
   * compact  the header: the language's code under xl ("DE"), its name from xl
   * default  the footer: the name
   * list     the phone menu sheet: every language as a button, the current one marked
   */
  variant?: 'default' | 'compact' | 'list';
}

const codeOf = (code: string) => code.split('-')[0].toUpperCase();

export function LanguageSwitcher({ variant = 'default' }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();

  const currentLanguage = languages.find((lang) => lang.code === i18n.language) || languages[0];

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
    document.documentElement.lang = langCode;
  };

  if (variant === 'list') {
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">{t('header.language', 'Language')}</h3>
        <ul className="grid grid-cols-2 gap-1">
          {languages.map((lang) => {
            const current = i18n.language === lang.code;
            return (
              <li key={lang.code}>
                <button
                  type="button"
                  lang={lang.code}
                  aria-pressed={current}
                  onClick={() => handleLanguageChange(lang.code)}
                  className={cn(
                    'flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    current ? 'border border-primary bg-primary-tint text-primary' : 'text-foreground hover:bg-accent',
                  )}
                >
                  <span>{lang.name}</span>
                  {current ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
        >
          <Globe aria-hidden="true" className="h-4 w-4" />
          {/* The name starts with the visible text (WCAG 2.5.3), then says what the button does. */}
          {variant === 'compact' ? (
            <>
              <span className="xl:hidden">{codeOf(currentLanguage.code)}</span>
              <span className="hidden xl:inline">{currentLanguage.name}</span>
            </>
          ) : (
            <span>{currentLanguage.name}</span>
          )}
          <span className="sr-only">, {t('language.select', 'Select Language')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            lang={lang.code}
            onClick={() => handleLanguageChange(lang.code)}
            className={cn('flex items-center justify-between', i18n.language === lang.code && 'bg-accent')}
          >
            <span>{lang.name}</span>
            {i18n.language === lang.code && <Check aria-hidden="true" className="ml-2 h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
