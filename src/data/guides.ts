// Authoritative guides (/guides/:slug) — the mid-tail informational layer of
// the SEO cluster. Rules that keep this from being blogspam: every guide is
// grounded in something the product actually does (checks it runs, data it
// uses), no invented statistics, and myths get debunked rather than amplified.
// Pure data module — imported by the React pages AND the build-time
// prerenderer, so keep it free of React/browser imports.

export interface GuideSection {
  h2: string;
  paras: string[];
  bullets?: string[];
}

export interface Guide {
  slug: string;
  title: string; // SEO title, ≤60 chars where possible
  h1: string;
  description: string; // meta description, ≤160 chars
  /** 2–3 sentence direct answer, rendered as "The short answer" box at the
   *  top. This is what featured snippets and AI engines extract — it must
   *  fully answer the title's question standing alone. */
  tldr: string;
  updated: string; // ISO date, bump when content materially changes
  minutes: number;
  sections: GuideSection[];
  faqs?: Array<{ q: string; a: string }>;
  related: Array<{ label: string; href: string }>;
}

export const GUIDES: Record<string, Guide> = {
  "why-resumes-get-rejected": {
    slug: "why-resumes-get-rejected",
    title: "Why Your Resume Gets Rejected Before a Human Reads It",
    h1: "Why your resume gets rejected before a human reads it",
    description:
      "The four failure points that stop resumes before a recruiter ever looks: parsing, searchability, keyword gaps, and red flags — and the order to fix them in.",
    tldr:
      "Resumes fail at four stages before an interview: parsing (the ATS extracts your text badly), search (recruiter keyword queries never return you), the six-second human skim, and red flags in the close read. Most 'rejections' are really invisibility at the first two stages — so fix parsing and searchable keywords before polishing bullets.",
    updated: "2026-07-06",
    minutes: 7,
    sections: [
      {
        h2: "The four failure points, in the order they happen",
        paras: [
          "When you apply online, your resume passes through a pipeline: a parser extracts your text into a database, recruiters search that database, whoever surfaces gets a six-second human skim, and only then does anyone read carefully. A resume can die at any of the four stages — and the earlier the stage, the more invisible the failure. Nobody emails you to say your dates landed in the wrong database column.",
          "Our scanner runs its 24-point check in this same order, because fixing a later stage while an earlier one is broken changes nothing. Here's what actually goes wrong at each stage.",
        ],
      },
      {
        h2: "Stage 1: The parser mangles your file",
        paras: [
          "Applicant tracking systems don't read your resume — they read the text their parser extracted from it. Multi-column layouts read out of order. Tables scatter fields. Text inside images doesn't exist at all. Headers and footers are often skipped entirely, which is a problem if that's where your contact info lives.",
          "This is the quietest failure because your resume looks perfect to you. The test is simple: what does the extracted text look like? Our free scan shows you the actual extraction from your file — the same view a parser produces — so you can see whether your experience survived intact.",
        ],
        bullets: [
          "Single column beats two columns in every major ATS",
          "Standard section headers (Experience, Education, Skills) — parsers key on them",
          "No text in images, headers, or footers",
          "Conventional bullets (•) instead of decorative glyphs",
        ],
      },
      {
        h2: "Stage 2: Recruiter searches never find you",
        paras: [
          "Once parsed, you're a row in a database. Recruiters search that database the way you search Google: by job titles and skills, mostly using the exact words from their job description. If your title says 'Customer Success Ninja' and they search 'account manager,' you don't exist — regardless of how good you are.",
          "This is why exact keyword phrasing matters more than it should. 'Managed projects' doesn't match a search for 'project management.' The fix isn't stuffing — it's using the recognized, searchable form of each skill and title once, in context.",
        ],
      },
      {
        h2: "Stage 3: The six-second skim",
        paras: [
          "When you do surface, a human decides in seconds whether to keep reading. They check three things almost universally: does the most recent title fit the role, is there a credential they require (license, certification, clearance — field-dependent), and do the bullets show outcomes or just duties.",
          "Field matters enormously here. A healthcare screener looks for your license in the top third of page one. A tech screener looks for a GitHub link. A finance screener looks for CPA or CFA next to your name. Our industry pages document what each field's screeners check first.",
        ],
      },
      {
        h2: "Stage 4: Red flags in the close read",
        paras: [
          "Survive the skim and the remaining killers are unexplained gaps, title regressions with no context, vague bullets ('responsible for various tasks'), and inconsistent dates. These rarely get you rejected outright at earlier stages — they get you deprioritized against candidates with cleaner stories.",
          "Every one of these has a known fix: gaps get one honest line of context, weak bullets get rewritten around outcomes, and dates get audited for consistency. The point of a diagnostic scan is knowing which of the four stages is actually costing you — most people guess wrong, then polish bullets while their file fails at parsing.",
        ],
      },
    ],
    faqs: [
      {
        q: "How do I know which stage my resume fails at?",
        a: "Run a scan that tests the stages separately: parse extraction, keyword/searchability analysis, structure and credential visibility, and bullet-level red flags. Our free scan reports each with the specific findings, so you fix the binding constraint first.",
      },
      {
        q: "Is it true most resumes are rejected by bots automatically?",
        a: "Mostly no — automatic hard rejection is rare and usually limited to knockout questions (work authorization, required license). The far more common failure is quieter: bad parsing or missing keywords mean you never surface in searches. Nothing 'rejected' you; nobody ever saw you.",
      },
    ],
    related: [
      { label: "Run the free 24-point scan", href: "/" },
      { label: "The ATS auto-rejection myth", href: "/guides/ats-auto-rejection-myth" },
      { label: "The resume format that survives every ATS", href: "/guides/resume-format-that-survives-ats" },
      { label: "Resume keywords by industry", href: "/industries" },
    ],
  },

  "ats-auto-rejection-myth": {
    slug: "ats-auto-rejection-myth",
    title: "Do ATS Systems Auto-Reject Resumes? The Honest Answer",
    h1: "Do ATS systems really auto-reject resumes?",
    description:
      "Mostly no — and the truth is worse. What Workday, Greenhouse, Lever, and iCIMS actually do with your resume, from documented parser behavior.",
    tldr:
      "Mostly no: major ATS platforms (Workday, Greenhouse, Lever, iCIMS) do not auto-reject resumes over formatting or a score. Hard knockouts come only from explicit application questions like work authorization. The real risk is quieter — parsing failures make you unsearchable in the recruiter's database, so you're never seen rather than rejected.",
    updated: "2026-07-06",
    minutes: 5,
    sections: [
      {
        h2: "The myth, and why it spread",
        paras: [
          "You've seen the claim: '75% of resumes are rejected by ATS bots before a human sees them.' It's marketing copy, not measurement — usually traced to nothing, repeated because fear sells resume services. We run an ATS-checking product, so it would be profitable for us to repeat it. We won't, because it's not how these systems work.",
          "Most applicant tracking systems are filing cabinets with search, not gatekeepers with opinions. Out of the box, Workday, Greenhouse, Lever, and iCIMS do not silently score-and-reject your application. What they do is subtler, and in some ways worse.",
        ],
      },
      {
        h2: "What actually happens: you become unsearchable",
        paras: [
          "The real mechanism has two parts. First, hard knockouts do exist — but they're explicit questions, not resume analysis: work authorization, minimum certifications, willingness to relocate. Answer 'no' to a required one and yes, you're auto-dispositioned. That's the narrow kernel of truth in the myth.",
          "Second — the part that matters for your resume — parsing failures make you invisible rather than rejected. If the parser scrambled your titles or your skills never made it into the database, recruiter searches don't return you. There's no rejection email because there was no rejection. You're just not in the result set. This is why 'my applications disappear into a void' feels so common: for badly-parsed resumes, the void is literal.",
        ],
      },
      {
        h2: "What each major system actually does",
        paras: [
          "The four systems most large employers use have different personalities, all documented in our per-vendor guides. Workday auto-fills application fields from its parse, so a scrambled parse means wrong data in the form itself. Greenhouse keeps your original PDF for humans but searches the extracted text — pretty resumes stay pretty, but still need a clean text layer. Lever keys its profile threading on standard section headers. iCIMS drives the whole application form from the parse, making it the least forgiving of layout experiments.",
          "None of them auto-reject on formatting. All of them quietly punish formatting through search invisibility and mangled auto-fill.",
        ],
      },
      {
        h2: "What to do with this information",
        paras: [
          "Stop optimizing against an imaginary rejection bot and start optimizing for the real pipeline: parse cleanly, use searchable phrasing, answer knockout questions accurately, and verify what the system extracted whenever it shows you (Workday and iCIMS both do — always check).",
          "Our free scan simulates the extraction step on your actual file and runs the specific per-vendor checks, so you can see whether you're in the searchable set or the void.",
        ],
      },
    ],
    faqs: [
      {
        q: "So formatting doesn't matter?",
        a: "It matters more than ever — just not the way the myth says. Bad formatting doesn't trigger rejection; it breaks parsing, which removes you from recruiter search results. Invisible beats rejected only in that you waste more time not knowing.",
      },
      {
        q: "Do any systems score resumes automatically?",
        a: "Some employers layer AI screening or match-scoring tools on top of their ATS, and those are becoming more common — but they assist human review rather than silently rejecting, and they read the same parsed text. Clean parsing and real keyword coverage help with both.",
      },
    ],
    related: [
      { label: "Test your resume against real ATS parsing — free", href: "/ats-resume-test" },
      { label: "Workday parsing guide", href: "/ats/workday" },
      { label: "Greenhouse parsing guide", href: "/ats/greenhouse" },
      { label: "Why resumes get rejected before a human reads them", href: "/guides/why-resumes-get-rejected" },
    ],
  },

  "resume-keywords-guide": {
    slug: "resume-keywords-guide",
    title: "How to Choose Resume Keywords (Without Stuffing)",
    h1: "How to choose resume keywords — without stuffing",
    description:
      "Where resume keywords actually come from: the job posting, O*NET occupational data, and recognized titles — plus the stuffing traps that backfire.",
    tldr:
      "Take keywords from three sources, in order: the exact wording of your target job posting; the U.S. Department of Labor's O*NET skill data for your occupation when you have no posting; and the recognized, searchable form of your job titles. Use each term once, attached to evidence — keyword stuffing fails with humans and increasingly with software.",
    updated: "2026-07-06",
    minutes: 6,
    sections: [
      {
        h2: "Keywords are search terms, not magic words",
        paras: [
          "A resume keyword is any term a recruiter might type into their ATS search box or scan for during the six-second skim: skills, tools, certifications, job titles, methodologies. The goal isn't to impress an algorithm — it's to be findable by the exact words your target role is described with.",
          "That definition tells you where keywords must come from: the language of the job you want, not a generic list. Three sources, in priority order.",
        ],
      },
      {
        h2: "Source 1: The job posting (when you have one)",
        paras: [
          "The posting is the recruiter's own vocabulary — when they search the applicant pool, they overwhelmingly reuse its terms. Extract the hard skills, tools, and title phrasing that appear in the requirements section, and make sure each one you genuinely have appears somewhere in your resume in the same form. 'Kubernetes' in the posting and 'container orchestration' on your resume is a missed match.",
          "When you paste a job description into our scanner, this is exactly what it does: posting terms first, everything else second.",
        ],
      },
      {
        h2: "Source 2: O*NET occupational data (when you don't)",
        paras: [
          "Without a specific posting, don't guess — the U.S. Department of Labor's O*NET database documents the skills and technologies for nearly a thousand occupations, built from employer surveys. It's public domain and it's what our scanner cites when you scan without a job description: the expected skills for your detected occupation, sourced and labeled.",
          "Our industry and role pages publish these expectations per field, straight from the same data the scanner uses.",
        ],
      },
      {
        h2: "Source 3: Recognized titles",
        paras: [
          "Job titles are the most-searched field in any ATS. If your official title was nonstandard ('Growth Wizard', 'Member Experience Advocate'), include the recognized equivalent alongside it: 'Member Experience Advocate (Customer Service Representative)'. That's honest — you're translating, not inventing — and it's the difference between appearing in title searches or not.",
        ],
      },
      {
        h2: "The stuffing traps",
        paras: [
          "Keyword stuffing fails at the human stage even when it passes the software stage. A skills section with forty comma-separated terms reads as noise; recruiters discount it and some screening tools now flag it. White-text keywords and pasted job descriptions are detected by modern parsers and torch your credibility outright.",
          "The working rule: every keyword appears once in a context that proves it — attached to an outcome, a project, or a credential. 'Built CI/CD pipelines in GitLab that cut deploy time 60%' carries 'CI/CD' and 'GitLab' with evidence. A bare list carries suspicion.",
        ],
      },
    ],
    faqs: [
      {
        q: "How many keywords should a resume have?",
        a: "There's no magic number. Coverage of the posting's must-have skills (the ones you actually possess) matters far more than volume. Our scans typically surface 5–15 missing terms worth adding — beyond that you're usually stuffing, not optimizing.",
      },
      {
        q: "Should I use an exact keyword even if it feels repetitive?",
        a: "Once, yes — in the searchable, recognized form. Repetition beyond that adds nothing: ATS search is a match, not a frequency contest, and humans notice padding.",
      },
    ],
    related: [
      { label: "See your missing keywords — free scan", href: "/resume-checker" },
      { label: "Resume keywords by industry (58 fields)", href: "/industries" },
      { label: "Career changer's keyword playbook", href: "/guides/career-change-resume" },
    ],
  },

  "career-change-resume": {
    slug: "career-change-resume",
    title: "Career Change Resume: Keywords & Framing That Work",
    h1: "The career changer's resume playbook",
    description:
      "How to write a resume when your experience is in one field and your target is another: bridge keywords, title translation, and the sections that carry a transition.",
    tldr:
      "A career-change resume fails because every title and keyword points at the old field. Fix it three ways: re-label transferable work in the target field's vocabulary (bridge keywords), name the transition explicitly in a summary line, and add a projects section that carries target-field evidence. Keep the standard reverse-chronological format — functional resumes parse badly and recruiters distrust them.",
    updated: "2026-07-06",
    minutes: 6,
    sections: [
      {
        h2: "Your real problem: you're searchable in the wrong field",
        paras: [
          "A career changer's resume fails in a specific way: every title, keyword, and credential points at the old field, so both ATS searches and human skims file you under the job you're leaving. Our scanner detects this pattern explicitly — when a resume's strongest industry signals conflict with its stated target, it flags the transition and analyzes both fields — because a career-change resume graded against only its past looks great and performs terribly.",
          "The fix isn't hiding your history. It's re-labeling the transferable parts in the target field's vocabulary.",
        ],
      },
      {
        h2: "Bridge keywords: the overlap is bigger than you think",
        paras: [
          "Every field pair shares real skills — the transition works by making the shared ones loud. A teacher moving to corporate training already has curriculum design, stakeholder communication, and assessment. A nurse moving to health tech has EHR systems, clinical workflows, and patient data. The bridge keywords are the target field's terms for things you already did.",
          "The practical exercise: pull the keyword list for your target field (our industry pages publish exactly these), mark every term you can honestly claim from your history, and rewrite those bullets using the target field's phrasing. That's not spin — 'trained 30 staff on the new EHR rollout' was always true; you just never called it 'software implementation and end-user training' before.",
        ],
      },
      {
        h2: "The three structural moves",
        paras: [
          "First, a summary line that names the transition explicitly: 'Operations manager transitioning to data analytics; completed Google Data Analytics certificate; SQL and Tableau projects below.' Screeners give coherent stories a chance and confusing ones nothing.",
          "Second, a projects or coursework section that carries target-field evidence when your work history can't — for many transitions this section matters more than your last job. Third, title translation in parentheses where your old titles obscure relevant work, exactly as with nonstandard titles generally.",
        ],
      },
      {
        h2: "What not to do",
        paras: [
          "Don't erase your old field — unexplained thin history reads worse than a well-framed transition. Don't claim the target field's advanced skills without evidence; one honest beginner project beats three invented proficiencies, and any competent interviewer finds the difference in minutes. And don't use a functional (skills-only, no dates) resume format to hide the transition: parsers handle it badly and recruiters distrust it almost universally.",
        ],
      },
    ],
    faqs: [
      {
        q: "Should a career changer use a different resume format?",
        a: "Keep reverse-chronological — parsers and recruiters both expect it. Add a strong summary and a projects section to carry the target-field signal instead of restructuring the whole document.",
      },
      {
        q: "How does the free scan handle career-change resumes?",
        a: "Tell it your situation (there's a one-tap 'Changing careers' option before you scan, or state a target role) and it analyzes the gap between your detected field and your target: which bridge keywords you already have, which are missing, and how your current framing reads to each side.",
      },
    ],
    related: [
      { label: "Scan your resume with a career-change lens — free", href: "/" },
      { label: "How to choose resume keywords", href: "/guides/resume-keywords-guide" },
      { label: "Freelance Boost: project-based career tools", href: "/freelance-boost" },
    ],
  },

  "resume-format-that-survives-ats": {
    slug: "resume-format-that-survives-ats",
    title: "The Resume Format That Survives Every ATS",
    h1: "The resume format that survives every ATS",
    description:
      "The layout, sections, fonts, and file-type choices that parse cleanly in Workday, Greenhouse, Lever, and iCIMS — from documented parser behavior, not folklore.",
    tldr:
      "One format survives every major ATS: single column, standard section headers (Experience, Education, Skills), conventional round bullets, common fonts, consistent MM/YYYY dates, and a text-layer PDF (or DOCX if the posting asks). What breaks parsing: two-column layouts, tables, text in headers/footers or images, and decorative bullet glyphs.",
    updated: "2026-07-06",
    minutes: 5,
    sections: [
      {
        h2: "One safe format exists, and it's boring",
        paras: [
          "Every claim below comes from the parser behaviors our scanner tests on real files — the same checks documented in our per-vendor guides. The summary is anticlimactic: a single-column, standard-header, conventionally-bulleted document survives everything. Design experiments are what break.",
          "Boring is a feature. Recruiters spend their day in parsed-text views and skim conventional layouts fastest. The audience for a visually striking resume is other designers — and even they run portfolios for that job.",
        ],
      },
      {
        h2: "Layout rules that actually matter",
        paras: [
          "Single column, top to bottom. Two-column layouts read out of order in multiple major parsers, attaching your dates and titles to the wrong entries. No tables for layout; no text boxes; no content in headers or footers (contact info there is routinely skipped); no icons standing in for words — a phone icon is not the word 'phone' to a parser.",
        ],
        bullets: [
          "Sections titled exactly: Experience, Education, Skills, Certifications",
          "Reverse-chronological entries: Title, Company, Location, Dates — consistent order every time",
          "Dates in one format throughout (MM/YYYY is safest)",
          "Standard round bullets; no ✦ ➤ ► glyphs",
          "Common fonts (Calibri, Arial, Georgia); size 10–12 body",
        ],
      },
      {
        h2: "PDF or DOCX?",
        paras: [
          "Modern parsers handle text-layer PDFs well, and PDF locks your layout — it's the right default. Two exceptions: if the posting explicitly requests Word, send Word; and never send an image-based PDF (a scan or export-as-image), which contains no text at all. The test: if you can select and copy your resume's text in a PDF viewer, the parser can read it too.",
        ],
      },
      {
        h2: "Verify, don't hope",
        paras: [
          "Workday and iCIMS show you their parse of your resume during application — actually read those fields instead of clicking past, and fix the source document if anything landed wrong. Before you're in an application flow, our free scan shows the extraction from your real file plus the vendor-specific checks, which is the same verification without burning an application to find out.",
        ],
      },
    ],
    related: [
      { label: "See how your file actually parses — free", href: "/ats-resume-test" },
      { label: "Workday guide", href: "/ats/workday" },
      { label: "iCIMS guide", href: "/ats/icims" },
      { label: "Build a clean resume from scratch", href: "/builder" },
    ],
  },

  "what-resume-score-means": {
    slug: "what-resume-score-means",
    title: "What a Resume Score Actually Means (and Doesn't)",
    h1: "What a resume score actually means — and doesn't",
    description:
      "Resume scores are estimates with error bars, not verdicts. How scoring works, why we show a range, and how to use a score without being fooled by it.",
    tldr:
      "A resume score is a model's estimate built from proxies (parseability, keyword coverage, structure), not a measurement of hiring odds — two reasonable tools will disagree on the same resume by several points. Use scores for prioritization: below ~50 usually means a structural or parsing problem to fix first; above ~80 means stop polishing and start applying. Trust only scores that come with an itemized explanation.",
    updated: "2026-07-06",
    minutes: 5,
    sections: [
      {
        h2: "Every resume score is a model, including ours",
        paras: [
          "No scoring tool — ours included — measures 'will this resume get interviews.' A score is a model of proxies: parseability, keyword coverage against a target, structure, bullet strength. Those proxies correlate with outcomes; they aren't outcomes. Any tool showing you a single precise number ('73!') is hiding its own uncertainty, because two reasonable scoring models will disagree on the same resume by several points.",
          "That's why our reports show a band, not just a point — the range our rule-based parser and AI analysis agree on — plus the audit trail of exactly which findings moved the number. If you can't interrogate a score, it's a mood ring.",
        ],
      },
      {
        h2: "How to actually read a score",
        paras: [
          "Use thresholds, not decimals. In our scale, most resumes land in the 50s–70s. Below ~50 usually means a structural problem — parsing failures or major keyword gaps — where one fix moves everything. The 60s–70s mean the fundamentals work and specific findings (weak bullets, missing credentials visibility, gaps) are the remaining cost. Above ~80, keywords, structure, and parseability are all solid for the target, and further score-chasing has worse returns than sending more applications.",
          "The number's real job is prioritization: the findings behind it tell you which of the four failure stages to fix first. A 62 with 'license not visible in top third' is a five-minute fix worth more than ten points of bullet polish.",
        ],
      },
      {
        h2: "Scores you should distrust",
        paras: [
          "Distrust any score that arrives without an itemized explanation, any score that can't be reproduced (rescan the same file — consistent tools produce consistent results; ours prints a report ID so you can check), and any 'match rate' that punishes you for not pasting keywords you don't have. And distrust cross-tool comparisons entirely: a 70 in one tool and a 78 in another measure different models, not progress.",
          "The honest use of any scoring tool is the same: run it, read the findings, fix what's real, rescan to confirm the fix registered, and then go apply. The interview pipeline is the only score that ultimately counts.",
        ],
      },
    ],
    faqs: [
      {
        q: "What's a good ATS resume score?",
        a: "On our scale: above ~80 means keywords, structure, and parseability are all solid for your target. But 'good' is per-target — a great healthcare resume scores poorly against a sales posting. The findings matter more than the number.",
      },
      {
        q: "Why does my score change between tools?",
        a: "Different models, different proxies, different targets. That's not a flaw in either tool — it's the nature of modeling. It IS a flaw when a tool implies its number is objective truth. Look for tools that show their work.",
      },
    ],
    related: [
      { label: "Get your score with the full audit trail — free", href: "/resume-score" },
      { label: "Our scoring methodology", href: "/methodology" },
      { label: "Why resumes get rejected", href: "/guides/why-resumes-get-rejected" },
    ],
  },
};
