import { useTranslation } from "react-i18next";
import { useCallback } from "react";

/**
 * A robust translation hook that ensures translations never show raw keys
 * - Provides fallback to English if key is missing in current language
 * - Returns the key's last segment as human-readable fallback if all else fails
 * - Logs missing translations in development for easier debugging
 */
export function useSafeTranslation() {
  const { t, i18n } = useTranslation();

  const safeT = useCallback((key: string, fallback?: string): string => {
    // Try to get the translation
    const translation = t(key);
    
    // If translation returns the key itself, it means it's missing
    if (translation === key) {
      // Log missing key in development
      if (import.meta.env.DEV) {
        console.warn(`[i18n] Missing translation: "${key}" for locale "${i18n.language}"`);
      }
      
      // Use provided fallback or generate one from the key
      if (fallback) {
        return fallback;
      }
      
      // Generate human-readable fallback from key (e.g., "howItWorks.title" -> "Title")
      const lastPart = key.split('.').pop() || key;
      // Convert camelCase to Title Case
      return lastPart
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .trim();
    }
    
    return translation;
  }, [t, i18n.language]);

  return { t: safeT, i18n, ready: i18n.isInitialized };
}
