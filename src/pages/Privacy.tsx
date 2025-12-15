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
              <h2 className="text-2xl font-semibold mb-4 text-foreground">1. Information We Collect</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">We collect the following types of information:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Resume Content:</strong> The text and information contained in resumes you upload for analysis</li>
                <li><strong className="text-foreground">LinkedIn Data:</strong> Profile information you choose to provide via URL or text input</li>
                <li><strong className="text-foreground">Payment Information:</strong> Processed securely by Stripe; we do not store your full payment details</li>
                <li><strong className="text-foreground">Email Address:</strong> If you choose to receive your analysis via email</li>
                <li><strong className="text-foreground">Usage Data:</strong> How you interact with our Service</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">2. How We Use Your Information</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">We use collected information to:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li>Provide resume analysis services</li>
                <li>Process payments</li>
                <li>Send analysis results via email (if requested)</li>
                <li>Improve our Service and AI algorithms</li>
                <li>Communicate with you about your analysis</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">3. Data Storage and Security</h2>
              <p className="text-muted-foreground leading-relaxed">
                Your resume data and analysis results are stored securely in our database. We implement industry-standard security measures to protect your information. Analysis results are accessible via shareable links that you control.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">4. Data Sharing</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">We do not sell your personal information. We may share data with:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Service Providers:</strong> Third parties that help us operate our Service (e.g., Stripe for payments, AI providers for analysis)</li>
                <li><strong className="text-foreground">Legal Requirements:</strong> When required by law or to protect our rights</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">5. Third-Party Services</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">Our Service integrates with:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Stripe:</strong> For secure payment processing. See <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Stripe's Privacy Policy</a></li>
                <li><strong className="text-foreground">AI Services:</strong> For resume analysis processing</li>
                <li><strong className="text-foreground">Resend:</strong> For email delivery of analysis results</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">6. Your Rights</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">You have the right to:</p>
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li>Access your personal data</li>
                <li>Request deletion of your data</li>
                <li>Opt out of marketing communications</li>
                <li>Request a copy of your data</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">7. Data Retention</h2>
              <p className="text-muted-foreground leading-relaxed">
                We retain your resume analysis results to allow continued access via shareable links. You may request deletion of your data at any time by contacting us.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">8. Cookies and Tracking</h2>
              <p className="text-muted-foreground leading-relaxed">
                We use essential cookies to ensure proper functionality of our Service. We may use analytics to understand how users interact with our Service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">9. Children's Privacy</h2>
              <p className="text-muted-foreground leading-relaxed">
                Our Service is not intended for individuals under 16 years of age. We do not knowingly collect personal information from children.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">10. International Data Transfers</h2>
              <p className="text-muted-foreground leading-relaxed">
                Your data may be transferred to and processed in countries other than your own. We ensure appropriate safeguards are in place for such transfers.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">11. Changes to This Policy</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the "Last updated" date.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-4 text-foreground">12. Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed">
                For questions about this Privacy Policy or to exercise your rights, please contact us through our website.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
