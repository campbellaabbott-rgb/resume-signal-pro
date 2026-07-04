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
    
    // Delivery health
    const { data: deliveryData } = await supabase.rpc('get_delivery_health', { p_hours_back: 1 });
    if (deliveryData?.[0]) {
      metrics.delivery_rate = deliveryData[0].delivery_rate || 100;
    }
    
    // AI quality
    const { data: aiData } = await supabase.rpc('get_ai_quality_stats', { p_hours_back: 1 });
    if (aiData?.[0]) {
      metrics.ai_success_rate = aiData[0].success_rate || 100;
    }
    
    // Email health
    const { data: emailData } = await supabase.rpc('get_email_health', { p_hours_back: 1 });
    if (emailData?.[0]) {
      metrics.email_success_rate = emailData[0].success_rate || 100;
    }
    
    // Webhook health
    const { data: webhookData } = await supabase.rpc('get_webhook_health', { p_hours_back: 1 });
    if (webhookData?.[0]) {
      const failRate = webhookData[0].total_received > 0 
        ? ((webhookData[0].processing_failed || 0) / webhookData[0].total_received) * 100 
        : 0;
      metrics.webhook_failure_rate = failRate;
    }
    
    // Parse failures
    const { data: parseData } = await supabase.rpc('get_parse_failure_stats', { p_hours_back: 1 });
    if (parseData?.[0]) {
      metrics.parse_failure_count = parseData[0].total_failures || 0;
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
