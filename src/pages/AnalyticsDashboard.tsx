import { useState, useEffect } from "react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, TrendingUp, TrendingDown, Clock, ScrollText, ShoppingCart, BarChart3, CalendarIcon, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface MetricData {
  variant: string;
  views: number;
  conversions: number;
  conversionRate: number;
}

interface PageMetrics {
  scrollDepth: MetricData[];
  timeOnPage: MetricData[];
}

interface EngagementData {
  scrollDepth: MetricData[];
  timeOnPage: MetricData[];
  conversions: MetricData[];
  abTests: Record<string, MetricData[]>;
  pageMetrics: Record<string, PageMetrics>;
}

const DATE_PRESETS = [
  { label: "Today", days: 0 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 14 days", days: 14 },
  { label: "Last 30 days", days: 30 },
];

const PAGE_FILTERS = [
  { label: "All Pages", value: "all" },
  { label: "Home", value: "home" },
  { label: "Pricing", value: "pricing" },
];

export default function AnalyticsDashboard() {
  const [data, setData] = useState<EngagementData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date>(subDays(new Date(), 7));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [activePreset, setActivePreset] = useState<number>(7);
  const [pageFilter, setPageFilter] = useState<string>("all");

  useEffect(() => {
    fetchAnalytics();
  }, [startDate, endDate, pageFilter]);

  const handlePresetClick = (days: number) => {
    setActivePreset(days);
    if (days === 0) {
      setStartDate(startOfDay(new Date()));
      setEndDate(endOfDay(new Date()));
    } else {
      setStartDate(subDays(new Date(), days));
      setEndDate(new Date());
    }
  };

  const fetchAnalytics = async () => {
    try {
      setIsLoading(true);
      
      // Use edge function to fetch analytics (bypasses RLS)
      const { data: result, error: invokeError } = await supabase.functions.invoke('get-analytics', {
        body: {
          startDate: startOfDay(startDate).toISOString(),
          endDate: endOfDay(endDate).toISOString(),
          pageFilter,
        },
      });

      if (invokeError) throw invokeError;
      if (result?.error) throw new Error(result.error);

      setData(result);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError('Failed to load analytics data');
    } finally {
      setIsLoading(false);
    }
  };

  const getDropOffRate = (metrics: MetricData[], index: number): number => {
    if (index === 0 || metrics.length < 2) return 0;
    const current = metrics[index]?.views || 0;
    const previous = metrics[index - 1]?.views || 0;
    if (previous === 0) return 0;
    return ((previous - current) / previous) * 100;
  };

  const getTotalVisitors = (metrics: MetricData[]): number => {
    return metrics[0]?.views || 0;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-12">
          <div className="text-center text-destructive">{error || 'No data available'}</div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">Engagement Analytics</h1>
              <p className="text-muted-foreground">
                {format(startDate, "MMM d, yyyy")} - {format(endDate, "MMM d, yyyy")}
              </p>
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              {/* Preset buttons */}
              {DATE_PRESETS.map((preset) => (
                <Button
                  key={preset.days}
                  variant={activePreset === preset.days ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePresetClick(preset.days)}
                >
                  {preset.label}
                </Button>
              ))}
              
              {/* Custom date pickers */}
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(startDate, "MMM d")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={(date) => {
                        if (date) {
                          setStartDate(date);
                          setActivePreset(-1);
                        }
                      }}
                      disabled={(date) => date > new Date() || date > endDate}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
                
                <span className="text-muted-foreground">to</span>
                
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(endDate, "MMM d")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={(date) => {
                        if (date) {
                          setEndDate(date);
                          setActivePreset(-1);
                        }
                      }}
                      disabled={(date) => date > new Date() || date < startDate}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              
              <Button variant="ghost" size="sm" onClick={() => fetchAnalytics()} disabled={isLoading}>
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </div>

        {/* Page Filter */}
        <div className="flex items-center gap-2 mb-6">
          <span className="text-sm text-muted-foreground">Filter by page:</span>
          {PAGE_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              variant={pageFilter === filter.value ? "default" : "outline"}
              size="sm"
              onClick={() => setPageFilter(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 max-w-2xl">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
            <TabsTrigger value="scroll">Scroll Depth</TabsTrigger>
            <TabsTrigger value="time">Time on Page</TabsTrigger>
            <TabsTrigger value="ab">A/B Tests</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Visitors</CardTitle>
                  <ScrollText className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{getTotalVisitors(data.scrollDepth)}</div>
                  <p className="text-xs text-muted-foreground">reached 25% scroll</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Engaged Users</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {data.timeOnPage.find(m => m.variant === '1m')?.views || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">stayed 1+ minute</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Deep Scrollers</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {data.scrollDepth.find(m => m.variant === '75%')?.views || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">scrolled 75%+</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Purchases</CardTitle>
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {data.conversions.reduce((sum, m) => sum + m.conversions, 0)}
                  </div>
                  <p className="text-xs text-muted-foreground">completed checkouts</p>
                </CardContent>
              </Card>
            </div>

            {/* Scroll Funnel */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ScrollText className="h-5 w-5" />
                  Scroll Depth Funnel
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {data.scrollDepth.map((metric, index) => {
                    const maxViews = getTotalVisitors(data.scrollDepth);
                    const percentage = maxViews > 0 ? (metric.views / maxViews) * 100 : 0;
                    const dropOff = getDropOffRate(data.scrollDepth, index);
                    
                    return (
                      <div key={metric.variant} className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="font-medium">{metric.variant}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">{metric.views} users</span>
                            {dropOff > 0 && (
                              <Badge variant="outline" className="text-destructive">
                                <TrendingDown className="h-3 w-3 mr-1" />
                                {dropOff.toFixed(1)}% drop
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Progress value={percentage} className="h-2" />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Time Engagement */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Time on Page
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {data.timeOnPage.map((metric, index) => {
                    const maxViews = getTotalVisitors(data.timeOnPage);
                    const percentage = maxViews > 0 ? (metric.views / maxViews) * 100 : 0;
                    const dropOff = getDropOffRate(data.timeOnPage, index);
                    
                    return (
                      <div key={metric.variant} className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="font-medium">{metric.variant}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">{metric.views} users</span>
                            {dropOff > 0 && (
                              <Badge variant="outline" className="text-destructive">
                                <TrendingDown className="h-3 w-3 mr-1" />
                                {dropOff.toFixed(1)}% drop
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Progress value={percentage} className="h-2" />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="compare" className="space-y-6">
            {/* Page Comparison */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Scroll Depth Comparison */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ScrollText className="h-5 w-5" />
                    Scroll Depth Comparison
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-2">Milestone</th>
                          <th className="text-right py-2 px-2">Home</th>
                          <th className="text-right py-2 px-2">Pricing</th>
                          <th className="text-right py-2 px-2">Diff</th>
                        </tr>
                      </thead>
                      <tbody>
                        {['25%', '50%', '75%', '90%', '100%'].map((milestone) => {
                          const homeMetric = data.pageMetrics?.home?.scrollDepth?.find(m => m.variant === milestone);
                          const pricingMetric = data.pageMetrics?.pricing?.scrollDepth?.find(m => m.variant === milestone);
                          const homeViews = homeMetric?.views || 0;
                          const pricingViews = pricingMetric?.views || 0;
                          const diff = pricingViews - homeViews;
                          
                          return (
                            <tr key={milestone} className="border-b">
                              <td className="py-2 px-2 font-medium">{milestone}</td>
                              <td className="py-2 px-2 text-right">{homeViews}</td>
                              <td className="py-2 px-2 text-right">{pricingViews}</td>
                              <td className="py-2 px-2 text-right">
                                {diff !== 0 && (
                                  <span className={diff > 0 ? 'text-green-500' : 'text-destructive'}>
                                    {diff > 0 ? '+' : ''}{diff}
                                  </span>
                                )}
                                {diff === 0 && <span className="text-muted-foreground">-</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Time on Page Comparison */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Time on Page Comparison
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-2">Duration</th>
                          <th className="text-right py-2 px-2">Home</th>
                          <th className="text-right py-2 px-2">Pricing</th>
                          <th className="text-right py-2 px-2">Diff</th>
                        </tr>
                      </thead>
                      <tbody>
                        {['30s', '1m', '2m', '5m', '10m'].map((duration) => {
                          const homeMetric = data.pageMetrics?.home?.timeOnPage?.find(m => m.variant === duration);
                          const pricingMetric = data.pageMetrics?.pricing?.timeOnPage?.find(m => m.variant === duration);
                          const homeViews = homeMetric?.views || 0;
                          const pricingViews = pricingMetric?.views || 0;
                          const diff = pricingViews - homeViews;
                          
                          return (
                            <tr key={duration} className="border-b">
                              <td className="py-2 px-2 font-medium">{duration}</td>
                              <td className="py-2 px-2 text-right">{homeViews}</td>
                              <td className="py-2 px-2 text-right">{pricingViews}</td>
                              <td className="py-2 px-2 text-right">
                                {diff !== 0 && (
                                  <span className={diff > 0 ? 'text-green-500' : 'text-destructive'}>
                                    {diff > 0 ? '+' : ''}{diff}
                                  </span>
                                )}
                                {diff === 0 && <span className="text-muted-foreground">-</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Retention Rate Comparison */}
            <Card>
              <CardHeader>
                <CardTitle>Retention Rate by Page</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {['home', 'pricing'].map((page) => {
                    const pageData = data.pageMetrics?.[page];
                    const scrollData = pageData?.scrollDepth || [];
                    const first = scrollData[0]?.views || 0;
                    const last = scrollData[scrollData.length - 1]?.views || 0;
                    const retentionRate = first > 0 ? (last / first) * 100 : 0;
                    
                    return (
                      <div key={page} className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="font-medium capitalize">{page}</span>
                          <Badge variant={retentionRate > 30 ? "default" : "destructive"}>
                            {retentionRate.toFixed(1)}% retention
                          </Badge>
                        </div>
                        <Progress value={retentionRate} className="h-3" />
                        <p className="text-xs text-muted-foreground">
                          {first} started → {last} completed (100% scroll)
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scroll">
            <Card>
              <CardHeader>
                <CardTitle>Scroll Depth Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4">Milestone</th>
                        <th className="text-right py-3 px-4">Users</th>
                        <th className="text-right py-3 px-4">% of Total</th>
                        <th className="text-right py-3 px-4">Drop-off</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.scrollDepth.map((metric, index) => {
                        const maxViews = getTotalVisitors(data.scrollDepth);
                        const percentage = maxViews > 0 ? (metric.views / maxViews) * 100 : 0;
                        const dropOff = getDropOffRate(data.scrollDepth, index);
                        
                        return (
                          <tr key={metric.variant} className="border-b">
                            <td className="py-3 px-4 font-medium">{metric.variant}</td>
                            <td className="py-3 px-4 text-right">{metric.views}</td>
                            <td className="py-3 px-4 text-right">{percentage.toFixed(1)}%</td>
                            <td className="py-3 px-4 text-right">
                              {dropOff > 0 ? (
                                <span className="text-destructive">-{dropOff.toFixed(1)}%</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="time">
            <Card>
              <CardHeader>
                <CardTitle>Time on Page Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4">Duration</th>
                        <th className="text-right py-3 px-4">Users</th>
                        <th className="text-right py-3 px-4">% of Total</th>
                        <th className="text-right py-3 px-4">Drop-off</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.timeOnPage.map((metric, index) => {
                        const maxViews = getTotalVisitors(data.timeOnPage);
                        const percentage = maxViews > 0 ? (metric.views / maxViews) * 100 : 0;
                        const dropOff = getDropOffRate(data.timeOnPage, index);
                        
                        return (
                          <tr key={metric.variant} className="border-b">
                            <td className="py-3 px-4 font-medium">{metric.variant}</td>
                            <td className="py-3 px-4 text-right">{metric.views}</td>
                            <td className="py-3 px-4 text-right">{percentage.toFixed(1)}%</td>
                            <td className="py-3 px-4 text-right">
                              {dropOff > 0 ? (
                                <span className="text-destructive">-{dropOff.toFixed(1)}%</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ab" className="space-y-6">
            {Object.entries(data.abTests).map(([testName, metrics]) => (
              <Card key={testName}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    {testName.replace(/_/g, ' ')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-4">Variant</th>
                          <th className="text-right py-3 px-4">Views</th>
                          <th className="text-right py-3 px-4">Conversions</th>
                          <th className="text-right py-3 px-4">Conv. Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.map((metric) => {
                          const isWinner = metrics.length > 1 && 
                            metric.conversionRate === Math.max(...metrics.map(m => m.conversionRate)) &&
                            metric.conversionRate > 0;
                          
                          return (
                            <tr key={metric.variant} className="border-b">
                              <td className="py-3 px-4 font-medium">
                                {metric.variant}
                                {isWinner && (
                                  <Badge className="ml-2 bg-green-500">Winner</Badge>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right">{metric.views}</td>
                              <td className="py-3 px-4 text-right">{metric.conversions}</td>
                              <td className="py-3 px-4 text-right">
                                <span className={isWinner ? 'text-green-500 font-medium' : ''}>
                                  {metric.conversionRate.toFixed(2)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
}
