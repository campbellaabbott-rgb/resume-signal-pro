import { useState, useEffect } from "react";

interface CurrencyInfo {
  code: string;
  symbol: string;
  rate: number; // Rate relative to USD
}

// Common currencies with approximate exchange rates (updated periodically)
const CURRENCY_MAP: Record<string, CurrencyInfo> = {
  US: { code: "USD", symbol: "$", rate: 1 },
  CA: { code: "CAD", symbol: "C$", rate: 1.40 },
  GB: { code: "GBP", symbol: "£", rate: 0.79 },
  EU: { code: "EUR", symbol: "€", rate: 0.92 },
  DE: { code: "EUR", symbol: "€", rate: 0.92 },
  FR: { code: "EUR", symbol: "€", rate: 0.92 },
  ES: { code: "EUR", symbol: "€", rate: 0.92 },
  IT: { code: "EUR", symbol: "€", rate: 0.92 },
  NL: { code: "EUR", symbol: "€", rate: 0.92 },
  BE: { code: "EUR", symbol: "€", rate: 0.92 },
  AT: { code: "EUR", symbol: "€", rate: 0.92 },
  PT: { code: "EUR", symbol: "€", rate: 0.92 },
  IE: { code: "EUR", symbol: "€", rate: 0.92 },
  IN: { code: "INR", symbol: "₹", rate: 84.50 },
  AU: { code: "AUD", symbol: "A$", rate: 1.58 },
  JP: { code: "JPY", symbol: "¥", rate: 154 },
  CN: { code: "CNY", symbol: "¥", rate: 7.25 },
  KR: { code: "KRW", symbol: "₩", rate: 1420 },
  MX: { code: "MXN", symbol: "MX$", rate: 20.20 },
  BR: { code: "BRL", symbol: "R$", rate: 6.10 },
  PH: { code: "PHP", symbol: "₱", rate: 58.50 },
  SG: { code: "SGD", symbol: "S$", rate: 1.35 },
  NZ: { code: "NZD", symbol: "NZ$", rate: 1.75 },
  CH: { code: "CHF", symbol: "CHF", rate: 0.89 },
  SE: { code: "SEK", symbol: "kr", rate: 10.90 },
  NO: { code: "NOK", symbol: "kr", rate: 11.20 },
  DK: { code: "DKK", symbol: "kr", rate: 6.90 },
  PL: { code: "PLN", symbol: "zł", rate: 4.05 },
  ZA: { code: "ZAR", symbol: "R", rate: 18.20 },
  AE: { code: "AED", symbol: "د.إ", rate: 3.67 },
  HK: { code: "HKD", symbol: "HK$", rate: 7.80 },
  TW: { code: "TWD", symbol: "NT$", rate: 32.50 },
  TH: { code: "THB", symbol: "฿", rate: 35.00 },
  MY: { code: "MYR", symbol: "RM", rate: 4.45 },
  ID: { code: "IDR", symbol: "Rp", rate: 15900 },
  VN: { code: "VND", symbol: "₫", rate: 25400 },
  IL: { code: "ILS", symbol: "₪", rate: 3.65 },
  TR: { code: "TRY", symbol: "₺", rate: 34.80 },
  RU: { code: "RUB", symbol: "₽", rate: 103 },
  SA: { code: "SAR", symbol: "﷼", rate: 3.75 },
  CL: { code: "CLP", symbol: "CL$", rate: 980 },
  CO: { code: "COP", symbol: "COL$", rate: 4380 },
  AR: { code: "ARS", symbol: "AR$", rate: 1020 },
  PK: { code: "PKR", symbol: "₨", rate: 278 },
  BD: { code: "BDT", symbol: "৳", rate: 121 },
  NG: { code: "NGN", symbol: "₦", rate: 1580 },
  EG: { code: "EGP", symbol: "E£", rate: 50.50 },
  UY: { code: "UYU", symbol: "$U", rate: 44.50 },
  RO: { code: "RON", symbol: "lei", rate: 4.70 },
  // Additional Asian currencies
  LK: { code: "LKR", symbol: "Rs", rate: 295 },      // Sri Lanka
  MM: { code: "MMK", symbol: "K", rate: 2100 },      // Myanmar
  KH: { code: "KHR", symbol: "៛", rate: 4050 },     // Cambodia
  NP: { code: "NPR", symbol: "रू", rate: 134 },      // Nepal
  MN: { code: "MNT", symbol: "₮", rate: 3420 },      // Mongolia
  LA: { code: "LAK", symbol: "₭", rate: 21800 },     // Laos
  BN: { code: "BND", symbol: "B$", rate: 1.35 },     // Brunei
  MO: { code: "MOP", symbol: "MOP$", rate: 8.05 },   // Macau
  KW: { code: "KWD", symbol: "د.ك", rate: 0.31 },    // Kuwait
  QA: { code: "QAR", symbol: "ر.ق", rate: 3.64 },    // Qatar
  BH: { code: "BHR", symbol: "د.ب", rate: 0.38 },    // Bahrain
  OM: { code: "OMR", symbol: "ر.ع.", rate: 0.38 },   // Oman
  JO: { code: "JOD", symbol: "د.ا", rate: 0.71 },    // Jordan
  KZ: { code: "KZT", symbol: "₸", rate: 520 },       // Kazakhstan
  UZ: { code: "UZS", symbol: "so'm", rate: 12900 },  // Uzbekistan
  AZ: { code: "AZN", symbol: "₼", rate: 1.70 },      // Azerbaijan
  GE: { code: "GEL", symbol: "₾", rate: 2.75 },      // Georgia
};

// Map timezone to country code (approximate)
function getCountryFromTimezone(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tzToCountry: Record<string, string> = {
      "America/New_York": "US",
      "America/Chicago": "US",
      "America/Denver": "US",
      "America/Los_Angeles": "US",
      "America/Toronto": "CA",
      "America/Vancouver": "CA",
      "Europe/London": "GB",
      "Europe/Paris": "FR",
      "Europe/Berlin": "DE",
      "Europe/Madrid": "ES",
      "Europe/Rome": "IT",
      "Europe/Amsterdam": "NL",
      "Europe/Brussels": "BE",
      "Europe/Vienna": "AT",
      "Europe/Lisbon": "PT",
      "Europe/Dublin": "IE",
      "Europe/Stockholm": "SE",
      "Europe/Oslo": "NO",
      "Europe/Copenhagen": "DK",
      "Europe/Warsaw": "PL",
      "Europe/Zurich": "CH",
      "Asia/Kolkata": "IN",
      "Asia/Tokyo": "JP",
      "Asia/Shanghai": "CN",
      "Asia/Hong_Kong": "HK",
      "Asia/Seoul": "KR",
      "Asia/Singapore": "SG",
      "Asia/Manila": "PH",
      "Asia/Taipei": "TW",
      "Asia/Bangkok": "TH",
      "Asia/Kuala_Lumpur": "MY",
      "Asia/Jakarta": "ID",
      "Asia/Ho_Chi_Minh": "VN",
      "Asia/Dubai": "AE",
      "Asia/Jerusalem": "IL",
      "Asia/Istanbul": "TR",
      "Asia/Riyadh": "SA",
      "Asia/Karachi": "PK",
      "Asia/Dhaka": "BD",
      "Asia/Colombo": "LK",
      "Asia/Yangon": "MM",
      "Asia/Phnom_Penh": "KH",
      "Asia/Kathmandu": "NP",
      "Asia/Ulaanbaatar": "MN",
      "Asia/Vientiane": "LA",
      "Asia/Brunei": "BN",
      "Asia/Macau": "MO",
      "Asia/Kuwait": "KW",
      "Asia/Qatar": "QA",
      "Asia/Bahrain": "BH",
      "Asia/Muscat": "OM",
      "Asia/Amman": "JO",
      "Asia/Almaty": "KZ",
      "Asia/Tashkent": "UZ",
      "Asia/Baku": "AZ",
      "Asia/Tbilisi": "GE",
      "Australia/Sydney": "AU",
      "Australia/Melbourne": "AU",
      "Pacific/Auckland": "NZ",
      "America/Mexico_City": "MX",
      "America/Sao_Paulo": "BR",
      "America/Argentina/Buenos_Aires": "AR",
      "America/Santiago": "CL",
      "America/Bogota": "CO",
      "Africa/Johannesburg": "ZA",
      "Africa/Lagos": "NG",
      "Africa/Cairo": "EG",
      "Europe/Moscow": "RU",
      "America/Montevideo": "UY",
      "Europe/Bucharest": "RO",
    };
    return tzToCountry[timezone] || "US";
  } catch {
    return "US";
  }
}

// Get country from browser language as fallback
function getCountryFromLanguage(): string {
  try {
    const lang = navigator.language || "en-US";
    const parts = lang.split("-");
    if (parts.length > 1) {
      return parts[1].toUpperCase();
    }
    // Map language codes to likely countries
    const langToCountry: Record<string, string> = {
      en: "US",
      es: "ES",
      fr: "FR",
      de: "DE",
      it: "IT",
      pt: "BR",
      ja: "JP",
      ko: "KR",
      zh: "CN",
      hi: "IN",
      ar: "SA",
      ru: "RU",
      nl: "NL",
      pl: "PL",
      tr: "TR",
      th: "TH",
      vi: "VN",
      id: "ID",
      ms: "MY",
      tl: "PH",
    };
    return langToCountry[parts[0]] || "US";
  } catch {
    return "US";
  }
}

export interface UseCurrencyResult {
  currency: CurrencyInfo;
  countryCode: string;
  convertFromUSD: (usdAmount: number) => number;
  formatPrice: (usdAmount: number, showUSD?: boolean) => string;
  isLocalCurrency: boolean;
}

export function useCurrency(): UseCurrencyResult {
  const [countryCode, setCountryCode] = useState<string>("US");

  useEffect(() => {
    // Try timezone first, then language
    const tzCountry = getCountryFromTimezone();
    const langCountry = getCountryFromLanguage();
    
    // Prefer timezone-based detection
    const detected = CURRENCY_MAP[tzCountry] ? tzCountry : 
                     CURRENCY_MAP[langCountry] ? langCountry : "US";
    
    setCountryCode(detected);
  }, []);

  const currency = CURRENCY_MAP[countryCode] || CURRENCY_MAP["US"];
  const isLocalCurrency = currency.code !== "USD";

  const convertFromUSD = (usdAmount: number): number => {
    return Math.round(usdAmount * currency.rate);
  };

  const formatPrice = (usdAmount: number, showUSD = false): string => {
    const localAmount = convertFromUSD(usdAmount);
    
    // Format based on currency
    let formatted: string;
    if (currency.rate >= 100) {
      // Large numbers - no decimals
      formatted = `${currency.symbol}${localAmount.toLocaleString()}`;
    } else if (currency.rate >= 1) {
      // Medium - maybe 1 decimal for non-round numbers
      formatted = `${currency.symbol}${localAmount}`;
    } else {
      // Small rate (like GBP, EUR) - show decimals
      const precise = (usdAmount * currency.rate).toFixed(0);
      formatted = `${currency.symbol}${precise}`;
    }
    
    if (showUSD && isLocalCurrency) {
      return `${formatted} (~$${usdAmount} USD)`;
    }
    
    return formatted;
  };

  return {
    currency,
    countryCode,
    convertFromUSD,
    formatPrice,
    isLocalCurrency,
  };
}
