import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Globe, MapPin, AlertTriangle, TrendingUp, TrendingDown, Clock, Activity } from 'lucide-react';

interface GeoLatencyStats {
  country: string;
  total_scans: number;
  failed_scans: number;
  failure_rate: number;
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  min_latency_ms: number;
  max_latency_ms: number;
}

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', IN: 'India', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', BR: 'Brazil',
  MX: 'Mexico', JP: 'Japan', KR: 'South Korea', CN: 'China', RU: 'Russia',
  NL: 'Netherlands', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland',
  PL: 'Poland', PT: 'Portugal', BE: 'Belgium', AT: 'Austria', CH: 'Switzerland',
  IE: 'Ireland', NZ: 'New Zealand', SG: 'Singapore', HK: 'Hong Kong', PH: 'Philippines',
  ID: 'Indonesia', MY: 'Malaysia', TH: 'Thailand', VN: 'Vietnam', ZA: 'South Africa',
  AE: 'UAE', IL: 'Israel', TR: 'Turkey', AR: 'Argentina', CL: 'Chile',
  CO: 'Colombia', PE: 'Peru', KZ: 'Kazakhstan', UY: 'Uruguay', BY: 'Belarus',
  Unknown: 'Unknown',
};

const FLAG_EMOJIS: Record<string, string> = {
  US: '🇺🇸', IN: '🇮🇳', GB: '🇬🇧', CA: '🇨🇦', AU: '🇦🇺',
  DE: '🇩🇪', FR: '🇫🇷', ES: '🇪🇸', IT: '🇮🇹', BR: '🇧🇷',
  MX: '🇲🇽', JP: '🇯🇵', KR: '🇰🇷', CN: '🇨🇳', RU: '🇷🇺',
  NL: '🇳🇱', SE: '🇸🇪', NO: '🇳🇴', DK: '🇩🇰', FI: '🇫🇮',
  PL: '🇵🇱', PT: '🇵🇹', BE: '🇧🇪', AT: '🇦🇹', CH: '🇨🇭',
  IE: '🇮🇪', NZ: '🇳🇿', SG: '🇸🇬', HK: '🇭🇰', PH: '🇵🇭',
  ID: '🇮🇩', MY: '🇲🇾', TH: '🇹🇭', VN: '🇻🇳', ZA: '🇿🇦',
  AE: '🇦🇪', IL: '🇮🇱', TR: '🇹🇷', AR: '🇦🇷', CL: '🇨🇱',
  CO: '🇨🇴', PE: '🇵🇪', KZ: '🇰🇿', UY: '🇺🇾', BY: '🇧🇾',
  Unknown: '🌍',
};

export function GeoPerformanceChart() {
  const [data, setData] = useState<GeoLatencyStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalScans, setTotalScans] = useState(0);
  const [avgLatency, setAvgLatency] = useState(0);
  const [avgFailureRate, setAvgFailureRate] = useState(0);

  useEffect(() => {
    fetchGeoStats();
  }, []);

  const fetchGeoStats = async () => {
    try {
      const { data: stats, error } = await supabase.rpc('get_geo_latency_stats', { p_hours_back: 24 });

      if (error) throw error;

      const typedStats = (stats || []) as GeoLatencyStats[];
      setData(typedStats);

      // Calculate totals
      const total = typedStats.reduce((sum, s) => sum + s.total_scans, 0);
      setTotalScans(total);

      const weightedLatency = typedStats.reduce((sum, s) => sum + (s.avg_latency_ms * s.total_scans), 0);
      setAvgLatency(total > 0 ? Math.round(weightedLatency / total) : 0);

      const weightedFailureRate = typedStats.reduce((sum, s) => sum + (s.failure_rate * s.total_scans), 0);
      setAvgFailureRate(total > 0 ? weightedFailureRate / total : 0);

    } catch (error) {
      console.error('Failed to fetch geo stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const getCountryName = (code: string) => COUNTRY_NAMES[code] || code;
  const getFlag = (code: string) => FLAG_EMOJIS[code] || '🌍';

  const getLatencyColor = (latency: number) => {
    if (latency < 500) return '#22c55e';
    if (latency < 1000) return '#84cc16';
    if (latency < 2000) return '#eab308';
    if (latency < 3000) return '#f97316';
    return '#ef4444';
  };

  const getFailureColor = (rate: number) => {
    if (rate === 0) return '#22c55e';
    if (rate < 5) return '#84cc16';
    if (rate < 10) return '#eab308';
    if (rate < 20) return '#f97316';
    return '#ef4444';
  };

  const chartData = data.slice(0, 10).map(item => ({
    ...item,
    name: item.country,
    displayName: `${getFlag(item.country)} ${item.country}`,
  }));

  if (loading) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50 mb-6">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  const problematicRegions = data.filter(d => d.failure_rate > 10 || d.avg_latency_ms > 3000);

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50 mb-6">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Geographic Performance (24h)
          </CardTitle>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Countries</p>
              <p className="text-xl font-bold text-foreground">{data.length}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total Scans</p>
              <p className="text-xl font-bold text-foreground">{totalScans}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Avg Latency</p>
              <p className={`text-xl font-bold ${avgLatency < 1000 ? 'text-green-400' : avgLatency < 2000 ? 'text-yellow-400' : 'text-red-400'}`}>
                {avgLatency}ms
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Avg Failure</p>
              <p className={`text-xl font-bold ${avgFailureRate < 5 ? 'text-green-400' : avgFailureRate < 15 ? 'text-yellow-400' : 'text-red-400'}`}>
                {avgFailureRate.toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            <MapPin className="h-4 w-4 mr-2" />
            No geographic data available
          </div>
        ) : (
          <Tabs defaultValue="latency" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="latency" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                Latency by Region
              </TabsTrigger>
              <TabsTrigger value="volume" className="text-xs">
                <Activity className="h-3 w-3 mr-1" />
                Volume & Errors
              </TabsTrigger>
            </TabsList>

            <TabsContent value="latency" className="mt-0">
              {/* Latency Chart */}
              <div className="h-48 mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
                    <XAxis 
                      type="number"
                      tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 10 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickFormatter={(v) => `${v}ms`}
                    />
                    <YAxis 
                      type="category"
                      dataKey="displayName"
                      tick={{ fill: 'rgba(255,255,255,0.9)', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      width={60}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--foreground))'
                      }}
                      formatter={(value: number, name: string) => {
                        if (name === 'avg_latency_ms') return [`${value}ms`, 'Avg Latency'];
                        if (name === 'p95_latency_ms') return [`${value}ms`, 'P95 Latency'];
                        return [value, name];
                      }}
                      labelFormatter={(label) => {
                        const item = chartData.find(d => d.displayName === label);
                        return item ? `${getFlag(item.country)} ${getCountryName(item.country)}` : label;
                      }}
                    />
                    <Bar 
                      dataKey="avg_latency_ms" 
                      radius={[0, 4, 4, 0]}
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getLatencyColor(entry.avg_latency_ms)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </TabsContent>

            <TabsContent value="volume" className="mt-0">
              {/* Volume Chart */}
              <div className="h-48 mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
                    <XAxis 
                      type="number"
                      tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 10 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                    />
                    <YAxis 
                      type="category"
                      dataKey="displayName"
                      tick={{ fill: 'rgba(255,255,255,0.9)', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      width={60}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--foreground))'
                      }}
                      labelFormatter={(label) => {
                        const item = chartData.find(d => d.displayName === label);
                        return item ? `${getFlag(item.country)} ${getCountryName(item.country)}` : label;
                      }}
                    />
                    <Bar 
                      dataKey="total_scans" 
                      radius={[0, 4, 4, 0]}
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getFailureColor(entry.failure_rate)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </TabsContent>

            {/* Country Details Table */}
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {data.map((stat) => (
                <div 
                  key={stat.country}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{getFlag(stat.country)}</span>
                    <div>
                      <p className="text-sm font-medium">{getCountryName(stat.country)}</p>
                      <p className="text-xs text-muted-foreground">{stat.total_scans} scans</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Avg</p>
                      <p className={`text-sm font-medium ${stat.avg_latency_ms < 1000 ? 'text-green-400' : stat.avg_latency_ms < 2000 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {stat.avg_latency_ms}ms
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">P95</p>
                      <p className={`text-sm font-medium ${stat.p95_latency_ms < 2000 ? 'text-green-400' : stat.p95_latency_ms < 4000 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {stat.p95_latency_ms}ms
                      </p>
                    </div>
                    <Badge 
                      variant="outline" 
                      className={`min-w-[60px] justify-center ${
                        stat.failure_rate === 0 ? 'border-green-500/50 text-green-500' :
                        stat.failure_rate < 10 ? 'border-yellow-500/50 text-yellow-500' :
                        'border-red-500/50 text-red-500'
                      }`}
                    >
                      {stat.failure_rate === 0 ? (
                        <TrendingUp className="h-3 w-3 mr-1" />
                      ) : stat.failure_rate > 10 ? (
                        <TrendingDown className="h-3 w-3 mr-1" />
                      ) : null}
                      {stat.failure_rate.toFixed(1)}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            {/* Problematic regions alert */}
            {problematicRegions.length > 0 && (
              <div className="mt-4 p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                <p className="text-xs font-medium text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-3 w-3" />
                  Performance issues in: {problematicRegions.map(r => `${getFlag(r.country)} ${r.country}`).join(', ')}
                </p>
              </div>
            )}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
