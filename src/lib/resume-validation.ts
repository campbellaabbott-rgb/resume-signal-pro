/**
 * Frontend validation utilities for resume scanning
 * 1. Ensures full resume text is sent without truncation
 * 2. Validates AI's yearsEstimate against detected date ranges
 */

// Minimum expected resume length (characters) - very short resumes are suspicious
const MIN_RESUME_LENGTH = 200;
// Maximum resume length we'll send (to prevent accidental huge payloads)
const MAX_RESUME_LENGTH = 100000;

export interface ResumeValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  originalLength: number;
  detectedDateRange?: {
    earliestYear: number;
    latestYear: number;
    spanYears: number;
  };
}

export interface ExperienceValidationResult {
  isConsistent: boolean;
  warning?: string;
  detectedSpan: number;
  aiEstimate: number;
  discrepancy: number;
}

/**
 * Extract years from resume text (e.g., "2015", "2019-2022", "January 2015")
 */
export function extractYearsFromText(text: string): number[] {
  const years: number[] = [];
  const currentYear = new Date().getFullYear();
  
  // Match 4-digit years between 1970 and current year + 1
  const yearRegex = /\b(19[7-9]\d|20[0-2]\d)\b/g;
  let match;
  
  while ((match = yearRegex.exec(text)) !== null) {
    const year = parseInt(match[1], 10);
    if (year >= 1970 && year <= currentYear + 1) {
      years.push(year);
    }
  }
  
  // Also detect "present", "current", "ongoing" as current year
  if (/\b(present|current|ongoing|now|today)\b/i.test(text)) {
    years.push(currentYear);
  }
  
  return [...new Set(years)].sort((a, b) => a - b);
}

/**
 * Parse AI's yearsEstimate string to a number
 * Handles formats like "10 years", "9+ years", "5-7 years", etc.
 */
export function parseYearsEstimate(estimate: string): number {
  if (!estimate) return 0;
  
  const cleaned = estimate.toLowerCase().trim();
  
  // Handle "X+ years" format
  const plusMatch = cleaned.match(/(\d+)\+?\s*years?/i);
  if (plusMatch) {
    return parseInt(plusMatch[1], 10);
  }
  
  // Handle "X-Y years" range format - take the higher value
  const rangeMatch = cleaned.match(/(\d+)\s*-\s*(\d+)\s*years?/i);
  if (rangeMatch) {
    return parseInt(rangeMatch[2], 10);
  }
  
  // Handle plain number
  const numMatch = cleaned.match(/(\d+)/);
  if (numMatch) {
    return parseInt(numMatch[1], 10);
  }
  
  return 0;
}

/**
 * Validate resume text before sending to AI
 */
export function validateResumeBeforeSend(resumeText: string): ResumeValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const originalLength = resumeText?.length || 0;
  
  // Check for empty or missing resume
  if (!resumeText || resumeText.trim().length === 0) {
    errors.push('Resume text is empty');
    return { isValid: false, warnings, errors, originalLength };
  }
  
  // Check minimum length
  if (originalLength < MIN_RESUME_LENGTH) {
    warnings.push(`Resume seems very short (${originalLength} characters). Some content may be missing.`);
  }
  
  // Check maximum length (truncation protection)
  if (originalLength > MAX_RESUME_LENGTH) {
    errors.push(`Resume text exceeds maximum length (${originalLength} > ${MAX_RESUME_LENGTH}). Please use a shorter resume.`);
    return { isValid: false, warnings, errors, originalLength };
  }
  
  // Extract and analyze date range
  const years = extractYearsFromText(resumeText);
  let detectedDateRange: ResumeValidationResult['detectedDateRange'];
  
  if (years.length >= 2) {
    const earliestYear = years[0];
    const latestYear = years[years.length - 1];
    const spanYears = latestYear - earliestYear;
    
    detectedDateRange = { earliestYear, latestYear, spanYears };
    
    console.log(`[ResumeValidation] Detected date range: ${earliestYear} to ${latestYear} (${spanYears} years)`);
  } else if (years.length === 1) {
    console.log(`[ResumeValidation] Only one year detected: ${years[0]}`);
  } else {
    warnings.push('No work dates detected in resume. Experience calculation may be inaccurate.');
  }
  
  // Check for common truncation indicators
  if (resumeText.endsWith('...') || resumeText.endsWith('…')) {
    warnings.push('Resume appears to be truncated (ends with ellipsis)');
  }
  
  // Check for incomplete sections (text cut off mid-word/sentence)
  const lastChar = resumeText.trim().slice(-1);
  const endsWithPunctuation = /[.!?:;,]/.test(lastChar);
  if (!endsWithPunctuation && resumeText.length > 500) {
    warnings.push('Resume may be truncated (does not end with punctuation)');
  }
  
  return {
    isValid: errors.length === 0,
    warnings,
    errors,
    originalLength,
    detectedDateRange,
  };
}

/**
 * Validate AI's experience estimate against detected date range
 */
export function validateExperienceEstimate(
  resumeText: string,
  aiYearsEstimate: string
): ExperienceValidationResult {
  const years = extractYearsFromText(resumeText);
  const currentYear = new Date().getFullYear();
  
  // Calculate detected span
  let detectedSpan = 0;
  if (years.length >= 2) {
    const earliestYear = years[0];
    // Use current year if "present" was detected, otherwise latest year found
    const latestYear = years.includes(currentYear) ? currentYear : years[years.length - 1];
    detectedSpan = latestYear - earliestYear;
  } else if (years.length === 1) {
    // Single year - assume it's the start, calculate to now
    detectedSpan = currentYear - years[0];
  }
  
  // Parse AI's estimate
  const aiEstimate = parseYearsEstimate(aiYearsEstimate);
  
  // Calculate discrepancy
  const discrepancy = detectedSpan - aiEstimate;
  
  // Threshold for warning: if AI underestimates by more than 2 years, flag it
  const DISCREPANCY_THRESHOLD = 2;
  const isConsistent = discrepancy <= DISCREPANCY_THRESHOLD;
  
  let warning: string | undefined;
  if (!isConsistent && detectedSpan > 0) {
    warning = `Experience calculation may be low: Resume shows dates spanning ~${detectedSpan} years (${years[0]} to ${years.includes(currentYear) ? 'present' : years[years.length - 1]}), but analysis estimated ${aiEstimate} years. All roles including consulting, freelance, and part-time work should count.`;
    console.warn(`[ResumeValidation] ${warning}`);
  }
  
  console.log(`[ResumeValidation] Experience validation: detected=${detectedSpan}y, AI=${aiEstimate}y, discrepancy=${discrepancy}y, consistent=${isConsistent}`);
  
  return {
    isConsistent,
    warning,
    detectedSpan,
    aiEstimate,
    discrepancy,
  };
}
