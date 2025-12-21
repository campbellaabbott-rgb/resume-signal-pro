// Personalization context for resume-based content customization
// Persists extracted metadata to enhance all AI-generated content

import { useState, useEffect, useCallback } from 'react';

export interface PersonalizationProfile {
  // Core metadata extracted from resume analysis
  industry: string | null;
  experienceLevel: 'entry' | 'mid' | 'senior' | 'executive' | null;
  atsScore: number | null;
  
  // Skills and keywords detected
  topSkills: string[];
  missingKeywords: string[];
  
  // Career signals
  currentRole: string | null;
  targetRole: string | null;
  yearsExperience: number | null;
  
  // Content for reuse
  resumeText: string | null;
  linkedInText: string | null;
  jobDescriptionText: string | null;
  
  // Timestamps
  lastAnalyzedAt: string | null;
  sessionId: string | null;
}

const STORAGE_KEY = 'rb_personalization_profile';
const PROFILE_EXPIRY_HOURS = 24;

const defaultProfile: PersonalizationProfile = {
  industry: null,
  experienceLevel: null,
  atsScore: null,
  topSkills: [],
  missingKeywords: [],
  currentRole: null,
  targetRole: null,
  yearsExperience: null,
  resumeText: null,
  linkedInText: null,
  jobDescriptionText: null,
  lastAnalyzedAt: null,
  sessionId: null,
};

// Extract years of experience from resume text
const estimateYearsExperience = (resumeText: string): number | null => {
  // Look for explicit mentions like "10+ years" or "8 years of experience"
  const yearPatterns = [
    /(\d+)\+?\s*years?\s*(of\s*)?(experience|in)/gi,
    /(\d+)\+?\s*years?\s*professional/gi,
    /(over|more than)\s*(\d+)\s*years?/gi,
  ];
  
  for (const pattern of yearPatterns) {
    const match = resumeText.match(pattern);
    if (match) {
      const numMatch = match[0].match(/\d+/);
      if (numMatch) {
        return parseInt(numMatch[0], 10);
      }
    }
  }
  
  // Count distinct years from work experience dates
  const yearMentions = resumeText.match(/20\d{2}|19\d{2}/g);
  if (yearMentions && yearMentions.length >= 2) {
    const years = yearMentions.map(y => parseInt(y, 10)).sort((a, b) => a - b);
    const range = years[years.length - 1] - years[0];
    if (range > 0 && range < 50) {
      return range;
    }
  }
  
  return null;
};

// Extract current role from resume
const extractCurrentRole = (resumeText: string): string | null => {
  // Look for first job title pattern (usually current role)
  const titlePatterns = [
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*[-–|]\s*(?:Present|Current)/gm,
    /^(?:Position|Title|Role):\s*(.+)$/gim,
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Manager|Engineer|Developer|Designer|Analyst|Director|Lead|Specialist|Coordinator|Consultant|Associate))+)/gm,
  ];
  
  for (const pattern of titlePatterns) {
    const match = resumeText.match(pattern);
    if (match && match[1]) {
      return match[1].trim().slice(0, 100);
    }
  }
  
  return null;
};

// Extract top skills from resume
const extractTopSkills = (resumeText: string, analysisSkills?: string[]): string[] => {
  if (analysisSkills && analysisSkills.length > 0) {
    return analysisSkills.slice(0, 10);
  }
  
  // Common skill keywords to look for
  const skillKeywords = [
    'JavaScript', 'Python', 'React', 'Node.js', 'SQL', 'AWS', 'Java', 'TypeScript',
    'Machine Learning', 'Data Analysis', 'Project Management', 'Agile', 'Scrum',
    'Leadership', 'Communication', 'Excel', 'Salesforce', 'Marketing', 'Sales',
    'Customer Service', 'Financial Analysis', 'Strategic Planning', 'Team Management',
    'Product Management', 'UX Design', 'UI Design', 'Content Marketing', 'SEO',
  ];
  
  const found: string[] = [];
  const lowerText = resumeText.toLowerCase();
  
  for (const skill of skillKeywords) {
    if (lowerText.includes(skill.toLowerCase()) && found.length < 10) {
      found.push(skill);
    }
  }
  
  return found;
};

export const usePersonalization = () => {
  const [profile, setProfile] = useState<PersonalizationProfile>(defaultProfile);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load profile from storage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PersonalizationProfile & { _savedAt?: string };
        
        // Check expiry
        if (parsed._savedAt) {
          const savedAt = new Date(parsed._savedAt);
          const hoursSince = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);
          
          if (hoursSince < PROFILE_EXPIRY_HOURS) {
            // Remove internal field before setting state
            const { _savedAt, ...profileData } = parsed as any;
            setProfile(profileData);
          } else {
            // Expired, clear storage
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      }
    } catch (e) {
      console.warn('[Personalization] Failed to load profile:', e);
    }
    setIsLoaded(true);
  }, []);

  // Save profile to storage
  const saveProfile = useCallback((newProfile: PersonalizationProfile) => {
    try {
      const toStore = {
        ...newProfile,
        _savedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
      setProfile(newProfile);
      console.log('[Personalization] Profile saved', { industry: newProfile.industry, experienceLevel: newProfile.experienceLevel });
    } catch (e) {
      console.warn('[Personalization] Failed to save profile:', e);
    }
  }, []);

  // Update profile from analysis results
  const updateFromAnalysis = useCallback((
    analysisResult: any,
    resumeText: string,
    linkedInText?: string | null,
    jobDescriptionText?: string | null,
    sessionId?: string | null
  ) => {
    const newProfile: PersonalizationProfile = {
      industry: analysisResult?.industry || null,
      experienceLevel: analysisResult?.experienceLevel || null,
      atsScore: analysisResult?.atsScore?.score || null,
      topSkills: extractTopSkills(resumeText, analysisResult?.keywords),
      missingKeywords: analysisResult?.skillsGap?.missingTechnical || [],
      currentRole: extractCurrentRole(resumeText),
      targetRole: null, // Could be extracted from job description
      yearsExperience: estimateYearsExperience(resumeText),
      resumeText,
      linkedInText: linkedInText || null,
      jobDescriptionText: jobDescriptionText || null,
      lastAnalyzedAt: new Date().toISOString(),
      sessionId: sessionId || null,
    };
    
    // Extract target role from job description if available
    if (jobDescriptionText) {
      const titleMatch = jobDescriptionText.match(/^(?:Job\s*Title|Position|Role):\s*(.+)$/im);
      if (titleMatch) {
        newProfile.targetRole = titleMatch[1].trim().slice(0, 100);
      }
    }
    
    saveProfile(newProfile);
    return newProfile;
  }, [saveProfile]);

  // Update just the resume content (for pre-analysis storage)
  const updateResumeContent = useCallback((
    resumeText: string,
    linkedInText?: string | null,
    jobDescriptionText?: string | null
  ) => {
    const newProfile: PersonalizationProfile = {
      ...profile,
      resumeText,
      linkedInText: linkedInText || profile.linkedInText,
      jobDescriptionText: jobDescriptionText || profile.jobDescriptionText,
    };
    saveProfile(newProfile);
  }, [profile, saveProfile]);

  // Clear profile
  const clearProfile = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setProfile(defaultProfile);
      console.log('[Personalization] Profile cleared');
    } catch (e) {
      console.warn('[Personalization] Failed to clear profile:', e);
    }
  }, []);

  // Get personalization context for AI prompts
  const getAIContext = useCallback(() => {
    if (!profile.industry && !profile.experienceLevel && !profile.resumeText) {
      return null;
    }
    
    const contextParts: string[] = [];
    
    if (profile.industry) {
      contextParts.push(`Industry: ${profile.industry}`);
    }
    if (profile.experienceLevel) {
      const levelDescriptions = {
        entry: 'Entry-level (0-2 years)',
        mid: 'Mid-level (3-6 years)',
        senior: 'Senior-level (7-12 years)',
        executive: 'Executive/Leadership (12+ years)',
      };
      contextParts.push(`Experience Level: ${levelDescriptions[profile.experienceLevel]}`);
    }
    if (profile.currentRole) {
      contextParts.push(`Current Role: ${profile.currentRole}`);
    }
    if (profile.targetRole) {
      contextParts.push(`Target Role: ${profile.targetRole}`);
    }
    if (profile.yearsExperience) {
      contextParts.push(`Years of Experience: ${profile.yearsExperience}`);
    }
    if (profile.topSkills.length > 0) {
      contextParts.push(`Key Skills: ${profile.topSkills.slice(0, 8).join(', ')}`);
    }
    if (profile.atsScore) {
      contextParts.push(`Current ATS Score: ${profile.atsScore}/100`);
    }
    
    return contextParts.length > 0 ? contextParts.join('\n') : null;
  }, [profile]);

  // Get product recommendations based on profile
  const getProductRecommendations = useCallback(() => {
    const recommendations: Array<{
      productId: string;
      reason: string;
      priority: 'high' | 'medium' | 'low';
    }> = [];
    
    // Low ATS score - prioritize keyword optimization
    if (profile.atsScore && profile.atsScore < 60) {
      recommendations.push({
        productId: 'keyword-optimizer',
        reason: `Your ATS score of ${profile.atsScore}% suggests keyword optimization would have the biggest impact.`,
        priority: 'high',
      });
    }
    
    // Has job description - recommend tailored resume
    if (profile.jobDescriptionText) {
      recommendations.push({
        productId: 'tailored-resume',
        reason: 'Get a resume customized specifically for this job posting.',
        priority: 'high',
      });
      recommendations.push({
        productId: 'cover-letter',
        reason: 'A matching cover letter will strengthen your application.',
        priority: 'medium',
      });
    }
    
    // Senior/Executive - premium package
    if (profile.experienceLevel === 'senior' || profile.experienceLevel === 'executive') {
      recommendations.push({
        productId: 'premium-package',
        reason: 'The premium package offers comprehensive optimization for experienced professionals.',
        priority: 'high',
      });
    }
    
    // Entry level - focus on fundamentals
    if (profile.experienceLevel === 'entry') {
      recommendations.push({
        productId: 'keyword-optimizer',
        reason: 'Keyword optimization helps entry-level candidates compete with experienced applicants.',
        priority: 'high',
      });
    }
    
    // Missing skills - skill gap analysis
    if (profile.missingKeywords.length > 3) {
      recommendations.push({
        productId: 'keyword-optimizer',
        reason: `We detected ${profile.missingKeywords.length} missing industry keywords that could boost your visibility.`,
        priority: 'medium',
      });
    }
    
    // Has LinkedIn - suggest optimization
    if (profile.linkedInText) {
      recommendations.push({
        productId: 'linkedin-optimizer',
        reason: 'Your LinkedIn profile can be optimized alongside your resume for consistent branding.',
        priority: 'medium',
      });
    }
    
    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    
    // Remove duplicates by productId
    const seen = new Set<string>();
    return recommendations.filter(r => {
      if (seen.has(r.productId)) return false;
      seen.add(r.productId);
      return true;
    });
  }, [profile]);

  return {
    profile,
    isLoaded,
    updateFromAnalysis,
    updateResumeContent,
    clearProfile,
    getAIContext,
    getProductRecommendations,
    hasProfile: !!(profile.industry || profile.experienceLevel || profile.resumeText),
  };
};
