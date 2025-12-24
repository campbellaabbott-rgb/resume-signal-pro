import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Copy, 
  Check, 
  QrCode, 
  Link2, 
  Settings2,
  Download,
  Share2
} from 'lucide-react';

interface AdvancedLinkToolsProps {
  referralLink: string;
  referralCode: string;
}

export function AdvancedLinkTools({ referralLink, referralCode }: AdvancedLinkToolsProps) {
  const [copied, setCopied] = useState(false);
  const [utmSource, setUtmSource] = useState('');
  const [utmMedium, setUtmMedium] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [utmContent, setUtmContent] = useState('');

  // Generate short link format
  const shortLink = `${window.location.origin}/r/${referralCode}`;

  // Build UTM link
  const buildUtmLink = useCallback(() => {
    const params = new URLSearchParams();
    if (utmSource) params.set('utm_source', utmSource);
    if (utmMedium) params.set('utm_medium', utmMedium);
    if (utmCampaign) params.set('utm_campaign', utmCampaign);
    if (utmContent) params.set('utm_content', utmContent);
    
    const utmString = params.toString();
    return utmString ? `${referralLink}&${utmString}` : referralLink;
  }, [referralLink, utmSource, utmMedium, utmCampaign, utmContent]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(`${label} copied!`);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadQR = () => {
    const svg = document.getElementById('affiliate-qr-code');
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = 400;
      canvas.height = 400;
      ctx?.drawImage(img, 0, 0, 400, 400);
      
      const pngFile = canvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      downloadLink.download = `affiliate-qr-${referralCode}.png`;
      downloadLink.href = pngFile;
      downloadLink.click();
      toast.success('QR code downloaded!');
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const presetCampaigns = [
    { source: 'linkedin', medium: 'social', campaign: 'organic' },
    { source: 'twitter', medium: 'social', campaign: 'organic' },
    { source: 'email', medium: 'newsletter', campaign: 'weekly' },
    { source: 'blog', medium: 'content', campaign: 'article' },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Advanced Link Tools
        </CardTitle>
        <CardDescription>
          QR codes, UTM tracking, and short links for your campaigns
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="qr" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="qr" className="flex items-center gap-2">
              <QrCode className="h-4 w-4" />
              QR Code
            </TabsTrigger>
            <TabsTrigger value="short" className="flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              Short Link
            </TabsTrigger>
            <TabsTrigger value="utm" className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              UTM Builder
            </TabsTrigger>
          </TabsList>

          <TabsContent value="qr" className="space-y-6">
            <div className="flex flex-col items-center gap-6">
              <div className="bg-white p-6 rounded-xl shadow-sm">
                <QRCodeSVG
                  id="affiliate-qr-code"
                  value={referralLink}
                  size={200}
                  level="H"
                  includeMargin
                />
              </div>
              
              <div className="flex gap-2">
                <Button onClick={handleDownloadQR}>
                  <Download className="h-4 w-4 mr-2" />
                  Download PNG
                </Button>
                <Button variant="outline" onClick={() => handleCopy(referralLink, 'Link')}>
                  {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                  Copy Link
                </Button>
              </div>

              <p className="text-sm text-muted-foreground text-center max-w-sm">
                Use this QR code at events, on business cards, or in printed materials. 
                Scanning takes users directly to your referral link.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="short" className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label className="text-sm text-muted-foreground">Your Short Link</Label>
                <div className="flex gap-2 mt-2">
                  <Input 
                    value={shortLink} 
                    readOnly 
                    className="font-mono text-sm"
                  />
                  <Button onClick={() => handleCopy(shortLink, 'Short link')}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <h4 className="font-medium text-sm">Link Comparison</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Full link:</span>
                    <Badge variant="outline" className="font-mono text-xs truncate max-w-[200px]">
                      {referralLink.length} chars
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Short link:</span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {shortLink.length} chars
                    </Badge>
                  </div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Short links are easier to share verbally and look cleaner in social media bios.
                Both links track to your affiliate account.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="utm" className="space-y-6">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="utm-source">Source</Label>
                  <Input
                    id="utm-source"
                    placeholder="e.g., linkedin, twitter"
                    value={utmSource}
                    onChange={(e) => setUtmSource(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="utm-medium">Medium</Label>
                  <Input
                    id="utm-medium"
                    placeholder="e.g., social, email"
                    value={utmMedium}
                    onChange={(e) => setUtmMedium(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="utm-campaign">Campaign</Label>
                  <Input
                    id="utm-campaign"
                    placeholder="e.g., spring_promo"
                    value={utmCampaign}
                    onChange={(e) => setUtmCampaign(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="utm-content">Content (optional)</Label>
                  <Input
                    id="utm-content"
                    placeholder="e.g., banner_ad"
                    value={utmContent}
                    onChange={(e) => setUtmContent(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="text-sm text-muted-foreground">Quick presets:</span>
                {presetCampaigns.map((preset) => (
                  <Button
                    key={preset.source}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setUtmSource(preset.source);
                      setUtmMedium(preset.medium);
                      setUtmCampaign(preset.campaign);
                    }}
                  >
                    {preset.source}
                  </Button>
                ))}
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Generated UTM Link</Label>
                <div className="flex gap-2">
                  <Input 
                    value={buildUtmLink()} 
                    readOnly 
                    className="font-mono text-xs"
                  />
                  <Button onClick={() => handleCopy(buildUtmLink(), 'UTM link')}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                UTM parameters help you track which campaigns drive the most conversions.
                View performance in your analytics dashboard.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
