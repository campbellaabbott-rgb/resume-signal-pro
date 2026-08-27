// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AlertConfig {
  name: string;
  metric: string;
  threshold: number;
  operator: 'lt' | 'gt';
  severity: 'warning' | 'critical';
}

const ALERT_CONFIGS: AlertConfig[] = [
  { name: 'Delivery Rate Low', metric: 'delivery_rate', threshold: 90, operator: 'lt', severity: 'critical' },
  { name: 'AI Success Rate Low', metric: 'ai_success_rate', threshold: 90, operator: 'lt', severity: 'critical' },
  { name: 'Email Success Rate Low', metric: 'email_success_rate', threshold: 90, operator: 'lt', severity: 'warning' },
  { name: 'Webhook Failures Spike', metric: 'webhook_failure_rate', threshold: 10, operator: 'gt', severity: 'critical' },
  { name: 'Parse Failures High', metric: 'parse_failure_count', threshold: 5, operator: 'gt', severity: 'warning' },
];

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CHECK-ALERTS] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Starting alert check");
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const adminEmail = Deno.env.get("ADMIN_EMAIL");
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    if (!resendKey || !adminEmail) {
      logStep("Skipping - missing RESEND_API_KEY or ADMIN_EMAIL");
      return new Response(JSON.stringify({ skipped: true, reason: "Missing email config" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    
    const resend = new Resend(resendKey);
    const triggeredAlerts: Array<{ name: string; value: number; threshold: number; severity: string }> = [];
    
    // Gather metrics
    const metrics: Record<string, number> = {};
    // A health check that could not RUN is not a healthy one. Every RPC below
    // dropped its error, so a failing or timing-out check simply left its metric
    // unset and the alert was skipped in silence — the monitor going blind and
    // the monitor reporting "all clear" looked identical from outside.
    const unavailable: string[] = [];
    // deno-lint-ignore no-explicit-any
    const health = async (fn: string): Promise<any | null> => {
      const { data, error } = await supabase.rpc(fn, { p_hours_back: 1 });
      if (error) {
        unavailable.push(fn);
        logStep("Health RPC failed — alert cannot be evaluated", { fn, error: error.message?.slice(0, 160) });
        return null;
      }
      return data?.[0] ?? null;
    };

    // `?? 100`, NEVER `|| 100`, AND THIS IS THE WHOLE BUG.
    //
    // These were `x.delivery_rate || 100`. Zero is falsy, so a 0% success rate —
    // every delivery failed, the AI gateway is down, the mail key was rotated —
    // became 100. All three of these are `lt` alerts, firing when the value
    // drops BELOW a threshold, so the total-outage case was the one case that
    // could never trigger them. The worse the incident, the healthier it read.
    //
    // `??` keeps the intended behaviour for a genuinely empty window (no
    // deliveries attempted in the last hour is not a failure) while letting a
    // real zero through as a real zero.
    const deliveryData = await health('get_delivery_health');
    if (deliveryData) metrics.delivery_rate = deliveryData.delivery_rate ?? 100;

    const aiData = await health('get_ai_quality_stats');
    if (aiData) metrics.ai_success_rate = aiData.success_rate ?? 100;

    const emailData = await health('get_email_health');
    if (emailData) metrics.email_success_rate = emailData.success_rate ?? 100;

    const webhookData = await health('get_webhook_health');
    if (webhookData) {
      const total = webhookData.total_received ?? 0;
      metrics.webhook_failure_rate = total > 0 ? ((webhookData.processing_failed ?? 0) / total) * 100 : 0;
    }

    const parseData = await health('get_parse_failure_stats');
    if (parseData) metrics.parse_failure_count = parseData.total_failures ?? 0;

    if (unavailable.length) {
      logStep("ALERTS BLIND — these checks could not be evaluated", { unavailable });
    }
    
    logStep("Metrics gathered", metrics);
    
    // Check each alert condition
    for (const config of ALERT_CONFIGS) {
      const value = metrics[config.metric];
      if (value === undefined) continue;
      
      const triggered = config.operator === 'lt' ? value < config.threshold : value > config.threshold;
      
      if (triggered) {
        // Check cooldown
        const { data: shouldSend } = await supabase.rpc('should_send_alert', {
          p_alert_type: config.severity,
          p_metric_name: config.name,
          p_cooldown_minutes: 60
        });
        
        if (shouldSend) {
          triggeredAlerts.push({
            name: config.name,
            value,
            threshold: config.threshold,
            severity: config.severity
          });
        } else {
          logStep(`Alert ${config.name} in cooldown`);
        }
      }
    }
    
    // Send consolidated alert if any triggered
    if (triggeredAlerts.length > 0) {
      logStep("Sending alerts", { count: triggeredAlerts.length });
      
      const criticalAlerts = triggeredAlerts.filter(a => a.severity === 'critical');
      const warningAlerts = triggeredAlerts.filter(a => a.severity === 'warning');
      
      const subject = criticalAlerts.length > 0 
        ? `🚨 CRITICAL: ${criticalAlerts.length} system alert(s) require attention`
        : `⚠️ WARNING: ${warningAlerts.length} system alert(s)`;
      
      // Find matching config for each alert to get the operator
      const getOperator = (alertName: string) => {
        const config = ALERT_CONFIGS.find(c => c.name === alertName);
        return config?.operator || 'lt';
      };
      
      const alertRows = triggeredAlerts.map(a => `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 12px;">
            <span style="color: ${a.severity === 'critical' ? '#dc2626' : '#d97706'}; font-weight: 600;">
              ${a.severity === 'critical' ? '🔴' : '🟡'} ${a.name}
            </span>
          </td>
          <td style="padding: 12px; font-family: monospace;">${a.value.toFixed(1)}</td>
          <td style="padding: 12px; font-family: monospace;">${getOperator(a.name) === 'lt' ? '≥' : '≤'} ${a.threshold}</td>
        </tr>
      `).join('');
      
      await resend.emails.send({
        from: "Resume Booster Alerts <alerts@resend.dev>",
        to: [adminEmail],
        subject,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: ${criticalAlerts.length > 0 ? '#dc2626' : '#d97706'}; margin-bottom: 20px;">
              System Alert Report
            </h2>
            
            <p style="margin-bottom: 20px;">The following metrics have breached their thresholds:</p>
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
              <thead>
                <tr style="background: #f9fafb;">
                  <th style="padding: 12px; text-align: left;">Alert</th>
                  <th style="padding: 12px; text-align: left;">Current</th>
                  <th style="padding: 12px; text-align: left;">Threshold</th>
                </tr>
              </thead>
              <tbody>
                ${alertRows}
              </tbody>
            </table>
            
            <div style="margin-top: 24px;">
              <a href="${Deno.env.get('SITE_URL') || 'https://resumebooster.lovable.app'}/health-check" 
                 style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px;">
                View Health Dashboard
              </a>
            </div>
            
            <p style="margin-top: 24px; color: #9ca3af; font-size: 12px;">
              This alert will not repeat for 60 minutes per metric.
            </p>
          </div>
        `,
      });
      
      // Log each alert sent
      for (const alert of triggeredAlerts) {
        await supabase.rpc('log_alert_sent', {
          p_alert_type: alert.severity,
          p_metric_name: alert.name,
          p_threshold: alert.threshold,
          p_actual: alert.value,
          p_sent_to: adminEmail,
          p_success: true
        });
      }
      
      logStep("Alerts sent successfully", { count: triggeredAlerts.length });
    } else {
      logStep("No alerts triggered");
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      metrics,
      alertsTriggered: triggeredAlerts.length,
      alerts: triggeredAlerts
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CHECK-ALERTS] Error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
