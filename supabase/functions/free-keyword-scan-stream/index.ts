import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { detectIndustry as detectIndustryShared } from "./industry-detection.ts";
const serve = Deno.serve;

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
  'marketing', 'education', 'engineering', 'creative', 'hr', 'human_resources', 
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
  'digital_marketing', 'content_marketing', 'brand_marketing', 'product_marketing',
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
  // Specialized sub-industries
  'supply_chain_analytics', 'sports_management',
  'ux_research', 'product_analytics', 'technical_writing',
  'data_engineering', 'devrel', 'content_strategy',
  'customer_success', 'revenue_operations', 'growth_marketing',
  'solutions_architecture', 'security_engineering', 'ml_engineering',
  'business_intelligence', 'platform_engineering',
  'quantitative_finance', 'product_design', 'sre',
  'technical_program_management', 'cloud_security', 'data_privacy',
  'sales_operations', 'channel_sales', 'strategic_accounts',
  'performance_marketing', 'influencer_marketing', 'marketing_analytics',
  'private_equity', 'venture_capital', 'treasury_management',
  'organizational_development', 'employee_experience', 'hr_analytics',
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
  'general_marketing': 'marketing',
  'digital_marketing': 'marketing',
  'content_marketing': 'marketing',
  'brand_marketing': 'marketing',
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
  // HR sub-industries (use 'human_resources' as canonical parent)
  'talent_acquisition': 'human_resources',
  'hr_business_partner': 'human_resources',
  'compensation_benefits': 'human_resources',
  'learning_development': 'human_resources',
  'hr_operations': 'human_resources',
  'employee_experience': 'human_resources',
  'organizational_development': 'human_resources',
  'dei': 'human_resources',
  'remote_work': 'human_resources',
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
  'military': 'general', // Military isn't a real industry — remapped to general so hybrid detection can assign based on actual skills
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
  'creator_economy': 'creative',
  // HYBRID INDUSTRIES - These are their own parent (primary domain)
  'healthcare_it': 'technology',
  'fintech': 'finance',
  'legaltech': 'legal',
  'hrtech': 'human_resources',
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
  // Specialized sub-industries
  'supply_chain_analytics': 'logistics',
  'sports_management': 'hospitality',
  'ux_research': 'creative',
  'product_analytics': 'technology',
  'technical_writing': 'technology',
  'data_engineering': 'technology',
  'devrel': 'technology',
  'content_strategy': 'marketing',
  'customer_success': 'sales',
  'revenue_operations': 'sales',
  'growth_marketing': 'marketing',
  'solutions_architecture': 'technology',
  'security_engineering': 'technology',
  'ml_engineering': 'technology',
  'business_intelligence': 'technology',
  'platform_engineering': 'technology',
  'quantitative_finance': 'finance',
  'product_design': 'creative',
  'sre': 'technology',
  'technical_program_management': 'technology',
  'cloud_security': 'technology',
  'data_privacy': 'legal',
  'sales_operations': 'sales',
  'channel_sales': 'sales',
  'strategic_accounts': 'sales',
  'performance_marketing': 'marketing',
  'influencer_marketing': 'marketing',
  'marketing_analytics': 'marketing',
  'private_equity': 'finance',
  'venture_capital': 'finance',
  'treasury_management': 'finance',
  'hr_analytics': 'human_resources',
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
  'teaching': 'education', 'academia': 'education', 'academic': 'education',
  'design': 'creative', 'art': 'creative', 'media': 'creative',
  'human resources': 'human_resources', 'hr': 'human_resources', 'recruitment': 'human_resources', 'talent': 'human_resources',
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
  'security': 'cybersecurity',
  'infrastructure': 'devops', 'sre': 'devops', 'platform': 'devops',
  // Sales aliases - Enhanced for better detection
  'b2b sales': 'enterprise_sales', 'enterprise': 'enterprise_sales', 'saas sales': 'enterprise_sales',
  'sdr': 'inside_sales', 'bdr': 'business_development', 'outbound': 'inside_sales',
  'pre-sales': 'sales_engineering', 'solutions': 'sales_engineering',
  'partnerships': 'business_development', 'alliances': 'business_development',
  // Sales methodology keywords -> map to enterprise_sales/business_development for accurate detection
  'meddpicc': 'enterprise_sales', 'meddic': 'enterprise_sales', 
  'spin selling': 'enterprise_sales', 'challenger sale': 'enterprise_sales',
  'challenger': 'enterprise_sales', 'sandler': 'enterprise_sales',
  'solution selling': 'enterprise_sales', 'consultative selling': 'enterprise_sales',
  'value selling': 'enterprise_sales', 'gap selling': 'enterprise_sales',
  'miller heiman': 'enterprise_sales', 'strategic selling': 'enterprise_sales',
  // Revenue metrics -> sales
  'arr': 'enterprise_sales', 'acv': 'enterprise_sales', 'mrr': 'enterprise_sales',
  'quota attainment': 'enterprise_sales', 'exceeded quota': 'enterprise_sales',
  'quota': 'sales', 'pipeline': 'sales', 'saas': 'enterprise_sales',
  'account executive': 'enterprise_sales', 'ae': 'enterprise_sales',
  // Marketing aliases
  'marketing intern': 'general_marketing', 'marketing coordinator': 'general_marketing',
  'marketing assistant': 'general_marketing', 'marketing associate': 'general_marketing',
  'marketing specialist': 'general_marketing', 'marketing analyst': 'general_marketing',
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
  'comp': 'compensation_benefits', 'benefits': 'compensation_benefits',
  'l&d': 'learning_development', 'training': 'learning_development',
  'hris': 'hr_operations', 'people ops': 'hr_operations',
  // Consulting aliases
  'mbb': 'strategy_consulting', 'mckinsey': 'strategy_consulting', 'bain': 'strategy_consulting', 'bcg': 'strategy_consulting',
  'systems integrator': 'it_consulting', 'technology consulting': 'it_consulting',
  'process improvement': 'operations_consulting', 'business process': 'operations_consulting',
  // Creative aliases
  'ui': 'ux_design', 'ux': 'ux_design', 'interaction design ux': 'ux_design',
  'branding design': 'graphic_design',
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
  
  // EXPANDED ALIASES - Added for better detection
  // Technology broad category
  'startup': 'technology', 'b2b tech': 'technology', 'b2c tech': 'technology',
  'product lead': 'product_management', 'product owner': 'product_management',
  'scrum master': 'technology', 'agile coach': 'technology',
  'program manager': 'product_management', 'technical program manager': 'product_management',
  
  // Software engineering aliases
  'frontend developer': 'software_engineering', 'backend developer': 'software_engineering', 
  'fullstack developer': 'software_engineering', 'full-stack developer': 'software_engineering', 
  'front-end developer': 'software_engineering', 'back-end developer': 'software_engineering',
  'react developer': 'software_engineering', 'node developer': 'software_engineering',
  'python developer': 'software_engineering', 'java developer': 'software_engineering',
  
  // Data science aliases
  'business intelligence analyst': 'business_intelligence',
  'data analyst role': 'data_science',
  'ai research': 'ai_ml',
  
  // UX/Creative aliases (non-duplicate)
  'user researcher': 'ux_research',
  'graphic artist': 'graphic_design', 'motion designer': 'video_production',
  
  // Healthcare aliases
  'rn': 'nursing', 'lpn': 'nursing', 'bsn': 'nursing', 'msn': 'nursing',
  'np': 'nursing', 'nurse practitioner': 'nursing', 'registered nurse': 'nursing',
  'md': 'physician', 'do': 'physician', 'medical resident': 'physician',
  
  // Education aliases  
  'instructor role': 'education', 'tutor': 'education', 'corporate trainer': 'learning_development',
  'facilitator role': 'learning_development', 'lecturer': 'higher_education',
  
  // Finance aliases
  'financial analyst': 'finance', 'equity research': 'investment_banking', 'm&a analyst': 'investment_banking',
  'wealth management': 'financial_planning', 'cfp': 'financial_planning',
  
  // Sales aliases (non-duplicate)
  'account manager': 'enterprise_sales',
  
  // DevOps/Cloud aliases (non-duplicate)
  'cloud engineer': 'cloud_engineering',
  'site reliability': 'devops', 'kubernetes engineer': 'devops', 'docker specialist': 'devops',
  
  // ==================== EXPANDED LEGAL ALIASES ====================
  'paralegal': 'legal', 'legal assistant': 'legal', 'legal secretary': 'legal',
  'legal counsel': 'corporate_law', 'general counsel': 'corporate_law', 'in-house counsel': 'corporate_law',
  'contract attorney': 'corporate_law', 'transactional lawyer': 'corporate_law', 'corporate attorney': 'corporate_law',
  'm&a lawyer': 'corporate_law', 'securities lawyer': 'corporate_law', 'real estate attorney': 'corporate_law',
  'trial lawyer': 'litigation', 'civil litigation': 'litigation', 'criminal defense': 'litigation',
  'personal injury': 'litigation', 'class action': 'litigation', 'appellate': 'litigation',
  'patent attorney': 'intellectual_property', 'ip counsel': 'intellectual_property', 'copyright': 'intellectual_property',
  'trade secret': 'intellectual_property', 'licensing attorney': 'intellectual_property',
  'labor attorney': 'employment_law', 'employment attorney': 'employment_law', 'workplace law': 'employment_law',
  'eeoc': 'employment_law', 'wrongful termination': 'employment_law', 'wage and hour': 'employment_law',
  'compliance officer': 'compliance', 'regulatory affairs': 'compliance', 'aml': 'compliance',
  'kyc': 'compliance', 'sox compliance': 'compliance', 'gdpr compliance': 'compliance', 'hipaa compliance': 'compliance',
  'legal operations': 'legal', 'legal project manager': 'legal', 'law firm': 'legal',
  'bar exam': 'legal', 'jd': 'legal', 'law school': 'legal', 'clerk': 'legal',
  'magistrate': 'legal', 'judge': 'legal', 'arbitrator': 'legal', 'mediator': 'legal',
  'immigration lawyer': 'legal', 'family law': 'legal', 'estate planning': 'legal',
  'bankruptcy attorney': 'legal', 'tax attorney': 'finance', 'environmental law': 'legal',
  
  // ==================== EXPANDED HOSPITALITY ALIASES ====================
  'front desk': 'hotel_management', 'concierge': 'hotel_management', 'bellhop': 'hotel_management',
  'housekeeping': 'hotel_management', 'guest services': 'hotel_management', 'reservations': 'hotel_management',
  'revenue management': 'hotel_management', 'night auditor': 'hotel_management', 'resort': 'hotel_management',
  'spa manager': 'hotel_management', 'hotel general manager': 'hotel_management', 'accommodation': 'hotel_management',
  'sous chef': 'food_beverage', 'executive chef': 'food_beverage', 'pastry chef': 'food_beverage',
  'line cook': 'food_beverage', 'kitchen manager': 'food_beverage', 'food prep': 'food_beverage',
  'bartender': 'food_beverage', 'sommelier': 'food_beverage', 'barista': 'food_beverage',
  'server': 'food_beverage', 'waitstaff': 'food_beverage', 'host': 'food_beverage',
  'fast food': 'food_beverage', 'quick service': 'food_beverage', 'culinary': 'food_beverage',
  'food safety': 'food_beverage', 'haccp': 'food_beverage', 'servsafe': 'food_beverage',
  'wedding planner': 'event_management', 'conference coordinator': 'event_management', 'meeting planner': 'event_management',
  'corporate events': 'event_management', 'venue manager': 'event_management', 'convention': 'event_management',
  'exhibition': 'event_management', 'trade show': 'event_management', 'special events': 'event_management',
  'tour guide': 'tourism', 'travel agent': 'tourism', 'cruise': 'tourism', 'airline': 'tourism',
  'adventure tourism': 'tourism', 'eco tourism': 'tourism', 'cultural tourism': 'tourism',
  'destination marketing': 'tourism', 'visitor center': 'tourism', 'theme park': 'tourism',
  'slot technician': 'casino_gaming', 'pit boss': 'casino_gaming', 'dealer': 'casino_gaming',
  'surveillance casino': 'casino_gaming', 'casino host': 'casino_gaming', 'gaming compliance': 'casino_gaming',
  
  // ==================== EXPANDED MANUFACTURING ALIASES ====================
  'cnc machinist': 'manufacturing', 'cnc operator': 'manufacturing', 'machinist': 'manufacturing',
  'welder': 'manufacturing', 'fabricator': 'manufacturing', 'sheet metal': 'manufacturing',
  'tool and die': 'manufacturing', 'injection molding': 'manufacturing', 'plastic molding': 'manufacturing',
  'assembly line': 'manufacturing', 'production worker': 'manufacturing', 'machine operator': 'manufacturing',
  'forklift operator': 'manufacturing', 'material handler': 'manufacturing', 'picker packer': 'manufacturing',
  'quality inspector': 'quality_engineering', 'quality auditor': 'quality_engineering', 'incoming inspection': 'quality_engineering',
  'metrology': 'quality_engineering', 'cmm operator': 'quality_engineering', 'calibration': 'quality_engineering',
  'iso 9001': 'quality_engineering', 'as9100': 'quality_engineering', 'iatf 16949': 'quality_engineering',
  'process engineer': 'process_engineering', 'manufacturing engineer': 'process_engineering', 'tooling engineer': 'process_engineering',
  'automation engineer': 'process_engineering', 'robotics engineer': 'process_engineering', 'plc programmer': 'process_engineering',
  'lean engineer': 'lean_manufacturing', 'black belt': 'lean_manufacturing', 'green belt': 'lean_manufacturing',
  'value stream': 'lean_manufacturing', '5s': 'lean_manufacturing', 'total productive maintenance': 'lean_manufacturing',
  'production planning': 'supply_chain_manufacturing', 'mrp': 'supply_chain_manufacturing', 'erp manufacturing': 'supply_chain_manufacturing',
  'inventory control': 'supply_chain_manufacturing', 'materials management': 'supply_chain_manufacturing',
  'plant manager': 'plant_management', 'operations manager manufacturing': 'plant_management', 'shift supervisor': 'plant_management',
  'production supervisor': 'plant_management', 'maintenance manager': 'plant_management', 'facilities manager': 'plant_management',
  'osha': 'manufacturing', 'ehs': 'manufacturing', 'safety manager': 'manufacturing', 'industrial hygiene': 'manufacturing',
  'gmp': 'manufacturing', 'fda manufacturing': 'manufacturing', 'pharmaceutical manufacturing': 'manufacturing',
  'food manufacturing': 'manufacturing', 'automotive manufacturing': 'manufacturing', 'aerospace manufacturing': 'manufacturing',
  
  // ==================== EXPANDED NONPROFIT ALIASES ====================
  'executive director nonprofit': 'nonprofit', 'nonprofit executive': 'nonprofit', 'ceo nonprofit': 'nonprofit',
  'chief development officer': 'fundraising', 'fundraiser': 'fundraising', 'annual fund': 'fundraising',
  'capital campaign': 'fundraising', 'planned giving': 'fundraising', 'gift officer': 'fundraising',
  'donor stewardship': 'fundraising', 'advancement': 'fundraising', 'alumni relations': 'fundraising',
  'foundation director': 'fundraising', 'corporate giving': 'fundraising', 'sponsorship': 'fundraising',
  'program coordinator nonprofit': 'program_management_nonprofit', 'program officer': 'program_management_nonprofit',
  'social impact': 'program_management_nonprofit', 'community development': 'program_management_nonprofit',
  'outreach coordinator': 'program_management_nonprofit', 'case manager': 'program_management_nonprofit',
  'social worker': 'program_management_nonprofit', 'msw': 'program_management_nonprofit', 'lcsw': 'program_management_nonprofit',
  'youth program': 'program_management_nonprofit', 'after school': 'program_management_nonprofit', 'mentorship': 'program_management_nonprofit',
  'policy advocate': 'advocacy', 'government relations': 'advocacy', 'public policy': 'advocacy',
  'community organizer': 'advocacy', 'campaign manager nonprofit': 'advocacy', 'political': 'advocacy',
  'union': 'advocacy', 'labor organizer': 'advocacy', 'civic engagement': 'advocacy',
  'grant manager': 'grant_writing', 'grant coordinator': 'grant_writing', 'proposal writer': 'grant_writing',
  'foundation relations': 'grant_writing', 'federal grants': 'grant_writing', 'state grants': 'grant_writing',
  'rfa': 'grant_writing', 'rfp writer': 'grant_writing', 'grant compliance': 'grant_writing',
  'volunteer coordinator nonprofit': 'volunteer_management', 'volunteer manager': 'volunteer_management',
  'community engagement nonprofit': 'volunteer_management', 'service learning': 'volunteer_management',
  'americorps': 'volunteer_management', 'peace corps': 'volunteer_management', 'vista': 'volunteer_management',
  'mission': 'nonprofit', 'charitable': 'nonprofit', '501c3': 'nonprofit', '501(c)(3)': 'nonprofit',
  'philanthropy': 'nonprofit', 'humanitarian': 'nonprofit', 'relief': 'nonprofit',
  'red cross': 'nonprofit', 'habitat for humanity': 'nonprofit', 'united way': 'nonprofit',
  'ymca': 'nonprofit', 'boys and girls club': 'nonprofit', 'salvation army': 'nonprofit',
  
  // ==================== SUPPLY CHAIN ANALYTICS ALIASES ====================
  'supply chain analytics': 'supply_chain_analytics', 'demand planning': 'supply_chain_analytics',
  'demand forecasting': 'supply_chain_analytics', 'inventory analytics': 'supply_chain_analytics',
  'procurement analytics': 'supply_chain_analytics', 'supply chain optimization': 'supply_chain_analytics',
  'scm analytics': 'supply_chain_analytics', 'logistics analytics': 'supply_chain_analytics',
  's&op': 'supply_chain_analytics', 'sales and operations planning': 'supply_chain_analytics',
  'supply chain data': 'supply_chain_analytics', 'supply chain modeling': 'supply_chain_analytics',
  'network optimization': 'supply_chain_analytics', 'supply chain insights': 'supply_chain_analytics',
  
  // ==================== SPORTS MANAGEMENT ALIASES ====================
  'sports management': 'sports_management', 'sports marketing': 'sports_management',
  'athletic administration': 'sports_management', 'athletic director': 'sports_management',
  'sports business': 'sports_management', 'team management': 'sports_management',
  'sports agent': 'sports_management', 'athlete management': 'sports_management',
  'sports operations': 'sports_management', 'player personnel': 'sports_management',
  'ticket sales sports': 'sports_management', 'sports sponsorship': 'sports_management',
  'fan engagement': 'sports_management', 'ncaa': 'sports_management', 'ncaa compliance': 'sports_management',
  'professional sports': 'sports_management', 'minor league': 'sports_management', 'major league': 'sports_management',
  'esports management': 'sports_management', 'esports': 'sports_management',
  
  // ==================== UX RESEARCH ALIASES ====================
  'ux research': 'ux_research', 'user research': 'ux_research', 'ux researcher': 'ux_research',
  'user experience research': 'ux_research', 'usability research': 'ux_research', 'design research': 'ux_research',
  'user insights': 'ux_research', 'human factors': 'ux_research', 'hci': 'ux_research',
  'user interviews': 'ux_research',
  'personas': 'ux_research', 'card sorting': 'ux_research', 'tree testing': 'ux_research',
  'eye tracking': 'ux_research', 'heuristic evaluation': 'ux_research', 'affinity mapping': 'ux_research',
  'dovetail': 'ux_research', 'usertesting': 'ux_research', 'optimal workshop': 'ux_research',
  'lookback': 'ux_research', 'maze design': 'ux_research',
  
  // ==================== PRODUCT ANALYTICS ALIASES ====================
  'product analytics': 'product_analytics', 'product analyst': 'product_analytics',
  'product intelligence': 'product_analytics',
  'product data': 'product_analytics',
  'amplitude': 'product_analytics', 'mixpanel': 'product_analytics', 'segment': 'product_analytics',
  'funnel analysis': 'product_analytics', 'cohort analysis': 'product_analytics',
  'retention analysis': 'product_analytics', 'user segmentation': 'product_analytics',
  'experimentation': 'product_analytics', 'ab testing product': 'product_analytics',
  'heap analytics': 'product_analytics', 'event tracking': 'product_analytics',
  'ltv analysis': 'product_analytics', 'churn analysis': 'product_analytics',
  'feature adoption': 'product_analytics',
  
  // ==================== TECHNICAL WRITING ALIASES ====================
  'technical writing': 'technical_writing', 'technical writer': 'technical_writing',
  'tech writer': 'technical_writing', 'documentation specialist': 'technical_writing',
  'api documentation': 'technical_writing', 'content developer': 'technical_writing',
  'information developer': 'technical_writing', 'knowledge management': 'technical_writing',
  'technical documentation': 'technical_writing', 'user guides': 'technical_writing',
  'knowledge base': 'technical_writing', 'release notes': 'technical_writing',
  'dita': 'technical_writing', 'madcap flare': 'technical_writing', 'framemaker': 'technical_writing',
  'readme': 'technical_writing', 'docusaurus': 'technical_writing', 'swagger docs': 'technical_writing',
  'openapi docs': 'technical_writing', 'style guides': 'technical_writing',
  'information architecture': 'technical_writing', 'single sourcing': 'technical_writing',
  'topic-based authoring': 'technical_writing',
  
  // ==================== DATA ENGINEERING ALIASES ====================
  'data engineering': 'data_engineering', 'data engineer': 'data_engineering',
  'data infrastructure': 'data_engineering', 'data platform': 'data_engineering',
  'etl developer': 'data_engineering', 'etl engineer': 'data_engineering',
  'data pipeline': 'data_engineering', 'big data engineer': 'data_engineering',
  'spark': 'data_engineering', 'airflow': 'data_engineering', 'dbt data': 'data_engineering',
  'databricks': 'data_engineering', 'bigquery data': 'data_engineering',
  'redshift data': 'data_engineering', 'kafka': 'data_engineering', 'fivetran': 'data_engineering',
  'data lake': 'data_engineering', 'data modeling de': 'data_engineering',
  'stream processing': 'data_engineering',
  
  // ==================== DEVREL ALIASES ====================
  'developer relations': 'devrel', 'developer advocacy': 'devrel', 'developer advocate': 'devrel',
  'devrel': 'devrel', 'developer evangelist': 'devrel',
  'dx engineer': 'devrel', 'community manager tech': 'devrel', 'tech evangelist': 'devrel',
  'sdk development': 'devrel', 'developer onboarding': 'devrel', 'developer community': 'devrel',
  'open source advocate': 'devrel', 'conference speaking': 'devrel', 'tech community': 'devrel',
  'developer education': 'devrel', 'hackathon': 'devrel',
  
  // ==================== CONTENT STRATEGY ALIASES ====================
  'content strategy': 'content_strategy', 'content strategist': 'content_strategy',
  'content planning': 'content_strategy', 'editorial strategy': 'content_strategy',
  'content operations': 'content_strategy', 'content lead': 'content_strategy',
  'content governance': 'content_strategy', 'ux writing': 'content_strategy',
  'content audit': 'content_strategy', 'editorial calendar': 'content_strategy',
  'voice and tone': 'content_strategy', 'content modeling': 'content_strategy',
  'taxonomy': 'content_strategy', 'content performance': 'content_strategy',
  'content localization': 'content_strategy', 'content migration': 'content_strategy',
  
  // ==================== CUSTOMER SUCCESS ALIASES ====================
  'customer success': 'customer_success', 'csm': 'customer_success',
  'customer success manager': 'customer_success', 'client success': 'customer_success',
  'account management': 'customer_success', 'customer experience': 'customer_success',
  'customer retention': 'customer_success', 'churn prevention': 'customer_success',
  'customer onboarding': 'customer_success', 'nps': 'customer_success',
  'customer health': 'customer_success', 'qbr': 'customer_success', 'qbrs': 'customer_success',
  'renewal management': 'customer_success', 'gainsight': 'customer_success',
  'totango': 'customer_success', 'churnzero': 'customer_success',
  'expansion revenue': 'customer_success', 'product adoption': 'customer_success',
  
  // ==================== REVENUE OPERATIONS ALIASES ====================
  'revenue operations': 'revenue_operations', 'revops': 'revenue_operations',
  'revenue ops': 'revenue_operations',
  'go-to-market operations': 'revenue_operations', 'gtm operations': 'revenue_operations',
  'quota setting': 'revenue_operations', 'commission plans': 'revenue_operations',
  'gong': 'revenue_operations', 'outreach': 'revenue_operations',
  'salesloft': 'revenue_operations', 'cpq': 'revenue_operations',
  
  // ==================== GROWTH MARKETING ALIASES ====================
  'growth marketing': 'growth_marketing', 'growth hacking': 'growth_marketing',
  'growth manager': 'growth_marketing',
  'acquisition marketing': 'growth_marketing', 'lifecycle marketing': 'growth_marketing',
  'conversion optimization': 'growth_marketing', 'cro': 'growth_marketing',
  'cac optimization': 'growth_marketing', 'ltv optimization': 'growth_marketing',
  'aarrr': 'growth_marketing', 'product-led growth': 'growth_marketing',
  'viral loops': 'growth_marketing', 'referral programs': 'growth_marketing',
  
  // ==================== SOLUTIONS ARCHITECTURE ALIASES ====================
  'solutions architecture': 'solutions_architecture', 'solutions architect': 'solutions_architecture',
  'solution architect': 'solutions_architecture', 'enterprise architect': 'solutions_architecture',
  'cloud architect': 'solutions_architecture', 'technical architect': 'solutions_architecture',
  'pre-sales engineer': 'solutions_architecture', 'presales': 'solutions_architecture',
  'technical discovery': 'solutions_architecture', 'architecture diagrams': 'solutions_architecture',
  'poc': 'solutions_architecture', 'proof of concept': 'solutions_architecture',
  'rfp response': 'solutions_architecture', 'technical sales': 'solutions_architecture',
  'well-architected': 'solutions_architecture', 'togaf': 'solutions_architecture',
  'migration strategy': 'solutions_architecture',
  
  // ==================== SECURITY ENGINEERING ALIASES ====================
  'security engineering': 'security_engineering', 'security engineer': 'security_engineering',
  'infosec': 'security_engineering', 'appsec': 'security_engineering',
  'application security': 'security_engineering', 'security architect': 'security_engineering',
  'devsecops': 'security_engineering', 'penetration testing': 'security_engineering',
  'penetration tester': 'security_engineering', 'pentest': 'security_engineering',
  'vulnerability assessment': 'security_engineering', 'threat modeling': 'security_engineering',
  'siem': 'security_engineering', 'owasp': 'security_engineering',
  'cissp': 'security_engineering', 'ceh': 'security_engineering',
  'incident response': 'security_engineering', 'zero trust': 'security_engineering',
  'splunk security': 'security_engineering', 'crowdstrike': 'security_engineering',
  'burp suite': 'security_engineering', 'nessus': 'security_engineering',
  
  // ==================== ML ENGINEERING ALIASES ====================
  'ml engineering': 'ml_engineering', 'ml engineer': 'ml_engineering',
  'machine learning engineer': 'ml_engineering', 'mlops': 'ml_engineering',
  'ai engineer': 'ml_engineering', 'deep learning engineer': 'ml_engineering',
  'ml infrastructure': 'ml_engineering', 'model training': 'ml_engineering',
  'model deployment': 'ml_engineering', 'feature engineering': 'ml_engineering',
  'model monitoring': 'ml_engineering', 'kubeflow': 'ml_engineering',
  'mlflow': 'ml_engineering', 'sagemaker': 'ml_engineering', 'vertex ai': 'ml_engineering',
  'distributed training': 'ml_engineering', 'experiment tracking': 'ml_engineering',
  'model registry': 'ml_engineering', 'inference optimization': 'ml_engineering',
  'hugging face': 'ml_engineering', 'transformers ml': 'ml_engineering', 'llms': 'ml_engineering',
  
  // ==================== BUSINESS INTELLIGENCE ALIASES ====================
  'business intelligence': 'business_intelligence', 'bi analyst': 'business_intelligence',
  'bi developer': 'business_intelligence', 'bi engineer': 'business_intelligence',
  'data visualization': 'business_intelligence', 'reporting analyst': 'business_intelligence',
  'tableau developer': 'business_intelligence', 'power bi developer': 'business_intelligence',
  'looker developer': 'business_intelligence', 'analytics engineer': 'business_intelligence',
  'dashboards': 'business_intelligence', 'kpi reporting': 'business_intelligence',
  'executive reporting': 'business_intelligence', 'dimensional modeling': 'business_intelligence',
  'olap': 'business_intelligence', 'data warehouse': 'business_intelligence',
  'dax': 'business_intelligence', 'qlik': 'business_intelligence', 'qlikview': 'business_intelligence',
  'qliksense': 'business_intelligence', 'self-service analytics': 'business_intelligence',
  'ad hoc reporting': 'business_intelligence', 'tableau': 'business_intelligence',
  'power bi': 'business_intelligence', 'looker': 'business_intelligence',
  
  // ==================== PLATFORM ENGINEERING ALIASES ====================
  'platform engineering': 'platform_engineering', 'platform engineer': 'platform_engineering',
  'infrastructure engineer': 'platform_engineering', 'developer experience': 'platform_engineering',
  'devex': 'platform_engineering', 'internal developer platform': 'platform_engineering',
  'idp': 'platform_engineering', 'developer platform': 'platform_engineering',
  'backstage': 'platform_engineering', 'golden paths': 'platform_engineering',
  'self-service infrastructure': 'platform_engineering', 'platform apis': 'platform_engineering',
  'crossplane': 'platform_engineering', 'developer productivity': 'platform_engineering',
  'gitops': 'platform_engineering', 'argocd': 'platform_engineering',
  'helm': 'platform_engineering', 'service mesh': 'platform_engineering',
  'internal tooling': 'platform_engineering', 'paved roads': 'platform_engineering',
  
  // ==================== QUANTITATIVE FINANCE ALIASES ====================
  'quantitative finance': 'quantitative_finance', 'quant': 'quantitative_finance',
  'quantitative analyst': 'quantitative_finance', 'quant analyst': 'quantitative_finance',
  'quant developer': 'quantitative_finance', 'quant dev': 'quantitative_finance',
  'quant researcher': 'quantitative_finance', 'algorithmic trading': 'quantitative_finance',
  'algo trading': 'quantitative_finance', 'systematic trading': 'quantitative_finance',
  'financial engineering': 'quantitative_finance', 'derivatives pricing': 'quantitative_finance',
  'risk modeling': 'quantitative_finance', 'alpha generation': 'quantitative_finance',
  'portfolio optimization': 'quantitative_finance', 'backtesting': 'quantitative_finance',
  'monte carlo': 'quantitative_finance', 'time series analysis': 'quantitative_finance',
  'stochastic calculus': 'quantitative_finance', 'black-scholes': 'quantitative_finance',
  'market microstructure': 'quantitative_finance', 'execution algorithms': 'quantitative_finance',
  
  // ==================== PRODUCT DESIGN ALIASES ====================
  'product design': 'product_design', 'product designer': 'product_design',
  'ux designer': 'product_design', 'ui designer': 'product_design',
  'ux/ui designer': 'product_design', 'ui/ux designer': 'product_design',
  'design lead': 'product_design', 'senior product designer': 'product_design',
  'design systems': 'product_design', 'interaction design': 'product_design',
  'visual design': 'product_design', 'user experience design': 'product_design',
  'figma expert': 'product_design', 'prototyping': 'product_design',
  'wireframing': 'product_design', 'usability testing': 'product_design',
  'design thinking': 'product_design', 'user flows': 'product_design',
  'journey mapping': 'product_design',
  
  // ==================== SRE ALIASES ====================
  'site reliability engineering': 'sre', 'site reliability engineer': 'sre',
  'sre engineer': 'sre', 'reliability engineer': 'sre',
  'production engineer': 'sre', 'infrastructure reliability': 'sre',
  'slos': 'sre', 'slis': 'sre', 'error budgets': 'sre',
  'incident response sre': 'sre', 'on-call': 'sre', 'postmortem': 'sre',
  'chaos engineering': 'sre', 'capacity planning': 'sre',
  'prometheus': 'sre', 'grafana': 'sre', 'datadog': 'sre',
  
  // ==================== TECHNICAL PROGRAM MANAGEMENT ALIASES ====================
  'technical program management': 'technical_program_management', 'tpm': 'technical_program_management',
  'technical program manager': 'technical_program_management', 'program manager': 'technical_program_management',
  'engineering program manager': 'technical_program_management', 'technical project manager': 'technical_program_management',
  'senior tpm': 'technical_program_management', 'staff tpm': 'technical_program_management',
  'cross-functional leadership': 'technical_program_management', 'roadmap planning': 'technical_program_management',
  'dependency management': 'technical_program_management', 'release management': 'technical_program_management',
  'okrs': 'technical_program_management', 'kpis tpm': 'technical_program_management',
  
  // ==================== CLOUD SECURITY ALIASES ====================
  'cloud security': 'cloud_security', 'cloud security engineer': 'cloud_security',
  'cloud security architect': 'cloud_security', 'cloud security analyst': 'cloud_security',
  'aws security': 'cloud_security', 'azure security': 'cloud_security', 'gcp security': 'cloud_security',
  'cspm': 'cloud_security', 'cwpp': 'cloud_security', 'cloud workload protection': 'cloud_security',
  'container security': 'cloud_security', 'kubernetes security': 'cloud_security',
  'security posture': 'cloud_security', 'secret management': 'cloud_security',
  'hashicorp vault': 'cloud_security', 'aws guardduty': 'cloud_security',
  'azure sentinel': 'cloud_security', 'prisma cloud': 'cloud_security', 'wiz': 'cloud_security',
  
  // ==================== DATA PRIVACY ALIASES ====================
  'data privacy': 'data_privacy', 'privacy engineer': 'data_privacy',
  'privacy analyst': 'data_privacy', 'data protection officer': 'data_privacy',
  'dpo': 'data_privacy', 'privacy compliance': 'data_privacy',
  'gdpr': 'data_privacy', 'ccpa': 'data_privacy', 'privacy by design': 'data_privacy',
  'data protection': 'data_privacy', 'privacy impact assessment': 'data_privacy',
  'data mapping': 'data_privacy', 'consent management': 'data_privacy',
  'data subject rights': 'data_privacy', 'onetrust': 'data_privacy',
  'trustarc': 'data_privacy', 'bigid': 'data_privacy', 'data classification': 'data_privacy',
  'cross-border data transfer': 'data_privacy', 'data retention': 'data_privacy',
  'data breach response': 'data_privacy', 'cipp': 'data_privacy', 'cipm': 'data_privacy',
  
  // ==================== SALES OPERATIONS ALIASES ====================
  'sales operations': 'sales_operations', 'sales ops': 'sales_operations',
  'sales operations manager': 'sales_operations', 'director of sales operations': 'sales_operations',
  'vp sales operations': 'sales_operations', 'head of sales ops': 'sales_operations',
  'sales enablement': 'sales_operations', 'sales enablement manager': 'sales_operations',
  'deal desk': 'sales_operations', 'deal desk manager': 'sales_operations',
  'salesforce administrator': 'sales_operations', 'crm manager': 'sales_operations',
  'sales analytics': 'sales_operations', 'sales analyst': 'sales_operations',
  'sales planning': 'sales_operations', 'territory planning': 'sales_operations',
  'quota management': 'sales_operations', 'sales compensation': 'sales_operations',
  'pipeline management': 'sales_operations', 'sales forecasting': 'sales_operations',
  'go-to-market ops': 'sales_operations', 'gtm ops': 'sales_operations',
  'clari': 'sales_operations', 'gong analyst': 'sales_operations',
  
  // ==================== CHANNEL SALES ALIASES ====================
  'channel sales': 'channel_sales', 'channel manager': 'channel_sales',
  'channel sales manager': 'channel_sales', 'partner sales': 'channel_sales',
  'partner manager': 'channel_sales', 'partner sales manager': 'channel_sales',
  'channel director': 'channel_sales', 'director of channel': 'channel_sales',
  'vp channel': 'channel_sales', 'head of partnerships': 'channel_sales',
  'alliance manager': 'channel_sales', 'strategic alliances': 'channel_sales',
  'reseller manager': 'channel_sales', 'var manager': 'channel_sales',
  'distribution manager': 'channel_sales', 'indirect sales': 'channel_sales',
  'partner enablement': 'channel_sales', 'channel enablement': 'channel_sales',
  'partner development': 'channel_sales', 'ecosystem manager': 'channel_sales',
  'partner success': 'channel_sales', 'channel account manager': 'channel_sales',
  'parm': 'channel_sales', 'prm specialist': 'channel_sales',
  
  // ==================== STRATEGIC ACCOUNTS ALIASES ====================
  'strategic accounts': 'strategic_accounts', 'strategic account manager': 'strategic_accounts',
  'key account manager': 'strategic_accounts', 'key accounts': 'strategic_accounts',
  'enterprise account manager': 'strategic_accounts', 'enterprise accounts': 'strategic_accounts',
  'global account manager': 'strategic_accounts', 'global accounts': 'strategic_accounts',
  'named account manager': 'strategic_accounts', 'named accounts': 'strategic_accounts',
  'major accounts': 'strategic_accounts', 'major account manager': 'strategic_accounts',
  'strategic sales': 'strategic_accounts', 'enterprise sales rep': 'strategic_accounts',
  'enterprise ae': 'strategic_accounts', 'strategic ae': 'strategic_accounts',
  'c-suite selling': 'strategic_accounts', 'executive selling': 'strategic_accounts',
  'complex sales': 'strategic_accounts', 'large deal sales': 'strategic_accounts',
  'account executive enterprise': 'strategic_accounts', 'senior account executive': 'strategic_accounts',
  
  // ==================== PERFORMANCE MARKETING ALIASES ====================
  'performance marketing': 'performance_marketing', 'performance marketer': 'performance_marketing',
  'paid media manager': 'performance_marketing', 'paid media specialist': 'performance_marketing',
  'paid acquisition': 'performance_marketing', 'digital advertising': 'performance_marketing',
  'ppc specialist': 'performance_marketing', 'ppc manager': 'performance_marketing',
  'sem manager': 'performance_marketing', 'search marketing': 'performance_marketing',
  'google ads specialist': 'performance_marketing', 'facebook ads specialist': 'performance_marketing',
  'meta ads manager': 'performance_marketing', 'paid social manager': 'performance_marketing',
  'media buyer': 'performance_marketing', 'demand gen manager': 'performance_marketing',
  'growth marketer': 'performance_marketing', 'user acquisition': 'performance_marketing',
  'programmatic manager': 'performance_marketing', 'roas optimization': 'performance_marketing',
  
  // ==================== INFLUENCER MARKETING ALIASES ====================
  'influencer marketing': 'influencer_marketing', 'influencer manager': 'influencer_marketing',
  'influencer marketing manager': 'influencer_marketing', 'creator marketing': 'influencer_marketing',
  'creator partnerships': 'influencer_marketing', 'influencer relations': 'influencer_marketing',
  'ugc manager': 'influencer_marketing', 'user generated content': 'influencer_marketing',
  'brand ambassador manager': 'influencer_marketing', 'ambassador program': 'influencer_marketing',
  'creator economy manager': 'influencer_marketing', 'social partnerships': 'influencer_marketing',
  'influencer strategist': 'influencer_marketing', 'talent partnerships': 'influencer_marketing',
  'creator relations': 'influencer_marketing', 'content creator partnerships': 'influencer_marketing',
  'aspireiq': 'influencer_marketing', 'grin platform': 'influencer_marketing', 'creatoriq': 'influencer_marketing',
  
  // ==================== MARKETING ANALYTICS ALIASES ====================
  'marketing analytics': 'marketing_analytics', 'marketing analyst': 'marketing_analytics',
  'marketing data analyst': 'marketing_analytics', 'marketing science': 'marketing_analytics',
  'digital analytics manager': 'marketing_analytics', 'web analytics': 'marketing_analytics',
  'growth analytics': 'marketing_analytics', 'marketing intelligence': 'marketing_analytics',
  'attribution analyst': 'marketing_analytics', 'marketing mix modeling': 'marketing_analytics',
  'customer analytics marketing': 'marketing_analytics', 'funnel analyst': 'marketing_analytics',
  'marketing bi': 'marketing_analytics', 'marketing dashboards': 'marketing_analytics',
  'amplitude analyst': 'marketing_analytics', 'mixpanel analyst': 'marketing_analytics',
  'segment specialist': 'marketing_analytics', 'adobe analytics specialist': 'marketing_analytics',
  
  // ==================== PRIVATE EQUITY ALIASES ====================
  'private equity': 'private_equity', 'pe associate': 'private_equity',
  'private equity analyst': 'private_equity', 'private equity associate': 'private_equity',
  'pe analyst': 'private_equity', 'buyout': 'private_equity',
  'leveraged buyout': 'private_equity', 'lbo analyst': 'private_equity',
  'growth equity': 'private_equity', 'growth equity associate': 'private_equity',
  'pe principal': 'private_equity', 'pe vice president': 'private_equity',
  'pe portfolio': 'private_equity', 'portfolio operations': 'private_equity',
  'deal sourcing pe': 'private_equity', 'investment professional': 'private_equity',
  'fund management': 'private_equity', 'pitchbook analyst': 'private_equity',
  
  // ==================== VENTURE CAPITAL ALIASES ====================
  'venture capital': 'venture_capital', 'vc analyst': 'venture_capital',
  'vc associate': 'venture_capital', 'venture capital associate': 'venture_capital',
  'venture capital analyst': 'venture_capital', 'vc principal': 'venture_capital',
  'startup investor': 'venture_capital', 'seed investor': 'venture_capital',
  'early stage investor': 'venture_capital', 'series a investor': 'venture_capital',
  'venture partner': 'venture_capital', 'partner vc': 'venture_capital',
  'deal sourcing vc': 'venture_capital', 'startup ecosystem': 'venture_capital',
  'founder relations': 'venture_capital', 'portfolio support': 'venture_capital',
  'crunchbase analyst': 'venture_capital', 'angellist': 'venture_capital',
  
  // ==================== TREASURY MANAGEMENT ALIASES ====================
  'treasury management': 'treasury_management', 'treasury manager': 'treasury_management',
  'treasury analyst': 'treasury_management', 'corporate treasury': 'treasury_management',
  'cash management': 'treasury_management', 'cash manager': 'treasury_management',
  'liquidity management': 'treasury_management', 'liquidity analyst': 'treasury_management',
  'treasury operations': 'treasury_management', 'fx treasury': 'treasury_management',
  'treasury director': 'treasury_management', 'vp treasury': 'treasury_management',
  'head of treasury': 'treasury_management', 'ctp': 'treasury_management',
  'kyriba': 'treasury_management', 'sap treasury': 'treasury_management',
  'cash forecasting': 'treasury_management', 'working capital management': 'treasury_management',
  
  // ==================== ORGANIZATIONAL DEVELOPMENT ALIASES ====================
  'organizational development': 'organizational_development', 'od consultant': 'organizational_development',
  'od specialist': 'organizational_development', 'organization development': 'organizational_development',
  'org development': 'organizational_development', 'organizational effectiveness': 'organizational_development',
  'change management': 'organizational_development', 'change manager': 'organizational_development',
  'change consultant': 'organizational_development', 'leadership development': 'organizational_development',
  'leadership development manager': 'organizational_development', 'culture transformation': 'organizational_development',
  'organizational design': 'organizational_development', 'org design': 'organizational_development',
  'talent development director': 'organizational_development', 'executive coaching': 'organizational_development',
  'succession planning manager': 'organizational_development', 'prosci': 'organizational_development',
  'adkar': 'organizational_development', 'kotter change': 'organizational_development',
  
  // ==================== EMPLOYEE EXPERIENCE ALIASES ====================
  'employee experience': 'employee_experience', 'ex manager': 'employee_experience',
  'employee experience manager': 'employee_experience', 'employee engagement': 'employee_experience',
  'employee engagement manager': 'employee_experience', 'people experience': 'employee_experience',
  'workplace experience': 'employee_experience', 'culture manager': 'employee_experience',
  'culture director': 'employee_experience', 'evp manager': 'employee_experience',
  'employer branding': 'employee_experience', 'employer brand manager': 'employee_experience',
  'internal communications': 'employee_experience', 'employee listening': 'employee_experience',
  'dei manager': 'employee_experience', 'diversity and inclusion': 'employee_experience',
  'wellbeing manager': 'employee_experience', 'ex total rewards': 'employee_experience',
  'culture amp': 'employee_experience', 'glint': 'employee_experience', 'peakon': 'employee_experience',
  
  // ==================== HR ANALYTICS ALIASES ====================
  'hr analytics': 'hr_analytics', 'hr analytics manager': 'hr_analytics',
  'people analytics manager': 'hr_analytics', 'people analyst': 'hr_analytics',
  'workforce analytics': 'hr_analytics', 'workforce analytics manager': 'hr_analytics',
  'talent analytics': 'hr_analytics', 'talent analytics manager': 'hr_analytics',
  'hr data analyst': 'hr_analytics', 'people data analyst': 'hr_analytics',
  'hris analyst': 'hr_analytics', 'hr reporting': 'hr_analytics',
  'hr metrics': 'hr_analytics', 'hr dashboards': 'hr_analytics',
  'visier': 'hr_analytics', 'workday analyst': 'hr_analytics',
  'compensation analyst': 'hr_analytics', 'attrition modeling': 'hr_analytics',
  'predictive hr': 'hr_analytics', 'workforce planning analyst': 'hr_analytics',
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

// ==================== MOST RECENT ROLE EXTRACTION ====================
// Extracts the most recent job title and its surrounding context from the resume
// Used to give 2x-3x weight to title matches in the current/most recent role

interface MostRecentRole {
  title: string;
  section: string; // ~500 chars of context around the most recent role
  year: number | null;
}

function extractMostRecentRole(resumeText: string): MostRecentRole | null {
  const lines = resumeText.split(/\r?\n/);
  const currentYear = new Date().getFullYear();
  
  // Strategy 1: Find "Present/Current" role — strongest signal
  // Look for lines with "present", "current", "now" in date context
  const presentPatterns = [
    /\b(20\d{2})\s*[-–—]\s*(present|current|now)\b/i,
    /\b(present|current)\b.*\b(20\d{2})\b/i,
  ];
  
  let bestRoleLineIdx = -1;
  let bestYear = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of presentPatterns) {
      const match = line.match(pattern);
      if (match) {
        bestRoleLineIdx = i;
        bestYear = currentYear;
        break;
      }
    }
    if (bestRoleLineIdx >= 0) break;
  }
  
  // Strategy 2: Find the most recent year in a date range (e.g., "2023 - 2025")
  if (bestRoleLineIdx < 0) {
    const dateRangePattern = /\b(20\d{2})\s*[-–—]\s*(20\d{2})\b/;
    let latestEndYear = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(dateRangePattern);
      if (match) {
        const endYear = parseInt(match[2], 10);
        if (endYear > latestEndYear) {
          latestEndYear = endYear;
          bestRoleLineIdx = i;
          bestYear = endYear;
        }
      }
    }
  }
  
  // Strategy 3: Find the first role after "Experience" section header
  if (bestRoleLineIdx < 0) {
    const expHeaderIdx = lines.findIndex(l => 
      /\b(professional\s+experience|experience|work\s+history|employment)\b/i.test(l)
    );
    if (expHeaderIdx >= 0 && expHeaderIdx + 1 < lines.length) {
      bestRoleLineIdx = expHeaderIdx + 1;
      bestYear = currentYear;
    }
  }
  
  if (bestRoleLineIdx < 0) return null;
  
  // Extract the title: look at the role line and nearby lines (title is often 1-2 lines above or on the date line)
  // Scan from bestRoleLineIdx backwards up to 3 lines for a title-like line
  let titleLine = '';
  const searchStart = Math.max(0, bestRoleLineIdx - 3);
  const searchEnd = Math.min(lines.length - 1, bestRoleLineIdx + 2);
  
  // Common title patterns: "Senior Software Engineer", "Account Executive", etc.
  const titleRegex = /\b(senior|lead|principal|staff|chief|head|director|manager|vp|associate|junior|founding)\b/i;
  const jobTitleRegex = /\b(engineer|developer|designer|analyst|manager|director|executive|specialist|coordinator|consultant|architect|scientist|officer|administrator|recruiter|attorney|nurse|teacher|accountant|sales|marketing|product)\b/i;
  
  for (let i = searchStart; i <= searchEnd; i++) {
    const line = lines[i].trim();
    if (line.length > 5 && line.length < 120 && (titleRegex.test(line) || jobTitleRegex.test(line))) {
      // Prefer lines that look like titles (not date-only lines, not bullet points)
      if (!/^[•\-*·▪►◦➤]/.test(line) && !/^\d+\./.test(line)) {
        titleLine = line;
        break;
      }
    }
  }
  
  // If no clear title found, use the line itself
  if (!titleLine) {
    titleLine = lines[bestRoleLineIdx].trim();
  }
  
  // Extract ~500 chars of context around the most recent role
  const contextStart = Math.max(0, bestRoleLineIdx - 2);
  // Find the next role (next date range) or take 15 lines
  let contextEnd = Math.min(lines.length, bestRoleLineIdx + 15);
  for (let i = bestRoleLineIdx + 2; i < contextEnd; i++) {
    // Stop at the next role's date range
    if (/\b(20\d{2}|19\d{2})\s*[-–—]\s*(20\d{2}|19\d{2}|present|current)/i.test(lines[i]) && i > bestRoleLineIdx + 1) {
      contextEnd = i;
      break;
    }
  }
  
  const section = lines.slice(contextStart, contextEnd).join('\n').substring(0, 800);
  
  console.log(`[RECENT-ROLE] Extracted most recent role: "${titleLine.substring(0, 80)}" (year: ${bestYear})`);
  
  return {
    title: titleLine,
    section,
    year: bestYear || null
  };
}

function detectIndustryFromResume(resumeText: string): IndustryDetectionResult {
  // Normalize text with abbreviation expansion for fuzzy matching
  const normalizedText = normalizeResumeText(resumeText);
  const text = normalizedText.toLowerCase();
  const signals: string[] = [];
  
  // ==================== MOST RECENT ROLE EXTRACTION ====================
  // Extract the most recent role to apply recency weighting
  const mostRecentRole = extractMostRecentRole(resumeText);
  const recentRoleText = mostRecentRole ? normalizeResumeText(mostRecentRole.section).toLowerCase() : '';
  const recentRoleTitle = mostRecentRole ? normalizeResumeText(mostRecentRole.title).toLowerCase() : '';
  
  if (mostRecentRole) {
    signals.push(`Most recent role: "${mostRecentRole.title.substring(0, 60)}"`);
  }
  
  // ==================== KEYWORD DENSITY SCORING ====================
  // Count industry-specific keywords for fallback detection
  const keywordDensityScores = calculateKeywordDensity(text);
  
  // ==================== DEFINITIVE CERTIFICATIONS ====================
  // These certifications are DEFINITIVE industry signals with very high weight (100+)
  // If found, they should strongly influence or override other signals
  const definitiveCertifications: { pattern: RegExp; industry: string; weight: number; name: string }[] = [
    // Healthcare / Nursing - DEFINITIVE
    { pattern: /\b(registered\s+nurse|rn\b(?!\s*manager)|r\.n\.|bsn|msn|nurse\s+practitioner|np\b|lpn|lvn|cna)\b/i, industry: 'nursing', weight: 120, name: 'Nursing License (RN/LPN/NP)' },
    { pattern: /\b(nclex|nursing\s+license|nursing\s+certification)\b/i, industry: 'nursing', weight: 100, name: 'NCLEX/Nursing Certification' },
    { pattern: /\b(md\b|m\.d\.|doctor\s+of\s+medicine|physician)\b/i, industry: 'physician', weight: 120, name: 'MD/Physician' },
    { pattern: /\b(pharmd|pharm\.d\.|pharmacist|pharmacy\s+license)\b/i, industry: 'pharmacy', weight: 120, name: 'PharmD/Pharmacist' },
    
    // Finance - DEFINITIVE
    { pattern: /\b(cpa\b|c\.p\.a\.|certified\s+public\s+accountant)\b/i, industry: 'accounting', weight: 120, name: 'CPA' },
    { pattern: /\b(cfa\b|c\.f\.a\.|chartered\s+financial\s+analyst)\b/i, industry: 'investment_banking', weight: 110, name: 'CFA' },
    { pattern: /\b(cfp\b|c\.f\.p\.|certified\s+financial\s+planner)\b/i, industry: 'wealth_management', weight: 110, name: 'CFP' },
    { pattern: /\b(cma\b(?!\s+awards)|certified\s+management\s+accountant)\b/i, industry: 'finance', weight: 100, name: 'CMA' },
    { pattern: /\b(series\s+(7|63|65|66)\b|finra\s+license)\b/i, industry: 'finance', weight: 90, name: 'FINRA Series License' },
    { pattern: /\b(frm\b|financial\s+risk\s+manager)\b/i, industry: 'risk_management', weight: 100, name: 'FRM' },
    
    // Legal - DEFINITIVE
    { pattern: /\b(j\.?d\.?\b|juris\s+doctor|bar\s+admission|bar\s+exam|admitted\s+to\s+the\s+bar|attorney\s+at\s+law|esq\.?\b)\b/i, industry: 'legal', weight: 120, name: 'JD/Bar Admission' },
    { pattern: /\b(paralegal\s+certification|certified\s+paralegal|cp\b.*paralegal|pace)\b/i, industry: 'legal', weight: 90, name: 'Paralegal Certification' },
    
    // HR - DEFINITIVE  
    { pattern: /\b(shrm[\s-]?(cp|scp)|sphr|phr\b|shrm\s+certified)\b/i, industry: 'hr', weight: 100, name: 'SHRM/PHR Certification' },
    
    // Project Management - DEFINITIVE
    { pattern: /\b(pmp\b|p\.m\.p\.|project\s+management\s+professional)\b/i, industry: 'project_management', weight: 100, name: 'PMP' },
    { pattern: /\b(prince2|six\s+sigma\s+(black|green)\s+belt|lean\s+six\s+sigma)\b/i, industry: 'operations', weight: 90, name: 'Six Sigma/PRINCE2' },
    { pattern: /\b(csm\b|certified\s+scrum\s+master|psm\s+i|safe\s+agilist)\b/i, industry: 'project_management', weight: 80, name: 'Scrum/Agile Certification' },
    
    // Cybersecurity - DEFINITIVE
    { pattern: /\b(cissp|cism|cisa|ceh|oscp|security\+|comptia\s+security)\b/i, industry: 'cybersecurity', weight: 110, name: 'CISSP/CISM/CEH' },
    { pattern: /\b(ccna|ccnp|ccie|network\+|comptia\s+network)\b/i, industry: 'network_engineering', weight: 100, name: 'Cisco/CompTIA Network' },
    
    // Cloud/Tech - DEFINITIVE
    { pattern: /\b(aws\s+(certified|solutions\s+architect|developer|sysops)|ccp|saa-c0[23])\b/i, industry: 'cloud_security', weight: 90, name: 'AWS Certification' },
    { pattern: /\b(azure\s+(administrator|developer|architect)|az-\d{3})\b/i, industry: 'cloud_security', weight: 90, name: 'Azure Certification' },
    { pattern: /\b(gcp\s+(certified|professional)|google\s+cloud\s+(certified|professional))\b/i, industry: 'cloud_security', weight: 90, name: 'GCP Certification' },
    
    // Real Estate - DEFINITIVE
    { pattern: /\b(real\s+estate\s+license|realtor\b|broker\s+license|licensed\s+real\s+estate)\b/i, industry: 'real_estate', weight: 110, name: 'Real Estate License' },
    
    // Education - DEFINITIVE
    { pattern: /\b(teaching\s+(license|certificate|credential)|state\s+teaching\s+certificate|certified\s+teacher)\b/i, industry: 'k12_education', weight: 110, name: 'Teaching License' },
    { pattern: /\b(tesol|tefl|celta|delta)\b/i, industry: 'education', weight: 90, name: 'TESOL/TEFL' },
    
    // Insurance - DEFINITIVE
    { pattern: /\b(insurance\s+license|licensed\s+insurance|cpcu|alu|clcs)\b/i, industry: 'insurance', weight: 100, name: 'Insurance License' },
    
    // Medical/Clinical - DEFINITIVE
    { pattern: /\b(board\s+certified|abms|medical\s+license|dea\s+license)\b/i, industry: 'healthcare', weight: 100, name: 'Medical Board Certification' },
    { pattern: /\b(pt\b.*license|dpt|physical\s+therapist)\b/i, industry: 'physical_therapy', weight: 110, name: 'PT License' },
    { pattern: /\b(ot\b.*license|otr|occupational\s+therapist)\b/i, industry: 'occupational_therapy', weight: 110, name: 'OT License' },
    
    // Actuarial - DEFINITIVE
    { pattern: /\b(fsa|asa|fcas|acas|actuarial\s+(fellow|associate))\b/i, industry: 'actuarial', weight: 120, name: 'Actuarial Credential' },
  ];
  
  // Check for definitive certifications FIRST
  let certificationBoost: { industry: string; weight: number; signal: string } | null = null;
  for (const cert of definitiveCertifications) {
    if (cert.pattern.test(text)) {
      if (!certificationBoost || cert.weight > certificationBoost.weight) {
        certificationBoost = { 
          industry: cert.industry, 
          weight: cert.weight, 
          signal: `Definitive certification: ${cert.name}` 
        };
      }
    }
  }
  
  if (certificationBoost) {
    signals.push(certificationBoost.signal);
    console.log(`[INDUSTRY-DETECT] ${certificationBoost.signal} -> ${certificationBoost.industry} (+${certificationBoost.weight})`);
  }

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
        // Sales methodologies - CRITICAL for detection
        'meddpicc', 'meddic', 'spin selling', 'challenger sale', 'challenger sales',
        'sandler', 'solution selling', 'consultative selling', 'value selling',
        'command of the message', 'command of the sale', 'force management',
        'gap selling', 'miller heiman', 'strategic selling', 'conceptual selling',
        // Revenue metrics - CRITICAL for detection
        'arr', 'acv', 'mrr', 'tcv', 'atr', 'revenue', 'annual recurring revenue',
        'annual contract value', 'monthly recurring revenue', 'total contract value',
        'net revenue retention', 'nrr', 'gross revenue retention', 'grr',
        // Quota and performance
        'quota attainment', 'quota', 'exceeded quota', 'beat quota', 'over quota',
        '100% of quota', '150% quota', '200% quota', 'presidents club', "president's club",
        'top performer', 'top 10%', 'top rep', '#1 rep',
        // Sales process
        'enterprise sales', 'strategic accounts', 'salesforce', 'c-suite',
        'stakeholder management', 'contract negotiation', 'complex sales',
        'saas', 'multi-threading', 'champion building', 'executive sponsorship',
        'deal desk', 'pricing', 'commercial negotiation', 'procurement',
        'land and expand', 'expansion revenue', 'upsell', 'cross-sell',
        // Tools
        'salesforce', 'hubspot', 'gong', 'chorus', 'outreach', 'salesloft',
        'clari', 'linkedin sales navigator', 'zoominfo', 'clearbit', 'apollo'
      ],
      contextPatterns: [
        /\b(closed|won|managed)\s+.*\$[\d,]+[mMkK]\s*(deal|contract|account)/i,
        /\b(exceeded|achieved|surpassed)\s+.*\b(quota|target|goal)\s+by\s+\d+%/i,
        /\b\d+x\s+quota\b/i,
        /\b(arr|acv|mrr)\s+of\s+\$[\d,]+[kKmM]/i,
        /\$[\d,]+[kKmM]\+?\s+(arr|acv|mrr|revenue|pipeline)/i,
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
        /\b(account\s+executive|ae|sales\s+representative|sales\s+manager)\b/,
      ],
      skillPatterns: [
        // Sales methodologies - CRITICAL
        'meddpicc', 'meddic', 'spin selling', 'challenger sale', 'challenger',
        'sandler', 'solution selling', 'consultative selling', 'value selling',
        // Revenue metrics - CRITICAL
        'arr', 'acv', 'mrr', 'revenue', 'quota', 'quota attainment',
        // BD-specific
        'partnerships', 'alliances', 'channel sales', 'reseller', 'referral',
        'prospecting', 'lead generation', 'market development', 'new business',
        'territory', 'expansion', 'pipeline', 'networking',
        // Sales process
        'cold calling', 'outbound', 'discovery calls', 'demos', 'closing',
        'negotiation', 'stakeholder management', 'executive selling',
        // Tools
        'salesforce', 'hubspot', 'linkedin sales navigator', 'outreach', 'salesloft'
      ],
      contextPatterns: [
        /\b(developed|established|built)\s+.*\b(partnerships?|relationships?|channels?)\b/i,
        /\b(grew|expanded|launched)\s+.*\b(territory|market|region)\b/i,
        /\b(exceeded|surpassed|beat)\s+.*\bquota\b/i,
        /\$[\d,]+[kKmM]\+?\s+(arr|acv|mrr|revenue|pipeline)/i,
        /\b\d+%\s+(of|over|above)\s+quota\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 35
    },
    
    // === SUB-INDUSTRIES FOR MARKETING ===
    // General marketing catch-all for generic marketing titles (intern, coordinator, etc.)
    general_marketing: {
      titlePatterns: [
        /\b(marketing\s+intern|marketing\s+assistant|marketing\s+associate)\b/i,
        /\b(marketing\s+coordinator|marketing\s+specialist|marketing\s+analyst)\b/i,
        /\b(marketing\s+manager|marketing\s+director|vp\s+of\s+marketing)\b/i,
        /\b(head\s+of\s+marketing|chief\s+marketing\s+officer|cmo)\b/i,
        /\b(marketing\s+executive|marketing\s+officer|marketing\s+lead)\b/i,
        /\b(intern,?\s+marketing|intern\s*[-–—]\s*marketing)\b/i,
      ],
      skillPatterns: [
        'marketing', 'social media', 'campaign', 'brand', 'content creation',
        'email marketing', 'marketing strategy', 'market research', 'advertising',
        'public relations', 'pr', 'communications', 'engagement', 'analytics',
        'canva', 'mailchimp', 'hootsuite', 'buffer', 'sprout social'
      ],
      contextPatterns: [
        /\b(developed|created|managed|executed)\s+.*\b(marketing|campaign|social\s+media|brand)\b/i,
        /\b(increased|grew|improved)\s+.*\b(engagement|followers|reach|awareness|traffic)\b/i,
        /\b(marketing\s+event|marketing\s+campaign|marketing\s+initiative|marketing\s+material)\b/i,
      ],
      minSkillsForHigh: 2,
      titleWeight: 40
    },
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
        /\b(growth\s+marketing\s+manager|growth\s+lead|head\s+of\s+growth)\b/i,
        /\b(demand\s+generation|demand\s+gen|lifecycle\s+marketing)\b/i,
        /\b(performance\s+marketing|acquisition\s+marketing|cro\s+manager)\b/i,
        /\b(growth\s+manager|director.*growth)\b/i,
      ],
      skillPatterns: [
        'growth marketing', 'user acquisition', 'conversion optimization', 'a/b testing',
        'funnel optimization', 'paid acquisition', 'seo', 'sem', 'facebook ads',
        'google ads', 'linkedin ads', 'cac', 'ltv', 'retention', 'activation',
        'aarrr', 'product-led growth', 'viral loops', 'referral programs',
        'email marketing', 'lifecycle marketing', 'mixpanel', 'amplitude', 'segment',
        'experimentation', 'demand generation', 'lead generation', 'marketing automation',
        'hubspot', 'marketo', 'attribution'
      ],
      contextPatterns: [
        /\b(grew|increased|scaled)\s+.*\b(user|customer|acquisition|conversion|retention)\b/i,
        /\b(reduced|optimized|improved)\s+.*\b(cac|cost|funnel|churn)\b/i,
        /\b(launched|built|managed)\s+.*\b(campaign|experiment|test|growth)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 45
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
        // Require hospitality/venue context — not just any mention of "event"
        /\b(planned|coordinated|managed)\s+.*\b(wedding|conference|banquet|gala|reception|trade\s+show)\b/i,
        /\b(executed|delivered)\s+.*\b(wedding|banquet|gala|reception|corporate\s+function)\b/i,
        /\b(venue|catering|seating\s+chart|floor\s+plan|decor|centerpiece)\b/i,
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
    
    // === SPECIALIZED SUB-INDUSTRIES ===
    supply_chain_analytics: {
      titlePatterns: [
        /\b(supply\s+chain\s+analyst|demand\s+planning|demand\s+planner)\b/i,
        /\b(supply\s+chain\s+analytics|inventory\s+analyst|procurement\s+analyst)\b/i,
        /\b(s&op\s+manager|s&op\s+analyst|forecast\s+analyst)\b/i,
        /\b(logistics\s+analyst|supply\s+chain\s+data|scm\s+analyst)\b/i,
      ],
      skillPatterns: [
        'demand forecasting', 'inventory optimization', 'supply chain modeling',
        's&op', 'sales and operations planning', 'network optimization',
        'demand planning', 'supply planning', 'safety stock', 'lead time',
        'sql', 'python', 'tableau', 'power bi', 'sap', 'oracle scm',
        'blue yonder', 'kinaxis', 'llamasoft', 'statistical modeling',
        'cpim', 'cscp', 'apics', 'kpi dashboards', 'cost-to-serve'
      ],
      contextPatterns: [
        /\b(reduced|improved|optimized)\s+.*\b(inventory|forecast|demand|supply)\b/i,
        /\b(built|developed)\s+.*\b(forecasting|analytics|model|dashboard)\b/i,
        /\b(s&op|sales\s+and\s+operations\s+planning|demand\s+planning)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    sports_management: {
      titlePatterns: [
        /\b(sports\s+marketing|athletic\s+director|sports\s+manager)\b/i,
        /\b(athlete\s+management|sports\s+agent|player\s+personnel)\b/i,
        /\b(sports\s+business|team\s+operations|sports\s+operations)\b/i,
        /\b(ticket\s+sales.*sports|sponsorship.*sports|esports\s+manager)\b/i,
      ],
      skillPatterns: [
        'athlete management', 'sports marketing', 'sponsorship', 'ticket sales',
        'fan engagement', 'ncaa compliance', 'ncaa', 'contract negotiation',
        'media relations', 'brand management', 'event operations', 'sports analytics',
        'partnership development', 'revenue generation', 'crm', 'salesforce',
        'game day operations', 'broadcast rights', 'merchandise', 'player development'
      ],
      contextPatterns: [
        /\b(managed|negotiated)\s+.*\b(athlete|player|team|sponsorship|contract)\b/i,
        /\b(increased|grew)\s+.*\b(ticket|attendance|revenue|fan|sponsorship)\b/i,
        /\b(sports|athletic|ncaa|professional\s+team|esports)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    ux_research: {
      titlePatterns: [
        /\b(ux\s+researcher|user\s+researcher|design\s+researcher)\b/i,
        /\b(usability\s+researcher|user\s+experience\s+researcher)\b/i,
        /\b(research\s+lead.*ux|senior\s+.*researcher.*user)\b/i,
        /\b(human\s+factors|hci\s+researcher|customer\s+insights\s+researcher)\b/i,
      ],
      skillPatterns: [
        'user research', 'usability testing', 'user interviews', 'a/b testing',
        'journey mapping', 'personas', 'surveys', 'card sorting', 'tree testing',
        'eye tracking', 'heuristic evaluation', 'affinity mapping', 'usertesting',
        'optimal workshop', 'dovetail', 'lookback', 'maze', 'figma', 'miro',
        'qualitative analysis', 'quantitative research', 'research repository',
        'accessibility', 'wcag', 'research synthesis', 'moderated testing'
      ],
      contextPatterns: [
        /\b(conducted|led|performed)\s+.*\b(user|usability|research|interviews|testing)\b/i,
        /\b(synthesized|analyzed)\s+.*\b(research|user|qualitative|quantitative)\s+.*\b(findings|data|insights)\b/i,
        /\b(created|developed)\s+.*\b(personas|journey\s+maps|research\s+reports)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    product_analytics: {
      titlePatterns: [
        /\b(product\s+analyst|product\s+analytics)\b/i,
        /\b(growth\s+analyst|analytics\s+engineer|data\s+product)\b/i,
        /\b(experimentation\s+analyst|business\s+intelligence.*product)\b/i,
        /\b(senior\s+analyst.*product|product\s+data\s+scientist)\b/i,
      ],
      skillPatterns: [
        'product analytics', 'amplitude', 'mixpanel', 'segment', 'funnel analysis',
        'cohort analysis', 'retention analysis', 'user segmentation', 'a/b testing',
        'experimentation', 'sql', 'python', 'looker', 'tableau', 'mode', 'dbt',
        'heap', 'event tracking', 'kpis', 'okrs', 'ltv', 'churn analysis',
        'feature adoption', 'product-led growth', 'data storytelling', 'statistical significance'
      ],
      contextPatterns: [
        /\b(analyzed|measured|tracked)\s+.*\b(product|user|feature|funnel|cohort)\s+.*\b(metrics|performance|adoption)\b/i,
        /\b(built|developed|created)\s+.*\b(dashboards|reports|analytics|experimentation)\b/i,
        /\b(increased|improved)\s+.*\b(retention|conversion|engagement|activation)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    technical_writing: {
      titlePatterns: [
        /\b(technical\s+writer|tech\s+writer|documentation\s+specialist)\b/i,
        /\b(api\s+writer|content\s+developer|information\s+developer)\b/i,
        /\b(knowledge\s+management.*specialist|documentation\s+engineer)\b/i,
        /\b(senior\s+technical\s+writer|lead\s+technical\s+writer)\b/i,
      ],
      skillPatterns: [
        'technical documentation', 'api documentation', 'user guides', 'knowledge base',
        'release notes', 'dita', 'markdown', 'confluence', 'swagger', 'openapi',
        'git', 'madcap flare', 'adobe framemaker', 'readme', 'docusaurus',
        'style guides', 'information architecture', 'content strategy', 'single sourcing',
        'topic-based authoring', 'jira', 'agile', 'sme interviews', 'editing'
      ],
      contextPatterns: [
        /\b(wrote|authored|created|developed)\s+.*\b(documentation|guides|manuals|api\s+docs)\b/i,
        /\b(maintained|managed)\s+.*\b(knowledge\s+base|documentation|wiki|confluence)\b/i,
        /\b(collaborated|worked)\s+.*\b(engineers|developers|smes|product)\s+.*\b(document|technical)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    data_engineering: {
      titlePatterns: [
        /\b(data\s+engineer|data\s+engineering)\b/i,
        /\b(etl\s+developer|etl\s+engineer|data\s+pipeline\s+engineer)\b/i,
        /\b(big\s+data\s+engineer|analytics\s+engineer|data\s+platform)\b/i,
        /\b(data\s+infrastructure|senior\s+data\s+engineer)\b/i,
      ],
      skillPatterns: [
        'data pipelines', 'etl', 'apache spark', 'spark', 'airflow', 'sql', 'python',
        'dbt', 'snowflake', 'databricks', 'bigquery', 'redshift', 'kafka',
        'data warehouse', 'data lake', 'data modeling', 'dimensional modeling',
        'stream processing', 'batch processing', 'aws glue', 'fivetran', 'prefect',
        'luigi', 'data quality', 'schema design', 'orchestration', 'ci/cd'
      ],
      contextPatterns: [
        /\b(built|developed|designed)\s+.*\b(data\s+pipeline|etl|data\s+warehouse|data\s+lake)\b/i,
        /\b(migrated|optimized)\s+.*\b(data|warehouse|database|infrastructure)\b/i,
        /\b(processed|transformed)\s+.*\b(terabytes|petabytes|millions|billions)\s+.*\b(records|rows|data)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    devrel: {
      titlePatterns: [
        /\b(developer\s+advocate|developer\s+relations|devrel)\b/i,
        /\b(developer\s+evangelist|tech\s+evangelist)\b/i,
        /\b(developer\s+experience|dx\s+engineer)\b/i,
        /\b(community\s+manager.*tech|developer\s+community)\b/i,
      ],
      skillPatterns: [
        'developer advocacy', 'technical content', 'developer experience', 'api documentation',
        'community building', 'technical presentations', 'conference speaking', 'sdk development',
        'code samples', 'developer onboarding', 'github', 'open source', 'technical writing',
        'video content', 'twitch', 'youtube', 'discord', 'slack community', 'hackathons',
        'developer feedback', 'tutorials', 'blog posts', 'meetups'
      ],
      contextPatterns: [
        /\b(grew|built|managed)\s+.*\b(developer|community|discord|slack)\s+.*\b(community|members|engagement)\b/i,
        /\b(spoke|presented)\s+.*\b(conference|meetup|event|webinar)\b/i,
        /\b(created|wrote)\s+.*\b(tutorial|documentation|sdk|sample|demo)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    content_strategy: {
      titlePatterns: [
        /\b(content\s+strategist|content\s+strategy)\b/i,
        /\b(editorial\s+strategist|content\s+lead)\b/i,
        /\b(content\s+operations|ux\s+writer)\b/i,
        /\b(senior\s+content\s+strategist|head\s+of\s+content)\b/i,
      ],
      skillPatterns: [
        'content strategy', 'content audit', 'editorial calendar', 'content governance',
        'information architecture', 'content modeling', 'ux writing', 'voice and tone',
        'style guide', 'seo', 'cms', 'contentful', 'sanity', 'wordpress',
        'content operations', 'taxonomy', 'metadata', 'content performance',
        'analytics', 'stakeholder management', 'content localization', 'a/b testing',
        'user research', 'content migration'
      ],
      contextPatterns: [
        /\b(developed|created|defined)\s+.*\b(content\s+strategy|editorial\s+calendar|style\s+guide)\b/i,
        /\b(led|managed)\s+.*\b(content\s+audit|content\s+migration|content\s+team)\b/i,
        /\b(improved|increased)\s+.*\b(engagement|traffic|conversion)\s+.*\b(content|copy)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    customer_success: {
      titlePatterns: [
        /\b(customer\s+success\s+manager|csm|client\s+success)\b/i,
        /\b(customer\s+success\s+lead|head\s+of\s+customer\s+success)\b/i,
        /\b(account\s+manager|customer\s+experience\s+manager)\b/i,
        /\b(senior\s+csm|enterprise\s+csm|strategic\s+csm)\b/i,
      ],
      skillPatterns: [
        'customer success', 'customer retention', 'churn prevention', 'onboarding',
        'nps', 'customer health score', 'qbrs', 'renewal management', 'upselling',
        'cross-selling', 'gainsight', 'totango', 'churnzero', 'salesforce',
        'customer advocacy', 'stakeholder management', 'expansion revenue',
        'customer journey', 'product adoption', 'time to value', 'playbooks'
      ],
      contextPatterns: [
        /\b(managed|owned)\s+.*\b(portfolio|accounts|customers|clients)\b/i,
        /\b(reduced|prevented|decreased)\s+.*\b(churn|attrition)\b/i,
        /\b(increased|grew|drove)\s+.*\b(retention|renewal|expansion|nps)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    revenue_operations: {
      titlePatterns: [
        /\b(revenue\s+operations|revops|revenue\s+ops)\b/i,
        /\b(sales\s+operations|sales\s+ops)\b/i,
        /\b(go-to-market\s+operations|gtm\s+operations)\b/i,
        /\b(director.*revenue\s+operations|head\s+of\s+revops)\b/i,
      ],
      skillPatterns: [
        'revenue operations', 'sales operations', 'pipeline management', 'forecasting',
        'salesforce', 'hubspot', 'crm administration', 'territory planning',
        'quota setting', 'commission plans', 'sales enablement', 'gtm strategy',
        'clari', 'gong', 'outreach', 'salesloft', 'deal desk', 'cpq',
        'lead scoring', 'attribution', 'funnel optimization', 'data hygiene',
        'process automation', 'revenue analytics'
      ],
      contextPatterns: [
        /\b(built|designed|implemented)\s+.*\b(sales\s+process|pipeline|forecasting|crm)\b/i,
        /\b(improved|optimized)\s+.*\b(pipeline|conversion|quota|territory)\b/i,
        /\b(managed|administered)\s+.*\b(salesforce|hubspot|crm|sales\s+tools)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    solutions_architecture: {
      titlePatterns: [
        /\b(solutions?\s+architect|enterprise\s+architect)\b/i,
        /\b(cloud\s+architect|technical\s+architect)\b/i,
        /\b(pre[\s-]?sales\s+engineer|presales\s+architect)\b/i,
        /\b(principal\s+architect|senior\s+.*architect)\b/i,
      ],
      skillPatterns: [
        'solutions architecture', 'enterprise architecture', 'cloud architecture',
        'aws', 'azure', 'gcp', 'technical discovery', 'architecture diagrams',
        'poc', 'proof of concept', 'rfp response', 'technical sales',
        'stakeholder management', 'microservices', 'api design', 'system integration',
        'scalability', 'high availability', 'disaster recovery', 'togaf',
        'well-architected', 'cost optimization', 'migration strategy', 'terraform', 'kubernetes'
      ],
      contextPatterns: [
        /\b(designed|architected)\s+.*\b(solution|system|platform|infrastructure)\b/i,
        /\b(led|conducted)\s+.*\b(technical\s+discovery|poc|proof\s+of\s+concept)\b/i,
        /\b(migrated|transformed)\s+.*\b(cloud|aws|azure|gcp)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    security_engineering: {
      titlePatterns: [
        /\b(security\s+engineer|security\s+architect)\b/i,
        /\b(appsec|application\s+security)\b/i,
        /\b(penetration\s+tester|pentest|devsecops)\b/i,
        /\b(infosec|information\s+security)\b/i,
      ],
      skillPatterns: [
        'security engineering', 'application security', 'penetration testing',
        'vulnerability assessment', 'siem', 'owasp', 'threat modeling',
        'security automation', 'cissp', 'ceh', 'soc 2', 'iso 27001',
        'incident response', 'security architecture', 'identity management',
        'zero trust', 'encryption', 'splunk', 'crowdstrike', 'burp suite',
        'nessus', 'cloud security', 'devsecops', 'code review'
      ],
      contextPatterns: [
        /\b(conducted|performed)\s+.*\b(penetration\s+test|security\s+assessment|vulnerability)\b/i,
        /\b(implemented|built)\s+.*\b(security|siem|monitoring|detection)\b/i,
        /\b(achieved|maintained)\s+.*\b(soc\s+2|iso|compliance|certification)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    ml_engineering: {
      titlePatterns: [
        /\b(ml\s+engineer|machine\s+learning\s+engineer)\b/i,
        /\b(mlops|ai\s+engineer|deep\s+learning\s+engineer)\b/i,
        /\b(ml\s+infrastructure|ml\s+platform)\b/i,
        /\b(senior\s+ml\s+engineer|staff\s+ml\s+engineer)\b/i,
      ],
      skillPatterns: [
        'machine learning', 'deep learning', 'mlops', 'tensorflow', 'pytorch',
        'python', 'model training', 'model deployment', 'feature engineering',
        'model monitoring', 'kubeflow', 'mlflow', 'sagemaker', 'vertex ai',
        'data pipelines', 'gpu computing', 'distributed training', 'a/b testing',
        'experiment tracking', 'model registry', 'inference optimization',
        'hugging face', 'transformers', 'llms'
      ],
      contextPatterns: [
        /\b(built|deployed|trained)\s+.*\b(model|ml|machine\s+learning|deep\s+learning)\b/i,
        /\b(optimized|improved)\s+.*\b(inference|latency|accuracy|model)\b/i,
        /\b(implemented|developed)\s+.*\b(mlops|pipeline|feature|training)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    business_intelligence: {
      titlePatterns: [
        /\b(bi\s+analyst|bi\s+developer|bi\s+engineer)\b/i,
        /\b(business\s+intelligence\s+analyst|business\s+intelligence\s+developer)\b/i,
        /\b(reporting\s+analyst|data\s+visualization\s+analyst)\b/i,
        /\b(analytics\s+engineer|senior\s+bi\s+analyst)\b/i,
      ],
      skillPatterns: [
        'business intelligence', 'tableau', 'power bi', 'data visualization',
        'sql', 'etl', 'data warehousing', 'looker', 'snowflake', 'dashboards',
        'kpi reporting', 'data modeling', 'dimensional modeling', 'dax', 'olap',
        'qlik', 'redshift', 'bigquery', 'dbt', 'data governance',
        'self-service analytics', 'ad hoc reporting', 'executive reporting'
      ],
      contextPatterns: [
        /\b(built|created|developed)\s+.*\b(dashboard|report|visualization|bi\s+solution)\b/i,
        /\b(designed|implemented)\s+.*\b(data\s+model|warehouse|etl|pipeline)\b/i,
        /\b(delivered|provided)\s+.*\b(insights|analytics|reporting|kpis)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    platform_engineering: {
      titlePatterns: [
        /\b(platform\s+engineer|infrastructure\s+engineer)\b/i,
        /\b(developer\s+experience|devex\s+engineer)\b/i,
        /\b(internal\s+developer\s+platform|idp\s+engineer)\b/i,
        /\b(senior\s+platform\s+engineer|staff\s+platform\s+engineer)\b/i,
      ],
      skillPatterns: [
        'platform engineering', 'kubernetes', 'developer experience', 'internal developer platform',
        'infrastructure as code', 'terraform', 'ci/cd', 'gitops', 'argocd', 'helm',
        'docker', 'aws', 'gcp', 'azure', 'backstage', 'service mesh', 'observability',
        'golden paths', 'self-service infrastructure', 'platform apis', 'crossplane',
        'pulumi', 'sre', 'developer productivity'
      ],
      contextPatterns: [
        /\b(built|designed|implemented)\s+.*\b(platform|idp|developer\s+experience|infrastructure)\b/i,
        /\b(reduced|improved)\s+.*\b(deployment|developer\s+productivity|time\s+to\s+production)\b/i,
        /\b(enabled|created)\s+.*\b(self-service|golden\s+path|paved\s+road)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    quantitative_finance: {
      titlePatterns: [
        /\b(quant|quantitative\s+analyst|quant\s+analyst)\b/i,
        /\b(quant\s+developer|quant\s+researcher)\b/i,
        /\b(algorithmic\s+trader|systematic\s+trader)\b/i,
        /\b(financial\s+engineer|quantitative\s+trader)\b/i,
      ],
      skillPatterns: [
        'quantitative analysis', 'python', 'statistical modeling', 'machine learning',
        'risk modeling', 'time series analysis', 'monte carlo', 'derivatives pricing',
        'bloomberg', 'c++', 'sql', 'backtesting', 'alpha generation',
        'portfolio optimization', 'var', 'greeks', 'stochastic calculus',
        'black-scholes', 'r', 'matlab', 'pandas', 'numpy',
        'execution algorithms', 'market microstructure'
      ],
      contextPatterns: [
        /\b(developed|built|implemented)\s+.*\b(trading\s+strategy|quant\s+model|pricing\s+model|risk\s+model)\b/i,
        /\b(generated|achieved)\s+.*\b(alpha|sharpe|returns|pnl)\b/i,
        /\b(optimized|backtested)\s+.*\b(portfolio|strategy|algorithm)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    product_design: {
      titlePatterns: [
        /\b(product\s+designer|ux\s+designer|ui\s+designer)\b/i,
        /\b(ux\/ui\s+designer|ui\/ux\s+designer)\b/i,
        /\b(design\s+lead|senior\s+product\s+designer)\b/i,
        /\b(staff\s+designer|principal\s+designer)\b/i,
      ],
      skillPatterns: [
        'product design', 'figma', 'user research', 'design systems', 'prototyping',
        'user experience', 'wireframing', 'usability testing', 'interaction design',
        'visual design', 'design thinking', 'a/b testing', 'sketch', 'adobe xd',
        'invision', 'accessibility', 'mobile design', 'responsive design',
        'information architecture', 'user flows', 'journey mapping'
      ],
      contextPatterns: [
        /\b(designed|created|led)\s+.*\b(product|feature|experience|interface)\b/i,
        /\b(conducted|led)\s+.*\b(user\s+research|usability\s+testing|design\s+sprint)\b/i,
        /\b(built|established)\s+.*\b(design\s+system|component\s+library|style\s+guide)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    sre: {
      titlePatterns: [
        /\b(site\s+reliability\s+engineer|sre)\b/i,
        /\b(reliability\s+engineer|production\s+engineer)\b/i,
        /\b(infrastructure\s+reliability|platform\s+reliability)\b/i,
        /\b(senior\s+sre|staff\s+sre)\b/i,
      ],
      skillPatterns: [
        'site reliability engineering', 'kubernetes', 'monitoring', 'incident response',
        'on-call', 'slos', 'slis', 'error budgets', 'observability',
        'prometheus', 'grafana', 'datadog', 'terraform', 'aws', 'gcp',
        'linux', 'python', 'go', 'postmortem', 'chaos engineering',
        'capacity planning', 'performance optimization', 'automation', 'ci/cd'
      ],
      contextPatterns: [
        /\b(reduced|improved)\s+.*\b(downtime|latency|reliability|availability|mttr)\b/i,
        /\b(implemented|built)\s+.*\b(monitoring|alerting|observability|slo)\b/i,
        /\b(led|managed)\s+.*\b(incident|on-call|postmortem|outage)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    technical_program_management: {
      titlePatterns: [
        /\b(technical\s+program\s+manager|tpm)\b/i,
        /\b(engineering\s+program\s+manager|program\s+manager)\b/i,
        /\b(technical\s+project\s+manager|senior\s+tpm)\b/i,
        /\b(staff\s+tpm|principal\s+tpm)\b/i,
      ],
      skillPatterns: [
        'technical program management', 'program management', 'cross-functional leadership',
        'roadmap planning', 'stakeholder management', 'agile', 'scrum', 'jira',
        'risk management', 'resource planning', 'technical architecture', 'okrs', 'kpis',
        'dependency management', 'release management', 'executive communication',
        'pmp', 'technical documentation', 'process improvement', 'vendor management',
        'budget management', 'confluence', 'asana'
      ],
      contextPatterns: [
        /\b(led|managed|drove)\s+.*\b(program|initiative|roadmap|release)\b/i,
        /\b(coordinated|aligned)\s+.*\b(cross-functional|stakeholder|team)\b/i,
        /\b(delivered|shipped)\s+.*\b(on\s+time|under\s+budget|ahead\s+of\s+schedule)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    cloud_security: {
      titlePatterns: [
        /\b(cloud\s+security\s+engineer|cloud\s+security\s+architect)\b/i,
        /\b(cloud\s+security\s+analyst|security\s+engineer\s+cloud)\b/i,
        /\b(devsecops\s+engineer|security\s+automation)\b/i,
        /\b(senior\s+cloud\s+security|staff\s+cloud\s+security)\b/i,
      ],
      skillPatterns: [
        'cloud security', 'aws security', 'azure security', 'gcp security', 'iam',
        'security automation', 'cspm', 'cwpp', 'terraform', 'infrastructure as code',
        'container security', 'kubernetes security', 'soc 2', 'cissp',
        'cloud workload protection', 'security posture', 'zero trust',
        'secret management', 'hashicorp vault', 'aws guardduty', 'azure sentinel',
        'prisma cloud', 'wiz'
      ],
      contextPatterns: [
        /\b(implemented|built|designed)\s+.*\b(security|iam|cspm|compliance)\b/i,
        /\b(achieved|maintained)\s+.*\b(soc\s+2|compliance|certification)\b/i,
        /\b(secured|hardened)\s+.*\b(cloud|aws|azure|gcp|infrastructure)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    data_privacy: {
      titlePatterns: [
        /\b(privacy\s+engineer|privacy\s+analyst)\b/i,
        /\b(data\s+protection\s+officer|dpo)\b/i,
        /\b(privacy\s+manager|privacy\s+counsel)\b/i,
        /\b(senior\s+privacy|head\s+of\s+privacy)\b/i,
      ],
      skillPatterns: [
        'data privacy', 'gdpr', 'ccpa', 'privacy by design', 'data protection',
        'hipaa', 'privacy impact assessment', 'data mapping', 'consent management',
        'data subject rights', 'cookie compliance', 'onetrust', 'trustarc', 'bigid',
        'data classification', 'cross-border data transfer', 'data retention',
        'privacy program', 'vendor risk assessment', 'data breach response',
        'cipp', 'cipm'
      ],
      contextPatterns: [
        /\b(implemented|built|led)\s+.*\b(privacy\s+program|gdpr|ccpa|compliance)\b/i,
        /\b(conducted|performed)\s+.*\b(privacy\s+impact|data\s+mapping|assessment)\b/i,
        /\b(managed|handled)\s+.*\b(data\s+subject|breach|incident)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    sales_operations: {
      titlePatterns: [
        /\b(sales\s+operations\s+manager|director\s+of\s+sales\s+operations)\b/i,
        /\b(vp\s+sales\s+operations|head\s+of\s+sales\s+ops)\b/i,
        /\b(sales\s+enablement\s+manager|deal\s+desk\s+manager)\b/i,
        /\b(salesforce\s+administrator|crm\s+manager)\b/i,
      ],
      skillPatterns: [
        'sales operations', 'salesforce', 'sales enablement', 'crm management',
        'sales forecasting', 'territory planning', 'quota setting', 'pipeline analytics',
        'compensation planning', 'process optimization', 'hubspot', 'outreach', 'gong',
        'clari', 'sales metrics', 'deal desk', 'cpq', 'sales training',
        'go-to-market', 'revenue intelligence', 'lead routing', 'sales playbooks',
        'win loss analysis', 'sales tech stack'
      ],
      contextPatterns: [
        /\b(managed|optimized|built)\s+.*\b(sales\s+operations|sales\s+process|crm)\b/i,
        /\b(increased|improved)\s+.*\b(pipeline|quota|forecast|efficiency)\b/i,
        /\b(implemented|deployed)\s+.*\b(salesforce|hubspot|sales\s+tool|enablement)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    channel_sales: {
      titlePatterns: [
        /\b(channel\s+manager|channel\s+sales\s+manager)\b/i,
        /\b(partner\s+manager|partner\s+sales\s+manager)\b/i,
        /\b(channel\s+director|director\s+of\s+channel)\b/i,
        /\b(alliance\s+manager|vp\s+channel)\b/i,
      ],
      skillPatterns: [
        'channel sales', 'partner management', 'partner recruitment', 'channel strategy',
        'reseller programs', 'partner enablement', 'co-selling', 'deal registration',
        'partner portal', 'mdf', 'partner incentives', 'channel conflict',
        'distribution', 'var management', 'alliance building', 'partner revenue',
        'channel marketing', 'partner certification', 'ecosystem development',
        'indirect revenue', 'partner success', 'crossbeam', 'partnerstack', 'prm'
      ],
      contextPatterns: [
        /\b(managed|built|grew)\s+.*\b(channel|partner|reseller|alliance)\b/i,
        /\b(recruited|enabled|onboarded)\s+.*\b(partner|var|reseller|distributor)\b/i,
        /\b(increased|drove)\s+.*\b(partner\s+revenue|indirect|channel\s+sales)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    strategic_accounts: {
      titlePatterns: [
        /\b(strategic\s+account\s+manager|key\s+account\s+manager)\b/i,
        /\b(enterprise\s+account\s+manager|global\s+account\s+manager)\b/i,
        /\b(named\s+account\s+manager|major\s+account\s+manager)\b/i,
        /\b(enterprise\s+ae|strategic\s+ae|senior\s+ae)\b/i,
        /\b(account\s+executive|sales\s+director)\b/i,
      ],
      skillPatterns: [
        // Sales methodologies - CRITICAL for distinguishing from generic
        'meddpicc', 'meddic', 'spin selling', 'spin', 'challenger sale', 'challenger',
        'sandler', 'gap selling', 'miller heiman', 'strategic selling', 'conceptual selling',
        'command of the message', 'command of the sale', 'force management',
        'solution selling', 'consultative selling', 'value selling',
        // Revenue metrics - CRITICAL
        'arr', 'acv', 'mrr', 'tcv', 'atr', 'net revenue retention', 'nrr', 'grr',
        'annual recurring revenue', 'annual contract value', 'monthly recurring revenue',
        // Quota and performance
        'quota', 'quota attainment', 'exceeded quota', 'beat quota', 'over quota',
        'presidents club', "president's club", 'top performer', 'top 10%',
        // Account management
        'strategic account management', 'enterprise sales', 'executive relationships',
        'account planning', 'c-suite selling', 'multi-threading',
        'complex sales cycles', 'account expansion', 'land and expand', 'qbr',
        'executive sponsorship', 'account mapping', 'stakeholder management',
        'contract negotiation', 'enterprise deals', 'strategic planning',
        'customer success', 'account retention', 'global account strategy',
        // Tools
        'salesforce', 'gong', 'chorus', 'clari', 'outreach', 'salesloft',
        'linkedin sales navigator', 'zoominfo', 'apollo', 'hubspot'
      ],
      contextPatterns: [
        /\b(managed|owned|led)\s+.*\b(strategic|key|enterprise|global)\s+account/i,
        /\b(closed|won|grew)\s+.*\b(enterprise|strategic|major|seven\s+figure)\s+deal/i,
        /\b(built|developed)\s+.*\b(c-suite|executive|stakeholder)\s+relationship/i,
        /\b(exceeded|surpassed|beat)\s+.*\bquota\b/i,
        /\$[\d,]+[kKmM]\+?\s+(arr|acv|mrr|revenue|pipeline|deal)/i,
        /\b\d+x\s+quota\b/i,
        /\b\d+%\s+(of|over|above)\s+quota\b/i,
      ],
      minSkillsForHigh: 3,
      titleWeight: 50
    },
    performance_marketing: {
      titlePatterns: [
        /\b(performance\s+marketing\s+manager|paid\s+media\s+manager)\b/i,
        /\b(ppc\s+specialist|ppc\s+manager|sem\s+manager)\b/i,
        /\b(paid\s+acquisition\s+manager|growth\s+marketer)\b/i,
        /\b(media\s+buyer|demand\s+gen\s+manager)\b/i,
      ],
      skillPatterns: [
        'performance marketing', 'paid media', 'google ads', 'facebook ads', 'meta ads',
        'roas', 'cac', 'ltv', 'conversion rate optimization', 'a/b testing',
        'attribution modeling', 'programmatic advertising', 'display advertising',
        'retargeting', 'linkedin ads', 'tiktok ads', 'media buying',
        'campaign optimization', 'bid management', 'landing page optimization',
        'google analytics', 'budget allocation', 'audience targeting', 'demand generation'
      ],
      contextPatterns: [
        /\b(managed|optimized|scaled)\s+.*\b(paid\s+media|advertising|campaigns|budget)\b/i,
        /\b(achieved|improved|increased)\s+.*\b(roas|cac|conversion|ctr)\b/i,
        /\b(launched|ran)\s+.*\b(google\s+ads|facebook\s+ads|paid\s+campaigns)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    influencer_marketing: {
      titlePatterns: [
        /\b(influencer\s+marketing\s+manager|influencer\s+manager)\b/i,
        /\b(creator\s+partnerships\s+manager|creator\s+marketing)\b/i,
        /\b(brand\s+ambassador\s+manager|ugc\s+manager)\b/i,
        /\b(influencer\s+strategist|talent\s+partnerships)\b/i,
      ],
      skillPatterns: [
        'influencer marketing', 'creator partnerships', 'influencer outreach', 'ugc',
        'creator economy', 'influencer campaigns', 'brand ambassadors', 'affiliate marketing',
        'instagram marketing', 'tiktok marketing', 'youtube partnerships', 'influencer roi',
        'content collaboration', 'micro-influencers', 'macro-influencers', 'influencer platforms',
        'aspireiq', 'grin', 'creatoriq', 'sponsored content', 'engagement rate',
        'campaign tracking', 'talent management', 'contract negotiation'
      ],
      contextPatterns: [
        /\b(managed|built|launched)\s+.*\b(influencer|creator|ambassador)\s+(program|campaign|partnership)/i,
        /\b(recruited|partnered\s+with)\s+.*\b(influencer|creator|talent)\b/i,
        /\b(drove|generated)\s+.*\b(ugc|engagement|impressions|reach)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    marketing_analytics: {
      titlePatterns: [
        /\b(marketing\s+analyst|marketing\s+analytics\s+manager)\b/i,
        /\b(marketing\s+data\s+analyst|digital\s+analytics\s+manager)\b/i,
        /\b(growth\s+analyst|attribution\s+analyst)\b/i,
        /\b(marketing\s+science|marketing\s+intelligence)\b/i,
      ],
      skillPatterns: [
        'marketing analytics', 'google analytics', 'marketing attribution', 'data visualization',
        'sql', 'tableau', 'looker', 'marketing mix modeling', 'customer segmentation',
        'cohort analysis', 'funnel analysis', 'a/b testing', 'python', 'r',
        'amplitude', 'mixpanel', 'segment', 'marketing dashboards', 'kpi tracking',
        'roi analysis', 'predictive analytics', 'customer journey analytics',
        'multi-touch attribution', 'adobe analytics'
      ],
      contextPatterns: [
        /\b(built|created|developed)\s+.*\b(dashboard|report|analytics|attribution)\b/i,
        /\b(analyzed|measured|tracked)\s+.*\b(campaign|marketing|funnel|conversion)\b/i,
        /\b(implemented|deployed)\s+.*\b(analytics|tracking|attribution|segment)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    private_equity: {
      titlePatterns: [
        /\b(private\s+equity\s+analyst|pe\s+analyst)\b/i,
        /\b(private\s+equity\s+associate|pe\s+associate)\b/i,
        /\b(pe\s+principal|pe\s+vice\s+president)\b/i,
        /\b(buyout\s+analyst|growth\s+equity)\b/i,
      ],
      skillPatterns: [
        'private equity', 'lbo modeling', 'due diligence', 'financial modeling',
        'valuation', 'deal sourcing', 'portfolio management', 'value creation',
        'm&a', 'dcf analysis', 'excel', 'capiq', 'pitchbook', 'comparable analysis',
        'investment thesis', 'exit strategy', 'debt financing', 'management buyout',
        'ebitda', 'irr', 'moic', 'fund performance', 'lp relations', 'investment committee'
      ],
      contextPatterns: [
        /\b(sourced|executed|closed)\s+.*\b(deal|transaction|investment|acquisition)\b/i,
        /\b(led|conducted)\s+.*\b(due\s+diligence|valuation|lbo\s+model)\b/i,
        /\b(managed|supported)\s+.*\b(portfolio|fund|investment)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    venture_capital: {
      titlePatterns: [
        /\b(venture\s+capital\s+analyst|vc\s+analyst)\b/i,
        /\b(venture\s+capital\s+associate|vc\s+associate)\b/i,
        /\b(vc\s+principal|venture\s+partner)\b/i,
        /\b(startup\s+investor|seed\s+investor)\b/i,
      ],
      skillPatterns: [
        'venture capital', 'deal sourcing', 'due diligence', 'startup investing',
        'term sheets', 'cap table', 'portfolio support', 'seed stage', 'series a',
        'series b', 'founder relations', 'market sizing', 'tam sam som',
        'investment memo', 'pitch deck review', 'startup ecosystem', 'angellist',
        'crunchbase', 'pitchbook', 'syndication', 'pro rata rights', 'board seat',
        'valuation', 'exit analysis'
      ],
      contextPatterns: [
        /\b(sourced|evaluated|invested\s+in)\s+.*\b(startup|company|deal)\b/i,
        /\b(led|participated\s+in)\s+.*\b(seed|series\s+a|series\s+b|round)\b/i,
        /\b(supported|advised)\s+.*\b(portfolio|founder|startup)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    treasury_management: {
      titlePatterns: [
        /\b(treasury\s+manager|treasury\s+analyst)\b/i,
        /\b(corporate\s+treasury|treasury\s+director)\b/i,
        /\b(head\s+of\s+treasury|vp\s+treasury)\b/i,
        /\b(cash\s+manager|liquidity\s+manager)\b/i,
      ],
      skillPatterns: [
        'treasury management', 'cash management', 'liquidity management', 'fx hedging',
        'interest rate risk', 'cash forecasting', 'working capital', 'bank relationships',
        'debt management', 'investment policy', 'treasury workstation', 'kyriba',
        'sap treasury', 'swift', 'letters of credit', 'payment processing',
        'intercompany loans', 'cash pooling', 'netting', 'derivatives',
        'sox compliance', 'bank account management', 'ctp', 'money market'
      ],
      contextPatterns: [
        /\b(managed|optimized)\s+.*\b(cash|liquidity|treasury|working\s+capital)\b/i,
        /\b(implemented|executed)\s+.*\b(hedging|fx|interest\s+rate)\s+strategy/i,
        /\b(maintained|built)\s+.*\b(bank\s+relationship|credit\s+facility)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    organizational_development: {
      titlePatterns: [
        /\b(organizational\s+development\s+manager|od\s+consultant)\b/i,
        /\b(od\s+specialist|organization\s+development)\b/i,
        /\b(change\s+management\s+manager|change\s+consultant)\b/i,
        /\b(leadership\s+development\s+manager|culture\s+transformation)\b/i,
      ],
      skillPatterns: [
        'organizational development', 'change management', 'leadership development',
        'organizational design', 'culture transformation', 'team effectiveness',
        'executive coaching', 'talent assessment', 'succession planning',
        'performance management', 'employee engagement', 'strategic planning',
        'adkar', 'prosci', 'kotter', '360 feedback', 'disc', 'myers-briggs',
        'competency modeling', 'workforce planning', 'high-potential programs',
        'organization effectiveness', 'facilitation', 'action learning'
      ],
      contextPatterns: [
        /\b(led|facilitated)\s+.*\b(change|transformation|culture|leadership)\s+(initiative|program|effort)/i,
        /\b(designed|implemented)\s+.*\b(leadership|succession|development)\s+(program|framework)/i,
        /\b(coached|developed)\s+.*\b(executive|leader|high-potential|senior)/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    employee_experience: {
      titlePatterns: [
        /\b(employee\s+experience\s+manager|ex\s+manager)\b/i,
        /\b(employee\s+engagement\s+manager|people\s+experience)\b/i,
        /\b(culture\s+manager|culture\s+director)\b/i,
        /\b(employer\s+branding\s+manager|dei\s+manager)\b/i,
      ],
      skillPatterns: [
        'employee experience', 'employee engagement', 'culture building', 'evp',
        'employee value proposition', 'onboarding', 'employee journey mapping',
        'pulse surveys', 'enps', 'wellbeing programs', 'recognition programs',
        'internal communications', 'qualtrics', 'glint', 'culture amp', 'peakon',
        'workplace design', 'dei', 'diversity and inclusion', 'employee listening',
        'employer branding', 'retention strategy', 'benefits strategy', 'total rewards'
      ],
      contextPatterns: [
        /\b(launched|designed|led)\s+.*\b(engagement|experience|culture|wellbeing)\s+(program|initiative|strategy)/i,
        /\b(improved|increased)\s+.*\b(engagement|retention|enps|satisfaction)\b/i,
        /\b(built|created)\s+.*\b(evp|employer\s+brand|culture|recognition)\b/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
    },
    hr_analytics: {
      titlePatterns: [
        /\b(people\s+analytics\s+manager|hr\s+analytics\s+manager)\b/i,
        /\b(workforce\s+analytics\s+manager|talent\s+analytics)\b/i,
        /\b(hr\s+data\s+analyst|people\s+data\s+analyst)\b/i,
        /\b(hris\s+analyst|hr\s+reporting\s+manager)\b/i,
      ],
      skillPatterns: [
        'people analytics', 'hr analytics', 'workforce analytics', 'predictive analytics',
        'attrition modeling', 'talent analytics', 'workforce planning', 'hr metrics',
        'hr dashboards', 'workday', 'visier', 'sql', 'python', 'r', 'tableau',
        'power bi', 'statistical analysis', 'compensation analysis', 'turnover analysis',
        'employee segmentation', 'org network analysis', 'hris', 'sap successfactors',
        'data storytelling'
      ],
      contextPatterns: [
        /\b(built|developed|created)\s+.*\b(dashboard|analytics|model|report)\b/i,
        /\b(analyzed|predicted|modeled)\s+.*\b(attrition|turnover|engagement|performance)\b/i,
        /\b(reduced|improved)\s+.*\b(turnover|attrition|retention)\s+.*\b(analytics|data|insights)/i,
      ],
      minSkillsForHigh: 4,
      titleWeight: 50
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
    // BOOSTED: Increased default weights for better confidence scores
    const titleWeight = patterns.titleWeight || 40; // was 30
    const skillWeight = patterns.skillWeight || 7;  // was 5
    
    // Check title patterns (high weight) with RECENCY MULTIPLIER
    // Titles found in the most recent role get 2x weight
    for (const pattern of patterns.titlePatterns) {
      const match = text.match(pattern);
      if (match) {
        // Check if this title match is in the most recent role section
        const isInRecentRole = recentRoleText && pattern.test(recentRoleText);
        const isInRecentTitle = recentRoleTitle && pattern.test(recentRoleTitle);
        
        // Apply recency multiplier: 3x for recent title line, 2x for recent section, 1x otherwise
        let recencyMultiplier = 1.0;
        if (isInRecentTitle) {
          recencyMultiplier = 3.0;
          industrySignals.push(`CURRENT ROLE Title: "${match[0]}" (3x weight)`);
        } else if (isInRecentRole) {
          recencyMultiplier = 2.0;
          industrySignals.push(`Recent Role Title: "${match[0]}" (2x weight)`);
        } else {
          industrySignals.push(`Title: "${match[0]}"`);
        }
        
        score += Math.round(titleWeight * recencyMultiplier);
        matchedTitles.push(match[0]);
      }
    }
    
    // Check skills (medium weight) with recency boost
    const foundSkills = patterns.skillPatterns.filter(skill => {
      const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(text);
    });
    // Skills found in recent role section get 1.5x weight
    let skillScore = 0;
    for (const skill of foundSkills) {
      const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const inRecentRole = recentRoleText && regex.test(recentRoleText);
      skillScore += Math.round(skillWeight * (inRecentRole ? 1.5 : 1.0));
    }
    score += skillScore;
    matchedSkillCount = foundSkills.length;
    if (foundSkills.length > 0) {
      industrySignals.push(`Skills: ${foundSkills.slice(0, 5).join(', ')}`);
    }
    
    // Check context patterns (BOOSTED weight)
    for (const pattern of patterns.contextPatterns) {
      if (pattern.test(text)) {
        score += 15; // was 10
        industrySignals.push(`Context match`);
        matchedContext = true;
        break; // Only count once
      }
    }
    
    // Apply certification boost if this industry matches the definitive certification
    if (certificationBoost && industry === certificationBoost.industry) {
      score += certificationBoost.weight;
      industrySignals.push(certificationBoost.signal);
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
  
  // If we have a certification boost but no matching industry pattern, add it directly
  if (certificationBoost) {
    const hasCertIndustry = industryScores.some(s => s.industry === certificationBoost!.industry);
    if (!hasCertIndustry) {
      industryScores.push({
        industry: certificationBoost.industry,
        score: certificationBoost.weight,
        signals: [certificationBoost.signal],
        matchedTitles: [],
        matchedSkillCount: 0,
        matchedContext: false
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
  
  // Enhanced confidence scoring with BOOSTED thresholds
  // Lower thresholds to push more detections into high/medium confidence
  let confidence: 'high' | 'medium' | 'low';
  const scoreDifferential = secondIndustry ? topIndustry.score / secondIndustry.score : 10;
  
  // Check if top result has a definitive certification (score >= 80 from cert alone)
  const hasCertificationSignal = topIndustry.signals.some(s => s.includes('Definitive certification'));
  
  // BOOST: Lower thresholds for high confidence (was 60 -> 45)
  // Also consider skill count and context match as confidence boosters
  // Certification signals are automatically high confidence
  const hasStrongSignals = topIndustry.matchedSkillCount >= 4 || topIndustry.matchedContext || hasCertificationSignal;
  const effectiveScore = hasStrongSignals ? topIndustry.score * 1.2 : topIndustry.score;
  
  // Certification matches are always high confidence
  if (hasCertificationSignal && topIndustry.score >= 80) {
    confidence = 'high';
  } else if (effectiveScore >= 45 && scoreDifferential >= 1.4) {
    confidence = 'high';
  } else if (effectiveScore >= 30 && scoreDifferential >= 1.2) {
    confidence = 'medium';
  } else if (effectiveScore >= 20) {
    confidence = 'medium';
  } else {
    // IMPROVEMENT 3: When confidence is low, consider falling back to 'general'
    // Only use the detected industry if score is meaningful
    if (topIndustry.score < 15) {
      console.log(`[INDUSTRY-DETECT] Very low score (${topIndustry.score}), falling back to general`);
      return {
        industry: 'general',
        confidence: 'low',
        signals: [`Weak signals for ${topIndustry.industry} (score: ${topIndustry.score}) - defaulting to general`],
        score: topIndustry.score,
        detectionSource: 'server_low',
        alternativeIndustries: industryScores.slice(0, 4).map(s => ({ industry: s.industry, score: s.score })),
        matchedTitlePatterns: topIndustry.matchedTitles,
        matchedSkillCount: topIndustry.matchedSkillCount,
        matchedContextPatterns: topIndustry.matchedContext
      };
    }
    confidence = 'low';
  }
  
  // Determine parent industry for sub-industries
  const parentIndustry = INDUSTRY_PARENTS[topIndustry.industry];
  const isSubIndustry = !!parentIndustry;
  
  console.log(`[INDUSTRY-DETECT] Result: ${topIndustry.industry}${parentIndustry ? ` (parent: ${parentIndustry})` : ''} (confidence: ${confidence}, score: ${topIndustry.score}${hasCertificationSignal ? ', CERT MATCH' : ''})`);
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
  // IMPORTANT: Only override when server confidence is NOT high — high-confidence
  // server detection means the keyword engine is very sure about the industry,
  // and career changer heuristics should NOT override it (causes false positives
  // like sales executives at tech companies being labeled as career changers)
  if (resumeText && serverResult.confidence !== 'high') {
    const careerInfo = detectCareerTransition(resumeText);
    if (careerInfo.isCareerChanger && careerInfo.currentIndustry) {
      console.log(`[INDUSTRY-HYBRID] Career changer detected - using current/target industry: ${careerInfo.currentIndustry}`);
      console.log(`[INDUSTRY-HYBRID] Career transition signals: ${careerInfo.transitionSignals.join(', ')}`);
      console.log(`[INDUSTRY-HYBRID] Career changer confidence: ${careerInfo.confidence || 'medium'} (score: ${careerInfo.confidenceScore || 'N/A'})`);
      return {
        industry: careerInfo.currentIndustry,
        parentIndustry: INDUSTRY_PARENTS[careerInfo.currentIndustry],
        confidence: careerInfo.confidence || 'medium',
        signals: [...careerInfo.transitionSignals, `Current/target industry: ${careerInfo.currentIndustry}`],
        score: careerInfo.confidenceScore || serverResult.score,
        detectionSource: 'ai_override',
        alternativeIndustries: serverResult.alternativeIndustries,
        matchedTitlePatterns: serverResult.matchedTitlePatterns,
        matchedSkillCount: serverResult.matchedSkillCount,
        matchedContextPatterns: serverResult.matchedContextPatterns
      };
    }
  }
  
  // === INDUSTRY TRUST HIERARCHY (synced with free-keyword-scan) ===
  // Server detection uses structured keyword analysis; AI can hallucinate industry.
  // Trust hierarchy: server HIGH > AI > server MEDIUM > server LOW
  const serverAIMatch = normalizedAI === serverResult.industry;
  const serverAIParentMatch = serverAIMatch || 
    (serverResult.alternativeIndustries || []).some(alt => alt.industry === normalizedAI);

  // CRITICAL: Never return "general" or phantom industries if AI has a specific suggestion
  // Also remap phantom industries (military, operations) — they aren't real industries
  const phantomIndustries = ['general', 'military', 'operations'];
  const serverIsPhantom = phantomIndustries.includes(serverResult.industry);
  
  if (serverIsPhantom && normalizedAI !== 'general' && !phantomIndustries.includes(normalizedAI)) {
    console.log(`[INDUSTRY-HYBRID] Server returned phantom "${serverResult.industry}", using AI mandatory fallback: ${normalizedAI}`);
    return {
      industry: normalizedAI,
      parentIndustry: INDUSTRY_PARENTS[normalizedAI],
      confidence: 'low',
      signals: [`AI detected (mandatory fallback from "${serverResult.industry}"): ${normalizedAI}`],
      score: serverResult.score,
      detectionSource: 'ai_fallback',
      alternativeIndustries: serverResult.alternativeIndustries,
      matchedTitlePatterns: serverResult.matchedTitlePatterns,
      matchedSkillCount: serverResult.matchedSkillCount,
      matchedContextPatterns: serverResult.matchedContextPatterns
    };
  }
  
  // If server returned phantom and AI also has nothing, check alternatives
  if (serverIsPhantom && (normalizedAI === 'general' || phantomIndustries.includes(normalizedAI))) {
    const bestAlt = (serverResult.alternativeIndustries || []).find(
      alt => alt.score >= 5 && !phantomIndustries.includes(alt.industry)
    );
    if (bestAlt) {
      console.log(`[INDUSTRY-HYBRID] Both server & AI phantom — using best alternative: ${bestAlt.industry} (score: ${bestAlt.score})`);
      return {
        ...serverResult,
        industry: bestAlt.industry,
        parentIndustry: INDUSTRY_PARENTS[bestAlt.industry],
        confidence: 'low',
        signals: [...serverResult.signals, `Remapped from "${serverResult.industry}" via alternative`],
        detectionSource: 'phantom_remap'
      };
    }
  }

  if (serverResult.confidence === 'high') {
    // HIGH confidence server detection — ALWAYS trust server
    // AI override is the #1 cause of misclassification (e.g., sales→digital_marketing, engineering→sales)
    const detectionSource = serverAIMatch ? 'server_high_ai_agree' : 'server_high_ai_overruled';
    if (!serverAIMatch) {
      console.log(`[INDUSTRY-HYBRID] OVERRULED AI: Server HIGH confidence "${serverResult.industry}" beats AI "${normalizedAI}"`);
    }
    return {
      ...serverResult,
      detectionSource
    };
  }
  
  if (serverResult.confidence === 'medium') {
    // MEDIUM confidence — AI can override only if it picked a plausible alternative
    if (serverAIMatch) {
      console.log(`[INDUSTRY-HYBRID] Server and AI agree: ${serverResult.industry}`);
      return {
        ...serverResult,
        detectionSource: 'server_medium_ai_agree'
      };
    }
    
    if (serverAIParentMatch) {
      // AI picked a related/alternative industry — use AI since server wasn't sure
      console.log(`[INDUSTRY-HYBRID] AI override (parent match): ${normalizedAI}`);
      return {
        ...serverResult,
        industry: normalizedAI,
        confidence: 'medium',
        signals: [...serverResult.signals, `AI suggested related: ${normalizedAI}`],
        detectionSource: 'ai_override_medium_parent'
      };
    }
    
    // AI picked something completely different — trust server (medium > random AI)
    console.log(`[INDUSTRY-HYBRID] Kept server MEDIUM "${serverResult.industry}" — AI "${normalizedAI}" was unrelated`);
    return {
      ...serverResult,
      detectionSource: 'server_medium_ai_unrelated'
    };
  }
  
  // LOW confidence — AI takes precedence
  if (normalizedAI !== 'general') {
    console.log(`[INDUSTRY-HYBRID] Using AI (server low confidence): ${normalizedAI}`);
    return {
      industry: normalizedAI,
      parentIndustry: INDUSTRY_PARENTS[normalizedAI],
      confidence: 'low',
      signals: [`AI detected: ${normalizedAI}`],
      score: serverResult.score,
      detectionSource: serverAIMatch ? 'server_low_ai_agree' : 'ai_override_low',
      alternativeIndustries: serverResult.alternativeIndustries,
      matchedTitlePatterns: serverResult.matchedTitlePatterns,
      matchedSkillCount: serverResult.matchedSkillCount,
      matchedContextPatterns: serverResult.matchedContextPatterns
    };
  }
  
  // Final fallback — but NEVER return a phantom industry
  let finalResult: IndustryDetectionResult;
  if (phantomIndustries.includes(serverResult.industry)) {
    console.log(`[INDUSTRY-HYBRID] FORCE-KILL: server returned phantom "${serverResult.industry}" with no AI override → defaulting to consulting`);
    finalResult = {
      ...serverResult,
      industry: 'consulting',
      confidence: 'low',
      signals: [...serverResult.signals, `Force-remapped from "${serverResult.industry}"`],
      detectionSource: 'phantom_force_kill'
    };
  } else {
    console.log(`[INDUSTRY-HYBRID] Defaulting to server result: ${serverResult.industry}`);
    finalResult = {
      ...serverResult,
      detectionSource: 'server_low'
    };
  }
  return finalResult;
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
  
  // Calculate actual career span from dates in resume
  const yearMatches = text.match(/\b(20\d{2}|19\d{2})\b/g);
  const presentMatch = /\b(present|current)\b/i.test(text);
  let careerSpanYears = 0;
  if (yearMatches && yearMatches.length >= 1) {
    const years = yearMatches.map(Number);
    const earliest = Math.min(...years);
    const latest = presentMatch ? new Date().getFullYear() : Math.max(...years);
    careerSpanYears = latest - earliest;
  }
  
  // IC sales titles that contain "executive" but are NOT executive-level
  // These must be checked BEFORE executive patterns to avoid false positives
  const icSalesTitles = [
    /\baccount\s+executive\b/,
    /\bae\b(?!\s*(of|officer|director))/,
    /\bsales\s+executive\b(?!\s*(director|vp|vice))/,
    /\bbusiness\s+development\s+executive\b/,
    /\bgtm\s+executive\b/,
    /\bfounding\s+\w+\s+executive\b/,
  ];
  
  const isICSalesRole = icSalesTitles.some(p => p.test(text));
  
  // True executive patterns (C-suite, VP, etc.)
  const executivePatterns = [
    /\b(ceo|cto|cfo|coo|cmo|cro|chief\s+\w+\s+officer)\b/,
    /\b(president)\b(?!\s*(club|student|class|association))/,
    /\b(vp|vice\s+president)\s+(of|for|–|-)\s+\w+/,
    /\b(evp|svp|executive\s+vice\s+president|senior\s+vice\s+president)\b/,
    /\b(managing\s+director|general\s+manager)\b/,
  ];
  
  const seniorPatterns = [
    /\b(senior|sr\.?|lead|principal|staff)\s+(engineer|developer|manager|director|analyst|designer|consultant)/,
    /\b(director|head\s+of)\b/,
    /\b(\d{2}\+?\s*years?\s*(of\s+)?experience)/,
    /\b(10|11|12|13|14|15|16|17|18|19|20)\+?\s*years?\b/,
    /\b(senior\s+account\s+executive|enterprise\s+account\s+executive|strategic\s+account\s+executive)\b/,
    /\bfounding\s+(gtm|sales|growth)\b/,
  ];
  
  const midPatterns = [
    /\b(mid[\s-]?level|intermediate)\b/,
    /\b([3-9])\s*years?\s*(of\s+)?experience\b/,
    /\baccount\s+executive\b/,
    /\bsales\s+(representative|manager|associate)\b/,
  ];
  
  // Career span override: 8+ years of actual work history = at minimum "senior"
  const careerSpanIsSenior = careerSpanYears >= 8;
  
  // Check patterns in order of seniority
  if (!isICSalesRole) {
    for (const pattern of executivePatterns) {
      if (pattern.test(text)) {
        if (/\bfounder\b/i.test(text) && /\b(founding\s+)?(sales|gtm|growth|bdr|sdr|ae)\b/i.test(text)) {
          return 'senior';
        }
        return 'executive';
      }
    }
  }
  
  for (const pattern of seniorPatterns) {
    if (pattern.test(text)) return 'senior';
  }
  
  // Career span override before mid check
  if (careerSpanIsSenior) return 'senior';
  
  for (const pattern of midPatterns) {
    if (pattern.test(text)) return 'mid';
  }
  
  return 'entry';
}

// ======================== Elite Signal Detection ========================

interface EliteSignal {
  type: 'brand_company' | 'large_deal' | 'founding_role' | 'quota_consistency' | 'career_progression';
  signal: string;
  strength: 'high' | 'medium';
}

function detectEliteSignals(resumeText: string): EliteSignal[] {
  const signals: EliteSignal[] = [];
  const text = resumeText.toLowerCase();
  
  // 1. Brand/Fortune 500 companies (only when used as employers, not tools/platforms)
  const brandCompanies = [
    'google', 'amazon', 'microsoft', 'meta', 'apple', 'netflix', 'github', 'salesforce',
    'stack overflow', 'linkedin', 'twitter', 'stripe', 'airbnb', 'uber', 'lyft', 'snap',
    'datadog', 'snowflake', 'mongodb', 'twilio', 'atlassian', 'hubspot', 'shopify',
    'oracle', 'ibm', 'sap', 'adobe', 'intuit', 'zoom', 'slack', 'dropbox',
    'mckinsey', 'bain', 'bcg', 'deloitte', 'accenture', 'pwc', 'kpmg', 'ey',
    'goldman sachs', 'jpmorgan', 'morgan stanley', 'blackrock', 'citadel',
    'fortune 500', 'fortune 100', 'f500', 'f100'
  ];
  
  // Brands commonly mentioned as tools/platforms (not employers) — require employer-context proof
  const ambiguousBrands = new Set([
    'google', 'microsoft', 'linkedin', 'apple', 'adobe', 'salesforce', 'hubspot',
    'slack', 'zoom', 'oracle', 'sap', 'github', 'twitter', 'instagram', 'meta'
  ]);
  
  // Extract experience section lines to find employer mentions
  const lines = resumeText.split('\n');
  const experienceLines: string[] = [];
  let inExperience = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(?:experience|work\s*history|employment|professional\s*experience)/i.test(trimmed)) {
      inExperience = true;
      continue;
    }
    if (inExperience && /^(?:education|skills|certifications|projects|activities|volunteer|awards|publications|references)/i.test(trimmed)) {
      break;
    }
    if (inExperience) {
      experienceLines.push(trimmed);
    }
  }
  
  // Job title lines typically contain "|", "–", "—", "at", or company names
  const titleLines = experienceLines.filter(line =>
    /[|–—]/.test(line) || /\b(?:at|@)\s+/i.test(line)
  ).map(l => l.toLowerCase());
  
  const foundBrands = brandCompanies.filter(brand => {
    if (!text.includes(brand)) return false;
    
    // For ambiguous brands, require them to appear in a job title line (employer context)
    if (ambiguousBrands.has(brand)) {
      return titleLines.some(line => line.includes(brand));
    }
    
    // Non-ambiguous brands (mckinsey, goldman sachs, etc.) — simple presence is enough
    return true;
  });
  
  if (foundBrands.length > 0) {
    signals.push({
      type: 'brand_company',
      signal: `Recognized companies: ${foundBrands.slice(0, 3).map(b => b.charAt(0).toUpperCase() + b.slice(1)).join(', ')}`,
      strength: foundBrands.length >= 2 ? 'high' : 'medium'
    });
  }
  
  // 2. Large deal sizes
  const dealPatterns = [
    /\$(\d+(?:\.\d+)?)\s*(?:m|mm|million)/gi,
    /\$(\d{1,3}(?:,\d{3})+)(?:\s+(?:deal|contract|opportunity|pipeline|revenue))/gi,
    /(\d+(?:\.\d+)?)\s*(?:m|mm|million)\s*(?:deal|contract|pipeline|arr|revenue)/gi,
  ];
  
  for (const pattern of dealPatterns) {
    const matches = [...resumeText.matchAll(pattern)];
    if (matches.length > 0) {
      signals.push({
        type: 'large_deal',
        signal: `Large deal experience demonstrated (${matches[0][0].trim()})`,
        strength: 'high'
      });
      break;
    }
  }
  
  // Also check for $XXXk+ deals
  const largeDealK = /\$(\d{3,})\s*k/gi;
  if (!signals.find(s => s.type === 'large_deal')) {
    const kMatches = [...resumeText.matchAll(largeDealK)];
    const largeDeal = kMatches.find(m => parseInt(m[1]) >= 500);
    if (largeDeal) {
      signals.push({
        type: 'large_deal',
        signal: `Significant deal sizes (${largeDeal[0].trim()})`,
        strength: 'medium'
      });
    }
  }
  
  // 3. Founding/first-hire roles
  const foundingPatterns = [
    /\b(founding|first)\s+(sales|gtm|growth|ae|bdr|sdr|hire|team\s+member|employee)/gi,
    /\b(employee\s+#?\d{1,2})\b/gi,
    /\b(built\s+.{0,30}\s+from\s+(scratch|zero|ground\s+up|0))/gi,
    /\b(0\s*(-|to|→)\s*1)\b/gi,
  ];
  
  for (const pattern of foundingPatterns) {
    if (pattern.test(resumeText)) {
      signals.push({
        type: 'founding_role',
        signal: 'Founding/early-stage experience — demonstrates entrepreneurial capability',
        strength: 'high'
      });
      break;
    }
  }
  
  // 4. Consistent quota performance
  const quotaPatterns = [
    /\b(\d{3,})%\s*(of\s+)?(quota|target|goal)/gi,
    /\b(exceeded|surpassed|beat)\s+(quota|target|goal)/gi,
    /\b([2-9](\.\d+)?x)\b/gi,
    /\b(100%\+?\s*(quota|attainment))/gi,
    /\b(president.?s\s+club|top\s+\d+%?|#\d\s+rep)/gi,
  ];
  
  let quotaHits = 0;
  for (const pattern of quotaPatterns) {
    const matches = resumeText.match(pattern);
    if (matches) quotaHits += matches.length;
  }
  
  if (quotaHits >= 3) {
    signals.push({
      type: 'quota_consistency',
      signal: `Consistent quota performance across multiple roles (${quotaHits} mentions)`,
      strength: 'high'
    });
  } else if (quotaHits >= 1) {
    signals.push({
      type: 'quota_consistency',
      signal: 'Demonstrated quota attainment',
      strength: 'medium'
    });
  }
  
  // 5. Career progression
  const progressionSignals = [
    /\b(promoted\s+to|advanced\s+to|elevated\s+to)\b/gi,
    /\b(increasing\s+responsibility|career\s+progression)\b/gi,
  ];
  
  for (const pattern of progressionSignals) {
    if (pattern.test(resumeText)) {
      signals.push({
        type: 'career_progression',
        signal: 'Shows clear career advancement trajectory',
        strength: 'medium'
      });
      break;
    }
  }
  
  return signals;
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
 * Calibrate ATS score based on industry-specific expectations.
 * AI models tend to score keyword-heavy resumes higher (tech, marketing) and
 * penalize industries where resumes have fewer buzzwords (healthcare, education, trades).
 * This normalizes scores so a great nurse resume scores as well as a great PM resume.
 */
function calibrateScoreByIndustry(
  rawScore: number,
  industry: string,
  seniority: SeniorityLevel,
  resumeText: string
): { calibratedScore: number; adjustment: number; reason: string } {
  // Industry-specific calibration factors
  // Positive = industry resumes tend to be under-scored by AI, boost them
  // Negative = industry resumes tend to be over-scored by AI, reduce slightly
  const INDUSTRY_CALIBRATION: Record<string, { 
    baseAdjust: number; 
    certBonus: number; 
    certPatterns: RegExp[];
    metricBonus: number;
    metricPatterns: RegExp[];
  }> = {
    nursing: {
      baseAdjust: 5, // Nursing resumes consistently under-scored
      certBonus: 8,
      certPatterns: [/\b(RN|BSN|MSN|ACLS|BLS|PALS|CCRN|CEN|CNS)\b/i],
      metricBonus: 3,
      metricPatterns: [/patient/i, /\b\d+\s*(patient|bed)/i, /satisfaction/i]
    },
    healthcare: {
      baseAdjust: 4,
      certBonus: 6,
      certPatterns: [/\b(MD|DO|PA-C|NP|RN|BSN|CNA|HIPAA|EMR|EHR)\b/i],
      metricBonus: 3,
      metricPatterns: [/patient\s*(outcome|satisfaction|ratio)/i, /readmission/i, /mortality/i]
    },
    education: {
      baseAdjust: 4,
      certBonus: 5,
      certPatterns: [/\b(M\.?Ed|Ed\.?D|teaching\s+certificate|credential|endorsement)\b/i],
      metricBonus: 3,
      metricPatterns: [/test\s*score/i, /student\s*(achievement|outcome|growth)/i, /class\s*size/i]
    },
    hospitality: {
      baseAdjust: 3,
      certBonus: 4,
      certPatterns: [/\b(ServSafe|TIPS|CHA|CHIA|CHTP)\b/i],
      metricBonus: 3,
      metricPatterns: [/RevPAR/i, /occupancy/i, /guest\s*satisfaction/i, /\bNPS\b/i]
    },
    retail: {
      baseAdjust: 3,
      certBonus: 3,
      certPatterns: [/\b(CPP|LPQ|LPC)\b/i],
      metricBonus: 3,
      metricPatterns: [/same.store\s*sales/i, /conversion\s*rate/i, /shrink(age)?/i, /comp\s*sales/i]
    },
    manufacturing: {
      baseAdjust: 3,
      certBonus: 5,
      certPatterns: [/\b(Six\s*Sigma|Lean|PE|PMP|ISO|ASQ|CQE)\b/i],
      metricBonus: 3,
      metricPatterns: [/OEE/i, /yield/i, /defect/i, /cycle\s*time/i, /TRIR|DART/i]
    },
    construction: {
      baseAdjust: 3,
      certBonus: 5,
      certPatterns: [/\b(PE|PMP|OSHA|LEED|CCM)\b/i],
      metricBonus: 3,
      metricPatterns: [/on.budget/i, /on.time/i, /\$\d+[MBK]/i, /safety\s*record/i]
    },
    creative: {
      baseAdjust: 2,
      certBonus: 2,
      certPatterns: [/\b(portfolio|behance|dribbble)\b/i],
      metricBonus: 3,
      metricPatterns: [/engagement/i, /impression/i, /brand\s*(awareness|lift)/i]
    },
    // Tech/marketing/consulting tend to be scored fairly or slightly over-scored
    technology: { baseAdjust: 0, certBonus: 2, certPatterns: [/\b(AWS|GCP|Azure|Kubernetes)\s*(certified|certificate)/i], metricBonus: 2, metricPatterns: [/uptime/i, /latency/i, /\d+[KMB]\s*users/i] },
    marketing: { baseAdjust: 0, certBonus: 2, certPatterns: [/\b(Google\s*Analytics|HubSpot)\s*cert/i], metricBonus: 2, metricPatterns: [/ROI/i, /conversion/i, /CTR/i] },
    sales: { baseAdjust: 0, certBonus: 0, certPatterns: [], metricBonus: 4, metricPatterns: [/quota/i, /\d+%\s*(of|attain|achiev)/i, /\$\d+/i, /ARR|MRR/i] },
    finance: { baseAdjust: 0, certBonus: 4, certPatterns: [/\b(CFA|CPA|Series\s*\d+|CFP)\b/i], metricBonus: 2, metricPatterns: [/AUM/i, /portfolio/i, /return/i] },
    legal: { baseAdjust: 0, certBonus: 3, certPatterns: [/\b(bar\s*admission|J\.?D\.?|LL\.?M)\b/i], metricBonus: 2, metricPatterns: [/settlement/i, /verdict/i, /\$\d+/i] },
    consulting: { baseAdjust: 0, certBonus: 2, certPatterns: [/\b(PMP|MBA|Six\s*Sigma)\b/i], metricBonus: 3, metricPatterns: [/client\s*(outcome|ROI|impact)/i, /\$\d+[MBK]/i] },
    hr: { baseAdjust: 2, certBonus: 4, certPatterns: [/\b(SHRM|PHR|SPHR)\b/i], metricBonus: 3, metricPatterns: [/retention/i, /time.to.hire/i, /turnover/i, /eNPS/i] },
    general: { baseAdjust: 0, certBonus: 0, certPatterns: [], metricBonus: 0, metricPatterns: [] }
  };

  const parentIndustry = INDUSTRY_PARENTS[industry];
  const calibration = INDUSTRY_CALIBRATION[industry] || (parentIndustry ? INDUSTRY_CALIBRATION[parentIndustry] : null) || INDUSTRY_CALIBRATION.general;
  
  let adjustment = calibration.baseAdjust;
  const reasons: string[] = [];
  
  if (calibration.baseAdjust > 0) {
    reasons.push(`${industry} base calibration +${calibration.baseAdjust}`);
  }

  // Cert bonus: check if resume contains industry-relevant certifications
  if (calibration.certBonus > 0 && calibration.certPatterns.length > 0) {
    const hasCerts = calibration.certPatterns.some(p => p.test(resumeText));
    if (hasCerts) {
      adjustment += calibration.certBonus;
      reasons.push(`industry certs detected +${calibration.certBonus}`);
    }
  }

  // Metric bonus: check if resume has industry-relevant metrics
  if (calibration.metricBonus > 0 && calibration.metricPatterns.length > 0) {
    const metricMatches = calibration.metricPatterns.filter(p => p.test(resumeText)).length;
    if (metricMatches >= 2) {
      adjustment += calibration.metricBonus;
      reasons.push(`${metricMatches} industry metrics detected +${calibration.metricBonus}`);
    }
  }

  // Seniority adjustment for non-tech industries
  // Senior professionals in healthcare/education often have excellent resumes
  // that AI under-scores due to lack of "modern" buzzwords
  if ((seniority === 'senior' || seniority === 'executive') && calibration.baseAdjust > 0) {
    const seniorityBoost = 3;
    adjustment += seniorityBoost;
    reasons.push(`senior ${industry} professional +${seniorityBoost}`);
  }

  // Cap adjustment to prevent inflation
  adjustment = Math.min(adjustment, 15);
  const calibratedScore = Math.min(100, Math.max(0, rawScore + adjustment));

  return {
    calibratedScore,
    adjustment,
    reason: reasons.length > 0 ? reasons.join(', ') : 'no calibration needed'
  };
}

/**
 * Compute industry benchmark based on score
 */
// Fallback used when there isn't enough real scan data yet for an industry
// (or the lookup itself fails) — kept deliberately separate from the real,
// data-backed path below so it's obvious which numbers are estimates and
// which are computed from actual completed scans.
function computeIndustryBenchmarkFallback(
  score: number,
  industry: string
): {
  industryAvg: number;
  comparison: "below" | "at" | "above";
  percentile: string;
} {
  // Industry-specific averages (simplified estimates — used only until enough
  // real scan volume exists for get_industry_score_benchmark to take over)
  const industryAverages: Record<string, { avg: number; top: number }> = {
    technology: { avg: 68, top: 85 },
    sales: { avg: 65, top: 82 },
    marketing: { avg: 64, top: 80 },
    finance: { avg: 70, top: 88 },
    healthcare: { avg: 66, top: 84 },
    legal: { avg: 72, top: 90 },
    consulting: { avg: 70, top: 86 },
    engineering: { avg: 67, top: 84 },
    education: { avg: 63, top: 80 },
    hr: { avg: 64, top: 81 },
    human_resources: { avg: 64, top: 81 },
    creative: { avg: 62, top: 79 },
    retail: { avg: 60, top: 78 },
    hospitality: { avg: 58, top: 76 },
    manufacturing: { avg: 66, top: 83 },
    nonprofit: { avg: 62, top: 79 },
    government: { avg: 65, top: 82 },
    construction: { avg: 63, top: 80 },
    logistics: { avg: 63, top: 80 },
    real_estate: { avg: 61, top: 78 },
    energy: { avg: 66, top: 83 },
    general: { avg: 65, top: 82 },
  };
  
  // Resolve sub-industry to parent for benchmark lookup
  const parentIndustry = INDUSTRY_PARENTS[industry];
  const benchmarks = industryAverages[industry] || (parentIndustry ? industryAverages[parentIndustry] : null) || industryAverages.general;

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

// Real, data-backed benchmark — queries get_industry_score_benchmark, which
// computes an actual percentile from completed scans of the same industry
// (scan_metrics.metadata->>'industry'), instead of a static lookup table.
// Falls back to the estimate above when there isn't enough real volume yet
// for a given industry (the RPC itself enforces a minimum sample size) or if
// the query fails for any reason — this should never block a scan result.
async function computeIndustryBenchmark(
  supabase: ReturnType<typeof createClient>,
  score: number,
  industry: string
): Promise<{
  industryAvg: number;
  comparison: "below" | "at" | "above";
  percentile: string;
  isRealData?: boolean;
}> {
  try {
    const { data, error } = await supabase.rpc('get_industry_score_benchmark', {
      p_industry: industry,
      p_score: Math.round(score),
    });

    const row = data?.[0];
    if (!error && row && row.industry_avg !== null && row.percentile !== null) {
      const avg = Number(row.industry_avg);
      const percentileRank = Number(row.percentile); // 0-100: % of real scans scoring <= this user

      let comparison: "below" | "at" | "above";
      if (percentileRank >= 60) comparison = "above";
      else if (percentileRank >= 40) comparison = "at";
      else comparison = "below";

      const percentileLabel = percentileRank >= 95
        ? "Top 5%"
        : percentileRank >= 50
          ? `Top ${Math.max(5, 100 - Math.round(percentileRank))}%`
          : `Bottom ${Math.max(1, Math.round(percentileRank))}%`;

      console.log(`[BENCHMARK] Real data used: avg=${avg}, percentile=${percentileRank}, sample=${row.sample_size}`);
      return { industryAvg: Math.round(avg), comparison, percentile: percentileLabel, isRealData: true };
    }

    console.log(`[BENCHMARK] Insufficient real data for "${industry}" (sample=${row?.sample_size ?? 0}) — using fallback estimate`);
  } catch (e) {
    console.warn('[BENCHMARK] Real benchmark query failed — using fallback estimate:', e);
  }

  return { ...computeIndustryBenchmarkFallback(score, industry), isRealData: false };
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

// ==================== INDUSTRY-SPECIFIC KEYWORD SUGGESTIONS ====================
// Provides tailored keyword recommendations based on detected industry

interface IndustryKeywordSuggestion {
  keyword: string;
  category: 'technical' | 'soft' | 'certification' | 'tool' | 'methodology';
  importance: 'critical' | 'high' | 'medium';
  present: boolean;
  suggestion?: string;
}

interface IndustryKeywordAnalysis {
  industry: string;
  industryName: string;
  keywordsFound: number;
  keywordsMissing: number;
  coverageScore: number;
  criticalMissing: IndustryKeywordSuggestion[];
  highPriorityMissing: IndustryKeywordSuggestion[];
  present: IndustryKeywordSuggestion[];
  recommendations: string[];
}

// Industry keyword database - must match frontend config for consistency
const INDUSTRY_KEYWORD_DB: Record<string, { name: string; keywords: Array<{ keyword: string; category: 'technical' | 'soft' | 'certification' | 'tool' | 'methodology'; importance: 'critical' | 'high' | 'medium' }> }> = {
  technology: {
    name: 'Technology',
    keywords: [
      { keyword: 'Agile', category: 'methodology', importance: 'critical' },
      { keyword: 'Cloud Computing', category: 'technical', importance: 'critical' },
      { keyword: 'AWS', category: 'tool', importance: 'critical' },
      { keyword: 'Python', category: 'technical', importance: 'high' },
      { keyword: 'JavaScript', category: 'technical', importance: 'high' },
      { keyword: 'SQL', category: 'technical', importance: 'high' },
      { keyword: 'API', category: 'technical', importance: 'high' },
      { keyword: 'CI/CD', category: 'methodology', importance: 'high' },
      { keyword: 'Git', category: 'tool', importance: 'high' },
      { keyword: 'DevOps', category: 'methodology', importance: 'high' },
    ],
  },
  software_engineering: {
    name: 'Software Engineering',
    keywords: [
      { keyword: 'Full Stack', category: 'technical', importance: 'critical' },
      { keyword: 'React', category: 'tool', importance: 'high' },
      { keyword: 'Node.js', category: 'tool', importance: 'high' },
      { keyword: 'TypeScript', category: 'technical', importance: 'high' },
      { keyword: 'System Design', category: 'technical', importance: 'critical' },
      { keyword: 'Data Structures', category: 'technical', importance: 'high' },
      { keyword: 'Microservices', category: 'technical', importance: 'high' },
      { keyword: 'Docker', category: 'tool', importance: 'high' },
      { keyword: 'Kubernetes', category: 'tool', importance: 'medium' },
      { keyword: 'REST API', category: 'technical', importance: 'high' },
    ],
  },
  data_science: {
    name: 'Data Science',
    keywords: [
      { keyword: 'Python', category: 'technical', importance: 'critical' },
      { keyword: 'Machine Learning', category: 'technical', importance: 'critical' },
      { keyword: 'SQL', category: 'technical', importance: 'critical' },
      { keyword: 'TensorFlow', category: 'tool', importance: 'high' },
      { keyword: 'PyTorch', category: 'tool', importance: 'high' },
      { keyword: 'Statistical Analysis', category: 'technical', importance: 'high' },
      { keyword: 'Data Visualization', category: 'technical', importance: 'high' },
      { keyword: 'Pandas', category: 'tool', importance: 'high' },
      { keyword: 'Deep Learning', category: 'technical', importance: 'medium' },
      { keyword: 'A/B Testing', category: 'methodology', importance: 'high' },
    ],
  },
  healthcare: {
    name: 'Healthcare',
    keywords: [
      { keyword: 'Patient Care', category: 'technical', importance: 'critical' },
      { keyword: 'HIPAA', category: 'certification', importance: 'critical' },
      { keyword: 'EMR', category: 'tool', importance: 'critical' },
      { keyword: 'Clinical Research', category: 'technical', importance: 'high' },
      { keyword: 'Medical Terminology', category: 'technical', importance: 'high' },
      { keyword: 'CPR Certified', category: 'certification', importance: 'high' },
      { keyword: 'BLS', category: 'certification', importance: 'high' },
      { keyword: 'Epic', category: 'tool', importance: 'high' },
      { keyword: 'Patient Safety', category: 'technical', importance: 'high' },
      { keyword: 'Care Coordination', category: 'technical', importance: 'medium' },
    ],
  },
  nursing: {
    name: 'Nursing',
    keywords: [
      { keyword: 'Patient Care', category: 'technical', importance: 'critical' },
      { keyword: 'BLS', category: 'certification', importance: 'critical' },
      { keyword: 'ACLS', category: 'certification', importance: 'critical' },
      { keyword: 'EMR', category: 'tool', importance: 'high' },
      { keyword: 'Epic', category: 'tool', importance: 'high' },
      { keyword: 'Medication Administration', category: 'technical', importance: 'high' },
      { keyword: 'Triage', category: 'technical', importance: 'high' },
      { keyword: 'Patient Assessment', category: 'technical', importance: 'high' },
      { keyword: 'IV Therapy', category: 'technical', importance: 'medium' },
      { keyword: 'Care Planning', category: 'technical', importance: 'medium' },
    ],
  },
  finance: {
    name: 'Finance',
    keywords: [
      { keyword: 'Financial Analysis', category: 'technical', importance: 'critical' },
      { keyword: 'Risk Management', category: 'technical', importance: 'critical' },
      { keyword: 'Excel', category: 'tool', importance: 'critical' },
      { keyword: 'Financial Modeling', category: 'technical', importance: 'high' },
      { keyword: 'Bloomberg', category: 'tool', importance: 'high' },
      { keyword: 'GAAP', category: 'certification', importance: 'high' },
      { keyword: 'CFA', category: 'certification', importance: 'high' },
      { keyword: 'Budgeting', category: 'technical', importance: 'high' },
      { keyword: 'Forecasting', category: 'technical', importance: 'high' },
      { keyword: 'Valuation', category: 'technical', importance: 'high' },
    ],
  },
  legal: {
    name: 'Legal',
    keywords: [
      { keyword: 'Legal Research', category: 'technical', importance: 'critical' },
      { keyword: 'Contract Review', category: 'technical', importance: 'critical' },
      { keyword: 'Compliance', category: 'technical', importance: 'high' },
      { keyword: 'Westlaw', category: 'tool', importance: 'high' },
      { keyword: 'LexisNexis', category: 'tool', importance: 'high' },
      { keyword: 'Litigation', category: 'technical', importance: 'high' },
      { keyword: 'Due Diligence', category: 'technical', importance: 'high' },
      { keyword: 'Drafting', category: 'technical', importance: 'high' },
      { keyword: 'Negotiation', category: 'soft', importance: 'high' },
      { keyword: 'Case Management', category: 'tool', importance: 'medium' },
    ],
  },
  sales: {
    name: 'Sales',
    keywords: [
      // Core sales keywords that ATS systems actually filter on
      { keyword: 'CRM', category: 'tool', importance: 'critical' },
      { keyword: 'Salesforce', category: 'tool', importance: 'critical' },
      { keyword: 'Pipeline Management', category: 'technical', importance: 'critical' },
      { keyword: 'Revenue Growth', category: 'technical', importance: 'high' },
      { keyword: 'Quota Attainment', category: 'technical', importance: 'high' },
      { keyword: 'Lead Generation', category: 'technical', importance: 'high' },
      { keyword: 'Negotiation', category: 'soft', importance: 'high' },
      { keyword: 'B2B', category: 'technical', importance: 'medium' },
      { keyword: 'Closing', category: 'technical', importance: 'high' },
      { keyword: 'Account Management', category: 'technical', importance: 'high' },
      // Nice-to-have but NOT critical for ATS — methodology terms
      { keyword: 'Territory Management', category: 'technical', importance: 'medium' },
      { keyword: 'Sales Forecasting', category: 'technical', importance: 'medium' },
      { keyword: 'Sales Enablement', category: 'technical', importance: 'medium' },
    ],
  },
  marketing: {
    name: 'Marketing',
    keywords: [
      { keyword: 'SEO', category: 'technical', importance: 'critical' },
      { keyword: 'Google Analytics', category: 'tool', importance: 'critical' },
      { keyword: 'Content Strategy', category: 'technical', importance: 'critical' },
      { keyword: 'Social Media', category: 'technical', importance: 'high' },
      { keyword: 'PPC', category: 'technical', importance: 'high' },
      { keyword: 'HubSpot', category: 'tool', importance: 'high' },
      { keyword: 'A/B Testing', category: 'methodology', importance: 'high' },
      { keyword: 'ROI', category: 'technical', importance: 'high' },
      { keyword: 'Lead Generation', category: 'technical', importance: 'high' },
      { keyword: 'Campaign Management', category: 'technical', importance: 'high' },
    ],
  },
  education: {
    name: 'Education',
    keywords: [
      { keyword: 'Curriculum Development', category: 'technical', importance: 'critical' },
      { keyword: 'Lesson Planning', category: 'technical', importance: 'critical' },
      { keyword: 'Student Engagement', category: 'technical', importance: 'high' },
      { keyword: 'Classroom Management', category: 'technical', importance: 'high' },
      { keyword: 'Assessment', category: 'technical', importance: 'high' },
      { keyword: 'LMS', category: 'tool', importance: 'high' },
      { keyword: 'Differentiated Instruction', category: 'methodology', importance: 'high' },
      { keyword: 'IEP', category: 'technical', importance: 'medium' },
      { keyword: 'Google Classroom', category: 'tool', importance: 'medium' },
      { keyword: 'Student Achievement', category: 'technical', importance: 'high' },
    ],
  },
  k12_education: {
    name: 'K-12 Education',
    keywords: [
      { keyword: 'Lesson Planning', category: 'technical', importance: 'critical' },
      { keyword: 'Classroom Management', category: 'technical', importance: 'critical' },
      { keyword: 'Student Assessment', category: 'technical', importance: 'high' },
      { keyword: 'IEP', category: 'technical', importance: 'high' },
      { keyword: 'Parent Communication', category: 'soft', importance: 'high' },
      { keyword: 'State Standards', category: 'technical', importance: 'high' },
      { keyword: 'Differentiated Instruction', category: 'methodology', importance: 'high' },
      { keyword: 'Google Classroom', category: 'tool', importance: 'medium' },
      { keyword: 'Student Engagement', category: 'soft', importance: 'high' },
      { keyword: 'Curriculum Development', category: 'technical', importance: 'medium' },
    ],
  },
  hospitality: {
    name: 'Hospitality',
    keywords: [
      { keyword: 'Guest Satisfaction', category: 'technical', importance: 'critical' },
      { keyword: 'Revenue Management', category: 'technical', importance: 'critical' },
      { keyword: 'OPERA', category: 'tool', importance: 'high' },
      { keyword: 'ServSafe', category: 'certification', importance: 'high' },
      { keyword: 'Food Cost Control', category: 'technical', importance: 'high' },
      { keyword: 'Customer Service', category: 'soft', importance: 'critical' },
      { keyword: 'POS Systems', category: 'tool', importance: 'high' },
      { keyword: 'Event Coordination', category: 'technical', importance: 'high' },
      { keyword: 'HACCP', category: 'certification', importance: 'high' },
      { keyword: 'Labor Cost Management', category: 'technical', importance: 'high' },
    ],
  },
  food_beverage: {
    name: 'Food & Beverage',
    keywords: [
      { keyword: 'ServSafe', category: 'certification', importance: 'critical' },
      { keyword: 'Food Cost Control', category: 'technical', importance: 'critical' },
      { keyword: 'Menu Development', category: 'technical', importance: 'high' },
      { keyword: 'HACCP', category: 'certification', importance: 'high' },
      { keyword: 'Kitchen Management', category: 'technical', importance: 'high' },
      { keyword: 'Inventory Management', category: 'technical', importance: 'high' },
      { keyword: 'POS Systems', category: 'tool', importance: 'high' },
      { keyword: 'Culinary', category: 'technical', importance: 'high' },
      { keyword: 'Staff Training', category: 'soft', importance: 'medium' },
      { keyword: 'Guest Relations', category: 'soft', importance: 'high' },
    ],
  },
  manufacturing: {
    name: 'Manufacturing',
    keywords: [
      { keyword: 'Lean Manufacturing', category: 'methodology', importance: 'critical' },
      { keyword: 'Six Sigma', category: 'certification', importance: 'critical' },
      { keyword: 'Quality Control', category: 'technical', importance: 'critical' },
      { keyword: 'ISO 9001', category: 'certification', importance: 'high' },
      { keyword: 'ERP', category: 'tool', importance: 'high' },
      { keyword: 'SAP', category: 'tool', importance: 'high' },
      { keyword: 'CNC', category: 'technical', importance: 'high' },
      { keyword: 'GD&T', category: 'technical', importance: 'high' },
      { keyword: 'Kaizen', category: 'methodology', importance: 'high' },
      { keyword: 'OSHA', category: 'certification', importance: 'high' },
    ],
  },
  lean_manufacturing: {
    name: 'Lean Manufacturing',
    keywords: [
      { keyword: 'Kaizen', category: 'methodology', importance: 'critical' },
      { keyword: 'Six Sigma', category: 'certification', importance: 'critical' },
      { keyword: 'Value Stream Mapping', category: 'methodology', importance: 'high' },
      { keyword: '5S', category: 'methodology', importance: 'high' },
      { keyword: 'Continuous Improvement', category: 'methodology', importance: 'high' },
      { keyword: 'Root Cause Analysis', category: 'methodology', importance: 'high' },
      { keyword: 'TPM', category: 'methodology', importance: 'medium' },
      { keyword: 'SPC', category: 'technical', importance: 'medium' },
      { keyword: 'Green Belt', category: 'certification', importance: 'high' },
      { keyword: 'Black Belt', category: 'certification', importance: 'high' },
    ],
  },
  nonprofit: {
    name: 'Nonprofit',
    keywords: [
      { keyword: 'Fundraising', category: 'technical', importance: 'critical' },
      { keyword: 'Grant Writing', category: 'technical', importance: 'critical' },
      { keyword: 'Donor Relations', category: 'technical', importance: 'critical' },
      { keyword: 'Program Evaluation', category: 'technical', importance: 'high' },
      { keyword: 'Impact Measurement', category: 'technical', importance: 'high' },
      { keyword: 'Volunteer Management', category: 'technical', importance: 'high' },
      { keyword: 'CRM', category: 'tool', importance: 'high' },
      { keyword: 'Stewardship', category: 'technical', importance: 'high' },
      { keyword: 'Major Gifts', category: 'technical', importance: 'high' },
      { keyword: 'Community Outreach', category: 'technical', importance: 'medium' },
    ],
  },
  grant_writing: {
    name: 'Grant Writing',
    keywords: [
      { keyword: 'Grant Writing', category: 'technical', importance: 'critical' },
      { keyword: 'Proposal Development', category: 'technical', importance: 'critical' },
      { keyword: 'Grant Compliance', category: 'technical', importance: 'high' },
      { keyword: 'Federal Grants', category: 'technical', importance: 'high' },
      { keyword: 'Foundation Relations', category: 'technical', importance: 'high' },
      { keyword: 'Budget Development', category: 'technical', importance: 'high' },
      { keyword: 'Program Evaluation', category: 'technical', importance: 'high' },
      { keyword: 'RFP Response', category: 'technical', importance: 'high' },
      { keyword: 'Outcome Measurement', category: 'technical', importance: 'medium' },
      { keyword: 'Grant Management', category: 'technical', importance: 'medium' },
    ],
  },
  hr: {
    name: 'Human Resources',
    keywords: [
      { keyword: 'Talent Acquisition', category: 'technical', importance: 'critical' },
      { keyword: 'HRIS', category: 'tool', importance: 'critical' },
      { keyword: 'Employee Relations', category: 'technical', importance: 'high' },
      { keyword: 'Onboarding', category: 'technical', importance: 'high' },
      { keyword: 'Performance Management', category: 'technical', importance: 'high' },
      { keyword: 'Workday', category: 'tool', importance: 'high' },
      { keyword: 'Compliance', category: 'technical', importance: 'high' },
      { keyword: 'SHRM', category: 'certification', importance: 'high' },
      { keyword: 'Training & Development', category: 'technical', importance: 'medium' },
      { keyword: 'Employee Engagement', category: 'technical', importance: 'medium' },
    ],
  },
  ux_design: {
    name: 'UX Design',
    keywords: [
      { keyword: 'Figma', category: 'tool', importance: 'critical' },
      { keyword: 'User Research', category: 'technical', importance: 'critical' },
      { keyword: 'Prototyping', category: 'technical', importance: 'high' },
      { keyword: 'Wireframing', category: 'technical', importance: 'high' },
      { keyword: 'Design Systems', category: 'technical', importance: 'high' },
      { keyword: 'Usability Testing', category: 'methodology', importance: 'high' },
      { keyword: 'Accessibility', category: 'technical', importance: 'high' },
      { keyword: 'Information Architecture', category: 'technical', importance: 'medium' },
      { keyword: 'Interaction Design', category: 'technical', importance: 'medium' },
      { keyword: 'Design Thinking', category: 'methodology', importance: 'medium' },
    ],
  },
  devops: {
    name: 'DevOps',
    keywords: [
      { keyword: 'CI/CD', category: 'methodology', importance: 'critical' },
      { keyword: 'Docker', category: 'tool', importance: 'critical' },
      { keyword: 'Kubernetes', category: 'tool', importance: 'critical' },
      { keyword: 'AWS', category: 'tool', importance: 'high' },
      { keyword: 'Terraform', category: 'tool', importance: 'high' },
      { keyword: 'Jenkins', category: 'tool', importance: 'high' },
      { keyword: 'Monitoring', category: 'technical', importance: 'high' },
      { keyword: 'Infrastructure as Code', category: 'methodology', importance: 'high' },
      { keyword: 'Linux', category: 'technical', importance: 'high' },
      { keyword: 'Ansible', category: 'tool', importance: 'medium' },
    ],
  },
  enterprise_sales: {
    name: 'Enterprise Sales',
    keywords: [
      // Truly critical for ATS in enterprise sales
      { keyword: 'Salesforce', category: 'tool', importance: 'critical' },
      { keyword: 'Quota Attainment', category: 'technical', importance: 'critical' },
      { keyword: 'Pipeline Management', category: 'technical', importance: 'critical' },
      { keyword: 'Enterprise', category: 'technical', importance: 'high' },
      { keyword: 'SaaS', category: 'technical', importance: 'high' },
      { keyword: 'Account Management', category: 'technical', importance: 'high' },
      { keyword: 'C-Suite', category: 'technical', importance: 'high' },
      { keyword: 'Complex Sales', category: 'technical', importance: 'high' },
      // Nice-to-have methodology terms — helpful but NOT required by most ATS
      { keyword: 'MEDDPICC', category: 'methodology', importance: 'medium' },
      { keyword: 'ARR', category: 'technical', importance: 'medium' },
      { keyword: 'ACV', category: 'technical', importance: 'medium' },
      { keyword: 'Multi-threading', category: 'technical', importance: 'medium' },
      { keyword: 'Gong', category: 'tool', importance: 'medium' },
    ],
  },
  business_development: {
    name: 'Business Development',
    keywords: [
      { keyword: 'Pipeline Management', category: 'technical', importance: 'critical' },
      { keyword: 'CRM', category: 'tool', importance: 'critical' },
      { keyword: 'Revenue Growth', category: 'technical', importance: 'critical' },
      { keyword: 'Quota Attainment', category: 'technical', importance: 'high' },
      { keyword: 'Lead Generation', category: 'technical', importance: 'high' },
      { keyword: 'Partnerships', category: 'technical', importance: 'high' },
      { keyword: 'Negotiation', category: 'soft', importance: 'high' },
      { keyword: 'Prospecting', category: 'technical', importance: 'high' },
      { keyword: 'Salesforce', category: 'tool', importance: 'high' },
      { keyword: 'Territory Management', category: 'technical', importance: 'medium' },
    ],
  },
  sales_operations: {
    name: 'Sales Operations',
    keywords: [
      { keyword: 'Salesforce', category: 'tool', importance: 'critical' },
      { keyword: 'Sales Forecasting', category: 'technical', importance: 'critical' },
      { keyword: 'Pipeline Management', category: 'technical', importance: 'critical' },
      { keyword: 'CRM Administration', category: 'tool', importance: 'high' },
      { keyword: 'Territory Planning', category: 'technical', importance: 'high' },
      { keyword: 'Sales Enablement', category: 'technical', importance: 'high' },
      { keyword: 'Quota Management', category: 'technical', importance: 'high' },
      { keyword: 'Deal Desk', category: 'technical', importance: 'high' },
      { keyword: 'Sales Analytics', category: 'technical', importance: 'high' },
      { keyword: 'Clari', category: 'tool', importance: 'medium' },
      { keyword: 'Gong', category: 'tool', importance: 'medium' },
      { keyword: 'Sales Compensation', category: 'technical', importance: 'medium' },
      { keyword: 'GTM Strategy', category: 'technical', importance: 'medium' },
    ],
  },
  channel_sales: {
    name: 'Channel Sales',
    keywords: [
      { keyword: 'Partner Management', category: 'technical', importance: 'critical' },
      { keyword: 'Channel Strategy', category: 'technical', importance: 'critical' },
      { keyword: 'Partner Enablement', category: 'technical', importance: 'high' },
      { keyword: 'Reseller Management', category: 'technical', importance: 'high' },
      { keyword: 'Partner Recruitment', category: 'technical', importance: 'high' },
      { keyword: 'Indirect Sales', category: 'technical', importance: 'high' },
      { keyword: 'Co-Selling', category: 'technical', importance: 'high' },
      { keyword: 'PRM', category: 'tool', importance: 'high' },
      { keyword: 'Alliance Management', category: 'technical', importance: 'high' },
      { keyword: 'Revenue Sharing', category: 'technical', importance: 'medium' },
      { keyword: 'VAR', category: 'technical', importance: 'medium' },
      { keyword: 'Distribution', category: 'technical', importance: 'medium' },
      { keyword: 'Ecosystem', category: 'technical', importance: 'medium' },
    ],
  },
  sales_engineering: {
    name: 'Sales Engineering',
    keywords: [
      { keyword: 'Technical Demo', category: 'technical', importance: 'critical' },
      { keyword: 'Solution Architecture', category: 'technical', importance: 'critical' },
      { keyword: 'Pre-Sales', category: 'technical', importance: 'critical' },
      { keyword: 'POC', category: 'technical', importance: 'high' },
      { keyword: 'RFP Response', category: 'technical', importance: 'high' },
      { keyword: 'Technical Discovery', category: 'technical', importance: 'high' },
      { keyword: 'API Integration', category: 'technical', importance: 'high' },
      { keyword: 'Product Knowledge', category: 'technical', importance: 'high' },
      { keyword: 'Customer Requirements', category: 'technical', importance: 'high' },
      { keyword: 'Competitive Analysis', category: 'technical', importance: 'medium' },
      { keyword: 'SaaS', category: 'technical', importance: 'medium' },
      { keyword: 'Cloud Architecture', category: 'technical', importance: 'medium' },
    ],
  },
  inside_sales: {
    name: 'Inside Sales',
    keywords: [
      { keyword: 'Outbound Prospecting', category: 'technical', importance: 'critical' },
      { keyword: 'CRM', category: 'tool', importance: 'critical' },
      { keyword: 'Lead Qualification', category: 'technical', importance: 'critical' },
      { keyword: 'Cold Calling', category: 'technical', importance: 'high' },
      { keyword: 'Email Outreach', category: 'technical', importance: 'high' },
      { keyword: 'Sales Cadence', category: 'technical', importance: 'high' },
      { keyword: 'Pipeline Generation', category: 'technical', importance: 'high' },
      { keyword: 'Apollo', category: 'tool', importance: 'medium' },
      { keyword: 'Outreach', category: 'tool', importance: 'medium' },
      { keyword: 'SalesLoft', category: 'tool', importance: 'medium' },
      { keyword: 'LinkedIn Sales Navigator', category: 'tool', importance: 'high' },
      { keyword: 'Meeting Setting', category: 'technical', importance: 'high' },
    ],
  },
  strategic_accounts: {
    name: 'Strategic Accounts',
    keywords: [
      { keyword: 'Key Account Management', category: 'technical', importance: 'critical' },
      { keyword: 'Strategic Planning', category: 'technical', importance: 'critical' },
      { keyword: 'Executive Relationships', category: 'soft', importance: 'critical' },
      { keyword: 'Account Growth', category: 'technical', importance: 'high' },
      { keyword: 'Cross-Sell', category: 'technical', importance: 'high' },
      { keyword: 'Upsell', category: 'technical', importance: 'high' },
      { keyword: 'C-Suite Engagement', category: 'soft', importance: 'high' },
      { keyword: 'Customer Retention', category: 'technical', importance: 'high' },
      { keyword: 'Multi-Stakeholder', category: 'soft', importance: 'high' },
      { keyword: 'Revenue Expansion', category: 'technical', importance: 'high' },
      { keyword: 'QBR', category: 'methodology', importance: 'medium' },
      { keyword: 'Enterprise', category: 'technical', importance: 'medium' },
    ],
  },
  product_management: {
    name: 'Product Management',
    keywords: [
      { keyword: 'Product Roadmap', category: 'technical', importance: 'critical' },
      { keyword: 'User Stories', category: 'technical', importance: 'critical' },
      { keyword: 'Stakeholder Management', category: 'soft', importance: 'critical' },
      { keyword: 'Jira', category: 'tool', importance: 'high' },
      { keyword: 'A/B Testing', category: 'methodology', importance: 'high' },
      { keyword: 'OKRs', category: 'methodology', importance: 'high' },
      { keyword: 'Product Discovery', category: 'technical', importance: 'high' },
      { keyword: 'Agile', category: 'methodology', importance: 'high' },
      { keyword: 'Cross-Functional', category: 'soft', importance: 'high' },
      { keyword: 'MVP', category: 'technical', importance: 'medium' },
    ],
  },
  consulting: {
    name: 'Consulting',
    keywords: [
      { keyword: 'Strategy', category: 'technical', importance: 'critical' },
      { keyword: 'Stakeholder Management', category: 'soft', importance: 'critical' },
      { keyword: 'Business Analysis', category: 'technical', importance: 'high' },
      { keyword: 'PowerPoint', category: 'tool', importance: 'high' },
      { keyword: 'Excel', category: 'tool', importance: 'high' },
      { keyword: 'Process Improvement', category: 'technical', importance: 'high' },
      { keyword: 'Change Management', category: 'methodology', importance: 'high' },
      { keyword: 'Client Engagement', category: 'technical', importance: 'high' },
      { keyword: 'Project Management', category: 'methodology', importance: 'high' },
      { keyword: 'ROI', category: 'technical', importance: 'medium' },
    ],
  },
  engineering: {
    name: 'Engineering',
    keywords: [
      { keyword: 'CAD', category: 'tool', importance: 'critical' },
      { keyword: 'SolidWorks', category: 'tool', importance: 'high' },
      { keyword: 'AutoCAD', category: 'tool', importance: 'high' },
      { keyword: 'GD&T', category: 'technical', importance: 'high' },
      { keyword: 'Root Cause Analysis', category: 'methodology', importance: 'high' },
      { keyword: 'Six Sigma', category: 'certification', importance: 'high' },
      { keyword: 'FEA', category: 'technical', importance: 'medium' },
      { keyword: 'ISO', category: 'certification', importance: 'high' },
      { keyword: 'MATLAB', category: 'tool', importance: 'medium' },
      { keyword: 'PE License', category: 'certification', importance: 'high' },
    ],
  },
  digital_marketing: {
    name: 'Digital Marketing',
    keywords: [
      { keyword: 'Google Ads', category: 'tool', importance: 'critical' },
      { keyword: 'SEO', category: 'technical', importance: 'critical' },
      { keyword: 'Google Analytics', category: 'tool', importance: 'critical' },
      { keyword: 'PPC', category: 'technical', importance: 'high' },
      { keyword: 'Facebook Ads', category: 'tool', importance: 'high' },
      { keyword: 'ROAS', category: 'technical', importance: 'high' },
      { keyword: 'Conversion Rate', category: 'technical', importance: 'high' },
      { keyword: 'A/B Testing', category: 'methodology', importance: 'high' },
      { keyword: 'Landing Pages', category: 'technical', importance: 'medium' },
      { keyword: 'Attribution', category: 'technical', importance: 'medium' },
    ],
  },
  content_marketing: {
    name: 'Content Marketing',
    keywords: [
      { keyword: 'Content Strategy', category: 'technical', importance: 'critical' },
      { keyword: 'SEO', category: 'technical', importance: 'critical' },
      { keyword: 'Copywriting', category: 'technical', importance: 'high' },
      { keyword: 'CMS', category: 'tool', importance: 'high' },
      { keyword: 'Editorial Calendar', category: 'technical', importance: 'high' },
      { keyword: 'Blog Management', category: 'technical', importance: 'high' },
      { keyword: 'HubSpot', category: 'tool', importance: 'high' },
      { keyword: 'Content Distribution', category: 'technical', importance: 'medium' },
      { keyword: 'Analytics', category: 'tool', importance: 'medium' },
      { keyword: 'Email Marketing', category: 'technical', importance: 'medium' },
    ],
  },
  accounting: {
    name: 'Accounting',
    keywords: [
      { keyword: 'GAAP', category: 'certification', importance: 'critical' },
      { keyword: 'CPA', category: 'certification', importance: 'critical' },
      { keyword: 'Financial Statements', category: 'technical', importance: 'critical' },
      { keyword: 'QuickBooks', category: 'tool', importance: 'high' },
      { keyword: 'Reconciliation', category: 'technical', importance: 'high' },
      { keyword: 'Audit', category: 'technical', importance: 'high' },
      { keyword: 'Tax Preparation', category: 'technical', importance: 'high' },
      { keyword: 'Month-End Close', category: 'technical', importance: 'high' },
      { keyword: 'NetSuite', category: 'tool', importance: 'medium' },
      { keyword: 'Journal Entries', category: 'technical', importance: 'medium' },
    ],
  },
  construction: {
    name: 'Construction',
    keywords: [
      { keyword: 'Project Management', category: 'methodology', importance: 'critical' },
      { keyword: 'Procore', category: 'tool', importance: 'high' },
      { keyword: 'OSHA', category: 'certification', importance: 'critical' },
      { keyword: 'Estimating', category: 'technical', importance: 'high' },
      { keyword: 'Blueprints', category: 'technical', importance: 'high' },
      { keyword: 'Scheduling', category: 'technical', importance: 'high' },
      { keyword: 'Subcontractor Management', category: 'technical', importance: 'high' },
      { keyword: 'BIM', category: 'tool', importance: 'medium' },
      { keyword: 'LEED', category: 'certification', importance: 'medium' },
      { keyword: 'Safety', category: 'technical', importance: 'high' },
    ],
  },
  government: {
    name: 'Government',
    keywords: [
      { keyword: 'Policy Analysis', category: 'technical', importance: 'critical' },
      { keyword: 'Grant Writing', category: 'technical', importance: 'high' },
      { keyword: 'Federal Acquisition', category: 'technical', importance: 'high' },
      { keyword: 'Public Administration', category: 'technical', importance: 'high' },
      { keyword: 'Regulatory Compliance', category: 'technical', importance: 'high' },
      { keyword: 'Budget Management', category: 'technical', importance: 'high' },
      { keyword: 'Stakeholder Engagement', category: 'soft', importance: 'high' },
      { keyword: 'Legislation', category: 'technical', importance: 'medium' },
      { keyword: 'Procurement', category: 'technical', importance: 'medium' },
      { keyword: 'Security Clearance', category: 'certification', importance: 'medium' },
    ],
  },
  logistics: {
    name: 'Logistics',
    keywords: [
      { keyword: 'Supply Chain', category: 'technical', importance: 'critical' },
      { keyword: 'WMS', category: 'tool', importance: 'critical' },
      { keyword: 'Inventory Management', category: 'technical', importance: 'high' },
      { keyword: 'ERP', category: 'tool', importance: 'high' },
      { keyword: 'SAP', category: 'tool', importance: 'high' },
      { keyword: 'Procurement', category: 'technical', importance: 'high' },
      { keyword: 'Freight', category: 'technical', importance: 'medium' },
      { keyword: 'TMS', category: 'tool', importance: 'medium' },
      { keyword: '3PL', category: 'technical', importance: 'medium' },
      { keyword: 'Route Optimization', category: 'technical', importance: 'medium' },
    ],
  },
  real_estate: {
    name: 'Real Estate',
    keywords: [
      { keyword: 'Property Valuation', category: 'technical', importance: 'critical' },
      { keyword: 'MLS', category: 'tool', importance: 'critical' },
      { keyword: 'Market Analysis', category: 'technical', importance: 'high' },
      { keyword: 'Negotiation', category: 'soft', importance: 'high' },
      { keyword: 'Contract Management', category: 'technical', importance: 'high' },
      { keyword: 'Client Relations', category: 'soft', importance: 'high' },
      { keyword: 'CRM', category: 'tool', importance: 'high' },
      { keyword: 'Commercial Real Estate', category: 'technical', importance: 'medium' },
      { keyword: 'Lease Administration', category: 'technical', importance: 'medium' },
      { keyword: 'Yardi', category: 'tool', importance: 'medium' },
    ],
  },
  retail: {
    name: 'Retail',
    keywords: [
      { keyword: 'Customer Service', category: 'soft', importance: 'critical' },
      { keyword: 'Inventory Management', category: 'technical', importance: 'critical' },
      { keyword: 'POS Systems', category: 'tool', importance: 'high' },
      { keyword: 'Visual Merchandising', category: 'technical', importance: 'high' },
      { keyword: 'Loss Prevention', category: 'technical', importance: 'high' },
      { keyword: 'Sales Targets', category: 'technical', importance: 'high' },
      { keyword: 'Omnichannel', category: 'technical', importance: 'medium' },
      { keyword: 'Vendor Relations', category: 'soft', importance: 'medium' },
      { keyword: 'Shopify', category: 'tool', importance: 'medium' },
      { keyword: 'Store Operations', category: 'technical', importance: 'high' },
    ],
  },
  creative: {
    name: 'Creative',
    keywords: [
      { keyword: 'Adobe Creative Suite', category: 'tool', importance: 'critical' },
      { keyword: 'Visual Design', category: 'technical', importance: 'critical' },
      { keyword: 'Branding', category: 'technical', importance: 'high' },
      { keyword: 'Typography', category: 'technical', importance: 'high' },
      { keyword: 'Photography', category: 'technical', importance: 'medium' },
      { keyword: 'Video Production', category: 'technical', importance: 'medium' },
      { keyword: 'Art Direction', category: 'technical', importance: 'high' },
      { keyword: 'Illustration', category: 'technical', importance: 'medium' },
      { keyword: 'Figma', category: 'tool', importance: 'high' },
      { keyword: 'InDesign', category: 'tool', importance: 'medium' },
    ],
  },
  energy: {
    name: 'Energy',
    keywords: [
      { keyword: 'Renewable Energy', category: 'technical', importance: 'critical' },
      { keyword: 'Power Generation', category: 'technical', importance: 'high' },
      { keyword: 'Grid', category: 'technical', importance: 'high' },
      { keyword: 'FERC', category: 'certification', importance: 'high' },
      { keyword: 'NERC', category: 'certification', importance: 'high' },
      { keyword: 'Energy Efficiency', category: 'technical', importance: 'high' },
      { keyword: 'Oil and Gas', category: 'technical', importance: 'medium' },
      { keyword: 'Sustainability', category: 'technical', importance: 'high' },
      { keyword: 'Solar', category: 'technical', importance: 'medium' },
      { keyword: 'Wind', category: 'technical', importance: 'medium' },
    ],
  },
};


/**
 * Compute industry-specific keyword suggestions based on detected industry and resume content
 */
function computeIndustryKeywordSuggestions(
  industry: string,
  resumeText: string
): IndustryKeywordAnalysis | null {
  // Try exact match first, then parent industry
  let industryConfig = INDUSTRY_KEYWORD_DB[industry];
  const parentIndustry = INDUSTRY_PARENTS[industry];
  
  // Fallback chain: exact match → parent industry → 'general' category based on parent
  if (!industryConfig) {
    // Try well-known parent aliases
    const parentAliases: Record<string, string> = {
      'human_resources': 'hr',
    };
    const aliasKey = parentIndustry ? (parentAliases[parentIndustry] || parentIndustry) : null;
    if (aliasKey) {
      industryConfig = INDUSTRY_KEYWORD_DB[aliasKey];
    }
  }
  
  // Fallback: don't default to 'technology' — that causes wrong keywords. Use parent or null.
  if (!industryConfig) {
    console.log(`[INDUSTRY-KEYWORDS] No keyword DB entry for "${industry}" (parent: ${parentIndustry})`);
    return null;
  }
  
  const resumeLower = resumeText.toLowerCase();
  const present: IndustryKeywordSuggestion[] = [];
  const missing: IndustryKeywordSuggestion[] = [];
  
  for (const kw of industryConfig.keywords) {
    const keywordLower = kw.keyword.toLowerCase();
    // Check for keyword presence with variations
    const variations = [
      keywordLower,
      keywordLower.replace(/\s+/g, ''),
      keywordLower.replace(/\//g, ''),
      keywordLower.replace(/&/g, 'and'),
    ];
    
    const isPresent = variations.some(v => resumeLower.includes(v));
    
    if (isPresent) {
      present.push({ ...kw, present: true });
    } else {
      missing.push({ 
        ...kw, 
        present: false,
        suggestion: getSuggestionForKeyword(kw.keyword, kw.category, industry)
      });
    }
  }
  
  // Sort by importance
  const importanceOrder = { critical: 0, high: 1, medium: 2 };
  missing.sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance]);
  present.sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance]);
  
  const criticalMissing = missing.filter(k => k.importance === 'critical');
  const highPriorityMissing = missing.filter(k => k.importance === 'high');
  
  const totalKeywords = industryConfig.keywords.length;
  const coverageScore = Math.round((present.length / totalKeywords) * 100);
  
  // Generate recommendations based on gaps
  const recommendations: string[] = [];
  
  if (criticalMissing.length > 0) {
    recommendations.push(`Add these critical ${industryConfig.name} keywords: ${criticalMissing.slice(0, 3).map(k => k.keyword).join(', ')}`);
  }
  
  if (highPriorityMissing.length > 0 && recommendations.length < 3) {
    const certsMissing = highPriorityMissing.filter(k => k.category === 'certification');
    const toolsMissing = highPriorityMissing.filter(k => k.category === 'tool');
    
    if (certsMissing.length > 0) {
      recommendations.push(`Consider adding certifications: ${certsMissing.slice(0, 2).map(k => k.keyword).join(', ')}`);
    }
    if (toolsMissing.length > 0) {
      recommendations.push(`Highlight experience with: ${toolsMissing.slice(0, 3).map(k => k.keyword).join(', ')}`);
    }
  }
  
  if (coverageScore >= 70) {
    recommendations.push(`Strong keyword coverage for ${industryConfig.name}. Consider adding 1-2 more for ATS optimization.`);
  } else if (coverageScore >= 40) {
    recommendations.push(`Moderate keyword coverage. Add more industry-specific terms to improve ATS matching.`);
  } else {
    recommendations.push(`Low keyword coverage for ${industryConfig.name}. Review job descriptions for common terms.`);
  }
  
  return {
    industry,
    industryName: industryConfig.name,
    keywordsFound: present.length,
    keywordsMissing: missing.length,
    coverageScore,
    criticalMissing: criticalMissing.slice(0, 5),
    highPriorityMissing: highPriorityMissing.slice(0, 5),
    present: present.slice(0, 10),
    recommendations: recommendations.slice(0, 3),
  };
}

/**
 * Generate contextual suggestion for adding a keyword
 */
function getSuggestionForKeyword(keyword: string, category: string, industry: string): string {
  const suggestions: Record<string, Record<string, string>> = {
    certification: {
      default: `Add "${keyword}" to your certifications section or mention in summary.`,
    },
    tool: {
      default: `List "${keyword}" in your skills section or mention specific projects using it.`,
    },
    methodology: {
      default: `Describe experience with "${keyword}" in your work history with specific examples.`,
    },
    technical: {
      default: `Incorporate "${keyword}" into your experience bullets or skills summary.`,
    },
    soft: {
      default: `Demonstrate "${keyword}" through specific achievements or outcomes.`,
    },
  };
  
  return suggestions[category]?.default || `Consider adding "${keyword}" to strengthen your ${industry} profile.`;
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
      const { resumeText, jobDescriptionText, honeypot, skipCache, skipAdminEmail, language } = await req.json();

      // Debug: Log first 100 chars of resume to verify correct text is being sent
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Resume preview (first 100 chars): ${resumeText?.substring(0, 100)?.replace(/\n/g, ' ')}`);
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Resume length: ${resumeText?.length}, skipCache: ${skipCache}, skipAdminEmail: ${skipAdminEmail}`);

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
          
          // IMPORTANT: Re-run industry detection on cached results to prevent stale classifications
          // This ensures code fixes to industry detection take effect even for cached resumes
          const cachedServerDetection = detectIndustryFromResume(resumeText);
          const cachedHybridResult = hybridIndustryDetection(cachedServerDetection, cachedResponse.industry, resumeText);
          
          if (cachedHybridResult.industry !== cachedResponse.industry) {
            console.log(`[FREE-KEYWORD-SCAN-STREAM] Cache industry CORRECTED: "${cachedResponse.industry}" -> "${cachedHybridResult.industry}" (${cachedHybridResult.confidence})`);
            cachedResponse.industry = cachedHybridResult.industry;
            // Update industryHint if present
            if (cachedResponse.industryHint) {
              cachedResponse.industryHint = cachedHybridResult.parentIndustry || cachedHybridResult.industry;
            }
          }
          
          // Send quick progress updates
          send('progress', PROGRESS_STAGES[2]);
          send('progress', PROGRESS_STAGES[3]);
          send('progress', PROGRESS_STAGES[4]);
          send('progress', PROGRESS_STAGES[5]);
          
          // Log successful cache hit
          logScanMetric(metricCtx, 'completed', {
            outputValid: true,
            responseScore: cachedResponse.atsScoreEstimate,
            metadata: { cached: true, cacheKey: cacheKey.substring(0, 8), industryCorrected: cachedHybridResult.industry !== cachedResponse.industry }
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

      // ======================== AI-CONFIRMED INDUSTRY DETECTION ========================
      // ALWAYS run AI verification to catch misclassifications — even for high-confidence
      // server detection. Uses a fast model with open-ended classification.
      const preDetection = detectIndustryFromResume(resumeText);
      let verifiedIndustry: string | null = null;
      
      // Fetch recent correction patterns to inform AI (non-blocking)
      let correctionHints = '';
      try {
        if (supabase) {
          const { data: corrections } = await supabase.rpc('get_industry_correction_stats', { p_days_back: 30 });
          if (corrections && corrections.length > 0) {
            // Build hint string from frequent corrections
            const relevantCorrections = corrections
              .filter((c: any) => c.correction_count >= 2)
              .slice(0, 5)
              .map((c: any) => `"${c.original_industry}" is often corrected to "${c.corrected_to}"`)
              .join('; ');
            if (relevantCorrections) {
              correctionHints = `\n\nKnown misclassification patterns (learn from these): ${relevantCorrections}`;
            }
          }
        }
      } catch (corrErr) {
        console.warn('[FREE-KEYWORD-SCAN-STREAM] Failed to fetch correction hints (non-critical):', corrErr);
      }

      console.log(`[FREE-KEYWORD-SCAN-STREAM] Running AI industry confirmation (server: ${preDetection.industry}, confidence: ${preDetection.confidence}, score: ${preDetection.score})`);
      
      // Build context with server candidates and alternatives
      const serverCandidates = [
        preDetection.industry,
        ...(preDetection.alternativeIndustries || []).slice(0, 3).map(a => a.industry)
      ].filter(Boolean);
      
      // Core parent industries for open-ended classification
      const coreIndustries = [
        'technology', 'healthcare', 'finance', 'legal', 'sales', 'marketing',
        'education', 'engineering', 'consulting', 'retail', 'hospitality',
        'manufacturing', 'government', 'nonprofit', 'construction', 'real_estate',
        'logistics', 'energy', 'creative', 'hr'
      ];
      
      // Extract structured resume excerpt for classification
      const classificationExcerpt = resumeText.substring(0, 3000);
      
      try {
        const verifyResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { 
                role: "system", 
                content: `You are an expert resume industry classifier. Your job is to identify the PRIMARY professional industry of a resume.

RULES:
- Focus on the person's CURRENT or MOST RECENT role, not past roles
- Look at job titles, skills, and industry-specific terminology
- A "Marketing Intern" at a tech company is in MARKETING, not technology
- A "Software Engineer" at a bank is in TECHNOLOGY, not finance
- Consider the person's career trajectory and specialization
- If the person works in a cross-functional role, classify by their FUNCTION (e.g., HR at a tech company = hr)
- If a target job posting is provided, treat its stated title/industry as a strong signal for which industry to classify toward — the candidate is actively targeting that role${correctionHints}

Available industries: ${coreIndustries.join(', ')}

Sub-industries you may also use: product_management, data_science, software_engineering, digital_marketing, content_marketing, investment_banking, accounting, nursing, enterprise_sales, event_management, ux_design, devops, cybersecurity

Respond with ONLY the industry name (snake_case), nothing else.`
              },
              { 
                role: "user", 
                content: `Server detection suggests: ${serverCandidates.join(', ')} (confidence: ${preDetection.confidence}, score: ${preDetection.score})

Resume excerpt:
${classificationExcerpt}
${jobDescriptionText ? `\nTarget job posting (the candidate is applying to this role — use its stated title/industry as a strong signal):\n${jobDescriptionText.substring(0, 1000)}\n` : ''}
What is the PRIMARY industry? Reply with only the industry name.`
              }
            ],
            max_tokens: 50,
            temperature: 0,
          }),
        });
        
        if (verifyResponse.ok) {
          const verifyData = await verifyResponse.json();
          const aiVerified = verifyData.choices?.[0]?.message?.content?.trim()?.toLowerCase()?.replace(/[^a-z_]/g, '');
          if (aiVerified) {
            const normalizedVerified = normalizeIndustry(aiVerified);
            if (VALID_INDUSTRIES.includes(normalizedVerified) || INDUSTRY_ALIASES[normalizedVerified]) {
              verifiedIndustry = INDUSTRY_ALIASES[normalizedVerified] || normalizedVerified;
              const agreement = verifiedIndustry === preDetection.industry ? 'AGREES' : 'DISAGREES';
              console.log(`[FREE-KEYWORD-SCAN-STREAM] AI confirmation ${agreement}: "${verifiedIndustry}" (server: "${preDetection.industry}", candidates: ${serverCandidates.join(', ')})`);
            } else {
              console.log(`[FREE-KEYWORD-SCAN-STREAM] AI returned unrecognized industry: "${aiVerified}" — ignoring`);
            }
          }
        } else {
          console.warn(`[FREE-KEYWORD-SCAN-STREAM] AI verification HTTP ${verifyResponse.status}`);
        }
      } catch (verifyErr) {
        console.warn(`[FREE-KEYWORD-SCAN-STREAM] AI verification failed (non-critical):`, verifyErr);
        // Non-blocking — continue with server detection only
      }

      // Industry-specific scoring rubrics for calibrated scoring
      const INDUSTRY_SCORING_RUBRICS: Record<string, { weights: string; scoreNotes: string }> = {
        technology: {
          weights: 'Technical Skills (35%), Project Impact (25%), Keywords (20%), Format (20%)',
          scoreNotes: 'GitHub/portfolio links are optional but valuable. Weight specific technologies (React, Python, AWS) heavily. Quantified system metrics (uptime, latency, users served) are critical differentiators.'
        },
        healthcare: {
          weights: 'Certifications/Licensure (30%), Clinical Skills (25%), Compliance Language (20%), Format (15%), Keywords (10%)',
          scoreNotes: 'Certifications (RN, BSN, ACLS, BLS) are MANDATORY — missing them is a major penalty. Clinical terminology matters more than generic action verbs. Patient outcomes and safety metrics are key quantifiers. Do NOT penalize for missing "Agile" or tech buzzwords.'
        },
        nursing: {
          weights: 'Licensure/Certs (35%), Clinical Competencies (25%), Patient Care Metrics (20%), Format (10%), Keywords (10%)',
          scoreNotes: 'Active RN license is essential. Certifications like ACLS, BLS, PALS are critical. Specialization keywords (ICU, ER, Med-Surg, Pediatrics) matter. Patient ratios, outcomes, and safety records are the key metrics. Do NOT suggest tech/business keywords.'
        },
        finance: {
          weights: 'Technical Skills (25%), Certifications (25%), Quantified Results (25%), Keywords (15%), Format (10%)',
          scoreNotes: 'CFA, CPA, Series licenses carry heavy weight. Revenue/AUM/portfolio performance metrics are essential. Regulatory compliance language (SOX, Basel, Dodd-Frank) matters. Excel/SQL/Python are relevant technical skills.'
        },
        sales: {
          weights: 'Quota Attainment (30%), Revenue Metrics (25%), Methodology Keywords (20%), Career Progression (15%), Format (10%)',
          scoreNotes: 'Quota achievement percentages are THE most important element. Revenue numbers, deal sizes, pipeline values are critical. Sales methodologies (MEDDPICC, SPIN, Challenger) are valuable keywords. 1.5-2.5 year tenure is NORMAL in SaaS sales.'
        },
        legal: {
          weights: 'Jurisdictions/Bar Admissions (25%), Practice Area Expertise (25%), Case Outcomes (20%), Keywords (15%), Format (15%)',
          scoreNotes: 'Bar admissions and jurisdictions are mandatory. Case outcomes, settlement amounts, and deal values are key metrics. Practice area terminology is critical. Conservative formatting expected.'
        },
        education: {
          weights: 'Certifications/Credentials (30%), Student Outcomes (25%), Curriculum Skills (20%), Keywords (15%), Format (10%)',
          scoreNotes: 'Teaching certifications and credentials are essential. Student achievement metrics, standardized test improvements, and class sizes matter. Curriculum development experience is valuable. Technology integration skills are increasingly important.'
        },
        marketing: {
          weights: 'Campaign Metrics (30%), Tools/Platforms (20%), Strategy Skills (20%), Keywords (15%), Format (15%)',
          scoreNotes: 'ROI, conversion rates, traffic growth, and campaign performance metrics are critical. Platform expertise (Google Analytics, HubSpot, Marketo) matters. Brand strategy and creative skills are valued alongside data skills.'
        },
        engineering: {
          weights: 'Technical Expertise (30%), Project Scale (25%), Certifications (20%), Keywords (15%), Format (10%)',
          scoreNotes: 'PE license is critical for many roles. Project budgets, team sizes, and safety records matter. Industry-specific certifications (FE, PE, PMP) carry weight. Quantified project outcomes are essential.'
        },
        consulting: {
          weights: 'Client Impact (30%), Methodology (20%), Industry Expertise (20%), Credentials (15%), Format (15%)',
          scoreNotes: 'Client outcomes and ROI are paramount. Consulting frameworks (McKinsey 7S, BCG matrix) are valuable. MBA and certifications (PMP, Six Sigma) carry weight. Deal/project sizes and team sizes matter.'
        },
        creative: {
          weights: 'Portfolio Quality (30%), Tools/Software (20%), Campaign Results (20%), Awards (15%), Format (15%)',
          scoreNotes: 'Portfolio links are ESSENTIAL, not optional. Software proficiency (Adobe Suite, Figma, Sketch) matters heavily. Campaign results and brand impact metrics are key. Award mentions are valuable. Non-traditional formatting is more acceptable.'
        },
        hr: {
          weights: 'HR Metrics (25%), Certifications (25%), Program Impact (25%), Keywords (15%), Format (10%)',
          scoreNotes: 'SHRM-CP, SHRM-SCP, PHR, SPHR certifications carry significant weight. Retention rates, time-to-hire, employee satisfaction scores are key metrics. HRIS platform expertise matters.'
        },
        retail: {
          weights: 'Sales Metrics (30%), Team Leadership (25%), Customer Metrics (20%), Keywords (15%), Format (10%)',
          scoreNotes: 'Revenue per square foot, same-store sales growth, and conversion rates are key. Team size and development metrics matter. Customer satisfaction scores and shrinkage reduction are valuable. Loss prevention and inventory management are important keywords.'
        },
        hospitality: {
          weights: 'Guest Satisfaction (30%), Revenue Metrics (25%), Operations (20%), Certifications (15%), Format (10%)',
          scoreNotes: 'Guest satisfaction scores, RevPAR, occupancy rates, and F&B revenue are key metrics. ServSafe, TIPS certifications matter. Team management and training metrics are important. Seasonal/high-volume experience is valued.'
        },
        manufacturing: {
          weights: 'Process Metrics (30%), Safety Record (20%), Certifications (20%), Technical Skills (15%), Format (15%)',
          scoreNotes: 'OEE, yield rates, defect reduction, and cycle time improvements are critical. Safety records (TRIR, DART) carry heavy weight. Six Sigma, Lean, ISO certifications are essential. Equipment/system expertise matters.'
        },
        general: {
          weights: 'Keywords (25%), Quantified Results (25%), Format (20%), Skills (15%), Experience (15%)',
          scoreNotes: 'Use balanced scoring across all categories. Prioritize quantified achievements and relevant keywords.'
        }
      };

      // Get industry-specific rubric for the detected industry
      const parentForRubric = preDetection?.parentIndustry || preDetection?.industry || 'general';
      const specificIndustry = preDetection?.industry || 'general';
      const scoringRubric = INDUSTRY_SCORING_RUBRICS[specificIndustry] || INDUSTRY_SCORING_RUBRICS[parentForRubric] || INDUSTRY_SCORING_RUBRICS.general;

      // Build prompts with resume type awareness and accuracy improvements
      const systemPrompt = `Expert ATS resume analyst. Respond in ${language || "the resume's"} language. All fields in that language.

RESUME TYPE DETECTED: ${resumeType.type} (${resumeType.label})
SENIORITY LEVEL: ${seniority}
ATS RELEVANCE: ${resumeType.atsRelevance}
DETECTED INDUSTRY: ${specificIndustry} (parent: ${parentForRubric})

INDUSTRY-SPECIFIC SCORING RUBRIC:
Scoring Weights: ${scoringRubric.weights}
Scoring Notes: ${scoringRubric.scoreNotes}
CRITICAL: Apply these industry-specific weights when calculating atsScoreEstimate. A nursing resume with all certifications and clinical skills should score HIGH even if it lacks tech buzzwords. A sales resume with strong quota attainment should score HIGH even with shorter tenure.

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

EMPLOYMENT GAP RULES:
- Gaps under 12 months are NORMAL and should NOT be flagged as red flags.
- Only flag gaps of 12+ months, and frame as "Consider briefly addressing" not "critical issue".
- Between-job gaps of 3-6 months are extremely common and never worth mentioning.
- Gaps during COVID (2020-2021) should never be flagged.

EXPERIENCE LEVEL CLASSIFICATION (CRITICAL):
- "Account Executive" (AE) is an IC sales title, NOT executive-level. Classify as Senior or Mid-level.
- "Sales Executive" without VP/Director/C-suite = Senior IC, NOT Executive.
- "Founding sales hire" or "first AE" at startup = Senior, NOT Executive.
- ONLY use "Executive" for: CEO, CTO, CFO, VP, SVP, EVP, Managing Director, General Manager.
- For sales professionals: Mid-level (2-5 years), Senior (5-10 years), Executive (only if VP+ title).

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

MOST RECENT ROLE FOCUS (CRITICAL):
- The candidate's MOST RECENT / CURRENT role is the PRIMARY signal for industry, scoring, and keyword suggestions.
- Base your industry detection on the CURRENT or MOST RECENT job title, not older roles.
- Career changers: if someone was a teacher for 8 years but is now a software engineer for 1 year, classify as "technology" not "education".
- Keyword suggestions should target the CURRENT role, not past industries.
- When extracting "currentRole", always use the most recent job title (the one marked "Present", "Current", or with the latest date range).

BEFORE ANALYSIS: Extract name → identify MOST RECENT ROLE TITLE first → find earliest job date → calculate total years → assess seniority → LIST ALL EXISTING SKILLS/KEYWORDS → SCAN FOR EXISTING METRICS/QUOTA DATA → check contact info → extract titles → check education/certs → determine industry BASED ON CURRENT ROLE.

OUTPUT: ATS score (0-100), industry, format grade (A-D), experience level, keywords (ONLY truly missing ones), red flags. Address candidate by name. Be accurate - don't flag content that exists or suggest keywords already present.`;

      const userPrompt = hasJobDescription 
        ? `Analyze this ${resumeType.label} for the target job:\n\n<resume>\n${resumeText.substring(0, 15000)}\n</resume>\n\n<job_description>\n${truncatedJobDescription}\n</job_description>`
        : `Analyze this ${resumeType.label}:\n\n<resume>\n${resumeText.substring(0, 15000)}\n</resume>`;

      // AI request with retry logic
      const AI_MODELS = [
        "google/gemini-2.5-pro",
        "openai/gpt-5",           // Fallback 1
        "google/gemini-2.5-flash" // Fallback 2 (faster, cheaper)
      ];
      const MAX_RETRIES = 3;
      const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff
      
      const makeAIRequest = async (model: string): Promise<Response> => {
        return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
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
                      description: "Calculate yearsEstimate from earliest job date to present (2025). Count ALL roles including consulting, sales, part-time, freelance. CRITICAL: 'Account Executive' is an IC sales title, NOT executive-level. Only use 'Executive' for C-suite (CEO, CTO, VP, SVP). AE/Sales Rep/BDR = Mid-level or Senior depending on years. Founding sales hire at startup = Senior, not Executive.",
                      properties: {
                        level: { type: "string", description: "Entry-level, Mid-level, Senior, or Executive. ONLY use 'Executive' for C-suite/VP roles. Account Executive = Senior or Mid-level." },
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
      };
      
      let aiResponse: Response | null = null;
      let lastError: string = '';
      let modelUsed = AI_MODELS[0];
      
      // Try with retries and model fallbacks
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const modelIndex = Math.min(attempt, AI_MODELS.length - 1);
        modelUsed = AI_MODELS[modelIndex];
        
        try {
          console.log(`[FREE-KEYWORD-SCAN-STREAM] AI attempt ${attempt + 1}/${MAX_RETRIES} with model ${modelUsed}`);
          const response = await makeAIRequest(modelUsed);
          
          if (response.ok) {
            aiResponse = response;
            if (attempt > 0) {
              console.log(`[FREE-KEYWORD-SCAN-STREAM] AI succeeded on attempt ${attempt + 1} with model ${modelUsed}`);
            }
            break;
          }
          
          lastError = await response.text();
          console.error(`[FREE-KEYWORD-SCAN-STREAM] AI error on attempt ${attempt + 1}:`, response.status, lastError);
          
          // Don't retry on 4xx errors (client errors) except rate limits
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            logScanMetric(metricCtx, 'failed', {
              errorCode: 'AI_CLIENT_ERROR',
              errorMessage: `AI request failed with status ${response.status}`,
              outputValid: false,
              metadata: { attempt: attempt + 1, model: modelUsed, status: response.status }
            });
            send('error', { error: 'Analysis failed. Please try again.' });
            close();
            return;
          }
          
          // Wait before retry
          if (attempt < MAX_RETRIES - 1) {
            const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
            console.log(`[FREE-KEYWORD-SCAN-STREAM] Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (fetchError) {
          lastError = fetchError instanceof Error ? fetchError.message : 'Network error';
          console.error(`[FREE-KEYWORD-SCAN-STREAM] Network error on attempt ${attempt + 1}:`, lastError);
          
          if (attempt < MAX_RETRIES - 1) {
            const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      if (!aiResponse) {
        logScanMetric(metricCtx, 'failed', {
          errorCode: 'AI_ALL_RETRIES_FAILED',
          errorMessage: `All ${MAX_RETRIES} AI attempts failed: ${lastError}`,
          outputValid: false,
          metadata: { attempts: MAX_RETRIES, lastModel: modelUsed }
        });
        send('error', { error: 'Analysis failed after multiple attempts. Please try again later.' });
        close();
        return;
      }
      
      // Update metric context with actual model used
      metricCtx.aiModel = modelUsed;

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

      // Parse final result with auto-repair for common JSON issues
      let analysis = null;
      
      const tryParseJSON = (jsonString: string): any => {
        // First try direct parse
        try {
          return JSON.parse(jsonString);
        } catch (e) {
          // Try to auto-repair common issues
          console.log(`[FREE-KEYWORD-SCAN-STREAM] Direct parse failed, attempting auto-repair...`);
        }
        
        // Repair attempt 1: Fix truncated JSON by closing open brackets
        let repaired = jsonString.trim();
        const openBraces = (repaired.match(/{/g) || []).length;
        const closeBraces = (repaired.match(/}/g) || []).length;
        const openBrackets = (repaired.match(/\[/g) || []).length;
        const closeBrackets = (repaired.match(/\]/g) || []).length;
        
        // Close any unclosed arrays/objects
        for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']';
        for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';
        
        try {
          const parsed = JSON.parse(repaired);
          console.log(`[FREE-KEYWORD-SCAN-STREAM] JSON auto-repaired (added ${openBraces - closeBraces} }, ${openBrackets - closeBrackets} ])`);
          return parsed;
        } catch (e2) {
          // Repair attempt 2: Remove trailing commas before closing brackets
          repaired = repaired.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
          try {
            const parsed = JSON.parse(repaired);
            console.log(`[FREE-KEYWORD-SCAN-STREAM] JSON auto-repaired (removed trailing commas)`);
            return parsed;
          } catch (e3) {
            // Log the problematic JSON for debugging (truncated)
            const preview = jsonString.length > 500 
              ? `${jsonString.substring(0, 250)}...${jsonString.substring(jsonString.length - 250)}`
              : jsonString;
            console.error(`[FREE-KEYWORD-SCAN-STREAM] JSON repair failed. Content preview: ${preview}`);
            return null;
          }
        }
      };
      
      analysis = tryParseJSON(toolCallArgs);
      
      if (!analysis) {
        console.error("[FREE-KEYWORD-SCAN-STREAM] Failed to parse tool args after repair attempts");
        
        // Log detailed error info for debugging
        logScanMetric(metricCtx, 'failed', {
          errorCode: 'PARSE_ERROR',
          errorMessage: 'Failed to parse AI response after repair attempts',
          outputValid: false,
          metadata: {
            responseLength: toolCallArgs.length,
            modelUsed,
            hasContent: toolCallArgs.length > 0,
            // Sample first/last chars to help debug
            startChars: toolCallArgs.substring(0, 50),
            endChars: toolCallArgs.substring(Math.max(0, toolCallArgs.length - 50))
          }
        });
        send('error', { error: 'Failed to parse analysis results. Please try again.' });
        close();
        return;
      }
      
      // Validate essential fields exist
      const requiredFields = ['atsScoreEstimate', 'industry'];
      const missingFields = requiredFields.filter(f => analysis[f] === undefined);
      
      if (missingFields.length > 0) {
        console.error(`[FREE-KEYWORD-SCAN-STREAM] Analysis missing required fields: ${missingFields.join(', ')}`);
        logScanMetric(metricCtx, 'failed', {
          errorCode: 'INCOMPLETE_ANALYSIS',
          errorMessage: `Missing required fields: ${missingFields.join(', ')}`,
          outputValid: false,
          metadata: { missingFields, modelUsed }
        });
        send('error', { error: 'Incomplete analysis received. Please try again.' });
        close();
        return;
      }

      // Normalize industry using hybrid detection (combines server + AI + two-pass verification)
      const industryDetectionStart = Date.now();
      const rawIndustry = analysis.industry;
      // Re-use pre-detection from two-pass verification if available, otherwise detect fresh
      const serverDetection = preDetection || detectIndustryFromResume(resumeText);
      
      // If two-pass AI verification gave a result, use it as additional signal
      const aiIndustryForHybrid = verifiedIndustry || rawIndustry;
      const hybridResult = hybridIndustryDetection(serverDetection, aiIndustryForHybrid, resumeText);
      
      // If verified industry differs from hybrid result AND server was low confidence,
      // prefer verified industry (AI tiebreaker wins for ambiguous cases)
      if (verifiedIndustry && verifiedIndustry !== hybridResult.industry) {
        if (serverDetection.confidence === 'high') {
          // High-confidence server detection — don't override, but log the disagreement
          // This data helps identify when the server engine needs tuning
          console.log(`[FREE-KEYWORD-SCAN-STREAM] AI confirmation DISAGREES but server HIGH confidence — keeping "${hybridResult.industry}" (AI suggested: "${verifiedIndustry}")`);
          hybridResult.signals = [...hybridResult.signals, `AI confirmation suggested "${verifiedIndustry}" but server HIGH confidence prevails`];
          hybridResult.detectionSource = 'server_high_ai_confirmed_disagree';
        } else {
          // Medium/low confidence — AI confirmation overrides
          console.log(`[FREE-KEYWORD-SCAN-STREAM] AI confirmation override: hybrid="${hybridResult.industry}" -> verified="${verifiedIndustry}"`);
          hybridResult.industry = verifiedIndustry;
          hybridResult.parentIndustry = INDUSTRY_PARENTS[verifiedIndustry] || hybridResult.parentIndustry;
          hybridResult.detectionSource = 'ai_confirmed';
          hybridResult.signals = [...hybridResult.signals, `AI confirmation: ${verifiedIndustry}`];
          // Upgrade confidence when AI provides confirmation
          if (hybridResult.confidence === 'low') hybridResult.confidence = 'medium';
        }
      } else if (verifiedIndustry && verifiedIndustry === hybridResult.industry) {
        // AI agrees with server — upgrade confidence
        console.log(`[FREE-KEYWORD-SCAN-STREAM] AI confirmation AGREES: "${hybridResult.industry}"`);
        hybridResult.signals = [...hybridResult.signals, `AI confirmation agrees: ${verifiedIndustry}`];
        if (hybridResult.confidence === 'low') hybridResult.confidence = 'medium';
        if (hybridResult.confidence === 'medium') hybridResult.confidence = 'high';
        hybridResult.detectionSource = `${hybridResult.detectionSource || 'server'}_ai_confirmed`;
      }
      
      const industryDetectionDuration = Date.now() - industryDetectionStart;
      
      // Apply hybrid result
      analysis.industry = hybridResult.industry;
      
      if (hybridResult.industry !== normalizeIndustry(rawIndustry)) {
        console.log(`[FREE-KEYWORD-SCAN-STREAM] Industry adjusted: AI said "${rawIndustry}" -> hybrid result "${hybridResult.industry}" (${hybridResult.confidence} confidence, score: ${hybridResult.score})`);
      }
      
      // Store enhanced detection metadata for UI (includes sub-industry info)
      // Enrich with shared detector fields (subRole, techStack, educationSignals, alt reasons)
      let sharedEnrichment: {
        subRole?: string;
        techStack?: string[];
        educationSignals?: string[];
        alternativeIndustriesWithReasons?: Array<{ industry: string; reason?: string }>;
      } = {};
      try {
        const shared = detectIndustryShared(resumeText);
        sharedEnrichment = {
          subRole: shared.subRole,
          techStack: shared.techStack,
          educationSignals: shared.educationSignals,
          alternativeIndustriesWithReasons: (shared.alternativeIndustries || [])
            .slice(0, 3)
            .map((a: any) => ({ industry: a.industry, reason: a.reason })),
        };
      } catch (e) {
        console.warn('[FREE-KEYWORD-SCAN-STREAM] Shared industry enrichment failed:', (e as Error).message);
      }

      const industryDetectionMeta = {
        detected: hybridResult.industry,
        subIndustry: hybridResult.subIndustry,
        parentIndustry: hybridResult.parentIndustry || getParentIndustry(hybridResult.industry),
        confidence: hybridResult.confidence,
        signals: hybridResult.signals,
        aiSuggested: rawIndustry,
        score: hybridResult.score,
        ...sharedEnrichment,
      };
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Industry detection: ${JSON.stringify(industryDetectionMeta)}`);


      // Log industry detection metrics for accuracy tracking (non-blocking)
      const normalizedAISuggested = normalizeIndustry(rawIndustry);
      
      // IMPROVED: Compare at parent level - AI often returns broad categories like 'technology', 'creative'
      // while server returns specific sub-industries like 'software_engineering', 'ux_design'
      // Both should be considered a match if they share the same parent industry
      const serverParent = getParentIndustry(serverDetection.industry);
      const aiParent = getParentIndustry(normalizedAISuggested);
      
      // Parent aliases - treat these as equivalent for matching purposes
      const PARENT_ALIASES: Record<string, string> = {
        'hr': 'human_resources',
        'human_resources': 'human_resources',
      };
      
      // Normalize parents for comparison
      const normalizedServerParent = PARENT_ALIASES[serverParent] || serverParent;
      const normalizedAIParent = PARENT_ALIASES[aiParent] || aiParent;
      const normalizedAIForComparison = PARENT_ALIASES[normalizedAISuggested] || normalizedAISuggested;
      
      // Exact match (both same specific industry)
      const isExactMatch = serverDetection.industry === normalizedAISuggested;
      // Parent match (server sub-industry maps to AI's broad category)
      const isParentMatch = normalizedServerParent === normalizedAIForComparison || 
        serverDetection.industry === normalizedAIParent ||
        normalizedServerParent === normalizedAIParent;
      // Cross-level match (AI returns parent, server returns child of that parent)
      const serverParentFromMap = INDUSTRY_PARENTS[serverDetection.industry];
      const normalizedServerParentFromMap = serverParentFromMap ? (PARENT_ALIASES[serverParentFromMap] || serverParentFromMap) : null;
      const isCrossLevelMatch = normalizedServerParentFromMap === normalizedAIForComparison;
      
      // Combined: consider it a match if any level matches
      const serverAIMatch = isExactMatch || isParentMatch || isCrossLevelMatch;
      const serverAIParentMatch = isParentMatch || isCrossLevelMatch;
      
      console.log(`[INDUSTRY-DETECT-METRICS] Match analysis: server=${serverDetection.industry} (parent=${serverParent}), AI=${normalizedAISuggested} (parent=${aiParent}), exact=${isExactMatch}, parent=${isParentMatch}, cross=${isCrossLevelMatch}, final=${serverAIMatch}`);
      
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

      // ======================== Industry Score Calibration ========================
      // Apply industry-specific calibration BEFORE computing derived fields
      const rawAtsScore = analysis.atsScoreEstimate || 0;
      const scoreCalibration = calibrateScoreByIndustry(
        rawAtsScore,
        hybridResult.industry,
        seniority,
        resumeText
      );
      
      if (scoreCalibration.adjustment !== 0) {
        console.log(`[FREE-KEYWORD-SCAN-STREAM] Score calibration: ${rawAtsScore} -> ${scoreCalibration.calibratedScore} (${scoreCalibration.reason})`);
        analysis.atsScoreEstimate = scoreCalibration.calibratedScore;
      }

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

      // 4. Industry Benchmark (uses calibrated score)
      const computedBenchmark = await computeIndustryBenchmark(supabase, analysis.atsScoreEstimate || 0, analysis.industry);
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

      // 9. Industry-Specific Keyword Suggestions
      const industryKeywordAnalysis = computeIndustryKeywordSuggestions(hybridResult.industry, resumeText);
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Industry keyword analysis: ${JSON.stringify({
        industry: industryKeywordAnalysis?.industryName,
        found: industryKeywordAnalysis?.keywordsFound,
        missing: industryKeywordAnalysis?.keywordsMissing,
        coverage: industryKeywordAnalysis?.coverageScore
      })}`);

      // 10. Elite Signal Detection (brand companies, deal sizes, founding roles, quota consistency)
      const eliteSignals = detectEliteSignals(resumeText);
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Elite signals detected: ${eliteSignals.length} (${eliteSignals.map(s => s.type).join(', ')})`);
      // Strip any AI-hallucinated fields that we compute server-side
      const { eliteSignals: _aiEliteSignals, credibilityIssues: _aiCredibility, ...sanitizedAnalysis } = analysis as any;
      if (_aiEliteSignals) {
        console.log(`[FREE-KEYWORD-SCAN-STREAM] Stripped AI-hallucinated eliteSignals: ${JSON.stringify(_aiEliteSignals)}`);
      }
      
      // Build response with computed fields merged
      const responseData = {
        success: true,
        ...sanitizedAnalysis,
        // New fields for improved analysis
        resumeType,
        seniorityLevel: seniority,
        dualScore,
        calibratedLanguage,
        usageRecommendations,
        credibilityIssues: credibilityIssues.slice(0, 3), // Top 3 credibility issues
        eliteSignals, // Brand companies, large deals, founding roles, quota consistency
        contentLocations: {
          quota: quotaLocation,
          metrics: metricsLocation
        },
        // Industry detection with metadata for transparency
        industryDetection: industryDetectionMeta,
        // Industry-specific keyword suggestions
        industryKeywords: industryKeywordAnalysis,
        // Override/add computed fields
        timelineAnalysis: computedTimeline,
        quantificationScore: computedQuantification,
        bulletImpactScore: computedBulletImpact,
        industryBenchmark: computedBenchmark,
        // Score calibration metadata
        scoreCalibration: scoreCalibration.adjustment !== 0 ? {
          rawScore: rawAtsScore,
          calibratedScore: scoreCalibration.calibratedScore,
          adjustment: scoreCalibration.adjustment,
          reason: scoreCalibration.reason
        } : undefined,
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
          
          // Filter 5: Don't flag short employment gaps (< 12 months) as critical
          // Most recruiters don't notice or care about gaps under a year
          if (combined.includes('gap') || combined.includes('employment gap') || combined.includes('career gap')) {
            // Check if the gap is short (mentioned as months or < 1 year)
            const monthsMatch = combined.match(/(\d+)\s*month/);
            if (monthsMatch && parseInt(monthsMatch[1]) < 12) {
              console.log(`[RED-FLAG-FILTER] Filtered short employment gap (${monthsMatch[1]} months)`);
              return false;
            }
            // Also check for "8 month" style mentions in the issue
            const shortGapPattern = /\b([1-9]|1[01])\s*month/;
            if (shortGapPattern.test(combined)) {
              console.log(`[RED-FLAG-FILTER] Filtered short employment gap`);
              return false;
            }
          }
          
          // ======================== EXPERIENCE-AWARE RED FLAG FILTERING ========================
          // Filter 6: Gate red flags by seniority level
          
          // 6a: Entry-level should NOT be flagged for missing leadership/management keywords
          if (seniority === 'entry') {
            if (combined.includes('leadership') || combined.includes('management') || 
                combined.includes('team lead') || combined.includes('strategic') ||
                combined.includes('executive') || combined.includes('director')) {
              console.log(`[RED-FLAG-FILTER] Filtered leadership flag for entry-level candidate`);
              return false;
            }
          }
          
          // 6b: Senior/Executive roles should NOT be flagged for missing portfolio/GitHub
          if (seniority === 'senior' || seniority === 'executive') {
            if (combined.includes('github') || combined.includes('portfolio') || 
                combined.includes('personal website') || combined.includes('personal project') ||
                combined.includes('side project')) {
              console.log(`[RED-FLAG-FILTER] Filtered portfolio/GitHub flag for ${seniority}-level candidate`);
              return false;
            }
          }
          
          // 6c: Non-tech roles should NOT be flagged for missing technical portfolio/GitHub
          const isNonTechIndustry = ['sales', 'marketing', 'hr', 'human_resources', 'legal', 
            'education', 'healthcare', 'nursing', 'finance', 'accounting', 'hospitality',
            'nonprofit', 'retail', 'consulting'].includes(analysis.industry);
          if (isNonTechIndustry) {
            if (combined.includes('github') || combined.includes('technical portfolio') ||
                combined.includes('coding') || combined.includes('programming')) {
              console.log(`[RED-FLAG-FILTER] Filtered tech-specific flag for ${analysis.industry} industry`);
              return false;
            }
          }
          
          // 6d: Entry-level should NOT be penalized for lack of quantified results at same intensity
          if (seniority === 'entry') {
            if ((combined.includes('quantif') || combined.includes('metric') || combined.includes('measurable')) 
                && combined.includes('missing')) {
              // Downgrade but don't remove — entry-level resumes often lack metrics
              // Let it through but the impact text should be softened by the AI prompt
              // Only filter if framed as a critical/major issue
              if (combined.includes('critical') || combined.includes('major') || combined.includes('significant')) {
                console.log(`[RED-FLAG-FILTER] Filtered critical metrics flag for entry-level candidate`);
                return false;
              }
            }
          }
          
          // 6e: LinkedIn URL is less critical for senior/executive (they get found, not search)
          if ((seniority === 'senior' || seniority === 'executive') && 
              combined.includes('linkedin') && (combined.includes('missing') || combined.includes('add'))) {
            console.log(`[RED-FLAG-FILTER] Filtered LinkedIn flag for ${seniority}-level candidate`);
            return false;
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

      // Send admin notification email for every free scan (skip if testing)
      EdgeRuntime.waitUntil(
        (async () => {
          try {
            // Skip admin email if explicitly requested (for testing)
            if (skipAdminEmail) {
              console.log('[FREE-KEYWORD-SCAN-STREAM] Skipping admin notification (skipAdminEmail=true)');
              return;
            }
            
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
