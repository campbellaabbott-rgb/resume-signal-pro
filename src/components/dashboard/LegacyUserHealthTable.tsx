import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, AlertCircle, CheckCircle, User } from 'lucide-react';

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

interface LegacyUserHealthTableProps {
  errors: ErrorTelemetry[];
}

interface UserHealth {
  visitorId: string;
  errorCount: number;
  errorTypes: string[];
  lastError: string;
  status: 'healthy' | 'warning' | 'critical';
}

export function LegacyUserHealthTable({ errors }: LegacyUserHealthTableProps) {
  const userHealth = useMemo(() => {
    const userMap = new Map<string, { count: number; types: Set<string>; lastError: Date }>();
    
    errors.forEach(error => {
      const visitorId = error.visitor_id || 'anonymous';
      const existing = userMap.get(visitorId);
      const errorDate = new Date(error.created_at);
      
      if (existing) {
        existing.count++;
        existing.types.add(error.error_type);
        if (errorDate > existing.lastError) {
          existing.lastError = errorDate;
        }
      } else {
        userMap.set(visitorId, {
          count: 1,
          types: new Set([error.error_type]),
          lastError: errorDate
        });
      }
    });
    
    const users: UserHealth[] = [];
    userMap.forEach((data, visitorId) => {
      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (data.count >= 10) status = 'critical';
      else if (data.count >= 5) status = 'warning';
      
      users.push({
        visitorId,
        errorCount: data.count,
        errorTypes: Array.from(data.types),
        lastError: data.lastError.toISOString(),
        status
      });
    });
    
    // Sort by error count descending
    return users.sort((a, b) => b.errorCount - a.errorCount).slice(0, 10);
  }, [errors]);

  const getStatusIcon = (status: UserHealth['status']) => {
    switch (status) {
      case 'critical':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
  };

  const getStatusBadge = (status: UserHealth['status']) => {
    switch (status) {
      case 'critical':
        return <Badge variant="destructive">Critical</Badge>;
      case 'warning':
        return <Badge className="bg-yellow-500/20 text-yellow-600 hover:bg-yellow-500/30">Warning</Badge>;
      default:
        return <Badge className="bg-green-500/20 text-green-600 hover:bg-green-500/30">Healthy</Badge>;
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  if (userHealth.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            User Health Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <CheckCircle className="h-5 w-5 mr-2 text-green-500" />
            All users healthy - no errors detected
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          User Health Status
          <Badge variant="secondary" className="ml-auto">
            {userHealth.length} affected
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Visitor</TableHead>
              <TableHead>Errors</TableHead>
              <TableHead>Types</TableHead>
              <TableHead>Last Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {userHealth.map((user) => (
              <TableRow key={user.visitorId}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(user.status)}
                    {getStatusBadge(user.status)}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {user.visitorId.substring(0, 12)}...
                </TableCell>
                <TableCell>
                  <span className="font-semibold">{user.errorCount}</span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {user.errorTypes.map(type => (
                      <Badge key={type} variant="outline" className="text-xs">
                        {type}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatTime(user.lastError)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
