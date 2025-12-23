import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Bug, Server, Clock, Users } from 'lucide-react';

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

interface ErrorDiagnosticsProps {
  errors: ErrorTelemetry[];
}

interface DiagnosticGroup {
  errorType: string;
  errorCode: string;
  count: number;
  percentage: number;
  affectedUsers: number;
  affectedFunctions: string[];
  sampleMessage: string | null;
  mostRecent: string;
}

export function ErrorDiagnostics({ errors }: ErrorDiagnosticsProps) {
  const diagnostics = useMemo(() => {
    const groupMap = new Map<string, {
      count: number;
      users: Set<string>;
      functions: Set<string>;
      message: string | null;
      recent: Date;
      type: string;
      code: string;
    }>();
    
    errors.forEach(error => {
      const key = `${error.error_type}:${error.error_code}`;
      const existing = groupMap.get(key);
      const errorDate = new Date(error.created_at);
      
      if (existing) {
        existing.count++;
        if (error.visitor_id) existing.users.add(error.visitor_id);
        if (error.function_name) existing.functions.add(error.function_name);
        if (errorDate > existing.recent) {
          existing.recent = errorDate;
          existing.message = error.error_message;
        }
      } else {
        groupMap.set(key, {
          count: 1,
          users: new Set(error.visitor_id ? [error.visitor_id] : []),
          functions: new Set(error.function_name ? [error.function_name] : []),
          message: error.error_message,
          recent: errorDate,
          type: error.error_type,
          code: error.error_code
        });
      }
    });
    
    const total = errors.length || 1;
    const groups: DiagnosticGroup[] = [];
    
    groupMap.forEach((data, key) => {
      groups.push({
        errorType: data.type,
        errorCode: data.code,
        count: data.count,
        percentage: (data.count / total) * 100,
        affectedUsers: data.users.size,
        affectedFunctions: Array.from(data.functions),
        sampleMessage: data.message,
        mostRecent: data.recent.toISOString()
      });
    });
    
    return groups.sort((a, b) => b.count - a.count).slice(0, 6);
  }, [errors]);

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'rate_limit':
        return 'bg-yellow-500/20 text-yellow-600';
      case 'api':
        return 'bg-red-500/20 text-red-600';
      case 'client':
        return 'bg-blue-500/20 text-blue-600';
      default:
        return 'bg-gray-500/20 text-gray-600';
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  if (diagnostics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            Error Diagnostics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            No errors to diagnose
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bug className="h-5 w-5" />
          Error Diagnostics
          <Badge variant="secondary" className="ml-auto">
            {errors.length} total
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {diagnostics.map((diag) => (
          <div 
            key={`${diag.errorType}:${diag.errorCode}`}
            className="border rounded-lg p-4 space-y-3"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Badge className={getTypeColor(diag.errorType)}>
                  {diag.errorType}
                </Badge>
                <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                  {diag.errorCode}
                </code>
              </div>
              <span className="text-2xl font-bold">{diag.count}</span>
            </div>
            
            <Progress value={diag.percentage} className="h-2" />
            
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Users className="h-4 w-4" />
                <span>{diag.affectedUsers} users</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Server className="h-4 w-4" />
                <span>{diag.affectedFunctions.length} functions</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>{formatTime(diag.mostRecent)}</span>
              </div>
            </div>
            
            {diag.sampleMessage && (
              <p className="text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded truncate">
                {diag.sampleMessage}
              </p>
            )}
            
            {diag.affectedFunctions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {diag.affectedFunctions.map(fn => (
                  <Badge key={fn} variant="outline" className="text-xs font-mono">
                    {fn}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
