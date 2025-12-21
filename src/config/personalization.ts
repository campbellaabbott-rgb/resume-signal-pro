// Personalization configuration for industry-specific and experience-level advice

export interface IndustryConfig {
  name: string;
  keywords: string[];
  resumeTips: string[];
  preferredFormat: string;
  atsNotes: string;
  topSkills: string[];
  certifications: string[];
}

export interface ExperienceLevelConfig {
  level: 'entry' | 'mid' | 'senior' | 'executive';
  resumeLengthPages: number;
  focusAreas: string[];
  avoidAreas: string[];
  keyMessage: string;
  quantificationTip: string;
}

// Industry-specific configurations
export const INDUSTRY_CONFIGS: Record<string, IndustryConfig> = {
  technology: {
    name: 'Technology',
    keywords: ['Agile', 'Scrum', 'CI/CD', 'Cloud', 'AWS', 'Azure', 'Kubernetes', 'Docker', 'APIs', 'Microservices', 'DevOps', 'Machine Learning'],
    resumeTips: [
      'Lead with technical skills section near the top',
      'Include GitHub/portfolio links prominently',
      'Quantify impact: users served, latency reduced, uptime achieved',
      'List specific technologies with version numbers when relevant'
    ],
    preferredFormat: 'Skills-first or hybrid format works best',
    atsNotes: 'Tech companies often use Greenhouse, Lever, or Workday. Ensure clean formatting.',
    topSkills: ['Python', 'JavaScript', 'Cloud Architecture', 'System Design', 'Data Structures'],
    certifications: ['AWS Solutions Architect', 'Google Cloud Professional', 'Kubernetes Administrator']
  },
  healthcare: {
    name: 'Healthcare',
    keywords: ['HIPAA', 'Patient Care', 'EHR', 'EMR', 'Clinical', 'Compliance', 'Quality Assurance', 'Care Coordination', 'Evidence-Based'],
    resumeTips: [
      'Include license numbers and certifications prominently',
      'Emphasize patient outcomes and safety metrics',
      'List specific equipment and systems experience',
      'Highlight continuing education and training'
    ],
    preferredFormat: 'Reverse chronological with certifications section',
    atsNotes: 'Healthcare uses iCIMS, Taleo heavily. Include exact certification names.',
    topSkills: ['Patient Assessment', 'Care Planning', 'Medical Terminology', 'EHR Systems'],
    certifications: ['RN', 'BSN', 'MSN', 'ACLS', 'BLS', 'CNA', 'LPN']
  },
  finance: {
    name: 'Finance & Banking',
    keywords: ['Financial Analysis', 'Risk Management', 'Compliance', 'Portfolio', 'Bloomberg', 'Excel Modeling', 'Due Diligence', 'Valuation', 'M&A'],
    resumeTips: [
      'Quantify everything: deal sizes, AUM, revenue impact',
      'Highlight regulatory knowledge (SEC, FINRA, SOX)',
      'Include specific financial software proficiency',
      'Showcase analytical and modeling capabilities'
    ],
    preferredFormat: 'Traditional reverse chronological, conservative formatting',
    atsNotes: 'Finance firms use Workday, Taleo. Avoid creative formatting.',
    topSkills: ['Financial Modeling', 'Risk Analysis', 'Regulatory Compliance', 'Data Analysis'],
    certifications: ['CFA', 'CPA', 'FRM', 'Series 7', 'Series 63']
  },
  marketing: {
    name: 'Marketing & Advertising',
    keywords: ['SEO', 'SEM', 'Content Strategy', 'Brand', 'Analytics', 'ROI', 'Campaign', 'Conversion', 'A/B Testing', 'Social Media'],
    resumeTips: [
      'Show metrics: CTR, conversion rates, ROAS, engagement',
      'Include links to campaigns or portfolio',
      'Highlight cross-functional collaboration',
      'Demonstrate data-driven decision making'
    ],
    preferredFormat: 'Hybrid format with achievements front and center',
    atsNotes: 'Marketing companies vary widely. Test with Greenhouse and Lever formats.',
    topSkills: ['Google Analytics', 'Marketing Automation', 'Content Marketing', 'Paid Media'],
    certifications: ['Google Ads', 'HubSpot', 'Facebook Blueprint', 'Google Analytics']
  },
  sales: {
    name: 'Sales',
    keywords: ['Revenue', 'Quota', 'Pipeline', 'CRM', 'Salesforce', 'Prospecting', 'Negotiation', 'Account Management', 'B2B', 'B2C'],
    resumeTips: [
      'Lead with numbers: quota attainment %, revenue generated',
      'Show consistent track record of meeting/exceeding targets',
      'Highlight deal sizes and customer retention',
      'Include specific CRM and sales tool experience'
    ],
    preferredFormat: 'Achievement-focused with prominent metrics',
    atsNotes: 'Sales teams love numbers. Include them in every bullet.',
    topSkills: ['Negotiation', 'Relationship Building', 'Pipeline Management', 'Closing'],
    certifications: ['Salesforce Admin', 'HubSpot Sales', 'Challenger Sales']
  },
  engineering: {
    name: 'Engineering (Non-Software)',
    keywords: ['CAD', 'AutoCAD', 'SolidWorks', 'Project Management', 'P&ID', 'Lean', 'Six Sigma', 'Quality Control', 'Specifications'],
    resumeTips: [
      'Include PE license if applicable',
      'List specific software and tools with versions',
      'Quantify project budgets, timelines, team sizes',
      'Highlight safety records and compliance'
    ],
    preferredFormat: 'Reverse chronological with technical skills section',
    atsNotes: 'Engineering firms use Taleo, Workday. Include exact software names.',
    topSkills: ['CAD Software', 'Project Management', 'Technical Documentation', 'Problem Solving'],
    certifications: ['PE', 'PMP', 'Six Sigma', 'LEED']
  },
  education: {
    name: 'Education',
    keywords: ['Curriculum', 'Assessment', 'Differentiation', 'IEP', 'Classroom Management', 'Student Outcomes', 'Professional Development'],
    resumeTips: [
      'Include teaching certifications and endorsements',
      'Show student achievement data and improvements',
      'Highlight specialized training and methodologies',
      'List grade levels and subjects taught'
    ],
    preferredFormat: 'Reverse chronological with certifications prominent',
    atsNotes: 'School districts use varied systems. Keep format simple.',
    topSkills: ['Classroom Management', 'Curriculum Development', 'Assessment', 'Technology Integration'],
    certifications: ['State Teaching License', 'TESOL', 'Special Education Endorsement']
  },
  hr: {
    name: 'Human Resources',
    keywords: ['HRIS', 'Talent Acquisition', 'Employee Relations', 'Benefits', 'Compliance', 'Onboarding', 'Performance Management', 'SHRM'],
    resumeTips: [
      'Quantify hires made, retention rates, time-to-fill',
      'Highlight HRIS systems experience (Workday, SAP, etc.)',
      'Show knowledge of employment law and compliance',
      'Include DEI initiatives and outcomes'
    ],
    preferredFormat: 'Achievement-focused hybrid format',
    atsNotes: 'HR professionals are ATS experts—format flawlessly!',
    topSkills: ['Talent Acquisition', 'Employee Relations', 'HRIS', 'Compensation & Benefits'],
    certifications: ['SHRM-CP', 'SHRM-SCP', 'PHR', 'SPHR']
  },
  consulting: {
    name: 'Consulting',
    keywords: ['Client Engagement', 'Stakeholder Management', 'Strategy', 'Analysis', 'Recommendations', 'Implementation', 'Change Management'],
    resumeTips: [
      'Use case study format: situation, action, result',
      'Quantify client impact and business outcomes',
      'Highlight industries and functional areas served',
      'Show progression and increasing responsibility'
    ],
    preferredFormat: 'Achievement-focused with client impact stories',
    atsNotes: 'Consulting firms use varied systems. Focus on impact stories.',
    topSkills: ['Strategic Planning', 'Client Management', 'Data Analysis', 'Presentation'],
    certifications: ['PMP', 'Six Sigma', 'Industry-specific certifications']
  },
  general: {
    name: 'General / Other',
    keywords: ['Leadership', 'Communication', 'Problem Solving', 'Team Collaboration', 'Project Management', 'Customer Service'],
    resumeTips: [
      'Focus on transferable skills and achievements',
      'Quantify impact wherever possible',
      'Tailor keywords to specific job descriptions',
      'Highlight relevant experience prominently'
    ],
    preferredFormat: 'Reverse chronological for most roles',
    atsNotes: 'Match keywords from the job description closely.',
    topSkills: ['Communication', 'Problem Solving', 'Leadership', 'Teamwork'],
    certifications: ['Varies by field']
  }
};

// Experience level configurations
export const EXPERIENCE_CONFIGS: Record<string, ExperienceLevelConfig> = {
  entry: {
    level: 'entry',
    resumeLengthPages: 1,
    focusAreas: [
      'Education and relevant coursework',
      'Internships and project experience',
      'Transferable skills from any work',
      'Technical skills and tools learned'
    ],
    avoidAreas: [
      'Objective statements (use summary instead)',
      'High school information (unless recent grad)',
      'Unrelated jobs without transferable skills'
    ],
    keyMessage: 'Show potential and eagerness to learn',
    quantificationTip: 'Even entry-level work has numbers: customers served, projects completed, hours volunteered'
  },
  mid: {
    level: 'mid',
    resumeLengthPages: 1,
    focusAreas: [
      'Concrete achievements with metrics',
      'Growing responsibility and leadership',
      'Specialized skills development',
      'Cross-functional collaboration'
    ],
    avoidAreas: [
      'Entry-level tasks (focus on growth)',
      'Too much detail on older roles',
      'Skills that are now expected (basic software)'
    ],
    keyMessage: 'Demonstrate consistent growth and impact',
    quantificationTip: 'Show progression: increased responsibilities, bigger projects, larger budgets'
  },
  senior: {
    level: 'senior',
    resumeLengthPages: 2,
    focusAreas: [
      'Leadership and team development',
      'Strategic initiatives and outcomes',
      'Cross-departmental impact',
      'Mentoring and knowledge transfer'
    ],
    avoidAreas: [
      'Tactical details (focus on strategy)',
      'Roles from 15+ years ago in detail',
      'Skills that should be assumed at your level'
    ],
    keyMessage: 'Show strategic thinking and leadership impact',
    quantificationTip: 'Focus on team size, budget managed, revenue influenced, org-wide impact'
  },
  executive: {
    level: 'executive',
    resumeLengthPages: 2,
    focusAreas: [
      'P&L responsibility and business outcomes',
      'Transformation and change leadership',
      'Board and stakeholder management',
      'Vision setting and culture building'
    ],
    avoidAreas: [
      'Tactical execution details',
      'Skills lists (assumed at C-level)',
      'Early career details beyond titles'
    ],
    keyMessage: 'Show business transformation and vision',
    quantificationTip: 'Revenue, market share, valuation, M&A deals, organizational scale'
  }
};

// Get personalized advice based on industry
export function getIndustryAdvice(industry: string): IndustryConfig {
  const normalizedIndustry = industry.toLowerCase();
  
  // Map common industry names to our configs
  if (normalizedIndustry.includes('tech') || normalizedIndustry.includes('software') || normalizedIndustry.includes('it')) {
    return INDUSTRY_CONFIGS.technology;
  }
  if (normalizedIndustry.includes('health') || normalizedIndustry.includes('medical') || normalizedIndustry.includes('hospital')) {
    return INDUSTRY_CONFIGS.healthcare;
  }
  if (normalizedIndustry.includes('financ') || normalizedIndustry.includes('bank') || normalizedIndustry.includes('investment')) {
    return INDUSTRY_CONFIGS.finance;
  }
  if (normalizedIndustry.includes('market') || normalizedIndustry.includes('advertis') || normalizedIndustry.includes('brand')) {
    return INDUSTRY_CONFIGS.marketing;
  }
  if (normalizedIndustry.includes('sales') || normalizedIndustry.includes('business develop')) {
    return INDUSTRY_CONFIGS.sales;
  }
  if (normalizedIndustry.includes('engineer') && !normalizedIndustry.includes('software')) {
    return INDUSTRY_CONFIGS.engineering;
  }
  if (normalizedIndustry.includes('education') || normalizedIndustry.includes('teaching') || normalizedIndustry.includes('school')) {
    return INDUSTRY_CONFIGS.education;
  }
  if (normalizedIndustry.includes('hr') || normalizedIndustry.includes('human resource') || normalizedIndustry.includes('recruit')) {
    return INDUSTRY_CONFIGS.hr;
  }
  if (normalizedIndustry.includes('consult')) {
    return INDUSTRY_CONFIGS.consulting;
  }
  
  return INDUSTRY_CONFIGS.general;
}

// Get personalized advice based on experience level
export function getExperienceAdvice(level: string): ExperienceLevelConfig {
  const normalizedLevel = level.toLowerCase();
  
  if (normalizedLevel.includes('entry') || normalizedLevel.includes('junior') || normalizedLevel.includes('0-2')) {
    return EXPERIENCE_CONFIGS.entry;
  }
  if (normalizedLevel.includes('mid') || normalizedLevel.includes('3-')) {
    return EXPERIENCE_CONFIGS.mid;
  }
  if (normalizedLevel.includes('senior') || normalizedLevel.includes('7-') || normalizedLevel.includes('8-')) {
    return EXPERIENCE_CONFIGS.senior;
  }
  if (normalizedLevel.includes('executive') || normalizedLevel.includes('director') || normalizedLevel.includes('vp') || normalizedLevel.includes('c-level')) {
    return EXPERIENCE_CONFIGS.executive;
  }
  
  return EXPERIENCE_CONFIGS.mid; // Default to mid if unclear
}

// Generate personalized improvement priorities
export function getPersonalizedPriorities(
  industry: string,
  experienceLevel: string,
  atsScore: number,
  hasJobDescription: boolean
): string[] {
  const priorities: string[] = [];
  const industryConfig = getIndustryAdvice(industry);
  const expConfig = getExperienceAdvice(experienceLevel);
  
  // Score-based priorities
  if (atsScore < 50) {
    priorities.push('Critical: Your ATS score is very low. Focus on keyword optimization first.');
  } else if (atsScore < 70) {
    priorities.push('Important: Your score has room to improve. Add more industry keywords.');
  }
  
  // Experience-level specific
  priorities.push(`For ${expConfig.level}-level candidates: ${expConfig.keyMessage}`);
  
  // Industry-specific
  priorities.push(`${industryConfig.name} tip: ${industryConfig.resumeTips[0]}`);
  
  // Job description guidance
  if (hasJobDescription) {
    priorities.push('You have a target job - tailor your resume specifically to match those requirements.');
  } else {
    priorities.push('Add a job description to get job-specific recommendations.');
  }
  
  return priorities.slice(0, 4);
}
