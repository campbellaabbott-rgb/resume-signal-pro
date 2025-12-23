import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ErrorSpike {
  visitor_id: string;
  recent_error_count: number;
  baseline_hourly_rate: number;
  spike_multiplier: number;
  recent_error_types: string[];
  last_error_at: string;
  is_spike: boolean;
}

interface ErrorDiagnostic {
  error_type: string;
  error_code: string;
  error_count: number;
  unique_users: number;
  avg_per_user: number;
  most_recent: string;
  sample_message: string;
  affected_functions: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminEmail = Deno.env.get('ADMIN_EMAIL');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Detect user error spikes
    const { data: spikes, error: spikeError } = await supabase.rpc('detect_user_error_spikes', {
      p_spike_threshold: 5,
      p_recent_minutes: 15,
      p_baseline_hours: 24
    });

    if (spikeError) {
      console.error('Failed to detect spikes:', spikeError);
      throw spikeError;
    }

    // Get overall error diagnostics
    const { data: diagnostics, error: diagError } = await supabase.rpc('get_error_diagnostics', {
      p_hours_back: 1 // Last hour for immediate issues
    });

    if (diagError) {
      console.error('Failed to get diagnostics:', diagError);
    }

    const activeSpikes = (spikes as ErrorSpike[] || []).filter(s => s.is_spike);
    const recentDiagnostics = diagnostics as ErrorDiagnostic[] || [];

    // Log findings
    console.log(`[ErrorSpike Check] Found ${activeSpikes.length} user spikes`);
    console.log(`[ErrorSpike Check] ${recentDiagnostics.length} error types in last hour`);

    // If there are critical spikes, send alert email
    if (activeSpikes.length > 0 && adminEmail && resendApiKey) {
      const spikeDetails = activeSpikes.map(s => 
        `- Visitor ${s.visitor_id.substring(0, 12)}...: ${s.recent_error_count} errors (${s.spike_multiplier.toFixed(1)}x baseline)\n  Types: ${s.recent_error_types.join(', ')}`
      ).join('\n');

      const diagnosticSummary = recentDiagnostics.slice(0, 5).map(d =>
        `- ${d.error_type}/${d.error_code}: ${d.error_count} errors affecting ${d.unique_users} users`
      ).join('\n');

      const emailBody = `
Error Spike Alert - ${new Date().toISOString()}

${activeSpikes.length} user(s) experiencing error spikes:

${spikeDetails}

Top Error Types (Last Hour):
${diagnosticSummary || 'No errors in the last hour'}

---
This is an automated alert from ResumeBee error monitoring.
      `.trim();

      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'ResumeBee Alerts <alerts@resend.dev>',
            to: adminEmail,
            subject: `[Alert] ${activeSpikes.length} Error Spike(s) Detected`,
            text: emailBody
          })
        });

        if (!emailRes.ok) {
          console.error('Failed to send alert email:', await emailRes.text());
        } else {
          console.log('Alert email sent successfully');
        }
      } catch (emailError) {
        console.error('Email sending error:', emailError);
      }
    }

    // Store spike detection results for historical tracking
    if (activeSpikes.length > 0) {
      // Log to error_telemetry for tracking
      await supabase.rpc('log_error_telemetry', {
        p_error_type: 'spike_detection',
        p_error_code: 'SPIKES_DETECTED',
        p_error_message: `Detected ${activeSpikes.length} user error spikes`,
        p_context: {
          spikes: activeSpikes.map(s => ({
            visitor_id: s.visitor_id,
            count: s.recent_error_count,
            multiplier: s.spike_multiplier,
            types: s.recent_error_types
          })),
          checked_at: new Date().toISOString()
        },
        p_function_name: 'check-error-spikes'
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        checked_at: new Date().toISOString(),
        spikes_found: activeSpikes.length,
        spikes: activeSpikes,
        diagnostics: recentDiagnostics.slice(0, 10)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error spike check failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});