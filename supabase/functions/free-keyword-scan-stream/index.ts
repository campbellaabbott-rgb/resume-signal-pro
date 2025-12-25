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
 */
function detectIndustryFromResume(resumeText: string): string | null {
  const text = resumeText.toLowerCase();
  
  // Tech job title patterns - these are definitive
  const techTitlePatterns = [
    /\b(software\s+engineer|senior\s+software\s+engineer|staff\s+engineer)\b/,
    /\b(developer|frontend\s+developer|backend\s+developer|full[\s-]?stack\s+developer)\b/,
    /\b(data\s+scientist|machine\s+learning\s+engineer|ml\s+engineer)\b/,
    /\b(devops\s+engineer|sre|site\s+reliability\s+engineer|platform\s+engineer)\b/,
    /\b(cloud\s+engineer|infrastructure\s+engineer|systems\s+engineer)\b/,
    /\b(qa\s+engineer|test\s+engineer|automation\s+engineer)\b/,
    /\b(tech\s+lead|engineering\s+manager|vp\s+of\s+engineering|cto)\b/,
    /\b(programmer|coder|software\s+architect)\b/,
  ];
  
  // Check for definitive tech titles
  for (const pattern of techTitlePatterns) {
    if (pattern.test(text)) {
      console.log(`[INDUSTRY-DETECT] Matched tech title pattern: ${pattern}`);
      return 'technology';
    }
  }
  
  // Tech skills that strongly indicate technology field (must have multiple)
  const techSkills = [
    'javascript', 'typescript', 'python', 'react', 'node.js', 'nodejs',
    'aws', 'docker', 'kubernetes', 'git', 'github', 'postgresql', 'mongodb',
    'java', 'c++', 'golang', 'rust', 'sql', 'graphql', 'rest api', 'microservices',
    'ci/cd', 'agile', 'scrum', 'jira', 'jenkins', 'terraform'
  ];
  
  const foundTechSkills = techSkills.filter(skill => text.includes(skill));
  if (foundTechSkills.length >= 4) {
    console.log(`[INDUSTRY-DETECT] Found ${foundTechSkills.length} tech skills: ${foundTechSkills.join(', ')}`);
    return 'technology';
  }
  
  // Sales job title patterns - only if NOT tech
  const salesTitlePatterns = [
    /\b(account\s+executive|sales\s+rep|sales\s+manager)\b/,
    /\b(business\s+development\s+representative|bdr|sdr)\b/,
    /\b(sales\s+director|vp\s+of\s+sales|chief\s+revenue\s+officer)\b/,
  ];
  
  // Only return sales if no tech indicators found
  if (foundTechSkills.length < 2) {
    for (const pattern of salesTitlePatterns) {
      if (pattern.test(text)) {
        console.log(`[INDUSTRY-DETECT] Matched sales title pattern: ${pattern}`);
        return 'sales';
      }
    }
  }
  
  // Return null to let AI detection stand
  return null;
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
  { stage: 'detecting', message: 'Detecting industry & experience...', progress: 20 },
  { stage: 'analyzing', message: 'Running AI analysis...', progress: 40 },
  { stage: 'scoring', message: 'Calculating ATS score...', progress: 70 },
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
      const { resumeText, jobDescriptionText, honeypot } = await req.json();

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

      // Check if job description provided
      const hasJobDescription = jobDescriptionText && typeof jobDescriptionText === 'string' && jobDescriptionText.trim().length > 50;
      const truncatedJobDescription = hasJobDescription ? jobDescriptionText.substring(0, MAX_JOB_DESCRIPTION_LENGTH) : null;

      // ======================== Robust AI Response Caching ========================
      // Normalize text for consistent cache hits (whitespace, case-insensitive first line)
      const normalizeForCache = (text: string): string => {
        return text
          .replace(/\s+/g, ' ')           // Collapse all whitespace to single space
          .replace(/\n+/g, '\n')          // Collapse multiple newlines
          .trim()                          // Remove leading/trailing whitespace
          .toLowerCase()                   // Case insensitive matching
          .substring(0, 5000);             // Use first 5000 chars
      };
      
      const normalizedResume = normalizeForCache(resumeText);
      const normalizedJob = truncatedJobDescription ? normalizeForCache(truncatedJobDescription).substring(0, 2000) : '';
      
      // Create cache key from normalized content hash
      const cacheInput = `${normalizedResume}|${normalizedJob}`;
      const cacheKey = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cacheInput))
        .then(hash => Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join(''))
        .then(hex => hex.substring(0, 32)); // Use first 32 chars of hash
      
      const CACHE_FUNCTION_NAME = 'free-keyword-scan-stream';
      const CACHE_TTL_HOURS = 2; // Cache for 2 hours
      
      // Check cache first
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
      
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Cache MISS for key ${cacheKey.substring(0, 8)}...`);

      send('progress', PROGRESS_STAGES[2]);

      // Get API key
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        send('error', { error: 'Service temporarily unavailable.' });
        close();
        return;
      }

      // Build prompts with multilingual support and accuracy improvements
      const systemPrompt = `Expert ATS resume analyst. Respond in resume's language. All fields in that language.

CORE RULES:
1. EXPERIENCE YEARS: Find EARLIEST job date → calculate to 2025. ALL roles count (consulting, sales, freelance). Example: 2015→present = 10 years.
2. INDUSTRY DETECTION: Read job titles first. Code/software/engineer/developer/data = "technology". Sales/account exec/BDR = "sales" (only if NOT tech). Valid: technology, healthcare, finance, legal, sales, marketing, education, engineering, creative, hr, consulting, retail, hospitality, manufacturing, government, general
3. IMPLICIT SKILLS: Check if skill is demonstrated implicitly before flagging as missing. Salesforce + MEDDPICC implies CRM expertise.
4. SENIORITY-ADJUSTED: Senior roles = less penalty for assumed skills. Entry-level = focus on potential.
5. PERSONALIZATION: Use candidate's NAME. Reference SPECIFIC achievements. Warm, encouraging tone.

ACCURACY:
- Scores = screening readiness, NOT success predictions
- Use "low/moderate/high risk" not "bottom 50%" or "will be filtered"
- Every flag must explain WHY recruiters care
- Label as "ATS note" vs "Recruiter note"

BEFORE ANALYSIS: Extract name → find earliest job date → calculate total years → assess seniority → extract titles → check education/certs → scan skills → determine industry.

OUTPUT: ATS score (0-100), industry, format grade (A-D), experience level, keywords, red flags. Address candidate by name.`;

      const userPrompt = hasJobDescription 
        ? `Analyze this resume for the target job:\n\n<resume>\n${resumeText.substring(0, 15000)}\n</resume>\n\n<job_description>\n${truncatedJobDescription}\n</job_description>`
        : `Analyze this resume:\n\n<resume>\n${resumeText.substring(0, 15000)}\n</resume>`;

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
      const serverDetectedIndustry = detectIndustryFromResume(resumeText);
      
      if (serverDetectedIndustry && serverDetectedIndustry !== normalizeIndustry(rawIndustry)) {
        console.log(`[FREE-KEYWORD-SCAN-STREAM] Server override: AI said "${rawIndustry}" but text clearly indicates "${serverDetectedIndustry}"`);
        analysis.industry = serverDetectedIndustry;
      } else {
        analysis.industry = normalizeIndustry(rawIndustry);
        if (rawIndustry !== analysis.industry) {
          console.log(`[FREE-KEYWORD-SCAN-STREAM] Industry normalized: "${rawIndustry}" -> "${analysis.industry}"`);
        }
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

      // 4. Industry Benchmark
      const computedBenchmark = computeIndustryBenchmark(analysis.atsScoreEstimate || 0, analysis.industry);
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Computed benchmark: ${JSON.stringify(computedBenchmark)}`);

      // Build response with computed fields merged
      const responseData = {
        success: true,
        ...analysis,
        // Override/add computed fields
        timelineAnalysis: computedTimeline,
        quantificationScore: computedQuantification,
        bulletImpactScore: computedBulletImpact,
        industryBenchmark: computedBenchmark,
        // Trim arrays and filter false-positive red flags
        redFlags: (analysis.redFlags || []).filter((flag: { issue?: string }) => {
          // Only flag "missing contact info" if 2+ elements are actually missing
          const issue = (flag.issue || '').toLowerCase();
          if (issue.includes('contact') || issue.includes('email') || issue.includes('phone')) {
            // Check resume for contact elements
            const hasEmail = /@[\w\.-]+\.\w+/.test(resumeText);
            const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(resumeText);
            const hasLinkedIn = /linkedin\.com|linkedin/i.test(resumeText);
            const hasLocation = /\b(city|state|[A-Z][a-z]+,\s*[A-Z]{2}|\d{5})\b/i.test(resumeText);
            const contactCount = [hasEmail, hasPhone, hasLinkedIn, hasLocation].filter(Boolean).length;
            // Only show as red flag if 2+ are missing (i.e., only 0-1 present)
            return contactCount <= 1;
          }
          return true;
        }).slice(0, 3),
        keywords: (analysis.keywords || []).slice(0, 6),
        quickWins: (analysis.quickWins || []).slice(0, 3),
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
                    <li><strong>ATS Score:</strong> ${atsScore}/100</li>
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
          hasJobDescription: !!truncatedJobDescription
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
      console.log(`[FREE-KEYWORD-SCAN-STREAM] Complete in ${duration}ms, ATS: ${analysis.atsScoreEstimate}`);

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
