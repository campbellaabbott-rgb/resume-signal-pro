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

  // New products
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
  careerBundle: {
    id: 'career_bundle',
    name: 'Career Bundle (75 Analyses)',
    description: '75 full resume analyses - Best value for job seekers',
    priceUsd: 20,
    priceId: 'price_1Sgv3rHBplUUV1CgC3N97S71',
    credits: 75,
    features: [
      '75 full resume analyses',
      'Use for multiple jobs',
      'Share with friends',
      'Never expires'
    ],
    badge: 'Bulk Discount',
    savings: 'Save $355'
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
