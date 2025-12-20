/**
 * Validated Supabase Hook
 * Wraps Supabase function calls with frontend validation
 * to catch security issues during development.
 */

import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  validateUUID,
  validateStoreResume,
  validateSaveLead,
  logSecurityWarning,
  sanitizeEmail,
  sanitizeText,
} from '@/lib/security-validation';

export function useValidatedSupabase() {
  /**
   * Validated wrapper for get_temp_resume
   */
  const getTempResume = useCallback(async (sessionId: string) => {
    // Frontend validation (mirrors backend)
    const uuidValidation = validateUUID(sessionId);
    if (!uuidValidation.valid) {
      logSecurityWarning('getTempResume', 'Invalid session ID format', { sessionId });
      throw new Error(uuidValidation.error || 'Invalid session ID');
    }

    const { data, error } = await supabase.rpc('get_temp_resume', {
      p_session_id: sessionId,
    });

    if (error) throw error;
    return data;
  }, []);

  /**
   * Validated wrapper for store_temp_resume
   */
  const storeTempResume = useCallback(async (params: {
    resume: string;
    linkedin?: string | null;
    jobDescription?: string | null;
  }) => {
    // Frontend validation (mirrors backend)
    const validation = validateStoreResume(params);
    if (!validation.valid) {
      logSecurityWarning('storeTempResume', 'Validation failed', validation.errors);
      throw new Error(Object.values(validation.errors || {}).join(', ') || 'Validation failed');
    }

    const { data, error } = await supabase.rpc('store_temp_resume', {
      p_resume: sanitizeText(params.resume),
      p_linkedin: params.linkedin ? sanitizeText(params.linkedin) : null,
      p_job_description: params.jobDescription ? sanitizeText(params.jobDescription) : null,
    });

    if (error) throw error;
    return data;
  }, []);

  /**
   * Validated wrapper for save_free_scan_lead
   */
  const saveFreeScanLead = useCallback(async (params: {
    email: string;
    industry?: string | null;
    atsScore?: number | null;
  }) => {
    // Frontend validation (mirrors backend)
    const validation = validateSaveLead(params);
    if (!validation.valid) {
      logSecurityWarning('saveFreeScanLead', 'Validation failed', validation.errors);
      throw new Error(Object.values(validation.errors || {}).join(', ') || 'Validation failed');
    }

    const { data, error } = await supabase.rpc('save_free_scan_lead', {
      p_email: sanitizeEmail(params.email),
      p_industry: params.industry || null,
      p_ats_score: params.atsScore || null,
    });

    if (error) throw error;
    return data;
  }, []);

  return {
    getTempResume,
    storeTempResume,
    saveFreeScanLead,
  };
}
