// Session storage for resume content - persists across refreshes but not browser close
// This ensures users don't lose their resume if they refresh or navigate away briefly

const SESSION_KEYS = {
  resumeText: 'rb_resume_text',
  linkedInText: 'rb_linkedin_text',
  jobDescriptionText: 'rb_job_description_text',
  multiColumnDetected: 'rb_multi_column_detected',
} as const;

// Separate from saveResumeToSession/getResumeFromSession (rather than adding a
// 4th positional param) so the many existing positional call sites don't need to
// change. This lets the PDF-layout-risk flag computed at upload time survive into
// the post-checkout success page, where the same browser session can reuse it for
// the ATS Defense parse simulation without re-parsing the file.
export const setMultiColumnDetectedInSession = (value: boolean | undefined): void => {
  try {
    if (value === undefined) {
      sessionStorage.removeItem(SESSION_KEYS.multiColumnDetected);
    } else {
      sessionStorage.setItem(SESSION_KEYS.multiColumnDetected, String(value));
    }
  } catch (e) {
    console.warn('[Session] Failed to save multiColumnDetected to session storage:', e);
  }
};

export const getMultiColumnDetectedFromSession = (): boolean | undefined => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEYS.multiColumnDetected);
    return raw === null ? undefined : raw === 'true';
  } catch {
    return undefined;
  }
};

export const saveResumeToSession = (
  resumeText: string,
  linkedInText?: string,
  jobDescriptionText?: string
): void => {
  try {
    if (resumeText) {
      sessionStorage.setItem(SESSION_KEYS.resumeText, resumeText);
    }
    if (linkedInText) {
      sessionStorage.setItem(SESSION_KEYS.linkedInText, linkedInText);
    }
    if (jobDescriptionText) {
      sessionStorage.setItem(SESSION_KEYS.jobDescriptionText, jobDescriptionText);
    }
    console.log('[Session] Saved resume data to session storage');
  } catch (e) {
    console.warn('[Session] Failed to save to session storage:', e);
  }
};

export const getResumeFromSession = (): {
  resumeText: string | null;
  linkedInText: string | null;
  jobDescriptionText: string | null;
} => {
  try {
    return {
      resumeText: sessionStorage.getItem(SESSION_KEYS.resumeText),
      linkedInText: sessionStorage.getItem(SESSION_KEYS.linkedInText),
      jobDescriptionText: sessionStorage.getItem(SESSION_KEYS.jobDescriptionText),
    };
  } catch (e) {
    console.warn('[Session] Failed to read from session storage:', e);
    return { resumeText: null, linkedInText: null, jobDescriptionText: null };
  }
};

export const clearResumeSession = (): void => {
  try {
    sessionStorage.removeItem(SESSION_KEYS.resumeText);
    sessionStorage.removeItem(SESSION_KEYS.linkedInText);
    sessionStorage.removeItem(SESSION_KEYS.jobDescriptionText);
    sessionStorage.removeItem(SESSION_KEYS.multiColumnDetected);
    console.log('[Session] Cleared resume data from session storage');
  } catch (e) {
    console.warn('[Session] Failed to clear session storage:', e);
  }
};

export const hasResumeInSession = (): boolean => {
  try {
    const resumeText = sessionStorage.getItem(SESSION_KEYS.resumeText);
    return !!resumeText && resumeText.length > 50;
  } catch {
    return false;
  }
};
