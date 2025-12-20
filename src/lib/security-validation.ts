/**
 * Security Validation Utilities
 * These mirror backend validation rules to catch issues during development.
 * Always validate on both frontend AND backend for defense-in-depth.
 */

import { z } from 'zod';

// UUID validation schema
export const uuidSchema = z.string().regex(
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  'Invalid UUID format'
);

// Email validation schema (matches backend regex)
export const emailSchema = z.string()
  .trim()
  .min(1, 'Email is required')
  .max(255, 'Email must be less than 255 characters')
  .regex(
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
    'Invalid email format'
  );

// Resume text validation (matches backend rules)
export const resumeTextSchema = z.string()
  .min(50, 'Resume must be at least 50 characters')
  .max(50000, 'Resume must be less than 50,000 characters');

// LinkedIn text validation
export const linkedInTextSchema = z.string()
  .max(50000, 'LinkedIn text must be less than 50,000 characters')
  .nullable()
  .optional();

// Job description validation
export const jobDescriptionSchema = z.string()
  .max(50000, 'Job description must be less than 50,000 characters')
  .nullable()
  .optional();

// Industry validation
export const industrySchema = z.string()
  .max(100, 'Industry must be less than 100 characters')
  .nullable()
  .optional();

// ATS score validation
export const atsScoreSchema = z.number()
  .min(0, 'ATS score must be at least 0')
  .max(100, 'ATS score must be at most 100')
  .nullable()
  .optional();

// Combined schemas for common operations
export const storeResumeSchema = z.object({
  resume: resumeTextSchema,
  linkedin: linkedInTextSchema,
  jobDescription: jobDescriptionSchema,
});

export const saveLeadSchema = z.object({
  email: emailSchema,
  industry: industrySchema,
  atsScore: atsScoreSchema,
});

export const getResumeSchema = z.object({
  sessionId: uuidSchema,
});

// Validation helper functions
export function validateUUID(value: string): { valid: boolean; error?: string } {
  const result = uuidSchema.safeParse(value);
  return result.success 
    ? { valid: true } 
    : { valid: false, error: result.error.errors[0]?.message };
}

export function validateEmail(value: string): { valid: boolean; error?: string } {
  const result = emailSchema.safeParse(value);
  return result.success 
    ? { valid: true } 
    : { valid: false, error: result.error.errors[0]?.message };
}

export function validateResumeText(value: string): { valid: boolean; error?: string } {
  const result = resumeTextSchema.safeParse(value);
  return result.success 
    ? { valid: true } 
    : { valid: false, error: result.error.errors[0]?.message };
}

export function validateStoreResume(data: {
  resume: string;
  linkedin?: string | null;
  jobDescription?: string | null;
}): { valid: boolean; errors?: Record<string, string> } {
  const result = storeResumeSchema.safeParse(data);
  if (result.success) {
    return { valid: true };
  }
  
  const errors: Record<string, string> = {};
  result.error.errors.forEach((err) => {
    const path = err.path.join('.');
    errors[path] = err.message;
  });
  return { valid: false, errors };
}

export function validateSaveLead(data: {
  email: string;
  industry?: string | null;
  atsScore?: number | null;
}): { valid: boolean; errors?: Record<string, string> } {
  const result = saveLeadSchema.safeParse(data);
  if (result.success) {
    return { valid: true };
  }
  
  const errors: Record<string, string> = {};
  result.error.errors.forEach((err) => {
    const path = err.path.join('.');
    errors[path] = err.message;
  });
  return { valid: false, errors };
}

// Sanitization helpers
export function sanitizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function sanitizeText(text: string): string {
  return text.trim();
}

// Security logging helper (for development)
export function logSecurityWarning(context: string, message: string, data?: unknown): void {
  if (import.meta.env.DEV) {
    console.warn(`[SECURITY WARNING] ${context}: ${message}`, data);
  }
}

// Input length check helper
export function checkInputLength(
  fieldName: string, 
  value: string | null | undefined, 
  maxLength: number
): boolean {
  if (!value) return true;
  if (value.length > maxLength) {
    logSecurityWarning('Input Validation', `${fieldName} exceeds max length of ${maxLength}`, {
      actualLength: value.length,
      maxLength,
    });
    return false;
  }
  return true;
}
