import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { 
  Download, 
  Copy, 
  Image as ImageIcon, 
  Mail, 
  Check, 
  ExternalLink,
  Palette,
  FileText
} from 'lucide-react';

import bannerLeaderboard from '@/assets/banners/banner-leaderboard.png';
import bannerSquare from '@/assets/banners/banner-square.png';
import bannerSkyscraper from '@/assets/banners/banner-skyscraper.png';

interface MarketingKitProps {
  referralLink: string;
  referralCode: string;
}

interface BannerAsset {
  id: string;
  name: string;
  dimensions: string;
  description: string;
  src: string;
  aspectRatio: string;
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  useCase: string;
}

const bannerAssets: BannerAsset[] = [
  {
    id: 'leaderboard',
    name: 'Leaderboard Banner',
    dimensions: '728 × 90',
    description: 'Perfect for website headers and footers',
    src: bannerLeaderboard,
    aspectRatio: '728/90',
  },
  {
    id: 'square',
    name: 'Square Banner',
    dimensions: '300 × 250',
    description: 'Great for sidebars and social media',
    src: bannerSquare,
    aspectRatio: '1/1',
  },
  {
    id: 'skyscraper',
    name: 'Skyscraper Banner',
    dimensions: '160 × 600',
    description: 'Ideal for sidebar placements',
    src: bannerSkyscraper,
    aspectRatio: '160/600',
  },
];

const emailTemplates: EmailTemplate[] = [
  {
    id: 'introduction',
    name: 'Introduction Email',
    subject: 'Is Your Resume Getting Past the ATS?',
    useCase: 'First outreach to your network',
    body: `Hi [Name],

I recently discovered an amazing tool that scans your resume against ATS (Applicant Tracking Systems) - the software that 75% of companies use to filter candidates before a human ever sees their application.

Most people don't realize their resume is getting rejected by robots, not recruiters!

You can get a FREE scan here: {{REFERRAL_LINK}}

It takes 30 seconds and shows you exactly what's wrong with your resume formatting, keywords, and structure.

I thought of you because [personalize: you mentioned job hunting / you're in a competitive field / etc].

Let me know what you think!

Best,
[Your Name]`,
  },
  {
    id: 'job-seeker',
    name: 'Job Seeker Outreach',
    subject: 'Quick tip for your job search',
    useCase: 'For friends/connections actively job hunting',
    body: `Hey [Name],

I know you've been looking for a new [role type] position, and I wanted to share something that might help.

Did you know that over 70% of resumes never get seen by a human? They get filtered out by ATS software before recruiters even look at them.

There's a free tool that scans your resume and tells you exactly how to fix it: {{REFERRAL_LINK}}

It literally takes 30 seconds and could be the difference between getting interviews and getting ghosted.

Worth checking out!

[Your Name]`,
  },
  {
    id: 'linkedin-post',
    name: 'LinkedIn Post',
    subject: 'LinkedIn Post Template',
    useCase: 'Share on LinkedIn to reach your network',
    body: `🚨 Job seekers: Your resume might be getting rejected before a human ever sees it.

Here's the reality:
• 75% of resumes are filtered out by ATS software
• Most people have no idea their formatting is wrong
• Simple fixes can 3x your interview rate

I found a free tool that scans your resume in 30 seconds and shows you exactly what to fix: {{REFERRAL_LINK}}

If you're job hunting (or know someone who is), this is worth 30 seconds of your time.

#jobsearch #careeradvice #resume #ats`,
  },
  {
    id: 'newsletter',
    name: 'Newsletter Mention',
    subject: 'Resume Tool Recommendation',
    useCase: 'For newsletter creators and bloggers',
    body: `**Tool of the Week: Free ATS Resume Scanner**

If you're applying to jobs online, there's a 75% chance your resume is being filtered by ATS (Applicant Tracking System) software before a human ever sees it.

I've been recommending this free scanner to readers, and the feedback has been incredible:

→ Get your free scan: {{REFERRAL_LINK}}

**What it does:**
- Analyzes your resume against real ATS algorithms
- Identifies formatting issues that cause rejection
- Suggests missing keywords for your industry
- Takes 30 seconds (seriously)

**Why I recommend it:**
Unlike other tools that just give you a score, this one actually tells you HOW to fix the problems. The free version is genuinely useful.

Try it out and let me know what you think!`,
  },
  {
    id: 'twitter',
    name: 'Twitter/X Thread',
    subject: 'Twitter Thread Template',
    useCase: 'Share as a Twitter/X thread',
    body: `🧵 Your resume is probably getting rejected by robots. Here's how to fix it (free):

1/ Over 75% of resumes never reach a human. They're filtered out by ATS (Applicant Tracking Systems).

2/ The worst part? Most people have no idea. They think they're getting rejected by recruiters when they're actually getting rejected by software.

3/ Common ATS killers:
• Wrong file format
• Fancy fonts/graphics
• Missing keywords
• Poor section headers
• Tables and columns

4/ I found a free tool that scans your resume in 30 seconds and tells you exactly what to fix:

{{REFERRAL_LINK}}

5/ It shows you:
✓ Your ATS compatibility score
✓ Missing keywords for your industry
✓ Formatting issues to fix
✓ Section-by-section breakdown

6/ If you're job hunting or know someone who is, this could literally be the difference between interviews and silence.

Bookmark this. You'll need it.`,
  },
];

export function MarketingKit({ referralLink, referralCode }: MarketingKitProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyText = (text: string, id: string, label: string) => {
    const processedText = text.replace(/{{REFERRAL_LINK}}/g, referralLink);
    navigator.clipboard.writeText(processedText);
    setCopiedId(id);
    toast.success(`${label} copied to clipboard!`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownloadBanner = async (banner: BannerAsset) => {
    try {
      const response = await fetch(banner.src);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `affiliate-${banner.id}-${referralCode}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success(`${banner.name} downloaded!`);
    } catch (error) {
      toast.error('Failed to download banner');
    }
  };

  const handleCopyHtmlEmbed = (banner: BannerAsset) => {
    const html = `<a href="${referralLink}" target="_blank" rel="noopener">
  <img src="${window.location.origin}${banner.src}" alt="Resume ATS Scanner" style="max-width: 100%; height: auto;" />
</a>`;
    navigator.clipboard.writeText(html);
    toast.success('HTML embed code copied!');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          Marketing Kit
        </CardTitle>
        <CardDescription>
          Download banners and copy email templates to promote your affiliate link
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="banners" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="banners" className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Banners
            </TabsTrigger>
            <TabsTrigger value="emails" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email Templates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="banners" className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Download high-quality banners to use on your website, blog, or social media. 
              Your referral code is automatically included in tracking.
            </p>
            
            <div className="grid gap-6">
              {bannerAssets.map((banner) => (
                <div 
                  key={banner.id} 
                  className="border rounded-lg p-4 space-y-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="font-medium">{banner.name}</h4>
                      <p className="text-sm text-muted-foreground">{banner.description}</p>
                      <Badge variant="secondary" className="mt-1">
                        {banner.dimensions}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => handleCopyHtmlEmbed(banner)}
                      >
                        <Copy className="h-4 w-4 mr-1" />
                        HTML
                      </Button>
                      <Button 
                        size="sm"
                        onClick={() => handleDownloadBanner(banner)}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                  
                  <div className="bg-muted/30 rounded-lg p-4 flex justify-center">
                    <img 
                      src={banner.src} 
                      alt={banner.name}
                      className="max-w-full h-auto max-h-48 object-contain rounded"
                      style={{ aspectRatio: banner.aspectRatio }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-primary/5 rounded-lg p-4 mt-4">
              <h4 className="font-medium flex items-center gap-2 mb-2">
                <ExternalLink className="h-4 w-4" />
                Usage Tips
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Always link banners to your referral URL: <code className="bg-background px-1 rounded text-xs">{referralLink}</code></li>
                <li>• Use the HTML embed code for easy integration</li>
                <li>• Banners work best on career-related content</li>
              </ul>
            </div>
          </TabsContent>

          <TabsContent value="emails" className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Copy these proven email templates to share with your network. 
              Your referral link is automatically inserted when you copy.
            </p>

            <div className="space-y-4">
              {emailTemplates.map((template) => (
                <div 
                  key={template.id}
                  className="border rounded-lg overflow-hidden"
                >
                  <div className="bg-muted/30 px-4 py-3 flex items-center justify-between">
                    <div>
                      <h4 className="font-medium flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        {template.name}
                      </h4>
                      <p className="text-xs text-muted-foreground">{template.useCase}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopyText(template.subject, `subject-${template.id}`, 'Subject line')}
                      >
                        {copiedId === `subject-${template.id}` ? (
                          <Check className="h-4 w-4 mr-1 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4 mr-1" />
                        )}
                        Subject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleCopyText(template.body, `body-${template.id}`, 'Email template')}
                      >
                        {copiedId === `body-${template.id}` ? (
                          <Check className="h-4 w-4 mr-1 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4 mr-1" />
                        )}
                        Copy All
                      </Button>
                    </div>
                  </div>
                  
                  <div className="p-4">
                    <div className="mb-2">
                      <span className="text-xs font-medium text-muted-foreground">Subject:</span>
                      <p className="text-sm font-medium">{template.subject}</p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted-foreground">Body:</span>
                      <pre className="text-xs bg-muted/30 p-3 rounded-lg mt-1 whitespace-pre-wrap font-sans max-h-48 overflow-y-auto">
                        {template.body.replace(/{{REFERRAL_LINK}}/g, referralLink)}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-primary/5 rounded-lg p-4">
              <h4 className="font-medium flex items-center gap-2 mb-2">
                <Mail className="h-4 w-4" />
                Pro Tips
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Personalize the [brackets] before sending</li>
                <li>• Your referral link is already inserted in all templates</li>
                <li>• LinkedIn posts typically get 2-3x more engagement than emails</li>
                <li>• Best times to post: Tuesday-Thursday, 9-11am or 5-7pm</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
