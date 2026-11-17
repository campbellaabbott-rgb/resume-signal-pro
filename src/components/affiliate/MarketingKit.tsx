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

interface MarketingKitProps {
  referralLink: string;
  referralCode: string;
}

/**
 * One banner, at the pixel size its files have (S14X-213). The label, the
 * preview, the embed code and the download name are all read from width and
 * height, and the files sit at fixed addresses under public/affiliate/, so a
 * banner an affiliate embeds keeps working when the site is rebuilt (a
 * bundled asset's address carries a content hash and changes with the file).
 * Each size comes as a PNG, for mail and social posts, and as an SVG, which
 * scales on a web page.
 */
interface BannerAsset {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  png: string;
  svg: string;
}

type BannerFormat = 'png' | 'svg';

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
    description: 'For website headers and footers',
    width: 728,
    height: 90,
    png: '/affiliate/banner-728x90.png',
    svg: '/affiliate/banner-728x90.svg',
  },
  {
    id: 'medium-rectangle',
    name: 'Medium Rectangle Banner',
    description: 'For sidebars and between paragraphs of an article',
    width: 300,
    height: 250,
    png: '/affiliate/banner-300x250.png',
    svg: '/affiliate/banner-300x250.svg',
  },
  {
    id: 'skyscraper',
    name: 'Skyscraper Banner',
    description: 'For tall sidebar placements',
    width: 160,
    height: 600,
    png: '/affiliate/banner-160x600.png',
    svg: '/affiliate/banner-160x600.svg',
  },
];

const emailTemplates: EmailTemplate[] = [
  {
    id: 'introduction',
    name: 'Introduction Email',
    subject: 'Is Your Resume Getting Past the ATS?',
    useCase: 'First outreach to your network',
    body: `Hi [Name],

I recently discovered a tool that scans your resume the way ATS software (Applicant Tracking Systems — what most mid-size and large employers use) actually processes it.

Here's the part most people miss: ATS rarely rejects anyone. It parses your resume into a database recruiters search — and if your file parses badly or lacks the right keywords, you simply never show up. No rejection, just silence.

You can get a FREE scan here: {{REFERRAL_LINK}}

It takes 30 seconds and shows the actual parse of your file plus the keywords you're missing.

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

Here's something most job seekers don't know: applications rarely get "rejected" by ATS software — they just never surface. The ATS parses your resume into a database, recruiters search it, and a badly-parsed or keyword-thin resume never appears in the results. You get silence instead of a no.

There's a free tool that shows you exactly how your file parses and what's missing: {{REFERRAL_LINK}}

It literally takes 30 seconds and could be the difference between getting interviews and getting ghosted.

Worth checking out!

[Your Name]`,
  },
  {
    id: 'linkedin-post',
    name: 'LinkedIn Post',
    subject: 'LinkedIn Post Template',
    useCase: 'Share on LinkedIn to reach your network',
    body: `🚨 Job seekers: your resume probably isn't being rejected. It's invisible — which is worse, because nobody tells you.

Here's how it actually works:
• ATS software parses your resume into a database
• Recruiters search that database by keywords and titles
• Bad parsing or missing keywords = you never appear in results
• No rejection email. Just silence.

I found a free tool that shows the actual parse of your file and the searches you're missing from — 30 seconds: {{REFERRAL_LINK}}

If you're job hunting (or know someone who is), this is worth 30 seconds of your time.

#jobsearch #careeradvice #resume #ats`,
  },
  {
    id: 'newsletter',
    name: 'Newsletter Mention',
    subject: 'Resume Tool Recommendation',
    useCase: 'For newsletter creators and bloggers',
    body: `**Tool of the Week: Free ATS Resume Scanner**

If you're applying to jobs online, your resume goes through ATS (Applicant Tracking System) software that parses it into a database recruiters search. The quiet failure isn't rejection — it's never appearing in those searches because your file parsed badly or lacks the keywords recruiters type.

This free scanner shows you the actual parse of your file and exactly what's missing:

→ Get your free scan: {{REFERRAL_LINK}}

**What it does:**
- Shows how your file parses: the text and sections that come through, and the layouts that scramble them
- Lists the keywords your resume is missing
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
    body: `🧵 Your resume probably isn't getting rejected by robots. It's worse: it's invisible. Here's how to fix it (free):

1/ The "ATS auto-rejects 75% of resumes" stat you've seen everywhere? Mostly myth. ATS systems rarely reject anyone.

2/ What actually happens is quieter: the ATS parses your resume into a database, recruiters search that database — and if your file parsed badly or lacks the right keywords, you never appear. No rejection email. Nothing. You're just not in the results.

3/ Common invisibility causes:
• Two-column layouts that scramble parsing
• Text in headers/footers (often skipped)
• Missing the exact keywords recruiters search
• Non-standard section headers
• Tables and graphics

4/ I found a free tool that shows you the actual parse of your file plus what searches you're missing from — 30 seconds, no signup:

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

  const handleDownloadBanner = async (banner: BannerAsset, format: BannerFormat) => {
    try {
      const response = await fetch(banner[format]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resume-booster-${banner.width}x${banner.height}${referralCode ? `-${referralCode}` : ''}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success(`${banner.name} downloaded!`);
    } catch (error) {
      toast.error('Failed to download banner');
    }
  };

  // The PNG, which mail clients show as well as web pages; rel="sponsored"
  // is how a search engine is told that a link is paid for.
  const handleCopyHtmlEmbed = (banner: BannerAsset) => {
    const html = `<a href="${referralLink}" target="_blank" rel="sponsored noopener">
  <img src="${window.location.origin}${banner.png}" width="${banner.width}" height="${banner.height}" alt="Resume Booster: see how an ATS reads your resume, free scan" style="max-width: 100%; height: auto;" />
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
              Each banner is the size on its label. Download a PNG for email and social posts or an SVG for web pages,
              or copy the HTML embed, which links the banner to your referral URL.
            </p>
            
            <div className="grid gap-6">
              {bannerAssets.map((banner) => (
                <div 
                  key={banner.id} 
                  className="border rounded-lg p-4 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h4 className="font-medium">{banner.name}</h4>
                      <p className="text-sm text-muted-foreground">{banner.description}</p>
                      <Badge variant="secondary" className="mt-1">
                        {banner.width} × {banner.height}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
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
                        aria-label={`Download the ${banner.width} × ${banner.height} banner as PNG`}
                        onClick={() => handleDownloadBanner(banner, 'png')}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        PNG
                      </Button>
                      <Button 
                        size="sm"
                        variant="outline"
                        aria-label={`Download the ${banner.width} × ${banner.height} banner as SVG`}
                        onClick={() => handleDownloadBanner(banner, 'svg')}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        SVG
                      </Button>
                    </div>
                  </div>
                  
                  <div className="bg-muted/30 rounded-lg p-4 flex justify-center">
                    <img 
                      src={banner.png} 
                      alt={banner.name}
                      width={banner.width}
                      height={banner.height}
                      className="max-w-full h-auto max-h-48 w-auto object-contain rounded"
                      style={{ aspectRatio: `${banner.width} / ${banner.height}` }}
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
