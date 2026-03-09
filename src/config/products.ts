// Product configuration with Stripe price IDs
// All products are one-time purchases (no auth required)

export const PRODUCTS = {
  // Current products
  fullAnalysis: {
    id: 'full_analysis',
    name: 'Full Resume Analysis',
    description: 'Comprehensive AI-powered resume analysis with ATS optimization',
    priceUsd: 5,
    priceId: null, // Uses dynamic pricing in create-checkout (main checkout flow)
    useMainCheckout: true, // Flag to use existing create-checkout function
    features: [
      'Complete ATS score breakdown',
      'Bullet-by-bullet rewrites',
      'Keyword optimization',
      'Action plan with priorities',
      'PDF export'
    ]
  },
  scanPack: {
    id: 'scan_pack',
    name: 'Scan Pack (10 Credits)',
    description: '10 additional resume scans at $0.20 each',
    priceUsd: 2,
    priceId: 'price_1Sgv2THBplUUV1CgntHsXlDK',
    credits: 10,
    features: [
      '10 resume scans',
      'Unlimited job comparisons',
      'Never expires'
    ]
  },

  // $5 Add-Ons
  interviewCoach: {
    id: 'interview_coach',
    name: 'Interview Coach',
    description: 'Practice tough interview questions based on your resume',
    priceUsd: 5,
    priceId: 'price_interview_coach_5',
    category: 'addon',
    features: [
      'Personalized questions from your resume',
      'Behavioral interview prep',
      'STAR method guidance',
      'Answer frameworks'
    ],
    icon: 'MessageSquare'
  },
  careerPathSimulator: {
    id: 'career_path_simulator',
    name: 'Career Path Simulator',
    description: 'See your potential career trajectories and what it takes to get there',
    priceUsd: 5,
    priceId: 'price_career_path_5',
    category: 'addon',
    features: [
      '3 realistic career paths',
      'Skills gap analysis',
      'Timeline projections',
      'Action steps for each path'
    ],
    icon: 'TrendingUp'
  },

  // Premium products
  basicKeywordFix: {
    id: 'basic_keyword_fix',
    name: 'Basic Keyword Fix',
    description: 'Quick keyword optimization suggestions',
    priceUsd: 3,
    priceId: 'price_1Sgv2hHBplUUV1Cgjdqw9kHi',
    features: [
      'Missing keyword list',
      'Top 10 keywords to add',
      'Industry-specific suggestions'
    ]
  },
  coverLetter: {
    id: 'cover_letter',
    name: 'Cover Letter Generator',
    description: 'AI-generated cover letter tailored to your resume and job',
    priceUsd: 4,
    priceId: 'price_1Sgv2tHBplUUV1CgoXHF6GjD',
    features: [
      'Personalized to job description',
      'Matches your resume style',
      'Multiple tone options',
      'Instant download'
    ]
  },
  premiumPackage: {
    id: 'premium_package',
    name: 'Premium Resume Package',
    description: 'Full analysis + AI-rewritten resume + tailored cover letter',
    priceUsd: 12,
    priceId: 'price_1Sgv32HBplUUV1CgAdw6PnV3',
    features: [
      'Everything in Full Analysis',
      'AI-rewritten resume (ATS-optimized)',
      'Custom cover letter',
      'Before/after comparison',
      'Priority processing'
    ],
    badge: 'Best Value',
    savings: 'Save $6'
  },
  atsDefense: {
    id: 'ats_defense',
    name: 'ATS Defense Complete',
    description: 'Full ATS optimization with multi-role targeting & 30-day guarantee',
    priceUsd: 15,
    priceId: 'price_1Sgv3LHBplUUV1CgpCF5pDLO',
    features: [
      'ATS compatibility audit (before/after score)',
      'Keyword gap analysis & optimization',
      'Format restructuring for ATS parsing',
      'Multi-role targeting (up to 3 roles)',
      'LinkedIn profile alignment tips',
      'Industry keyword bank',
      '30-day re-optimize guarantee'
    ],
    badge: 'Most Comprehensive'
  },
  careerSnapshot: {
    id: 'career_snapshot',
    name: 'Career Snapshot',
    description: 'Recruiter-style career intelligence report showing how your career looks at a glance',
    priceUsd: 25,
    priceId: 'price_1SibLiHBplUUV1CgHmRy7ayi',
    features: [
      'Career Signal Score (Performance, Trajectory, Credibility, Seniority)',
      'Recruiter Perception Summary — what they see at a glance',
      'Top 3 strengths that actually matter',
      'Top 3 career risks & questions recruiters will ask',
      'Positioning guidance — roles to target, roles to avoid',
      '3 priority fixes — exactly what to do first'
    ],
    badge: 'Career Intelligence',
    tagline: 'Before you rewrite your resume, understand your career.'
  },
  graduateGamePlan: {
    id: 'graduate_gameplan',
    name: 'Graduate Game Plan',
    description: 'A clear, step-by-step playbook for new grads on what to do next',
    priceUsd: 10,
    priceId: 'price_1SibRNHBplUUV1CgEj5L8eH1',
    features: [
      'Resume readiness check — permission to move forward',
      'Role targeting map — what jobs fit your background',
      'Application strategy — quality over quantity approach',
      'Networking playbook with copy-paste scripts',
      'Interview readiness checklist with story prompts',
      '30-day action plan — week-by-week execution guide'
    ],
    badge: 'New Grads',
    tagline: 'Your resume isn\'t the problem. Not knowing what to do next is.'
  }
} as const;

export type ProductId = keyof typeof PRODUCTS;
export type Product = typeof PRODUCTS[ProductId];

// Get product by ID
export function getProduct(id: ProductId) {
  return PRODUCTS[id];
}

// Get all purchasable products (for display)
export function getAllProducts() {
  return Object.values(PRODUCTS);
}

// Get $5 add-on products (Resume Roast is free with scanner)
export function getAddOnProducts() {
  return [
    PRODUCTS.interviewCoach,
    PRODUCTS.careerPathSimulator,
  ];
}

// Get premium products (higher tier)
export function getPremiumProducts() {
  return [
    PRODUCTS.graduateGamePlan,
    PRODUCTS.atsDefense,
    PRODUCTS.careerSnapshot,
  ];
}
