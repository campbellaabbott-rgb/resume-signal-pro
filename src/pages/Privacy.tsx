import { Header } from "@/components/Header";
import { SEO } from "@/components/seo/SEO";
import { Footer } from "@/components/Footer";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SellerIdentity } from "@/components/SellerIdentity";
import { AI_CACHE_MAX_HOURS, SHARED_ANALYSIS_DAYS } from "@/lib/resume-retention";
import { PRIVACY_LAST_UPDATED } from "@/config/seller";
import { MCP_PRIVACY_ROWS } from "@/config/mcp-privacy";
import { openConsentChoice } from "@/components/ConsentBanner";

export default function Privacy() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'es' ? 'es-ES' : i18n.language === 'hi' ? 'hi-IN' : i18n.language === 'tl' ? 'fil-PH' : 'en-US';
  
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO title="Privacy Policy — Resume Booster" description="How Resume Booster handles your resume data, retention windows, and your privacy rights." path="/privacy" />
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
          
          <h1 className="text-4xl font-bold mb-8">{t('privacy.title')}</h1>
          <p className="text-muted-foreground mb-4">{t('common.lastUpdated')}: {new Date(`${PRIVACY_LAST_UPDATED}T12:00:00Z`).toLocaleDateString(dateLocale, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</p>
          <SellerIdentity variant="privacy" className="text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground/80 mb-8 italic">{t('privacy.legalNotice')}</p>

          <div className="prose prose-invert max-w-none space-y-8">
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.introduction')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                Resume Booster ("we," "us," or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our resume analysis service ("Service"). By using the Service, you consent to the data practices described in this policy. If you do not agree with our policies and practices, please do not use the Service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.infoCollected')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">We collect the following categories of information:</p>
              
              <h3 className="text-xl font-medium mb-3 text-foreground">{t('privacy.sections.infoProvide')}</h3>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
                <li><strong className="text-foreground">Resume Content:</strong> The text and information contained in resumes you upload or paste (PDF, DOCX, or text format). How long each copy is kept is set out in Section 6 and, store by store, on our <Link to="/trust#retention" className="text-primary underline">Trust page</Link>. In short: the text is held for 24 hours and the free report that quotes it for 7 days, then both are deleted; a resume is kept longer only when you save it to your account.</li>
                <li><strong className="text-foreground">Text You Add:</strong> A job description or other text you paste beside a resume. It is held with the resume in the same temporary store, for the same 24 hours.</li>
                <li><strong className="text-foreground">Email Address:</strong> When you create an account, ask for a report or a purchase by email, or join a mailing list</li>
                <li><strong className="text-foreground">Payment Information:</strong> Processed by Stripe; we receive confirmation of payment but do not store full credit card numbers</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 text-foreground">{t('privacy.sections.infoAuto')}</h3>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Device Information:</strong> Browser type, operating system, device identifiers</li>
                <li><strong className="text-foreground">Usage Data:</strong> Pages visited, time spent, features used, click patterns</li>
                <li><strong className="text-foreground">Log Data:</strong> IP address, access times, referring URLs, error logs</li>
                <li><strong className="text-foreground">Cookies and Browser Storage:</strong> What keeps you signed in and remembers your settings, and, only if you allow it, an analytics visitor id (see the Cookies section)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.legalBasis')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">For users in the European Economic Area (EEA), we process your data based on:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Contract Performance:</strong> Processing necessary to provide the Service you purchased</li>
                <li><strong className="text-foreground">Legitimate Interests:</strong> Improving our Service, preventing fraud, ensuring security</li>
                <li><strong className="text-foreground">Legal Obligation:</strong> Compliance with applicable laws and regulations</li>
                <li><strong className="text-foreground">Consent:</strong> Where you have given explicit consent for specific processing activities</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.howWeUse')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">We use collected information for:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li>Providing and delivering resume analysis services</li>
                <li>Processing payments and preventing fraud</li>
                <li>Sending analysis results and transactional communications</li>
                <li>Improving our Service. We do not train AI models on your resume; the AI providers that process it for us do so under their own terms (see Sharing)</li>
                <li>Responding to inquiries and providing customer support</li>
                <li>Complying with legal obligations</li>
                <li>Enforcing our Terms of Service</li>
                <li>Analyzing usage patterns to improve user experience, only if you allow analytics</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.sharing')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                <strong className="text-foreground">We do not sell your personal information.</strong> We may share data with:
              </p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Service Providers:</strong> Third parties that help operate our Service:
                  <ul className="list-disc pl-6 mt-2 space-y-1" data-processors>
                    <li>Stripe (payment processing)</li>
                    <li>Lovable (hosting, and the AI gateway our analysis runs through); its cloud runs on Supabase (database, sign-in and server functions)</li>
                    <li>Google and OpenAI, whose AI models analyze resume text, reached through Lovable's AI gateway</li>
                    <li>Lovable Emails, which sends sign-in emails through Mailgun from the EU</li>
                    <li>Resend (receipts, reports and our other email, from the United States)</li>
                    <li>ipinfo (the country of the IP address a free scan comes from, to set its limits)</li>
                    <li>Google Fonts (your browser loads the site's fonts from Google, which sees your IP address)</li>
                  </ul>
                </li>
                <li><strong className="text-foreground">Shortlist:</strong> An employer who screens candidates with Shortlist uploads their resumes and confirms, for each one, that they may have it scored by AI. We remove protected-class proxies before scoring, keep the redacted text and the evaluation for that employer until they delete the role or their account, and record no candidate's sex or race</li>
                <li><strong className="text-foreground">Legal Requirements:</strong> When required by law, court order, or governmental authority</li>
                <li><strong className="text-foreground">Protection of Rights:</strong> To protect our rights, privacy, safety, or property</li>
                <li><strong className="text-foreground">Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
                <li><strong className="text-foreground">With Your Consent:</strong> For any other purpose with your explicit consent</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.retention')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">We retain your information as follows:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Resume Content:</strong> Held in a private temporary store for 24 hours after you upload or paste it, so a checkout can use it, then deleted automatically.</li>
                <li><strong className="text-foreground">Free Reports:</strong> A free report quotes lines from your resume, including its first ~600 characters. It is cached for 7 days under a one-way fingerprint of the text, so a rescan of the same file against the same posting gets the same report, then deleted automatically. The fingerprint and the industry detected are kept so a rescan reads the same industry; the fingerprint cannot be turned back into your resume.</li>
                <li><strong className="text-foreground">Cached AI Output:</strong> The AI-written summary at the top of a free report, and a report written by our backup scanner, are cached for up to {AI_CACHE_MAX_HOURS} hours under a one-way fingerprint of the text, then deleted automatically. A paid analysis is never cached.</li>
                <li><strong className="text-foreground">Analysis Results:</strong> A paid analysis, which quotes your resume, is kept behind its private share link for {SHARED_ANALYSIS_DAYS} days and then deleted automatically, or sooner if you delete it from the results page; that link is its only copy on our servers, apart from any copy emailed to you. Documents generated for other paid products are kept with your purchase record so you can recover them, until you ask us to erase them.</li>
                <li><strong className="text-foreground">Account Content:</strong> A resume version you save, the resume you set for job matching, any CV file you uploaded, your saved searches and alerts and your tracked applications are kept until you delete your account. Deleting your account erases them all, including the uploaded CV files, and revokes any API or connected-AI key the account created.</li>
                <li><strong className="text-foreground">Proof of Your Address:</strong> When you sign in with a code or link we email you, or with a provider that verified your address, we record that the address was proven, so purchases made under it can join your account. The record is kept until you delete your account.</li>
                <li><strong className="text-foreground">Payment Records:</strong> The Stripe reference, amount, date and the address on the receipt, retained as required by tax and financial regulations (typically 7 years), including after an account is deleted</li>
                <li><strong className="text-foreground">Email Address and Mail:</strong> The monthly market pulse keeps your address until you unsubscribe. We keep a record of each email we send (the address, the time and whether it was delivered) to show delivery and to honour unsubscribes, and a do-not-mail note after you unsubscribe or delete your account, so that no mail already queued reaches you</li>
                <li><strong className="text-foreground">Log Data:</strong> Retained for up to 90 days for security and debugging purposes</li>
                <li><strong className="text-foreground">In Your Browser:</strong> The resume text a tab carries between pages is in that tab's session storage until you close it. A resume you build on the site, your recent scan history and recent reports are in this browser's local storage until it is cleared; the Clear Browser Data button on a paid results page clears them, as does clearing this site's data in your browser.</li>
              </ul>
            </section>

            {/* DRAFT FOR COUNSEL REVIEW (owner action 9, connect spec §3.8): the
                section below states what each way of reaching us from an AI
                receives and stores. The rows are src/config/mcp-privacy.ts,
                the one table the tool descriptions and the directory answers
                are drawn from too. Counsel must approve the wording before
                the address on our own domain publishes; until then it is the
                engineering statement of fact, kept true by the guard that
                reads this table. Nothing in the visible copy says "draft". */}
            <section data-privacy-mcp>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.mcp', 'Using Resume Booster from your own AI')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                You can connect Resume Booster to Claude, ChatGPT or Claude Code through our MCP server, or call our data API with a key. Your AI provider's own privacy policy covers your conversation with it; we never receive your chat history. This table sets out what reaches us from your AI, and what we keep.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-muted-foreground border-collapse">
                  <thead>
                    <tr className="border-b border-border text-foreground">
                      <th className="py-2 pr-3 font-medium align-top">What</th>
                      <th className="py-2 pr-3 font-medium align-top">From Claude and other connections</th>
                      <th className="py-2 pr-3 font-medium align-top">From ChatGPT</th>
                      <th className="py-2 font-medium align-top">What we keep</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MCP_PRIVACY_ROWS.map((r) => (
                      <tr key={r.id} data-privacy-row={r.id} className="border-b border-border align-top">
                        <td className="py-2 pr-3 text-foreground">{r.what}</td>
                        <td className="py-2 pr-3">{r.claude}</td>
                        <td className="py-2 pr-3">{r.chatgpt}</td>
                        <td className="py-2">{r.kept}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Resume Booster never submits a job application for you. When your AI helps you apply, it reads the posting and, for some hiring systems, the employer's published application form; you fill in and send the employer's form yourself.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.rights')}</h2>
              
              <h3 className="text-xl font-medium mb-3 text-foreground">{t('privacy.sections.rightsAll')}</h3>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
                <li>Access your personal data</li>
                <li>Request deletion of your data</li>
                <li>Opt out of marketing communications</li>
                <li>Request a copy of your data in portable format</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 text-foreground">{t('privacy.sections.rightsGdpr')}</h3>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
                <li><strong className="text-foreground">Right to Access:</strong> Request copies of your personal data</li>
                <li><strong className="text-foreground">Right to Rectification:</strong> Request correction of inaccurate data</li>
                <li><strong className="text-foreground">Right to Erasure:</strong> Request deletion of your data ("right to be forgotten")</li>
                <li><strong className="text-foreground">Right to Restrict Processing:</strong> Request limitation of data processing</li>
                <li><strong className="text-foreground">Right to Data Portability:</strong> Receive data in a machine-readable format</li>
                <li><strong className="text-foreground">Right to Object:</strong> Object to processing based on legitimate interests</li>
                <li><strong className="text-foreground">Right to Withdraw Consent:</strong> Withdraw consent at any time</li>
                <li><strong className="text-foreground">Right to Lodge a Complaint:</strong> File a complaint with a supervisory authority</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 text-foreground">{t('privacy.sections.rightsCcpa')}</h3>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Right to Know:</strong> Request disclosure of personal information collected</li>
                <li><strong className="text-foreground">Right to Delete:</strong> Request deletion of personal information</li>
                <li><strong className="text-foreground">Right to Opt-Out:</strong> Opt out of sale of personal information (we do not sell data)</li>
                <li><strong className="text-foreground">Right to Non-Discrimination:</strong> Not receive discriminatory treatment for exercising rights</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.security')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We implement appropriate technical and organizational security measures to protect your information, including:
              </p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li>Encryption of data in transit (TLS/SSL) and at rest</li>
                <li>Secure cloud infrastructure with access controls</li>
                <li>Regular security assessments and monitoring</li>
                <li>Limited employee access on a need-to-know basis</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to protect your information, we cannot guarantee absolute security.
              </p>
            </section>

            <section id="cookies" className="scroll-mt-24">
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.cookies')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">We use cookies and this browser's storage for:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Essential:</strong> keeping you signed in, security, and the choice you make below</li>
                <li><strong className="text-foreground">Preferences:</strong> remembering your settings, recent searches and the resumes and reports you keep in this browser</li>
                <li><strong className="text-foreground">Analytics, only if you allow it:</strong> an anonymous visitor id kept in this browser, and a record of which pages and steps you use. Until you choose, nothing is stored or sent for analytics; choosing no removes the id</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Our hosting provider runs its own page-visit counter, which this choice does not control.
              </p>
              <button type="button" onClick={openConsentChoice} className="mt-4 text-primary underline" data-change-consent>
                {t('privacy.changeConsent', 'Change my analytics choice')}
              </button>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.international')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                Your information may be transferred to and processed in countries other than your country of residence, including the United States. These countries may have different data protection laws. We ensure appropriate safeguards are in place for such transfers, including Standard Contractual Clauses approved by the European Commission where applicable.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.thirdParty')}</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">Our Service integrates with third-party services with their own privacy policies:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Stripe:</strong> <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">stripe.com/privacy</a></li>
                <li><strong className="text-foreground">Resend:</strong> <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">resend.com/legal/privacy-policy</a></li>
                <li><strong className="text-foreground">Supabase:</strong> <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">supabase.com/privacy</a></li>
                <li><strong className="text-foreground">Google (AI models and fonts):</strong> <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">policies.google.com/privacy</a></li>
                <li><strong className="text-foreground">OpenAI:</strong> <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">openai.com/policies/privacy-policy</a></li>
                <li><strong className="text-foreground">Lovable, Mailgun and ipinfo:</strong> each publishes its own privacy policy on its website</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                We encourage you to review the privacy policies of these third-party services.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.children')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                Our Service is not intended for individuals under 18 years of age. We do not knowingly collect personal information from children. If you are a parent or guardian and believe your child has provided us with personal information, please contact us immediately. If we become aware that we have collected personal information from a child without parental consent, we will take steps to delete that information.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.doNotTrack')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                Some browsers have a "Do Not Track" feature that signals websites not to track browsing activity. Our Service does not currently respond to Do Not Track signals, as there is no consistent industry standard for compliance.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.changes')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may update this Privacy Policy from time to time. We will notify you of material changes by posting the new policy on this page and updating the "Last updated" date. For significant changes, we may provide additional notice (such as email notification). Your continued use of the Service after changes constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.dpo')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                For questions about this Privacy Policy, to exercise your data rights, or for privacy-related concerns, please contact our Data Protection team at: <a href="mailto:resumeboostersupp@gmail.com" className="text-primary hover:underline">resumeboostersupp@gmail.com</a>
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.jurisdictions')}</h2>
              
              <h3 className="text-xl font-medium mb-3 text-foreground">{t('privacy.sections.jurisdictionsEea')}</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                If you are located in the EEA, our legal basis for collecting and using personal information depends on the data concerned and the context. We will only process personal data where we have a valid legal basis.
              </p>

              <h3 className="text-xl font-medium mb-3 text-foreground">{t('privacy.sections.jurisdictionsCa')}</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                California Civil Code Section 1798.83 permits California residents to request information regarding disclosure of personal information to third parties for direct marketing purposes. We do not disclose personal information to third parties for their direct marketing purposes.
              </p>

              <h3 className="text-xl font-medium mb-3 text-foreground">{t('privacy.sections.jurisdictionsNv')}</h3>
              <p className="text-muted-foreground leading-relaxed">
                Nevada residents may opt out of the sale of personal information. We do not currently sell personal information as defined under Nevada law.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">{t('privacy.sections.contactUs')}</h2>
              <p className="text-muted-foreground leading-relaxed">
                For any questions or concerns regarding this Privacy Policy or our data practices, please contact us at:
              </p>
              <div className="mt-4 p-4 bg-muted/10 rounded-lg border border-border">
                <p className="text-muted-foreground">
                  <strong className="text-foreground">Resume Booster</strong><br />
                  Email: <a href="mailto:resumeboostersupp@gmail.com" className="text-primary hover:underline">resumeboostersupp@gmail.com</a>
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
