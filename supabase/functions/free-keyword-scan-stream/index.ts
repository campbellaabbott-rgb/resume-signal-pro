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
// Expanded industry list with sub-industries
const VALID_INDUSTRIES = [
  // Core industries
  'technology', 'healthcare', 'finance', 'legal', 'sales', 
  'marketing', 'education', 'engineering', 'creative', 'hr', 
  'consulting', 'retail', 'hospitality', 'manufacturing', 
  'government', 'nonprofit', 'construction', 'real_estate',
  'logistics', 'energy', 'agriculture',
  // Sub-industries for technology
  'software_engineering', 'data_science', 'devops', 'cybersecurity', 'product_management',
  'ai_ml', 'blockchain', 'cloud_engineering',
  // Sub-industries for engineering
  'mechanical_engineering', 'electrical_engineering', 'civil_engineering', 
  'chemical_engineering', 'aerospace_engineering',
  // Sub-industries for healthcare
  'nursing', 'physician', 'pharmacy', 'mental_health', 'medical_devices', 
  'health_administration', 'clinical_research', 'physical_therapy', 'radiology',
  // Sub-industries for finance
  'investment_banking', 'accounting', 'financial_planning',
  // Sub-industries for sales
  'enterprise_sales', 'inside_sales', 'sales_engineering', 'business_development',
  // Sub-industries for marketing
  'digital_marketing', 'content_marketing', 'brand_marketing', 'growth_marketing', 'product_marketing',
  // Sub-industries for legal
  'corporate_law', 'litigation', 'intellectual_property', 'employment_law', 'compliance',
  // Sub-industries for education
  'k12_education', 'higher_education', 'edtech', 'curriculum_development', 'special_education',
  // Sub-industries for manufacturing
  'quality_engineering', 'process_engineering', 'lean_manufacturing', 'supply_chain_manufacturing', 'plant_management',
  // Sub-industries for HR
  'talent_acquisition', 'hr_business_partner', 'compensation_benefits', 'learning_development', 'hr_operations',
  // Sub-industries for consulting
  'management_consulting', 'strategy_consulting', 'it_consulting', 'hr_consulting', 'operations_consulting',
  // Sub-industries for creative
  'graphic_design', 'ux_design', 'video_production', 'copywriting_creative', 'art_direction',
  // Sub-industries for retail
  'store_management', 'merchandising', 'ecommerce', 'retail_buying', 'loss_prevention',
  // Sub-industries for hospitality
  'hotel_management', 'food_beverage', 'event_management', 'tourism', 'casino_gaming',
  // Sub-industries for government
  'policy_analysis', 'public_administration', 'military', 'law_enforcement', 'intelligence',
  // Sub-industries for nonprofit
  'fundraising', 'program_management_nonprofit', 'advocacy', 'grant_writing', 'volunteer_management',
  // Emerging roles
  'sustainability', 'dei', 'remote_work', 'creator_economy',
  // HYBRID INDUSTRIES - Cross-domain roles
  'healthcare_it', 'fintech', 'legaltech', 'hrtech', 'proptech', 'insurtech', 'regtech', 'govtech',
  'agtech', 'cleantech', 'martech', 'adtech', 'retailtech', 'traveltech', 'sporttech', 'foodtech',
  'biotech', 'medtech', 'wealthtech', 'supplychain_tech', 'constructech',
  'general'
];

// Industry parent mapping (sub-industry -> parent)
const INDUSTRY_PARENTS: Record<string, string> = {
  'software_engineering': 'technology',
  'data_science': 'technology',
  'devops': 'technology',
  'cybersecurity': 'technology',
  'product_management': 'technology',
  'ai_ml': 'technology',
  'blockchain': 'technology',
  'cloud_engineering': 'technology',
  'mechanical_engineering': 'engineering',
  'electrical_engineering': 'engineering',
  'civil_engineering': 'engineering',
  'chemical_engineering': 'engineering',
  'aerospace_engineering': 'engineering',
  'nursing': 'healthcare',
  'physician': 'healthcare',
  'pharmacy': 'healthcare',
  'mental_health': 'healthcare',
  'medical_devices': 'healthcare',
  'health_administration': 'healthcare',
  'clinical_research': 'healthcare',
  'physical_therapy': 'healthcare',
  'radiology': 'healthcare',
  'investment_banking': 'finance',
  'accounting': 'finance',
  'financial_planning': 'finance',
  // Sales sub-industries
  'enterprise_sales': 'sales',
  'inside_sales': 'sales',
  'sales_engineering': 'sales',
  'business_development': 'sales',
  // Marketing sub-industries
  'digital_marketing': 'marketing',
  'content_marketing': 'marketing',
  'brand_marketing': 'marketing',
  'growth_marketing': 'marketing',
  'product_marketing': 'marketing',
  // Legal sub-industries
  'corporate_law': 'legal',
  'litigation': 'legal',
  'intellectual_property': 'legal',
  'employment_law': 'legal',
  'compliance': 'legal',
  // Education sub-industries
  'k12_education': 'education',
  'higher_education': 'education',
  'edtech': 'education',
  'curriculum_development': 'education',
  'special_education': 'education',
  // Manufacturing sub-industries
  'quality_engineering': 'manufacturing',
  'process_engineering': 'manufacturing',
  'lean_manufacturing': 'manufacturing',
  'supply_chain_manufacturing': 'manufacturing',
  'plant_management': 'manufacturing',
  // HR sub-industries
  'talent_acquisition': 'hr',
  'hr_business_partner': 'hr',
  'compensation_benefits': 'hr',
  'learning_development': 'hr',
  'hr_operations': 'hr',
  // Consulting sub-industries
  'management_consulting': 'consulting',
  'strategy_consulting': 'consulting',
  'it_consulting': 'consulting',
  'hr_consulting': 'consulting',
  'operations_consulting': 'consulting',
  // Creative sub-industries
  'graphic_design': 'creative',
  'ux_design': 'creative',
  'video_production': 'creative',
  'copywriting_creative': 'creative',
  'art_direction': 'creative',
  // Retail sub-industries
  'store_management': 'retail',
  'merchandising': 'retail',
  'ecommerce': 'retail',
  'retail_buying': 'retail',
  'loss_prevention': 'retail',
  // Hospitality sub-industries
  'hotel_management': 'hospitality',
  'food_beverage': 'hospitality',
  'event_management': 'hospitality',
  'tourism': 'hospitality',
  'casino_gaming': 'hospitality',
  // Government sub-industries
  'policy_analysis': 'government',
  'public_administration': 'government',
  'military': 'government',
  'law_enforcement': 'government',
  'intelligence': 'government',
  // Nonprofit sub-industries
  'fundraising': 'nonprofit',
  'program_management_nonprofit': 'nonprofit',
  'advocacy': 'nonprofit',
  'grant_writing': 'nonprofit',
  'volunteer_management': 'nonprofit',
  // Emerging roles (cross-industry)
  'sustainability': 'technology',
  'dei': 'hr',
  'remote_work': 'hr',
  'creator_economy': 'creative',
  // HYBRID INDUSTRIES - These are their own parent (primary domain)
  'healthcare_it': 'technology',
  'fintech': 'finance',
  'legaltech': 'legal',
  'hrtech': 'hr',
  'proptech': 'real_estate',
  'insurtech': 'finance',
  'regtech': 'finance',
  'govtech': 'government',
  'agtech': 'agriculture',
  'cleantech': 'energy',
  'martech': 'marketing',
  'adtech': 'marketing',
  'retailtech': 'retail',
  'traveltech': 'hospitality',
  'sporttech': 'technology',
  'foodtech': 'hospitality',
  'biotech': 'healthcare',
  'medtech': 'healthcare',
  'wealthtech': 'finance',
  'supplychain_tech': 'logistics',
  'constructech': 'construction',
};

// Industry aliases for normalization
const INDUSTRY_ALIASES: Record<string, string> = {
  'tech': 'technology', 'software': 'software_engineering', 'it': 'technology',
  'software development': 'software_engineering', 'information technology': 'technology',
  'web development': 'software_engineering', 'app development': 'software_engineering',
  'medical': 'healthcare', 'health': 'healthcare', 'medicine': 'physician',
  'nursing': 'nursing', 'pharmaceutical': 'pharmacy', 'pharma': 'pharmacy',
  'law': 'legal', 'attorney': 'corporate_law', 'lawyer': 'litigation',
  'corporate lawyer': 'corporate_law', 'litigator': 'litigation', 'patent': 'intellectual_property',
  'trademark': 'intellectual_property', 'ip law': 'intellectual_property',
  'labor law': 'employment_law', 'hr law': 'employment_law',
  'banking': 'investment_banking', 'accounting': 'accounting', 'financial services': 'finance',
  'cpa': 'accounting', 'bookkeeping': 'accounting',
  'advertising': 'brand_marketing', 'pr': 'brand_marketing', 'public relations': 'brand_marketing',
  'seo': 'digital_marketing', 'ppc': 'digital_marketing', 'social media': 'digital_marketing',
  'content': 'content_marketing', 'copywriting': 'content_marketing',
  'growth hacking': 'growth_marketing', 'performance marketing': 'growth_marketing',
  'teaching': 'education', 'academia': 'education', 'academic': 'education',
  'design': 'creative', 'art': 'creative', 'media': 'creative',
  'human resources': 'hr', 'recruitment': 'hr', 'talent': 'hr',
  'management consulting': 'consulting', 'strategy': 'consulting',
  'ecommerce': 'retail', 'e-commerce': 'retail', 'store': 'retail',
  'hotel': 'hospitality', 'restaurant': 'hospitality', 'tourism': 'hospitality',
  'food service': 'hospitality', 'lodging': 'hospitality',
  'production': 'manufacturing', 'factory': 'manufacturing', 'assembly': 'manufacturing',
  'public sector': 'government', 'federal': 'government', 'state': 'government',
  'municipal': 'government', 'civil service': 'government',
  'ngo': 'nonprofit', 'charity': 'nonprofit', 'foundation': 'nonprofit',
  'building': 'construction', 'contractor': 'construction', 'trades': 'construction',
  'property': 'real_estate', 'realty': 'real_estate',
  'supply chain': 'logistics', 'shipping': 'logistics', 'warehouse': 'logistics',
  'oil': 'energy', 'gas': 'energy', 'renewable': 'energy', 'utilities': 'energy',
  'farming': 'agriculture', 'agribusiness': 'agriculture',
  'data': 'data_science', 'ml': 'data_science', 'ai': 'ai_ml',
  'security': 'cybersecurity', 'infosec': 'cybersecurity',
  'infrastructure': 'devops', 'sre': 'devops', 'platform': 'devops',
  // Sales aliases
  'b2b sales': 'enterprise_sales', 'enterprise': 'enterprise_sales', 'strategic sales': 'enterprise_sales',
  'sdr': 'inside_sales', 'bdr': 'business_development', 'outbound': 'inside_sales',
  'pre-sales': 'sales_engineering', 'solutions': 'sales_engineering', 'technical sales': 'sales_engineering',
  'partnerships': 'business_development', 'alliances': 'business_development',
  // Marketing aliases
  'demand gen': 'growth_marketing', 'lead generation': 'growth_marketing',
  'pmm': 'product_marketing', 'go-to-market': 'product_marketing',
  // Legal aliases
  'regulatory': 'compliance', 'risk': 'compliance', 'governance': 'compliance',
  // Healthcare aliases
  'medtech': 'medical_devices', 'biomedical': 'medical_devices', 'medical equipment': 'medical_devices',
  'hospital administration': 'health_administration', 'healthcare management': 'health_administration',
  'clinical trials': 'clinical_research', 'cra': 'clinical_research', 'research coordinator': 'clinical_research',
  'pt': 'physical_therapy', 'occupational therapy': 'physical_therapy', 'rehabilitation': 'physical_therapy',
  'imaging': 'radiology', 'mri': 'radiology', 'ct scan': 'radiology', 'x-ray': 'radiology',
  // Education aliases
  'teacher': 'k12_education', 'elementary': 'k12_education', 'high school': 'k12_education', 'middle school': 'k12_education',
  'professor': 'higher_education', 'university': 'higher_education', 'college': 'higher_education',
  'learning technology': 'edtech', 'instructional design': 'curriculum_development', 'course design': 'curriculum_development',
  'sped': 'special_education', 'iep': 'special_education', 'learning disabilities': 'special_education',
  // Manufacturing aliases
  'qa': 'quality_engineering', 'quality control': 'quality_engineering', 'qc': 'quality_engineering',
  'six sigma': 'lean_manufacturing', 'kaizen': 'lean_manufacturing', 'continuous improvement': 'lean_manufacturing',
  'operations': 'plant_management', 'plant operations': 'plant_management', 'production manager': 'plant_management',
  'manufacturing engineering': 'process_engineering', 'industrial engineering': 'process_engineering',
  // HR aliases
  'recruiter': 'talent_acquisition', 'sourcer': 'talent_acquisition', 'ta': 'talent_acquisition',
  'hrbp': 'hr_business_partner', 'people partner': 'hr_business_partner',
  'comp': 'compensation_benefits', 'benefits': 'compensation_benefits', 'total rewards': 'compensation_benefits',
  'l&d': 'learning_development', 'training': 'learning_development', 'organizational development': 'learning_development',
  'hris': 'hr_operations', 'people ops': 'hr_operations', 'hr analyst': 'hr_operations',
  // Consulting aliases
  'mbb': 'strategy_consulting', 'mckinsey': 'strategy_consulting', 'bain': 'strategy_consulting', 'bcg': 'strategy_consulting',
  'systems integrator': 'it_consulting', 'technology consulting': 'it_consulting',
  'process improvement': 'operations_consulting', 'business process': 'operations_consulting',
  // Creative aliases
  'ui': 'ux_design', 'ux': 'ux_design', 'product design': 'ux_design', 'interaction design': 'ux_design',
  'visual design': 'graphic_design', 'branding design': 'graphic_design',
  'film': 'video_production', 'motion graphics': 'video_production', 'animation': 'video_production',
  'creative copy': 'copywriting_creative', 'scriptwriter': 'copywriting_creative',
  'creative director': 'art_direction', 'brand creative': 'art_direction',
  // Retail aliases
  'store manager': 'store_management', 'retail manager': 'store_management', 'district manager': 'store_management',
  'buyer': 'retail_buying', 'category management': 'retail_buying', 'assortment': 'merchandising',
  'visual merchandising': 'merchandising', 'planogram': 'merchandising',
  'asset protection': 'loss_prevention', 'shrink': 'loss_prevention',
  'online retail': 'ecommerce', 'dtc': 'ecommerce', 'direct to consumer': 'ecommerce',
  // Hospitality aliases
  'gm hotel': 'hotel_management', 'front office': 'hotel_management', 'rooms division': 'hotel_management',
  'f&b': 'food_beverage', 'chef': 'food_beverage', 'restaurant manager': 'food_beverage',
  'event planner': 'event_management', 'catering': 'event_management', 'banquet': 'event_management',
  'travel': 'tourism', 'destination': 'tourism', 'hospitality marketing': 'tourism',
  'casino': 'casino_gaming', 'gaming': 'casino_gaming', 'table games': 'casino_gaming',
  // Government aliases
  'policy': 'policy_analysis', 'think tank': 'policy_analysis', 'legislative': 'policy_analysis',
  'city manager': 'public_administration', 'public affairs': 'public_administration',
  'armed forces': 'military', 'veteran': 'military', 'defense': 'military',
  'police': 'law_enforcement', 'fbi': 'law_enforcement', 'corrections': 'law_enforcement',
  'cia': 'intelligence', 'nsa': 'intelligence', 'analyst': 'intelligence',
  // Nonprofit aliases
  'development director': 'fundraising', 'major gifts': 'fundraising', 'donor relations': 'fundraising',
  'program director': 'program_management_nonprofit', 'impact': 'program_management_nonprofit',
  'lobbying': 'advocacy', 'campaign': 'advocacy', 'grassroots': 'advocacy',
  'grants': 'grant_writing', 'proposal writing': 'grant_writing',
  'volunteer coordinator': 'volunteer_management', 'community engagement': 'volunteer_management',
  // Emerging role aliases
  'esg': 'sustainability', 'climate': 'sustainability', 'green': 'sustainability', 'carbon': 'sustainability',
  'diversity': 'dei', 'inclusion': 'dei', 'equity': 'dei', 'belonging': 'dei',
  'remote': 'remote_work', 'distributed': 'remote_work', 'virtual work': 'remote_work',
  'influencer': 'creator_economy', 'content creator': 'creator_economy', 'youtuber': 'creator_economy',
  // Technology emerging aliases
  'machine learning': 'ai_ml', 'deep learning': 'ai_ml', 'nlp': 'ai_ml', 'computer vision': 'ai_ml',
  'web3': 'blockchain', 'crypto': 'blockchain', 'defi': 'blockchain', 'smart contracts': 'blockchain',
  'aws': 'cloud_engineering', 'azure': 'cloud_engineering', 'gcp': 'cloud_engineering',
  // HYBRID INDUSTRY aliases
  'health it': 'healthcare_it', 'health informatics': 'healthcare_it', 'clinical informatics': 'healthcare_it',
  'health tech': 'healthcare_it', 'healthtech': 'healthcare_it', 'ehr': 'healthcare_it', 'epic': 'healthcare_it',
  'cerner': 'healthcare_it', 'meditech': 'healthcare_it', 'hl7': 'healthcare_it', 'fhir': 'healthcare_it',
  'financial technology': 'fintech', 'payments': 'fintech', 'neobank': 'fintech', 'stripe': 'fintech',
  'legal tech': 'legaltech', 'legal technology': 'legaltech', 'e-discovery': 'legaltech',
  'hr tech': 'hrtech', 'hr technology': 'hrtech', 'people analytics': 'hrtech',
  'property tech': 'proptech', 'real estate tech': 'proptech', 'retech': 'proptech',
  'insurance tech': 'insurtech', 'insurance technology': 'insurtech',
  'regulatory tech': 'regtech', 'regulatory technology': 'regtech',
  'government tech': 'govtech', 'civic tech': 'govtech',
  // New hybrid industry aliases
  'agricultural tech': 'agtech', 'agricultural technology': 'agtech', 'ag tech': 'agtech',
  'precision agriculture': 'agtech', 'farm tech': 'agtech', 'smart farming': 'agtech',
  'clean tech': 'cleantech', 'clean technology': 'cleantech', 'green tech': 'cleantech',
  'sustainability tech': 'cleantech', 'climate tech': 'cleantech', 'renewable energy tech': 'cleantech',
  'marketing tech': 'martech', 'marketing technology': 'martech', 'mar tech': 'martech',
  'marketing automation': 'martech', 'marketing platform': 'martech',
  'advertising tech': 'adtech', 'advertising technology': 'adtech', 'ad tech': 'adtech',
  'programmatic': 'adtech', 'dsp': 'adtech', 'ssp': 'adtech',
  'retail tech': 'retailtech', 'retail technology': 'retailtech', 'ecommerce tech': 'retailtech',
  'travel tech': 'traveltech', 'travel technology': 'traveltech', 'hospitality tech': 'traveltech',
  'sports tech': 'sporttech', 'sports technology': 'sporttech', 'sport tech': 'sporttech',
  'fitness tech': 'sporttech', 'athletic tech': 'sporttech',
  'food tech': 'foodtech', 'food technology': 'foodtech', 'foodservice tech': 'foodtech',
  'restaurant tech': 'foodtech', 'ghost kitchen': 'foodtech', 'meal delivery': 'foodtech',
  'biotechnology': 'biotech', 'bio tech': 'biotech', 'life sciences': 'biotech',
  'medical tech': 'medtech', 'medical technology': 'medtech', 'medical device': 'medtech',
  'wealth tech': 'wealthtech', 'wealth technology': 'wealthtech', 'robo advisor': 'wealthtech',
  'supply chain tech': 'supplychain_tech', 'logistics tech': 'supplychain_tech', 'freight tech': 'supplychain_tech',
  'construction tech': 'constructech', 'con tech': 'constructech', 'building tech': 'constructech',
};

// Get parent industry for display (preserves sub-industry detail)
function getParentIndustry(industry: string): string {
  return INDUSTRY_PARENTS[industry] || industry;
}

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
 * Enhanced with sub-industries, better confidence scoring, and AI hybrid support
 * Returns { industry, subIndustry, parentIndustry, confidence, signals, score } for transparency
 */
interface IndustryDetectionResult {
  industry: string;
  subIndustry?: string;
  parentIndustry?: string;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
  score: number;
  detectionSource?: 'server_high' | 'server_medium' | 'server_low' | 'ai_override' | 'ai_fallback';
  alternativeIndustries?: { industry: string; score: number }[];
  matchedTitlePatterns?: string[];
  matchedSkillCount?: number;
  matchedContextPatterns?: boolean;
}

// ==================== FUZZY TITLE MATCHING ====================
// Normalize common abbreviations and variations in job titles
function normalizeResumeText(text: string): string {
  const abbreviations: [RegExp, string][] = [
    // Title abbreviations
    [/\bsr\.?\s+/gi, 'senior '],
    [/\bjr\.?\s+/gi, 'junior '],
    [/\bdev\b/gi, 'developer'],
    [/\beng\b/gi, 'engineer'],
    [/\bmgr\b/gi, 'manager'],
    [/\bdir\b/gi, 'director'],
    [/\bvp\b/gi, 'vice president'],
    [/\bsvp\b/gi, 'senior vice president'],
    [/\bevp\b/gi, 'executive vice president'],
    [/\bexec\b/gi, 'executive'],
    [/\bassoc\b/gi, 'associate'],
    [/\basst\b/gi, 'assistant'],
    [/\badmin\b/gi, 'administrator'],
    [/\bops\b/gi, 'operations'],
    [/\btech\b/gi, 'technical'],
    [/\bsw\s+eng/gi, 'software engineer'],
    [/\bse\s+/gi, 'software engineer '],
    [/\bswe\b/gi, 'software engineer'],
    [/\bpm\b/gi, 'product manager'],
    [/\bux\b/gi, 'user experience'],
    [/\bui\b/gi, 'user interface'],
    [/\bqa\b/gi, 'quality assurance'],
    [/\bhr\b/gi, 'human resources'],
    [/\bpr\b/gi, 'public relations'],
    [/\bbd\b/gi, 'business development'],
    [/\bsdr\b/gi, 'sales development representative'],
    [/\bbdr\b/gi, 'business development representative'],
    [/\bae\b/gi, 'account executive'],
    [/\bcsm\b/gi, 'customer success manager'],
    [/\bcso\b/gi, 'chief security officer'],
    [/\bcfo\b/gi, 'chief financial officer'],
    [/\bceo\b/gi, 'chief executive officer'],
    [/\bcoo\b/gi, 'chief operating officer'],
    [/\bcto\b/gi, 'chief technology officer'],
    [/\bcmo\b/gi, 'chief marketing officer'],
    [/\bcpo\b/gi, 'chief product officer'],
    [/\bcro\b/gi, 'chief revenue officer'],
    [/\bchro\b/gi, 'chief human resources officer'],
    // Industry abbreviations
    [/\bml\b/gi, 'machine learning'],
    [/\bai\b/gi, 'artificial intelligence'],
    [/\bnlp\b/gi, 'natural language processing'],
    [/\biot\b/gi, 'internet of things'],
    [/\bsaas\b/gi, 'software as a service'],
    [/\bb2b\b/gi, 'business to business'],
    [/\bb2c\b/gi, 'business to consumer'],
    [/\bcrm\b/gi, 'customer relationship management'],
    [/\berp\b/gi, 'enterprise resource planning'],
  ];
  
  let normalized = text;
  for (const [pattern, replacement] of abbreviations) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

// ==================== KEYWORD DENSITY SCORING ====================
// Calculate keyword density for each industry to catch edge cases
function calculateKeywordDensity(text: string): Record<string, number> {
  // Multilingual industry keywords (English + Spanish + French + German + Portuguese)
  const industryKeywords: Record<string, string[]> = {
    technology: [
      // English
      'software', 'code', 'programming', 'app', 'application', 'website', 'database', 'algorithm', 'api', 'cloud', 'server', 'data', 'system', 'platform', 'tech', 'digital', 'computer', 'network', 'mobile', 'web',
      // Spanish
      'desarrollador', 'programación', 'aplicación', 'sitio web', 'base de datos', 'computadora', 'ordenador', 'tecnología', 'informática', 'sistema', 'ingeniero de software',
      // French
      'développeur', 'programmation', 'logiciel', 'informatique', 'numérique', 'ordinateur', 'réseau', 'données', 'ingénieur',
      // German
      'entwickler', 'programmierung', 'anwendung', 'datenbank', 'rechner', 'technologie', 'softwareentwickler', 'informatik',
      // Portuguese
      'desenvolvedor', 'programação', 'aplicativo', 'banco de dados', 'computador', 'tecnologia', 'engenheiro de software', 'sistemas'
    ],
    sales: [
      // English
      'sales', 'quota', 'revenue', 'pipeline', 'leads', 'prospects', 'deals', 'closing', 'commission', 'territory', 'account', 'customer', 'client', 'negotiation', 'contract', 'pitch', 'demo', 'opportunity',
      // Spanish
      'ventas', 'cliente', 'negociación', 'contrato', 'ingresos', 'comisión', 'territorio', 'oportunidad', 'cuenta', 'vendedor',
      // French
      'ventes', 'client', 'négociation', 'contrat', 'chiffre d\'affaires', 'commission', 'territoire', 'commercial', 'vendeur',
      // German
      'verkauf', 'vertrieb', 'kunde', 'verhandlung', 'vertrag', 'umsatz', 'provision', 'verkäufer',
      // Portuguese
      'vendas', 'cliente', 'negociação', 'contrato', 'receita', 'comissão', 'vendedor', 'oportunidade'
    ],
    marketing: [
      // English
      'marketing', 'campaign', 'brand', 'content', 'seo', 'social media', 'advertising', 'creative', 'audience', 'engagement', 'awareness', 'leads', 'conversion', 'analytics', 'traffic', 'email', 'digital',
      // Spanish
      'mercadeo', 'mercadotecnia', 'campaña', 'marca', 'contenido', 'publicidad', 'audiencia', 'redes sociales', 'conversión',
      // French
      'campagne', 'marque', 'contenu', 'publicité', 'réseaux sociaux', 'audience', 'numérique', 'engagement',
      // German
      'werbung', 'marke', 'kampagne', 'inhalt', 'zielgruppe', 'soziale medien', 'markenführung',
      // Portuguese
      'campanha', 'marca', 'conteúdo', 'publicidade', 'mídia social', 'audiência', 'conversão'
    ],
    finance: [
      // English
      'financial', 'accounting', 'budget', 'revenue', 'profit', 'investment', 'audit', 'tax', 'compliance', 'banking', 'portfolio', 'assets', 'equity', 'forecast', 'reporting', 'statements',
      // Spanish
      'finanzas', 'financiero', 'contabilidad', 'presupuesto', 'inversión', 'auditoría', 'impuestos', 'banca', 'activos',
      // French
      'finance', 'financier', 'comptabilité', 'budget', 'investissement', 'audit', 'impôts', 'banque', 'actifs',
      // German
      'finanzen', 'buchhaltung', 'haushalt', 'investition', 'prüfung', 'steuern', 'bank', 'vermögen',
      // Portuguese
      'finanças', 'financeiro', 'contabilidade', 'orçamento', 'investimento', 'auditoria', 'impostos', 'ativos'
    ],
    healthcare: [
      // English
      'patient', 'clinical', 'medical', 'hospital', 'healthcare', 'nursing', 'diagnosis', 'treatment', 'pharmacy', 'health', 'care', 'physician', 'doctor', 'nurse', 'therapy', 'wellness',
      // Spanish
      'paciente', 'clínico', 'médico', 'hospital', 'salud', 'enfermería', 'diagnóstico', 'tratamiento', 'farmacia', 'enfermera', 'doctor', 'terapia', 'bienestar',
      // French
      'patient', 'clinique', 'médical', 'hôpital', 'santé', 'soins infirmiers', 'diagnostic', 'traitement', 'pharmacie', 'médecin', 'infirmier', 'thérapie',
      // German
      'patient', 'klinisch', 'medizinisch', 'krankenhaus', 'gesundheit', 'pflege', 'diagnose', 'behandlung', 'apotheke', 'arzt', 'krankenschwester', 'therapie',
      // Portuguese
      'paciente', 'clínico', 'médico', 'hospital', 'saúde', 'enfermagem', 'diagnóstico', 'tratamento', 'farmácia', 'enfermeiro', 'doutor', 'terapia'
    ],
    hr: [
      // English
      'recruiting', 'hiring', 'talent', 'employee', 'workforce', 'benefits', 'compensation', 'training', 'performance', 'onboarding', 'culture', 'engagement', 'hr', 'human resources', 'staffing',
      // Spanish
      'reclutamiento', 'contratación', 'talento', 'empleado', 'recursos humanos', 'beneficios', 'compensación', 'capacitación', 'personal',
      // French
      'recrutement', 'embauche', 'talent', 'employé', 'ressources humaines', 'avantages', 'rémunération', 'formation', 'personnel',
      // German
      'rekrutierung', 'einstellung', 'talent', 'mitarbeiter', 'personalwesen', 'vergütung', 'schulung', 'personal',
      // Portuguese
      'recrutamento', 'contratação', 'talento', 'funcionário', 'recursos humanos', 'benefícios', 'compensação', 'treinamento'
    ],
    legal: [
      // English
      'legal', 'law', 'attorney', 'lawyer', 'litigation', 'contract', 'compliance', 'regulatory', 'court', 'case', 'counsel', 'patent', 'trademark', 'intellectual property',
      // Spanish
      'legal', 'abogado', 'litigio', 'contrato', 'cumplimiento', 'tribunal', 'caso', 'patente', 'marca registrada', 'derecho', 'ley', 'propiedad intelectual',
      // French
      'juridique', 'avocat', 'litige', 'contrat', 'conformité', 'tribunal', 'affaire', 'brevet', 'marque déposée', 'droit', 'loi',
      // German
      'rechtlich', 'anwalt', 'rechtsstreit', 'vertrag', 'compliance', 'gericht', 'fall', 'patent', 'marke', 'recht', 'gesetz',
      // Portuguese
      'jurídico', 'advogado', 'litígio', 'contrato', 'conformidade', 'tribunal', 'caso', 'patente', 'marca registrada', 'direito', 'lei'
    ],
    education: [
      // English
      'teaching', 'curriculum', 'student', 'classroom', 'education', 'learning', 'school', 'university', 'instructor', 'professor', 'academic', 'training', 'course',
      // Spanish
      'enseñanza', 'currículo', 'estudiante', 'aula', 'educación', 'aprendizaje', 'escuela', 'universidad', 'profesor', 'académico', 'curso', 'maestro',
      // French
      'enseignement', 'curriculum', 'étudiant', 'salle de classe', 'éducation', 'apprentissage', 'école', 'université', 'professeur', 'cours', 'formation',
      // German
      'unterricht', 'lehrplan', 'student', 'klassenzimmer', 'bildung', 'lernen', 'schule', 'universität', 'lehrer', 'professor', 'kurs',
      // Portuguese
      'ensino', 'currículo', 'estudante', 'sala de aula', 'educação', 'aprendizado', 'escola', 'universidade', 'professor', 'curso'
    ],
    engineering: [
      // English
      'engineering', 'design', 'manufacturing', 'cad', 'mechanical', 'electrical', 'civil', 'structural', 'prototype', 'testing', 'specifications',
      // Spanish
      'ingeniería', 'diseño', 'manufactura', 'mecánico', 'eléctrico', 'civil', 'estructural', 'prototipo', 'especificaciones', 'ingeniero',
      // French
      'ingénierie', 'conception', 'fabrication', 'mécanique', 'électrique', 'civil', 'structurel', 'prototype', 'spécifications', 'ingénieur',
      // German
      'ingenieurwesen', 'konstruktion', 'fertigung', 'mechanisch', 'elektrisch', 'zivil', 'strukturell', 'prototyp', 'ingenieur',
      // Portuguese
      'engenharia', 'design', 'fabricação', 'mecânico', 'elétrico', 'civil', 'estrutural', 'protótipo', 'engenheiro'
    ],
    consulting: [
      // English
      'consulting', 'advisory', 'strategy', 'client', 'engagement', 'stakeholder', 'recommendation', 'analysis', 'project', 'deliverable',
      // Spanish
      'consultoría', 'asesoría', 'estrategia', 'cliente', 'análisis', 'proyecto', 'recomendación', 'consultor',
      // French
      'conseil', 'stratégie', 'client', 'engagement', 'analyse', 'projet', 'recommandation', 'consultant',
      // German
      'beratung', 'strategie', 'kunde', 'analyse', 'projekt', 'empfehlung', 'berater',
      // Portuguese
      'consultoria', 'assessoria', 'estratégia', 'cliente', 'análise', 'projeto', 'recomendação', 'consultor'
    ],
    creative: [
      // English
      'design', 'creative', 'visual', 'brand', 'art', 'graphic', 'photography', 'video', 'animation', 'illustration', 'layout', 'typography',
      // Spanish
      'diseño', 'creativo', 'visual', 'marca', 'arte', 'gráfico', 'fotografía', 'video', 'animación', 'ilustración', 'diseñador',
      // French
      'design', 'créatif', 'visuel', 'marque', 'art', 'graphique', 'photographie', 'vidéo', 'animation', 'illustration', 'designer',
      // German
      'design', 'kreativ', 'visuell', 'marke', 'kunst', 'grafik', 'fotografie', 'video', 'animation', 'illustration', 'designer',
      // Portuguese
      'design', 'criativo', 'visual', 'marca', 'arte', 'gráfico', 'fotografia', 'vídeo', 'animação', 'ilustração', 'designer'
    ],
    retail: [
      // English
      'retail', 'store', 'merchandise', 'inventory', 'sales floor', 'customer service', 'pos', 'shopping', 'e-commerce', 'products',
      // Spanish
      'minorista', 'tienda', 'mercancía', 'inventario', 'atención al cliente', 'comercio electrónico', 'productos', 'ventas',
      // French
      'vente au détail', 'magasin', 'marchandise', 'inventaire', 'service client', 'commerce électronique', 'produits',
      // German
      'einzelhandel', 'geschäft', 'waren', 'inventar', 'kundenservice', 'e-commerce', 'produkte',
      // Portuguese
      'varejo', 'loja', 'mercadoria', 'estoque', 'atendimento ao cliente', 'comércio eletrônico', 'produtos'
    ],
    hospitality: [
      // English
      'hotel', 'restaurant', 'hospitality', 'guest', 'service', 'food', 'beverage', 'catering', 'event', 'tourism', 'travel',
      // Spanish
      'hotel', 'restaurante', 'hospitalidad', 'huésped', 'servicio', 'alimentos', 'bebidas', 'turismo', 'viaje', 'evento',
      // French
      'hôtel', 'restaurant', 'hôtellerie', 'invité', 'service', 'nourriture', 'boissons', 'tourisme', 'voyage', 'événement',
      // German
      'hotel', 'restaurant', 'gastgewerbe', 'gast', 'service', 'essen', 'getränke', 'tourismus', 'reise', 'veranstaltung',
      // Portuguese
      'hotel', 'restaurante', 'hospitalidade', 'hóspede', 'serviço', 'alimentos', 'bebidas', 'turismo', 'viagem', 'evento'
    ],
    manufacturing: [
      // English
      'manufacturing', 'production', 'factory', 'assembly', 'quality', 'lean', 'supply chain', 'operations', 'process', 'equipment',
      // Spanish
      'manufactura', 'producción', 'fábrica', 'ensamblaje', 'calidad', 'cadena de suministro', 'operaciones', 'proceso', 'equipo',
      // French
      'fabrication', 'production', 'usine', 'assemblage', 'qualité', 'chaîne d\'approvisionnement', 'opérations', 'processus', 'équipement',
      // German
      'fertigung', 'produktion', 'fabrik', 'montage', 'qualität', 'lieferkette', 'betrieb', 'prozess', 'ausrüstung',
      // Portuguese
      'manufatura', 'produção', 'fábrica', 'montagem', 'qualidade', 'cadeia de suprimentos', 'operações', 'processo', 'equipamento'
    ],
    government: [
      // English
      'government', 'federal', 'state', 'public', 'policy', 'regulation', 'agency', 'administration', 'civic', 'municipal',
      // Spanish
      'gobierno', 'federal', 'estatal', 'público', 'política', 'regulación', 'agencia', 'administración', 'cívico', 'municipal',
      // French
      'gouvernement', 'fédéral', 'étatique', 'public', 'politique', 'réglementation', 'agence', 'administration', 'civique', 'municipal',
      // German
      'regierung', 'bundes', 'staatlich', 'öffentlich', 'politik', 'regulierung', 'behörde', 'verwaltung', 'kommunal',
      // Portuguese
      'governo', 'federal', 'estadual', 'público', 'política', 'regulamentação', 'agência', 'administração', 'cívico', 'municipal'
    ],
    nonprofit: [
      // English
      'nonprofit', 'charity', 'donation', 'fundraising', 'volunteer', 'mission', 'grant', 'community', 'advocacy', 'impact',
      // Spanish
      'sin fines de lucro', 'caridad', 'donación', 'recaudación de fondos', 'voluntario', 'misión', 'subvención', 'comunidad', 'defensa', 'impacto',
      // French
      'sans but lucratif', 'charité', 'don', 'collecte de fonds', 'bénévole', 'mission', 'subvention', 'communauté', 'plaidoyer', 'impact',
      // German
      'gemeinnützig', 'wohltätigkeit', 'spende', 'fundraising', 'freiwilliger', 'mission', 'zuschuss', 'gemeinschaft', 'interessenvertretung',
      // Portuguese
      'sem fins lucrativos', 'caridade', 'doação', 'arrecadação de fundos', 'voluntário', 'missão', 'subvenção', 'comunidade', 'advocacia', 'impacto'
    ],
  };
  
  const scores: Record<string, number> = {};
  for (const [industry, keywords] of Object.entries(industryKeywords)) {
    let count = 0;
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) count += matches.length;
    }
    scores[industry] = count;
  }
  return scores;
}

// Get best industry from keyword density scores
function getBestIndustryFromDensity(scores: Record<string, number>): { 
  industry: string; 
  score: number; 
  alternatives: { industry: string; score: number }[];
} | null {
  const sorted = Object.entries(scores)
    .filter(([_, count]) => count >= 3) // Minimum 3 keyword matches
    .sort((a, b) => b[1] - a[1]);
  
  if (sorted.length === 0) return null;
  
  const [topIndustry, topScore] = sorted[0];
  const alternatives = sorted.slice(1, 4).map(([industry, score]) => ({ industry, score }));
  
  return {
    industry: topIndustry,
    score: topScore,
    alternatives
  };
}

function detectIndustryFromResume(resumeText: string): IndustryDetectionResult {
  // Normalize text with abbreviation expansion for fuzzy matching
  const normalizedText = normalizeResumeText(resumeText);
  const text = normalizedText.toLowerCase();
  const signals: string[] = [];
  
  // ==================== KEYWORD DENSITY SCORING ====================
  // Count industry-specific keywords for fallback detection
  const keywordDensityScores = calculateKeywordDensity(text);
  
  
  // Define industry patterns with weights - expanded with sub-industries and new industries
  const industryPatterns: Record<string, { 
    titlePatterns: RegExp[]; 
    skillPatterns: string[];
    contextPatterns: RegExp[];
    minSkillsForHigh: number;
    titleWeight?: number; // Custom weight for titles (default 30)
    skillWeight?: number; // Custom weight per skill (default 5)
  }> = {
    // === SUB-INDUSTRIES FOR TECHNOLOGY ===
    software_engineering: {
      titlePatterns: [
        /\b(software\s+engineer|senior\s+software\s+engineer|staff\s+engineer)\b/,
        /\b(developer|frontend\s+developer|backend\s+developer|full[\s-]?stack\s+developer)\b/,
        /\b(programmer|coder|software\s+architect|solutions\s+architect)\b/,
        /\b(web\s+developer|mobile\s+developer|ios\s+developer|android\s+developer)\b/,
        /\b(tech\s+lead|engineering\s+manager|vp\s+of\s+engineering|cto)\b/,
      ],
      skillPatterns: [
        'javascript', 'typescript', 'python', 'react', 'node.js', 'nodejs', 'vue', 'angular',
        'java', 'c++', 'c#', 'golang', 'rust', 'swift', 'kotlin', 'ruby', 'php',
        'sql', 'graphql', 'rest api', 'microservices', 'git', 'github', 'gitlab'
      ],
      contextPatterns: [
        /\b(built|developed|architected|deployed|implemented)\s+(the|a|an)?\s*(platform|system|application|api|service)\b/i,
        /\b(pull\s+requests?|code\s+reviews?|sprint|agile|scrum)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 35
    },
    data_science: {
      titlePatterns: [
        /\b(data\s+scientist|senior\s+data\s+scientist|lead\s+data\s+scientist)\b/,
        /\b(machine\s+learning\s+engineer|ml\s+engineer|ai\s+engineer)\b/,
        /\b(data\s+analyst|business\s+intelligence|bi\s+analyst)\b/,
        /\b(data\s+engineer|analytics\s+engineer)\b/,
      ],
      skillPatterns: [
        'machine learning', 'deep learning', 'tensorflow', 'pytorch', 'scikit-learn',
        'python', 'r', 'sql', 'pandas', 'numpy', 'spark', 'hadoop',
        'statistics', 'a/b testing', 'data visualization', 'tableau', 'power bi'
      ],
      contextPatterns: [
        /\b(trained|built|deployed)\s+.*\b(model|algorithm|pipeline)\b/i,
        /\b(improved|increased)\s+.*\b(accuracy|precision|recall|auc)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 35
    },
    devops: {
      titlePatterns: [
        /\b(devops\s+engineer|sre|site\s+reliability\s+engineer)\b/,
        /\b(platform\s+engineer|infrastructure\s+engineer|cloud\s+engineer)\b/,
        /\b(systems\s+engineer|systems\s+administrator)\b/,
      ],
      skillPatterns: [
        'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ansible',
        'jenkins', 'gitlab ci', 'github actions', 'ci/cd', 'linux', 'bash',
        'prometheus', 'grafana', 'datadog', 'cloudformation', 'helm'
      ],
      contextPatterns: [
        /\b(deployed|managed|maintained)\s+.*\b(infrastructure|cluster|pipeline)\b/i,
        /\b(reduced|improved)\s+.*\b(uptime|latency|deployment|availability)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 35
    },
    cybersecurity: {
      titlePatterns: [
        /\b(security\s+engineer|cybersecurity\s+analyst|security\s+architect)\b/,
        /\b(penetration\s+tester|ethical\s+hacker|security\s+consultant)\b/,
        /\b(ciso|chief\s+information\s+security\s+officer|security\s+manager)\b/,
      ],
      skillPatterns: [
        'penetration testing', 'vulnerability assessment', 'siem', 'splunk',
        'firewall', 'ids', 'ips', 'encryption', 'compliance', 'iso 27001',
        'soc', 'incident response', 'threat hunting', 'malware analysis'
      ],
      contextPatterns: [
        /\b(identified|mitigated|prevented)\s+.*\b(vulnerability|threat|breach|attack)\b/i,
        /\b(implemented|managed)\s+.*\b(security|compliance|audit)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    product_management: {
      titlePatterns: [
        /\b(product\s+manager|senior\s+product\s+manager|group\s+product\s+manager)\b/,
        /\b(technical\s+product\s+manager|product\s+owner|cpo)\b/,
        /\b(director\s+of\s+product|vp\s+of\s+product|head\s+of\s+product)\b/,
      ],
      skillPatterns: [
        'product strategy', 'roadmap', 'user research', 'a/b testing', 'analytics',
        'jira', 'confluence', 'agile', 'scrum', 'stakeholder management',
        'prioritization', 'user stories', 'prd', 'mvp', 'product-market fit'
      ],
      contextPatterns: [
        /\b(launched|shipped|defined)\s+.*\b(product|feature|mvp|roadmap)\b/i,
        /\b(grew|increased)\s+.*\b(engagement|retention|adoption|revenue)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    
    // === SUB-INDUSTRIES FOR ENGINEERING ===
    mechanical_engineering: {
      titlePatterns: [
        /\b(mechanical\s+engineer|senior\s+mechanical\s+engineer|lead\s+mechanical\s+engineer)\b/,
        /\b(design\s+engineer|r&d\s+engineer|product\s+engineer)\b/,
        /\b(thermal\s+engineer|hvac\s+engineer)\b/,
      ],
      skillPatterns: [
        'solidworks', 'catia', 'autocad', 'creo', 'inventor', 'nx',
        'fea', 'cfd', 'ansys', 'thermal analysis', 'gd&t', 'dfm', 'dfa',
        '3d printing', 'prototyping', 'materials selection', 'mechanical design'
      ],
      contextPatterns: [
        /\b(designed|developed|engineered)\s+.*\b(component|system|product|mechanism)\b/i,
        /\b(reduced|improved)\s+.*\b(weight|cost|efficiency|performance)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 40
    },
    electrical_engineering: {
      titlePatterns: [
        /\b(electrical\s+engineer|senior\s+electrical\s+engineer|power\s+engineer)\b/,
        /\b(electronics\s+engineer|hardware\s+engineer|pcb\s+engineer)\b/,
        /\b(control\s+systems\s+engineer|instrumentation\s+engineer)\b/,
      ],
      skillPatterns: [
        'pcb', 'circuit design', 'verilog', 'vhdl', 'fpga', 'microcontroller',
        'eagle', 'altium', 'cadence', 'spice', 'oscilloscope', 'power electronics',
        'embedded systems', 'plc', 'scada', 'modbus', 'can bus'
      ],
      contextPatterns: [
        /\b(designed|developed|tested)\s+.*\b(circuit|pcb|board|system)\b/i,
        /\b(reduced|improved)\s+.*\b(power|noise|efficiency|signal)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 40
    },
    civil_engineering: {
      titlePatterns: [
        /\b(civil\s+engineer|structural\s+engineer|geotechnical\s+engineer)\b/,
        /\b(transportation\s+engineer|environmental\s+engineer|water\s+resources)\b/,
        /\b(project\s+engineer|construction\s+engineer|site\s+engineer)\b/,
      ],
      skillPatterns: [
        'autocad', 'revit', 'civil 3d', 'staad', 'sap2000', 'etabs',
        'surveying', 'structural analysis', 'concrete', 'steel', 'foundations',
        'hydrology', 'stormwater', 'traffic analysis', 'geotechnical'
      ],
      contextPatterns: [
        /\b(designed|engineered|managed)\s+.*\b(bridge|road|building|structure)\b/i,
        /\b(supervised|oversaw)\s+.*\b(construction|project|site)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 40
    },
    aerospace_engineering: {
      titlePatterns: [
        /\b(aerospace\s+engineer|propulsion\s+engineer|flight\s+systems\s+engineer)\b/,
        /\b(avionics\s+engineer|structural\s+engineer|aerodynamics\s+engineer)\b/,
      ],
      skillPatterns: [
        'cfd', 'fea', 'catia', 'nastran', 'matlab', 'simulink',
        'propulsion', 'aerodynamics', 'flight dynamics', 'composites',
        'mil-std', 'do-178', 'as9100', 'faa', 'nasa'
      ],
      contextPatterns: [
        /\b(designed|developed|tested)\s+.*\b(aircraft|spacecraft|rocket|satellite)\b/i,
        /\b(boeing|lockheed|spacex|nasa|airbus|northrop)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    
    // === SUB-INDUSTRIES FOR HEALTHCARE ===
    nursing: {
      titlePatterns: [
        /\b(nurse|rn|registered\s+nurse|lpn|lvn)\b/,
        /\b(nurse\s+practitioner|np|clinical\s+nurse|charge\s+nurse)\b/,
        /\b(nurse\s+manager|director\s+of\s+nursing|cno)\b/,
      ],
      skillPatterns: [
        'patient care', 'medication administration', 'iv therapy', 'wound care',
        'vital signs', 'charting', 'epic', 'cerner', 'bls', 'acls', 'pals',
        'hipaa', 'infection control', 'care planning', 'triage'
      ],
      contextPatterns: [
        /\b(provided|administered|monitored)\s+.*\b(care|medication|treatment)\b/i,
        /\b(managed|coordinated)\s+.*\b(patient|ward|unit)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 40
    },
    physician: {
      titlePatterns: [
        /\b(physician|doctor|md|do|surgeon|specialist)\b/,
        /\b(attending|resident|fellow|chief\s+medical\s+officer)\b/,
        /\b(cardiologist|oncologist|pediatrician|internist)\b/,
      ],
      skillPatterns: [
        'diagnosis', 'treatment planning', 'surgery', 'patient consultation',
        'medical records', 'ehr', 'prescribing', 'clinical trials',
        'board certified', 'cme', 'medical license', 'residency'
      ],
      contextPatterns: [
        /\b(diagnosed|treated|operated|performed)\s+.*\b(patient|procedure|surgery)\b/i,
        /\b(published|researched|presented)\s+.*\b(study|paper|findings)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    pharmacy: {
      titlePatterns: [
        /\b(pharmacist|pharmacy\s+technician|pharm\.?d)\b/,
        /\b(clinical\s+pharmacist|staff\s+pharmacist|pharmacy\s+manager)\b/,
      ],
      skillPatterns: [
        'dispensing', 'compounding', 'medication review', 'drug interactions',
        'pharmacy software', 'inventory management', 'patient counseling',
        'controlled substances', 'immunizations', 'mtm'
      ],
      contextPatterns: [
        /\b(dispensed|verified|counseled)\s+.*\b(medication|prescription|patient)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    
    // === SUB-INDUSTRIES FOR FINANCE ===
    investment_banking: {
      titlePatterns: [
        /\b(investment\s+banker|analyst|associate)\s+at\s+.*(goldman|morgan|jpmorgan|bofa|citi)/i,
        /\b(m&a\s+analyst|private\s+equity|venture\s+capital)\b/,
        /\b(portfolio\s+manager|fund\s+manager|hedge\s+fund)\b/,
      ],
      skillPatterns: [
        'financial modeling', 'valuation', 'dcf', 'lbo', 'pitch deck',
        'm&a', 'due diligence', 'bloomberg', 'factset', 'capital iq',
        'deal execution', 'underwriting', 'ipo', 'equity research'
      ],
      contextPatterns: [
        /\b(executed|advised|closed)\s+.*\$[\d,]+[mMbB]\b/i,
        /\b(led|supported)\s+.*\b(transaction|deal|acquisition|merger)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    accounting: {
      titlePatterns: [
        /\b(accountant|cpa|controller|staff\s+accountant|senior\s+accountant)\b/,
        /\b(auditor|tax\s+accountant|forensic\s+accountant)\b/,
        /\b(accounts\s+payable|accounts\s+receivable|bookkeeper)\b/,
      ],
      skillPatterns: [
        'gaap', 'ifrs', 'quickbooks', 'sage', 'netsuite', 'sap',
        'reconciliation', 'journal entries', 'financial statements',
        'tax preparation', 'audit', 'month-end close', 'budgeting'
      ],
      contextPatterns: [
        /\b(prepared|reviewed|reconciled)\s+.*\b(financial|account|statement|ledger)\b/i,
        /\b(managed|oversaw)\s+.*\b(audit|compliance|reporting)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    financial_planning: {
      titlePatterns: [
        /\b(financial\s+planner|wealth\s+advisor|cfp|financial\s+advisor)\b/,
        /\b(retirement\s+specialist|estate\s+planner|insurance\s+agent)\b/,
      ],
      skillPatterns: [
        'financial planning', 'retirement planning', 'estate planning',
        'insurance', 'investments', 'tax planning', 'wealth management',
        'client relationship', 'portfolio', 'cfp', 'chfc'
      ],
      contextPatterns: [
        /\b(managed|advised|grew)\s+.*\$[\d,]+[kKmMbB]?\s*(aum|assets|portfolio)/i,
        /\b(developed|created)\s+.*\b(financial\s+plan|retirement\s+strategy)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    
    // === SUB-INDUSTRIES FOR SALES ===
    enterprise_sales: {
      titlePatterns: [
        /\b(enterprise\s+account\s+executive|strategic\s+account\s+executive|senior\s+account\s+executive)\b/,
        /\b(major\s+accounts?\s+manager|named\s+accounts?\s+manager|key\s+accounts?\s+manager)\b/,
        /\b(vp\s+of\s+sales|director\s+of\s+sales|regional\s+sales\s+director)\b/,
      ],
      skillPatterns: [
        'enterprise sales', 'solution selling', 'consultative selling', 'strategic accounts',
        'salesforce', 'c-suite', 'stakeholder management', 'contract negotiation',
        'complex sales', 'saas', 'arr', 'multi-threading', 'champion building'
      ],
      contextPatterns: [
        /\b(closed|won|managed)\s+.*\$[\d,]+[mMkK]\s*(deal|contract|account)/i,
        /\b(exceeded|achieved|surpassed)\s+.*\b(quota|target|goal)\s+by\s+\d+%/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    inside_sales: {
      titlePatterns: [
        /\b(inside\s+sales|sdr|sales\s+development\s+representative)\b/,
        /\b(account\s+development|outbound\s+sales|inbound\s+sales)\b/,
        /\b(phone\s+sales|telesales|virtual\s+sales)\b/,
      ],
      skillPatterns: [
        'cold calling', 'outbound', 'inbound', 'lead qualification', 'pipeline generation',
        'salesforce', 'outreach', 'salesloft', 'gong', 'chorus',
        'discovery calls', 'demos', 'email sequences', 'cadence'
      ],
      contextPatterns: [
        /\b(booked|scheduled|generated)\s+.*\b(meetings?|demos?|appointments?|leads?)\b/i,
        /\b(exceeded|achieved)\s+.*\b(activity|call|email)\s+targets?\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    sales_engineering: {
      titlePatterns: [
        /\b(sales\s+engineer|solutions\s+engineer|pre[\s-]?sales\s+engineer)\b/,
        /\b(solutions\s+consultant|technical\s+sales|solutions\s+architect)\b/,
        /\b(presales|demo\s+engineer|customer\s+engineer)\b/,
      ],
      skillPatterns: [
        'technical demos', 'poc', 'proof of concept', 'rfp', 'rfi',
        'solution design', 'technical discovery', 'architecture',
        'api', 'integration', 'customization', 'implementation'
      ],
      contextPatterns: [
        /\b(delivered|presented|conducted)\s+.*\b(demo|poc|presentation|workshop)\b/i,
        /\b(designed|architected)\s+.*\b(solution|integration|implementation)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    business_development: {
      titlePatterns: [
        /\b(business\s+development|bdr|bd\s+representative|bd\s+manager)\b/,
        /\b(partnerships?\s+manager|channel\s+manager|alliances?\s+manager)\b/,
        /\b(strategic\s+partnerships|corporate\s+development)\b/,
      ],
      skillPatterns: [
        'partnerships', 'alliances', 'channel sales', 'reseller', 'referral',
        'prospecting', 'lead generation', 'market development', 'new business',
        'territory', 'expansion', 'pipeline', 'networking'
      ],
      contextPatterns: [
        /\b(developed|established|built)\s+.*\b(partnerships?|relationships?|channels?)\b/i,
        /\b(grew|expanded|launched)\s+.*\b(territory|market|region)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    
    // === SUB-INDUSTRIES FOR MARKETING ===
    digital_marketing: {
      titlePatterns: [
        /\b(digital\s+marketing\s+manager|digital\s+marketing\s+specialist|digital\s+strategist)\b/,
        /\b(ppc\s+manager|sem\s+manager|paid\s+media\s+manager)\b/,
        /\b(seo\s+manager|seo\s+specialist|search\s+marketing)\b/,
      ],
      skillPatterns: [
        'google ads', 'facebook ads', 'ppc', 'sem', 'seo', 'paid media',
        'google analytics', 'ga4', 'gtm', 'google tag manager', 'meta ads',
        'display advertising', 'retargeting', 'programmatic', 'cpc', 'cpm', 'roas'
      ],
      contextPatterns: [
        /\b(increased|improved|grew)\s+.*\b(roas|roi|ctr|conversions?|traffic)\b/i,
        /\b(managed|optimized)\s+.*\$[\d,]+[kKmM]?\s*(budget|spend|campaigns?)/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 35
    },
    content_marketing: {
      titlePatterns: [
        /\b(content\s+marketing\s+manager|content\s+strategist|content\s+director)\b/,
        /\b(copywriter|content\s+writer|editorial\s+manager)\b/,
        /\b(blog\s+manager|content\s+lead|head\s+of\s+content)\b/,
      ],
      skillPatterns: [
        'content strategy', 'copywriting', 'blog', 'editorial', 'seo writing',
        'content calendar', 'storytelling', 'brand voice', 'thought leadership',
        'cms', 'wordpress', 'hubspot', 'contentful', 'webflow'
      ],
      contextPatterns: [
        /\b(created|produced|developed)\s+.*\b(content|articles?|blogs?|copy)\b/i,
        /\b(increased|grew)\s+.*\b(traffic|engagement|subscribers?|readership)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    brand_marketing: {
      titlePatterns: [
        /\b(brand\s+manager|brand\s+marketing\s+manager|brand\s+marketing\s+director)\b/i,
        /\b(brand\s+director|director\s+of\s+brand|head\s+of\s+brand)\b/i,
        /\b(brand\s+strategist|brand\s+lead|brand\s+specialist)\b/i,
        /\b(vp\s+of\s+brand|chief\s+brand\s+officer|cbo)\b/i,
        /\b(creative\s+director|brand\s+communications)\b/i,
        /\b(marketing\s+communications\s+manager|marcom\s+manager)\b/i,
      ],
      skillPatterns: [
        'brand strategy', 'brand identity', 'brand positioning', 'brand guidelines',
        'brand awareness', 'brand messaging', 'brand campaigns', 'brand development',
        'creative direction', 'advertising campaigns', 'media planning', 'pr',
        'agency management', 'event marketing', 'sponsorships', 'consumer insights',
        'market research', 'brand portfolio', 'brand architecture', 'rebranding',
        'visual identity', 'brand voice', 'brand storytelling', 'creative brief'
      ],
      contextPatterns: [
        /\b(brand\s+strategy|brand\s+positioning|brand\s+identity)\b/i,
        /\b(brand\s+awareness|brand\s+recognition|brand\s+perception)\b/i,
        /\b(launched|developed|managed)\s+.*\b(brand|campaign|advertising)\b/i,
        /\b(increased|improved|grew)\s+.*\b(awareness|recognition|perception|equity)\b/i,
        /\b(portfolio\s+of|consumer)\s+brands?\b/i,
        /\b(creative\s+direction|brand\s+guidelines|visual\s+identity)\b/i,
        /\b(rebranding|brand\s+refresh|brand\s+launch)\b/i,
      ],
      minSkillsForHigh: 2,
      titleWeight: 45
    },
    growth_marketing: {
      titlePatterns: [
        /\b(growth\s+marketing\s+manager|growth\s+lead|head\s+of\s+growth)\b/,
        /\b(demand\s+generation|demand\s+gen|lifecycle\s+marketing)\b/,
        /\b(performance\s+marketing|acquisition\s+marketing|cro\s+manager)\b/,
      ],
      skillPatterns: [
        'growth hacking', 'a/b testing', 'conversion optimization', 'funnel optimization',
        'demand generation', 'lead generation', 'marketing automation', 'hubspot',
        'marketo', 'segment', 'amplitude', 'mixpanel', 'attribution'
      ],
      contextPatterns: [
        /\b(grew|increased|improved)\s+.*\b(conversion|acquisition|activation|retention)\b/i,
        /\b(optimized|tested)\s+.*\b(funnel|journey|experience)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 40
    },
    product_marketing: {
      titlePatterns: [
        /\b(product\s+marketing\s+manager|pmm|senior\s+pmm)\b/,
        /\b(go[\s-]?to[\s-]?market|gtm\s+manager|launch\s+manager)\b/,
        /\b(competitive\s+intelligence|market\s+research\s+manager)\b/,
      ],
      skillPatterns: [
        'product positioning', 'messaging', 'go-to-market', 'gtm', 'launch',
        'competitive analysis', 'market research', 'buyer personas', 'sales enablement',
        'product launches', 'feature adoption', 'customer insights'
      ],
      contextPatterns: [
        /\b(launched|positioned|marketed)\s+.*\b(product|feature|release)\b/i,
        /\b(developed|created)\s+.*\b(positioning|messaging|collateral|enablement)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    
    // === SUB-INDUSTRIES FOR LEGAL ===
    corporate_law: {
      titlePatterns: [
        /\b(corporate\s+attorney|corporate\s+counsel|transactional\s+attorney)\b/,
        /\b(m&a\s+attorney|securities\s+attorney|general\s+counsel)\b/,
        /\b(in[\s-]?house\s+counsel|associate\s+attorney|corporate\s+lawyer)\b/,
      ],
      skillPatterns: [
        'corporate law', 'mergers and acquisitions', 'm&a', 'securities', 'due diligence',
        'contract drafting', 'corporate governance', 'board resolutions', 'bylaws',
        'stock purchase', 'asset purchase', 'private equity', 'venture capital'
      ],
      contextPatterns: [
        /\b(drafted|negotiated|closed)\s+.*\b(transaction|deal|acquisition|merger)\b/i,
        /\b(advised|counseled)\s+.*\b(board|executives?|management|clients?)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    litigation: {
      titlePatterns: [
        /\b(litigation\s+attorney|litigator|trial\s+attorney|trial\s+lawyer)\b/,
        /\b(associate\s+attorney|senior\s+associate|litigation\s+counsel)\b/,
        /\b(defense\s+attorney|plaintiff\s+attorney|appellate\s+attorney)\b/,
      ],
      skillPatterns: [
        'litigation', 'trial', 'deposition', 'discovery', 'motion practice',
        'brief writing', 'oral argument', 'westlaw', 'lexisnexis', 'pacer',
        'e-discovery', 'arbitration', 'mediation', 'civil procedure'
      ],
      contextPatterns: [
        /\b(tried|litigated|defended|represented)\s+.*\b(case|matter|client|plaintiff)\b/i,
        /\b(drafted|argued|filed)\s+.*\b(motion|brief|complaint|appeal)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    intellectual_property: {
      titlePatterns: [
        /\b(ip\s+attorney|patent\s+attorney|trademark\s+attorney)\b/,
        /\b(intellectual\s+property|patent\s+agent|ip\s+counsel)\b/,
        /\b(copyright\s+attorney|trade\s+secret|ip\s+litigator)\b/,
      ],
      skillPatterns: [
        'patent', 'trademark', 'copyright', 'trade secret', 'intellectual property',
        'patent prosecution', 'ip litigation', 'licensing', 'infringement',
        'uspto', 'patent office', 'prior art', 'claims drafting', 'ip portfolio'
      ],
      contextPatterns: [
        /\b(prosecuted|drafted|filed)\s+.*\b(patent|trademark|application)\b/i,
        /\b(managed|protected)\s+.*\b(ip\s+portfolio|intellectual\s+property)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    employment_law: {
      titlePatterns: [
        /\b(employment\s+attorney|labor\s+attorney|employment\s+counsel)\b/,
        /\b(labor\s+relations|hr\s+counsel|workplace\s+attorney)\b/,
        /\b(discrimination|wrongful\s+termination|wage\s+and\s+hour)\b/,
      ],
      skillPatterns: [
        'employment law', 'labor law', 'eeoc', 'nlra', 'flsa', 'ada',
        'discrimination', 'harassment', 'wrongful termination', 'wage and hour',
        'employment contracts', 'severance', 'non-compete', 'workplace investigations'
      ],
      contextPatterns: [
        /\b(advised|counseled|represented)\s+.*\b(employer|employee|hr|management)\b/i,
        /\b(defended|litigated)\s+.*\b(discrimination|harassment|termination)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    compliance: {
      titlePatterns: [
        /\b(compliance\s+officer|chief\s+compliance|compliance\s+manager)\b/,
        /\b(regulatory\s+affairs|compliance\s+counsel|regulatory\s+counsel)\b/,
        /\b(risk\s+manager|compliance\s+analyst|compliance\s+director)\b/,
      ],
      skillPatterns: [
        'compliance', 'regulatory', 'risk management', 'audit', 'sox',
        'gdpr', 'hipaa', 'aml', 'kyc', 'bsa', 'finra', 'sec',
        'policy development', 'internal controls', 'governance'
      ],
      contextPatterns: [
        /\b(developed|implemented|managed)\s+.*\b(compliance|policy|program)\b/i,
        /\b(ensured|maintained)\s+.*\b(compliance|regulatory|adherence)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    
    // === HEALTHCARE SUB-INDUSTRIES ===
    medical_devices: {
      titlePatterns: [
        /\b(medical\s+device\s+engineer|biomedical\s+engineer|product\s+development\s+engineer)\b/i,
        /\b(quality\s+engineer.*medical|regulatory\s+affairs.*medical)\b/i,
        /\b(clinical\s+engineer|field\s+service\s+engineer.*medical)\b/i,
        /\b(r&d\s+engineer.*medical|design\s+engineer.*medical)\b/i,
      ],
      skillPatterns: [
        'medical devices', 'fda', '510(k)', 'iso 13485', 'iec 62304', 'design controls',
        'biomedical', 'class ii', 'class iii', 'dhf', 'dhr', 'risk management',
        'v&v', 'verification', 'validation', 'sterilization', 'biocompatibility'
      ],
      contextPatterns: [
        /\b(medical\s+device|fda\s+submission|510\(k\)|regulatory\s+approval)\b/i,
        /\b(developed|designed|launched)\s+.*\b(device|implant|instrument)\b/i,
        /\b(iso\s+13485|design\s+controls|dhf)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    health_administration: {
      titlePatterns: [
        /\b(healthcare\s+administrator|hospital\s+administrator|practice\s+manager)\b/i,
        /\b(health\s+services\s+manager|clinic\s+manager|medical\s+director)\b/i,
        /\b(director\s+of\s+operations.*healthcare|coo.*hospital)\b/i,
        /\b(revenue\s+cycle\s+manager|health\s+information\s+manager)\b/i,
      ],
      skillPatterns: [
        'healthcare administration', 'hospital operations', 'revenue cycle', 'billing',
        'ehr', 'epic', 'cerner', 'hipaa', 'cms', 'jcaho', 'accreditation',
        'patient satisfaction', 'staff scheduling', 'budgeting', 'compliance'
      ],
      contextPatterns: [
        /\b(managed|oversaw|directed)\s+.*\b(hospital|clinic|practice|facility)\b/i,
        /\b(improved|increased)\s+.*\b(patient\s+satisfaction|efficiency|revenue)\b/i,
        /\b(healthcare|hospital|clinical)\s+operations\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    clinical_research: {
      titlePatterns: [
        /\b(clinical\s+research\s+associate|cra|clinical\s+research\s+coordinator)\b/i,
        /\b(clinical\s+trial\s+manager|clinical\s+project\s+manager)\b/i,
        /\b(clinical\s+data\s+manager|clinical\s+scientist|medical\s+monitor)\b/i,
        /\b(regulatory\s+affairs\s+specialist|clinical\s+operations)\b/i,
      ],
      skillPatterns: [
        'clinical trials', 'gcp', 'ich', 'irb', 'protocol', 'informed consent',
        'ctms', 'edc', 'medidata', 'veeva', 'sae', 'adverse events',
        'site monitoring', 'crf', 'phase i', 'phase ii', 'phase iii', 'fda'
      ],
      contextPatterns: [
        /\b(managed|monitored|coordinated)\s+.*\b(trial|study|protocol)\b/i,
        /\b(phase\s+[iI123]+|clinical\s+trial|research\s+site)\b/i,
        /\b(gcp|ich|irb|regulatory\s+submission)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    physical_therapy: {
      titlePatterns: [
        /\b(physical\s+therapist|pt|physiotherapist)\b/i,
        /\b(occupational\s+therapist|ot|rehabilitation\s+specialist)\b/i,
        /\b(sports\s+medicine|athletic\s+trainer|rehab\s+director)\b/i,
        /\b(physical\s+therapy\s+assistant|pta)\b/i,
      ],
      skillPatterns: [
        'physical therapy', 'rehabilitation', 'manual therapy', 'exercise prescription',
        'orthopedic', 'neurological', 'geriatric', 'pediatric', 'sports medicine',
        'patient assessment', 'treatment planning', 'mobility', 'functional training'
      ],
      contextPatterns: [
        /\b(treated|rehabilitated|assessed)\s+.*\b(patient|client|injury)\b/i,
        /\b(improved|restored)\s+.*\b(mobility|function|range\s+of\s+motion)\b/i,
        /\b(physical\s+therapy|rehabilitation|orthopedic)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    radiology: {
      titlePatterns: [
        /\b(radiologist|radiology\s+technologist|radiologic\s+technician)\b/i,
        /\b(mri\s+technologist|ct\s+technologist|x[\s-]?ray\s+technician)\b/i,
        /\b(diagnostic\s+imaging|ultrasound\s+technologist|sonographer)\b/i,
        /\b(interventional\s+radiologist|nuclear\s+medicine)\b/i,
      ],
      skillPatterns: [
        'radiology', 'mri', 'ct', 'x-ray', 'ultrasound', 'mammography',
        'pacs', 'dicom', 'radiation safety', 'contrast', 'imaging',
        'fluoroscopy', 'nuclear medicine', 'pet scan', 'interventional'
      ],
      contextPatterns: [
        /\b(performed|interpreted|conducted)\s+.*\b(imaging|scan|x[\s-]?ray|mri|ct)\b/i,
        /\b(diagnostic\s+imaging|radiology\s+department)\b/i,
        /\b(pacs|dicom|radiation)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    
    // === EDUCATION SUB-INDUSTRIES ===
    k12_education: {
      titlePatterns: [
        /\b(teacher|elementary\s+teacher|high\s+school\s+teacher|middle\s+school)\b/i,
        /\b(principal|assistant\s+principal|school\s+administrator)\b/i,
        /\b(school\s+counselor|department\s+chair|instructional\s+coach)\b/i,
        /\b(special\s+education\s+teacher|reading\s+specialist)\b/i,
      ],
      skillPatterns: [
        'classroom management', 'lesson planning', 'curriculum', 'differentiated instruction',
        'assessment', 'grading', 'parent communication', 'state standards', 'common core',
        'iep', 'student engagement', 'behavior management', 'pbis'
      ],
      contextPatterns: [
        /\b(taught|instructed|educated)\s+.*\b(students?|class|grade)\b/i,
        /\b(improved|increased)\s+.*\b(test\s+scores?|student\s+achievement|graduation)\b/i,
        /\b(elementary|middle|high)\s+school\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    higher_education: {
      titlePatterns: [
        /\b(professor|associate\s+professor|assistant\s+professor|lecturer)\b/i,
        /\b(dean|provost|department\s+chair|academic\s+director)\b/i,
        /\b(research\s+professor|adjunct\s+professor|faculty)\b/i,
        /\b(academic\s+advisor|registrar|admissions\s+director)\b/i,
      ],
      skillPatterns: [
        'curriculum development', 'research', 'grant writing', 'peer review',
        'tenure', 'academic publishing', 'lecture', 'dissertation',
        'accreditation', 'student advising', 'academic program', 'higher education'
      ],
      contextPatterns: [
        /\b(taught|lectured|advised)\s+.*\b(undergraduate|graduate|students?)\b/i,
        /\b(published|researched|presented)\s+.*\b(journal|conference|paper)\b/i,
        /\b(university|college|academic)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    edtech: {
      titlePatterns: [
        /\b(instructional\s+designer|learning\s+experience\s+designer)\b/i,
        /\b(e[\s-]?learning\s+developer|educational\s+technologist)\b/i,
        /\b(lms\s+administrator|learning\s+management|training\s+developer)\b/i,
        /\b(curriculum\s+developer.*tech|learning\s+engineer)\b/i,
      ],
      skillPatterns: [
        'instructional design', 'lms', 'scorm', 'articulate', 'storyline', 'captivate',
        'e-learning', 'canvas', 'blackboard', 'moodle', 'learning management',
        'addie', 'sam', 'adult learning', 'online learning', 'video production'
      ],
      contextPatterns: [
        /\b(developed|designed|created)\s+.*\b(course|training|module|curriculum)\b/i,
        /\b(e[\s-]?learning|online\s+learning|learning\s+platform)\b/i,
        /\b(lms|scorm|instructional\s+design)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    curriculum_development: {
      titlePatterns: [
        /\b(curriculum\s+developer|curriculum\s+designer|curriculum\s+specialist)\b/i,
        /\b(curriculum\s+coordinator|curriculum\s+director|instructional\s+coordinator)\b/i,
        /\b(assessment\s+specialist|standards\s+specialist)\b/i,
      ],
      skillPatterns: [
        'curriculum development', 'curriculum design', 'learning objectives', 'assessment design',
        'standards alignment', 'backward design', 'scope and sequence', 'textbook',
        'educational content', 'pedagogical', 'bloom\'s taxonomy', 'rubrics'
      ],
      contextPatterns: [
        /\b(developed|designed|created)\s+.*\b(curriculum|standards|assessment)\b/i,
        /\b(aligned|mapped)\s+.*\b(standards|objectives|outcomes)\b/i,
        /\b(curriculum\s+framework|learning\s+outcomes)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    special_education: {
      titlePatterns: [
        /\b(special\s+education\s+teacher|sped\s+teacher|resource\s+teacher)\b/i,
        /\b(special\s+education\s+coordinator|inclusion\s+specialist)\b/i,
        /\b(behavior\s+specialist|autism\s+specialist|learning\s+specialist)\b/i,
        /\b(special\s+education\s+director|iep\s+coordinator)\b/i,
      ],
      skillPatterns: [
        'special education', 'iep', 'idea', '504 plan', 'behavior intervention',
        'differentiated instruction', 'autism', 'learning disabilities', 'adhd',
        'assistive technology', 'inclusion', 'aba', 'sensory', 'accommodation'
      ],
      contextPatterns: [
        /\b(developed|implemented|managed)\s+.*\b(iep|504|behavior\s+plan)\b/i,
        /\b(supported|taught|worked\s+with)\s+.*\b(special\s+needs|disabilities)\b/i,
        /\b(special\s+education|inclusion|learning\s+support)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    
    // === MANUFACTURING SUB-INDUSTRIES ===
    quality_engineering: {
      titlePatterns: [
        /\b(quality\s+engineer|quality\s+assurance\s+engineer|qa\s+engineer)\b/i,
        /\b(quality\s+manager|quality\s+director|quality\s+lead)\b/i,
        /\b(quality\s+control\s+engineer|qc\s+engineer|supplier\s+quality)\b/i,
        /\b(quality\s+systems\s+engineer|metrology\s+engineer)\b/i,
      ],
      skillPatterns: [
        'quality assurance', 'quality control', 'iso 9001', 'six sigma', 'spc',
        'fmea', 'ppap', 'apqp', 'root cause analysis', '8d', 'capa',
        'audit', 'inspection', 'gd&t', 'cmm', 'metrology', 'iatf 16949'
      ],
      contextPatterns: [
        /\b(reduced|improved)\s+.*\b(defects?|quality|scrap|yield)\b/i,
        /\b(implemented|managed)\s+.*\b(quality\s+system|audit|inspection)\b/i,
        /\b(iso|six\s+sigma|quality\s+assurance)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    process_engineering: {
      titlePatterns: [
        /\b(process\s+engineer|manufacturing\s+engineer|industrial\s+engineer)\b/i,
        /\b(process\s+improvement\s+engineer|continuous\s+improvement)\b/i,
        /\b(production\s+engineer|methods\s+engineer|process\s+specialist)\b/i,
      ],
      skillPatterns: [
        'process engineering', 'manufacturing engineering', 'industrial engineering',
        'time study', 'line balancing', 'capacity planning', 'lean', 'kaizen',
        'value stream mapping', 'work instructions', 'standard work', 'automation'
      ],
      contextPatterns: [
        /\b(improved|optimized|designed)\s+.*\b(process|line|workflow|manufacturing)\b/i,
        /\b(reduced|decreased)\s+.*\b(cycle\s+time|labor|cost|waste)\b/i,
        /\b(process\s+improvement|manufacturing\s+engineering)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    lean_manufacturing: {
      titlePatterns: [
        /\b(lean\s+engineer|lean\s+specialist|lean\s+manager)\b/i,
        /\b(continuous\s+improvement\s+manager|ci\s+manager|kaizen\s+leader)\b/i,
        /\b(six\s+sigma\s+black\s+belt|master\s+black\s+belt|green\s+belt)\b/i,
        /\b(operational\s+excellence|opex\s+manager)\b/i,
      ],
      skillPatterns: [
        'lean', 'six sigma', 'kaizen', '5s', 'value stream mapping', 'dmaic',
        'continuous improvement', 'waste reduction', 'tpm', 'kanban', 'poka-yoke',
        'black belt', 'green belt', 'root cause analysis', 'a3', 'pdca'
      ],
      contextPatterns: [
        /\b(implemented|led|facilitated)\s+.*\b(kaizen|lean|improvement)\b/i,
        /\b(reduced|eliminated)\s+.*\b(waste|defects?|downtime|cycle\s+time)\b/i,
        /\b(lean|six\s+sigma|continuous\s+improvement)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    supply_chain_manufacturing: {
      titlePatterns: [
        /\b(supply\s+chain\s+manager|procurement\s+manager|materials\s+manager)\b/i,
        /\b(supply\s+planner|demand\s+planner|production\s+planner)\b/i,
        /\b(buyer|purchasing\s+manager|sourcing\s+manager)\b/i,
        /\b(inventory\s+manager|materials\s+coordinator)\b/i,
      ],
      skillPatterns: [
        'supply chain', 'procurement', 'purchasing', 'mrp', 'erp', 'sap',
        'vendor management', 'supplier development', 'inventory management',
        'demand planning', 'production scheduling', 's&op', 'logistics', 'jit'
      ],
      contextPatterns: [
        /\b(managed|negotiated|sourced)\s+.*\b(supplier|vendor|material|component)\b/i,
        /\b(reduced|optimized)\s+.*\b(inventory|cost|lead\s+time)\b/i,
        /\b(supply\s+chain|procurement|purchasing)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    plant_management: {
      titlePatterns: [
        /\b(plant\s+manager|factory\s+manager|site\s+manager)\b/i,
        /\b(operations\s+manager|production\s+manager|manufacturing\s+manager)\b/i,
        /\b(general\s+manager.*manufacturing|vp\s+of\s+operations)\b/i,
        /\b(plant\s+director|site\s+director|facility\s+manager)\b/i,
      ],
      skillPatterns: [
        'plant management', 'operations management', 'production management',
        'p&l', 'budget', 'safety', 'osha', 'ehs', 'union', 'labor relations',
        'capacity planning', 'kpi', 'oee', 'downtime', 'maintenance'
      ],
      contextPatterns: [
        /\b(managed|led|directed)\s+.*\b(plant|factory|facility|site)\b/i,
        /\b(improved|increased)\s+.*\b(production|efficiency|output|oee)\b/i,
        /\b(plant\s+operations|manufacturing\s+operations)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    
    // === HR SUB-INDUSTRIES ===
    talent_acquisition: {
      titlePatterns: [
        /\b(recruiter|talent\s+acquisition|sourcer|recruiting\s+coordinator)\b/i,
        /\b(head\s+of\s+recruiting|ta\s+manager|recruitment\s+manager)\b/i,
        /\b(technical\s+recruiter|executive\s+recruiter|campus\s+recruiter)\b/i,
      ],
      skillPatterns: [
        'recruiting', 'sourcing', 'linkedin recruiter', 'ats', 'greenhouse', 'lever',
        'talent pipeline', 'candidate experience', 'employer branding', 'job posting',
        'interview coordination', 'offer negotiation', 'onboarding', 'hiring'
      ],
      contextPatterns: [
        /\b(recruited|hired|sourced)\s+.*\b(candidates?|talent|engineers?|employees?)\b/i,
        /\b(reduced|improved)\s+.*\b(time[\s-]to[\s-]fill|cost[\s-]per[\s-]hire|quality[\s-]of[\s-]hire)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    hr_business_partner: {
      titlePatterns: [
        /\b(hr\s+business\s+partner|hrbp|people\s+partner)\b/i,
        /\b(hr\s+manager|human\s+resources\s+manager|people\s+manager)\b/i,
        /\b(senior\s+hrbp|director.*hr|vp.*people)\b/i,
      ],
      skillPatterns: [
        'employee relations', 'performance management', 'workforce planning', 'hr strategy',
        'organizational development', 'change management', 'talent management', 'succession planning',
        'coaching', 'conflict resolution', 'policy development', 'labor relations'
      ],
      contextPatterns: [
        /\b(partnered|advised|supported)\s+.*\b(leadership|executives?|managers?|business)\b/i,
        /\b(implemented|developed)\s+.*\b(hr\s+strategy|people\s+strategy|initiative)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    compensation_benefits: {
      titlePatterns: [
        /\b(compensation\s+analyst|benefits\s+analyst|total\s+rewards)\b/i,
        /\b(compensation\s+manager|benefits\s+manager|rewards\s+manager)\b/i,
        /\b(comp\s+and\s+ben|c&b\s+manager|payroll\s+manager)\b/i,
      ],
      skillPatterns: [
        'compensation', 'benefits', 'total rewards', 'salary benchmarking', 'job evaluation',
        'pay equity', 'incentive design', 'equity compensation', 'workday', 'hris',
        'payroll', '401k', 'health insurance', 'wellness programs'
      ],
      contextPatterns: [
        /\b(designed|administered|managed)\s+.*\b(compensation|benefits|rewards|pay)\b/i,
        /\b(conducted|performed)\s+.*\b(benchmarking|analysis|survey)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    learning_development: {
      titlePatterns: [
        /\b(learning\s+and\s+development|l&d\s+manager|training\s+manager)\b/i,
        /\b(organizational\s+development|talent\s+development|training\s+specialist)\b/i,
        /\b(learning\s+designer|training\s+coordinator|leadership\s+development)\b/i,
      ],
      skillPatterns: [
        'training', 'learning and development', 'instructional design', 'facilitation',
        'leadership development', 'coaching', 'lms', 'e-learning', 'needs assessment',
        'curriculum development', 'performance consulting', 'talent development'
      ],
      contextPatterns: [
        /\b(designed|developed|delivered)\s+.*\b(training|program|curriculum|workshop)\b/i,
        /\b(improved|increased)\s+.*\b(engagement|performance|competency|skills)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    hr_operations: {
      titlePatterns: [
        /\b(hr\s+operations|people\s+operations|hr\s+analyst)\b/i,
        /\b(hris\s+analyst|workday\s+analyst|hr\s+systems)\b/i,
        /\b(hr\s+coordinator|hr\s+administrator|hr\s+generalist)\b/i,
      ],
      skillPatterns: [
        'hris', 'workday', 'successfactors', 'adp', 'hr analytics', 'people analytics',
        'employee data', 'hr reporting', 'onboarding', 'offboarding', 'compliance',
        'hr processes', 'employee lifecycle', 'hr metrics'
      ],
      contextPatterns: [
        /\b(managed|administered|maintained)\s+.*\b(hris|systems?|data|records)\b/i,
        /\b(streamlined|optimized|improved)\s+.*\b(process|operations|workflow)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 30
    },
    
    // === CONSULTING SUB-INDUSTRIES ===
    management_consulting: {
      titlePatterns: [
        /\b(management\s+consultant|business\s+consultant|consultant)\b/i,
        /\b(associate\s+consultant|senior\s+consultant|principal)\b/i,
        /\b(engagement\s+manager|project\s+leader|partner)\b/i,
      ],
      skillPatterns: [
        'consulting', 'stakeholder management', 'client engagement', 'problem solving',
        'business strategy', 'market analysis', 'competitive analysis', 'due diligence',
        'presentation', 'excel', 'powerpoint', 'project management'
      ],
      contextPatterns: [
        /\b(advised|consulted|supported)\s+.*\b(client|executive|c[\s-]?suite|leadership)\b/i,
        /\b(led|managed)\s+.*\b(engagement|project|workstream|initiative)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    strategy_consulting: {
      titlePatterns: [
        /\b(strategy\s+consultant|corporate\s+strategy|strategic\s+planning)\b/i,
        /\b(mckinsey|bain|bcg|big\s+three|mbb)\b/i,
        /\b(strategy\s+manager|director\s+of\s+strategy|vp\s+strategy)\b/i,
      ],
      skillPatterns: [
        'corporate strategy', 'business strategy', 'market entry', 'growth strategy',
        'm&a strategy', 'competitive strategy', 'strategic planning', 'scenario planning',
        'market sizing', 'financial modeling', 'business case', 'transformation'
      ],
      contextPatterns: [
        /\b(developed|defined|led)\s+.*\b(strategy|strategic\s+plan|roadmap)\b/i,
        /\b(advised|supported)\s+.*\b(ceo|board|executive|c[\s-]?suite)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    it_consulting: {
      titlePatterns: [
        /\b(it\s+consultant|technology\s+consultant|systems\s+consultant)\b/i,
        /\b(solutions\s+architect|enterprise\s+architect|technical\s+consultant)\b/i,
        /\b(implementation\s+consultant|erp\s+consultant|sap\s+consultant)\b/i,
      ],
      skillPatterns: [
        'it consulting', 'systems integration', 'erp implementation', 'sap', 'oracle',
        'digital transformation', 'cloud migration', 'enterprise architecture', 'agile',
        'project management', 'requirements gathering', 'solution design'
      ],
      contextPatterns: [
        /\b(implemented|deployed|designed)\s+.*\b(system|solution|platform|erp)\b/i,
        /\b(led|managed)\s+.*\b(implementation|migration|transformation)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    
    // === CREATIVE SUB-INDUSTRIES ===
    graphic_design: {
      titlePatterns: [
        /\b(graphic\s+designer|visual\s+designer|brand\s+designer)\b/i,
        /\b(senior\s+designer|design\s+lead|creative\s+designer)\b/i,
        /\b(print\s+designer|digital\s+designer|marketing\s+designer)\b/i,
      ],
      skillPatterns: [
        'photoshop', 'illustrator', 'indesign', 'figma', 'sketch', 'canva',
        'typography', 'layout', 'branding', 'logo design', 'print design',
        'packaging', 'visual identity', 'color theory', 'adobe creative suite'
      ],
      contextPatterns: [
        /\b(designed|created|developed)\s+.*\b(brand|logo|visual|marketing|collateral)\b/i,
        /\b(led|managed)\s+.*\b(design|creative|visual|branding)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    ux_design: {
      titlePatterns: [
        /\b(ux\s+designer|ui\s+designer|product\s+designer|interaction\s+designer)\b/i,
        /\b(ux\s+researcher|user\s+researcher|design\s+researcher)\b/i,
        /\b(ux\s+lead|head\s+of\s+design|design\s+director)\b/i,
      ],
      skillPatterns: [
        'ux design', 'ui design', 'user research', 'wireframing', 'prototyping',
        'figma', 'sketch', 'invision', 'user testing', 'usability', 'personas',
        'journey mapping', 'design systems', 'accessibility', 'interaction design'
      ],
      contextPatterns: [
        /\b(designed|created|led)\s+.*\b(user\s+experience|interface|product|app)\b/i,
        /\b(conducted|performed)\s+.*\b(user\s+research|usability\s+testing|interviews?)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    video_production: {
      titlePatterns: [
        /\b(video\s+producer|videographer|editor|film\s+editor)\b/i,
        /\b(motion\s+graphics|animator|creative\s+producer)\b/i,
        /\b(director\s+of\s+photography|cinematographer|post[\s-]production)\b/i,
      ],
      skillPatterns: [
        'premiere pro', 'after effects', 'final cut', 'davinci resolve', 'avid',
        'video editing', 'motion graphics', 'animation', 'color grading', 'sound design',
        'cinematography', 'storyboarding', 'directing', 'youtube', 'live streaming'
      ],
      contextPatterns: [
        /\b(produced|edited|created|directed)\s+.*\b(video|film|content|commercial)\b/i,
        /\b(managed|led)\s+.*\b(production|shoot|project|campaign)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    art_direction: {
      titlePatterns: [
        /\b(art\s+director|creative\s+director|associate\s+creative\s+director)\b/i,
        /\b(head\s+of\s+creative|chief\s+creative\s+officer|ecd)\b/i,
        /\b(senior\s+art\s+director|group\s+creative\s+director)\b/i,
      ],
      skillPatterns: [
        'art direction', 'creative direction', 'brand strategy', 'campaign development',
        'creative concept', 'visual storytelling', 'photography direction', 'team leadership',
        'agency experience', 'client presentation', 'creative brief', 'advertising'
      ],
      contextPatterns: [
        /\b(led|directed|managed)\s+.*\b(creative|campaign|visual|brand)\b/i,
        /\b(developed|created|concepted)\s+.*\b(campaign|concept|creative|advertising)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
    
    // === RETAIL SUB-INDUSTRIES ===
    store_management: {
      titlePatterns: [
        /\b(store\s+manager|retail\s+manager|assistant\s+store\s+manager)\b/i,
        /\b(district\s+manager|regional\s+manager|area\s+manager)\b/i,
        /\b(general\s+manager|operations\s+manager.*retail)\b/i,
      ],
      skillPatterns: [
        'store operations', 'retail management', 'inventory management', 'p&l',
        'sales targets', 'customer service', 'team leadership', 'scheduling',
        'visual merchandising', 'loss prevention', 'cash handling', 'pos systems'
      ],
      contextPatterns: [
        /\b(managed|led|supervised)\s+.*\b(store|team|staff|location)\b/i,
        /\b(achieved|exceeded)\s+.*\b(sales|revenue|targets?|quota)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    merchandising: {
      titlePatterns: [
        /\b(merchandiser|visual\s+merchandiser|merchandise\s+manager)\b/i,
        /\b(merchandise\s+planner|allocation\s+analyst|assortment\s+planner)\b/i,
        /\b(vmd|display\s+coordinator|field\s+merchandiser)\b/i,
      ],
      skillPatterns: [
        'visual merchandising', 'planogram', 'product placement', 'inventory allocation',
        'assortment planning', 'markdown optimization', 'space planning', 'fixture design',
        'retail analytics', 'trend analysis', 'seasonal planning', 'vendor management'
      ],
      contextPatterns: [
        /\b(developed|executed|managed)\s+.*\b(merchandising|display|planogram|assortment)\b/i,
        /\b(increased|improved)\s+.*\b(sales|conversion|productivity|turns)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    ecommerce: {
      titlePatterns: [
        /\b(ecommerce\s+manager|e[\s-]commerce\s+manager|online\s+retail)\b/i,
        /\b(digital\s+commerce|dtc\s+manager|marketplace\s+manager)\b/i,
        /\b(head\s+of\s+ecommerce|director\s+of\s+digital|vp\s+ecommerce)\b/i,
      ],
      skillPatterns: [
        'ecommerce', 'shopify', 'magento', 'woocommerce', 'amazon seller', 'marketplace',
        'conversion optimization', 'a/b testing', 'digital marketing', 'seo',
        'product catalog', 'inventory sync', 'order fulfillment', 'dropshipping'
      ],
      contextPatterns: [
        /\b(grew|scaled|managed)\s+.*\b(ecommerce|online|digital|dtc)\b/i,
        /\b(increased|improved)\s+.*\b(conversion|revenue|aov|traffic)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    
    // === HOSPITALITY SUB-INDUSTRIES ===
    hotel_management: {
      titlePatterns: [
        /\b(hotel\s+manager|general\s+manager|resident\s+manager)\b/i,
        /\b(front\s+office\s+manager|rooms\s+division|guest\s+services)\b/i,
        /\b(hotel\s+director|resort\s+manager|lodging\s+manager)\b/i,
      ],
      skillPatterns: [
        'hotel operations', 'revenue management', 'guest satisfaction', 'opera pms',
        'front desk', 'housekeeping', 'reservations', 'occupancy', 'adr', 'revpar',
        'guest relations', 'brand standards', 'star rating', 'hospitality management'
      ],
      contextPatterns: [
        /\b(managed|directed|led)\s+.*\b(hotel|property|resort|rooms)\b/i,
        /\b(improved|increased)\s+.*\b(occupancy|revpar|satisfaction|rating)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    food_beverage: {
      titlePatterns: [
        /\b(f&b\s+manager|food\s+and\s+beverage|restaurant\s+manager)\b/i,
        /\b(executive\s+chef|chef|sous\s+chef|culinary\s+director)\b/i,
        /\b(bar\s+manager|beverage\s+director|sommelier)\b/i,
      ],
      skillPatterns: [
        'food service', 'restaurant management', 'culinary', 'menu development',
        'food cost', 'labor cost', 'inventory', 'servesafe', 'pos systems',
        'wine', 'beverage', 'banquet', 'catering', 'fine dining'
      ],
      contextPatterns: [
        /\b(managed|led|directed)\s+.*\b(restaurant|kitchen|f&b|dining)\b/i,
        /\b(reduced|improved)\s+.*\b(food\s+cost|labor|service|reviews?)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    event_management: {
      titlePatterns: [
        /\b(event\s+manager|event\s+planner|event\s+coordinator)\b/i,
        /\b(catering\s+manager|banquet\s+manager|conference\s+manager)\b/i,
        /\b(wedding\s+planner|meeting\s+planner|corporate\s+events)\b/i,
      ],
      skillPatterns: [
        'event planning', 'event management', 'catering', 'banquet', 'conference',
        'vendor management', 'budget management', 'logistics', 'cvent', 'eventbrite',
        'contract negotiation', 'floor plans', 'av', 'decor', 'timeline management'
      ],
      contextPatterns: [
        /\b(planned|coordinated|managed)\s+.*\b(event|wedding|conference|meeting)\b/i,
        /\b(executed|delivered)\s+.*\b(event|experience|function)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    
    // === GOVERNMENT SUB-INDUSTRIES ===
    policy_analysis: {
      titlePatterns: [
        /\b(policy\s+analyst|policy\s+advisor|policy\s+specialist)\b/i,
        /\b(legislative\s+analyst|research\s+analyst.*policy|think\s+tank)\b/i,
        /\b(policy\s+director|director\s+of\s+policy|policy\s+manager)\b/i,
      ],
      skillPatterns: [
        'policy analysis', 'policy research', 'legislative analysis', 'regulatory',
        'public policy', 'policy development', 'stakeholder engagement', 'briefings',
        'white papers', 'testimony', 'impact assessment', 'cost-benefit analysis'
      ],
      contextPatterns: [
        /\b(developed|analyzed|drafted)\s+.*\b(policy|legislation|regulation|brief)\b/i,
        /\b(advised|briefed|supported)\s+.*\b(policymakers?|legislators?|leadership)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    public_administration: {
      titlePatterns: [
        /\b(city\s+manager|town\s+manager|county\s+administrator)\b/i,
        /\b(public\s+administrator|government\s+administrator|agency\s+director)\b/i,
        /\b(department\s+head|division\s+director|bureau\s+chief)\b/i,
      ],
      skillPatterns: [
        'public administration', 'government operations', 'budget management', 'procurement',
        'municipal', 'constituent services', 'public meetings', 'intergovernmental',
        'grants management', 'public finance', 'civil service', 'emergency management'
      ],
      contextPatterns: [
        /\b(managed|directed|administered)\s+.*\b(department|agency|division|office)\b/i,
        /\b(government|public|municipal|county|state|federal)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    military: {
      titlePatterns: [
        /\b(military|veteran|army|navy|air\s+force|marines|coast\s+guard)\b/i,
        /\b(officer|enlisted|nco|warrant\s+officer|commander)\b/i,
        /\b(sergeant|captain|lieutenant|major|colonel)\b/i,
      ],
      skillPatterns: [
        'military', 'leadership', 'mission planning', 'operations', 'logistics',
        'security clearance', 'classified', 'combat', 'training', 'tactics',
        'personnel management', 'equipment maintenance', 'communications'
      ],
      contextPatterns: [
        /\b(served|deployed|commanded|led)\s+.*\b(unit|team|mission|operations)\b/i,
        /\b(military|army|navy|air\s+force|marines|armed\s+forces)\b/i,
      ],
      minSkillsForHigh: 2,
      titleWeight: 45
    },
    law_enforcement: {
      titlePatterns: [
        /\b(police\s+officer|detective|special\s+agent|investigator)\b/i,
        /\b(sergeant|lieutenant|captain|chief\s+of\s+police)\b/i,
        /\b(fbi|dea|atf|marshal|corrections\s+officer)\b/i,
      ],
      skillPatterns: [
        'law enforcement', 'investigation', 'criminal justice', 'patrol',
        'evidence collection', 'report writing', 'arrest procedures', 'firearms',
        'de-escalation', 'community policing', 'surveillance', 'interviewing'
      ],
      contextPatterns: [
        /\b(investigated|arrested|patrolled|enforced)\b/i,
        /\b(police|law\s+enforcement|criminal|detective|federal)\b/i,
      ],
      minSkillsForHigh: 2,
      titleWeight: 45
    },
    
    // === NONPROFIT SUB-INDUSTRIES ===
    fundraising: {
      titlePatterns: [
        /\b(development\s+director|fundraiser|major\s+gifts|donor\s+relations)\b/i,
        /\b(chief\s+development|vp\s+development|annual\s+fund)\b/i,
        /\b(capital\s+campaign|planned\s+giving|advancement)\b/i,
      ],
      skillPatterns: [
        'fundraising', 'donor relations', 'major gifts', 'grant writing', 'stewardship',
        'raiser\'s edge', 'salesforce nonprofit', 'cultivation', 'solicitation',
        'capital campaign', 'annual fund', 'planned giving', 'events'
      ],
      contextPatterns: [
        /\b(raised|secured|cultivated)\s+.*\$[\d,]+[kKmMbB]?\b/i,
        /\b(managed|grew|developed)\s+.*\b(donor|portfolio|relationships?)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    program_management_nonprofit: {
      titlePatterns: [
        /\b(program\s+director|program\s+manager|program\s+coordinator)\b/i,
        /\b(director\s+of\s+programs|vp\s+programs|impact\s+director)\b/i,
        /\b(community\s+program|youth\s+program|outreach\s+director)\b/i,
      ],
      skillPatterns: [
        'program management', 'program evaluation', 'impact measurement', 'logic model',
        'grant management', 'community outreach', 'stakeholder engagement', 'partnerships',
        'case management', 'client services', 'data collection', 'reporting'
      ],
      contextPatterns: [
        /\b(managed|led|directed)\s+.*\b(program|initiative|project|services?)\b/i,
        /\b(served|impacted|supported)\s+.*\b(clients?|community|population|beneficiaries)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    advocacy: {
      titlePatterns: [
        /\b(advocacy\s+director|policy\s+advocate|campaign\s+director)\b/i,
        /\b(government\s+relations|public\s+affairs|lobbyist)\b/i,
        /\b(grassroots|organizing\s+director|community\s+organizer)\b/i,
      ],
      skillPatterns: [
        'advocacy', 'lobbying', 'government relations', 'grassroots organizing',
        'coalition building', 'public affairs', 'campaign strategy', 'mobilization',
        'legislative affairs', 'public speaking', 'media relations', 'messaging'
      ],
      contextPatterns: [
        /\b(advocated|lobbied|organized|mobilized)\b/i,
        /\b(passed|influenced|shaped)\s+.*\b(legislation|policy|bill|law)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    grant_writing: {
      titlePatterns: [
        /\b(grant\s+writer|proposal\s+writer|grants\s+manager)\b/i,
        /\b(grants\s+coordinator|foundation\s+relations|grants\s+specialist)\b/i,
        /\b(director\s+of\s+grants|grants\s+director)\b/i,
      ],
      skillPatterns: [
        'grant writing', 'proposal writing', 'grant management', 'foundation relations',
        'rfp', 'budget development', 'grant reporting', 'compliance', 'research',
        'federal grants', 'foundation grants', 'corporate grants', 'fluxx'
      ],
      contextPatterns: [
        /\b(wrote|secured|submitted)\s+.*\b(grant|proposal|funding)\b/i,
        /\b(awarded|received)\s+.*\$[\d,]+[kKmMbB]?\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    
    // === EMERGING ROLES ===
    ai_ml: {
      titlePatterns: [
        /\b(machine\s+learning\s+engineer|ml\s+engineer|ai\s+engineer)\b/i,
        /\b(deep\s+learning|nlp\s+engineer|computer\s+vision)\b/i,
        /\b(ai\s+researcher|ml\s+scientist|applied\s+scientist)\b/i,
      ],
      skillPatterns: [
        'machine learning', 'deep learning', 'tensorflow', 'pytorch', 'keras',
        'nlp', 'computer vision', 'neural networks', 'transformers', 'llm',
        'gpt', 'bert', 'reinforcement learning', 'mlops', 'model deployment'
      ],
      contextPatterns: [
        /\b(built|trained|deployed)\s+.*\b(model|algorithm|pipeline|system)\b/i,
        /\b(improved|achieved)\s+.*\b(accuracy|performance|f1|auc)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
    blockchain: {
      titlePatterns: [
        /\b(blockchain\s+developer|web3\s+developer|smart\s+contract)\b/i,
        /\b(crypto|solidity\s+developer|defi\s+engineer)\b/i,
        /\b(blockchain\s+architect|protocol\s+engineer)\b/i,
      ],
      skillPatterns: [
        'blockchain', 'solidity', 'web3', 'ethereum', 'smart contracts', 'defi',
        'nft', 'cryptocurrency', 'consensus', 'hardhat', 'truffle', 'metamask',
        'tokenomics', 'dao', 'layer 2', 'polygon', 'rust'
      ],
      contextPatterns: [
        /\b(developed|built|deployed)\s+.*\b(smart\s+contract|dapp|protocol|token)\b/i,
        /\b(web3|blockchain|crypto|defi|nft)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    cloud_engineering: {
      titlePatterns: [
        /\b(cloud\s+engineer|cloud\s+architect|solutions\s+architect)\b/i,
        /\b(aws\s+engineer|azure\s+engineer|gcp\s+engineer)\b/i,
        /\b(cloud\s+infrastructure|cloud\s+platform|cloud\s+security)\b/i,
      ],
      skillPatterns: [
        'aws', 'azure', 'gcp', 'cloud architecture', 'serverless', 'lambda',
        'ec2', 's3', 'cloudformation', 'terraform', 'kubernetes', 'docker',
        'vpc', 'iam', 'cloud security', 'cost optimization', 'multi-cloud'
      ],
      contextPatterns: [
        /\b(designed|architected|migrated)\s+.*\b(cloud|aws|azure|gcp|infrastructure)\b/i,
        /\b(reduced|optimized)\s+.*\b(cost|latency|availability|performance)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    sustainability: {
      titlePatterns: [
        /\b(sustainability\s+manager|esg\s+manager|sustainability\s+director)\b/i,
        /\b(climate|environmental\s+manager|carbon\s+analyst)\b/i,
        /\b(chief\s+sustainability|cso|head\s+of\s+esg)\b/i,
      ],
      skillPatterns: [
        'sustainability', 'esg', 'environmental', 'carbon footprint', 'climate',
        'renewable energy', 'circular economy', 'ghg', 'net zero', 'life cycle assessment',
        'sustainability reporting', 'gri', 'cdp', 'science-based targets', 'b corp'
      ],
      contextPatterns: [
        /\b(reduced|achieved|implemented)\s+.*\b(carbon|emissions?|sustainability|environmental)\b/i,
        /\b(esg|sustainability|climate|environmental)\s+\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    dei: {
      titlePatterns: [
        /\b(dei\s+manager|diversity\s+manager|inclusion\s+manager)\b/i,
        /\b(chief\s+diversity|head\s+of\s+dei|vp\s+diversity)\b/i,
        /\b(belonging|equity\s+officer|d&i\s+director)\b/i,
      ],
      skillPatterns: [
        'diversity', 'equity', 'inclusion', 'belonging', 'dei strategy',
        'unconscious bias', 'erg', 'employee resource groups', 'culture',
        'hiring practices', 'pay equity', 'training', 'metrics', 'representation'
      ],
      contextPatterns: [
        /\b(led|developed|implemented)\s+.*\b(dei|diversity|inclusion|equity)\b/i,
        /\b(improved|increased)\s+.*\b(diversity|representation|belonging|culture)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 40
    },
    remote_work: {
      titlePatterns: [
        /\b(remote\s+work|head\s+of\s+remote|distributed\s+work)\b/i,
        /\b(workplace\s+experience|future\s+of\s+work)\b/i,
        /\b(hybrid\s+work|virtual\s+collaboration)\b/i,
      ],
      skillPatterns: [
        'remote work', 'distributed teams', 'async communication', 'virtual collaboration',
        'zoom', 'slack', 'notion', 'remote culture', 'time zone management',
        'digital workplace', 'employee experience', 'hybrid work', 'flexibility'
      ],
      contextPatterns: [
        /\b(built|led|managed)\s+.*\b(remote|distributed|virtual)\s+\b/i,
        /\b(remote[\s-]first|fully\s+remote|hybrid)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 30
    },
    creator_economy: {
      titlePatterns: [
        /\b(content\s+creator|influencer|youtuber|streamer)\b/i,
        /\b(creator\s+manager|influencer\s+marketing|talent\s+manager)\b/i,
        /\b(podcaster|social\s+media\s+personality)\b/i,
      ],
      skillPatterns: [
        'content creation', 'youtube', 'tiktok', 'instagram', 'twitch', 'podcast',
        'video production', 'audience growth', 'monetization', 'brand partnerships',
        'community building', 'personal branding', 'analytics', 'engagement'
      ],
      contextPatterns: [
        /\b(grew|built)\s+.*\b(audience|followers?|subscribers?|community)\b/i,
        /\b(content|influencer|creator|youtube|tiktok|podcast)\b/i,
      ],
      minSkillsForHigh: 2,
      titleWeight: 30
    },
    
    // === EXISTING BROAD INDUSTRIES (for fallback) ===
    retail: {
      titlePatterns: [
        /\b(store\s+manager|retail\s+manager|district\s+manager)\b/,
        /\b(sales\s+associate|cashier|merchandiser|visual\s+merchandiser)\b/,
        /\b(buyer|category\s+manager|e[\s-]?commerce\s+manager)\b/,
      ],
      skillPatterns: [
        'pos', 'inventory management', 'visual merchandising', 'customer service',
        'loss prevention', 'planogram', 'shopify', 'retail analytics',
        'vendor relations', 'supply chain', 'omnichannel', 'store operations'
      ],
      contextPatterns: [
        /\b(increased|exceeded|achieved)\s+.*\b(sales|revenue|targets?)\b/i,
        /\b(managed|supervised)\s+.*\b(store|team|staff)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 30
    },
    hospitality: {
      titlePatterns: [
        /\b(hotel\s+manager|general\s+manager|front\s+desk\s+manager)\b/,
        /\b(chef|executive\s+chef|sous\s+chef|restaurant\s+manager)\b/,
        /\b(concierge|event\s+coordinator|catering\s+manager)\b/,
      ],
      skillPatterns: [
        'guest relations', 'hotel operations', 'food service', 'banquet',
        'opera pms', 'micros', 'reservations', 'event planning',
        'hospitality management', 'servesafe', 'revenue management'
      ],
      contextPatterns: [
        /\b(managed|supervised)\s+.*\b(hotel|restaurant|property|venue)\b/i,
        /\b(improved|increased)\s+.*\b(guest\s+satisfaction|occupancy|revenue)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 30
    },
    manufacturing: {
      titlePatterns: [
        /\b(plant\s+manager|manufacturing\s+manager|production\s+manager)\b/,
        /\b(operations\s+manager|quality\s+manager|maintenance\s+manager)\b/,
        /\b(production\s+supervisor|line\s+supervisor|shift\s+supervisor)\b/,
      ],
      skillPatterns: [
        'lean manufacturing', 'six sigma', 'kaizen', '5s', 'tpm', 'oee',
        'erp', 'sap', 'mrp', 'kanban', 'jit', 'iso 9001', 'iatf 16949',
        'cnc', 'plc', 'automation', 'quality control', 'spc'
      ],
      contextPatterns: [
        /\b(reduced|improved|increased)\s+.*\b(defects?|efficiency|throughput|oee)\b/i,
        /\b(managed|oversaw|led)\s+.*\b(plant|production|manufacturing|operations)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 35
    },
    construction: {
      titlePatterns: [
        /\b(construction\s+manager|project\s+manager|site\s+manager)\b/,
        /\b(superintendent|foreman|contractor|general\s+contractor)\b/,
        /\b(estimator|construction\s+estimator|quantity\s+surveyor)\b/,
      ],
      skillPatterns: [
        'project management', 'scheduling', 'primavera', 'procore', 'bluebeam',
        'estimating', 'budgeting', 'osha', 'safety', 'subcontractor management',
        'blueprints', 'permits', 'inspection', 'leed', 'bim'
      ],
      contextPatterns: [
        /\b(managed|completed|oversaw)\s+.*\$[\d,]+[kKmM]?\s*(project|construction|budget)/i,
        /\b(supervised|coordinated)\s+.*\b(construction|site|project|team)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    government: {
      titlePatterns: [
        /\b(program\s+analyst|policy\s+analyst|government\s+affairs)\b/,
        /\b(public\s+administrator|city\s+manager|government\s+contractor)\b/,
        /\b(federal\s+employee|civil\s+servant|public\s+servant)\b/,
      ],
      skillPatterns: [
        'policy analysis', 'grant writing', 'federal acquisition', 'far',
        'public administration', 'regulatory compliance', 'legislation',
        'constituent services', 'budget management', 'procurement'
      ],
      contextPatterns: [
        /\b(federal|state|municipal|county|city)\s+(government|agency|department)\b/i,
        /\b(administered|managed|developed)\s+.*\b(program|policy|initiative)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 30
    },
    nonprofit: {
      titlePatterns: [
        /\b(executive\s+director|program\s+director|development\s+director)\b/,
        /\b(fundraiser|grant\s+writer|volunteer\s+coordinator)\b/,
        /\b(program\s+manager|community\s+outreach|advocacy)\b/,
      ],
      skillPatterns: [
        'fundraising', 'grant writing', 'donor relations', 'volunteer management',
        'community outreach', 'program evaluation', 'nonprofit management',
        'salesforce nonprofit', 'raiser\'s edge', 'board relations', 'advocacy'
      ],
      contextPatterns: [
        /\b(raised|secured)\s+.*\$[\d,]+[kKmMbB]?\s*(funding|grants?|donations?)/i,
        /\b(managed|coordinated)\s+.*\b(program|volunteers?|campaign)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 30
    },
    logistics: {
      titlePatterns: [
        /\b(logistics\s+manager|supply\s+chain\s+manager|warehouse\s+manager)\b/,
        /\b(distribution\s+manager|transportation\s+manager|fleet\s+manager)\b/,
        /\b(inventory\s+manager|procurement\s+manager|operations\s+manager)\b/,
      ],
      skillPatterns: [
        'supply chain', 'logistics', 'inventory management', 'wms', 'tms',
        'erp', 'sap', 'procurement', 'vendor management', 'freight',
        '3pl', 'distribution', 'warehousing', 'route optimization'
      ],
      contextPatterns: [
        /\b(reduced|improved|optimized)\s+.*\b(costs?|delivery|efficiency|inventory)\b/i,
        /\b(managed|oversaw)\s+.*\b(warehouse|distribution|logistics|supply\s+chain)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 30
    },
    real_estate: {
      titlePatterns: [
        /\b(real\s+estate\s+agent|realtor|broker|property\s+manager)\b/,
        /\b(real\s+estate\s+developer|acquisitions\s+analyst|asset\s+manager)\b/,
        /\b(leasing\s+manager|commercial\s+real\s+estate)\b/,
      ],
      skillPatterns: [
        'mls', 'property valuation', 'market analysis', 'negotiation',
        'lease administration', 'property management', 'tenant relations',
        'commercial real estate', 'residential', 'argus', 'yardi'
      ],
      contextPatterns: [
        /\b(closed|sold|leased)\s+.*\$[\d,]+[kKmMbB]?\s*(property|deal|transaction)/i,
        /\b(managed|marketed)\s+.*\b(properties|portfolio|listings?)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 30
    },
    energy: {
      titlePatterns: [
        /\b(petroleum\s+engineer|drilling\s+engineer|reservoir\s+engineer)\b/,
        /\b(power\s+systems\s+engineer|renewable\s+energy|solar\s+engineer)\b/,
        /\b(energy\s+analyst|utility\s+manager|energy\s+consultant)\b/,
      ],
      skillPatterns: [
        'oil and gas', 'drilling', 'reservoir', 'production', 'refinery',
        'solar', 'wind', 'renewable energy', 'power generation', 'grid',
        'ferc', 'nerc', 'energy efficiency', 'sustainability'
      ],
      contextPatterns: [
        /\b(managed|operated)\s+.*\b(well|plant|facility|field)\b/i,
        /\b(reduced|improved|optimized)\s+.*\b(production|efficiency|output)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    
    // === EXISTING BROAD INDUSTRIES (for fallback) ===
    technology: {
      titlePatterns: [
        /\b(software\s+engineer|developer|data\s+scientist|devops)\b/,
        /\b(tech\s+lead|engineering\s+manager|cto)\b/,
      ],
      skillPatterns: [
        'javascript', 'python', 'react', 'aws', 'docker', 'kubernetes',
        'machine learning', 'sql', 'git'
      ],
      contextPatterns: [
        /\b(engineering|development)\s+team\b/i,
      ],
      minSkillsForHigh: 3
    },
    sales: {
      titlePatterns: [
        /\b(account\s+executive|sales\s+rep|sales\s+manager|bdr|sdr)\b/,
        /\b(sales\s+director|vp\s+of\s+sales|cro)\b/,
      ],
      skillPatterns: [
        'salesforce', 'hubspot', 'crm', 'quota', 'pipeline', 'prospecting',
        'closing', 'negotiation', 'revenue'
      ],
      contextPatterns: [
        /\b(closed|exceeded|achieved)\s+.*\b(quota|target)\b/i,
      ],
      minSkillsForHigh: 3
    },
    marketing: {
      titlePatterns: [
        /\b(marketing\s+manager|digital\s+marketing|content\s+marketing)\b/,
        /\b(brand\s+manager|growth\s+marketing|cmo)\b/,
      ],
      skillPatterns: [
        'seo', 'sem', 'ppc', 'google analytics', 'content strategy',
        'marketing automation', 'campaign management'
      ],
      contextPatterns: [
        /\b(increased|grew)\s+.*\b(traffic|conversions?|engagement)\b/i,
      ],
      minSkillsForHigh: 3
    },
    finance: {
      titlePatterns: [
        /\b(financial\s+analyst|accountant|cfo|controller)\b/,
        /\b(investment\s+analyst|portfolio\s+manager)\b/,
      ],
      skillPatterns: [
        'financial modeling', 'excel', 'gaap', 'budgeting', 'valuation'
      ],
      contextPatterns: [
        /\b(managed|prepared)\s+.*\b(budget|financial)\b/i,
      ],
      minSkillsForHigh: 3
    },
    healthcare: {
      titlePatterns: [
        /\b(nurse|physician|doctor|pharmacist)\b/,
        /\b(healthcare\s+administrator|clinical\s+director)\b/,
      ],
      skillPatterns: [
        'hipaa', 'ehr', 'epic', 'cerner', 'patient care', 'clinical'
      ],
      contextPatterns: [
        /\b(patient|clinical|medical|hospital)\b/i,
      ],
      minSkillsForHigh: 3
    },
    consulting: {
      titlePatterns: [
        /\b(consultant|strategy|management\s+consultant)\b/,
      ],
      skillPatterns: [
        'strategy', 'stakeholder management', 'client engagement',
        'project management', 'change management'
      ],
      contextPatterns: [
        /\b(advised|consulted)\s+.*\b(client|executive)\b/i,
      ],
      minSkillsForHigh: 3
    },
    hr: {
      titlePatterns: [
        /\b(hr\s+manager|recruiter|talent\s+acquisition)\b/,
        /\b(people\s+operations|chro)\b/,
      ],
      skillPatterns: [
        'talent acquisition', 'hris', 'workday', 'recruiting', 'onboarding',
        'performance management', 'compensation', 'shrm'
      ],
      contextPatterns: [
        /\b(hired|recruited)\s+.*\b(employees?|candidates?)\b/i,
      ],
      minSkillsForHigh: 3
    },
    engineering: {
      titlePatterns: [
        /\b(mechanical\s+engineer|electrical\s+engineer|civil\s+engineer)\b/,
        /\b(pe|professional\s+engineer)\b/,
      ],
      skillPatterns: [
        'cad', 'autocad', 'solidworks', 'ansys', 'manufacturing', 'iso'
      ],
      contextPatterns: [
        /\b(designed|engineered)\s+.*\b(system|product|component)\b/i,
      ],
      minSkillsForHigh: 3
    },
    legal: {
      titlePatterns: [
        /\b(attorney|lawyer|counsel|paralegal)\b/,
        /\b(general\s+counsel|clo)\b/,
      ],
      skillPatterns: [
        'legal research', 'contract review', 'litigation', 'compliance',
        'westlaw', 'lexisnexis'
      ],
      contextPatterns: [
        /\b(drafted|negotiated|reviewed)\s+.*\b(contract|agreement)\b/i,
      ],
      minSkillsForHigh: 3
    },
    education: {
      titlePatterns: [
        /\b(teacher|professor|instructor|principal)\b/,
      ],
      skillPatterns: [
        'curriculum', 'lesson planning', 'classroom management',
        'lms', 'canvas', 'student engagement'
      ],
      contextPatterns: [
        /\b(taught|instructed)\s+.*\b(course|curriculum|lesson)\b/i,
      ],
      minSkillsForHigh: 3
    },
    creative: {
      titlePatterns: [
        /\b(graphic\s+designer|ux\s+designer|art\s+director)\b/,
        /\b(creative\s+director|copywriter)\b/,
      ],
      skillPatterns: [
        'figma', 'sketch', 'adobe', 'photoshop', 'illustrator',
        'branding', 'visual design'
      ],
      contextPatterns: [
        /\b(designed|created)\s+.*\b(design|brand|visual)\b/i,
      ],
      minSkillsForHigh: 3
    },
    
    // === HYBRID INDUSTRIES (Cross-domain roles) ===
    healthcare_it: {
      titlePatterns: [
        /\b(health\s+informatics|clinical\s+informatics|health\s+it)\b/i,
        /\b(ehr\s+specialist|ehr\s+analyst|ehr\s+implementation)\b/i,
        /\b(clinical\s+systems\s+analyst|healthcare\s+technology|health\s+information)\b/i,
        /\b(him\s+specialist|him\s+director|medical\s+informatics)\b/i,
        /\b(epic\s+analyst|cerner\s+analyst|meditech\s+specialist)\b/i,
      ],
      skillPatterns: [
        'epic', 'cerner', 'meditech', 'ehr', 'emr', 'hl7', 'fhir', 'hipaa',
        'health informatics', 'clinical informatics', 'interoperability',
        'healthcare analytics', 'phi', 'meaningful use', 'icd-10', 'cpt',
        'allscripts', 'athenahealth', 'nextgen', 'eclinicalworks',
        'sql', 'python', 'data analytics', 'tableau', 'power bi'
      ],
      contextPatterns: [
        /\b(implemented|deployed|migrated|optimized)\s+.*\b(ehr|emr|epic|cerner|clinical\s+system)\b/i,
        /\b(hospital|clinic|healthcare|clinical)\s+.*\b(system|technology|data|integration)\b/i,
        /\b(trained|supported)\s+.*\b(clinical\s+staff|nurses?|physicians?)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50 // High weight to prioritize hybrid detection
    },
    fintech: {
      titlePatterns: [
        /\b(fintech|financial\s+technology)\b/i,
        /\b(payments?\s+engineer|payments?\s+product)\b/i,
        /\b(stripe|square|paypal|braintree|adyen)\b/i,
        /\b(banking\s+engineer|neo\s*bank|digital\s+banking)\b/i,
        /\b(crypto|blockchain|defi)\s+.*\b(engineer|developer|product)\b/i,
      ],
      skillPatterns: [
        'payments', 'payment processing', 'stripe', 'square', 'paypal', 'plaid',
        'pci dss', 'pci compliance', 'banking api', 'open banking',
        'lending', 'credit scoring', 'fraud detection', 'kyc', 'aml',
        'trading systems', 'fintech', 'neobank', 'challenger bank',
        'crypto', 'blockchain', 'smart contracts', 'defi', 'web3'
      ],
      contextPatterns: [
        /\b(payment|transaction|financial|banking)\s+.*\b(system|platform|api|integration)\b/i,
        /\b(processed|handled)\s+.*\$[\d,]+[mMbB]?\s*(volume|transactions?)/i,
        /\b(reduced|improved)\s+.*\b(fraud|conversion|processing)/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 50
    },
    // Note: edtech already defined in education sub-industries above
    legaltech: {
      titlePatterns: [
        /\b(legal\s+tech|legal\s+technology|legaltech)\b/i,
        /\b(e[\s-]?discovery|ediscovery)\b/i,
        /\b(legal\s+operations|legal\s+ops)\b/i,
        /\b(contract\s+automation|clm)\b/i,
      ],
      skillPatterns: [
        'e-discovery', 'ediscovery', 'relativity', 'concordance', 'nuix',
        'contract management', 'clm', 'docusign', 'ironclad', 'agiloft',
        'legal analytics', 'legal ai', 'document automation', 'legal workflows',
        'westlaw', 'lexisnexis', 'practice management', 'clio', 'litify'
      ],
      contextPatterns: [
        /\b(implemented|deployed|managed)\s+.*\b(legal\s+technology|e[\s-]?discovery|clm)\b/i,
        /\b(automated|streamlined)\s+.*\b(legal|contract|document|workflow)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
    hrtech: {
      titlePatterns: [
        /\b(hr\s+tech|hrtech|hr\s+technology)\b/i,
        /\b(hris\s+analyst|hris\s+manager|hris\s+administrator)\b/i,
        /\b(people\s+analytics|workforce\s+analytics)\b/i,
        /\b(workday|successfactors|oracle\s+hcm)\s+.*\b(consultant|specialist|analyst)\b/i,
      ],
      skillPatterns: [
        'workday', 'successfactors', 'oracle hcm', 'adp', 'ultipro', 'ceridian',
        'hris', 'hcm', 'people analytics', 'workforce analytics', 'hr data',
        'bamboohr', 'namely', 'paylocity', 'greenhouse', 'lever', 'icims',
        'hr automation', 'onboarding systems', 'performance management systems'
      ],
      contextPatterns: [
        /\b(implemented|configured|managed)\s+.*\b(hris|hcm|workday|hr\s+system)\b/i,
        /\b(analyzed|reported)\s+.*\b(hr\s+data|workforce|employee|people)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
    proptech: {
      titlePatterns: [
        /\b(proptech|property\s+tech|real\s+estate\s+tech)\b/i,
        /\b(real\s+estate\s+technology|property\s+technology)\b/i,
        /\b(contech|construction\s+tech)\b/i,
      ],
      skillPatterns: [
        'proptech', 'yardi', 'appfolio', 'buildium', 'realpage', 'mri software',
        'zillow', 'redfin', 'procore', 'plangrid', 'bluebeam',
        'smart building', 'iot', 'building automation', 'facility management',
        'costar', 'argus', 'real estate analytics'
      ],
      contextPatterns: [
        /\b(developed|implemented)\s+.*\b(property|real\s+estate|building)\s+.*\b(tech|platform|system)\b/i,
        /\b(managed|optimized)\s+.*\b(property|portfolio|building)\s+.*\b(data|analytics|technology)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
    insurtech: {
      titlePatterns: [
        /\b(insurtech|insurance\s+tech|insurance\s+technology)\b/i,
        /\b(claims?\s+automation|underwriting\s+automation)\b/i,
        /\b(insurance\s+analytics|actuarial\s+tech)\b/i,
      ],
      skillPatterns: [
        'insurtech', 'claims management', 'policy administration', 'underwriting',
        'guidewire', 'duck creek', 'majesco', 'insurance analytics',
        'actuarial', 'risk modeling', 'telematics', 'usage-based insurance',
        'claims automation', 'digital insurance', 'insurance platform'
      ],
      contextPatterns: [
        /\b(developed|implemented)\s+.*\b(insurance|claims?|underwriting|policy)\s+.*\b(system|platform|automation)\b/i,
        /\b(modernized|transformed)\s+.*\b(insurance|claims?|policy)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
    govtech: {
      titlePatterns: [
        /\b(govtech|government\s+tech|civic\s+tech)\b/i,
        /\b(digital\s+government|digital\s+transformation.*government)\b/i,
        /\b(public\s+sector.*technology|government.*technology)\b/i,
      ],
      skillPatterns: [
        'govtech', 'civic tech', 'digital government', 'e-government',
        'fedramp', 'fisma', 'nist', 'government cloud', 'aws govcloud',
        'citizen services', 'government digital services', 'usds', '18f',
        'open data', 'transparency', 'government modernization'
      ],
      contextPatterns: [
        /\b(modernized|transformed|digitized)\s+.*\b(government|public\s+sector|agency|citizen)\b/i,
        /\b(implemented|deployed)\s+.*\b(federal|state|municipal|government)\s+.*\b(system|platform|service)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
    // === NEW HYBRID INDUSTRIES ===
    agtech: {
      titlePatterns: [
        /\b(agtech|ag[\s-]?tech|agricultural\s+technology)\b/i,
        /\b(precision\s+agriculture|smart\s+farming|farm\s+tech)\b/i,
        /\b(agriculture.*(?:engineer|developer|product|manager))\b/i,
        /\b((?:engineer|developer|product|manager).*agriculture)\b/i,
      ],
      skillPatterns: [
        'precision agriculture', 'smart farming', 'iot sensors', 'drone technology',
        'crop monitoring', 'soil analysis', 'farm management software', 'agribusiness',
        'john deere', 'climate corporation', 'granular', 'farmers edge',
        'livestock management', 'vertical farming', 'hydroponics', 'yield optimization',
        'satellite imagery', 'remote sensing', 'agricultural data', 'farm automation'
      ],
      contextPatterns: [
        /\b(developed|implemented)\s+.*\b(farm|agriculture|crop|livestock)\s+.*\b(tech|platform|system|automation)\b/i,
        /\b(improved|optimized)\s+.*\b(yield|harvest|crop|farming)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 50
    },
    cleantech: {
      titlePatterns: [
        /\b(cleantech|clean[\s-]?tech|climate[\s-]?tech)\b/i,
        /\b(sustainability.*(?:engineer|manager|director))\b/i,
        /\b(renewable\s+energy.*(?:engineer|developer|manager))\b/i,
        /\b(clean\s+energy|green\s+technology)\b/i,
      ],
      skillPatterns: [
        'renewable energy', 'solar', 'wind', 'battery storage', 'ev charging',
        'carbon capture', 'carbon neutral', 'net zero', 'sustainability',
        'esg', 'environmental', 'circular economy', 'waste reduction',
        'smart grid', 'energy management', 'building efficiency', 'leed',
        'clean energy', 'greenhouse gas', 'decarbonization', 'climate'
      ],
      contextPatterns: [
        /\b(developed|implemented)\s+.*\b(clean|renewable|sustainable|green)\s+.*\b(energy|solution|technology)\b/i,
        /\b(reduced|eliminated)\s+.*\b(carbon|emissions|waste|footprint)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 50
    },
    martech: {
      titlePatterns: [
        /\b(martech|marketing[\s-]?tech|marketing\s+technology)\b/i,
        /\b(marketing\s+operations|marketing\s+automation)\b/i,
        /\b(marketing\s+platform|customer\s+data\s+platform)\b/i,
        /\b(cdp|marketing\s+engineer)\b/i,
      ],
      skillPatterns: [
        'marketing automation', 'hubspot', 'marketo', 'pardot', 'eloqua',
        'salesforce marketing cloud', 'customer data platform', 'cdp', 'segment',
        'braze', 'iterable', 'klaviyo', 'mailchimp', 'customer journey',
        'marketing analytics', 'attribution', 'mta', 'marketing mix',
        'campaign management', 'lead scoring', 'marketing ops', 'mar ops'
      ],
      contextPatterns: [
        /\b(implemented|managed)\s+.*\b(marketing|automation|campaign|customer)\s+.*\b(platform|system|tool|stack)\b/i,
        /\b(built|developed)\s+.*\b(marketing|customer)\s+.*\b(integration|pipeline|workflow)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 50
    },
    adtech: {
      titlePatterns: [
        /\b(adtech|ad[\s-]?tech|advertising\s+technology)\b/i,
        /\b(programmatic|dsp|ssp|demand[\s-]?side|supply[\s-]?side)\b/i,
        /\b(ad\s+operations|ad\s+ops|advertising\s+operations)\b/i,
        /\b((?:rtb|real[\s-]?time\s+bidding))\b/i,
      ],
      skillPatterns: [
        'programmatic advertising', 'dsp', 'ssp', 'rtb', 'real-time bidding',
        'google ads', 'dv360', 'the trade desk', 'xandr', 'amazon dsp',
        'ad exchange', 'header bidding', 'prebid', 'ad server', 'dfp',
        'viewability', 'brand safety', 'fraud detection', 'attribution',
        'cookies', 'identity', 'audience targeting', 'data management platform', 'dmp'
      ],
      contextPatterns: [
        /\b(managed|optimized)\s+.*\b(ad|advertising|programmatic|campaign)\s+.*\b(spend|budget|performance)\b/i,
        /\b(built|developed)\s+.*\b(ad|advertising|bidding)\s+.*\b(platform|system|algorithm)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 50
    },
    retailtech: {
      titlePatterns: [
        /\b(retailtech|retail[\s-]?tech|retail\s+technology)\b/i,
        /\b(ecommerce.*(?:engineer|developer|platform))\b/i,
        /\b((?:engineer|developer).*ecommerce)\b/i,
        /\b(pos\s+system|point\s+of\s+sale.*tech)\b/i,
      ],
      skillPatterns: [
        'shopify', 'magento', 'bigcommerce', 'woocommerce', 'salesforce commerce',
        'pos systems', 'inventory management', 'omnichannel', 'unified commerce',
        'order management', 'fulfillment', 'warehouse management', 'rfid',
        'customer experience', 'personalization', 'recommendation engine',
        'retail analytics', 'store technology', 'self-checkout', 'mobile commerce'
      ],
      contextPatterns: [
        /\b(built|developed|implemented)\s+.*\b(ecommerce|retail|store|commerce)\s+.*\b(platform|system|solution)\b/i,
        /\b(increased|improved)\s+.*\b(conversion|sales|aov|customer)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
    traveltech: {
      titlePatterns: [
        /\b(traveltech|travel[\s-]?tech|travel\s+technology)\b/i,
        /\b(hospitality.*technology|booking.*(?:engineer|platform))\b/i,
        /\b(ota|online\s+travel\s+agency)\b/i,
        /\b((?:amadeus|sabre|travelport).*(?:engineer|developer|consultant))\b/i,
      ],
      skillPatterns: [
        'gds', 'amadeus', 'sabre', 'travelport', 'booking engine',
        'hotel distribution', 'channel manager', 'pms', 'property management',
        'revenue management', 'dynamic pricing', 'inventory allocation',
        'travel booking', 'flight booking', 'hotel booking', 'ota',
        'metasearch', 'travel api', 'travel aggregation', 'guest experience'
      ],
      contextPatterns: [
        /\b(built|developed|implemented)\s+.*\b(travel|booking|hospitality|hotel)\s+.*\b(platform|system|solution)\b/i,
        /\b(managed|optimized)\s+.*\b(booking|reservation|distribution|inventory)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
    sporttech: {
      titlePatterns: [
        /\b(sporttech|sport[\s-]?tech|sports\s+technology)\b/i,
        /\b(fitness[\s-]?tech|athletic\s+technology)\b/i,
        /\b(sports\s+analytics|performance\s+tracking)\b/i,
        /\b((?:peloton|whoop|strava|garmin).*(?:engineer|product|developer))\b/i,
      ],
      skillPatterns: [
        'sports analytics', 'performance tracking', 'wearables', 'fitness tracking',
        'peloton', 'whoop', 'strava', 'garmin', 'fitbit', 'oura',
        'player tracking', 'biomechanics', 'video analysis', 'coaching software',
        'fantasy sports', 'sports betting', 'esports', 'stadium technology',
        'fan engagement', 'ticketing technology', 'broadcasting tech'
      ],
      contextPatterns: [
        /\b(built|developed)\s+.*\b(sports?|fitness|athletic|performance)\s+.*\b(platform|app|system|technology)\b/i,
        /\b(tracked|analyzed|optimized)\s+.*\b(performance|athlete|player|team)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
    foodtech: {
      titlePatterns: [
        /\b(foodtech|food[\s-]?tech|food\s+technology)\b/i,
        /\b(restaurant.*technology|ghost\s+kitchen)\b/i,
        /\b(food\s+delivery.*(?:engineer|platform|tech))\b/i,
        /\b((?:doordash|uber\s+eats|grubhub|instacart).*(?:engineer|product|developer))\b/i,
      ],
      skillPatterns: [
        'food delivery', 'ghost kitchen', 'cloud kitchen', 'dark kitchen',
        'restaurant technology', 'pos restaurant', 'kitchen display system',
        'doordash', 'uber eats', 'grubhub', 'instacart', 'postmates',
        'menu management', 'food ordering', 'delivery optimization',
        'food safety tech', 'supply chain food', 'meal kit', 'food automation'
      ],
      contextPatterns: [
        /\b(built|developed|launched)\s+.*\b(food|restaurant|delivery|kitchen)\s+.*\b(platform|system|app|service)\b/i,
        /\b(optimized|improved)\s+.*\b(delivery|ordering|kitchen|menu)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
    biotech: {
      titlePatterns: [
        /\b(biotech|biotechnology|bio[\s-]?tech)\b/i,
        /\b(bioinformatics|computational\s+biology)\b/i,
        /\b(life\s+sciences.*(?:engineer|scientist|developer))\b/i,
        /\b(genomics|proteomics|drug\s+discovery)\b/i,
      ],
      skillPatterns: [
        'bioinformatics', 'genomics', 'proteomics', 'drug discovery', 'drug development',
        'clinical trials', 'fda', 'regulatory affairs', 'gmp', 'glp',
        'crispr', 'gene therapy', 'cell therapy', 'immunotherapy',
        'molecular biology', 'biochemistry', 'biomarkers', 'sequencing',
        'python', 'r', 'machine learning', 'data science', 'lab automation'
      ],
      contextPatterns: [
        /\b(developed|discovered|researched)\s+.*\b(drug|therapy|treatment|compound)\b/i,
        /\b(analyzed|sequenced|studied)\s+.*\b(genome|gene|protein|dna|rna)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 50
    },
    medtech: {
      titlePatterns: [
        /\b(medtech|med[\s-]?tech|medical\s+technology)\b/i,
        /\b(medical\s+device.*(?:engineer|designer|developer))\b/i,
        /\b(biomedical\s+engineer|clinical\s+engineer)\b/i,
        /\b((?:engineer|developer).*medical\s+device)\b/i,
      ],
      skillPatterns: [
        'medical devices', 'fda 510k', 'fda approval', 'ce marking', 'iso 13485',
        'design controls', 'risk management', 'iec 62304', 'validation',
        'embedded systems', 'firmware', 'medical imaging', 'diagnostic',
        'wearable medical', 'remote patient monitoring', 'telehealth technology',
        'surgical robotics', 'prosthetics', 'implants', 'sterilization'
      ],
      contextPatterns: [
        /\b(designed|developed|launched)\s+.*\b(medical\s+device|diagnostic|implant|surgical)\b/i,
        /\b(obtained|achieved)\s+.*\b(fda|ce|510k|clearance|approval)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 50
    },
    wealthtech: {
      titlePatterns: [
        /\b(wealthtech|wealth[\s-]?tech|wealth\s+technology)\b/i,
        /\b(robo[\s-]?advisor|digital\s+wealth)\b/i,
        /\b(investment.*technology|trading\s+platform)\b/i,
        /\b((?:betterment|wealthfront|robinhood|schwab).*(?:engineer|developer|product))\b/i,
      ],
      skillPatterns: [
        'robo-advisor', 'digital wealth', 'investment platform', 'trading platform',
        'portfolio management', 'wealth management', 'financial planning software',
        'betterment', 'wealthfront', 'robinhood', 'personal capital',
        'rebalancing', 'tax-loss harvesting', 'financial api', 'plaid',
        'securities', 'brokerage', 'custody', 'clearing', 'sec compliance'
      ],
      contextPatterns: [
        /\b(built|developed)\s+.*\b(investment|wealth|trading|portfolio)\s+.*\b(platform|system|algorithm)\b/i,
        /\b(managed|processed)\s+.*\$[\d,]+[mMbB]\s*(aum|assets|trades)/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 50
    },
    supplychain_tech: {
      titlePatterns: [
        /\b(supply\s+chain.*technology|logistics[\s-]?tech|freight[\s-]?tech)\b/i,
        /\b(supply\s+chain.*(?:engineer|developer|platform))\b/i,
        /\b((?:flexport|project44|fourkites).*(?:engineer|developer|product))\b/i,
        /\b(warehouse\s+management\s+system|wms\s+engineer)\b/i,
      ],
      skillPatterns: [
        'supply chain', 'logistics', 'warehouse management', 'wms', 'tms',
        'transportation management', 'fleet management', 'route optimization',
        'inventory optimization', 'demand forecasting', 'erp', 'sap', 'oracle scm',
        'flexport', 'project44', 'fourkites', 'shippo', 'easypost',
        'tracking', 'visibility', 'freight', 'last mile', 'fulfillment'
      ],
      contextPatterns: [
        /\b(built|developed|implemented)\s+.*\b(supply\s+chain|logistics|warehouse|shipping)\s+.*\b(platform|system|solution)\b/i,
        /\b(optimized|reduced)\s+.*\b(shipping|delivery|inventory|fulfillment)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
    constructech: {
      titlePatterns: [
        /\b(constructech|construc?tion[\s-]?tech|construction\s+technology)\b/i,
        /\b(construction.*(?:software|platform|technology))\b/i,
        /\b(bim.*(?:manager|specialist|engineer))\b/i,
        /\b((?:procore|autodesk|plangrid).*(?:engineer|developer|specialist))\b/i,
      ],
      skillPatterns: [
        'construction software', 'bim', 'building information modeling', 'revit',
        'procore', 'plangrid', 'bluebeam', 'autodesk', 'primavera',
        'project management', 'scheduling', 'cost estimation', 'takeoff',
        'field management', 'safety software', 'drone inspection', 'reality capture',
        'prefab', 'modular construction', 'digital twin', 'construction analytics'
      ],
      contextPatterns: [
        /\b(implemented|deployed|managed)\s+.*\b(construction|project|field|site)\s+.*\b(software|technology|platform)\b/i,
        /\b(digitized|modernized|transformed)\s+.*\b(construction|building|project)\s+.*\b(process|workflow)\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 45
    },
  };
  
  // Score each industry with detailed tracking
  const industryScores: { 
    industry: string; 
    score: number; 
    signals: string[]; 
    matchedTitles: string[];
    matchedSkillCount: number;
    matchedContext: boolean;
  }[] = [];
  
  for (const [industry, patterns] of Object.entries(industryPatterns)) {
    let score = 0;
    const industrySignals: string[] = [];
    const matchedTitles: string[] = [];
    let matchedSkillCount = 0;
    let matchedContext = false;
    const titleWeight = patterns.titleWeight || 30;
    const skillWeight = patterns.skillWeight || 5;
    
    // Check title patterns (high weight)
    for (const pattern of patterns.titlePatterns) {
      const match = text.match(pattern);
      if (match) {
        score += titleWeight;
        industrySignals.push(`Title: "${match[0]}"`);
        matchedTitles.push(match[0]);
      }
    }
    
    // Check skills (medium weight)
    const foundSkills = patterns.skillPatterns.filter(skill => {
      // Check for exact word boundary match
      const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(text);
    });
    score += foundSkills.length * skillWeight;
    matchedSkillCount = foundSkills.length;
    if (foundSkills.length > 0) {
      industrySignals.push(`Skills: ${foundSkills.slice(0, 5).join(', ')}`);
    }
    
    // Check context patterns (medium weight)
    for (const pattern of patterns.contextPatterns) {
      if (pattern.test(text)) {
        score += 10;
        industrySignals.push(`Context match`);
        matchedContext = true;
        break; // Only count once
      }
    }
    
    if (score > 0) {
      industryScores.push({ 
        industry, 
        score, 
        signals: industrySignals,
        matchedTitles,
        matchedSkillCount,
        matchedContext
      });
    }
  }
  
  // Sort by score descending
  industryScores.sort((a, b) => b.score - a.score);
  
  console.log(`[INDUSTRY-DETECT] Top 5 scores: ${JSON.stringify(industryScores.slice(0, 5).map(s => ({ industry: s.industry, score: s.score })))}`);
  
  if (industryScores.length === 0) {
    // Fallback to keyword density scoring when no patterns match
    console.log(`[INDUSTRY-DETECT] No pattern matches, using keyword density fallback`);
    const densityFallback = getBestIndustryFromDensity(keywordDensityScores);
    if (densityFallback) {
      console.log(`[INDUSTRY-DETECT] Keyword density fallback: ${densityFallback.industry} (density: ${densityFallback.score})`);
      return { 
        industry: densityFallback.industry, 
        confidence: 'low', 
        signals: [`Keyword density: ${densityFallback.industry} (${densityFallback.score} keywords)`], 
        score: densityFallback.score,
        detectionSource: 'server_low',
        alternativeIndustries: densityFallback.alternatives,
        matchedTitlePatterns: [],
        matchedSkillCount: 0,
        matchedContextPatterns: false
      };
    }
    
    // Absolute fallback - should rarely happen
    return { 
      industry: 'general', 
      confidence: 'low', 
      signals: ['No clear industry signals detected - requires AI'], 
      score: 0,
      detectionSource: 'server_low',
      alternativeIndustries: [],
      matchedTitlePatterns: [],
      matchedSkillCount: 0,
      matchedContextPatterns: false
    };
  }
  
  const topIndustry = industryScores[0];
  const secondIndustry = industryScores[1];
  
  // Enhanced confidence scoring
  let confidence: 'high' | 'medium' | 'low';
  const scoreDifferential = secondIndustry ? topIndustry.score / secondIndustry.score : 10;
  
  if (topIndustry.score >= 60 && scoreDifferential >= 1.5) {
    confidence = 'high';
  } else if (topIndustry.score >= 40 && scoreDifferential >= 1.3) {
    confidence = 'medium';
  } else if (topIndustry.score >= 25) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }
  
  // Determine parent industry for sub-industries
  const parentIndustry = INDUSTRY_PARENTS[topIndustry.industry];
  const isSubIndustry = !!parentIndustry;
  
  console.log(`[INDUSTRY-DETECT] Result: ${topIndustry.industry}${parentIndustry ? ` (parent: ${parentIndustry})` : ''} (confidence: ${confidence}, score: ${topIndustry.score})`);
  console.log(`[INDUSTRY-DETECT] Signals: ${topIndustry.signals.join('; ')}`);
  
  return {
    industry: isSubIndustry ? topIndustry.industry : topIndustry.industry,
    subIndustry: isSubIndustry ? topIndustry.industry : undefined,
    parentIndustry: parentIndustry,
    confidence,
    signals: topIndustry.signals,
    score: topIndustry.score,
    detectionSource: `server_${confidence}` as 'server_high' | 'server_medium' | 'server_low',
    alternativeIndustries: industryScores.slice(1, 4).map(s => ({ industry: s.industry, score: s.score })),
    matchedTitlePatterns: topIndustry.matchedTitles,
    matchedSkillCount: topIndustry.matchedSkillCount,
    matchedContextPatterns: topIndustry.matchedContext
  };
}

// ==================== CAREER CHANGER DETECTION ====================
/**
 * Detect if resume shows a career transition and identify the current/target role
 * Returns the most recent industry if a career change is detected
 */
interface CareerTransitionInfo {
  isCareerChanger: boolean;
  currentIndustry?: string;
  previousIndustry?: string;
  transitionSignals: string[];
  confidenceScore?: number;
  confidence?: 'high' | 'medium' | 'low';
}

function detectCareerTransition(resumeText: string): CareerTransitionInfo {
  const text = resumeText.toLowerCase();
  const signals: string[] = [];
  let confidenceBoost = 0;
  
  // ==================== IMPROVEMENT 1: RECENCY WEIGHTING ====================
  // Extract year from date ranges and boost recent years (2023-2025)
  const recentYearPattern = /\b(202[3-5])\s*[-–—]\s*(present|current|now|202[4-5])?/gi;
  const recentYearMatches = text.match(recentYearPattern);
  const hasRecentDates = recentYearMatches && recentYearMatches.length > 0;
  if (hasRecentDates) {
    confidenceBoost += 15;
    signals.push(`Recent role dates detected (${recentYearMatches?.length} matches) - 2x weight applied`);
  }
  
  // ==================== IMPROVEMENT 2: PORTFOLIO/URL DETECTION ====================
  // Detect portfolio URLs that indicate target industry
  const portfolioPatterns: [RegExp, string, number][] = [
    // Design portfolios
    [/\b(behance\.net|dribbble\.com|portfolio\.(io|me|design)|\.design\/|uxfolio\.(me|com)|figma\.com\/@|notion\.so\/.*portfolio)/i, 'ux_design', 25],
    [/\bportfolio[\s.:]+\S*\.(io|me|design|com)/i, 'ux_design', 20],
    [/\b(sarahdesigns|janedesigns|designportfolio|uxportfolio|myuxwork)\.(io|me|com)/i, 'ux_design', 25],
    
    // Tech portfolios
    [/\b(github\.com|gitlab\.com|codepen\.io|replit\.com|stackblitz\.com)/i, 'software_engineering', 20],
    [/\bgithub\.com\/[a-z0-9_-]+/i, 'software_engineering', 25],
    
    // Data portfolios
    [/\b(kaggle\.com|tableau\.public\.com|datastudio)/i, 'data_science', 20],
    
    // Marketing portfolios
    [/\b(medium\.com\/@|substack\.com|wordpress\.com)/i, 'content_marketing', 15],
  ];
  
  for (const [pattern, industry, boost] of portfolioPatterns) {
    if (pattern.test(text)) {
      confidenceBoost += boost;
      signals.push(`Portfolio/URL signal detected: ${industry} (+${boost} confidence)`);
    }
  }
  
  // ==================== IMPROVEMENT 3: SECTION HEADER CONTEXT ====================
  // Detect section headers that negate skills for career changers
  const previousCareerSections = [
    /\n\s*(previous\s+career|prior\s+experience|former\s+career|earlier\s+career|past\s+experience|background)\s*\n/i,
    /\n\s*(teaching\s+experience|education\s+experience|nursing\s+experience)\s*\n/i,
    /\n\s*(before\s+transition|pre-career\s+change)\s*\n/i,
  ];
  
  let hasPreviousCareerSection = false;
  for (const pattern of previousCareerSections) {
    if (pattern.test(resumeText)) {
      hasPreviousCareerSection = true;
      confidenceBoost += 20;
      signals.push('Previous career section header detected - negating old industry signals');
      break;
    }
  }
  
  // ==================== IMPROVEMENT 4: EDUCATION RECENCY ====================
  // Weight recent education (2023-2025) much higher than old degrees
  const recentEducationPatterns: [RegExp, number][] = [
    // 2024-2025 bootcamps/certs = very strong signal
    [/\b(202[4-5])[^\n]*?(bootcamp|certificate|certification|immersive|intensive)/i, 40],
    [/\b(bootcamp|certificate|certification)[^\n]*?(202[4-5])/i, 40],
    // 2023 = strong signal
    [/\b(2023)[^\n]*?(bootcamp|certificate|certification)/i, 30],
    [/\b(bootcamp|certificate|certification)[^\n]*?(2023)/i, 30],
    // Recent program names = strong signal
    [/\b(google|meta|coursera|udacity|general\s+assembly|flatiron|springboard|careerfoundry|thinkful|ironhack)[^\n]*?202[3-5]/i, 35],
    [/\b202[3-5][^\n]*?(google|meta|coursera|udacity|general\s+assembly|flatiron|springboard|careerfoundry|thinkful|ironhack)/i, 35],
  ];
  
  let recentEducationBoost = 0;
  for (const [pattern, boost] of recentEducationPatterns) {
    if (pattern.test(text)) {
      recentEducationBoost = Math.max(recentEducationBoost, boost);
    }
  }
  if (recentEducationBoost > 0) {
    confidenceBoost += recentEducationBoost;
    signals.push(`Recent career-change education (2023-2025) detected - 3x weight applied (+${recentEducationBoost})`);
  }
  
  // Old degrees should NOT count against current direction
  const oldDegreePattern = /\b(20[01]\d|199\d)[^\n]*?(master|bachelor|b\.?a\.?|b\.?s\.?|m\.?a\.?|m\.?s\.?|m\.?ed|phd)/i;
  const hasOldDegree = oldDegreePattern.test(text);
  if (hasOldDegree && recentEducationBoost > 0) {
    signals.push('Old degree detected but outweighed by recent career-change education');
  }
  
  // ==================== IMPROVEMENT 5: MORE TRANSITION PHRASES ====================
  // Extended list of career transition phrases
  const transitionPhrases = [
    /career\s+(transition|change|pivot|switch|shift)/i,
    /transitioning\s+(from|to|into)/i,
    /former\s+(teacher|nurse|lawyer|banker|engineer|manager|accountant|doctor|military)/i,
    /pivoting\s+(to|into|from)/i,
    /career\s+changer/i,
    /making\s+a\s+career\s+(change|transition|move)/i,
    /changing\s+careers?/i,
    /aspiring\s+(developer|designer|analyst|engineer|pm|product\s+manager|data\s+scientist)/i,
    /seeking\s+to\s+transition/i,
    /pursuing\s+a\s+(new\s+)?career\s+in/i,
    /new\s+career\s+path/i,
    /retraining\s+(as|for|in)/i,
    /upskilling\s+(to|into|for)/i,
    /breaking\s+into\s+(tech|design|data|product)/i,
    /launching\s+(my|a)\s+career\s+in/i,
    /embarking\s+on\s+a\s+new\s+career/i,
    /switched\s+from\s+\w+\s+to/i,
    /moved\s+from\s+\w+\s+to\s+(tech|design|data)/i,
    /left\s+(teaching|nursing|law|banking)\s+to/i,
    /combining\s+.*background\s+with/i,
    /leveraging\s+.*experience\s+(in|for|to)/i,
  ];
  
  let transitionPhraseCount = 0;
  for (const phrase of transitionPhrases) {
    if (phrase.test(text)) {
      transitionPhraseCount++;
      if (transitionPhraseCount === 1) {
        signals.push('Explicit career transition language detected');
      }
    }
  }
  if (transitionPhraseCount > 1) {
    confidenceBoost += 10 * (transitionPhraseCount - 1);
    signals.push(`Multiple transition phrases detected (${transitionPhraseCount})`);
  }
  
  // NEGATIVE SIGNALS: Identify "former/previous" role mentions
  const negativePatterns: [RegExp, string][] = [
    [/\b(former|previous|ex[\s-]?)(teacher|educator|instructor)/i, 'education'],
    [/\b(former|previous|ex[\s-]?)(nurse|nursing|rn|lpn)/i, 'nursing'],
    [/\b(former|previous|ex[\s-]?)(attorney|lawyer|legal)/i, 'legal'],
    [/\b(former|previous|ex[\s-]?)(banker|finance|financial\s+analyst)/i, 'finance'],
    [/\b(former|previous|ex[\s-]?)(engineer|engineering)/i, 'engineering'],
    [/\b(former|previous|ex[\s-]?)(manager|management)/i, 'management'],
    [/\b(former|previous|ex[\s-]?)(accountant|accounting|cpa)/i, 'accounting'],
    [/\b(former|previous|ex[\s-]?)(doctor|physician|md)/i, 'physician'],
    [/\b(former|previous|ex[\s-]?)(military|army|navy|marine|air\s+force)/i, 'military'],
    [/\b(former|previous|ex[\s-]?)(sales|salesperson|account\s+exec)/i, 'sales'],
    [/\b(former|previous|ex[\s-]?)(retail|store\s+manager)/i, 'retail'],
    [/\b(left|leaving|transitioned?\s+from)\s+(teaching|nursing|law|banking|finance|sales|retail)/i, 'career_change'],
  ];
  
  const previousIndustries: string[] = [];
  for (const [pattern, industry] of negativePatterns) {
    if (pattern.test(text)) {
      previousIndustries.push(industry);
      signals.push(`Former role detected: ${industry}`);
    }
  }
  
  // Check for recent job titles that differ significantly from older ones
  // Look at "Present" or "Current" roles - these are MOST IMPORTANT
  const currentRoleMatch = text.match(/(present|current|now|\b202[4-5]\s*[-–—]\s*(present|current|now)?)/i);
  
  // ENHANCED: Look for current/target roles with higher specificity and recency boost
  // Scores now include recency multiplier
  const baseRecencyMultiplier = hasRecentDates ? 1.5 : 1.0;
  const recentRolePatterns: [RegExp, string, number][] = [
    // UX/Product Design - very common career change target
    [/\b(ux\s+designer?|user\s+experience\s+designer?|ui\/ux\s+designer?|product\s+designer?)/i, 'ux_design', 55],
    [/\b(ux\s+design|ui\s+design|product\s+design)\s+(intern|associate|junior|apprentice|fellow)/i, 'ux_design', 65],
    [/\bbootcamp\b.*\b(ux|design)/i, 'ux_design', 50],
    [/\b(ux|ui|product\s+design)\s+(bootcamp|certificate|certification)/i, 'ux_design', 60],
    [/\bfreelance\s+(ux|ui|product)?\s*designer/i, 'ux_design', 55],
    
    // Software Engineering
    [/\b(software|web|full[\s-]?stack|frontend|backend)\s+(developer|engineer)/i, 'software_engineering', 55],
    [/\b(software|web|app)\s+(developer|engineer)\s+(intern|associate|junior|apprentice)/i, 'software_engineering', 65],
    [/\bbootcamp\b.*\b(coding|developer|engineer|software|web)/i, 'software_engineering', 50],
    [/\b(coding|software|web\s+development)\s+(bootcamp|certificate)/i, 'software_engineering', 60],
    [/\bfreelance\s+(software|web)?\s*(developer|engineer)/i, 'software_engineering', 55],
    
    // Data Science/Analytics
    [/\b(data\s+scientist|data\s+analyst|business\s+analyst)/i, 'data_science', 55],
    [/\b(data\s+analyst|data\s+scientist)\s+(intern|associate|junior|apprentice)/i, 'data_science', 65],
    [/\bbootcamp\b.*\b(data|analytics)/i, 'data_science', 50],
    [/\b(data\s+science|data\s+analytics)\s+(bootcamp|certificate)/i, 'data_science', 60],
    
    // Product Management
    [/\b(product\s+manager|associate\s+product\s+manager|apm)/i, 'product_management', 55],
    [/\b(product\s+manager|pm)\s+(intern|associate|junior|apprentice)/i, 'product_management', 65],
    [/\b(product\s+management)\s+(bootcamp|certificate|program)/i, 'product_management', 60],
    
    // Digital Marketing (common for career changers)
    [/\b(digital\s+marketing|seo|social\s+media\s+marketing)/i, 'digital_marketing', 50],
    [/\b(digital\s+marketing|marketing)\s+(bootcamp|certificate)/i, 'digital_marketing', 55],
    
    // Cybersecurity
    [/\b(cybersecurity|security\s+analyst|information\s+security)/i, 'cybersecurity', 55],
    [/\b(cybersecurity|infosec)\s+(bootcamp|certificate|certification)/i, 'cybersecurity', 60],
    
    // General tech fallback
    [/\bintern\b.*\b(tech|startup|technology)/i, 'technology', 40],
  ];
  
  // If we find career transition signals OR current role markers, identify what they're transitioning TO
  if (signals.length > 0 || currentRoleMatch || confidenceBoost > 20) {
    let bestMatch: { industry: string; score: number } | null = null;
    
    for (const [pattern, industry, baseScore] of recentRolePatterns) {
      if (pattern.test(text)) {
        // Apply recency multiplier and confidence boost
        const adjustedScore = Math.round(baseScore * baseRecencyMultiplier) + confidenceBoost;
        if (!bestMatch || adjustedScore > bestMatch.score) {
          bestMatch = { industry, score: adjustedScore };
        }
      }
    }
    
    if (bestMatch) {
      // ==================== IMPROVEMENT 5 CONTINUED: CONFIDENCE THRESHOLDS ====================
      // Determine confidence level based on total score
      let confidence: 'high' | 'medium' | 'low' = 'medium';
      if (bestMatch.score >= 80) {
        confidence = 'high';
        signals.push(`High confidence career changer (score: ${bestMatch.score})`);
      } else if (bestMatch.score >= 50) {
        confidence = 'medium';
      } else {
        confidence = 'low';
      }
      
      signals.push(`Current/target role detected: ${bestMatch.industry} (score: ${bestMatch.score})`);
      return {
        isCareerChanger: true,
        currentIndustry: bestMatch.industry,
        previousIndustry: previousIndustries[0],
        transitionSignals: signals,
        confidenceScore: bestMatch.score,
        confidence
      };
    }
  }
  
  // Even if no current role found, if we detected "former" signals, mark as career changer
  if (previousIndustries.length > 0 && signals.length > 0) {
    return {
      isCareerChanger: true,
      previousIndustry: previousIndustries[0],
      transitionSignals: signals
    };
  }
  
  return {
    isCareerChanger: signals.length > 0,
    transitionSignals: signals
  };
}

/**
 * Hybrid detection: combines server-side detection with AI suggestion
 * Uses AI as fallback when server confidence is low
 * Now also handles career changers and hybrid industries
 */
function hybridIndustryDetection(
  serverResult: IndustryDetectionResult, 
  aiSuggested: string | undefined,
  resumeText?: string
): IndustryDetectionResult {
  const normalizedAI = normalizeIndustry(aiSuggested);
  
  // CAREER CHANGER DETECTION: Check if this is a career transition resume
  // and prioritize their current/target industry over historical experience
  if (resumeText) {
    const careerInfo = detectCareerTransition(resumeText);
    if (careerInfo.isCareerChanger && careerInfo.currentIndustry) {
      console.log(`[INDUSTRY-HYBRID] Career changer detected - using current/target industry: ${careerInfo.currentIndustry}`);
      console.log(`[INDUSTRY-HYBRID] Career transition signals: ${careerInfo.transitionSignals.join(', ')}`);
      console.log(`[INDUSTRY-HYBRID] Career changer confidence: ${careerInfo.confidence || 'medium'} (score: ${careerInfo.confidenceScore || 'N/A'})`);
      return {
        industry: careerInfo.currentIndustry,
        parentIndustry: INDUSTRY_PARENTS[careerInfo.currentIndustry],
        confidence: careerInfo.confidence || 'medium', // Use calculated confidence
        signals: [...careerInfo.transitionSignals, `Current/target industry: ${careerInfo.currentIndustry}`],
        score: careerInfo.confidenceScore || serverResult.score,
        detectionSource: 'ai_override', // Treat as special override
        alternativeIndustries: serverResult.alternativeIndustries,
        matchedTitlePatterns: serverResult.matchedTitlePatterns,
        matchedSkillCount: serverResult.matchedSkillCount,
        matchedContextPatterns: serverResult.matchedContextPatterns
      };
    }
  }
  
  // CRITICAL: Never return "general" if AI has a specific suggestion
  // This ensures 100% detection rate
  if (serverResult.industry === 'general' && normalizedAI !== 'general') {
    console.log(`[INDUSTRY-HYBRID] Server returned general, using AI mandatory fallback: ${normalizedAI}`);
    return {
      industry: normalizedAI,
      parentIndustry: INDUSTRY_PARENTS[normalizedAI],
      confidence: 'low',
      signals: [`AI detected (mandatory fallback): ${normalizedAI}`],
      score: serverResult.score,
      detectionSource: 'ai_fallback',
      alternativeIndustries: serverResult.alternativeIndustries,
      matchedTitlePatterns: serverResult.matchedTitlePatterns,
      matchedSkillCount: serverResult.matchedSkillCount,
      matchedContextPatterns: serverResult.matchedContextPatterns
    };
  }
  
  // If server has high confidence, trust it
  if (serverResult.confidence === 'high') {
    console.log(`[INDUSTRY-HYBRID] Using server result (high confidence): ${serverResult.industry}`);
    return {
      ...serverResult,
      detectionSource: 'server_high'
    };
  }
  
  // If server has medium confidence but AI agrees (or maps to same parent), trust server
  if (serverResult.confidence === 'medium') {
    const serverParent = getParentIndustry(serverResult.industry);
    const aiParent = getParentIndustry(normalizedAI);
    
    if (serverResult.industry === normalizedAI || serverParent === aiParent || serverParent === normalizedAI || serverResult.industry === aiParent) {
      console.log(`[INDUSTRY-HYBRID] Server and AI agree: ${serverResult.industry} (AI: ${normalizedAI})`);
      return {
        ...serverResult,
        detectionSource: 'server_medium'
      };
    }
    
    // If AI suggests something different and specific, consider it
    if (normalizedAI !== 'general' && serverResult.score < 40) {
      console.log(`[INDUSTRY-HYBRID] AI override (server score ${serverResult.score} < 40): ${normalizedAI}`);
      return {
        ...serverResult,
        industry: normalizedAI,
        confidence: 'medium',
        signals: [...serverResult.signals, `AI suggested: ${normalizedAI}`],
        detectionSource: 'ai_override'
      };
    }
    
    return {
      ...serverResult,
      detectionSource: 'server_medium'
    };
  }
  
  // If server has low confidence, prefer AI if it's specific
  if (serverResult.confidence === 'low' && normalizedAI !== 'general') {
    console.log(`[INDUSTRY-HYBRID] Using AI (server low confidence): ${normalizedAI}`);
    return {
      industry: normalizedAI,
      parentIndustry: INDUSTRY_PARENTS[normalizedAI],
      confidence: 'low',
      signals: [`AI detected: ${normalizedAI}`],
      score: serverResult.score,
      detectionSource: 'ai_fallback',
      alternativeIndustries: serverResult.alternativeIndustries,
      matchedTitlePatterns: serverResult.matchedTitlePatterns,
      matchedSkillCount: serverResult.matchedSkillCount,
      matchedContextPatterns: serverResult.matchedContextPatterns
    };
  }
  
  // Final fallback: if both server and AI return general, use the highest keyword density
  // This should be extremely rare
  if (serverResult.industry === 'general' && normalizedAI === 'general') {
    console.log(`[INDUSTRY-HYBRID] Both server and AI returned general - this needs attention`);
    // Return technology as a safe fallback for most resumes
    return {
      ...serverResult,
      industry: 'technology', // Most common fallback
      confidence: 'low',
      signals: [...serverResult.signals, 'Default fallback: technology (no strong signals)'],
      detectionSource: 'server_low'
    };
  }
  
  console.log(`[INDUSTRY-HYBRID] Defaulting to server result: ${serverResult.industry}`);
  return {
    ...serverResult,
    detectionSource: 'server_low'
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

      // Normalize industry using hybrid detection (combines server + AI)
      const industryDetectionStart = Date.now();
      const rawIndustry = analysis.industry;
      const serverDetection = detectIndustryFromResume(resumeText);
      const hybridResult = hybridIndustryDetection(serverDetection, rawIndustry, resumeText);
      const industryDetectionDuration = Date.now() - industryDetectionStart;
      
      // Apply hybrid result
      analysis.industry = hybridResult.industry;
      
      if (hybridResult.industry !== normalizeIndustry(rawIndustry)) {
        console.log(`[FREE-KEYWORD-SCAN-STREAM] Industry adjusted: AI said "${rawIndustry}" -> hybrid result "${hybridResult.industry}" (${hybridResult.confidence} confidence, score: ${hybridResult.score})`);
      }
      
      // Store enhanced detection metadata for UI (includes sub-industry info)
      const industryDetectionMeta = {
        detected: hybridResult.industry,
        subIndustry: hybridResult.subIndustry,
        parentIndustry: hybridResult.parentIndustry || getParentIndustry(hybridResult.industry),
        confidence: hybridResult.confidence,
        signals: hybridResult.signals,
        aiSuggested: rawIndustry,
        score: hybridResult.score
      };
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Industry detection: ${JSON.stringify(industryDetectionMeta)}`);

      // Log industry detection metrics for accuracy tracking (non-blocking)
      const normalizedAISuggested = normalizeIndustry(rawIndustry);
      const serverAIMatch = serverDetection.industry === normalizedAISuggested;
      const serverAIParentMatch = getParentIndustry(serverDetection.industry) === getParentIndustry(normalizedAISuggested) ||
        serverDetection.industry === getParentIndustry(normalizedAISuggested) ||
        getParentIndustry(serverDetection.industry) === normalizedAISuggested;
      
      EdgeRuntime.waitUntil(
        (async () => {
          const { error } = await supabase.rpc('log_industry_detection', {
            p_resume_text_length: resumeText.length,
            p_visitor_id: metricCtx.visitorId || null,
            p_ip_country: metricCtx.ipCountry || null,
            p_server_industry: serverDetection.industry,
            p_server_sub_industry: serverDetection.subIndustry || null,
            p_server_parent_industry: serverDetection.parentIndustry || null,
            p_server_confidence: serverDetection.confidence,
            p_server_score: serverDetection.score,
            p_server_signals: serverDetection.signals || [],
            p_ai_suggested_industry: normalizedAISuggested,
            p_final_industry: hybridResult.industry,
            p_final_confidence: hybridResult.confidence,
            p_detection_source: hybridResult.detectionSource || 'server_high',
            p_server_ai_match: serverAIMatch,
            p_server_ai_parent_match: serverAIParentMatch,
            p_alternative_industries: JSON.stringify(serverDetection.alternativeIndustries || []),
            p_detection_duration_ms: industryDetectionDuration,
            p_matched_title_patterns: serverDetection.matchedTitlePatterns || [],
            p_matched_skill_count: serverDetection.matchedSkillCount || 0,
            p_matched_context_patterns: serverDetection.matchedContextPatterns || false
          });
          if (error) {
            console.error(`[FREE-KEYWORD-SCAN-STREAM] Failed to log industry detection metric:`, error.message);
          } else {
            console.log(`[FREE-KEYWORD-SCAN-STREAM] Logged industry detection: ${hybridResult.industry} (${hybridResult.detectionSource})`);
          }
        })()
      );

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
