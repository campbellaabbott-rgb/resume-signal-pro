import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { Target, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';

interface IndustryDetectionStats {
  total_detections: number;
  high_confidence: number;
  medium_confidence: number;
  low_confidence: number;
  general_fallbacks: number;
  ai_fallbacks: number;
  avg_score: number;
  avg_skills_matched: number;
}

interface IndustryBreakdown {
  industry: string;
  count: number;
  avg_confidence: string;
}

interface RecentDetection {
  final_industry: string;
  final_confidence: string;
  server_score: number;
  detection_source: string;
  matched_skill_count: number;
  created_at: string;
}

const COLORS = ['#22c55e', '#eab308', '#ef4444', '#6b7280'];

export function IndustryDetectionChart() {
  const [stats, setStats] = useState<IndustryDetectionStats | null>(null);
  const [industryBreakdown, setIndustryBreakdown] = useState<IndustryBreakdown[]>([]);
  const [recentDetections, setRecentDetections] = useState<RecentDetection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      // Fetch overall stats
      const { data: statsData } = await supabase.rpc('get_industry_detection_stats', { p_hours_back: 168 }); // 7 days
      if (statsData && statsData[0]) {
        setStats({
          total_detections: statsData[0].total_detections || 0,
          high_confidence: Math.round((statsData[0].high_confidence_rate || 0) * (statsData[0].total_detections || 0) / 100),
          medium_confidence: Math.round((statsData[0].medium_confidence_rate || 0) * (statsData[0].total_detections || 0) / 100),
          low_confidence: Math.round((statsData[0].low_confidence_rate || 0) * (statsData[0].total_detections || 0) / 100),
          general_fallbacks: 0, // Calculated separately
          ai_fallbacks: 0,
          avg_score: statsData[0].avg_server_score || 0,
          avg_skills_matched: 0,
        });
      }

      // Fetch industry breakdown
      const { data: breakdownData } = await supabase
        .from('industry_detection_metrics')
        .select('final_industry, final_confidence')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

      if (breakdownData) {
        const grouped: Record<string, { count: number; confidences: string[] }> = {};
        breakdownData.forEach(d => {
          if (!grouped[d.final_industry]) {
            grouped[d.final_industry] = { count: 0, confidences: [] };
          }
          grouped[d.final_industry].count++;
          grouped[d.final_industry].confidences.push(d.final_confidence);
        });

        const breakdown = Object.entries(grouped)
          .map(([industry, data]) => ({
            industry,
            count: data.count,
            avg_confidence: data.confidences.includes('high') ? 'high' : 
                           data.confidences.includes('medium') ? 'medium' : 'low'
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        setIndustryBreakdown(breakdown);
      }

      // Fetch recent detections
      const { data: recentData } = await supabase
        .from('industry_detection_metrics')
        .select('final_industry, final_confidence, server_score, detection_source, matched_skill_count, created_at')
        .order('created_at', { ascending: false })
        .limit(10);

      if (recentData) {
        setRecentDetections(recentData as RecentDetection[]);
      }
    } catch (e) {
      console.error('Failed to fetch industry detection data:', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/4"></div>
            <div className="h-32 bg-muted rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const confidenceData = stats ? [
    { name: 'High', value: stats.high_confidence, color: '#22c55e' },
    { name: 'Medium', value: stats.medium_confidence, color: '#eab308' },
    { name: 'Low', value: stats.low_confidence, color: '#ef4444' },
  ].filter(d => d.value > 0) : [];

  const highConfidenceRate = stats && stats.total_detections > 0 
    ? ((stats.high_confidence / stats.total_detections) * 100).toFixed(1)
    : '0';

  const generalFallbackRate = stats && stats.total_detections > 0
    ? ((stats.general_fallbacks / stats.total_detections) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <Target className="h-5 w-5 mx-auto mb-2 text-primary" />
            <p className="text-2xl font-bold">{stats?.total_detections || 0}</p>
            <p className="text-xs text-muted-foreground">Total Detections (7d)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <CheckCircle className="h-5 w-5 mx-auto mb-2 text-green-500" />
            <p className="text-2xl font-bold text-green-500">{highConfidenceRate}%</p>
            <p className="text-xs text-muted-foreground">High Confidence</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <TrendingUp className="h-5 w-5 mx-auto mb-2 text-blue-500" />
            <p className="text-2xl font-bold">{stats?.avg_score?.toFixed(0) || 0}</p>
            <p className="text-xs text-muted-foreground">Avg Score</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <AlertTriangle className="h-5 w-5 mx-auto mb-2 text-yellow-500" />
            <p className="text-2xl font-bold text-yellow-500">{generalFallbackRate}%</p>
            <p className="text-xs text-muted-foreground">General Fallback</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Confidence Distribution Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confidence Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {confidenceData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={confidenceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    dataKey="value"
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  >
                    {confidenceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Industry Breakdown Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Industries Detected</CardTitle>
          </CardHeader>
          <CardContent>
            {industryBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={industryBreakdown.slice(0, 5)} layout="vertical">
                  <XAxis type="number" />
                  <YAxis 
                    type="category" 
                    dataKey="industry" 
                    width={120}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Detections */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Detections</CardTitle>
        </CardHeader>
        <CardContent>
          {recentDetections.length > 0 ? (
            <div className="space-y-2">
              {recentDetections.map((detection, idx) => (
                <div 
                  key={idx} 
                  className="flex items-center justify-between p-2 rounded bg-muted/30 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <Badge 
                      variant={detection.final_confidence === 'high' ? 'default' : 
                               detection.final_confidence === 'medium' ? 'secondary' : 'destructive'}
                      className="text-xs"
                    >
                      {detection.final_confidence}
                    </Badge>
                    <span className="font-medium">
                      {detection.final_industry.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Score: {detection.server_score}</span>
                    <span>Skills: {detection.matched_skill_count}</span>
                    <span>{new Date(detection.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No recent detections
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
