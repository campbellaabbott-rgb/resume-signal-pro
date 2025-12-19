// Product configuration with Stripe price IDs
// All products are one-time purchases (no auth required)

export const PRODUCTS = {
  // Current products
  fullAnalysis: {
    id: 'full_analysis',
    name: 'Full Resume Analysis',
    description: 'Comprehensive AI-powered resume analysis with ATS optimization',
    priceUsd: 25,
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
    name: 'Scan Pack (30 Credits)',
    description: '30 additional resume scans with unlimited job comparisons',
    priceUsd: 29,
    priceId: 'price_1SfqT8HBplUUV1Cg3McLmgI7',
    credits: 30,
    features: [
      '30 resume scans',
      'Unlimited job comparisons',
      'Never expires'
    ]
  },

  // New products
  basicKeywordFix: {
    id: 'basic_keyword_fix',
    name: 'Basic Keyword Fix',
    description: 'Quick keyword optimization suggestions',
    priceUsd: 10,
    priceId: 'price_1SgD9THBplUUV1CgSf9yWydz',
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
    priceUsd: 12,
    priceId: 'price_1SgD8oHBplUUV1Cgpbhi1ujj',
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
    priceUsd: 59,
    priceId: 'price_1SgD7FHBplUUV1CgMvN7VSxb',
    features: [
      'Everything in Full Analysis',
      'AI-rewritten resume (ATS-optimized)',
      'Custom cover letter',
      'Before/after comparison',
      'Priority processing'
    ],
    badge: 'Best Value',
    savings: 'Save $28'
  },
  careerBundle: {
    id: 'career_bundle',
    name: 'Career Bundle (10 Analyses)',
    description: '10 full resume analyses - Save $100',
    priceUsd: 150,
    priceId: 'price_1SgD9rHBplUUV1CgtvpDTTEv',
    credits: 10,
    features: [
      '10 full resume analyses',
      'Use for multiple jobs',
      'Share with friends',
      'Never expires'
    ],
    badge: 'Bulk Discount',
    savings: 'Save $100'
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
