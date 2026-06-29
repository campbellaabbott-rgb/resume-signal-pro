import { Header } from "@/components/Header";
import { SEO } from "@/components/seo/SEO";
import { Footer } from "@/components/Footer";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PRODUCTS } from "@/config/products";

export default function Terms() {
  const { t, i18n } = useTranslation();
  const fullAnalysisPrice = `$${PRODUCTS.fullAnalysis.priceUsd.toFixed(2)} USD`;
  const dateLocale = i18n.language === 'es' ? 'es-ES' : i18n.language === 'hi' ? 'hi-IN' : i18n.language === 'tl' ? 'fil-PH' : 'en-US';
  
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO title="Terms of Service — Resume Booster" description="Read the Resume Booster terms governing use of the resume analysis, rewrite, and career tools." path="/terms" />
      <Header />
      <main className="flex-1 py-16">
        <div className="container max-w-4xl">
          <Link 
            to="/" 
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('common.backToHome')}
          </Link>
          
          <h1 className="text-4xl font-bold mb-8">{t('terms.title')}</h1>
          <p className="text-muted-foreground mb-4">{t('common.lastUpdated')}: {new Date().toLocaleDateString(dateLocale, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <p className="text-sm text-muted-foreground/80 mb-8 italic">{t('terms.legalNotice')}</p>

          <div className="prose prose-invert max-w-none space-y-8">
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.acceptance')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                By accessing, browsing, or using Resume Booster ("Service," "we," "us," or "our"), you ("User," "you," or "your") acknowledge that you have read, understood, and agree to be bound by these Terms of Service ("Terms") and our Privacy Policy. If you do not agree to these Terms, you must immediately cease using the Service. Your continued use of the Service constitutes your acceptance of these Terms and any modifications thereto.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.eligibility')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                You must be at least 18 years of age or the age of legal majority in your jurisdiction to use this Service. By using the Service, you represent and warrant that you meet this eligibility requirement and have the legal capacity to enter into these Terms. If you are using the Service on behalf of an organization, you represent and warrant that you have authority to bind that organization to these Terms.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.description')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                Resume Booster provides AI-powered resume analysis services. Our Service analyzes resumes and provides feedback including, but not limited to, ATS optimization suggestions, action verb recommendations, keyword analysis, and other professional insights. The Service is provided for informational and educational purposes only. We do not guarantee employment outcomes, interview invitations, or any specific results from using our analysis.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.payment')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                The Service costs {fullAnalysisPrice} per analysis. Payment is processed securely through Stripe, a third-party payment processor. By making a purchase, you authorize us to charge your payment method for the total amount.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                <strong className="text-foreground">No Refunds:</strong> All sales are final. Due to the immediate delivery of digital analysis results upon payment, refunds are not available except where required by applicable law. By completing a purchase, you acknowledge and agree that you are waiving any right to a refund.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Chargebacks:</strong> Initiating a chargeback or payment dispute without first contacting us may result in permanent suspension of your access to the Service. We reserve the right to dispute any chargeback and provide evidence of service delivery.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.conduct')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">You agree to:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li>Provide accurate and truthful information in your resume</li>
                <li>Use the Service for lawful purposes only</li>
                <li>Not upload content that is illegal, defamatory, obscene, or infringes on third-party rights</li>
                <li>Not attempt to reverse engineer, decompile, or disassemble any part of the Service</li>
                <li>Not use automated scripts, bots, or other means to access the Service</li>
                <li>Not attempt to circumvent any security measures or access restrictions</li>
                <li>Not resell, redistribute, or commercially exploit our analysis services without written consent</li>
                <li>Not upload malicious code, viruses, or any harmful content</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.ip')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                <strong className="text-foreground">Your Content:</strong> You retain all ownership rights to your resume content. By uploading your resume, you grant us a limited, non-exclusive license to process and analyze your content solely for the purpose of providing the Service.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Our Content:</strong> The Service, including its algorithms, software, design, text, graphics, logos, and all other content, is owned by Resume Booster and protected by intellectual property laws. You may not copy, modify, distribute, sell, or lease any part of the Service without our express written permission.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.warranties')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND ACCURACY. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS. WE MAKE NO GUARANTEES REGARDING EMPLOYMENT OUTCOMES, JOB INTERVIEWS, OR ANY SPECIFIC RESULTS FROM USING OUR ANALYSIS. THE SUGGESTIONS PROVIDED ARE AI-GENERATED RECOMMENDATIONS AND SHOULD BE REVIEWED AND ADAPTED ACCORDING TO YOUR SPECIFIC SITUATION AND PROFESSIONAL JUDGMENT.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.liability')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL RESUME BOOSTER, ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, AFFILIATES, OR LICENSORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES, INCLUDING BUT NOT LIMITED TO DAMAGES FOR LOSS OF PROFITS, GOODWILL, USE, DATA, OR OTHER INTANGIBLE LOSSES, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OR INABILITY TO USE THE SERVICE, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY FOR ALL CLAIMS ARISING FROM OR RELATED TO THE SERVICE SHALL NOT EXCEED THE AMOUNT YOU PAID FOR THE SERVICE IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR {fullAnalysisPrice}, WHICHEVER IS GREATER.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.indemnification')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                You agree to indemnify, defend, and hold harmless Resume Booster, its officers, directors, employees, agents, affiliates, and licensors from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or related to: (a) your use of the Service; (b) your violation of these Terms; (c) your violation of any rights of any third party; (d) any content you upload or submit through the Service; or (e) your negligent or wrongful conduct.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.disputes')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                <strong className="text-foreground">Informal Resolution:</strong> Before initiating any formal dispute proceeding, you agree to first contact us and attempt to resolve the dispute informally for at least thirty (30) days.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                <strong className="text-foreground">Binding Arbitration:</strong> If informal resolution fails, any dispute, controversy, or claim arising out of or relating to these Terms or the Service shall be resolved by binding arbitration administered by a mutually agreed-upon arbitration service. The arbitration shall be conducted in English, and the arbitrator's decision shall be final and binding.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Class Action Waiver:</strong> YOU AND RESUME BOOSTER AGREE THAT EACH MAY BRING CLAIMS AGAINST THE OTHER ONLY IN YOUR OR ITS INDIVIDUAL CAPACITY AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS OR REPRESENTATIVE PROCEEDING.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.governingLaw')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to its conflict of law provisions. For any matters not subject to arbitration, you agree to submit to the exclusive jurisdiction of the state and federal courts located in Delaware.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.termination')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                We reserve the right to terminate or suspend your access to the Service immediately, without prior notice or liability, for any reason, including but not limited to a breach of these Terms. Upon termination, your right to use the Service will immediately cease. All provisions of these Terms which by their nature should survive termination shall survive, including ownership provisions, warranty disclaimers, indemnity, and limitations of liability.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.forceMajeure')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                We shall not be liable for any failure or delay in performing our obligations under these Terms due to circumstances beyond our reasonable control, including but not limited to acts of God, natural disasters, war, terrorism, riots, embargoes, acts of civil or military authorities, fire, floods, accidents, strikes, shortages of transportation, facilities, fuel, energy, labor, or materials, or failures of third-party services or infrastructure.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.severability')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                If any provision of these Terms is held to be invalid, illegal, or unenforceable by a court of competent jurisdiction, such invalidity shall not affect the validity of the remaining provisions, which shall remain in full force and effect. The invalid provision shall be modified to the minimum extent necessary to make it valid and enforceable while preserving the parties' original intent.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.entireAgreement')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                These Terms, together with our Privacy Policy and any other legal notices published by us on the Service, constitute the entire agreement between you and Resume Booster concerning the Service and supersede all prior or contemporaneous agreements, representations, warranties, and understandings, whether written or oral.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.waiver')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                No waiver of any term or condition of these Terms shall be deemed a further or continuing waiver of such term or any other term. Our failure to assert any right or provision under these Terms shall not constitute a waiver of such right or provision.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.assignment')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                You may not assign or transfer these Terms or any rights hereunder without our prior written consent. We may assign these Terms without restriction. These Terms shall be binding upon and inure to the benefit of the parties and their respective successors and permitted assigns.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.modifications')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                We reserve the right to modify these Terms at any time in our sole discretion. Changes will be effective immediately upon posting to the Service. We will update the "Last updated" date at the top of these Terms. Your continued use of the Service after any changes constitutes your acceptance of the modified Terms. It is your responsibility to review these Terms periodically.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.privacy')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                Your use of the Service is also governed by our <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>, which is incorporated into these Terms by reference. Please review it to understand how we collect, use, and protect your information.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('terms.sections.contact')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                For questions, concerns, or disputes regarding these Terms of Service, please contact us at: <a href="mailto:resumeboostersupp@gmail.com" className="text-primary hover:underline">resumeboostersupp@gmail.com</a>
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
