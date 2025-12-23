import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Activity, ArrowLeft, Bell, BellOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ErrorTrendChart } from '@/components/dashboard/ErrorTrendChart';
import { UserHealthTable } from '@/components/dashboard/UserHealthTable';
import { ErrorDiagnostics } from '@/components/dashboard/ErrorDiagnostics';
import { ErrorStatsCards } from '@/components/dashboard/ErrorStatsCards';
import { toast } from 'sonner';
import { subHours } from 'date-fns';

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

export default function ErrorDashboard() {
  const [errors, setErrors] = useState<ErrorTelemetry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isLive, setIsLive] = useState(true);
  const [newErrorCount, setNewErrorCount] = useState(0);

  const fetchErrors = useCallback(async () => {
    try {
      const twentyFourHoursAgo = subHours(new Date(), 24).toISOString();
      
      const { data, error } = await supabase
        .from('error_telemetry')
        .select('*')
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: false })
        .limit(500);

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
  }, []);

  // Initial fetch
  useEffect(() => {
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
          
          setErrors(prev => [newError, ...prev].slice(0, 500));
          setNewErrorCount(prev => prev + 1);
          setLastUpdated(new Date());
          
          // Show toast for critical errors
          if (newError.http_status && newError.http_status >= 500) {
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
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
            </div>
            
            <div className="flex items-center gap-3">
              {newErrorCount > 0 && (
                <Badge variant="destructive" className="animate-pulse">
                  +{newErrorCount} new
                </Badge>
              )}
              
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
                onClick={handleRefresh}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              
              <span className="text-xs text-muted-foreground">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Stats Cards */}
        <ErrorStatsCards errors={errors} />

        {/* Trend Chart */}
        <ErrorTrendChart errors={errors} hoursBack={24} />

        {/* Two Column Layout */}
        <div className="grid lg:grid-cols-2 gap-6">
          <UserHealthTable errors={errors} />
          <ErrorDiagnostics errors={errors} />
        </div>

        {/* Recent Errors Table */}
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-card px-4 py-3 border-b">
            <h3 className="font-semibold">Recent Errors</h3>
          </div>
          <div className="max-h-[400px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2">Time</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-left px-4 py-2">Code</th>
                  <th className="text-left px-4 py-2">Message</th>
                  <th className="text-left px-4 py-2">Function</th>
                  <th className="text-left px-4 py-2">Visitor</th>
                </tr>
              </thead>
              <tbody>
                {errors.slice(0, 50).map((error) => (
                  <tr key={error.id} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                      {new Date(error.created_at).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="text-xs">
                        {error.error_type}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {error.error_code}
                    </td>
                    <td className="px-4 py-2 max-w-[200px] truncate">
                      {error.error_message || '-'}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {error.function_name || '-'}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {error.visitor_id?.substring(0, 8) || '-'}...
                    </td>
                  </tr>
                ))}
                {errors.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No errors in the last 24 hours
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
