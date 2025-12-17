// Session storage for resume content - persists across refreshes but not browser close
// This ensures users don't lose their resume if they refresh or navigate away briefly

const SESSION_KEYS = {
  resumeText: 'rb_resume_text',
  linkedInText: 'rb_linkedin_text', 
  jobDescriptionText: 'rb_job_description_text',
} as const;

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
