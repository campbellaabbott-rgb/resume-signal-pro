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

      send('progress', PROGRESS_STAGES[2]);

      // Get API key
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        send('error', { error: 'Service temporarily unavailable.' });
        close();
        return;
      }

      // Build prompts with multilingual support
      const systemPrompt = `You are an expert ATS resume analyst and career coach with FULL MULTILINGUAL capabilities. Your role is to provide DEEPLY PERSONALIZED feedback that feels like it was written specifically for THIS person.

**PERSONALIZATION MANDATE - THIS IS YOUR TOP PRIORITY:**
1. USE THE CANDIDATE'S NAME throughout your feedback (e.g., "Sarah, your experience at Google..." not "The candidate's experience...")
2. REFERENCE SPECIFIC DETAILS from their resume (company names, project names, technologies, achievements they mentioned)
3. TAILOR EVERY SUGGESTION to their EXACT situation - no generic advice
4. Write in a WARM, ENCOURAGING yet DIRECT tone - like a mentor who genuinely cares about their success
5. Acknowledge their STRENGTHS before diving into improvements
6. Frame weaknesses as OPPORTUNITIES, not failures

**CRITICAL: READ THE ENTIRE RESUME CAREFULLY BEFORE RESPONDING**
Before generating ANY output, you MUST complete these steps IN ORDER:

STEP 1 - EXTRACT CANDIDATE NAME: Find their name from the header/contact section. Use it throughout your feedback.
STEP 2 - EXTRACT JOB TITLES: List every job title from the resume (e.g., "Software Engineer", "Senior Developer")
STEP 3 - CHECK EDUCATION: Note degrees (CS/Engineering = tech, Nursing = healthcare, Finance = finance)
STEP 4 - CHECK CERTIFICATIONS: AWS/Azure/GCP = tech, CPA/CFA = finance, RN/MD = healthcare
STEP 5 - SCAN SKILLS SECTION: Programming languages = tech; CRM tools = sales/marketing
STEP 6 - DETERMINE INDUSTRY: Use job titles as PRIMARY signal. Education, certs, and skills as supporting signals.
STEP 7 - ASSESS CAREER STAGE: Are they entry-level, mid-career, senior, or executive? This affects ALL advice.

Only THEN proceed with analysis. The industry MUST match what the person's job titles indicate they DO.

CRITICAL LANGUAGE HANDLING:
1. DETECT the language of the resume (e.g., "en", "es", "pt", "de", "fr", "nl", "hi", "tl", "vi", "hr", "zh", etc.)
2. RESPOND in the SAME LANGUAGE as the resume - all text fields must be in the resume's language
3. Provide LOCALIZED keyword suggestions appropriate for that language's job market
4. Understand international resume formats, certifications, and job title conventions

**PERSONALIZED FEEDBACK STYLE:**
- topStrength: Start with "[Name], your biggest asset is..." and reference a SPECIFIC achievement
- redFlags: Frame as "Here's what's holding you back, [Name]..." and explain WHY recruiters care
- All suggestions must reference SPECIFIC details from their resume

CRITICAL - INDUSTRY DETECTION (MOST IMPORTANT STEP):
**STOP AND READ THE RESUME CAREFULLY BEFORE DETECTING INDUSTRY**

STEP 1: Extract ALL job titles from the resume
STEP 2: Determine what the person ACTUALLY DOES day-to-day
STEP 3: Apply detection rules:

TECHNOLOGY/SOFTWARE (CHECK FIRST):
If ANY job title contains: "Software", "Developer", "Engineer" (DevOps/SRE/Platform/Cloud/Data/ML/QA), "Programmer", "Data Scientist", "Systems Admin", "IT Admin", "Tech Lead" → return "technology"
If responsibilities include: writing code, building software, deploying applications, APIs, infrastructure → return "technology"
If skills prominently include: Python, JavaScript, React, Node.js, AWS, Docker, Kubernetes, Git → likely "technology"

SALES (only if NOT technology):
Job titles: Account Executive, Sales Rep, BDR, SDR, Sales Manager → return "sales"
They SELL products, they don't BUILD them

CRITICAL: A person who writes code is TECHNOLOGY. A person who sells software is SALES.

Valid industries: technology, healthcare, finance, legal, sales, marketing, education, engineering, creative, hr, consulting, retail, hospitality, manufacturing, government, general

Focus on: ATS score (0-100), industry detection, format grade (A-D), experience level, keywords, and red flags. Address the candidate by name. All text output in the resume's detected language.`;

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
              description: "Submit resume analysis results",
              parameters: {
                type: "object",
                properties: {
                  detectedLanguage: {
                    type: "object",
                    description: "The detected language of the resume",
                    properties: {
                      code: { type: "string", description: "ISO 639-1 language code (e.g., 'en', 'es', 'de', 'pt', 'fr')" },
                      name: { type: "string", description: "Language name in English (e.g., 'English', 'Spanish', 'German')" },
                      region: { type: "string", description: "Target job market region (e.g., 'US/UK', 'LATAM/Spain', 'DACH', 'Brazil/Portugal')" }
                    }
                  },
                  candidateName: { type: "string" },
                  industry: { type: "string" },
                  currentRole: { type: "string" },
                  atsScoreEstimate: { type: "number" },
                  formatGrade: { type: "string", enum: ["A", "B", "C", "D"] },
                  formatIssue: { type: "string", description: "Description in the resume's language" },
                  experienceLevel: {
                    type: "object",
                    properties: {
                      level: { type: "string", enum: ["entry", "mid", "senior", "executive"] },
                      yearsEstimate: { type: "string" }
                    }
                  },
                  sectionCheck: {
                    type: "object",
                    properties: {
                      hasContact: { type: "boolean" },
                      hasSummary: { type: "boolean" },
                      hasExperience: { type: "boolean" },
                      hasEducation: { type: "boolean" },
                      hasSkills: { type: "boolean" },
                      missingSections: { type: "array", items: { type: "string" }, description: "Section names in the resume's language" }
                    }
                  },
                  topStrength: {
                    type: "object",
                    properties: {
                      title: { type: "string", description: "In the resume's language" },
                      description: { type: "string", description: "In the resume's language" }
                    }
                  },
                  redFlags: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        issue: { type: "string", description: "In the resume's language" },
                        impact: { type: "string", description: "In the resume's language" }
                      }
                    }
                  },
                  keywords: {
                    type: "array",
                    description: "Keywords in the resume's language, appropriate for that region's job market",
                    items: {
                      type: "object",
                      properties: {
                        keyword: { type: "string", description: "Keyword in the resume's language" },
                        reason: { type: "string", description: "Explanation in the resume's language" }
                      }
                    }
                  },
                  quickWins: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        fix: { type: "string", description: "In the resume's language" },
                        timeEstimate: { type: "string" },
                        impact: { type: "string", enum: ["low", "medium", "high"] }
                      }
                    }
                  },
                  improvementPotential: {
                    type: "object",
                    properties: {
                      level: { type: "string", enum: ["low", "medium", "high"] },
                      estimatedScoreIncrease: { type: "number" },
                      topPriority: { type: "string", description: "In the resume's language" }
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

      // Build response
      const responseData = {
        success: true,
        ...analysis,
        redFlags: (analysis.redFlags || []).slice(0, 3),
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
