/**
 * Market Intelligence Module
 *
 * Capabilities:
 * 1. Country + industry market insights injected into AI prompt
 * 2. Skills recency scoring (aging vs fresh skills per industry)
 * 3. Career trajectory analysis (upward / lateral / transition / regression)
 * 4. ATS system detection from job description text
 *
 * Geo/country detection deliberately does NOT live here — use the per-function
 * copies (free-keyword-scan/market-intelligence.ts and the -stream fork), which
 * carry fixes this shared copy never received. Do not re-add a detector here.
 *
 * All functions are pure / synchronous — no network calls.
 */

// ─── 1. GEO DETECTION TYPES ──────────────────────────────────────────────────

export interface GeoDetectionResult {
  country: string | null;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
  source: 'phone' | 'address' | 'institution' | 'currency' | 'ip' | 'none';
}

// ─── 2. MARKET INTELLIGENCE DATA ─────────────────────────────────────────────

interface MarketInsight {
  marketSummary: string;                // 1-2 sentence market overview
  hotSkills: string[];                  // Skills in high demand right now
  risingKeywords: string[];             // Keywords trending up in job postings
  cvNorms: string[];                    // Country-specific CV/resume formatting norms
  salaryContext?: string;               // Comp context if relevant
  uniqueSignals?: string[];             // Differentiating factors in this market
}

type CountryIndustryKey = `${string}:${string}` | string;

// Market data keyed by "country:industry" with country-only fallbacks.
// Reflects market conditions as of mid-2025.
const MARKET_DATA: Record<CountryIndustryKey, MarketInsight> = {

  // ── UNITED KINGDOM ──
  'GB:technology': {
    marketSummary: 'UK tech hiring is recovering in 2025 with strong demand in AI, fintech, and cybersecurity. London remains the hub but Manchester and Bristol are growing fast.',
    hotSkills: ['Python', 'Kubernetes', 'TypeScript', 'LLM/GenAI', 'Terraform', 'Golang'],
    risingKeywords: ['AI integration', 'MLOps', 'platform engineering', 'FinOps'],
    cvNorms: ['UK CVs are typically 2 pages maximum', 'Do NOT include photo, age, or marital status — these can trigger unconscious bias claims', 'Spell out GCSE/A-Level grades if listed', 'Include "right to work" status if non-UK national'],
    salaryContext: 'Senior SWE roles in London range £80-130K; outside London 15-25% lower',
    uniqueSignals: ['SC Clearance or DV Clearance dramatically expands gov/defence opportunities', 'IR35 compliance note matters for contractors'],
  },
  'GB:finance': {
    marketSummary: 'London remains Europe\'s largest financial centre despite post-Brexit shifts. IB, asset management, and fintech all hiring. Regulatory roles especially in demand.',
    hotSkills: ['Python', 'SQL', 'Bloomberg', 'VBA', 'Power BI', 'IFRS'],
    risingKeywords: ['ESG reporting', 'SFDR compliance', 'AI in finance', 'RegTech'],
    cvNorms: ['Two pages standard', 'A-Levels and university grades expected for junior roles', 'Include professional body membership (CFA, CIMA, ACCA, ACA)'],
    salaryContext: 'IB analyst £60-80K base + bonus; AM roles £70-120K depending on AUM',
    uniqueSignals: ['CIMA, ACA, ACCA certifications valued over US CPA', 'FCA regulatory knowledge is a differentiator'],
  },
  'GB:consulting': {
    marketSummary: 'Big 4 and MBB continue strong hiring. Public sector consulting saw budget cuts in 2024 but private sector demand is robust.',
    hotSkills: ['PowerPoint', 'Excel', 'Python', 'Tableau', 'stakeholder management'],
    risingKeywords: ['digital transformation', 'AI strategy', 'operating model', 'ESG'],
    cvNorms: ['Two pages maximum for MBB', 'A-Level grades expected by top firms', 'Include university rank and degree classification (2:1, First)'],
    uniqueSignals: ['Degree classification (First, 2:1) matters more than in the US', 'University brand (Oxbridge, Russel Group) still heavily weighted at MBB'],
  },
  'GB:healthcare': {
    marketSummary: 'NHS and private sector both hiring. Clinical roles have strong demand; health tech and digital health are fast growing.',
    hotSkills: ['EMR/EHR systems', 'clinical audit', 'NICE guidelines', 'patient safety'],
    risingKeywords: ['digital health', 'NHS App', 'remote monitoring', 'AI diagnostics'],
    cvNorms: ['GMC/NMC registration number required', 'Clinical roles: include appraisal/revalidation status', 'DBS check status should be mentioned'],
    uniqueSignals: ['NHS banding knowledge expected', 'Right to work + GMC registration are hard gates'],
  },

  // ── AUSTRALIA ──
  'AU:technology': {
    marketSummary: 'Australian tech market is tight but resilient. Sydney and Melbourne dominate; gov digital transformation projects are creating strong demand.',
    hotSkills: ['Python', 'AWS', 'React', 'TypeScript', 'Kubernetes', 'Terraform'],
    risingKeywords: ['cloud migration', 'cybersecurity', 'data engineering', 'AI/ML'],
    cvNorms: ['2-3 pages acceptable', 'Include Australian work rights status', 'Referees expected — "available on request" is standard', 'Include LinkedIn URL'],
    salaryContext: 'Senior SWE AUD $150-200K; mid-level $110-150K',
    uniqueSignals: ['NV1/NV2 security clearance expands ASD/Defence opportunities significantly', 'Australian citizen status matters for gov roles'],
  },
  'AU:finance': {
    marketSummary: 'Big 4 banks (CBA, ANZ, NAB, Westpac), superannuation funds, and growing fintech sector. ASIC regulatory roles in demand.',
    hotSkills: ['Excel', 'Python', 'SQL', 'Power BI', 'IFRS', 'superannuation'],
    risingKeywords: ['APRA compliance', 'open banking', 'CDR', 'ESG reporting', 'Basel IV'],
    cvNorms: ['Include CA ANZ or CPA Australia membership', 'Mention ASIC RG146 compliance for financial advisors'],
    salaryContext: 'IB analyst AUD $90-120K; CFP/CPA roles $90-130K',
    uniqueSignals: ['Superannuation industry knowledge is a major differentiator', 'ASIC/APRA regulatory knowledge valued highly'],
  },
  'AU:healthcare': {
    marketSummary: 'Strong demand across nursing, allied health, and aged care post-COVID. Telehealth and rural/remote roles especially undersupplied.',
    hotSkills: ['AHPRA registration', 'EMR systems', 'clinical governance', 'aged care standards'],
    risingKeywords: ['telehealth', 'aged care reform', 'NDIS', 'rural health'],
    cvNorms: ['AHPRA registration number required for clinical roles', 'Working with Children Check (WWCC) state-specific', 'NDIS Worker Screening mandatory for disability roles'],
    uniqueSignals: ['AHPRA registration status is a hard requirement — always list it prominently', 'Aged Care Quality Standards compliance knowledge is valued'],
  },

  // ── GERMANY ──
  'DE:technology': {
    marketSummary: 'Germany\'s tech sector is growing, particularly in Berlin, Munich, and Hamburg. Mittelstand companies increasingly digital. English-language roles common in Berlin startup scene.',
    hotSkills: ['Java', 'Python', 'SAP', 'Kubernetes', 'TypeScript', 'AWS'],
    risingKeywords: ['Industry 4.0', 'Embedded systems', 'automotive software', 'B2B SaaS'],
    cvNorms: ['German Lebenslauf traditionally includes photo, date of birth, nationality — now optional for modern companies', 'English CV standard at international/startup companies', 'Arbeitszeugnisse (employment references) expected for applications'],
    salaryContext: 'Senior SWE €80-120K in Munich/Frankfurt; Berlin 10-15% lower',
    uniqueSignals: ['SAP expertise is extremely valuable across all industries', 'German language skills required at most non-startup companies', 'Tarifvertrag (collective bargaining) affects comp at large companies'],
  },
  'DE:engineering': {
    marketSummary: 'Automotive and mechanical engineering remain core; green energy and electrification driving major new hiring waves.',
    hotSkills: ['CAD/CATIA', 'SolidWorks', 'MATLAB', 'ISO standards', 'DIN norms', 'electrification'],
    risingKeywords: ['BEV/EV development', 'H2/hydrogen', 'AUTOSAR', 'functional safety'],
    cvNorms: ['Ingenieur title is legally protected in Germany — include your degree classification', 'VDI membership valued', 'Include Fachrichtung (engineering specialization) explicitly'],
    uniqueSignals: ['Automotive supply chain knowledge (Tier 1/Tier 2) is extremely marketable', 'TÜV certifications valued'],
  },

  // ── INDIA ──
  'IN:technology': {
    marketSummary: 'India\'s tech market is the world\'s largest IT services employer. Product-based companies (hyperscalers + unicorns) command premium pay. Services (TCS, Infosys, Wipro) have high volume hiring.',
    hotSkills: ['Java', 'Python', 'React', 'AWS', 'Microservices', 'SQL', 'DSA'],
    risingKeywords: ['GenAI integration', 'MLOps', 'cloud-native', 'DevSecOps', 'SRE'],
    cvNorms: ['1-2 pages preferred', 'Include 10th/12th board marks for fresher roles', 'CGPA expected for campus hires', 'Include notice period clearly'],
    salaryContext: 'Senior SWE (7+ years) at product company ₹40-80L CTC; services ₹20-35L',
    uniqueSignals: ['Notice period (30/60/90 days) must be prominently stated', 'DSA/competitive programming background valued for product companies', 'FAANG/MAANG experience dramatically increases market value'],
  },
  'IN:finance': {
    marketSummary: 'BFSI sector is India\'s second-largest employer. NBFCs, fintech startups, and private banks all hiring aggressively. CA designation is highly valued.',
    hotSkills: ['Excel', 'Tally ERP', 'SAP FICO', 'Python', 'SQL', 'IND AS'],
    risingKeywords: ['UPI/payment systems', 'SEBI compliance', 'RBI regulations', 'fintech credit'],
    cvNorms: ['CA (Institute of Chartered Accountants of India) designation is paramount', 'Include All India Rank if CA inter/final was AIR-ranked', 'Notice period must be stated'],
    uniqueSignals: ['CA qualification from ICAI is the gold standard — equivalent to CPA+CFA combined in US market', 'SEBI/RBI regulatory experience is a major differentiator'],
  },

  // ── SINGAPORE ──
  'SG:technology': {
    marketSummary: 'Singapore is APAC\'s tech hub. Strong government investment in digital economy; hyperscalers (AWS, Google, Meta, ByteDance) have major offices. Fintech and healthtech booming.',
    hotSkills: ['Python', 'Kubernetes', 'TypeScript', 'AWS/GCP', 'Golang', 'Data Engineering'],
    risingKeywords: ['AI governance', 'MAS TRM compliance', 'green tech', 'APAC expansion'],
    cvNorms: ['2 pages standard', 'Include Singapore PR/EP/DP status explicitly', 'Photo optional but common', 'Include expected salary range'],
    salaryContext: 'Senior SWE SGD $150-220K; mid-level $100-150K',
    uniqueSignals: ['MAS TRM (Technology Risk Management) guidelines knowledge valued in fintech/banking', 'PDPA compliance knowledge is increasingly expected', 'EP/PR status affects hiring speed significantly'],
  },
  'SG:finance': {
    marketSummary: 'Singapore is the leading financial centre in APAC. MAS-regulated institutions, family offices, and fintech all thriving. Strong demand for risk, compliance, and quant roles.',
    hotSkills: ['Python', 'Bloomberg', 'Excel', 'SQL', 'MAS compliance', 'ISDA'],
    risingKeywords: ['Digital asset regulation', 'MAS FEAT principles', 'ESG finance', 'payments modernisation'],
    salaryContext: 'VP-level banking roles SGD $180-280K; quant roles $200-350K',
    uniqueSignals: ['MAS licensing knowledge (CMS, CMSL) is a hard gate for regulated roles', 'Family office experience is a fast-growing niche'],
    cvNorms: ['2 pages standard', 'Include Singapore PR/EP/DP status explicitly', 'State MAS licences held (CMS, CMSL) explicitly', 'Include expected salary range'],
  },

  // ── UAE ──
  'AE:technology': {
    marketSummary: 'Dubai and Abu Dhabi are investing heavily in tech. Strong demand from government digital initiatives, fintech, and e-commerce. Tax-free compensation is a draw.',
    hotSkills: ['Python', 'AWS', 'React', 'TypeScript', 'cloud', 'AI/ML'],
    risingKeywords: ['UAE digital economy', 'ADGM fintech', 'DIFC technology', 'smart government'],
    cvNorms: ['Photo expected on CV', 'Include nationality and visa status', 'Arabic language skills are a bonus but not required for tech roles', 'Expected salary must be stated'],
    salaryContext: 'Senior SWE AED $250-400K (tax-free); significant variation by company type',
    uniqueSignals: ['UAE Golden Visa eligibility for tech talent is a differentiator', 'ADGM/DIFC regulatory knowledge valued in fintech', 'Arabic language a significant differentiator in government projects'],
  },

  // ── CANADA ──
  'CA:technology': {
    marketSummary: 'Canadian tech market is strong in Toronto, Vancouver, and Waterloo. US companies have major offices; homegrown AI research community is world-class.',
    hotSkills: ['Python', 'TypeScript', 'AWS', 'Kubernetes', 'React', 'ML/AI'],
    risingKeywords: ['AI/ML', 'cloud-native', 'FinOps', 'cybersecurity', 'web3 (selective)'],
    cvNorms: ['1-2 pages preferred', 'Do NOT include photo, DOB, or marital status (protected grounds under CHRA)', 'Include Canadian PR/citizenship status or work permit type'],
    salaryContext: 'Senior SWE CAD $150-220K in Toronto/Vancouver; lower in other cities',
    uniqueSignals: ['Canadian permanent residency/citizenship often required for certain gov/defence contracts', 'Federal government positions require enhanced reliability screening or secret clearance'],
  },

  // ── US (DEFAULT) ──
  'US:technology': {
    marketSummary: 'US tech hiring in 2025 is bifurcated: hyperscalers and AI companies are hiring aggressively while mid-size SaaS companies are more selective. Strong demand for AI/ML, platform, and security engineers.',
    hotSkills: ['Python', 'TypeScript', 'Kubernetes', 'LLM APIs', 'Terraform', 'Golang', 'Rust'],
    risingKeywords: ['agentic AI', 'RAG', 'FinOps', 'platform engineering', 'zero trust security'],
    cvNorms: ['1 page for <10 years experience, 2 pages maximum', 'Do NOT include photo, age, nationality, or marital status', 'Include LinkedIn URL and GitHub for technical roles'],
    salaryContext: 'Senior SWE: $180-280K TC at top companies; $130-180K at mid-market',
    uniqueSignals: ['Work authorization status (US citizen, GC, H1B) affects hiring speed dramatically', 'Leetcode/system design skills expected at FAANG+'],
  },
  'US:finance': {
    marketSummary: 'Wall Street hiring recovering in 2025. IB deal flow picking up; AM and hedge funds selective but paying well. Fintech and crypto roles growing again.',
    hotSkills: ['Excel/VBA', 'Python', 'Bloomberg', 'SQL', 'PowerPoint', 'financial modeling'],
    risingKeywords: ['AI in finance', 'RPA', 'ESG', 'alt data', 'quant finance'],
    cvNorms: ['One page preferred for analysts, two for VPs+', 'Do not include photo or personal demographics', 'GPA still expected for campus/entry-level roles'],
    salaryContext: 'IB analyst $110-120K base + $50-100K bonus; senior associate $180-230K',
    uniqueSignals: ['Series 7/63/65 licenses dramatically expand role options', 'MBA from M7 school still heavily weighted at top firms'],
  },
  'US:consulting': {
    marketSummary: 'MBB and Big 4 strategy practices are highly selective but hiring. Boutique strategy firms growing. Technology consulting demand remains strong.',
    hotSkills: ['PowerPoint', 'Excel', 'SQL', 'Python', 'stakeholder management', 'project management'],
    risingKeywords: ['AI strategy', 'digital transformation', 'operating model', 'M&A integration'],
    cvNorms: ['One page strictly for MBB applications', 'GPA required — typically 3.5+ expected', 'Include "top quartile" academic honors explicitly'],
    uniqueSignals: ['Case interview performance is the primary gate — this resume gets you the interview', 'Target school brands (HBS, Wharton, Kellogg, Booth) still heavily weighted'],
  },
  'US:healthcare': {
    marketSummary: 'Healthcare is the US\'s largest employer. Clinical roles have persistent shortages; health tech and digital health booming; pharma and biotech hiring strongly.',
    hotSkills: ['Epic', 'Cerner', 'EMR/EHR', 'HIPAA', 'clinical trial management', 'FDA 21 CFR'],
    risingKeywords: ['AI diagnostics', 'value-based care', 'interoperability', 'telehealth', 'cell & gene therapy'],
    cvNorms: ['Clinical roles: include license numbers, NPI, state licensure', 'Include malpractice insurance status for physicians', 'DEA registration number for prescribers'],
    uniqueSignals: ['NPI number is a must-have for clinical roles', 'Board certification status dramatically affects positioning', 'Joint Commission knowledge valued in hospital administration'],
  },
  'US:sales': {
    marketSummary: 'SaaS sales hiring remains strong, especially enterprise and AI-native companies. RevOps and sales engineering roles are premium segments.',
    hotSkills: ['Salesforce', 'Outreach/Salesloft', 'MEDDIC/MEDDPICC', 'HubSpot', 'Clari', 'Gong'],
    risingKeywords: ['AI-assisted selling', 'PLG sales motion', 'product-led sales', 'usage-based'],
    cvNorms: ['Quota attainment percentages are mandatory — e.g. "125% of $1.2M quota"', 'ARR closed numbers expected for enterprise AE roles', 'Include average deal size and sales cycle length'],
    uniqueSignals: ['MEDDIC/MEDDPICC methodology knowledge is increasingly a hard requirement at enterprise companies', 'Named account lists and territory management are differentiators'],
  },
  'US:marketing': {
    marketSummary: 'Marketing teams are leaner but spending is up on performance/demand gen. Content marketing and AI-assisted workflows in high demand.',
    hotSkills: ['HubSpot', 'Salesforce Marketing Cloud', 'Google Ads', 'SQL', 'Python', 'Figma'],
    risingKeywords: ['AI content generation', 'account-based marketing', 'intent data', 'dark funnel'],
    cvNorms: ['Include specific CAC, MQL, pipeline metrics — vague "increased traffic" claims are filtered out', 'Budget ownership ($Xk/year managed) is a strong differentiator'],
    uniqueSignals: ['Attribution modeling and multi-touch analytics skills are increasingly valued', 'AI tool proficiency (Jasper, Copy.ai, Midjourney for creative) differentiates'],
  },
  'US:product_management': {
    marketSummary: 'PM roles are highly competitive in 2025. AI PMs commanding significant premiums. B2B SaaS and AI companies are the main hirers.',
    hotSkills: ['SQL', 'Amplitude/Mixpanel', 'Figma', 'Jira', 'A/B testing', 'stakeholder management'],
    risingKeywords: ['AI product', 'LLM product development', 'agentic workflows', 'product-led growth'],
    cvNorms: ['Quantify product impact (e.g., "drove 40% DAU increase" not "improved engagement")', 'Include specific OKR outcomes', 'Ship velocity and team size context expected at senior level'],
    uniqueSignals: ['AI/ML product experience commands 20-40% salary premium', 'Technical PM credentials (CS degree, coding skills) are differentiators at most companies now'],
  },

  // Fallback for any country with no specific data
  'DEFAULT': {
    marketSummary: 'Ensure your resume is optimized for ATS systems used in your target market.',
    hotSkills: [],
    risingKeywords: [],
    cvNorms: ['Use consistent date formatting throughout', 'Include contact details prominently', 'Tailor the summary to each role'],
  },
};

/**
 * Get market insight for a country + industry combination.
 * Falls back to US data, then country-only, then DEFAULT.
 */
export function getMarketInsight(country: string | null, industry: string): MarketInsight & { countryName: string } {
  const c = (country || 'US').toUpperCase();

  const COUNTRY_NAMES: Record<string, string> = {
    US: 'United States', GB: 'United Kingdom', AU: 'Australia', CA: 'Canada',
    DE: 'Germany', FR: 'France', IN: 'India', SG: 'Singapore', AE: 'UAE',
    HK: 'Hong Kong', JP: 'Japan', NL: 'Netherlands', IE: 'Ireland',
    CH: 'Switzerland', SE: 'Sweden', NZ: 'New Zealand', ZA: 'South Africa',
    BR: 'Brazil', MX: 'Mexico', IL: 'Israel', KR: 'South Korea',
  };

  const specific = MARKET_DATA[`${c}:${industry}`];
  if (specific) return { ...specific, countryName: COUNTRY_NAMES[c] || c };

  // Try broader industry match with US
  const usIndustry = MARKET_DATA[`US:${industry}`];
  if (usIndustry) return { ...usIndustry, countryName: COUNTRY_NAMES[c] || c };

  return { ...MARKET_DATA['DEFAULT'], countryName: COUNTRY_NAMES[c] || c };
}

export function formatGeoContextForPrompt(
  country: string | null,
  industry: string,
  resumeCountry: GeoDetectionResult,
): string {
  const effectiveCountry = resumeCountry.country || country;
  if (!effectiveCountry && !country) return '';

  const insight = getMarketInsight(effectiveCountry, industry);
  const lines = ['\n\n<geo_market_context>'];
  lines.push(`Candidate Location: ${insight.countryName} (${resumeCountry.source === 'phone' ? 'confirmed from phone number' : resumeCountry.source === 'address' ? 'inferred from address' : 'inferred from IP'})`);
  lines.push(`Market Summary: ${insight.marketSummary}`);
  if (insight.hotSkills.length > 0) lines.push(`Hot Skills in ${insight.countryName} ${industry} market: ${insight.hotSkills.join(', ')}`);
  if (insight.risingKeywords.length > 0) lines.push(`Rising Keywords: ${insight.risingKeywords.join(', ')}`);
  if (insight.cvNorms.length > 0) {
    lines.push('Country-Specific CV Norms:');
    insight.cvNorms.forEach(n => lines.push(`  - ${n}`));
  }
  if (insight.uniqueSignals?.length) {
    lines.push('Market-Specific Differentiators:');
    insight.uniqueSignals.forEach(s => lines.push(`  - ${s}`));
  }
  if (insight.salaryContext) lines.push(`Salary Context: ${insight.salaryContext}`);
  lines.push('\nINSTRUCTION: Incorporate the above market context into your analysis. If the resume is missing any country-specific credentials or norm elements (e.g., license numbers, visa status, degree classification), flag them. If the candidate\'s skills match the "hot skills" list, explicitly affirm this as a strength. Reference the candidate\'s country market in your insights.');
  lines.push('</geo_market_context>');
  return lines.join('\n');
}

// ─── 3. SKILLS RECENCY SCORING ────────────────────────────────────────────────

// Skills that are declining in job postings as of 2025
const AGING_SKILLS_BY_INDUSTRY: Record<string, string[]> = {
  technology: [
    'jquery', 'backbone.js', 'angularjs', 'angular.js', 'coffeescript',
    'bower', 'grunt', 'gulp', 'svn', 'subversion', 'cvs', 'mercurial',
    'flash', 'actionscript', 'silverlight', 'vbscript',
    'soap', 'wsdl', 'xml-rpc',
    'mean stack', 'lamp stack',
    'openshift 3', 'vmware vsphere 5', 'on-premise servers',
    'perl 5', 'coldfusion', 'cobol', 'delphi', 'vb.net',
    'hadoop mapreduce', 'hive (legacy)', 'pig latin',
    'rss feeds', 'yahoo query language',
    'phonegap', 'cordova', 'sencha touch',
    'internet explorer', 'ie11', 'ie compatibility',
    'google analytics universal',
  ],
  data_science: [
    'r studio (standalone)', 'spss', 'sas base',
    'hadoop mapreduce', 'pig', 'hive ql',
    'tableau public only',
    'excel pivot tables only',
  ],
  data_engineering: [
    'hadoop mapreduce', 'oozie', 'sqoop', 'flume', 'pig',
    'hive ql', 'teradata (legacy)', 'informatica powercenter',
    'ssis (standalone)', 'pentaho',
  ],
  marketing: [
    'google analytics universal', 'adobe flash banners', 'keyword stuffing',
    'blackhat seo', 'link farms',
    'yahoo search marketing', 'myspace marketing',
    'flash animations', 'email blast (as term)', 'pop-up ads',
  ],
  finance: [
    'lotus 1-2-3', 'as/400 finance', 'cognos controller (legacy)',
    'hyperion (pre-cloud)', 'oracle financials 11i',
  ],
};

// Skills that are rising in job postings as of 2025
const FRESH_SKILLS_BY_INDUSTRY: Record<string, string[]> = {
  technology: [
    'llm', 'langchain', 'rag', 'vector database', 'embedding',
    'agentic ai', 'function calling', 'mcp', 'llmops',
    'platform engineering', 'internal developer platform', 'backstage',
    'opentelemetry', 'ebpf', 'wasm', 'webassembly',
    'rust', 'go', 'deno', 'bun',
    'cursor', 'copilot', 'ai-assisted development',
    'finops', 'cloud cost optimization',
    'zero trust', 'spiffe', 'spdx', 'sbom',
    'temporal', 'dapr', 'envoy', 'cilium',
  ],
  data_science: [
    'llm fine-tuning', 'rag', 'causal inference', 'dbt',
    'feature store', 'mlflow', 'wandb', 'bentoml',
    'evidence.dev', 'polars', 'duckdb',
  ],
  data_engineering: [
    'dbt', 'dagster', 'duckdb', 'iceberg', 'delta lake',
    'polars', 'kafka connect', 'flink', 'materialize',
    'openlineage', 'data mesh', 'data contracts',
  ],
  marketing: [
    'ai content generation', 'intent data', 'dark funnel analytics',
    'account-based experience', 'abx', 'product-led growth',
    'ga4', 'server-side tagging', 'cookieless tracking',
    'generative ai for creative', 'performance max',
  ],
  finance: [
    'python (finance)', 'ai in finance', 'alternative data',
    'esg reporting', 'sfdr', 'tcfd', 'xbrl',
    'digital assets', 'tokenization',
    'power bi', 'tableau', 'sql for finance',
  ],
};

export interface SkillsRecencyResult {
  agingSkills: string[];
  freshSkills: string[];    // Skills in resume that match fresh/in-demand list
  freshnessScore: number;   // 0-100, higher = more current skill set
  hasAgingSignals: boolean;
}

export function analyzeSkillsRecency(resumeText: string, industry: string): SkillsRecencyResult {
  const lower = resumeText.toLowerCase();
  const agingList = AGING_SKILLS_BY_INDUSTRY[industry] || AGING_SKILLS_BY_INDUSTRY.technology;
  const freshList = FRESH_SKILLS_BY_INDUSTRY[industry] || FRESH_SKILLS_BY_INDUSTRY.technology;

  const agingSkills = agingList.filter(s => lower.includes(s.toLowerCase()));
  const freshSkills = freshList.filter(s => lower.includes(s.toLowerCase()));

  // Score: start at 70, +5 per fresh skill (max +30), -8 per aging skill (min 20)
  const freshnessScore = Math.max(20, Math.min(100,
    70 + freshSkills.length * 5 - agingSkills.length * 8
  ));

  return {
    agingSkills: agingSkills.slice(0, 5),
    freshSkills: freshSkills.slice(0, 5),
    freshnessScore,
    hasAgingSignals: agingSkills.length > 0,
  };
}

export function formatSkillsRecencyForPrompt(recency: SkillsRecencyResult, industry: string): string {
  if (!recency.hasAgingSignals && recency.freshSkills.length === 0) return '';
  const lines = ['\n\n<skills_recency_analysis>'];
  if (recency.agingSkills.length > 0) {
    lines.push(`AGING SKILLS DETECTED (declining in ${industry} job postings as of 2025): ${recency.agingSkills.join(', ')}`);
    lines.push('INSTRUCTION: Flag these as "skills that may date your resume" in red flags or quick wins. Suggest modern equivalents where possible (e.g., SVN → Git, AngularJS → React/Vue/Angular 17+). Do NOT tell the candidate to remove them entirely if they\'re genuinely experienced — instead suggest pairing them with modern equivalents.');
  }
  if (recency.freshSkills.length > 0) {
    lines.push(`STRONG/CURRENT SKILLS (high demand in 2025 ${industry} market): ${recency.freshSkills.join(', ')}`);
    lines.push('INSTRUCTION: Affirm these as genuine strengths and mention them as competitive advantages in your analysis.');
  }
  lines.push(`Skills Freshness Score: ${recency.freshnessScore}/100`);
  lines.push('</skills_recency_analysis>');
  return lines.join('\n');
}

// ─── 4. CAREER TRAJECTORY ANALYSIS ──────────────────────────────────────────

export type TrajectoryType = 'upward' | 'lateral' | 'transition' | 'regression' | 'early_career' | 'unknown';

export interface CareerTrajectory {
  trajectory: TrajectoryType;
  promotionCount: number;
  industryTransitionDetected: boolean;
  fromIndustry?: string;
  transitionConfidence: 'high' | 'medium' | 'low';
  yearsAtCurrentLevel: number | null;
  progressionSummary: string;
}

const SENIORITY_RANK: Record<string, number> = {
  intern: 0, trainee: 0, apprentice: 0,
  associate: 1, junior: 1, entry: 1, assistant: 1, coordinator: 1,
  analyst: 2, specialist: 2, developer: 2, engineer: 2, representative: 2,
  senior: 3, 'sr.': 3, lead: 3, principal: 3, staff: 3,
  manager: 4, director: 4, head: 4, vp: 5, 'vice president': 5,
  svp: 6, evp: 6, c: 7, ceo: 7, cto: 7, cfo: 7, coo: 7, cro: 7, partner: 7, founder: 7,
};

function extractSeniorityFromTitle(title: string): number {
  const lower = title.toLowerCase();
  let rank = 2; // default = individual contributor
  for (const [kw, r] of Object.entries(SENIORITY_RANK)) {
    if (lower.includes(kw) && r > rank) rank = r;
  }
  return rank;
}

const TRANSITION_KEYWORDS: Record<string, string[]> = {
  military: ['military', 'army', 'navy', 'air force', 'marines', 'coast guard', 'nco', 'officer', 'sergeant', 'lieutenant', 'captain', 'colonel'],
  nonprofit: ['nonprofit', 'ngo', 'charity', 'foundation', 'volunteer', 'mission-driven'],
  academia: ['professor', 'phd candidate', 'postdoc', 'teaching assistant', 'research assistant', 'lecturer'],
  government: ['government', 'federal', 'state agency', 'municipality', 'civil service'],
};

export function analyzeCareerTrajectory(
  allTitles: string[],
  industry: string,
  resumeText: string,
): CareerTrajectory {
  if (allTitles.length === 0) {
    return {
      trajectory: 'unknown', promotionCount: 0,
      industryTransitionDetected: false, transitionConfidence: 'low',
      yearsAtCurrentLevel: null, progressionSummary: 'Unable to detect career trajectory from available data.',
    };
  }

  if (allTitles.length === 1) {
    return {
      trajectory: 'early_career', promotionCount: 0,
      industryTransitionDetected: false, transitionConfidence: 'low',
      yearsAtCurrentLevel: null, progressionSummary: 'Single role detected — early career or career starter.',
    };
  }

  // Seniority ranks in reverse-chron order (most recent first)
  const ranks = allTitles.map(extractSeniorityFromTitle);
  const mostRecent = ranks[0];
  const oldest = ranks[ranks.length - 1];

  // Count promotions (rank increases between adjacent roles)
  let promotionCount = 0;
  for (let i = 0; i < ranks.length - 1; i++) {
    if (ranks[i] > ranks[i + 1]) promotionCount++;
  }

  // Detect regressions (only meaningful if followed by recent recovery)
  const regressionCount = ranks.filter((r, i) => i > 0 && r < ranks[i - 1]).length;

  // Determine trajectory
  let trajectory: TrajectoryType;
  if (mostRecent > oldest + 1) trajectory = 'upward';
  else if (mostRecent < oldest) trajectory = 'regression';
  else if (promotionCount >= 2) trajectory = 'upward';
  else trajectory = 'lateral';

  // Industry transition detection
  const lowerText = resumeText.toLowerCase();
  let industryTransitionDetected = false;
  let fromIndustry: string | undefined;
  for (const [srcIndustry, kws] of Object.entries(TRANSITION_KEYWORDS)) {
    if (srcIndustry !== industry && kws.some(k => lowerText.includes(k))) {
      industryTransitionDetected = true;
      fromIndustry = srcIndustry;
      trajectory = 'transition';
      break;
    }
  }

  // Build human-readable summary
  const titleFlow = allTitles.slice(0, 4).reverse().join(' → ');
  const progressionSummary = (() => {
    if (trajectory === 'upward') return `Clear upward trajectory: ${titleFlow}. ${promotionCount} promotion${promotionCount !== 1 ? 's' : ''} detected.`;
    if (trajectory === 'transition') return `Career transition from ${fromIndustry || 'prior field'} to ${industry}. Recent titles: ${titleFlow}.`;
    if (trajectory === 'regression') return `Title regression detected (${titleFlow}). May be intentional (work-life balance, specialization) — avoid penalizing without context.`;
    if (trajectory === 'lateral') return `Lateral moves across companies: ${titleFlow}. Breadth-building pattern rather than title progression.`;
    return `Career path: ${titleFlow}.`;
  })();

  return {
    trajectory,
    promotionCount,
    industryTransitionDetected,
    fromIndustry,
    transitionConfidence: industryTransitionDetected ? 'high' : 'low',
    yearsAtCurrentLevel: null,
    progressionSummary,
  };
}

export function formatCareerTrajectoryForPrompt(traj: CareerTrajectory): string {
  const lines = ['\n\n<career_trajectory_analysis>'];
  lines.push(`Trajectory Type: ${traj.trajectory}`);
  lines.push(`Promotions Detected: ${traj.promotionCount}`);
  lines.push(`Summary: ${traj.progressionSummary}`);
  if (traj.industryTransitionDetected) {
    lines.push(`Industry Transition: FROM ${traj.fromIndustry} → current industry`);
    lines.push('INSTRUCTION: This candidate is a career transitioner. Do NOT penalize for missing "years in industry." Instead, focus quick wins on how to frame transferable skills and signal the transition clearly to recruiters. Bridge language (e.g., "leveraging X years in [previous field] to bring [value] to [current field]") is a key quick win.');
  } else if (traj.trajectory === 'upward') {
    lines.push('INSTRUCTION: Highlight the upward progression as a key strength. Quick wins should help ARTICULATE this progression more clearly — not change direction. Flag any resume sections that undersell the scope increase between roles.');
  } else if (traj.trajectory === 'lateral') {
    lines.push('INSTRUCTION: Lateral movers may not show title progression but often have broad skills. Help the candidate frame lateral moves as intentional breadth-building rather than stagnation. Suggest adding a brief "why I moved" context in bullets where relevant.');
  } else if (traj.trajectory === 'regression') {
    lines.push('INSTRUCTION: Title regression may be intentional (consulting back to IC, leadership to specialist). Do NOT assume it is negative. Flag it only if there is no clear explanation in the resume. If there is a clear explanation, treat it as neutral.');
  }
  lines.push('</career_trajectory_analysis>');
  return lines.join('\n');
}

// ─── 5. ATS SYSTEM DETECTION ─────────────────────────────────────────────────

export type AtsSystem = 'greenhouse' | 'lever' | 'workday' | 'taleo' | 'icims' | 'smartrecruiters' | 'ashby' | 'jobvite' | 'brassring' | 'successfactors' | 'unknown';

interface AtsSystemProfile {
  name: string;
  knownIssues: string[];
  recommendations: string[];
  parsingStrength: 'strong' | 'moderate' | 'weak';
}

const ATS_PROFILES: Record<AtsSystem, AtsSystemProfile> = {
  greenhouse: {
    name: 'Greenhouse',
    knownIssues: ['Struggles with two-column layouts', 'Tables sometimes parsed as single line'],
    recommendations: ['Single-column format strongly preferred', 'Standard section headings parse best', 'PDF and Word both supported well'],
    parsingStrength: 'strong',
  },
  lever: {
    name: 'Lever',
    knownIssues: ['Header/footer text sometimes dropped', 'Unusual fonts may not parse'],
    recommendations: ['Avoid header/footer for important contact info', 'Standard fonts only', 'LinkedIn URL in body, not header'],
    parsingStrength: 'strong',
  },
  workday: {
    name: 'Workday',
    knownIssues: ['Notoriously poor PDF parsing', 'Tables and text boxes are dropped', 'Two-column layouts frequently corrupted', 'Bullets sometimes become unparsed symbols'],
    recommendations: ['Use Word (.docx) format when possible', 'AVOID tables and text boxes entirely', 'Single-column, plain formatting mandatory', 'Standard bullet points (•) only'],
    parsingStrength: 'weak',
  },
  taleo: {
    name: 'Taleo (Oracle)',
    knownIssues: ['Very old system — poor PDF parsing', 'Graphics, logos, and icons stripped', 'Dates must be in standard MM/YYYY format', 'Skills keyword matching is literal (exact match only)'],
    recommendations: ['Plain text or Word format', 'Exact keyword matching critical — avoid synonyms', 'Remove all graphics, logos, shading', 'Use standard MM/YYYY date format throughout'],
    parsingStrength: 'weak',
  },
  icims: {
    name: 'iCIMS',
    knownIssues: ['Multi-column layouts may be concatenated incorrectly', 'Special characters in bullets sometimes garbled'],
    recommendations: ['Single-column preferred', 'Standard UTF-8 characters only', 'Avoid em-dashes — use standard hyphens'],
    parsingStrength: 'moderate',
  },
  smartrecruiters: {
    name: 'SmartRecruiters',
    knownIssues: ['Modern system with better parsing', 'Still prefers single-column'],
    recommendations: ['Modern formats generally supported', 'Single-column still safer', 'PDF fine'],
    parsingStrength: 'strong',
  },
  ashby: {
    name: 'Ashby',
    knownIssues: ['Newer system, generally good parsing'],
    recommendations: ['Most modern formats supported', 'PDF preferred', 'No special formatting concerns'],
    parsingStrength: 'strong',
  },
  jobvite: {
    name: 'Jobvite',
    knownIssues: ['Tables not reliably parsed', 'Some PDF rendering issues'],
    recommendations: ['Single-column preferred', 'Word format safer than PDF for complex layouts'],
    parsingStrength: 'moderate',
  },
  brassring: {
    name: 'BrassRing (IBM Kenexa)',
    knownIssues: ['Legacy system with minimal formatting support', 'Poor PDF handling', 'Graphics stripped', 'Column layouts broken'],
    recommendations: ['Plain text format ideal', 'Remove ALL formatting beyond basic bullets', 'No tables, no columns, no text boxes', 'Dates in MM/YYYY format'],
    parsingStrength: 'weak',
  },
  successfactors: {
    name: 'SAP SuccessFactors',
    knownIssues: ['Complex layouts often garbled', 'PDF parsing inconsistent', 'Header/footer text frequently lost'],
    recommendations: ['Simple single-column layout', 'Word format preferred over PDF', 'Avoid headers/footers for key information'],
    parsingStrength: 'moderate',
  },
  unknown: {
    name: 'Unknown ATS',
    knownIssues: [],
    recommendations: ['Use single-column layout for maximum compatibility', 'Submit in both PDF and Word if given the option', 'Avoid tables, text boxes, and headers/footers for key content'],
    parsingStrength: 'moderate',
  },
};

// Signals in job descriptions that indicate which ATS is being used
const ATS_DETECTION_SIGNALS: Array<{ system: AtsSystem; patterns: RegExp[] }> = [
  { system: 'greenhouse', patterns: [/greenhouse\.io/i, /boards\.greenhouse\.io/i, /gh\.io/i] },
  { system: 'lever', patterns: [/lever\.co/i, /jobs\.lever\.co/i] },
  { system: 'workday', patterns: [/workday\.com/i, /myworkdayjobs\.com/i, /wd\d+\.myworkday/i, /workdayjobs/i] },
  { system: 'taleo', patterns: [/taleo\.net/i, /oracle\.taleo/i, /tbe\.taleo/i] },
  { system: 'icims', patterns: [/icims\.com/i, /careers\.icims\.com/i, /recruiting\.icims/i] },
  { system: 'smartrecruiters', patterns: [/smartrecruiters\.com/i, /jobs\.smartrecruiters/i] },
  { system: 'ashby', patterns: [/ashbyhq\.com/i, /jobs\.ashbyhq\.com/i] },
  { system: 'jobvite', patterns: [/jobvite\.com/i, /hire\.jobvite\.com/i] },
  { system: 'brassring', patterns: [/brassring\.com/i, /kenexa\.com/i, /talent\.ibm\.com/i] },
  { system: 'successfactors', patterns: [/successfactors\.com/i, /jobs\.sap\.com/i, /career\.sap\./i, /sap\.taleo/i] },
];

// Company patterns that strongly indicate a specific ATS
const COMPANY_ATS_MAP: Array<{ pattern: RegExp; system: AtsSystem }> = [
  { pattern: /google|alphabet|youtube|deepmind|waymo/i, system: 'greenhouse' },
  { pattern: /stripe|linear|vercel|notion|figma|loom|mercury/i, system: 'lever' },
  { pattern: /salesforce|oracle|sap|general motors|ford|boeing|lockheed|deloitte|jpmorgan|bank of america|wells fargo|walmart/i, system: 'workday' },
  { pattern: /mckinsey|bain|bcg|accenture|ibm|att|verizon|fedex|ups/i, system: 'brassring' },
  { pattern: /amazon|aws/i, system: 'icims' },
  { pattern: /meta|facebook/i, system: 'greenhouse' },
  { pattern: /microsoft|linkedin/i, system: 'icims' },
];

export function detectAtsSystem(jobDescriptionText: string | null | undefined, companyName?: string): AtsSystem {
  if (!jobDescriptionText && !companyName) return 'unknown';

  const combined = `${jobDescriptionText || ''} ${companyName || ''}`;

  // URL-based detection (highest confidence)
  for (const { system, patterns } of ATS_DETECTION_SIGNALS) {
    if (patterns.some(p => p.test(combined))) return system;
  }

  // Company name inference (medium confidence)
  for (const { pattern, system } of COMPANY_ATS_MAP) {
    if (pattern.test(combined)) return system;
  }

  return 'unknown';
}

export function formatAtsSystemForPrompt(atsSystem: AtsSystem, resumeText: string): string {
  if (atsSystem === 'unknown') return '';
  const profile = ATS_PROFILES[atsSystem];

  const lines = ['\n\n<ats_system_context>'];
  lines.push(`Detected ATS: ${profile.name} (${profile.parsingStrength} parser)`);

  // Check if the resume has formatting issues that are known problems for this ATS
  const hasMultiColumn = /\t{3,}|  {6,}/.test(resumeText);
  const hasTables = /\|.*\|/.test(resumeText);
  const hasTextBox = /■|▪|◆|►/.test(resumeText);

  if (profile.parsingStrength === 'weak') {
    lines.push(`⚠️ WARNING: ${profile.name} is a weak parser. Formatting issues are high risk.`);
  }

  const activeIssues = profile.knownIssues.filter(issue => {
    if (issue.includes('two-column') && hasMultiColumn) return true;
    if (issue.includes('table') && hasTables) return true;
    if (issue.includes('text box') && hasTextBox) return true;
    return profile.parsingStrength === 'weak';
  });

  if (activeIssues.length > 0) {
    lines.push(`Known Issues with ${profile.name}: ${activeIssues.join('; ')}`);
  }
  lines.push(`Recommendations for ${profile.name}: ${profile.recommendations.join('; ')}`);
  lines.push(`INSTRUCTION: Include at least one ATS-specific formatting recommendation in your red flags or quick wins. Reference "${profile.name}" by name so the candidate understands this is specific to their target company's system.`);
  lines.push('</ats_system_context>');
  return lines.join('\n');
}

// ─── COMPETITIVE KEYWORD GAP ─────────────────────────────────────────────────

// Top-quartile keywords per industry + seniority tier.
// These appear in 70%+ of top-scoring resumes at each level.
const COMPETITIVE_KEYWORDS: Record<string, Record<string, string[]>> = {
  technology: {
    entry: ['github', 'git', 'api', 'agile', 'unit testing', 'pull request', 'sql', 'rest'],
    mid: ['system design', 'code review', 'ci/cd', 'microservices', 'distributed systems', 'monitoring', 'on-call', 'incident response'],
    senior: ['architecture', 'technical leadership', 'cross-functional', 'mentorship', 'staff', 'system design interview', 'platform', 'scalability', 'reliability', 'cost optimization'],
    executive: ['engineering strategy', 'org design', 'headcount', 'technical roadmap', 'exec communication', 'board', 'series', 'ipo'],
  },
  finance: {
    entry: ['excel', 'financial modeling', 'dcf', 'bloomberg', 'sql', 'powerpoint', 'pitch book'],
    mid: ['variance analysis', 'budget', 'forecast', 'p&l', 'business partnering', 'stakeholder', 'cfo'],
    senior: ['m&a', 'capital allocation', 'investor relations', 'board reporting', 'strategic finance', 'ebitda'],
    executive: ['capital markets', 'fundraising', 'ipo', 'series', 'audit committee', 'debt financing'],
  },
  sales: {
    entry: ['quota', 'pipeline', 'crm', 'outbound', 'discovery', 'demo', 'cold outreach'],
    mid: ['account executive', 'enterprise', 'closed won', 'arr', 'forecast', 'salesforce', 'meddic'],
    senior: ['territory', 'team management', 'revenue growth', 'strategic accounts', 'president club', 'vp'],
    executive: ['go-to-market', 'revenue strategy', 'board', 'series', 'sales enablement', 'chro'],
  },
  marketing: {
    entry: ['content', 'seo', 'social media', 'email marketing', 'google analytics', 'canva', 'copywriting'],
    mid: ['campaign management', 'roi', 'cac', 'ltv', 'a/b testing', 'demand generation', 'attribution'],
    senior: ['marketing strategy', 'brand', 'budget ownership', 'cross-functional', 'board reporting', 'cmo'],
    executive: ['gtm strategy', 'revenue marketing', 'series', 'ipo marketing', 'investor relations'],
  },
  consulting: {
    entry: ['analysis', 'powerpoint', 'excel', 'client deliverable', 'research', 'hypothesis'],
    mid: ['engagement management', 'client relationship', 'issue tree', 'workshop facilitation', 'recommendations'],
    senior: ['business development', 'proposal', 'practice leadership', 'thought leadership', 'p&l'],
    executive: ['managing director', 'partner', 'equity', 'firm-wide', 'sector lead'],
  },
  product_management: {
    entry: ['roadmap', 'user stories', 'agile', 'sprint', 'stakeholder', 'figma', 'analytics'],
    mid: ['okr', 'a/b testing', 'user research', 'go-to-market', 'product strategy', 'cross-functional'],
    senior: ['product vision', 'team leadership', 'executive alignment', 'revenue impact', 'platform'],
    executive: ['product org', 'cpo', 'board', 'series', 'p&l ownership', 'build vs buy'],
  },
  healthcare: {
    entry: ['patient care', 'emr', 'hipaa', 'clinical documentation', 'vital signs', 'care coordination'],
    mid: ['quality improvement', 'clinical outcomes', 'interdisciplinary', 'care management', 'compliance'],
    senior: ['department management', 'budget', 'clinical leadership', 'accreditation', 'jcaho', 'cms'],
    executive: ['hospital administration', 'strategy', 'board', 'population health', 'value-based care'],
  },
};

export interface CompetitiveGapResult {
  missingHighFrequency: string[];   // Keywords present in 70%+ of top resumes but absent from this one
  presentHighFrequency: string[];   // Keywords present in both top resumes and this resume (strengths)
  gapScore: number;                 // 0-100, lower = more gaps
}

export function analyzeCompetitiveKeywordGap(
  resumeText: string,
  industry: string,
  seniorityLevel: string,
): CompetitiveGapResult {
  const lower = resumeText.toLowerCase();
  const level = ['entry', 'mid', 'senior', 'executive'].includes(seniorityLevel) ? seniorityLevel : 'mid';
  const industryKws = COMPETITIVE_KEYWORDS[industry]?.[level] || COMPETITIVE_KEYWORDS['technology'][level];

  const present = industryKws.filter(kw => lower.includes(kw.toLowerCase()));
  const missing = industryKws.filter(kw => !lower.includes(kw.toLowerCase()));

  const gapScore = industryKws.length > 0
    ? Math.round((present.length / industryKws.length) * 100)
    : 50;

  return {
    missingHighFrequency: missing.slice(0, 6),
    presentHighFrequency: present.slice(0, 5),
    gapScore,
  };
}

export function formatCompetitiveGapForPrompt(gap: CompetitiveGapResult, industry: string, level: string): string {
  if (gap.missingHighFrequency.length === 0 && gap.presentHighFrequency.length === 0) return '';
  const lines = ['\n\n<competitive_keyword_analysis>'];
  lines.push(`Competitive Keyword Coverage: ${gap.gapScore}% of high-frequency ${industry} ${level} resume keywords present`);
  if (gap.presentHighFrequency.length > 0) {
    lines.push(`Present (competitive strengths): ${gap.presentHighFrequency.join(', ')}`);
  }
  if (gap.missingHighFrequency.length > 0) {
    lines.push(`Missing (appear in 70%+ of top-quartile ${industry} ${level} resumes): ${gap.missingHighFrequency.join(', ')}`);
    lines.push('INSTRUCTION: These are high-frequency competitive keywords. If genuinely absent and applicable, prioritize them in keyword gaps and quick wins. If present implicitly (demonstrated through experience), flag them as "add the explicit keyword for ATS" rather than as a hard gap. Do NOT add keywords the candidate doesn\'t genuinely have.');
  }
  lines.push('</competitive_keyword_analysis>');
  return lines.join('\n');
}

// ─── 6. RESUME TIMELINE EXTRACTION ──────────────────────────────────────────

export interface TimelineEntry {
  title: string;
  company?: string;
  startYear: number;
  endYear: number | null; // null = present
  durationMonths: number;
}

export interface TimelineResult {
  entries: TimelineEntry[];
  totalExperienceMonths: number;
  gapPeriods: Array<{ afterTitle: string; monthsGap: number }>;
  longestTenureMonths: number;
  averageTenureMonths: number;
  hasSignificantGap: boolean; // gap > 6 months
  hasShortTenures: boolean;   // any role < 12 months
  formattedSummary: string;
}

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

function parseYearMonth(raw: string): { year: number; month: number } {
  const lower = raw.toLowerCase().trim();
  // "Jan 2020" / "January 2020"
  for (const [name, m] of Object.entries(MONTH_MAP)) {
    const re = new RegExp(`${name}[a-z]*[\\s,/]+([12]\\d{3})`);
    const match = lower.match(re);
    if (match) return { year: parseInt(match[1]), month: m };
  }
  // "2020/01" or "01/2020"
  const slash1 = lower.match(/(\d{1,2})[\/\-]([12]\d{3})/);
  if (slash1) return { year: parseInt(slash1[2]), month: parseInt(slash1[1]) };
  // Bare year
  const bareYear = lower.match(/([12]\d{3})/);
  if (bareYear) return { year: parseInt(bareYear[1]), month: 6 }; // mid-year estimate
  return { year: 2020, month: 1 };
}

/**
 * Extract employment timeline from resume text — parses date ranges like
 * "Jan 2020 – Mar 2022", "2019 - Present", "03/2021 to 08/2023".
 */
export function extractTimeline(resumeText: string): TimelineResult {
  const lines = resumeText.split('\n').map(l => l.trim()).filter(Boolean);
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;

  // Regex to catch date ranges on a line
  const RANGE_RE = /([A-Za-z]+[\s,\/]*[12]\d{3}|[12]\d{3})\s*[–—\-–to]+\s*([A-Za-z]+[\s,\/]*[12]\d{3}|present|current|now)/i;
  const YEAR_ONLY_RANGE = /([12]\d{3})\s*[–—\-–]+\s*([12]\d{3}|present|current|now)/i;

  const entries: TimelineEntry[] = [];
  let currentTitle = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTitleLine = /\b(manager|director|engineer|developer|analyst|specialist|consultant|executive|lead|vp|president|associate|senior|principal|architect|designer|coordinator|administrator|officer|nurse|teacher|attorney|accountant|researcher|scientist|founder|ceo|cfo|cto|intern|head of|staff)\b/i.test(line) && line.length < 120;
    if (isTitleLine) currentTitle = line;

    const m = line.match(RANGE_RE) || line.match(YEAR_ONLY_RANGE);
    if (!m) continue;

    const start = parseYearMonth(m[1]);
    const endRaw = m[2].toLowerCase().trim();
    let endYear: number | null;
    let endMonth: number;

    if (/present|current|now/.test(endRaw)) {
      endYear = null;
      endMonth = nowMonth;
    } else {
      const parsed = parseYearMonth(m[2]);
      endYear = parsed.year;
      endMonth = parsed.month;
    }

    const actualEndYear = endYear ?? nowYear;
    const actualEndMonth = endMonth;
    const durationMonths = Math.max(1,
      (actualEndYear - start.year) * 12 + (actualEndMonth - start.month)
    );

    entries.push({
      title: currentTitle || 'Role',
      startYear: start.year,
      endYear,
      durationMonths,
    });
  }

  // Sort chronologically (oldest first for gap detection)
  entries.sort((a, b) => a.startYear - b.startYear);

  // Detect gaps between consecutive roles
  const gapPeriods: Array<{ afterTitle: string; monthsGap: number }> = [];
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    const prevEndYear = prev.endYear ?? nowYear;
    const prevEndMonth = 6;
    const currStartMonths = curr.startYear * 12 + 1;
    const prevEndMonths = prevEndYear * 12 + prevEndMonth;
    const gap = currStartMonths - prevEndMonths;
    if (gap > 2) {
      gapPeriods.push({ afterTitle: prev.title, monthsGap: gap });
    }
  }

  const totalExperienceMonths = entries.reduce((sum, e) => sum + e.durationMonths, 0);
  const longestTenureMonths = entries.length > 0 ? Math.max(...entries.map(e => e.durationMonths)) : 0;
  const averageTenureMonths = entries.length > 0 ? Math.round(totalExperienceMonths / entries.length) : 0;
  const hasSignificantGap = gapPeriods.some(g => g.monthsGap > 6);
  const hasShortTenures = entries.some(e => e.durationMonths < 12);

  let formattedSummary = '';
  if (entries.length === 0) {
    formattedSummary = 'No date ranges detected in resume — AI should not assume tenure.';
  } else {
    const yearsTotal = (totalExperienceMonths / 12).toFixed(1);
    const avgYears = (averageTenureMonths / 12).toFixed(1);
    const parts = [`${entries.length} role(s) detected, ~${yearsTotal} years total experience`];
    if (averageTenureMonths > 0) parts.push(`avg tenure ${avgYears} years`);
    if (hasSignificantGap) parts.push(`⚠️ employment gap(s) detected: ${gapPeriods.filter(g => g.monthsGap > 6).map(g => `~${Math.round(g.monthsGap)} months after "${g.afterTitle}"`).join(', ')}`);
    if (hasShortTenures) parts.push('⚠️ one or more roles < 12 months (job-hopping signal)');
    formattedSummary = parts.join(' | ');
  }

  return { entries, totalExperienceMonths, gapPeriods, longestTenureMonths, averageTenureMonths, hasSignificantGap, hasShortTenures, formattedSummary };
}

export function formatTimelineForPrompt(timeline: TimelineResult): string {
  if (timeline.entries.length === 0) return '';
  const lines = ['\n<timeline_context>'];
  lines.push(`  <summary>${timeline.formattedSummary}</summary>`);
  if (timeline.hasSignificantGap) {
    lines.push(`  <gaps>Employment gaps detected. Flag in redFlags if > 6 months unexplained. Advise candidate to address with a consulting/freelance/upskilling entry or brief explanation in summary.</gaps>`);
  }
  if (timeline.hasShortTenures) {
    lines.push(`  <short_tenures>One or more roles < 12 months. Flag as potential recruiter concern. Advise candidate to add context (contract role, startup folded, layoff) to prevent ATS filtering.</short_tenures>`);
  }
  lines.push(`  <roles_parsed>${timeline.entries.map(e => `${e.title} (${e.startYear}–${e.endYear ?? 'present'}, ${Math.round(e.durationMonths / 12 * 10) / 10}yr)`).join(' → ')}</roles_parsed>`);
  lines.push('</timeline_context>');
  return lines.join('\n');
}

// ─── 7. KEYWORD FREQUENCY WEIGHTS (gap prioritization) ───────────────────────

// Relative frequency in job postings per industry × seniority tier.
// Scale: 3 = appears in 80%+ of postings, 2 = 50-79%, 1 = 20-49%.
// Used to sort missing keywords so the highest-impact gaps appear first.

export const KEYWORD_FREQUENCY: Record<string, Record<string, number>> = {
  technology: {
    'python': 3, 'javascript': 3, 'typescript': 3, 'react': 3, 'node.js': 3,
    'aws': 3, 'docker': 3, 'kubernetes': 3, 'sql': 3, 'git': 3,
    'rest api': 3, 'ci/cd': 3, 'microservices': 2, 'terraform': 2,
    'graphql': 2, 'redis': 2, 'postgresql': 2, 'mongodb': 2,
    'agile': 2, 'scrum': 2, 'system design': 2, 'code review': 2,
    'unit testing': 2, 'java': 2, 'go': 2, 'rust': 1, 'kafka': 1,
  },
  finance: {
    'financial modeling': 3, 'excel': 3, 'valuation': 3, 'dcf': 3,
    'bloomberg': 2, 'python': 2, 'sql': 2, 'powerpoint': 2,
    'financial analysis': 3, 'budgeting': 2, 'forecasting': 2,
    'variance analysis': 2, 'p&l': 2, 'balance sheet': 2,
    'cash flow': 2, 'ifrs': 1, 'gaap': 2, 'cfa': 1, 'series 7': 1,
    'risk management': 2, 'due diligence': 2, 'm&a': 2,
  },
  data_science: {
    'python': 3, 'machine learning': 3, 'sql': 3, 'pandas': 3, 'numpy': 2,
    'scikit-learn': 2, 'tensorflow': 2, 'pytorch': 2, 'statistics': 3,
    'a/b testing': 2, 'data visualization': 2, 'tableau': 2, 'r': 2,
    'spark': 2, 'hypothesis testing': 2, 'regression': 2, 'nlp': 2,
    'feature engineering': 2, 'model deployment': 1, 'mlflow': 1,
  },
  marketing: {
    'google analytics': 3, 'seo': 3, 'paid media': 2, 'content strategy': 2,
    'social media': 3, 'email marketing': 3, 'hubspot': 2, 'salesforce': 2,
    'campaign management': 2, 'a/b testing': 2, 'conversion rate': 2,
    'roi': 3, 'brand management': 2, 'copywriting': 2, 'data analysis': 2,
    'growth hacking': 1, 'seo/sem': 2, 'facebook ads': 2, 'google ads': 2,
  },
  sales: {
    'salesforce': 3, 'crm': 3, 'pipeline management': 3, 'quota': 3,
    'account executive': 2, 'cold outreach': 2, 'prospecting': 2,
    'revenue': 3, 'forecast': 2, 'b2b': 2, 'saas': 2, 'closing': 2,
    'negotiation': 2, 'discovery': 2, 'outreach': 2, 'objection handling': 2,
    'meddic': 1, 'meddpicc': 1, 'challenger': 1, 'spin selling': 1,
  },
  consulting: {
    'project management': 3, 'stakeholder management': 3, 'powerpoint': 3,
    'excel': 3, 'strategy': 3, 'process improvement': 2, 'change management': 2,
    'workshop facilitation': 2, 'business analysis': 3, 'requirements gathering': 2,
    'agile': 2, 'deliverables': 2, 'client management': 3, 'cost reduction': 2,
    'kpi': 2, 'benchmarking': 2, 'roi analysis': 2,
  },
  healthcare: {
    'patient care': 3, 'ehr': 3, 'epic': 2, 'clinical documentation': 2,
    'hipaa': 3, 'bls': 2, 'acls': 2, 'icd-10': 2, 'medication administration': 2,
    'care coordination': 2, 'interdisciplinary': 2, 'quality improvement': 2,
    'evidence-based practice': 2, 'patient safety': 2, 'triage': 2,
  },
  product_management: {
    'product roadmap': 3, 'user stories': 3, 'agile': 3, 'scrum': 3,
    'stakeholder management': 3, 'kpi': 3, 'a/b testing': 2, 'data analysis': 2,
    'go-to-market': 2, 'product strategy': 3, 'prioritization': 2,
    'discovery': 2, 'jira': 2, 'confluence': 2, 'figma': 2, 'sql': 2,
    'okrs': 2, 'metrics': 2, 'mvp': 2, 'product-led growth': 1,
  },
};

/**
 * Return a frequency weight (3/2/1/0) for a keyword in the given industry.
 * Also checks bigram/trigram partial matches.
 */
export function getKeywordFrequencyWeight(keyword: string, industry: string): number {
  const table = KEYWORD_FREQUENCY[industry];
  if (!table) return 1;
  const norm = keyword.toLowerCase().trim();
  // Exact match
  if (table[norm] !== undefined) return table[norm];
  // Partial: keyword contains a high-freq term or vice versa
  for (const [kw, freq] of Object.entries(table)) {
    if (norm.includes(kw) || kw.includes(norm)) return freq;
  }
  return 1;
}

/**
 * Sort missing keywords by frequency weight descending, then alphabetically.
 */
export function prioritizeKeywordGaps(
  missingKeywords: string[],
  industry: string
): Array<{ keyword: string; weight: number }> {
  return missingKeywords
    .map(kw => ({ keyword: kw, weight: getKeywordFrequencyWeight(kw, industry) }))
    .sort((a, b) => b.weight - a.weight || a.keyword.localeCompare(b.keyword));
}

// ─── 8. PHRASE-LEVEL KEYWORD MATCHING ────────────────────────────────────────

/**
 * Bigram and trigram phrases commonly found in job descriptions.
 * These are frequently split by naive word-by-word matching, causing false "missing" results.
 */
const PHRASE_PATTERNS: Record<string, RegExp[]> = {
  technology: [
    /\bmachine\s+learning\b/i, /\bdeep\s+learning\b/i, /\bci[\s\/]cd\b/i,
    /\brest(?:ful)?\s+api\b/i, /\bsystem\s+design\b/i, /\bcode\s+review\b/i,
    /\btest[\s\-]driven\b/i, /\bfull[\s\-]?stack\b/i, /\bfront[\s\-]?end\b/i,
    /\bback[\s\-]?end\b/i, /\bdata\s+structures\b/i, /\bobject[\s\-]oriented\b/i,
    /\bversion\s+control\b/i, /\bagile\s+methodology\b/i,
  ],
  finance: [
    /\bfinancial\s+model(?:ing)?\b/i, /\bdiscounted\s+cash\s+flow\b/i,
    /\bprofit\s+(?:and\s+)?loss\b/i, /\bp\s*[&+]\s*l\b/i,
    /\bcash\s+flow\b/i, /\bdue\s+diligence\b/i, /\brisk\s+management\b/i,
    /\bbalance\s+sheet\b/i, /\bworking\s+capital\b/i, /\bm\s*[&+]\s*a\b/i,
  ],
  data_science: [
    /\ba[\s\/]b\s+test(?:ing)?\b/i, /\bfeature\s+engineer(?:ing)?\b/i,
    /\bneural\s+network\b/i, /\bnatural\s+language\s+processing\b/i,
    /\bcomputer\s+vision\b/i, /\bhypothesis\s+test(?:ing)?\b/i,
    /\bmodel\s+deploy(?:ment)?\b/i, /\btime\s+series\b/i,
  ],
  marketing: [
    /\bsearch\s+engine\s+optim(?:ization)?\b/i, /\bcontent\s+market(?:ing)?\b/i,
    /\bsocial\s+media\s+market(?:ing)?\b/i, /\bemail\s+market(?:ing)?\b/i,
    /\bpaid\s+(?:search|media|social)\b/i, /\bconversion\s+rate\s+optim(?:ization)?\b/i,
    /\bcustomer\s+acqui(?:sition|red)\b/i, /\bbrand\s+awareness\b/i,
  ],
  sales: [
    /\bpipeline\s+management\b/i, /\baccount\s+(?:executive|management)\b/i,
    /\bbusiness\s+development\b/i, /\bcold\s+(?:call(?:ing)?|outreach)\b/i,
    /\bquota\s+(?:attainment|achievement)\b/i, /\bstakeholder\s+(?:management|engagement)\b/i,
    /\bsales\s+cycle\b/i, /\bchurn\s+(?:rate|reduction)\b/i,
  ],
  consulting: [
    /\bproject\s+management\b/i, /\bchange\s+management\b/i,
    /\bprocess\s+improvement\b/i, /\bstakeholder\s+management\b/i,
    /\bbusiness\s+analysis\b/i, /\brequirements\s+gather(?:ing)?\b/i,
    /\bcost\s+reduc(?:tion|ing)\b/i, /\bworkshop\s+facilitat(?:ion|ing)\b/i,
  ],
  product_management: [
    /\bproduct\s+roadmap\b/i, /\bgo[\s\-]to[\s\-]market\b/i,
    /\buser\s+stor(?:y|ies)\b/i, /\bproduct[\s\-]led\s+growth\b/i,
    /\ba[\s\/]b\s+test(?:ing)?\b/i, /\bstakeholder\s+management\b/i,
    /\bproduct\s+strateg(?:y|ies)\b/i, /\bocr?\s+framework\b/i,
  ],
};

/**
 * Check whether a multi-word phrase appears in resume text using phrase-aware matching.
 * Handles hyphenation, spacing variants, and abbreviations better than simple includes().
 */
export function phraseMatchesResume(phrase: string, resumeText: string): boolean {
  const lower = resumeText.toLowerCase();
  const norm = phrase.toLowerCase().trim();

  // 1. Direct substring (fast path)
  if (lower.includes(norm)) return true;

  // 2. No-space variant ("fullstack", "cicd")
  if (lower.includes(norm.replace(/[\s\-\/]+/g, ''))) return true;

  // 3. Hyphen ↔ space swap
  if (lower.includes(norm.replace(/\s+/g, '-'))) return true;
  if (lower.includes(norm.replace(/-/g, ' '))) return true;

  // 4. Abbreviation expansion — "ml" ↔ "machine learning"
  const abbrevMap: Record<string, string> = {
    'ml': 'machine learning', 'dl': 'deep learning', 'nlp': 'natural language processing',
    'cv': 'computer vision', 'ux': 'user experience', 'ui': 'user interface',
    'p&l': 'profit and loss', 'pl': 'profit and loss', 'm&a': 'mergers and acquisitions',
    'dcf': 'discounted cash flow', 'roi': 'return on investment', 'kpi': 'key performance indicator',
    'seo': 'search engine optimization', 'sem': 'search engine marketing',
    'crm': 'customer relationship management', 'ehr': 'electronic health records',
    'ci/cd': 'continuous integration', 'oop': 'object oriented programming',
  };
  if (abbrevMap[norm] && lower.includes(abbrevMap[norm])) return true;
  // Check if phrase matches an abbreviation in the resume
  for (const [abbrev, expanded] of Object.entries(abbrevMap)) {
    if (norm === expanded && lower.includes(abbrev)) return true;
  }

  return false;
}

/**
 * Check all pre-defined phrase patterns for an industry — returns matched phrases.
 * Used to supplement single-word keyword matching with compound phrases.
 */
export function findPhraseMatches(resumeText: string, industry: string): string[] {
  const patterns = PHRASE_PATTERNS[industry] || [];
  return patterns
    .filter(p => p.test(resumeText))
    .map(p => p.source.replace(/\\b|\\s\+|\?|\(.*?\)|\\|\/i/g, ' ').trim().substring(0, 40));
}
