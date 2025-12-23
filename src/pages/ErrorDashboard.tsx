import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshCw, Activity, ArrowLeft, Bell, BellOff, Download, HelpCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ErrorTrendChart } from '@/components/dashboard/ErrorTrendChart';
import { UserHealthTable } from '@/components/dashboard/UserHealthTable';
import { ErrorDiagnostics } from '@/components/dashboard/ErrorDiagnostics';
import { ErrorStatsCards } from '@/components/dashboard/ErrorStatsCards';
import { toast } from 'sonner';
import { subHours, format } from 'date-fns';

interface ErrorTelemetry {
  id: string;
  error_type: string;
  error_code: string;
  error_message: string | null;
  created_at: string;
  visitor_id: string | null;
  function_name: string | null;
  http_status: number | null;
  context: Record<string, unknown> | null;
}

type TimeRange = '1h' | '6h' | '24h' | '7d';

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string; hours: number }[] = [
  { value: '1h', label: 'Last Hour', hours: 1 },
  { value: '6h', label: 'Last 6 Hours', hours: 6 },
  { value: '24h', label: 'Last 24 Hours', hours: 24 },
  { value: '7d', label: 'Last 7 Days', hours: 168 },
];

// Classify error severity based on type and status code
function getErrorSeverity(error: ErrorTelemetry): 'critical' | 'warning' | 'info' {
  // Critical: 5xx errors or API failures
  if (error.http_status && error.http_status >= 500) return 'critical';
  if (error.error_type === 'api' && error.http_status && error.http_status >= 500) return 'critical';
  
  // Warning: 4xx client errors (except 429 rate limit which is info)
  if (error.error_type === 'rate_limit') return 'info';
  if (error.http_status && error.http_status >= 400 && error.http_status < 500) return 'warning';
  if (error.error_type === 'client') return 'warning';
  
  return 'info';
}

function SeverityBadge({ severity }: { severity: 'critical' | 'warning' | 'info' }) {
  const config = {
    critical: { icon: AlertCircle, className: 'bg-destructive/20 text-destructive border-destructive/30', label: 'Critical' },
    warning: { icon: AlertTriangle, className: 'bg-yellow-500/20 text-yellow-600 border-yellow-500/30', label: 'Warning' },
    info: { icon: Info, className: 'bg-blue-500/20 text-blue-600 border-blue-500/30', label: 'Info' },
  };
  
  const { icon: Icon, className, label } = config[severity];
  
  return (
    <Badge variant="outline" className={`text-xs ${className}`}>
      <Icon className="h-3 w-3 mr-1" />
      {label}
    </Badge>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p>{description}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export default function ErrorDashboard() {
  const [errors, setErrors] = useState<ErrorTelemetry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isLive, setIsLive] = useState(true);
  const [newErrorCount, setNewErrorCount] = useState(0);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');

  const getHoursFromRange = (range: TimeRange) => {
    return TIME_RANGE_OPTIONS.find(o => o.value === range)?.hours || 24;
  };

  const fetchErrors = useCallback(async () => {
    try {
      const hours = getHoursFromRange(timeRange);
      const startTime = subHours(new Date(), hours).toISOString();
      
      const { data, error } = await supabase
        .from('error_telemetry')
        .select('*')
        .gte('created_at', startTime)
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) {
        console.error('Failed to fetch errors:', error);
        toast.error('Failed to load error data');
        return;
      }

      setErrors(data as ErrorTelemetry[] || []);
      setLastUpdated(new Date());
      setNewErrorCount(0);
    } catch (err) {
      console.error('Error fetching errors:', err);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  // Initial fetch and refetch on time range change
  useEffect(() => {
    setLoading(true);
    fetchErrors();
  }, [fetchErrors]);

  // Real-time subscription
  useEffect(() => {
    if (!isLive) return;

    const channel = supabase
      .channel('error-telemetry-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'error_telemetry'
        },
        (payload) => {
          console.log('New error received:', payload);
          const newError = payload.new as ErrorTelemetry;
          
          setErrors(prev => [newError, ...prev].slice(0, 1000));
          setNewErrorCount(prev => prev + 1);
          setLastUpdated(new Date());
          
          const severity = getErrorSeverity(newError);
          if (severity === 'critical') {
            toast.error(`Critical error: ${newError.error_code}`, {
              description: newError.error_message || 'Server error detected',
            });
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isLive]);

  const handleRefresh = () => {
    setLoading(true);
    fetchErrors();
    toast.success('Dashboard refreshed');
  };

  const toggleLive = () => {
    setIsLive(prev => !prev);
    toast(isLive ? 'Live updates paused' : 'Live updates resumed');
  };

  const exportToCSV = () => {
    if (errors.length === 0) {
      toast.error('No errors to export');
      return;
    }

    const headers = ['Time', 'Severity', 'Type', 'Code', 'Message', 'Function', 'Visitor ID', 'HTTP Status'];
    const rows = errors.map(e => [
      format(new Date(e.created_at), 'yyyy-MM-dd HH:mm:ss'),
      getErrorSeverity(e),
      e.error_type,
      e.error_code,
      `"${(e.error_message || '').replace(/"/g, '""')}"`,
      e.function_name || '',
      e.visitor_id || '',
      e.http_status?.toString() || ''
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `error-report-${format(new Date(), 'yyyy-MM-dd-HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${errors.length} errors to CSV`);
  };

  // Calculate severity counts
  const severityCounts = errors.reduce((acc, e) => {
    const severity = getErrorSeverity(e);
    acc[severity] = (acc[severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link to="/">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                <h1 className="text-xl font-bold">Error Monitoring</h1>
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Monitor application errors in real-time. Critical errors (5xx) require immediate attention. Warnings (4xx) indicate client issues. Info shows rate limits and non-blocking issues.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              {/* Severity Summary */}
              {errors.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  {severityCounts.critical > 0 && (
                    <span className="text-destructive font-medium">{severityCounts.critical} critical</span>
                  )}
                  {severityCounts.warning > 0 && (
                    <span className="text-yellow-600 font-medium">{severityCounts.warning} warning</span>
                  )}
                  {severityCounts.info > 0 && (
                    <span className="text-blue-600 font-medium">{severityCounts.info} info</span>
                  )}
                </div>
              )}

              {newErrorCount > 0 && (
                <Badge variant="destructive" className="animate-pulse">
                  +{newErrorCount} new
                </Badge>
              )}
              
              {/* Time Range Selector */}
              <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_RANGE_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Badge 
                variant={isLive ? "default" : "secondary"}
                className="flex items-center gap-1.5"
              >
                <span className={`h-2 w-2 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground'}`} />
                {isLive ? 'Live' : 'Paused'}
              </Badge>
              
              <Button
                variant="outline"
                size="sm"
                onClick={toggleLive}
              >
                {isLive ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={exportToCSV}
                disabled={errors.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              
              <span className="text-xs text-muted-foreground hidden sm:block">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 space-y-8">
        {/* Overview Section */}
        <section>
          <SectionHeader 
            title="Overview" 
            description="Key metrics showing error counts, trends, and affected users at a glance."
          />
          <ErrorStatsCards errors={errors} />
        </section>

        {/* Trend Section */}
        <section>
          <SectionHeader 
            title="Error Trend" 
            description="Visual breakdown of errors over time by type. Helps identify patterns and spikes."
          />
          <ErrorTrendChart errors={errors} hoursBack={getHoursFromRange(timeRange)} />
        </section>

        {/* Analysis Section */}
        <section>
          <SectionHeader 
            title="Analysis" 
            description="Deep dive into user health and error diagnostics. Identify problematic users and common error patterns."
          />
          <div className="grid lg:grid-cols-2 gap-6">
            <UserHealthTable errors={errors} />
            <ErrorDiagnostics errors={errors} />
          </div>
        </section>

        {/* Recent Errors Section */}
        <section>
          <SectionHeader 
            title="Recent Errors" 
            description="Detailed log of individual errors with severity classification. Critical errors are highlighted for immediate action."
          />
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-card px-4 py-3 border-b flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Showing {Math.min(errors.length, 100)} of {errors.length} errors
              </span>
            </div>
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2">Time</th>
                    <th className="text-left px-4 py-2">Severity</th>
                    <th className="text-left px-4 py-2">Type</th>
                    <th className="text-left px-4 py-2">Code</th>
                    <th className="text-left px-4 py-2">Message</th>
                    <th className="text-left px-4 py-2">Function</th>
                    <th className="text-left px-4 py-2">Visitor</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.slice(0, 100).map((error) => {
                    const severity = getErrorSeverity(error);
                    return (
                      <tr 
                        key={error.id} 
                        className={`border-b hover:bg-muted/30 ${
                          severity === 'critical' ? 'bg-destructive/5' : ''
                        }`}
                      >
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                          {format(new Date(error.created_at), 'HH:mm:ss')}
                        </td>
                        <td className="px-4 py-2">
                          <SeverityBadge severity={severity} />
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className="text-xs">
                            {error.error_type}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">
                          {error.error_code}
                        </td>
                        <td className="px-4 py-2 max-w-[200px] truncate" title={error.error_message || ''}>
                          {error.error_message || '-'}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {error.function_name || '-'}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {error.visitor_id?.substring(0, 8) || '-'}...
                        </td>
                      </tr>
                    );
                  })}
                  {errors.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        <div className="flex flex-col items-center gap-2">
                          <Activity className="h-8 w-8 text-green-500" />
                          <p>No errors in the selected time range</p>
                          <p className="text-xs">Your application is running smoothly!</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
