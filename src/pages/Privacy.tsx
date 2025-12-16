import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function Privacy() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 py-16">
        <div className="container max-w-4xl">
          <Link 
            to="/" 
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
          
          <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
          <p className="text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          
          <div className="prose prose-invert max-w-none space-y-8">
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">1. Introduction</h2>
              <p className="text-muted-foreground leading-relaxed">
                Resume Booster ("we," "us," or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our resume analysis service ("Service"). By using the Service, you consent to the data practices described in this policy. If you do not agree with our policies and practices, please do not use the Service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">2. Information We Collect</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">We collect the following categories of information:</p>
              
              <h3 className="text-xl font-medium mb-3 text-foreground">2.1 Information You Provide</h3>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
                <li><strong className="text-foreground">Resume Content:</strong> The text and information contained in resumes you upload (PDF, DOCX, or text format). <strong className="text-primary">Important: We do not store your resume content.</strong> Your resume is processed in real-time to generate your analysis and is immediately discarded afterward.</li>
                <li><strong className="text-foreground">LinkedIn Profile Data:</strong> Professional information you provide via URL scraping or direct text input. This data is also processed in real-time and not stored.</li>
                <li><strong className="text-foreground">Email Address:</strong> If you opt to receive your analysis via email</li>
                <li><strong className="text-foreground">Payment Information:</strong> Processed by Stripe; we receive confirmation of payment but do not store full credit card numbers</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 text-foreground">2.2 Automatically Collected Information</h3>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Device Information:</strong> Browser type, operating system, device identifiers</li>
                <li><strong className="text-foreground">Usage Data:</strong> Pages visited, time spent, features used, click patterns</li>
                <li><strong className="text-foreground">Log Data:</strong> IP address, access times, referring URLs, error logs</li>
                <li><strong className="text-foreground">Cookies:</strong> Session and functionality cookies (see Section 9)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">3. Legal Basis for Processing (GDPR)</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">For users in the European Economic Area (EEA), we process your data based on:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Contract Performance:</strong> Processing necessary to provide the Service you purchased</li>
                <li><strong className="text-foreground">Legitimate Interests:</strong> Improving our Service, preventing fraud, ensuring security</li>
                <li><strong className="text-foreground">Legal Obligation:</strong> Compliance with applicable laws and regulations</li>
                <li><strong className="text-foreground">Consent:</strong> Where you have given explicit consent for specific processing activities</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">4. How We Use Your Information</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">We use collected information for:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li>Providing and delivering resume analysis services</li>
                <li>Processing payments and preventing fraud</li>
                <li>Sending analysis results and transactional communications</li>
                <li>Improving and optimizing our Service and AI algorithms</li>
                <li>Responding to inquiries and providing customer support</li>
                <li>Complying with legal obligations</li>
                <li>Enforcing our Terms of Service</li>
                <li>Analyzing usage patterns to improve user experience</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">5. Data Sharing and Disclosure</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                <strong className="text-foreground">We do not sell your personal information.</strong> We may share data with:
              </p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Service Providers:</strong> Third parties that help operate our Service:
                  <ul className="list-disc pl-6 mt-2 space-y-1">
                    <li>Stripe (payment processing)</li>
                    <li>AI service providers (resume analysis)</li>
                    <li>Resend (email delivery)</li>
                    <li>Cloud hosting providers</li>
                  </ul>
                </li>
                <li><strong className="text-foreground">Legal Requirements:</strong> When required by law, court order, or governmental authority</li>
                <li><strong className="text-foreground">Protection of Rights:</strong> To protect our rights, privacy, safety, or property</li>
                <li><strong className="text-foreground">Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
                <li><strong className="text-foreground">With Your Consent:</strong> For any other purpose with your explicit consent</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">6. Data Retention</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">We retain your information as follows:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Resume and LinkedIn Content:</strong> <strong className="text-primary">Not retained.</strong> Your resume and LinkedIn data are processed in real-time and immediately discarded. We do not store your original resume content.</li>
                <li><strong className="text-foreground">Analysis Results:</strong> The AI-generated feedback and suggestions (not your original resume) may be retained to allow access via shareable links, unless you request deletion</li>
                <li><strong className="text-foreground">Payment Records:</strong> Retained as required by tax and financial regulations (typically 7 years)</li>
                <li><strong className="text-foreground">Email Address:</strong> If provided, retained only as needed for sending your analysis results</li>
                <li><strong className="text-foreground">Log Data:</strong> Retained for up to 90 days for security and debugging purposes</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">7. Your Rights and Choices</h2>
              
              <h3 className="text-xl font-medium mb-3 text-foreground">7.1 All Users</h3>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
                <li>Access your personal data</li>
                <li>Request deletion of your data</li>
                <li>Opt out of marketing communications</li>
                <li>Request a copy of your data in portable format</li>
              </ul>

              <h3 className="text-xl font-medium mb-3 text-foreground">7.2 EEA/UK Users (GDPR Rights)</h3>
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

              <h3 className="text-xl font-medium mb-3 text-foreground">7.3 California Residents (CCPA Rights)</h3>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Right to Know:</strong> Request disclosure of personal information collected</li>
                <li><strong className="text-foreground">Right to Delete:</strong> Request deletion of personal information</li>
                <li><strong className="text-foreground">Right to Opt-Out:</strong> Opt out of sale of personal information (we do not sell data)</li>
                <li><strong className="text-foreground">Right to Non-Discrimination:</strong> Not receive discriminatory treatment for exercising rights</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">8. Data Security</h2>
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

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">9. Cookies and Tracking Technologies</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">We use cookies and similar technologies for:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Essential Cookies:</strong> Required for Service functionality (session management, security)</li>
                <li><strong className="text-foreground">Analytics Cookies:</strong> Help us understand how users interact with the Service</li>
                <li><strong className="text-foreground">Preference Cookies:</strong> Remember your settings and preferences</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                You can control cookies through your browser settings. Disabling certain cookies may affect Service functionality.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">10. International Data Transfers</h2>
              <p className="text-muted-foreground leading-relaxed">
                Your information may be transferred to and processed in countries other than your country of residence, including the United States. These countries may have different data protection laws. We ensure appropriate safeguards are in place for such transfers, including Standard Contractual Clauses approved by the European Commission where applicable.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">11. Third-Party Services</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">Our Service integrates with third-party services with their own privacy policies:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Stripe:</strong> <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">stripe.com/privacy</a></li>
                <li><strong className="text-foreground">Resend:</strong> <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">resend.com/legal/privacy-policy</a></li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                We encourage you to review the privacy policies of these third-party services.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">12. Children's Privacy</h2>
              <p className="text-muted-foreground leading-relaxed">
                Our Service is not intended for individuals under 18 years of age. We do not knowingly collect personal information from children. If you are a parent or guardian and believe your child has provided us with personal information, please contact us immediately. If we become aware that we have collected personal information from a child without parental consent, we will take steps to delete that information.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">13. Do Not Track Signals</h2>
              <p className="text-muted-foreground leading-relaxed">
                Some browsers have a "Do Not Track" feature that signals websites not to track browsing activity. Our Service does not currently respond to Do Not Track signals, as there is no consistent industry standard for compliance.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">14. Changes to This Privacy Policy</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may update this Privacy Policy from time to time. We will notify you of material changes by posting the new policy on this page and updating the "Last updated" date. For significant changes, we may provide additional notice (such as email notification). Your continued use of the Service after changes constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">15. Data Protection Officer</h2>
              <p className="text-muted-foreground leading-relaxed">
                For questions about this Privacy Policy, to exercise your data rights, or for privacy-related concerns, please contact our Data Protection team at: <a href="mailto:privacy@resumebooster.com" className="text-primary hover:underline">privacy@resumebooster.com</a>
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">16. Additional Information for Specific Jurisdictions</h2>
              
              <h3 className="text-xl font-medium mb-3 text-foreground">16.1 European Economic Area</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                If you are located in the EEA, our legal basis for collecting and using personal information depends on the data concerned and the context. We will only process personal data where we have a valid legal basis.
              </p>

              <h3 className="text-xl font-medium mb-3 text-foreground">16.2 California</h3>
              <p className="text-muted-foreground leading-relaxed mb-4">
                California Civil Code Section 1798.83 permits California residents to request information regarding disclosure of personal information to third parties for direct marketing purposes. We do not disclose personal information to third parties for their direct marketing purposes.
              </p>

              <h3 className="text-xl font-medium mb-3 text-foreground">16.3 Nevada</h3>
              <p className="text-muted-foreground leading-relaxed">
                Nevada residents may opt out of the sale of personal information. We do not currently sell personal information as defined under Nevada law.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">17. Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed">
                For any questions or concerns regarding this Privacy Policy or our data practices, please contact us at:
              </p>
              <div className="mt-4 p-4 bg-muted/10 rounded-lg border border-border">
                <p className="text-muted-foreground">
                  <strong className="text-foreground">Resume Booster</strong><br />
                  Email: <a href="mailto:privacy@resumebooster.com" className="text-primary hover:underline">privacy@resumebooster.com</a>
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
