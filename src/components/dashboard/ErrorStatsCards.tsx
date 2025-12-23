import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, AlertCircle, Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';
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
}

interface ErrorStatsCardsProps {
  errors: ErrorTelemetry[];
}

export function ErrorStatsCards({ errors }: ErrorStatsCardsProps) {
  const stats = useMemo(() => {
    const now = new Date();
    const oneHourAgo = subHours(now, 1);
    const twoHoursAgo = subHours(now, 2);
    
    const lastHourErrors = errors.filter(e => new Date(e.created_at) >= oneHourAgo);
    const previousHourErrors = errors.filter(e => {
      const date = new Date(e.created_at);
      return date >= twoHoursAgo && date < oneHourAgo;
    });
    
    const uniqueUsers = new Set(errors.map(e => e.visitor_id).filter(Boolean)).size;
    const uniqueFunctions = new Set(errors.map(e => e.function_name).filter(Boolean)).size;
    
    const rateChange = previousHourErrors.length > 0 
      ? ((lastHourErrors.length - previousHourErrors.length) / previousHourErrors.length) * 100
      : lastHourErrors.length > 0 ? 100 : 0;
    
    const criticalErrors = errors.filter(e => 
      e.http_status && e.http_status >= 500
    ).length;
    
    return {
      totalErrors: errors.length,
      lastHourErrors: lastHourErrors.length,
      rateChange,
      uniqueUsers,
      uniqueFunctions,
      criticalErrors
    };
  }, [errors]);

  const getTrendIcon = (change: number) => {
    if (change > 0) return <TrendingUp className="h-4 w-4 text-destructive" />;
    if (change < 0) return <TrendingDown className="h-4 w-4 text-green-500" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const getTrendColor = (change: number) => {
    if (change > 0) return 'text-destructive';
    if (change < 0) return 'text-green-500';
    return 'text-muted-foreground';
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Total Errors
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.totalErrors}</div>
          <p className="text-xs text-muted-foreground">Last 24 hours</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Last Hour
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.lastHourErrors}</div>
          <div className={`flex items-center gap-1 text-xs ${getTrendColor(stats.rateChange)}`}>
            {getTrendIcon(stats.rateChange)}
            <span>{stats.rateChange > 0 ? '+' : ''}{stats.rateChange.toFixed(0)}% vs prev hour</span>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Critical (5xx)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-destructive">{stats.criticalErrors}</div>
          <p className="text-xs text-muted-foreground">Server errors</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Affected Users
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.uniqueUsers}</div>
          <p className="text-xs text-muted-foreground">
            Across {stats.uniqueFunctions} functions
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
