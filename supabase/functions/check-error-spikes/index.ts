// deploy-stamp: 2026-10-08T12:00Z
//
// IT NEVER RAN (register L10-20). Nothing called it: no cron, no page, no
// script, and a header-less cron could not have passed its admin-key check
// anyway, while 20261004110000 says browser errors "are mailed to the owner by
// check-error-spikes". Since 2026-10-08 it answers the owner's ADMIN_API_KEY
// (constant time) or the alerts cron key (x-alerts-cron, the vault key
// check-alerts uses, checked by alerts_cron_key_matches), and 20261008128000
// runs it every 15 minutes, the window detect_user_error_spikes looks at.
// It mails the owner ONLY when a visitor's errors spike, at most once in six
// hours (mail_door_take), from our alerts sender; it used to mail on any error
// in the window, which on a schedule would be a mail for every browser hiccup.
// The send's answer is read and said in the response.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { defang } from './defang.ts';
import { keyMatches } from '../_shared/admin-key.ts';

// Provable from outside without the key: every response, the preflight
// included, carries this in x-fn-build.
const FN_BUILD = 'check-error-spikes.2026-10-08.1';

/** At most one spike mail per this many minutes, however often it runs. */
const MAIL_COOLDOWN_MINUTES = 360;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key, x-alerts-cron',
  'Access-Control-Expose-Headers': 'x-fn-build',
  'x-fn-build': FN_BUILD,
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
    const unauthorized = () => new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    // The owner's key, or the alerts cron's. Anything else is refused before
    // a client exists.
    const byOwner = keyMatches(req.headers.get('x-admin-key') ?? '', Deno.env.get('ADMIN_API_KEY') ?? '');
    const cronKey = req.headers.get('x-alerts-cron') ?? '';
    if (!byOwner && cronKey.length < 32) {
      console.log('[ErrorCheck] Unauthorized access attempt');
      return unauthorized();
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminEmail = Deno.env.get('ADMIN_EMAIL');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    if (!byOwner) {
      const { data: matches, error: keyError } = await supabase.rpc('alerts_cron_key_matches', { p_key: cronKey });
      if (keyError || matches !== true) {
        if (keyError) console.error('[ErrorCheck] cron key check failed:', keyError.message?.slice(0, 160));
        return unauthorized();
      }
    }

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

    // Get overall error diagnostics (last hour for immediate issues)
    const { data: diagnostics, error: diagError } = await supabase.rpc('get_error_diagnostics', {
      p_hours_back: 1
    });

    if (diagError) {
      console.error('Failed to get diagnostics:', diagError);
    }

    // Get ALL recent errors (last 15 minutes)
    const { data: recentErrors, error: recentError } = await supabase
      .from('error_telemetry')
      .select('*')
      .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(100);

    if (recentError) {
      console.error('Failed to get recent errors:', recentError);
    }

    const activeSpikes = (spikes as ErrorSpike[] || []).filter(s => s.is_spike);
    const recentDiagnostics = diagnostics as ErrorDiagnostic[] || [];
    const allRecentErrors = recentErrors || [];

    // Log findings
    console.log(`[ErrorCheck] ${allRecentErrors.length} errors in last 15 min`);
    console.log(`[ErrorCheck] ${activeSpikes.length} user spikes detected`);
    console.log(`[ErrorCheck] ${recentDiagnostics.length} error types in last hour`);

    // A SPIKE is the alert: a visitor whose errors jumped past their own
    // baseline. Errors alone are in the response and on /errors. And one
    // mail per cooldown, so a spike that lasts an hour is one message.
    let mailed = false;
    let mailSkipped: string | null = activeSpikes.length === 0 ? 'no spike' : null;
    if (!mailSkipped && (!adminEmail || !resendApiKey)) mailSkipped = 'ADMIN_EMAIL or RESEND_API_KEY not set';
    if (!mailSkipped) {
      const { data: due, error: doorErr } = await supabase.rpc('mail_door_take', {
        p_door: 'check-error-spikes:owner', p_bucket: 'all', p_max: 1, p_window_minutes: MAIL_COOLDOWN_MINUTES,
      });
      if (doorErr) mailSkipped = 'cooldown count unavailable';
      else if (due !== true) mailSkipped = 'cooldown: a spike mail went out in the last 6 hours';
    }

    if (!mailSkipped) {
      // Every string below that came from error_telemetry was written by a
      // browser -- by anyone holding the publishable key -- so each passes
      // through defang() before it reaches the owner's inbox: no clickable
      // link, no mailto, capped. Counts and multipliers are ours and are not.
      const errorSummary = allRecentErrors.slice(0, 10).map((e: Record<string, unknown>) =>
        `- [${defang(e.error_type, 64)}] ${defang(e.error_code, 64)}: ${e.error_message ? defang(e.error_message) : 'No message'}\n  Function: ${e.function_name ? defang(e.function_name, 128) : 'N/A'} | Visitor: ${e.visitor_id ? defang(String(e.visitor_id).substring(0, 12), 12) : 'unknown'}...`
      ).join('\n');

      const spikeDetails = activeSpikes.length > 0
        ? activeSpikes.map(s =>
            `- Visitor ${defang(String(s.visitor_id ?? '').substring(0, 12), 12)}...: ${s.recent_error_count} errors (${Number(s.spike_multiplier).toFixed(1)}x baseline)\n  Types: ${(s.recent_error_types ?? []).map((t) => defang(t, 64)).join(', ')}`
          ).join('\n')
        : 'No spikes detected';

      const diagnosticSummary = recentDiagnostics.slice(0, 5).map(d =>
        `- ${defang(d.error_type, 64)}/${defang(d.error_code, 64)}: ${d.error_count} errors affecting ${d.unique_users} users`
      ).join('\n');

      const emailBody = `
Error Monitoring Report - ${new Date().toISOString()}

=== RECENT ERRORS (Last 15 min) ===
${allRecentErrors.length} error(s) detected:

${errorSummary || 'No recent errors'}

=== ERROR SPIKES ===
${activeSpikes.length} user(s) with unusual error rates:

${spikeDetails}

=== ERROR SUMMARY (Last Hour) ===
${diagnosticSummary || 'No errors in the last hour'}

---
Resume Booster error monitoring (check-error-spikes): at most one mail every 6 hours.
      `.trim();

      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Resume Booster Alerts <alerts@resend.dev>',
            to: adminEmail,
            subject: `[Error spike] ${activeSpikes.length} visitor(s) | ${allRecentErrors.length} error(s) in 15 min`,
            text: emailBody
          })
        });

        if (!emailRes.ok) {
          mailSkipped = `send refused: HTTP ${emailRes.status}`;
          console.error('Failed to send alert email:', (await emailRes.text()).slice(0, 200));
        } else {
          mailed = true;
          console.log('Alert email sent successfully');
        }
      } catch (emailError) {
        mailSkipped = 'send threw';
        console.error('Email sending error:', emailError);
      }
    }

    // Store detection results for historical tracking
    if (activeSpikes.length > 0) {
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
        recent_errors_count: allRecentErrors.length,
        recent_errors: allRecentErrors.slice(0, 20),
        spikes_found: activeSpikes.length,
        mailed,
        mail_skipped: mailSkipped,
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