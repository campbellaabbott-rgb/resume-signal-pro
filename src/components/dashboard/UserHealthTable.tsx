import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Users, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  User,
  Clock,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface UserErrorSpike {
  visitor_id: string;
  recent_error_count: number;
  baseline_hourly_rate: number;
  spike_multiplier: number;
  is_spike: boolean;
  last_error_at: string;
  recent_error_types: string[];
}

interface UserHealth {
  status: string;
  error_trend: string;
  primary_issue: string;
  recent_errors: number;
  recommendation: string;
}

interface UserHealthDetails {
  visitor_id: string;
  spike: UserErrorSpike;
  health?: UserHealth;
  loading?: boolean;
}

export function UserHealthTable() {
  const [userSpikes, setUserSpikes] = useState<UserErrorSpike[]>([]);
  const [userDetails, setUserDetails] = useState<Record<string, UserHealthDetails>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  const fetchUserSpikes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('detect_user_error_spikes', {
        p_baseline_hours: 24,
        p_recent_minutes: 60,
        p_spike_threshold: 2
      });

      if (rpcError) throw rpcError;

      const spikes = (data || []) as UserErrorSpike[];
      setUserSpikes(spikes);

      // Initialize details for each user
      const details: Record<string, UserHealthDetails> = {};
      spikes.forEach(spike => {
        details[spike.visitor_id] = { visitor_id: spike.visitor_id, spike };
      });
      setUserDetails(details);
    } catch (e) {
      console.error('Failed to fetch user spikes:', e);
      setError(e instanceof Error ? e.message : 'Failed to fetch user health data');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUserHealth = async (visitorId: string) => {
    setUserDetails(prev => ({
      ...prev,
      [visitorId]: { ...prev[visitorId], loading: true }
    }));

    try {
      const { data, error: rpcError } = await supabase.rpc('check_user_health', {
        p_visitor_id: visitorId
      });

      if (rpcError) throw rpcError;

      const health = data?.[0] as UserHealth | undefined;
      setUserDetails(prev => ({
        ...prev,
        [visitorId]: { ...prev[visitorId], health, loading: false }
      }));
    } catch (e) {
      console.error('Failed to fetch user health:', e);
      setUserDetails(prev => ({
        ...prev,
        [visitorId]: { ...prev[visitorId], loading: false }
      }));
    }
  };

  useEffect(() => {
    fetchUserSpikes();
    const interval = setInterval(fetchUserSpikes, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [fetchUserSpikes]);

  const toggleExpand = (visitorId: string) => {
    const newExpanded = new Set(expandedUsers);
    if (newExpanded.has(visitorId)) {
      newExpanded.delete(visitorId);
    } else {
      newExpanded.add(visitorId);
      // Fetch detailed health if not already loaded
      if (!userDetails[visitorId]?.health) {
        fetchUserHealth(visitorId);
      }
    }
    setExpandedUsers(newExpanded);
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'healthy': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'warning': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend?.toLowerCase()) {
      case 'improving': return <TrendingDown className="h-4 w-4 text-green-400" />;
      case 'worsening': return <TrendingUp className="h-4 w-4 text-red-400" />;
      default: return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getSpikeColor = (multiplier: number) => {
    if (multiplier >= 5) return 'text-red-400';
    if (multiplier >= 3) return 'text-yellow-400';
    return 'text-orange-400';
  };

  const formatVisitorId = (id: string) => {
    if (!id) return 'Unknown';
    if (id.length <= 12) return id;
    return `${id.slice(0, 6)}...${id.slice(-4)}`;
  };

  const formatTimestamp = (timestamp: string) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const activeSpikes = userSpikes.filter(s => s.is_spike);
  const recentErrors = userSpikes.filter(s => !s.is_spike && s.recent_error_count > 0);

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-primary" />
            User Health Monitor
          </CardTitle>
          <div className="flex items-center gap-2">
            {activeSpikes.length > 0 && (
              <Badge variant="destructive" className="animate-pulse">
                {activeSpikes.length} spike{activeSpikes.length !== 1 ? 's' : ''}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchUserSpikes}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="text-center py-6 text-red-400">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            <p className="text-sm">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchUserSpikes} className="mt-2">
              Retry
            </Button>
          </div>
        ) : loading && userSpikes.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin" />
            <p className="text-sm">Loading user health data...</p>
          </div>
        ) : userSpikes.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500 opacity-70" />
            <p className="text-sm font-medium">No user issues detected</p>
            <p className="text-xs mt-1">All users are experiencing normal error rates</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-background/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-400">{activeSpikes.length}</div>
                <div className="text-xs text-muted-foreground">Active Spikes</div>
              </div>
              <div className="bg-background/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-yellow-400">{recentErrors.length}</div>
                <div className="text-xs text-muted-foreground">With Errors</div>
              </div>
              <div className="bg-background/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-foreground">
                  {userSpikes.reduce((sum, s) => sum + s.recent_error_count, 0)}
                </div>
                <div className="text-xs text-muted-foreground">Total Errors (1h)</div>
              </div>
            </div>

            {/* Active Spikes Section */}
            {activeSpikes.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-red-400 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Active Error Spikes
                </h4>
                <div className="space-y-2">
                  {activeSpikes.map(spike => (
                    <UserRow
                      key={spike.visitor_id}
                      spike={spike}
                      details={userDetails[spike.visitor_id]}
                      isExpanded={expandedUsers.has(spike.visitor_id)}
                      onToggle={() => toggleExpand(spike.visitor_id)}
                      formatVisitorId={formatVisitorId}
                      formatTimestamp={formatTimestamp}
                      getStatusColor={getStatusColor}
                      getTrendIcon={getTrendIcon}
                      getSpikeColor={getSpikeColor}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Recent Errors Section */}
            {recentErrors.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-yellow-400 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Recent Errors (No Spike)
                </h4>
                <div className="space-y-2">
                  {recentErrors.slice(0, 5).map(spike => (
                    <UserRow
                      key={spike.visitor_id}
                      spike={spike}
                      details={userDetails[spike.visitor_id]}
                      isExpanded={expandedUsers.has(spike.visitor_id)}
                      onToggle={() => toggleExpand(spike.visitor_id)}
                      formatVisitorId={formatVisitorId}
                      formatTimestamp={formatTimestamp}
                      getStatusColor={getStatusColor}
                      getTrendIcon={getTrendIcon}
                      getSpikeColor={getSpikeColor}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface UserRowProps {
  spike: UserErrorSpike;
  details?: UserHealthDetails;
  isExpanded: boolean;
  onToggle: () => void;
  formatVisitorId: (id: string) => string;
  formatTimestamp: (ts: string) => string;
  getStatusColor: (status: string) => string;
  getTrendIcon: (trend: string) => React.ReactNode;
  getSpikeColor: (multiplier: number) => string;
}

function UserRow({
  spike,
  details,
  isExpanded,
  onToggle,
  formatVisitorId,
  formatTimestamp,
  getStatusColor,
  getTrendIcon,
  getSpikeColor
}: UserRowProps) {
  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className={`rounded-lg border ${spike.is_spike ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-background/30'}`}>
        <CollapsibleTrigger asChild>
          <button className="w-full p-3 flex items-center justify-between hover:bg-muted/20 transition-colors rounded-lg">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${spike.is_spike ? 'bg-red-500/20' : 'bg-muted'}`}>
                <User className={`h-4 w-4 ${spike.is_spike ? 'text-red-400' : 'text-muted-foreground'}`} />
              </div>
              <div className="text-left">
                <div className="font-mono text-sm">{formatVisitorId(spike.visitor_id)}</div>
                <div className="text-xs text-muted-foreground">
                  {spike.recent_error_count} error{spike.recent_error_count !== 1 ? 's' : ''} • Last: {formatTimestamp(spike.last_error_at)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {spike.is_spike && (
                <Badge variant="outline" className={`${getSpikeColor(spike.spike_multiplier)} border-current`}>
                  {spike.spike_multiplier.toFixed(1)}x spike
                </Badge>
              )}
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 pt-0 border-t border-border/50 mt-0">
            {details?.loading ? (
              <div className="py-4 text-center text-muted-foreground">
                <RefreshCw className="h-4 w-4 mx-auto animate-spin" />
                <p className="text-xs mt-1">Loading details...</p>
              </div>
            ) : details?.health ? (
              <div className="grid gap-3 pt-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Status:</span>
                  <Badge className={getStatusColor(details.health.status)}>
                    {details.health.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground ml-2">Trend:</span>
                  {getTrendIcon(details.health.error_trend)}
                  <span className="text-xs">{details.health.error_trend}</span>
                </div>
                
                {details.health.primary_issue && (
                  <div className="bg-muted/30 rounded p-2">
                    <span className="text-xs font-medium text-muted-foreground">Primary Issue:</span>
                    <p className="text-sm mt-1">{details.health.primary_issue}</p>
                  </div>
                )}
                
                {details.health.recommendation && (
                  <div className="bg-primary/10 rounded p-2 border border-primary/20">
                    <span className="text-xs font-medium text-primary">Recommendation:</span>
                    <p className="text-sm mt-1">{details.health.recommendation}</p>
                  </div>
                )}

                {spike.recent_error_types && spike.recent_error_types.length > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground">Error Types:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {spike.recent_error_types.map((type, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {type}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-3">
                {spike.recent_error_types && spike.recent_error_types.length > 0 && (
                  <div>
                    <span className="text-xs text-muted-foreground">Error Types:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {spike.recent_error_types.map((type, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {type}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-2">
                  Baseline: {spike.baseline_hourly_rate.toFixed(1)} errors/hour
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
