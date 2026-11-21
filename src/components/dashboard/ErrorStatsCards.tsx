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

/** get-error-telemetry's exact counts over the whole range (S14X-157). */
export interface ErrorRangeCounts {
  total: number;
  lastHour: number;
  previousHour: number;
  serverErrors: number;
}

interface ErrorStatsCardsProps {
  /** The rows the page holds: the whole range, or its newest rows when the range holds more. */
  errors: ErrorTelemetry[];
  /** The range the owner picked, as its selector names it. */
  rangeLabel?: string;
  /** The reader's counts over the whole range; absent from a reader built before them. */
  counts?: ErrorRangeCounts | null;
}

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * THE OVERVIEW COUNTS THE RANGE, NOT THE SAMPLE (S14X-157). Total Errors was
 * errors.length, the newest 1,000 rows at most, under a label that read "Last
 * 24 hours" for every range; the 5xx and last-hour cards counted the same
 * sample. The reader's range counts are used when it sends them, and the label
 * is the range picked. Unique users and functions stay the sample's, since no
 * count travels for them.
 */
export function ErrorStatsCards({ errors, rangeLabel = 'Selected range', counts }: ErrorStatsCardsProps) {
  const stats = useMemo(() => {
    const now = new Date();
    const oneHourAgo = subHours(now, 1);
    const twoHoursAgo = subHours(now, 2);

    const lastHourRows = errors.filter(e => new Date(e.created_at) >= oneHourAgo).length;
    const previousHourRows = errors.filter(e => {
      const date = new Date(e.created_at);
      return date >= twoHoursAgo && date < oneHourAgo;
    }).length;

    const uniqueUsers = new Set(errors.map(e => e.visitor_id).filter(Boolean)).size;
    const uniqueFunctions = new Set(errors.map(e => e.function_name).filter(Boolean)).size;

    const criticalRows = errors.filter(e =>
      e.http_status && e.http_status >= 500
    ).length;

    return {
      totalErrors: counts ? counts.total : errors.length,
      lastHourErrors: counts ? counts.lastHour : lastHourRows,
      previousHourErrors: counts ? counts.previousHour : previousHourRows,
      uniqueUsers,
      uniqueFunctions,
      criticalErrors: counts ? counts.serverErrors : criticalRows,
    };
  }, [errors, counts]);

  // A change is a percentage only from an hour that had errors. From none it
  // is new: "+100%" read as a doubling when nothing came before it.
  const change = stats.previousHourErrors > 0
    ? Math.round(((stats.lastHourErrors - stats.previousHourErrors) / stats.previousHourErrors) * 100)
    : null;
  const direction = change !== null ? Math.sign(change) : stats.lastHourErrors > 0 ? 1 : 0;
  const changeText = change !== null
    ? `${change > 0 ? '+' : ''}${change}% vs prev hour`
    : stats.lastHourErrors > 0
      ? 'new this hour (none the hour before)'
      : 'none this hour or the hour before';

  const getTrendIcon = (d: number) => {
    if (d > 0) return <TrendingUp className="h-4 w-4 text-destructive" />;
    if (d < 0) return <TrendingDown className="h-4 w-4 text-green-500" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const getTrendColor = (d: number) => {
    if (d > 0) return 'text-destructive';
    if (d < 0) return 'text-green-500';
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
          <div className="text-3xl font-bold">{fmt(stats.totalErrors)}</div>
          <p className="text-xs text-muted-foreground">{rangeLabel}</p>
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
          <div className="text-3xl font-bold">{fmt(stats.lastHourErrors)}</div>
          <div className={`flex items-center gap-1 text-xs ${getTrendColor(direction)}`}>
            {getTrendIcon(direction)}
            <span>{changeText}</span>
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
          <div className="text-3xl font-bold text-destructive">{fmt(stats.criticalErrors)}</div>
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
          <div className="text-3xl font-bold">{fmt(stats.uniqueUsers)}</div>
          <p className="text-xs text-muted-foreground">
            Across {stats.uniqueFunctions} functions{counts && counts.total > errors.length ? ', in the rows shown' : ''}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
