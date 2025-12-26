import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

// Metric context for tracking
interface ScanMetricContext {
  supabase: any;
  startTime: number;
  scanType: string;
  cacheHit: boolean;
  ipCountry: string | null;
  visitorId: string | null;
  inputLength: number;
  aiModel: string;
}

// Log scan metric to database (non-blocking)
function logScanMetric(
  ctx: ScanMetricContext,
  status: 'started' | 'completed' | 'failed' | 'validation_error',
  options?: {
    errorCode?: string;
    errorMessage?: string;
    outputValid?: boolean;
    responseScore?: number;
    metadata?: Record<string, unknown>;
  }
): void {
  const durationMs = Date.now() - ctx.startTime;
  
  EdgeRuntime.waitUntil(
    ctx.supabase.rpc('log_scan_metric', {
      p_scan_type: ctx.scanType,
      p_status: status,
      p_duration_ms: durationMs,
      p_cache_hit: ctx.cacheHit,
      p_ai_model: ctx.aiModel,
      p_error_code: options?.errorCode || null,
      p_error_message: options?.errorMessage || null,
      p_ip_country: ctx.ipCountry,
      p_visitor_id: ctx.visitorId,
      p_input_length: ctx.inputLength,
      p_output_valid: options?.outputValid ?? null,
      p_response_score: options?.responseScore ?? null,
      p_metadata: options?.metadata || {}
    }).then(({ error }: any) => {
      if (error) {
        console.error(`[FREE-KEYWORD-SCAN-STREAM] Failed to log metric:`, error.message);
      } else {
        console.log(`[FREE-KEYWORD-SCAN-STREAM] Logged metric: ${status} (${durationMs}ms)`);
      }
    })
  );
}

// Valid industries list
const VALID_INDUSTRIES = [
  'technology', 'healthcare', 'finance', 'legal', 'sales', 
  'marketing', 'education', 'engineering', 'creative', 'hr', 
  'consulting', 'retail', 'hospitality', 'manufacturing', 
  'government', 'general'
];

// Industry aliases for normalization
const INDUSTRY_ALIASES: Record<string, string> = {
  'tech': 'technology', 'software': 'technology', 'it': 'technology',
  'software development': 'technology', 'information technology': 'technology',
  'medical': 'healthcare', 'health': 'healthcare', 'medicine': 'healthcare',
  'nursing': 'healthcare', 'pharmaceutical': 'healthcare',
  'law': 'legal', 'attorney': 'legal', 'lawyer': 'legal',
  'banking': 'finance', 'accounting': 'finance', 'financial services': 'finance',
  'advertising': 'marketing', 'pr': 'marketing', 'public relations': 'marketing',
  'teaching': 'education', 'academia': 'education', 'academic': 'education',
  'design': 'creative', 'art': 'creative', 'media': 'creative',
  'human resources': 'hr', 'recruitment': 'hr', 'talent': 'hr',
  'management consulting': 'consulting', 'strategy': 'consulting',
  'ecommerce': 'retail', 'e-commerce': 'retail',
  'hotel': 'hospitality', 'restaurant': 'hospitality', 'tourism': 'hospitality',
  'production': 'manufacturing', 'factory': 'manufacturing',
  'public sector': 'government', 'federal': 'government', 'state': 'government'
};

// Normalize industry to valid value
function normalizeIndustry(raw: string | undefined | null): string {
  if (!raw) return 'general';
  const normalized = raw.toLowerCase().trim();
  
  // Direct match
  if (VALID_INDUSTRIES.includes(normalized)) return normalized;
  
  // Check aliases
  if (INDUSTRY_ALIASES[normalized]) return INDUSTRY_ALIASES[normalized];
  
  // Partial match check
  for (const [alias, industry] of Object.entries(INDUSTRY_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      return industry;
    }
  }
  
  // Fallback
  return 'general';
}

/**
 * Server-side industry detection from resume text
 * This overrides AI detection when there's clear evidence
 * Returns { industry, confidence, signals } for transparency
 */
interface IndustryDetectionResult {
  industry: string;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
}

function detectIndustryFromResume(resumeText: string): IndustryDetectionResult {
  const text = resumeText.toLowerCase();
  const signals: string[] = [];
  
  // Define industry patterns with weights
  const industryPatterns: Record<string, { 
    titlePatterns: RegExp[]; 
    skillPatterns: string[];
    contextPatterns: RegExp[];
    minSkillsForHigh: number;
  }> = {
    technology: {
      titlePatterns: [
        /\b(software\s+engineer|senior\s+software\s+engineer|staff\s+engineer)\b/,
        /\b(developer|frontend\s+developer|backend\s+developer|full[\s-]?stack\s+developer)\b/,
        /\b(data\s+scientist|machine\s+learning\s+engineer|ml\s+engineer|ai\s+engineer)\b/,
        /\b(devops\s+engineer|sre|site\s+reliability\s+engineer|platform\s+engineer)\b/,
        /\b(cloud\s+engineer|infrastructure\s+engineer|systems\s+engineer)\b/,
        /\b(qa\s+engineer|test\s+engineer|automation\s+engineer)\b/,
        /\b(tech\s+lead|engineering\s+manager|vp\s+of\s+engineering|cto)\b/,
        /\b(programmer|coder|software\s+architect|solutions\s+architect)\b/,
        /\b(data\s+engineer|analytics\s+engineer|bi\s+engineer)\b/,
        /\b(product\s+manager|technical\s+product\s+manager)\b/,
      ],
      skillPatterns: [
        'javascript', 'typescript', 'python', 'react', 'node.js', 'nodejs', 'vue', 'angular',
        'aws', 'docker', 'kubernetes', 'git', 'github', 'postgresql', 'mongodb', 'redis',
        'java', 'c++', 'golang', 'rust', 'sql', 'graphql', 'rest api', 'microservices',
        'ci/cd', 'terraform', 'jenkins', 'azure', 'gcp', 'machine learning', 'deep learning'
      ],
      contextPatterns: [
        /\b(built|developed|architected|deployed|implemented)\s+(the|a|an)?\s*(platform|system|application|api|service|infrastructure)\b/i,
        /\b(engineering|development)\s+team\b/i,
        /\b(pull\s+requests?|code\s+reviews?|sprint|standups?)\b/i,
      ],
      minSkillsForHigh: 4
    },
    sales: {
      titlePatterns: [
        /\b(account\s+executive|senior\s+account\s+executive|enterprise\s+account\s+executive)\b/,
        /\b(sales\s+rep|sales\s+representative|sales\s+manager|regional\s+sales\s+manager)\b/,
        /\b(business\s+development\s+representative|bdr|sdr|sales\s+development\s+representative)\b/,
        /\b(sales\s+director|vp\s+of\s+sales|chief\s+revenue\s+officer|cro)\b/,
        /\b(territory\s+manager|field\s+sales|inside\s+sales)\b/,
        /\b(channel\s+sales|partner\s+sales|strategic\s+accounts?)\b/,
        /\b(sales\s+engineer|solutions\s+consultant|pre[\s-]?sales)\b/,
      ],
      skillPatterns: [
        'salesforce', 'hubspot', 'crm', 'quota', 'pipeline', 'prospecting', 'cold calling',
        'meddic', 'meddpicc', 'bant', 'spin selling', 'challenger sale', 'negotiation',
        'closing', 'forecasting', 'territory', 'revenue', 'arr', 'mrr', 'saas sales',
        'enterprise sales', 'b2b sales', 'outbound', 'inbound', 'lead generation'
      ],
      contextPatterns: [
        /\b(closed|sold|exceeded|achieved|surpassed)\s+.*\b(quota|target|goal)\b/i,
        /\$[\d,]+[kKmM]?\s*(arr|mrr|deal|revenue|pipeline)/i,
        /\b\d+%\s*(of\s+)?(quota|target|attainment)\b/i,
        /\b(new\s+business|expansion|upsell|cross[\s-]?sell)\b/i,
      ],
      minSkillsForHigh: 3
    },
    marketing: {
      titlePatterns: [
        /\b(marketing\s+manager|marketing\s+director|vp\s+of\s+marketing|cmo)\b/,
        /\b(digital\s+marketing|content\s+marketing|product\s+marketing)\b/,
        /\b(brand\s+manager|growth\s+marketing|demand\s+gen|demand\s+generation)\b/,
        /\b(seo\s+specialist|sem\s+manager|social\s+media\s+manager)\b/,
        /\b(marketing\s+coordinator|marketing\s+analyst|marketing\s+operations)\b/,
      ],
      skillPatterns: [
        'seo', 'sem', 'ppc', 'google analytics', 'google ads', 'facebook ads', 'linkedin ads',
        'hubspot', 'marketo', 'mailchimp', 'content strategy', 'copywriting', 'a/b testing',
        'conversion rate', 'cac', 'ltv', 'roi', 'brand awareness', 'campaign management',
        'email marketing', 'marketing automation', 'lead nurturing'
      ],
      contextPatterns: [
        /\b(increased|grew|improved)\s+.*\b(traffic|conversions?|engagement|leads?|awareness)\b/i,
        /\b(launched|executed|managed)\s+.*\b(campaign|initiative|program)\b/i,
      ],
      minSkillsForHigh: 3
    },
    finance: {
      titlePatterns: [
        /\b(financial\s+analyst|senior\s+financial\s+analyst|finance\s+manager)\b/,
        /\b(accountant|cpa|controller|cfo|chief\s+financial\s+officer)\b/,
        /\b(investment\s+analyst|portfolio\s+manager|fund\s+manager)\b/,
        /\b(risk\s+analyst|credit\s+analyst|compliance\s+officer)\b/,
        /\b(fp&a|financial\s+planning|treasury|auditor)\b/,
      ],
      skillPatterns: [
        'financial modeling', 'excel', 'gaap', 'ifrs', 'budgeting', 'forecasting',
        'variance analysis', 'p&l', 'balance sheet', 'cash flow', 'valuation',
        'bloomberg', 'quickbooks', 'sap', 'oracle financials', 'netsuite',
        'cfa', 'cpa', 'due diligence', 'm&a', 'investment banking'
      ],
      contextPatterns: [
        /\b(managed|prepared|analyzed)\s+.*\b(budget|forecast|financial|statements?)\b/i,
        /\$[\d,]+[kKmMbB]\s*(budget|savings?|reduction|investment)/i,
      ],
      minSkillsForHigh: 3
    },
    healthcare: {
      titlePatterns: [
        /\b(nurse|rn|registered\s+nurse|lpn|nurse\s+practitioner|np)\b/,
        /\b(physician|doctor|md|do|surgeon|specialist)\b/,
        /\b(medical\s+assistant|clinical\s+coordinator|patient\s+care)\b/,
        /\b(healthcare\s+administrator|hospital\s+manager|clinical\s+director)\b/,
        /\b(pharmacist|pharmacy\s+technician|pharm\.?d)\b/,
      ],
      skillPatterns: [
        'hipaa', 'ehr', 'emr', 'epic', 'cerner', 'patient care', 'clinical',
        'medical terminology', 'fda', 'cpr', 'bls', 'acls', 'medication',
        'diagnosis', 'treatment', 'healthcare compliance', 'patient safety'
      ],
      contextPatterns: [
        /\b(patient|clinical|medical|healthcare|hospital|clinic)\b/i,
        /\b(treated|diagnosed|cared\s+for|administered)\b/i,
      ],
      minSkillsForHigh: 3
    },
    consulting: {
      titlePatterns: [
        /\b(consultant|senior\s+consultant|principal\s+consultant|managing\s+consultant)\b/,
        /\b(strategy\s+consultant|management\s+consultant|business\s+consultant)\b/,
        /\b(associate|analyst|manager|director|partner)\s+at\s+(mckinsey|bcg|bain|deloitte|pwc|ey|kpmg|accenture)\b/i,
      ],
      skillPatterns: [
        'strategy', 'stakeholder management', 'client engagement', 'business analysis',
        'powerpoint', 'excel', 'problem solving', 'project management', 'change management',
        'process improvement', 'due diligence', 'executive presentation', 'workshop facilitation'
      ],
      contextPatterns: [
        /\b(advised|consulted|partnered\s+with)\s+.*\b(clients?|executives?|c[\s-]?suite)\b/i,
        /\b(delivered|led|facilitated)\s+.*\b(engagement|project|initiative)\b/i,
      ],
      minSkillsForHigh: 3
    },
    hr: {
      titlePatterns: [
        /\b(hr\s+manager|human\s+resources|hr\s+business\s+partner|hrbp)\b/,
        /\b(recruiter|talent\s+acquisition|recruiting\s+manager)\b/,
        /\b(people\s+operations|people\s+manager|chro|chief\s+people\s+officer)\b/,
        /\b(compensation|benefits|employee\s+relations)\b/,
      ],
      skillPatterns: [
        'talent acquisition', 'hris', 'workday', 'adp', 'recruiting', 'onboarding',
        'performance management', 'employee relations', 'compensation', 'benefits',
        'shrm', 'compliance', 'diversity', 'inclusion', 'training', 'development'
      ],
      contextPatterns: [
        /\b(hired|recruited|onboarded)\s+.*\b(employees?|candidates?|hires?)\b/i,
        /\b(implemented|developed|managed)\s+.*\b(hr|people|talent|compensation)\s+(program|initiative|policy)/i,
      ],
      minSkillsForHigh: 3
    },
    engineering: {
      titlePatterns: [
        /\b(mechanical\s+engineer|electrical\s+engineer|civil\s+engineer|structural\s+engineer)\b/,
        /\b(chemical\s+engineer|industrial\s+engineer|manufacturing\s+engineer)\b/,
        /\b(aerospace\s+engineer|biomedical\s+engineer|environmental\s+engineer)\b/,
        /\b(pe|professional\s+engineer|project\s+engineer)\b/,
      ],
      skillPatterns: [
        'cad', 'autocad', 'solidworks', 'catia', 'ansys', 'matlab', 'simulation',
        'design', 'manufacturing', 'testing', 'prototyping', 'specifications',
        'iso', 'lean', 'six sigma', 'quality control', 'project management'
      ],
      contextPatterns: [
        /\b(designed|engineered|tested|developed)\s+.*\b(system|product|component|solution)\b/i,
        /\b(reduced|improved|optimized)\s+.*\b(efficiency|cost|quality|performance)\b/i,
      ],
      minSkillsForHigh: 3
    },
    legal: {
      titlePatterns: [
        /\b(attorney|lawyer|counsel|paralegal|legal\s+assistant)\b/,
        /\b(associate|partner|of\s+counsel)\s+at\s+.*\b(llp|law\s+firm|legal)\b/i,
        /\b(general\s+counsel|chief\s+legal\s+officer|clo)\b/,
        /\b(litigator|contract\s+attorney|corporate\s+counsel)\b/,
      ],
      skillPatterns: [
        'legal research', 'contract review', 'litigation', 'compliance', 'due diligence',
        'westlaw', 'lexisnexis', 'drafting', 'negotiation', 'corporate law',
        'm&a', 'intellectual property', 'ip', 'regulatory', 'arbitration'
      ],
      contextPatterns: [
        /\b(drafted|negotiated|reviewed)\s+.*\b(contract|agreement|document|brief)\b/i,
        /\b(represented|advised|counseled)\s+.*\b(client|company|organization)\b/i,
      ],
      minSkillsForHigh: 3
    },
    education: {
      titlePatterns: [
        /\b(teacher|professor|instructor|educator|lecturer)\b/,
        /\b(principal|dean|superintendent|academic\s+director)\b/,
        /\b(teaching\s+assistant|tutor|curriculum\s+developer)\b/,
      ],
      skillPatterns: [
        'curriculum', 'lesson planning', 'classroom management', 'assessment',
        'lms', 'canvas', 'blackboard', 'differentiated instruction', 'iep',
        'student engagement', 'edtech', 'state standards', 'professional development'
      ],
      contextPatterns: [
        /\b(taught|instructed|developed)\s+.*\b(course|curriculum|lesson|program)\b/i,
        /\b(improved|increased)\s+.*\b(student|learning|achievement|engagement)\b/i,
      ],
      minSkillsForHigh: 3
    },
    creative: {
      titlePatterns: [
        /\b(graphic\s+designer|ux\s+designer|ui\s+designer|product\s+designer)\b/,
        /\b(art\s+director|creative\s+director|visual\s+designer)\b/,
        /\b(copywriter|content\s+writer|creative\s+strategist)\b/,
        /\b(video\s+editor|motion\s+designer|animator)\b/,
      ],
      skillPatterns: [
        'figma', 'sketch', 'adobe', 'photoshop', 'illustrator', 'indesign', 'after effects',
        'user research', 'prototyping', 'wireframing', 'design systems', 'typography',
        'branding', 'visual design', 'interaction design', 'usability testing'
      ],
      contextPatterns: [
        /\b(designed|created|developed)\s+.*\b(design|brand|visual|experience|interface)\b/i,
        /\b(led|managed|directed)\s+.*\b(creative|design|visual)\s+(team|project|initiative)\b/i,
      ],
      minSkillsForHigh: 3
    },
  };
  
  // Score each industry
  const industryScores: { industry: string; score: number; signals: string[] }[] = [];
  
  for (const [industry, patterns] of Object.entries(industryPatterns)) {
    let score = 0;
    const industrySignals: string[] = [];
    
    // Check title patterns (high weight)
    for (const pattern of patterns.titlePatterns) {
      const match = text.match(pattern);
      if (match) {
        score += 30;
        industrySignals.push(`Title: "${match[0]}"`);
      }
    }
    
    // Check skills (medium weight)
    const foundSkills = patterns.skillPatterns.filter(skill => {
      // Check for exact word boundary match
      const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(text);
    });
    score += foundSkills.length * 5;
    if (foundSkills.length > 0) {
      industrySignals.push(`Skills: ${foundSkills.slice(0, 5).join(', ')}`);
    }
    
    // Check context patterns (medium weight)
    for (const pattern of patterns.contextPatterns) {
      if (pattern.test(text)) {
        score += 10;
        industrySignals.push(`Context match`);
        break; // Only count once
      }
    }
    
    if (score > 0) {
      industryScores.push({ industry, score, signals: industrySignals });
    }
  }
  
  // Sort by score descending
  industryScores.sort((a, b) => b.score - a.score);
  
  console.log(`[INDUSTRY-DETECT] Scores: ${JSON.stringify(industryScores.map(s => ({ industry: s.industry, score: s.score })))}`);
  
  if (industryScores.length === 0) {
    return { industry: 'general', confidence: 'low', signals: ['No clear industry signals detected'] };
  }
  
  const topIndustry = industryScores[0];
  const secondIndustry = industryScores[1];
  
  // Determine confidence
  let confidence: 'high' | 'medium' | 'low';
  if (topIndustry.score >= 50 && (!secondIndustry || topIndustry.score > secondIndustry.score * 1.5)) {
    confidence = 'high';
  } else if (topIndustry.score >= 25) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }
  
  console.log(`[INDUSTRY-DETECT] Result: ${topIndustry.industry} (confidence: ${confidence}, score: ${topIndustry.score})`);
  console.log(`[INDUSTRY-DETECT] Signals: ${topIndustry.signals.join('; ')}`);
  
  return {
    industry: topIndustry.industry,
    confidence,
    signals: topIndustry.signals
  };
}

// ======================== Resume Type Detection ========================

type ResumeType = 'chronological' | 'executive_summary' | 'ats_optimized' | 'outreach_referral' | 'hybrid';

interface ResumeTypeResult {
  type: ResumeType;
  label: string;
  description: string;
  atsRelevance: 'high' | 'medium' | 'low';
  scoringAdjustment: string;
}

/**
 * Detect the type of resume to adjust scoring and feedback appropriately
 */
function detectResumeType(resumeText: string): ResumeTypeResult {
  const text = resumeText.toLowerCase();
  const lines = resumeText.split('\n');
  
  // Patterns for different resume types
  const hasChronologicalExp = /\b(20\d{2}|19\d{2})\s*[-–—]\s*(20\d{2}|19\d{2}|present|current)/gi.test(resumeText);
  const hasCompanyTitleDate = /\b(inc|llc|corp|company|ltd|gmbh|co\.)\b.*\b(20\d{2}|19\d{2})/i.test(resumeText);
  const hasHighlightSection = /\b(tailored\s+experience\s+highlights?|key\s+achievements?|career\s+highlights?|selected\s+accomplishments?)\b/i.test(resumeText);
  const hasExecutiveSummary = /\b(executive\s+summary|professional\s+summary|career\s+summary|leadership\s+profile)\b/i.test(resumeText);
  const hasBulletPoints = (resumeText.match(/^[\s]*[•\-*·▪►◦➤]\s+/gm) || []).length;
  const hasSkillsSection = /\b(technical\s+skills?|core\s+competencies|skills?\s*&\s*expertise|areas\s+of\s+expertise)\b/i.test(resumeText);
  const hasATSKeywords = /\b(ats|applicant\s+tracking|keywords?)\b/i.test(resumeText);
  
  // Count date ranges (indicator of chronological format)
  const dateRanges = (resumeText.match(/\b(20\d{2}|19\d{2})\s*[-–—]\s*(20\d{2}|19\d{2}|present|current)/gi) || []).length;
  
  // Check for referral/outreach indicators
  const isShort = resumeText.length < 2500;
  const hasIntroLetter = /\b(dear|i\s+am\s+writing|i\s+would\s+like\s+to|please\s+find|attached)\b/i.test(resumeText);
  
  // Decision logic
  
  // 1. Executive Summary / Highlights (no chronological roles, mostly achievements)
  if (hasHighlightSection && !hasChronologicalExp && dateRanges < 2) {
    return {
      type: 'executive_summary',
      label: 'Executive Summary / Highlights',
      description: 'This is a highlights-based document designed for human readers, not ATS portals.',
      atsRelevance: 'low',
      scoringAdjustment: 'ATS score reflects portal optimization only. This format is ideal for referrals, networking, and direct outreach.'
    };
  }
  
  // 2. Outreach / Referral Resume (short, no dates, intro-style)
  if ((isShort || hasIntroLetter) && dateRanges < 2 && !hasChronologicalExp) {
    return {
      type: 'outreach_referral',
      label: 'Outreach / Referral Resume',
      description: 'This is a concise document for direct outreach, not job portal submissions.',
      atsRelevance: 'low',
      scoringAdjustment: 'ATS score is less relevant for this format. Best for email outreach, referrals, and networking.'
    };
  }
  
  // 3. Hybrid (has highlights + chronological experience)
  if (hasHighlightSection && hasChronologicalExp && dateRanges >= 2) {
    return {
      type: 'hybrid',
      label: 'Hybrid Resume',
      description: 'Combines highlights section with chronological experience. Works for both ATS and humans.',
      atsRelevance: 'high',
      scoringAdjustment: 'ATS compatible. The highlights section adds human appeal while dates ensure ATS parsing.'
    };
  }
  
  // 4. ATS-Optimized (lots of keywords, skills sections, structured format)
  if (hasSkillsSection && hasBulletPoints >= 10 && hasChronologicalExp) {
    return {
      type: 'ats_optimized',
      label: 'ATS-Optimized Resume',
      description: 'Structured format with keywords and bullet points, optimized for ATS parsing.',
      atsRelevance: 'high',
      scoringAdjustment: 'This format is well-suited for job portal submissions. Score reflects ATS compatibility.'
    };
  }
  
  // 5. Default: Chronological (traditional format)
  if (hasChronologicalExp && dateRanges >= 2) {
    return {
      type: 'chronological',
      label: 'Traditional Chronological Resume',
      description: 'Standard resume format with work history in reverse chronological order.',
      atsRelevance: 'high',
      scoringAdjustment: 'Standard format for job portal submissions. Score reflects ATS compatibility.'
    };
  }
  
  // Fallback
  return {
    type: 'chronological',
    label: 'Resume',
    description: 'Resume document for job applications.',
    atsRelevance: 'medium',
    scoringAdjustment: 'Score reflects general ATS compatibility.'
  };
}

// ======================== Seniority Detection ========================

type SeniorityLevel = 'entry' | 'mid' | 'senior' | 'executive';

function detectSeniorityLevel(resumeText: string): SeniorityLevel {
  const text = resumeText.toLowerCase();
  
  const executivePatterns = [
    /\b(ceo|cto|cfo|coo|cmo|cro|chief\s+\w+\s+officer)\b/,
    /\b(president|founder|co-founder|partner)\b/,
    /\b(vp|vice\s+president)\b/,
    /\b(evp|svp|executive\s+vice\s+president|senior\s+vice\s+president)\b/,
    /\b(managing\s+director|general\s+manager)\b/,
  ];
  
  const seniorPatterns = [
    /\b(senior|sr\.?|lead|principal|staff)\s+(engineer|developer|manager|director|analyst|designer|consultant)/,
    /\b(director|head\s+of)\b/,
    /\b(\d{2}\+?\s*years?\s*(of\s+)?experience)/,
    /\b(10|11|12|13|14|15|16|17|18|19|20)\+?\s*years?\b/,
  ];
  
  const midPatterns = [
    /\b(mid[\s-]?level|intermediate)\b/,
    /\b([3-9])\s*years?\s*(of\s+)?experience\b/,
  ];
  
  // Check patterns in order of seniority
  for (const pattern of executivePatterns) {
    if (pattern.test(text)) return 'executive';
  }
  
  for (const pattern of seniorPatterns) {
    if (pattern.test(text)) return 'senior';
  }
  
  for (const pattern of midPatterns) {
    if (pattern.test(text)) return 'mid';
  }
  
  return 'entry';
}

// ======================== Credibility Issue Detection ========================

interface CredibilityIssue {
  type: 'date_inconsistency' | 'timeline_overlap' | 'impossible_timeline' | 'gap';
  severity: 'high' | 'medium' | 'low';
  description: string;
  location?: string;
}

function detectCredibilityIssues(resumeText: string): CredibilityIssue[] {
  const issues: CredibilityIssue[] = [];
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  
  // Extract all date ranges
  const dateRangePattern = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)?\s*'?(\d{4}|\d{2})\s*[-–—]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)?\s*'?(\d{4}|\d{2}|present|current|now)/gi;
  
  const ranges: Array<{ start: number; end: number; text: string }> = [];
  let match;
  
  while ((match = dateRangePattern.exec(resumeText)) !== null) {
    let startYear = parseInt(match[2]);
    let endYear = match[4].toLowerCase();
    
    // Handle 2-digit years
    if (startYear < 100) startYear += startYear > 50 ? 1900 : 2000;
    
    let endNum: number;
    if (['present', 'current', 'now'].includes(endYear)) {
      endNum = currentYear;
    } else {
      endNum = parseInt(endYear);
      if (endNum < 100) endNum += endNum > 50 ? 1900 : 2000;
    }
    
    if (!isNaN(startYear) && !isNaN(endNum)) {
      ranges.push({ start: startYear, end: endNum, text: match[0] });
    }
  }
  
  // Check for impossible timelines (end before start)
  for (const range of ranges) {
    if (range.end < range.start) {
      issues.push({
        type: 'impossible_timeline',
        severity: 'high',
        description: `Date range "${range.text}" shows end date before start date`,
        location: range.text
      });
    }
  }
  
  // Check for future dates
  for (const range of ranges) {
    if (range.start > currentYear || (range.end > currentYear && range.end !== currentYear)) {
      issues.push({
        type: 'date_inconsistency',
        severity: 'high',
        description: `Date "${range.text}" contains future year`,
        location: range.text
      });
    }
  }
  
  // Check for overlapping roles (might be intentional for consulting/side projects)
  const sortedRanges = [...ranges].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sortedRanges.length - 1; i++) {
    const current = sortedRanges[i];
    const next = sortedRanges[i + 1];
    
    // If current role ends after next role starts
    if (current.end > next.start + 1) { // Allow 1 year overlap for transitions
      // Only flag if significant overlap
      const overlapYears = current.end - next.start;
      if (overlapYears > 2) {
        issues.push({
          type: 'timeline_overlap',
          severity: 'medium',
          description: `Significant overlap (${overlapYears}+ years) between roles may need clarification`,
          location: `${current.text} and ${next.text}`
        });
      }
    }
  }
  
  return issues;
}

// ======================== Content Location Detection ========================

interface ContentLocation {
  exists: boolean;
  locations: string[];
  suggestion: string;
}

function checkContentLocation(resumeText: string, contentType: 'quota' | 'metrics' | 'keywords'): ContentLocation {
  const text = resumeText.toLowerCase();
  const lines = resumeText.split('\n');
  
  // Find section boundaries
  const summaryEnd = lines.findIndex(l => /\b(experience|work\s+history|employment)\b/i.test(l));
  const experienceStart = summaryEnd > 0 ? summaryEnd : 0;
  const experienceEnd = lines.findIndex((l, i) => i > experienceStart && /\b(education|skills|certifications)\b/i.test(l));
  
  const summaryText = lines.slice(0, summaryEnd > 0 ? summaryEnd : 5).join('\n').toLowerCase();
  const experienceText = lines.slice(experienceStart, experienceEnd > 0 ? experienceEnd : undefined).join('\n').toLowerCase();
  
  if (contentType === 'quota') {
    const quotaPatterns = [
      /\b\d{2,3}%\s*(of|attainment|quota|goal|target)/i,
      /\b(exceeded|surpassed|beat|over)\s*(quota|goal|target)/i,
      /\b[2-9]x\b|\b\d+\.\d+x\b/i,
      /\$\d+[kKmM]?\s*(arr|mrr|revenue|pipeline)/i,
    ];
    
    const inSummary = quotaPatterns.some(p => p.test(summaryText));
    const inExperience = quotaPatterns.some(p => p.test(experienceText));
    
    if (inSummary && !inExperience) {
      return {
        exists: true,
        locations: ['summary'],
        suggestion: 'Quota metrics appear in summary — consider reinforcing at role-level bullets for recruiter skimmability'
      };
    } else if (!inSummary && inExperience) {
      return {
        exists: true,
        locations: ['experience'],
        suggestion: 'Good quota metrics in experience section'
      };
    } else if (inSummary && inExperience) {
      return {
        exists: true,
        locations: ['summary', 'experience'],
        suggestion: 'Strong quota metrics throughout resume'
      };
    }
    
    return {
      exists: false,
      locations: [],
      suggestion: 'Add specific quota percentages (e.g., "120% of quota") to strengthen impact'
    };
  }
  
  // Similar for metrics
  if (contentType === 'metrics') {
    const metricPatterns = [
      /\$[\d,]+[kKmM]?/,
      /\b\d+%\b/,
      /\b\d+x\b/i,
      /\b\d+\+?\s*(users|customers|clients|deals|accounts)\b/i,
    ];
    
    const inSummary = metricPatterns.some(p => p.test(summaryText));
    const inExperience = metricPatterns.some(p => p.test(experienceText));
    
    if (inSummary && !inExperience) {
      return {
        exists: true,
        locations: ['summary'],
        suggestion: 'Metrics appear in summary — add 1-2 numbers per role for consistency'
      };
    } else if (inSummary || inExperience) {
      return {
        exists: true,
        locations: inSummary && inExperience ? ['summary', 'experience'] : inExperience ? ['experience'] : ['summary'],
        suggestion: 'Good metric usage'
      };
    }
    
    return {
      exists: false,
      locations: [],
      suggestion: 'Add quantified achievements ($, %, #) to show measurable impact'
    };
  }
  
  return { exists: false, locations: [], suggestion: '' };
}

// ======================== Usage Recommendation ========================

interface UsageRecommendation {
  channel: string;
  suitability: 'excellent' | 'good' | 'limited' | 'not_recommended';
  note: string;
}

function generateUsageRecommendations(
  resumeType: ResumeTypeResult,
  atsScore: number,
  formatGrade: string
): UsageRecommendation[] {
  const recommendations: UsageRecommendation[] = [];
  
  // ATS submissions
  if (resumeType.atsRelevance === 'high' && atsScore >= 70 && ['A', 'B'].includes(formatGrade)) {
    recommendations.push({
      channel: 'Job Portal Submissions',
      suitability: 'excellent',
      note: 'Well-optimized for ATS parsing'
    });
  } else if (resumeType.atsRelevance === 'high' && atsScore >= 55) {
    recommendations.push({
      channel: 'Job Portal Submissions',
      suitability: 'good',
      note: 'Acceptable for ATS, some optimization opportunities'
    });
  } else if (resumeType.atsRelevance === 'low') {
    recommendations.push({
      channel: 'Job Portal Submissions',
      suitability: 'not_recommended',
      note: 'This format is designed for direct outreach, not ATS portals'
    });
  } else {
    recommendations.push({
      channel: 'Job Portal Submissions',
      suitability: 'limited',
      note: 'Consider adding chronological experience for better ATS parsing'
    });
  }
  
  // Referrals
  if (resumeType.type === 'executive_summary' || resumeType.type === 'outreach_referral') {
    recommendations.push({
      channel: 'Referrals',
      suitability: 'excellent',
      note: 'Highlights format is ideal for internal referrals'
    });
  } else {
    recommendations.push({
      channel: 'Referrals',
      suitability: 'good',
      note: 'Works well when paired with a referral introduction'
    });
  }
  
  // Direct email outreach
  if (resumeType.type === 'outreach_referral' || resumeType.type === 'executive_summary') {
    recommendations.push({
      channel: 'Email Outreach',
      suitability: 'excellent',
      note: 'Concise format works well for cold outreach'
    });
  } else if (atsScore >= 60) {
    recommendations.push({
      channel: 'Email Outreach',
      suitability: 'good',
      note: 'Consider a 1-page highlights version for cold emails'
    });
  } else {
    recommendations.push({
      channel: 'Email Outreach',
      suitability: 'good',
      note: 'Suitable for email attachments'
    });
  }
  
  // LinkedIn applications
  recommendations.push({
    channel: 'LinkedIn Easy Apply',
    suitability: atsScore >= 65 && resumeType.atsRelevance !== 'low' ? 'good' : 'limited',
    note: atsScore >= 65 ? 'Compatible with LinkedIn parsing' : 'May have parsing issues on LinkedIn'
  });
  
  return recommendations;
}

// ======================== Language Calibration ========================

interface CalibratedLanguage {
  headline: string;
  overallTone: 'warning' | 'optimization' | 'praise';
  scoreContext: string;
}

function calibrateLanguage(atsScore: number, seniority: SeniorityLevel, resumeType: ResumeTypeResult): CalibratedLanguage {
  // For non-ATS formats, always use optimization tone
  if (resumeType.atsRelevance === 'low') {
    return {
      headline: 'Outreach-Ready Resume',
      overallTone: 'optimization',
      scoreContext: `This ${resumeType.label} is optimized for direct outreach. ATS score (${atsScore}) reflects portal compatibility only — not relevant for referrals or direct emails.`
    };
  }
  
  // High scores (85+) - praise with minor optimization
  if (atsScore >= 85) {
    return {
      headline: 'Strong Resume Ready for Applications',
      overallTone: 'praise',
      scoreContext: 'Your resume is well-optimized for ATS systems. The suggestions below are minor enhancements to maximize impact.'
    };
  }
  
  // Good scores (70-84) - optimization language
  if (atsScore >= 70) {
    return {
      headline: 'Good Foundation — Optimization Opportunities',
      overallTone: 'optimization',
      scoreContext: `Score of ${atsScore} indicates solid ATS compatibility. The suggestions below could improve visibility with recruiters.`
    };
  }
  
  // Mid scores (55-69) - balanced guidance
  if (atsScore >= 55) {
    return {
      headline: 'Room for Improvement',
      overallTone: 'optimization',
      scoreContext: seniority === 'senior' || seniority === 'executive'
        ? `Score of ${atsScore} suggests optimization opportunities. For senior roles, focus on outcomes and scope rather than keyword density.`
        : `Score of ${atsScore} indicates room for improvement. The suggestions below can strengthen your application.`
    };
  }
  
  // Low scores (<55) - actionable guidance (not alarmist)
  return {
    headline: 'Key Improvements Needed',
    overallTone: 'warning',
    scoreContext: `Score of ${atsScore} suggests significant optimization opportunities. Focus on the high-priority suggestions to improve visibility.`
  };
}

// ======================== Dual Scoring ========================

interface DualScore {
  atsCompatibility: number;
  recruiterImpact: number;
  atsNote: string;
  recruiterNote: string;
}

function computeDualScore(
  baseAtsScore: number,
  quantificationScore: number,
  bulletImpactScore: number,
  seniority: SeniorityLevel,
  resumeType: ResumeTypeResult
): DualScore {
  // ATS Compatibility = base score (format, keywords, structure)
  let atsCompatibility = baseAtsScore;
  
  // Recruiter Impact = weighted combination of metrics, outcomes, and seniority signals
  let recruiterImpact = Math.round(
    (quantificationScore * 0.35) + 
    (bulletImpactScore * 0.35) + 
    (baseAtsScore * 0.3)
  );
  
  // Adjust for seniority - senior roles care more about outcomes than keywords
  if (seniority === 'senior' || seniority === 'executive') {
    recruiterImpact = Math.min(100, recruiterImpact + 5);
  }
  
  // Adjust for resume type
  if (resumeType.atsRelevance === 'low') {
    // Executive summary / outreach resumes get recruiter boost but ATS penalty
    recruiterImpact = Math.min(100, recruiterImpact + 10);
    atsCompatibility = Math.max(0, atsCompatibility - 10);
  }
  
  const atsNote = atsCompatibility >= 75 
    ? 'Optimized for job portal submissions' 
    : atsCompatibility >= 55 
      ? 'Acceptable for portals, some improvements possible' 
      : 'Consider ATS optimization for portal submissions';
      
  const recruiterNote = recruiterImpact >= 75
    ? 'Strong impact and outcome messaging'
    : recruiterImpact >= 55
      ? 'Good foundation, add more quantified outcomes'
      : 'Focus on metrics and achievements';
  
  return { atsCompatibility, recruiterImpact, atsNote, recruiterNote };
}

// ======================== Server-side Resume Parsing Helpers ========================

/**
 * Extract years from resume text (e.g., "2015", "2019-2022", "January 2015")
 */
function extractYearsFromText(text: string): number[] {
  const years: number[] = [];
  const currentYear = new Date().getFullYear();
  const yearRegex = /\b(19[7-9]\d|20[0-2]\d)\b/g;
  let match: RegExpExecArray | null;

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
 * Compute timeline analysis from resume text
 */
function computeTimelineAnalysis(resumeText: string): {
  totalYears: string;
  avgTenure: string;
  progression: "stagnant" | "steady" | "rapid" | "unclear";
  hasGaps: boolean;
  gapNote?: string;
} {
  const currentYear = new Date().getFullYear();
  const years = extractYearsFromText(resumeText);

  if (years.length < 2) {
    return {
      totalYears: years.length === 1 ? `${currentYear - years[0]} years` : "Unknown",
      avgTenure: "2 years",
      progression: "unclear",
      hasGaps: false,
    };
  }

  const earliest = years[0];
  const latest = years.includes(currentYear) ? currentYear : years[years.length - 1];
  const totalSpan = latest - earliest;

  // Estimate number of roles by counting distinct year-pairs or job-like patterns
  const rolePatterns = resumeText.match(/\b(20\d{2}|19\d{2})\s*[-–—]\s*(20\d{2}|19\d{2}|present|current|ongoing|now)\b/gi) || [];
  const estimatedRoles = Math.max(1, rolePatterns.length);
  const avgTenureNum = estimatedRoles > 0 ? Math.round((totalSpan / estimatedRoles) * 10) / 10 : totalSpan;

  // Detect progression by looking for title keywords
  const seniorKeywords = /(senior|lead|principal|director|vp|head|chief|manager|executive)/gi;
  const titleMatches = resumeText.match(seniorKeywords) || [];
  let progression: "stagnant" | "steady" | "rapid" | "unclear" = "unclear";
  if (titleMatches.length >= 3 && totalSpan >= 5) {
    progression = "rapid";
  } else if (titleMatches.length >= 1 && totalSpan >= 3) {
    progression = "steady";
  } else if (totalSpan >= 5 && titleMatches.length === 0) {
    progression = "stagnant";
  }

  // Detect gaps (simplistic: look for year jumps > 1 year between consecutive years)
  let hasGaps = false;
  let gapNote: string | undefined;
  for (let i = 1; i < years.length; i++) {
    if (years[i] - years[i - 1] > 2) {
      hasGaps = true;
      gapNote = `Gap detected between ${years[i - 1]} and ${years[i]}`;
      break;
    }
  }

  return {
    totalYears: `${totalSpan} ${totalSpan === 1 ? "year" : "years"}`,
    avgTenure: `${avgTenureNum} ${avgTenureNum === 1 ? "year" : "years"}`,
    progression,
    hasGaps,
    gapNote,
  };
}

/**
 * Get the Experience section text from the resume
 */
function getExperienceSection(resumeText: string): string {
  const lines = resumeText.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => /\b(professional\s+experience|experience|work\s+history|employment)\b/i.test(l));
  if (startIdx === -1) return resumeText;

  const endIdx = lines.findIndex(
    (l, i) => i > startIdx && /\b(education|skills|certifications|projects|awards|publications|references)\b/i.test(l)
  );

  return lines.slice(startIdx, endIdx === -1 ? undefined : endIdx).join("\n");
}

/**
 * Extract bullet points from text
 */
function extractBullets(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^([•\-*·▪►◦➤])\s+/.test(l) || /^\d+\.\s+/.test(l))
    .map((l) => l.replace(/^([•\-*·▪►◦➤]|\d+\.)\s+/, "").trim())
    .filter(Boolean);
}

/**
 * Compute quantification score with section-aware feedback
 * More generous scoring: checks summary/highlights + recent roles more heavily
 */
function computeQuantificationScore(resumeText: string): {
  score: number;
  verdict: "weak" | "average" | "strong";
  tip: string;
} {
  const expText = getExperienceSection(resumeText);
  const bullets = extractBullets(expText);
  
  // Also check summary/highlights for metrics (often overlooked)
  const summarySection = resumeText.split(/\b(experience|work\s+history|employment)\b/i)[0] || '';
  const summaryHasMetrics = /(\$[\d,]+|\d+%|\b\d{2,}[\+k]?\b)/i.test(summarySection);

  if (bullets.length === 0) {
    // Fall back to checking raw text for numbers - be more generous
    const hasNumbers = /(\$|%|\b\d[\d,\.]*\b|\b\d+\s*(k|m|b)\b)/i.test(resumeText);
    const baseScore = hasNumbers ? 50 : 25;
    return {
      score: summaryHasMetrics ? Math.min(baseScore + 15, 70) : baseScore,
      verdict: baseScore >= 50 ? "average" : "weak",
      tip: summaryHasMetrics 
        ? "Good metrics in summary; add bullet points with numbers to reinforce."
        : "Add bullet points with specific numbers ($, %, #) to quantify your impact.",
    };
  }

  const hasNumber = (s: string) => /(\$|%|\b\d[\d,\.]*\b|\b\d+\s*(k|m|b)\b)/i.test(s);

  const mid = Math.ceil(bullets.length / 2);
  const recent = bullets.slice(0, mid);
  const older = bullets.slice(mid);

  const pct = (arr: string[]) => (arr.length ? Math.round((arr.filter(hasNumber).length / arr.length) * 100) : 0);

  let overall = pct(bullets);
  const recentPct = pct(recent);
  const olderPct = pct(older);
  
  // Boost score if summary has strong metrics (give credit for that)
  if (summaryHasMetrics && overall < 70) {
    overall = Math.min(overall + 10, 75);
  }
  
  // Also boost if recent roles are strong (weight recent work more)
  if (recentPct >= 50 && overall < 65) {
    overall = Math.min(overall + 8, 70);
  }

  const verdict: "weak" | "average" | "strong" = overall >= 55 ? "strong" : overall >= 30 ? "average" : "weak";

  let tip = "Add more numbers ($, %, #) to show measurable impact.";
  if (recentPct >= 45 && olderPct <= 35) {
    tip = "Strong metrics in summary & recent roles; add 1–2 numbers to older role bullets.";
  } else if (overall >= 55) {
    tip = "Good use of numbers—keep this consistency across all roles.";
  } else if (overall >= 30) {
    tip = "Solid foundation—add metrics to 1–2 more bullets per role for max impact.";
  }

  return { score: overall, verdict, tip };
}

/**
 * Compute bullet impact score with section-aware feedback
 * More generous: counts strong action verbs even without strict "result" pattern
 */
function computeBulletImpactScore(resumeText: string): {
  score: number;
  verdict: "responsibility_heavy" | "balanced" | "achievement_focused";
  tip: string;
} {
  const expText = getExperienceSection(resumeText);
  const bullets = extractBullets(expText);

  if (bullets.length === 0) {
    // Check if text has achievement language even without bullet structure
    const hasAchievementLanguage = /\b(increased|grew|reduced|achieved|delivered|launched|exceeded|led|drove|generated)\b/i.test(resumeText);
    return {
      score: hasAchievementLanguage ? 40 : 30,
      verdict: hasAchievementLanguage ? "balanced" : "responsibility_heavy",
      tip: hasAchievementLanguage 
        ? "Good achievement language found; format as bullet points for clarity."
        : "Add bullet points that start with action verbs and show outcomes.",
    };
  }

  const hasNumber = (s: string) => /(\$|%|\b\d[\d,\.]*\b|\b\d+\s*(k|m|b)\b)/i.test(s);
  // Expanded result verbs list for more generous detection
  const hasResultVerb = (s: string) =>
    /\b(increased|grew|reduced|improved|drove|generated|closed|won|achieved|accelerated|delivered|launched|expanded|exceeded|scaled|optimized|transformed|led|spearheaded|pioneered|built|created|developed|established|implemented|managed|designed|executed|negotiated|secured|acquired|retained|streamlined|automated|mentored|trained|coached)\b/i.test(s);
  const responsibilityPhrase = (s: string) =>
    /\b(responsible for|assisted with|helped with|supported|worked on|duties included|tasked with)\b/i.test(s);

  // More generous: count as achievement if has result verb OR number (not AND)
  const isAchievement = (s: string) => !responsibilityPhrase(s) && (hasNumber(s) || hasResultVerb(s));

  const mid = Math.ceil(bullets.length / 2);
  const recent = bullets.slice(0, mid);
  const older = bullets.slice(mid);

  const pct = (arr: string[]) => (arr.length ? Math.round((arr.filter(isAchievement).length / arr.length) * 100) : 0);

  let overall = pct(bullets);
  const recentPct = pct(recent);
  const olderPct = pct(older);
  
  // Boost score if recent roles are achievement-focused (weight recent work more)
  if (recentPct >= 50 && overall < 60) {
    overall = Math.min(overall + 10, 65);
  }

  const verdict: "responsibility_heavy" | "balanced" | "achievement_focused" =
    overall >= 50 ? "achievement_focused" : overall >= 30 ? "balanced" : "responsibility_heavy";

  let tip = "Lead bullets with outcomes (what changed) before responsibilities (what you did).";
  if (recentPct >= 45 && olderPct <= 35) {
    tip = "Recent bullets show outcomes; add results verbs + one metric to older role bullets.";
  } else if (overall >= 50) {
    tip = "Strong achievement focus—keep emphasizing scope + outcomes.";
  } else if (overall >= 30) {
    tip = "Solid start—add quantified outcomes to 1–2 more bullets per role.";
  }

  return { score: overall, verdict, tip };
}

/**
 * Compute industry benchmark based on score
 */
function computeIndustryBenchmark(
  score: number,
  industry: string
): {
  industryAvg: number;
  comparison: "below" | "at" | "above";
  percentile: string;
} {
  // Industry-specific averages (simplified)
  const industryAverages: Record<string, { avg: number; top: number }> = {
    technology: { avg: 68, top: 85 },
    sales: { avg: 65, top: 82 },
    marketing: { avg: 64, top: 80 },
    finance: { avg: 70, top: 88 },
    healthcare: { avg: 66, top: 84 },
    legal: { avg: 72, top: 90 },
    consulting: { avg: 70, top: 86 },
    engineering: { avg: 67, top: 84 },
    general: { avg: 65, top: 82 },
  };

  const benchmarks = industryAverages[industry] || industryAverages.general;
  const { avg, top } = benchmarks;

  let comparison: "below" | "at" | "above";
  let percentile: string;

  if (score >= top) {
    comparison = "above";
    percentile = "Top 5%";
  } else if (score >= avg + 10) {
    comparison = "above";
    const pct = Math.round(50 - ((score - avg) / (top - avg)) * 45);
    percentile = `Top ${Math.max(5, pct)}%`;
  } else if (score >= avg - 5) {
    comparison = "at";
    percentile = "Around average";
  } else {
    comparison = "below";
    const pct = Math.round(50 + ((avg - score) / avg) * 35);
    percentile = `Bottom ${Math.min(60, pct)}%`;
  }

  return { industryAvg: avg, comparison, percentile };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RESUME_LENGTH = 50000;
const MAX_JOB_DESCRIPTION_LENGTH = 15000;
const FREE_SCANS_PER_DAY = 7;
const FUNCTION_NAME = 'free-keyword-scan';

const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') || 'admin@resumebooster.com';

const getCountryFromHeaders = (req: Request): string | null => {
  return (
    req.headers.get('cf-ipcountry') ||
    req.headers.get('x-vercel-ip-country') ||
    req.headers.get('x-country-code') ||
    null
  );
};


// Helper to get client IP
const getClientIp = (req: Request): string => {
  return req.headers.get('cf-connecting-ip') ||
         req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         req.headers.get('x-real-ip') || 
         'unknown';
};

// SSE helper to send events
function createSSEStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  const send = (event: string, data: any) => {
    if (controller) {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(encoder.encode(message));
    }
  };

  const close = () => {
    if (controller) {
      controller.close();
    }
  };

  return { stream, send, close };
}

// Progress stages for UI feedback
const PROGRESS_STAGES = [
  { stage: 'parsing', message: 'Parsing resume content...', progress: 10 },
  { stage: 'detecting', message: 'Detecting resume type & experience...', progress: 20 },
  { stage: 'analyzing', message: 'Running AI analysis...', progress: 40 },
  { stage: 'scoring', message: 'Calculating ATS & recruiter scores...', progress: 70 },
  { stage: 'generating', message: 'Generating insights...', progress: 85 },
  { stage: 'finalizing', message: 'Finalizing report...', progress: 95 },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = getClientIp(req);
  const requestStartTime = Date.now();

  // Create SSE stream
  const { stream, send, close } = createSSEStream();

  // Start response immediately with SSE headers
  const response = new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });

  // Process in background while streaming progress
  EdgeRuntime.waitUntil((async () => {
    try {
      const { resumeText, jobDescriptionText, honeypot, skipCache } = await req.json();

      // Debug: Log first 100 chars of resume to verify correct text is being sent
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Resume preview (first 100 chars): ${resumeText?.substring(0, 100)?.replace(/\n/g, ' ')}`);
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Resume length: ${resumeText?.length}, skipCache: ${skipCache}`);

      // Honeypot check
      if (honeypot && honeypot.trim() !== '') {
        send('complete', { success: true, atsScoreEstimate: 65, industry: "General" });
        close();
        return;
      }

      // Validation
      if (!resumeText || typeof resumeText !== 'string' || resumeText.trim().length === 0) {
        send('error', { error: 'Resume text is required' });
        close();
        return;
      }

      if (resumeText.length > MAX_RESUME_LENGTH) {
        send('error', { error: 'Resume text is too long. Please limit to 50,000 characters.' });
        close();
        return;
      }

      // Send initial progress
      send('progress', PROGRESS_STAGES[0]);

      // Initialize Supabase
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      
      if (!supabaseUrl || !supabaseServiceKey) {
        send('error', { error: 'Service temporarily unavailable.' });
        close();
        return;
      }

      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Initialize metric context for tracking
      const ipCountry = getCountryFromHeaders(req) || null;
      const metricCtx: ScanMetricContext = {
        supabase,
        startTime: requestStartTime,
        scanType: 'free-stream',
        cacheHit: false,
        ipCountry,
        visitorId: clientIp,
        inputLength: resumeText.length,
        aiModel: 'google/gemini-2.5-pro'
      };

      // Rate limiting
      const { data: allowed, error: rlError } = await supabase.rpc('check_rate_limit', {
        p_function: FUNCTION_NAME,
        p_ip: clientIp,
        p_max_requests: FREE_SCANS_PER_DAY,
        p_window_minutes: 24 * 60
      });

      if (rlError || !allowed) {
        send('error', { 
          error: 'Daily scan limit reached. Upgrade for unlimited access!',
          rateLimited: true,
          scansLimit: FREE_SCANS_PER_DAY
        });
        close();
        return;
      }

      send('progress', PROGRESS_STAGES[1]);

      // ======================== Early Resume Type & Seniority Detection ========================
      const resumeType = detectResumeType(resumeText);
      const seniority = detectSeniorityLevel(resumeText);
      const credibilityIssues = detectCredibilityIssues(resumeText);
      
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Resume type: ${resumeType.type}, Seniority: ${seniority}`);
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Credibility issues: ${credibilityIssues.length}`);

      // Check if job description provided
      const hasJobDescription = jobDescriptionText && typeof jobDescriptionText === 'string' && jobDescriptionText.trim().length > 50;
      const truncatedJobDescription = hasJobDescription ? jobDescriptionText.substring(0, MAX_JOB_DESCRIPTION_LENGTH) : null;

      // ======================== Robust AI Response Caching ========================
      // Aggressive normalization for maximum cache hits without affecting analysis quality
      const normalizeForCache = (text: string): string => {
        return text
          .replace(/[\r\n]+/g, ' ')                    // Replace all newlines with space
          .replace(/\s+/g, ' ')                        // Collapse all whitespace to single space
          .replace(/[^\w\s]/g, '')                     // Remove punctuation/special chars
          .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '') // Remove phone numbers
          .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '') // Remove emails
          .replace(/\b\d{5}(-\d{4})?\b/g, '')          // Remove zip codes
          // Synonym normalization - common abbreviations
          .replace(/\bsr\b/gi, 'senior')
          .replace(/\bjr\b/gi, 'junior')
          .replace(/\bmgr\b/gi, 'manager')
          .replace(/\bdir\b/gi, 'director')
          .replace(/\bvp\b/gi, 'vice president')
          .replace(/\bexec\b/gi, 'executive')
          .replace(/\bassoc\b/gi, 'associate')
          .replace(/\basst\b/gi, 'assistant')
          .replace(/\badmin\b/gi, 'administrator')
          .replace(/\bdev\b/gi, 'developer')
          .replace(/\beng\b/gi, 'engineer')
          .replace(/\bmkt\b/gi, 'marketing')
          .replace(/\bops\b/gi, 'operations')
          // Remove filler phrases that don't affect analysis
          .replace(/\b(responsible for|duties included|tasked with|worked on|assisted with|helped with|in charge of|accountable for)\b/gi, '')
          .trim()
          .toLowerCase();
      };
      
      // Use first 3000 chars (enough for uniqueness, faster hashing)
      const normalizedResume = normalizeForCache(resumeText).substring(0, 3000);
      const normalizedJob = truncatedJobDescription ? normalizeForCache(truncatedJobDescription).substring(0, 1500) : '';
      
      // Create cache key from normalized content hash
      const cacheInput = `v3|${normalizedResume}|${normalizedJob}`;
      const cacheKey = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cacheInput))
        .then(hash => Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join(''))
        .then(hex => hex.substring(0, 32));
      
      const CACHE_FUNCTION_NAME = 'free-keyword-scan-stream';
      const CACHE_TTL_HOURS = 24; // Extended to 24 hours for better hit rates
      
      // Check cache first (skip if user requested fresh analysis)
      if (!skipCache) {
        const { data: cachedResponse, error: cacheError } = await supabase.rpc('get_cached_response', {
          p_cache_key: cacheKey,
          p_function_name: CACHE_FUNCTION_NAME
        });
        
        if (!cacheError && cachedResponse) {
          console.log(`[FREE-KEYWORD-SCAN-STREAM] Cache HIT for key ${cacheKey.substring(0, 8)}...`);
          metricCtx.cacheHit = true;
          
          // Send quick progress updates
          send('progress', PROGRESS_STAGES[2]);
          send('progress', PROGRESS_STAGES[3]);
          send('progress', PROGRESS_STAGES[4]);
          send('progress', PROGRESS_STAGES[5]);
          
          // Log successful cache hit
          logScanMetric(metricCtx, 'completed', {
            outputValid: true,
            responseScore: cachedResponse.atsScoreEstimate,
            metadata: { cached: true, cacheKey: cacheKey.substring(0, 8) }
          });
          
          // Return cached result
          send('complete', { ...cachedResponse, cached: true });
          close();
          return;
        }
      } else {
        console.log(`[FREE-KEYWORD-SCAN-STREAM] Skipping cache (skipCache=true)`);
      }
      
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Cache MISS for key ${cacheKey.substring(0, 8)}...`);

      send('progress', PROGRESS_STAGES[2]);

      // Get API key
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        send('error', { error: 'Service temporarily unavailable.' });
        close();
        return;
      }

      // Build prompts with resume type awareness and accuracy improvements
      const systemPrompt = `Expert ATS resume analyst. Respond in resume's language. All fields in that language.

RESUME TYPE DETECTED: ${resumeType.type} (${resumeType.label})
SENIORITY LEVEL: ${seniority}
ATS RELEVANCE: ${resumeType.atsRelevance}

CRITICAL: READ THE ENTIRE RESUME CAREFULLY before making claims about missing content or suggesting keywords.
CRITICAL: Adjust your analysis based on the detected resume type. A highlights-based resume should NOT be penalized for "missing work history" if it's clearly designed for direct outreach.

CORE RULES:
1. EXPERIENCE YEARS: Find EARLIEST job date → calculate to 2025. ALL roles count (consulting, sales, freelance). Example: 2015→present = 10 years.
2. INDUSTRY DETECTION: Prioritize JOB FUNCTION over product domain. "Software Sales", "SaaS Sales", "Enterprise Sales" = "sales" NOT "technology". "Sales Engineer" = "sales". Pure engineering/dev roles (Software Engineer, Developer, Data Scientist) = "technology". Account Executive/BDR/SDR = "sales". Valid: technology, healthcare, finance, legal, sales, marketing, education, engineering, creative, hr, consulting, retail, hospitality, manufacturing, government, general
3. IMPLICIT SKILLS: Check if skill is demonstrated implicitly before flagging as missing. Salesforce + MEDDPICC implies CRM expertise.
4. SENIORITY-ADJUSTED SCORING: 
   - Senior/Executive roles: Weight outcomes, scope, and leadership HIGHER than keyword density
   - Entry/Mid roles: Keyword density matters more for ATS parsing
   - For ${seniority} level: ${seniority === 'senior' || seniority === 'executive' ? 'Focus on strategic impact, deal size, team leadership, and revenue influence over keyword repetition' : 'Balance keywords with achievements'}
5. PERSONALIZATION: Use candidate's NAME. Reference SPECIFIC achievements. Warm, encouraging tone.

CONTENT LOCATION RULES (CRITICAL - stop false "missing" flags):
BEFORE flagging ANY content as "missing", CHECK if it exists ANYWHERE in the resume:
- If quota/metrics exist in SUMMARY but not in role bullets → say "Quota attainment mentioned in summary — consider reinforcing at role-level bullets for recruiter skimmability"
- If keywords exist but aren't repeated → say "Found [keyword] — could be reinforced in additional sections"
- NEVER say "missing" for content that exists in a different section
- Use "could be reinforced" or "consider adding to [section]" instead of "missing"

KEYWORD SUGGESTIONS (CRITICAL - avoid false positives):
BEFORE suggesting to add ANY keyword, SEARCH the resume text for:
- The exact keyword (case-insensitive)
- Common variations (React/ReactJS, Node/Node.js, AWS/Amazon Web Services)
- Related terms that imply the skill

NEVER SUGGEST adding a keyword that ALREADY EXISTS in the resume.
If React, Node, AWS, Python, etc. are mentioned → they are PRESENT. Do not suggest adding them.
Only suggest keywords that are genuinely MISSING and relevant to the target role.
Focus on truly missing high-value keywords, not generic checklist items.

GITHUB/PORTFOLIO ADVICE (role-appropriate):
- For senior engineers at large companies: GitHub/portfolio is OPTIONAL, not required
- For startups or IC-heavy roles: GitHub/portfolio is valuable but not mandatory
- For non-technical roles: GitHub is irrelevant
- Frame as "nice-to-have for [specific context]" not "missing/required"
- Don't include in red flags - only mention as optional enhancement in quickWins if relevant

TENURE RULES (critical for sales/BD roles):
- 1.5-2.5 year average tenure is NORMAL in SaaS/tech sales. Do NOT flag as red flag.
- Only flag tenure if < 1 year average across 3+ roles.
- Logical career progression (e.g., startup → scale-up → enterprise) = strength, not weakness.
- Promotions or "first sales hire" roles explain short tenures.

QUOTA/METRICS DETECTION (CRITICAL - avoid false positives):
BEFORE flagging "missing quota" or "missing metrics", SEARCH for these patterns:
- "exceeded quota", "surpassed quota", "% of target", "% attainment", "quota attainment"
- "X% of goal", "2x", "3x", "120%", "100%+", "over quota"
- Dollar amounts with context: "$130K deal", "$1M ARR", "$500K pipeline"
- Growth metrics: "grew revenue", "increased sales", "expanded accounts"
- Comparisons: "vs goal", "above target", "beat forecast"

If ANY quota/revenue metrics exist → resume HAS quota data. Do NOT flag as missing.
If metrics exist in summary but not bullets → say "reinforce at role level" NOT "missing"
Only flag "Missing Quota Data" if ZERO revenue/quota language exists anywhere.

CONTACT INFO DETECTION (CRITICAL - avoid false positives):
BEFORE flagging "missing contact info", CHECK for:
- Email addresses, phone numbers, LinkedIn URLs, city/state, name at top
- If 2+ of these exist, contact info is PRESENT. Do NOT flag.
- Only flag if genuinely missing (e.g., no name, no email, no phone, no location).

FORMAT GRADING (nuanced, resume-type aware):
For ${resumeType.type} resumes:
${resumeType.type === 'executive_summary' || resumeType.type === 'outreach_referral' 
  ? '- This format is intentionally non-chronological. Do NOT penalize for missing dates.\n- Grade based on clarity, impact, and professional presentation.\n- A/B grade is appropriate if content is well-organized.'
  : resumeType.type === 'hybrid'
  ? '- Highlights section + chronological experience = excellent format.\n- A grade if both sections are well-executed.'
  : '- Grade A: Clean single-column, standard sections, bullet points, chronological experience\n- Grade B: Minor issues (unusual section names, some formatting inconsistency) - still ATS-readable\n- Grade C: Moderate issues (functional format, missing standard sections, but parseable)\n- Grade D: Significant issues (tables/columns, graphics, non-standard format that may cause parsing errors)'}

MESSAGING ACCURACY (critical - calibrate to score):
- For scores 85+: Use OPTIMIZATION language ("enhance", "fine-tune", "maximize impact")
- For scores 70-84: Use IMPROVEMENT language ("strengthen", "add", "consider")
- For scores 55-69: Use GUIDANCE language ("focus on", "prioritize")
- For scores <55: Use ACTIONABLE language ("key improvements needed")

- NEVER say "will be filtered out" or "at risk of being filtered" - ATS filtering only applies to job portal uploads.
- Explain that direct emails, referrals, LinkedIn outreach, or recruiter requests BYPASS ATS entirely.
- For format grades: D grade means ATS may "classify as incomplete or down-rank" NOT "scramble" the content.
- Format issues cause: classification errors, reduced ranking, sometimes auto-rejection - NOT data scrambling.
- Frame as "ATS portal readiness" not universal job search risk.

SCORING CONTEXT:
- Scores are DIRECTIONAL SIGNALS for ATS optimization, not pass/fail metrics
- A score of 65 vs 75 doesn't mean rejection - it means room for optimization
- Use "could improve ATS visibility" not "will be filtered" or "will be rejected"
- Every flag must explain WHY it matters AND when it applies (portal vs direct outreach)
- Be specific about what's ACTUALLY missing vs what could be ENHANCED

CREDIBILITY ISSUES (prioritize over keyword gaps):
These are HIGH-PRIORITY red flags that should be mentioned before keyword suggestions:
- Date inconsistencies (end before start, future dates)
- Impossible timelines (10 years experience but graduated 2 years ago)
- Overlapping roles without explanation
- Missing company names for listed roles

BEFORE ANALYSIS: Extract name → find earliest job date → calculate total years → assess seniority → LIST ALL EXISTING SKILLS/KEYWORDS → SCAN FOR EXISTING METRICS/QUOTA DATA → check contact info → extract titles → check education/certs → determine industry.

OUTPUT: ATS score (0-100), industry, format grade (A-D), experience level, keywords (ONLY truly missing ones), red flags. Address candidate by name. Be accurate - don't flag content that exists or suggest keywords already present.`;

      const userPrompt = hasJobDescription 
        ? `Analyze this ${resumeType.label} for the target job:\n\n<resume>\n${resumeText.substring(0, 15000)}\n</resume>\n\n<job_description>\n${truncatedJobDescription}\n</job_description>`
        : `Analyze this ${resumeType.label}:\n\n<resume>\n${resumeText.substring(0, 15000)}\n</resume>`;

      // Call AI with streaming enabled
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro", // Using Pro for better analysis quality
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          stream: true,
          tools: [{
            type: "function",
            function: {
              name: "submit_analysis",
              description: "Submit resume analysis",
              parameters: {
                type: "object",
                properties: {
                  detectedLanguage: {
                    type: "object",
                    properties: {
                      code: { type: "string" },
                      name: { type: "string" }
                    }
                  },
                  candidateName: { type: "string" },
                  industry: { type: "string" },
                  currentRole: { type: "string" },
                  atsScoreEstimate: { type: "number" },
                  formatGrade: { type: "string" },
                  formatIssue: { type: "string" },
                  experienceLevel: {
                    type: "object",
                    description: "Calculate yearsEstimate from earliest job date to present (2025). Count ALL roles including consulting, sales, part-time, freelance.",
                    properties: {
                      level: { type: "string", description: "Entry-level, Mid-level, Senior, Executive, etc." },
                      yearsEstimate: { type: "string", description: "Total years from earliest job date to now (e.g., '10 years', '9+ years'). Do NOT truncate." }
                    }
                  },
                  sectionCheck: {
                    type: "object",
                    properties: {
                      hasContact: { type: "boolean" },
                      hasSummary: { type: "boolean" },
                      hasExperience: { type: "boolean" },
                      hasEducation: { type: "boolean" },
                      hasSkills: { type: "boolean" }
                    }
                  },
                  topStrength: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      description: { type: "string" }
                    }
                  },
                  redFlags: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        issue: { type: "string" },
                        impact: { type: "string" }
                      }
                    }
                  },
                  keywords: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        keyword: { type: "string" },
                        reason: { type: "string" }
                      }
                    }
                  },
                  quickWins: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        fix: { type: "string" },
                        timeEstimate: { type: "string" },
                        impact: { type: "string" }
                      }
                    }
                  },
                  improvementPotential: {
                    type: "object",
                    properties: {
                      level: { type: "string" },
                      estimatedScoreIncrease: { type: "number" },
                      topPriority: { type: "string" }
                    }
                  }
                },
                required: ["detectedLanguage", "industry", "atsScoreEstimate", "formatGrade", "experienceLevel", "keywords", "redFlags"]
              }
            }
          }],
          tool_choice: { type: "function", function: { name: "submit_analysis" } }
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error("[FREE-KEYWORD-SCAN-STREAM] AI error:", aiResponse.status, errorText);
        send('error', { error: 'Analysis failed. Please try again.' });
        close();
        return;
      }

      send('progress', PROGRESS_STAGES[3]);

      // Process streaming response
      const reader = aiResponse.body?.getReader();
      if (!reader) {
        send('error', { error: 'Failed to read AI response.' });
        close();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let toolCallArgs = '';
      let progressSent = 3; // Track which progress stages we've sent

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Process complete SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          
          try {
            const parsed = JSON.parse(line.slice(6));
            const delta = parsed.choices?.[0]?.delta;
            
            // Accumulate tool call arguments
            if (delta?.tool_calls?.[0]?.function?.arguments) {
              toolCallArgs += delta.tool_calls[0].function.arguments;
              
              // Send progress updates based on content received
              const argLength = toolCallArgs.length;
              if (argLength > 500 && progressSent < 4) {
                send('progress', PROGRESS_STAGES[4]);
                progressSent = 4;
              } else if (argLength > 1500 && progressSent < 5) {
                send('progress', PROGRESS_STAGES[5]);
                progressSent = 5;
              }
            }
          } catch (e) {
            // Ignore parse errors for incomplete chunks
          }
        }
      }

      // Parse final result
      let analysis = null;
      try {
        analysis = JSON.parse(toolCallArgs);
      } catch (e) {
        console.error("[FREE-KEYWORD-SCAN-STREAM] Failed to parse tool args:", e);
        logScanMetric(metricCtx, 'failed', {
          errorCode: 'PARSE_ERROR',
          errorMessage: 'Failed to parse AI response',
          outputValid: false
        });
        send('error', { error: 'Failed to parse analysis results.' });
        close();
        return;
      }

      if (!analysis) {
        logScanMetric(metricCtx, 'failed', {
          errorCode: 'NO_ANALYSIS',
          errorMessage: 'No analysis returned from AI',
          outputValid: false
        });
        send('error', { error: 'No analysis returned.' });
        close();
        return;
      }

      // Normalize industry to valid value, with server-side override for obvious misclassifications
      const rawIndustry = analysis.industry;
      const industryDetection = detectIndustryFromResume(resumeText);
      
      // Use server detection if confident, otherwise fall back to AI + normalization
      if (industryDetection.confidence === 'high' || industryDetection.confidence === 'medium') {
        if (industryDetection.industry !== normalizeIndustry(rawIndustry)) {
          console.log(`[FREE-KEYWORD-SCAN-STREAM] Server override: AI said "${rawIndustry}" but text clearly indicates "${industryDetection.industry}" (${industryDetection.confidence} confidence)`);
        }
        analysis.industry = industryDetection.industry;
      } else {
        analysis.industry = normalizeIndustry(rawIndustry);
        if (rawIndustry !== analysis.industry) {
          console.log(`[FREE-KEYWORD-SCAN-STREAM] Industry normalized: "${rawIndustry}" -> "${analysis.industry}"`);
        }
      }
      
      // Store detection metadata for UI
      const industryDetectionMeta = {
        detected: analysis.industry,
        confidence: industryDetection.confidence,
        signals: industryDetection.signals,
        aiSuggested: rawIndustry
      };
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Industry detection: ${JSON.stringify(industryDetectionMeta)}`);

      // ======================== Server-Side Computed Fields ========================
      // These are computed from the raw resume text for accuracy and consistency

      // 1. Timeline Analysis (experience years, tenure, progression)
      const computedTimeline = computeTimelineAnalysis(resumeText);
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Computed timeline: ${JSON.stringify(computedTimeline)}`);

      // 2. Quantification Score (section-aware)
      const computedQuantification = computeQuantificationScore(resumeText);
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Computed quantification: ${JSON.stringify(computedQuantification)}`);

      // 3. Bullet Impact Score (section-aware)
      const computedBulletImpact = computeBulletImpactScore(resumeText);
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Computed bullet impact: ${JSON.stringify(computedBulletImpact)}`);

      // 4. Industry Benchmark
      const computedBenchmark = computeIndustryBenchmark(analysis.atsScoreEstimate || 0, analysis.industry);
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Computed benchmark: ${JSON.stringify(computedBenchmark)}`);

      // 5. Dual Scoring (ATS Compatibility + Recruiter Impact)
      const dualScore = computeDualScore(
        analysis.atsScoreEstimate || 0,
        computedQuantification.score,
        computedBulletImpact.score,
        seniority,
        resumeType
      );
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Dual score: ${JSON.stringify(dualScore)}`);

      // 6. Calibrated Language
      const calibratedLanguage = calibrateLanguage(analysis.atsScoreEstimate || 0, seniority, resumeType);
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Calibrated language: ${JSON.stringify(calibratedLanguage)}`);

      // 7. Usage Recommendations
      const usageRecommendations = generateUsageRecommendations(
        resumeType,
        analysis.atsScoreEstimate || 0,
        analysis.formatGrade || 'B'
      );
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Usage recommendations: ${JSON.stringify(usageRecommendations)}`);

      // 8. Content Location Checks
      const quotaLocation = checkContentLocation(resumeText, 'quota');
      const metricsLocation = checkContentLocation(resumeText, 'metrics');

      // Build response with computed fields merged
      const responseData = {
        success: true,
        ...analysis,
        // New fields for improved analysis
        resumeType,
        seniorityLevel: seniority,
        dualScore,
        calibratedLanguage,
        usageRecommendations,
        credibilityIssues: credibilityIssues.slice(0, 3), // Top 3 credibility issues
        contentLocations: {
          quota: quotaLocation,
          metrics: metricsLocation
        },
        // Industry detection with metadata for transparency
        industryDetection: industryDetectionMeta,
        // Override/add computed fields
        timelineAnalysis: computedTimeline,
        quantificationScore: computedQuantification,
        bulletImpactScore: computedBulletImpact,
        industryBenchmark: computedBenchmark,
        // Trim arrays and filter false-positive red flags
        redFlags: (analysis.redFlags || []).filter((flag: { issue?: string; impact?: string }) => {
          const issue = (flag.issue || '').toLowerCase();
          const impact = (flag.impact || '').toLowerCase();
          const combined = issue + ' ' + impact;
          
          // Filter 1: Only flag "missing contact info" if 2+ elements are actually missing
          if (combined.includes('contact') || combined.includes('email') || combined.includes('phone') || combined.includes('missing') && combined.includes('information')) {
            const hasEmail = /@[\w\.-]+\.\w+/.test(resumeText);
            const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(resumeText);
            const hasLinkedIn = /linkedin\.com|linkedin/i.test(resumeText);
            const hasLocation = /\b(city|state|[A-Z][a-z]+,\s*[A-Z]{2}|\d{5})\b/i.test(resumeText);
            const contactCount = [hasEmail, hasPhone, hasLinkedIn, hasLocation].filter(Boolean).length;
            // Only show as red flag if 2+ are missing (i.e., only 0-1 present)
            if (contactCount >= 2) return false;
          }
          
          // Filter 2: Don't flag "missing quota/metrics" if resume has clear quota language
          if (combined.includes('quota') || combined.includes('metric') || combined.includes('quantif') || combined.includes('number') || combined.includes('revenue') && combined.includes('missing')) {
            if (quotaLocation.exists || metricsLocation.exists) {
              return false;
            }
          }
          
          // Filter 3: Don't flag normal sales tenure (1.5-2.5 years) as job hopping
          if (combined.includes('tenure') || combined.includes('job hop') || combined.includes('short stint')) {
            // Check if this is a sales role
            const isSalesRole = /\b(sales|account\s+executive|ae|bdr|sdr|business\s+development)/i.test(resumeText);
            if (isSalesRole) {
              // In sales, 1.5-2.5 year tenure is normal, only flag if clearly < 1 year average
              const tenurePattern = /\b(20\d{2}|19\d{2})\s*[-–—]\s*(20\d{2}|19\d{2}|present|current)/gi;
              const matches = resumeText.match(tenurePattern) || [];
              if (matches.length <= 3) return false; // Not enough data to claim job hopping
            }
          }
          
          // Filter 4: For non-ATS resume types, don't flag missing chronological experience
          if (resumeType.atsRelevance === 'low') {
            if (combined.includes('chronological') || combined.includes('work history') || combined.includes('date') && combined.includes('missing')) {
              return false;
            }
          }
          
          return true;
        }).slice(0, 3),
        // Filter keywords that already exist in the resume (false positive prevention)
        keywords: (analysis.keywords || []).filter((kw: { keyword?: string; reason?: string }) => {
          const keyword = (kw.keyword || '').toLowerCase().trim();
          if (!keyword) return false;
          
          const resumeLower = resumeText.toLowerCase();
          
          // Common keyword variations to check
          const variations: Record<string, string[]> = {
            'react': ['react', 'reactjs', 'react.js'],
            'node': ['node', 'nodejs', 'node.js'],
            'aws': ['aws', 'amazon web services', 'amazon aws'],
            'javascript': ['javascript', 'js', 'ecmascript'],
            'typescript': ['typescript', 'ts'],
            'python': ['python', 'py'],
            'docker': ['docker', 'containerization'],
            'kubernetes': ['kubernetes', 'k8s'],
            'github': ['github', 'git'],
            'postgresql': ['postgresql', 'postgres', 'psql'],
            'mongodb': ['mongodb', 'mongo'],
            'graphql': ['graphql', 'gql'],
            'rest api': ['rest api', 'restful', 'rest'],
            'ci/cd': ['ci/cd', 'cicd', 'continuous integration', 'continuous deployment'],
            'agile': ['agile', 'scrum', 'kanban'],
            'salesforce': ['salesforce', 'sfdc', 'crm'],
          };
          
          // Check if keyword or any variation exists in resume
          const keywordBase = keyword.replace(/[^a-z0-9]/g, '');
          const toCheck = variations[keyword] || variations[keywordBase] || [keyword];
          
          for (const variant of toCheck) {
            if (resumeLower.includes(variant)) {
              console.log(`[KEYWORD-FILTER] Filtered out "${keyword}" - already present as "${variant}"`);
              return false;
            }
          }
          
          // Also do a direct check for the keyword itself
          if (resumeLower.includes(keyword)) {
            console.log(`[KEYWORD-FILTER] Filtered out "${keyword}" - direct match found`);
            return false;
          }
          
          return true;
        }).slice(0, 6),
        // Filter quickWins to remove GitHub/portfolio suggestions for non-relevant roles
        quickWins: (analysis.quickWins || []).filter((win: { fix?: string; impact?: string }) => {
          const fix = (win.fix || '').toLowerCase();
          
          // Only show GitHub/portfolio advice for relevant contexts
          if (fix.includes('github') || fix.includes('portfolio') || fix.includes('personal website') || fix.includes('projects')) {
            // Check if this is a senior role at large company (where it's less relevant)
            const isSenior = /\b(senior|lead|principal|director|vp|head|chief|staff)\b/i.test(resumeText);
            const isLargeCompany = /\b(google|amazon|microsoft|meta|apple|netflix|fortune\s*500|enterprise)\b/i.test(resumeText);
            
            // For senior roles at large companies, GitHub is optional - don't suggest it
            if (isSenior && isLargeCompany) {
              console.log(`[QUICKWIN-FILTER] Filtered GitHub/portfolio suggestion for senior role at large company`);
              return false;
            }
          }
          
          return true;
        }).slice(0, 3),
      };

      const country = getCountryFromHeaders(req) || 'Unknown';

      // Send admin notification email for every free scan
      EdgeRuntime.waitUntil(
        (async () => {
          try {
            const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
            if (!RESEND_API_KEY) {
              console.log('[FREE-KEYWORD-SCAN-STREAM] No RESEND_API_KEY, skipping admin notification');
              return;
            }

            const atsScore = analysis.atsScoreEstimate || 0;
            const response = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Resume Booster <onboarding@resend.dev>',
                to: [ADMIN_EMAIL],
                subject: `🔍 New Free Scan: ${analysis.industry || 'Unknown'} (ATS ${atsScore}) - ${country}`,
                html: `
                  <h2>New Free Resume Scan</h2>
                  <ul>
                    <li><strong>Country:</strong> ${country}</li>
                    <li><strong>Industry:</strong> ${analysis.industry || 'Unknown'}</li>
                    <li><strong>Resume Type:</strong> ${resumeType.label}</li>
                    <li><strong>Seniority:</strong> ${seniority}</li>
                    <li><strong>ATS Score:</strong> ${atsScore}/100</li>
                    <li><strong>Recruiter Score:</strong> ${dualScore.recruiterImpact}/100</li>
                    <li><strong>Experience Level:</strong> ${analysis.experienceLevel?.level || 'Unknown'}</li>
                    <li><strong>IP Address:</strong> ${clientIp}</li>
                    <li><strong>Time:</strong> ${new Date().toISOString()}</li>
                  </ul>
                `,
              }),
            });

            if (!response.ok) {
              console.error('[FREE-KEYWORD-SCAN-STREAM] Admin notification failed:', await response.text());
            } else {
              console.log('[FREE-KEYWORD-SCAN-STREAM] Admin notification sent');
            }
          } catch (err) {
            console.error('[FREE-KEYWORD-SCAN-STREAM] Admin notification error:', err);
          }
        })()
      );

      // Increment counter
      EdgeRuntime.waitUntil(
        (async () => {
          await supabase.rpc('increment_free_scan_count');
        })()
      );

      // Log scan metric to database
      logScanMetric(metricCtx, 'completed', {
        outputValid: true,
        responseScore: analysis.atsScoreEstimate,
        metadata: { 
          industry: analysis.industry,
          experienceLevel: analysis.experienceLevel?.level,
          hasJobDescription: !!truncatedJobDescription,
          resumeType: resumeType.type,
          seniority
        }
      });

      // Store in cache for future requests (non-blocking)
      EdgeRuntime.waitUntil(
        (async () => {
          try {
            const { error: storeError } = await supabase.rpc('store_cached_response', {
              p_cache_key: cacheKey,
              p_function_name: CACHE_FUNCTION_NAME,
              p_response: responseData,
              p_ttl_hours: CACHE_TTL_HOURS
            });
            
            if (storeError) {
              console.error(`[FREE-KEYWORD-SCAN-STREAM] Cache store error:`, storeError.message);
            } else {
              console.log(`[FREE-KEYWORD-SCAN-STREAM] Cached response for key ${cacheKey.substring(0, 8)}...`);
            }
          } catch (err) {
            console.error(`[FREE-KEYWORD-SCAN-STREAM] Cache store exception:`, err);
          }
        })()
      );

      // Log performance
      const duration = Date.now() - requestStartTime;
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Complete in ${duration}ms, ATS: ${analysis.atsScoreEstimate}, Recruiter: ${dualScore.recruiterImpact}`);

      // Send final result
      send('progress', { stage: 'complete', message: 'Analysis complete!', progress: 100 });
      send('complete', responseData);
      close();

    } catch (error) {
      console.error("[FREE-KEYWORD-SCAN-STREAM] Error:", error);
      send('error', { error: 'An error occurred. Please try again.' });
      close();
    }
  })());

  return response;
});
