/**
 * THE $5 FULL ANALYSIS, ASKED IN PARALLEL PARTS (S13-001).
 *
 * WHAT WAS WRONG. analyze-resume sent ONE structured call for everything: a
 * 14.4k-character system prompt and a tool schema of 179 typed fields (82 for
 * the résumé, 59 more with a LinkedIn profile, 38 more with a posting), on
 * gemini-2.5-pro, with no output cap. Generation time scales with output, and
 * the shared chain then asked the same slow model again after a timeout, so a
 * slow reply ended in a 500 after about 125 s, on every retry.
 *
 * NOW, the free scanner's idiom (free-keyword-scan: CORE_KEYS and
 * ENRICHMENT_KEYS of one schema, asked concurrently, merged): the schema below
 * is the old one, unchanged, and its top-level keys are split into parts.
 *   - core: the résumé analysis, every key the old call required;
 *   - linkedin: linkedInAnalysis, in its own call, only with a LinkedIn profile;
 *   - posting: jobDescriptionAlignment, in its own call, only with a posting.
 * A résumé-only analysis is one call, the old request exactly but for its cap
 * and its clock. The parts run at once, so the wall clock is the slowest part,
 * not the sum, and mergeParts puts them back into the object the old call
 * produced: the core reply as it came, and from each other part only its own
 * section. The two sections were optional keys of the old object (never in
 * its required list, and the old call delivered without them), so a section
 * whose call fails is left out and the analysis is still delivered; only the
 * core decides whether there is anything to deliver. Everything downstream
 * (the Success page, the stored copy, the email, verify-product-purchase,
 * retry-failed-deliveries) reads that object unchanged;
 * src/test/the-full-analysis-is-asked-in-parts-and-a-timeout-says-try-again.test.ts
 * compares it with the old schema, frozen in a fixture.
 *
 * Pure: no imports, so the tests read exactly what the function sends.
 */

// Tool definition for structured resume analysis output
export const getAnalysisTools = (hasLinkedIn: boolean, hasJobDescription: boolean) => [{
  type: "function",
  function: {
    name: "submit_resume_analysis",
    description: "Submit the complete resume analysis with all sections",
    parameters: {
      type: "object",
      properties: {
        industry: {
          type: "string",
          enum: ["technology", "data_engineering", "data_science", "machine_learning", "healthcare", "finance", "marketing", "sales", "engineering", "education", "hr", "consulting", "legal", "retail", "hospitality", "manufacturing", "government", "product_management", "creative", "general"],
          description: "Detected industry. Use EXACTLY one of the enum values. Key disambiguation rules: (1) 'technology': ONLY software engineers, web/mobile developers, DevOps, SRE, security engineers, cloud engineers — NOT data or AI roles. (2) 'data_engineering': roles building data INFRASTRUCTURE — data engineers, analytics engineers (especially dbt+Airflow+Snowflake/BigQuery), ETL engineers, data architects, data platform engineers, BI engineers who build pipelines. Anchor keywords: dbt, Airflow, Spark, Kafka, Snowflake, BigQuery, Databricks, ETL, data pipeline, data warehouse. (3) 'data_science': roles doing ANALYTICS and MODELING — data scientists, data analysts, quant analysts, experimentation analysts, decision scientists, BI analysts who analyze not build. Anchor keywords: statistical analysis, A/B testing, hypothesis testing, regression, scikit-learn, Tableau, Power BI, pandas, forecasting. DO NOT use data_science for pipeline builders. (4) 'machine_learning': roles building PRODUCTION ML SYSTEMS — ML engineers, AI engineers, LLM/GenAI engineers, prompt engineers, MLOps engineers, ranking engineers, RecSys engineers, NLP engineers, CV engineers. Anchor keywords: PyTorch, TensorFlow, model deployment, inference, fine-tuning, RAG, embeddings, LangChain, MLflow, vector database. NOT for analysts doing one-off modeling. (5) 'product_management': PMs, TPMs, product owners, scrum masters, group PMs, CPOs. (6) 'engineering': ONLY non-software engineering — civil, mechanical, electrical, chemical, aerospace. (7) 'creative': designers, UX, art directors, animators, copywriters, photographers. (8) 'general': only when truly no other category fits."
        },
        experienceLevel: { type: "string", enum: ["entry", "mid", "senior", "executive"], description: "Career experience level" },
        atsScore: {
          type: "object",
          properties: {
            score: { type: "number", description: "ATS compatibility score from 0-100 (sum of all breakdown scores)" },
            breakdown: {
              type: "object",
              properties: {
                jobTitleMatch: { type: "number", description: "How well job titles match target roles (0-15 points)" },
                skillsMatch: { type: "number", description: "Relevant skills coverage (0-30 points)" },
                actionVerbUsage: { type: "number", description: "Strong action verbs at bullet starts (0-15 points)" },
                keywordCoverage: { type: "number", description: "Industry keywords present (0-20 points)" },
                formattingScore: { type: "number", description: "ATS-friendly formatting (0-20 points, deduct for tables/graphics/fancy fonts)" }
              },
              required: ["jobTitleMatch", "skillsMatch", "actionVerbUsage", "keywordCoverage", "formattingScore"]
            },
            improvements: { type: "array", items: { type: "string" }, description: "Top 3-5 ways to improve ATS score" }
          },
          required: ["score", "breakdown", "improvements"]
        },
        readabilityMetrics: {
          type: "object",
          properties: {
            grade: { type: "string", enum: ["A", "B", "C", "D", "F"], description: "Overall readability grade" },
            bulletPointClarity: { type: "string", description: "Assessment of bullet point clarity" },
            jargonLevel: { type: "string", enum: ["low", "moderate", "high"], description: "Amount of industry jargon used" },
            suggestions: { type: "array", items: { type: "string" }, description: "Readability improvement suggestions" }
          },
          required: ["grade", "bulletPointClarity", "jargonLevel", "suggestions"]
        },
        formatRecommendations: {
          type: "object",
          properties: {
            currentIssues: { type: "array", items: { type: "string" }, description: "Current formatting issues detected" },
            recommendations: { type: "array", items: { type: "string" }, description: "Specific formatting improvements" },
            sectionOrder: { type: "array", items: { type: "string" }, description: "Recommended section order for this candidate" }
          },
          required: ["currentIssues", "recommendations", "sectionOrder"]
        },
        atsParsingIssues: {
          type: "object",
          properties: {
            detectedIssues: { 
              type: "array", 
              items: { type: "string" }, 
              description: "Specific formatting/parsing issues that will break ATS systems (e.g., headers not readable, tables/text boxes used, unicode bullets, contact info format, graphics/images, multi-column layouts)" 
            },
            severity: { type: "string", enum: ["low", "medium", "high"], description: "Overall severity of parsing issues" },
            criticalFixes: { 
              type: "array", 
              items: { type: "string" }, 
              description: "Most critical fixes needed for ATS compatibility" 
            }
          },
          required: ["detectedIssues", "severity", "criticalFixes"]
        },
        summaryRewrite: {
          type: "object",
          properties: {
            professionalSummary: { type: "string", description: "2-3 sentence professional summary for resume" },
            linkedInHeadline: { type: "string", description: "Optimized LinkedIn headline under 120 chars" }
          },
          required: ["professionalSummary", "linkedInHeadline"]
        },
        optimizedBullets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              original: { type: "string", description: "Original weak bullet from resume" },
              improved: { type: "string", description: "Rewritten with metrics and impact" },
              reason: { type: "string", description: "Brief explanation of improvement" }
            },
            required: ["original", "improved", "reason"]
          },
          description: "3-5 bullet point improvements"
        },
        quantificationOpportunities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              context: { type: "string", description: "Vague statement from resume" },
              suggestion: { type: "string", description: "How to add metrics" },
              example: { type: "string", description: "Example with numbers" }
            },
            required: ["context", "suggestion", "example"]
          },
          description: "3-4 quantification opportunities"
        },
        achievementMetrics: {
          type: "object",
          properties: {
            roleType: { type: "string", description: "The detected role type (e.g., 'Software Engineer', 'Sales Manager', 'Product Manager')" },
            typicalMetrics: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string", description: "Metric category (e.g., 'Revenue Impact', 'Efficiency', 'Scale')" },
                  metricName: { type: "string", description: "Specific metric name (e.g., 'Revenue Generated', 'Time Saved', 'Users Impacted')" },
                  howToMeasure: { type: "string", description: "How candidate can calculate/find this number" },
                  exampleRange: { type: "string", description: "Typical range for this role (e.g., '$50K-$500K', '20-50%', '1K-100K users')" },
                  bulletExample: { type: "string", description: "Complete bullet point example using this metric" }
                },
                required: ["category", "metricName", "howToMeasure", "exampleRange", "bulletExample"]
              },
              description: "5-7 metrics this role should quantify"
            },
            missingFromResume: {
              type: "array",
              items: { type: "string" },
              description: "Specific metric types missing from their current resume"
            },
            quickWins: {
              type: "array",
              items: { type: "string" },
              description: "3 easy metrics they could add right now based on their experience"
            }
          },
          required: ["roleType", "typicalMetrics", "missingFromResume", "quickWins"]
        },
        skillsGap: {
          type: "object",
          properties: {
            missingTechnical: { type: "array", items: { type: "string" }, description: "3-5 missing technical skills" },
            missingSoft: { type: "array", items: { type: "string" }, description: "2-3 missing soft skills" },
            recommendations: { type: "string", description: "How to address skill gaps" }
          },
          required: ["missingTechnical", "missingSoft", "recommendations"]
        },
        industryInsights: {
          type: "object",
          properties: {
            whatRecruitersLookFor: { type: "string", description: "What recruiters in this industry prioritize" },
            competitiveAdvantage: { type: "string", description: "What would make candidate stand out" },
            commonMistakes: { type: "string", description: "Common resume mistakes in this industry" }
          },
          required: ["whatRecruitersLookFor", "competitiveAdvantage", "commonMistakes"]
        },
        actionVerbs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              weak: { type: "string", description: "Weak verb found in resume" },
              strong: { type: "string", description: "Stronger replacement" }
            },
            required: ["weak", "strong"]
          },
          description: "4-6 verb improvements"
        },
        keywords: { type: "array", items: { type: "string" }, description: "6-8 industry keywords to add" },
        redFlags: { type: "array", items: { type: "string" }, description: "3-5 issues recruiters would notice" },
        resumeLength: {
          type: "object",
          properties: {
            recommendedPages: { type: "number", description: "Recommended number of pages (1, 2, or 3)" },
            currentAssessment: { type: "string", description: "Assessment of their current resume length" },
            reasoning: { type: "string", description: "Why this page count is recommended based on their experience level and industry" }
          },
          required: ["recommendedPages", "currentAssessment", "reasoning"]
        },
        actionPlan: {
          type: "array",
          items: { type: "string" },
          description: "4-6 specific, prioritized action items for the candidate to implement immediately. Each should be concrete and actionable (e.g., 'Add X keyword to top 3 bullets', 'Rewrite summary to highlight Y skill', 'Fix red flag: remove Z'). Order by impact - most important first."
        },
        ...(hasLinkedIn ? {
          linkedInAnalysis: {
            type: "object",
            properties: {
              profileScore: {
                type: "object",
                properties: {
                  overall: { type: "number", description: "Overall LinkedIn profile optimization score 0-100" },
                  breakdown: {
                    type: "object",
                    properties: {
                      headline: { type: "number", description: "Headline effectiveness 0-20" },
                      about: { type: "number", description: "About section quality 0-20" },
                      experience: { type: "number", description: "Experience descriptions 0-20" },
                      skills: { type: "number", description: "Skills relevance 0-20" },
                      engagement: { type: "number", description: "Profile engagement potential 0-20" }
                    },
                    required: ["headline", "about", "experience", "skills", "engagement"]
                  }
                },
                required: ["overall", "breakdown"]
              },
              completenessChecklist: {
                type: "object",
                properties: {
                  hasPhoto: { type: "boolean", description: "Whether profile appears to have a professional photo" },
                  hasBanner: { type: "boolean", description: "Whether they mention or seem to have a custom banner" },
                  hasCustomUrl: { type: "boolean", description: "Whether they have a custom LinkedIn URL" },
                  hasCertifications: { type: "boolean", description: "Whether certifications section is utilized" },
                  hasRecommendations: { type: "boolean", description: "Whether they have recommendations" },
                  hasProjects: { type: "boolean", description: "Whether projects section is utilized" },
                  missingItems: { type: "array", items: { type: "string" }, description: "List of missing profile elements with why they matter" }
                },
                required: ["hasPhoto", "hasBanner", "hasCustomUrl", "hasCertifications", "hasRecommendations", "hasProjects", "missingItems"]
              },
              headlineOptimization: {
                type: "object",
                properties: {
                  current: { type: "string" },
                  improved: { type: "string" },
                  whyBetter: { type: "string" }
                },
                required: ["current", "improved", "whyBetter"]
              },
              aboutSectionRewrite: { type: "string", description: "3-4 paragraph About section" },
              experienceOptimization: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    role: { type: "string" },
                    issue: { type: "string" },
                    improved: { type: "string" }
                  },
                  required: ["role", "issue", "improved"]
                }
              },
              skillsToAdd: { type: "array", items: { type: "string" } },
              skillsToRemove: { type: "array", items: { type: "string" } },
              seoKeywords: { type: "array", items: { type: "string" } },
              contentStrategy: {
                type: "object",
                properties: {
                  postIdeas: { 
                    type: "array", 
                    items: { 
                      type: "object",
                      properties: {
                        topic: { type: "string" },
                        hook: { type: "string", description: "First line that grabs attention" },
                        format: { type: "string", enum: ["text", "carousel", "poll", "video", "article"] }
                      },
                      required: ["topic", "hook", "format"]
                    },
                    description: "3-4 content ideas tailored to their industry" 
                  },
                  postingFrequency: { type: "string", description: "Recommended posting schedule" },
                  bestTimes: { type: "string", description: "Best times to post for their industry" },
                  engagementTips: { type: "array", items: { type: "string" }, description: "3-4 tips for engaging with others' content" },
                  hashtagStrategy: { type: "array", items: { type: "string" }, description: "5-7 hashtags to use" }
                },
                required: ["postIdeas", "postingFrequency", "bestTimes", "engagementTips", "hashtagStrategy"]
              },
              connectionStrategy: {
                type: "object",
                properties: {
                  targetConnections: { type: "array", items: { type: "string" }, description: "Types of people to connect with (job titles, companies)" },
                  connectionMessageTemplate: { type: "string", description: "Template for personalized connection request" },
                  networkingTips: { type: "array", items: { type: "string" }, description: "3-4 strategic networking tips" },
                  groupsToJoin: { type: "array", items: { type: "string" }, description: "3-4 LinkedIn groups relevant to their field" }
                },
                required: ["targetConnections", "connectionMessageTemplate", "networkingTips", "groupsToJoin"]
              },
              profileVisibilityTips: { type: "array", items: { type: "string" } },
              featuredSectionIdeas: { type: "array", items: { type: "string" } },
              recommendationStrategy: { type: "string" }
            },
            required: ["profileScore", "completenessChecklist", "headlineOptimization", "aboutSectionRewrite", "experienceOptimization", "skillsToAdd", "skillsToRemove", "seoKeywords", "contentStrategy", "connectionStrategy", "profileVisibilityTips", "featuredSectionIdeas", "recommendationStrategy"]
          }
        } : {}),
        ...(hasJobDescription ? {
          jobDescriptionAlignment: {
            type: "object",
            properties: {
              matchScore: { type: "number", description: "Percentage match between resume and job description (0-100)" },
              extractedKeywords: { type: "array", items: { type: "string" }, description: "8-12 key requirements/skills extracted from the job description" },
              missingKeywords: { type: "array", items: { type: "string" }, description: "5-8 important keywords from the JD that are missing from the resume" },
              suggestedEdits: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    section: { type: "string", description: "Which section of resume to edit (e.g., 'Summary', 'Experience - Role X', 'Skills')" },
                    currentText: { type: "string", description: "Relevant text from the resume" },
                    suggestedText: { type: "string", description: "Rewritten text that better matches the JD" },
                    jdAlignment: { type: "string", description: "Which JD requirement this addresses" }
                  },
                  required: ["section", "currentText", "suggestedText", "jdAlignment"]
                },
                description: "3-5 specific resume edits to better match the job description"
              },
              roleMatchAnalysis: { type: "string", description: "2-3 sentences analyzing how well the candidate's experience aligns with the target role" },
              gapAnalysis: { type: "string", description: "2-3 sentences on skill/experience gaps vs the JD requirements" },
              toneAnalysis: {
                type: "object",
                properties: {
                  jdTone: { type: "string", enum: ["formal", "casual", "technical", "creative", "corporate", "startup"], description: "The dominant tone/voice of the job description" },
                  resumeTone: { type: "string", enum: ["formal", "casual", "technical", "creative", "corporate", "startup"], description: "The current tone/voice of the resume" },
                  toneMatch: { type: "boolean", description: "Whether the tones match well" },
                  toneGuidance: { type: "string", description: "Specific advice on adjusting resume tone to match the JD" },
                  phraseSwaps: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        current: { type: "string", description: "Current phrase from resume" },
                        suggested: { type: "string", description: "Phrase rewritten to match JD tone" },
                        reason: { type: "string", description: "Why this change matches the company's voice" }
                      },
                      required: ["current", "suggested", "reason"]
                    },
                    description: "3-5 specific phrase changes to match the JD tone"
                  }
                },
                required: ["jdTone", "resumeTone", "toneMatch", "toneGuidance", "phraseSwaps"]
              },
              companyInsights: {
                type: "object",
                properties: {
                  companyName: { type: "string", description: "Company name extracted from JD (or 'Unknown' if not found)" },
                  companyType: { type: "string", enum: ["startup", "scaleup", "enterprise", "agency", "nonprofit", "government", "unknown"], description: "Type of company based on JD signals" },
                  cultureSignals: {
                    type: "array",
                    items: { type: "string" },
                    description: "3-5 company culture traits detected from JD (e.g., 'fast-paced', 'collaborative', 'data-driven', 'innovative')"
                  },
                  valueKeywords: {
                    type: "array",
                    items: { type: "string" },
                    description: "Specific company values or buzzwords from JD to mirror (e.g., 'customer-obsessed', 'ownership', 'bias for action')"
                  },
                  languageToUse: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        value: { type: "string", description: "Company value/trait detected" },
                        resumeLanguage: { type: "string", description: "How to express this value in resume bullets" },
                        bulletExample: { type: "string", description: "Example bullet demonstrating this value" }
                      },
                      required: ["value", "resumeLanguage", "bulletExample"]
                    },
                    description: "3-4 ways to incorporate company values into resume"
                  },
                  redFlagsForThisCompany: {
                    type: "array",
                    items: { type: "string" },
                    description: "Things in the resume that might not resonate with this specific company culture"
                  }
                },
                required: ["companyName", "companyType", "cultureSignals", "valueKeywords", "languageToUse", "redFlagsForThisCompany"]
              }
            },
            required: ["matchScore", "extractedKeywords", "missingKeywords", "suggestedEdits", "roleMatchAnalysis", "gapAnalysis", "toneAnalysis", "companyInsights"]
          }
        } : {})
      },
      required: [
        "industry", "experienceLevel", "atsScore", "readabilityMetrics", "formatRecommendations",
        "atsParsingIssues", "summaryRewrite", "optimizedBullets", "quantificationOpportunities", 
        "skillsGap", "industryInsights", "actionVerbs", "keywords", "redFlags", "resumeLength", "actionPlan", "achievementMetrics"
      ]
    }
  }
}];

export const ANALYSIS_TOOL_NAME = "submit_resume_analysis";

// THE OUTPUT CAPS, MEASURED FROM THE SCHEMA ABOVE, NOT GUESSED (S13-001).
// The largest legitimate reply for each part: every array at the largest
// count its description allows ("3-5" is five, "3 easy" is three; with no
// count stated, ten items for a list named for keywords, skills, hashtags,
// sections, values, connections or groups, six otherwise) and every string at
// the length its description asks for (an enum: its longest value; "3-4
// paragraph": 2,000 characters; "under 120 chars": 120; "2-3 sentence": 450; a
// message template: 300; a label such as a role, a category or a verb: 60; a
// keyword, skill or hashtag: 40; a bullet or a rewritten line: 260; anything
// else: 220). Serialized: core 30,966 characters, LinkedIn 18,241, posting
// 15,809; at a conservative 3 characters a token (JSON keys and punctuation
// tokenize densely), 10,322, 6,081 and 5,270 tokens, rounded up below. A
// reply that long is the ceiling, not the norm.
// src/test/the-full-analysis-caps-are-measured-from-its-schema.test.ts
// re-measures the schema and fails if a constant falls below it.
export const CORE_OUTPUT_TOKENS = 10_400;
export const LINKEDIN_OUTPUT_TOKENS = 6_100;
export const POSTING_OUTPUT_TOKENS = 5_300;
// Gemini 2.5's thinking counts against max_tokens (generate-elevator-pitch,
// nl-search; S12-055: a 3,000-token cap with thinking truncated a paid
// reply). 8,192 is Gemini's "medium" thinking budget; gpt-5-mini's reasoning
// counts against max_completion_tokens the same way.
export const THINKING_TOKENS = 8_192;

// THE CLOCK. Each part's chain has the platform-safe 125 s; gemini-2.5-pro
// stays first for a paid analysis and is cut at 80 s, so flash, several times
// faster on the same output (_shared/scan-models.ts), keeps 45 s. The free
// scanner's split calls, larger than any part here by the same measure,
// showed pro's tail at 45-95 s.
export const ANALYSIS_BUDGET_MS = 125_000;
export const PRO_ATTEMPT_MS = 80_000;

export interface AnalysisPart {
  label: "core" | "linkedin" | "posting";
  /** The top-level keys of the old schema this part answers. */
  keys: string[];
  tools: ReturnType<typeof getAnalysisTools>;
  /** Appended to the system prompt; empty for a résumé-only analysis, which is the old request. */
  scopeNote: string;
  maxTokens: number;
}

type Schema = { type: string; properties: Record<string, unknown>; required: string[] };

/** Each optional section: the part that asks for it, what it is called in a prompt, and its measured cap. */
const SECTIONS = [
  { key: "linkedInAnalysis", label: "linkedin", name: "LinkedIn profile analysis", outputTokens: LINKEDIN_OUTPUT_TOKENS },
  { key: "jobDescriptionAlignment", label: "posting", name: "job description alignment", outputTokens: POSTING_OUTPUT_TOKENS },
] as const;

const CORE_NAME = "resume scores, rewrites, metrics and action plan";

/**
 * The calls one analysis makes: the core always, and one call for each
 * section the buyer gave input for. Each section has its own call because
 * the two together measure larger than the core (34,050 characters of
 * largest legitimate reply against 30,966): asked as one call they were the
 * biggest part of every analysis that had both, and the answer waits for the
 * slowest part. Apart, each is a little over half the core.
 */
export function analysisParts(hasLinkedIn: boolean, hasJobDescription: boolean, replyFactor = 1): AnalysisPart[] {
  // A reply in another language runs longer than the English it was measured
  // in (report-language.ts, S13-003): the reply's share of the cap grows by
  // that factor, the thinking's does not. 1, the default, is the English cap.
  const cap = (outputTokens: number) => Math.ceil(outputTokens * replyFactor) + THINKING_TOKENS;
  const tools = getAnalysisTools(hasLinkedIn, hasJobDescription);
  const params = tools[0].function.parameters as Schema;
  const sections = SECTIONS.filter((s) => s.key in params.properties);
  const sectionKeys: string[] = sections.map((s) => s.key);
  const coreKeys = Object.keys(params.properties).filter((k) => !sectionKeys.includes(k));
  const core: AnalysisPart = { label: "core", keys: coreKeys, tools, scopeNote: "", maxTokens: cap(CORE_OUTPUT_TOKENS) };
  if (sections.length === 0) return [core];

  const subset = (keys: string[], description: string, required: string[]) => [{
    type: "function",
    function: {
      name: ANALYSIS_TOOL_NAME,
      description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(Object.entries(params.properties).filter(([k]) => keys.includes(k))),
        required,
      },
    },
  }] as unknown as ReturnType<typeof getAnalysisTools>;
  const others = (written: string[]) =>
    written.length > 1 ? `Parallel calls write the ${written.join(" and the ")}` : `A parallel call writes the ${written[0]}`;
  return [
    {
      ...core,
      tools: subset(coreKeys, "Submit the core resume analysis: exactly the fields in this schema", params.required.filter((k) => coreKeys.includes(k))),
      scopeNote: `\n\nCALL SCOPE: This call produces the core resume analysis only: exactly the fields in the provided schema. ${others(sections.map((s) => s.name))}; do not include them.`,
    },
    ...sections.map((section): AnalysisPart => ({
      label: section.label,
      keys: [section.key],
      // Required here: the section is the whole of this call.
      tools: subset([section.key], `Submit the ${section.name}: exactly the fields in this schema`, [section.key]),
      scopeNote: `\n\nCALL SCOPE: This call writes only the ${section.name}: exactly the fields in the provided schema. ${others([CORE_NAME, ...sections.filter((s) => s !== section).map((s) => s.name)])}; do not repeat them.` +
        // One headline per report (mergeParts): this one replaces the core's
        // summaryRewrite.linkedInHeadline, whose field asks for under 120 chars.
        (section.key === "linkedInAnalysis"
          ? " The report also shows linkedInAnalysis.headlineOptimization.improved as the resume summary's LinkedIn headline, its only one, so keep it under 120 characters."
          : ""),
      maxTokens: cap(section.outputTokens),
    })),
  ];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * What a reply delivers: the tool call's arguments, or JSON in the message
 * when a model answered there; null when neither parses (a truncated reply
 * included), exactly the replies the old single call refused.
 */
export function readToolReply(data: unknown): Record<string, unknown> | null {
  const message = (data as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }>; content?: string } }> } | null)?.choices?.[0]?.message;
  const args = message?.tool_calls?.[0]?.function?.arguments;
  let text: string | undefined = typeof args === "string" && args ? args : undefined;
  if (!text) {
    const content = message?.content;
    if (typeof content !== "string" || !content) return null;
    let clean = content.trim();
    if (clean.startsWith("```json")) clean = clean.slice(7);
    if (clean.startsWith("```")) clean = clean.slice(3);
    if (clean.endsWith("```")) clean = clean.slice(0, -3);
    text = clean.trim();
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Whether a part's reply can be delivered. The core needs the four fields the
 * old call was refused without; a section's part needs its section, since
 * that is all it writes. Refused, the next model in the chain is asked with
 * the time that is left.
 */
export function usablePart(part: AnalysisPart, reply: Record<string, unknown>): boolean {
  if (part.label === "core") return !!(reply.optimizedBullets && reply.actionVerbs && reply.keywords && reply.redFlags);
  return part.keys.every((k) => isObject(reply[k]));
}

/**
 * The object the old single call produced: the core reply as it came, then
 * each section from its own part. A section whose part failed (null) is left
 * out, as the old object left out a section the model did not write (neither
 * was ever required); a stray copy of a section in another part's reply never
 * stands in for it. And the report has ONE LinkedIn headline: the old call
 * wrote summaryRewrite.linkedInHeadline and linkedInAnalysis.headlineOptimization
 * in one reply, the parts write them apart, so the LinkedIn section's improved
 * headline, written from the profile itself, is the summary's too.
 */
export function mergeParts(parts: AnalysisPart[], replies: Array<Record<string, unknown> | null>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(replies[0] ?? {}) };
  parts.forEach((part, i) => {
    if (i === 0) return;
    for (const k of part.keys) {
      delete merged[k];
      const section = replies[i]?.[k];
      if (isObject(section)) merged[k] = section;
    }
  });
  const linkedIn = merged.linkedInAnalysis;
  const improved = isObject(linkedIn) && isObject(linkedIn.headlineOptimization) ? linkedIn.headlineOptimization.improved : undefined;
  if (typeof improved === "string" && improved.trim() && isObject(merged.summaryRewrite)) {
    merged.summaryRewrite = { ...merged.summaryRewrite, linkedInHeadline: improved };
  }
  return merged;
}
