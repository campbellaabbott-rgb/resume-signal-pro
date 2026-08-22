export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ab_test_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          test_name: string
          variant: string
          visitor_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          test_name: string
          variant: string
          visitor_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          test_name?: string
          variant?: string
          visitor_id?: string
        }
        Relationships: []
      }
      affiliate_clicks: {
        Row: {
          affiliate_id: string
          created_at: string
          id: string
          ip_hash: string | null
          referrer: string | null
          user_agent: string | null
        }
        Insert: {
          affiliate_id: string
          created_at?: string
          id?: string
          ip_hash?: string | null
          referrer?: string | null
          user_agent?: string | null
        }
        Update: {
          affiliate_id?: string
          created_at?: string
          id?: string
          ip_hash?: string | null
          referrer?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_clicks_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_conversions: {
        Row: {
          affiliate_id: string
          commission_amount: number
          created_at: string
          id: string
          paid_at: string | null
          product_name: string | null
          sale_amount: number
          status: string
          stripe_session_id: string
        }
        Insert: {
          affiliate_id: string
          commission_amount: number
          created_at?: string
          id?: string
          paid_at?: string | null
          product_name?: string | null
          sale_amount: number
          status?: string
          stripe_session_id: string
        }
        Update: {
          affiliate_id?: string
          commission_amount?: number
          created_at?: string
          id?: string
          paid_at?: string | null
          product_name?: string | null
          sale_amount?: number
          status?: string
          stripe_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_conversions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_sessions: {
        Row: {
          affiliate_id: string
          created_at: string
          expires_at: string
          id: string
          session_token: string
        }
        Insert: {
          affiliate_id: string
          created_at?: string
          expires_at?: string
          id?: string
          session_token?: string
        }
        Update: {
          affiliate_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          session_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_sessions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          commission_amount: number
          created_at: string
          email: string
          id: string
          paid_out: number
          password_hash: string
          pending_payout: number
          referral_code: string
          status: string
          total_earnings: number
          updated_at: string
        }
        Insert: {
          commission_amount?: number
          created_at?: string
          email: string
          id?: string
          paid_out?: number
          password_hash: string
          pending_payout?: number
          referral_code?: string
          status?: string
          total_earnings?: number
          updated_at?: string
        }
        Update: {
          commission_amount?: number
          created_at?: string
          email?: string
          id?: string
          paid_out?: number
          password_hash?: string
          pending_payout?: number
          referral_code?: string
          status?: string
          total_earnings?: number
          updated_at?: string
        }
        Relationships: []
      }
      agent_learned_answers: {
        Row: {
          answer_kind: string
          answer_value: string
          created_at: string
          id: number
          question_key: string
          question_label: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answer_kind: string
          answer_value?: string
          created_at?: string
          id?: never
          question_key: string
          question_label: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answer_kind?: string
          answer_value?: string
          created_at?: string
          id?: never
          question_key?: string
          question_label?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_mandates: {
        Row: {
          active: boolean
          address: string | null
          apply_mode: string
          auto_apply_daily_cap: number
          auto_apply_sources: string[]
          auto_released_count: number
          blocked_companies: string[]
          category: string
          city: string
          consent_to_processing: boolean
          countries: string | null
          country: string
          cover_note: string | null
          created_at: string
          daily_count: number
          earliest_start: string
          email: string
          email_last_sent_at: string | null
          email_opt_in: boolean
          employer_cooldown_days: number
          full_name: string
          hold_first_n: number
          include_uncategorised: boolean
          last_prepare_kick_at: string | null
          last_run_at: string | null
          last_run_summary: Json | null
          linkedin: string
          location: string
          max_age_days: number | null
          pause_reason: string
          paused_until: string | null
          phone: string
          postcode: string | null
          q: string
          remote_only: boolean
          requires_sponsorship: boolean | null
          resume_file_url: string
          resume_text: string
          salary_expectation: string
          salary_min: number | null
          share_demographics: boolean
          tailor_cover_note: boolean
          undo_window_seconds: number
          updated_at: string
          user_id: string
          website: string
          willing_to_relocate: boolean | null
          work_authorized: boolean | null
          work_authorized_countries: string[]
        }
        Insert: {
          active?: boolean
          address?: string | null
          apply_mode?: string
          auto_apply_daily_cap?: number
          auto_apply_sources?: string[]
          auto_released_count?: number
          blocked_companies?: string[]
          category?: string
          city?: string
          consent_to_processing?: boolean
          countries?: string | null
          country?: string
          cover_note?: string | null
          created_at?: string
          daily_count?: number
          earliest_start?: string
          email?: string
          email_last_sent_at?: string | null
          email_opt_in?: boolean
          employer_cooldown_days?: number
          full_name?: string
          hold_first_n?: number
          include_uncategorised?: boolean
          last_prepare_kick_at?: string | null
          last_run_at?: string | null
          last_run_summary?: Json | null
          linkedin?: string
          location?: string
          max_age_days?: number | null
          pause_reason?: string
          paused_until?: string | null
          phone?: string
          postcode?: string | null
          q?: string
          remote_only?: boolean
          requires_sponsorship?: boolean | null
          resume_file_url?: string
          resume_text?: string
          salary_expectation?: string
          salary_min?: number | null
          share_demographics?: boolean
          tailor_cover_note?: boolean
          undo_window_seconds?: number
          updated_at?: string
          user_id: string
          website?: string
          willing_to_relocate?: boolean | null
          work_authorized?: boolean | null
          work_authorized_countries?: string[]
        }
        Update: {
          active?: boolean
          address?: string | null
          apply_mode?: string
          auto_apply_daily_cap?: number
          auto_apply_sources?: string[]
          auto_released_count?: number
          blocked_companies?: string[]
          category?: string
          city?: string
          consent_to_processing?: boolean
          countries?: string | null
          country?: string
          cover_note?: string | null
          created_at?: string
          daily_count?: number
          earliest_start?: string
          email?: string
          email_last_sent_at?: string | null
          email_opt_in?: boolean
          employer_cooldown_days?: number
          full_name?: string
          hold_first_n?: number
          include_uncategorised?: boolean
          last_prepare_kick_at?: string | null
          last_run_at?: string | null
          last_run_summary?: Json | null
          linkedin?: string
          location?: string
          max_age_days?: number | null
          pause_reason?: string
          paused_until?: string | null
          phone?: string
          postcode?: string | null
          q?: string
          remote_only?: boolean
          requires_sponsorship?: boolean | null
          resume_file_url?: string
          resume_text?: string
          salary_expectation?: string
          salary_min?: number | null
          share_demographics?: boolean
          tailor_cover_note?: boolean
          undo_window_seconds?: number
          updated_at?: string
          user_id?: string
          website?: string
          willing_to_relocate?: boolean | null
          work_authorized?: boolean | null
          work_authorized_countries?: string[]
        }
        Relationships: []
      }
      agent_pending_questions: {
        Row: {
          answer_kind: string
          company: string | null
          first_seen_at: string
          id: number
          last_seen_at: string
          options: Json
          posting_id: string | null
          question_key: string
          question_label: string
          refusal_reason: string
          seen_count: number
          user_id: string
        }
        Insert: {
          answer_kind: string
          company?: string | null
          first_seen_at?: string
          id?: never
          last_seen_at?: string
          options?: Json
          posting_id?: string | null
          question_key: string
          question_label: string
          refusal_reason?: string
          seen_count?: number
          user_id: string
        }
        Update: {
          answer_kind?: string
          company?: string | null
          first_seen_at?: string
          id?: never
          last_seen_at?: string
          options?: Json
          posting_id?: string | null
          question_key?: string
          question_label?: string
          refusal_reason?: string
          seen_count?: number
          user_id?: string
        }
        Relationships: []
      }
      agent_queue: {
        Row: {
          apply_url: string
          category: string
          company: string
          company_token: string
          created_at: string
          decided_at: string | null
          fit_pct: number | null
          id: number
          location: string
          posted_at: string | null
          posting_id: string
          reasons: Json
          salary: string
          search_id: number | null
          search_label: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          apply_url?: string
          category?: string
          company?: string
          company_token?: string
          created_at?: string
          decided_at?: string | null
          fit_pct?: number | null
          id?: never
          location?: string
          posted_at?: string | null
          posting_id: string
          reasons?: Json
          salary?: string
          search_id?: number | null
          search_label?: string
          status?: string
          title?: string
          user_id: string
        }
        Update: {
          apply_url?: string
          category?: string
          company?: string
          company_token?: string
          created_at?: string
          decided_at?: string | null
          fit_pct?: number | null
          id?: never
          location?: string
          posted_at?: string | null
          posting_id?: string
          reasons?: Json
          salary?: string
          search_id?: number | null
          search_label?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_queue_search_id_fkey"
            columns: ["search_id"]
            isOneToOne: false
            referencedRelation: "agent_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_searches: {
        Row: {
          active: boolean
          category: string
          countries: string | null
          created_at: string
          daily_count: number
          id: number
          include_uncategorised: boolean
          label: string
          last_run_at: string | null
          last_run_summary: Json | null
          location: string
          max_age_days: number | null
          q: string
          remote_only: boolean
          salary_min: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          category?: string
          countries?: string | null
          created_at?: string
          daily_count?: number
          id?: never
          include_uncategorised?: boolean
          label?: string
          last_run_at?: string | null
          last_run_summary?: Json | null
          location?: string
          max_age_days?: number | null
          q?: string
          remote_only?: boolean
          salary_min?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          category?: string
          countries?: string | null
          created_at?: string
          daily_count?: number
          id?: never
          include_uncategorised?: boolean
          label?: string
          last_run_at?: string | null
          last_run_summary?: Json | null
          location?: string
          max_age_days?: number | null
          q?: string
          remote_only?: boolean
          salary_min?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_submissions: {
        Row: {
          answers: Json
          apply_url: string
          attempts: number
          blockers: Json
          claimable_at: string | null
          claimed_at: string | null
          claimed_by: string
          company: string
          company_token: string
          cover_letter: string
          created_at: string
          error: string
          fields: Json
          fit_pct: number | null
          id: number
          posting_id: string
          prepared_at: string | null
          questions: Json
          questions_are_real: boolean
          release_refusal: string
          released_at: string | null
          resume_version_id: string | null
          sent_answers: Json
          sent_evidence: string
          source: string
          status: string
          submitted_at: string | null
          submitted_via: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          apply_url?: string
          attempts?: number
          blockers?: Json
          claimable_at?: string | null
          claimed_at?: string | null
          claimed_by?: string
          company?: string
          company_token?: string
          cover_letter?: string
          created_at?: string
          error?: string
          fields?: Json
          fit_pct?: number | null
          id?: never
          posting_id: string
          prepared_at?: string | null
          questions?: Json
          questions_are_real?: boolean
          release_refusal?: string
          released_at?: string | null
          resume_version_id?: string | null
          sent_answers?: Json
          sent_evidence?: string
          source?: string
          status?: string
          submitted_at?: string | null
          submitted_via?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          apply_url?: string
          attempts?: number
          blockers?: Json
          claimable_at?: string | null
          claimed_at?: string | null
          claimed_by?: string
          company?: string
          company_token?: string
          cover_letter?: string
          created_at?: string
          error?: string
          fields?: Json
          fit_pct?: number | null
          id?: never
          posting_id?: string
          prepared_at?: string | null
          questions?: Json
          questions_are_real?: boolean
          release_refusal?: string
          released_at?: string | null
          resume_version_id?: string | null
          sent_answers?: Json
          sent_evidence?: string
          source?: string
          status?: string
          submitted_at?: string | null
          submitted_via?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_subscribers: {
        Row: {
          current_period_end: string | null
          email: string
          status: string
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          current_period_end?: string | null
          email: string
          status?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          current_period_end?: string | null
          email?: string
          status?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agent_worker_heartbeat: {
        Row: {
          claimed_total: number
          last_seen: string
          version: string
          worker_id: string
        }
        Insert: {
          claimed_total?: number
          last_seen?: string
          version?: string
          worker_id: string
        }
        Update: {
          claimed_total?: number
          last_seen?: string
          version?: string
          worker_id?: string
        }
        Relationships: []
      }
      ai_response_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          function_name: string
          hit_count: number
          id: string
          response: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          function_name: string
          hit_count?: number
          id?: string
          response: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          function_name?: string
          hit_count?: number
          id?: string
          response?: Json
        }
        Relationships: []
      }
      alert_log: {
        Row: {
          actual_value: number | null
          alert_type: string
          created_at: string
          id: string
          metric_name: string
          sent_successfully: boolean | null
          sent_to: string | null
          threshold_value: number | null
        }
        Insert: {
          actual_value?: number | null
          alert_type: string
          created_at?: string
          id?: string
          metric_name: string
          sent_successfully?: boolean | null
          sent_to?: string | null
          threshold_value?: number | null
        }
        Update: {
          actual_value?: number | null
          alert_type?: string
          created_at?: string
          id?: string
          metric_name?: string
          sent_successfully?: boolean | null
          sent_to?: string | null
          threshold_value?: number | null
        }
        Relationships: []
      }
      apply_tenant_walls: {
        Row: {
          checked_at: string
          company_token: string
          vendor: string
          walled: boolean
          walls: string[]
        }
        Insert: {
          checked_at?: string
          company_token: string
          vendor: string
          walled: boolean
          walls?: string[]
        }
        Update: {
          checked_at?: string
          company_token?: string
          vendor?: string
          walled?: boolean
          walls?: string[]
        }
        Relationships: []
      }
      cohort_weekly_reports: {
        Row: {
          created_at: string
          id: string
          insights: string[] | null
          report_data: Json
          report_date: string
          top_segments: Json
          top_traffic_sources: Json
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          insights?: string[] | null
          report_data: Json
          report_date?: string
          top_segments?: Json
          top_traffic_sources?: Json
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          insights?: string[] | null
          report_data?: Json
          report_date?: string
          top_segments?: Json
          top_traffic_sources?: Json
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      company_claims: {
        Row: {
          company_name: string | null
          company_token: string
          contact_name: string | null
          created_at: string
          domain_match: boolean
          id: string
          note: string | null
          status: string
          verified_at: string | null
          verify_token: string
          website: string | null
          work_email: string
        }
        Insert: {
          company_name?: string | null
          company_token: string
          contact_name?: string | null
          created_at?: string
          domain_match?: boolean
          id?: string
          note?: string | null
          status?: string
          verified_at?: string | null
          verify_token?: string
          website?: string | null
          work_email: string
        }
        Update: {
          company_name?: string | null
          company_token?: string
          contact_name?: string | null
          created_at?: string
          domain_match?: boolean
          id?: string
          note?: string | null
          status?: string
          verified_at?: string | null
          verify_token?: string
          website?: string | null
          work_email?: string
        }
        Relationships: []
      }
      company_financials: {
        Row: {
          cik: number
          currency: string
          exchange: string
          sec_name: string
          series: Json
          slug: string
          ticker: string
          updated_at: string
        }
        Insert: {
          cik: number
          currency?: string
          exchange?: string
          sec_name?: string
          series?: Json
          slug: string
          ticker: string
          updated_at?: string
        }
        Update: {
          cik?: number
          currency?: string
          exchange?: string
          sec_name?: string
          series?: Json
          slug?: string
          ticker?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_name_overrides: {
        Row: {
          added_at: string
          display_name: string
          slug: string
        }
        Insert: {
          added_at?: string
          display_name: string
          slug: string
        }
        Update: {
          added_at?: string
          display_name?: string
          slug?: string
        }
        Relationships: []
      }
      company_profiles: {
        Row: {
          company_token: string
          employee_basis: string
          employee_count: number
          yc_batch: string | null
        }
        Insert: {
          company_token: string
          employee_basis: string
          employee_count: number
          yc_batch?: string | null
        }
        Update: {
          company_token?: string
          employee_basis?: string
          employee_count?: number
          yc_batch?: string | null
        }
        Relationships: []
      }
      daily_scan_stats: {
        Row: {
          date: string
          free_scan_count: number
          paid_scan_count: number
          updated_at: string | null
        }
        Insert: {
          date?: string
          free_scan_count?: number
          paid_scan_count?: number
          updated_at?: string | null
        }
        Update: {
          date?: string
          free_scan_count?: number
          paid_scan_count?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      detection_telemetry: {
        Row: {
          confidence: string | null
          created_at: string
          grounding_drops: number | null
          id: string
          industry: string | null
          margin_ratio: number | null
          source: string | null
          tiebreaker_used: boolean | null
          transition_detected: boolean | null
          used_fallback: boolean | null
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          grounding_drops?: number | null
          id?: string
          industry?: string | null
          margin_ratio?: number | null
          source?: string | null
          tiebreaker_used?: boolean | null
          transition_detected?: boolean | null
          used_fallback?: boolean | null
        }
        Update: {
          confidence?: string | null
          created_at?: string
          grounding_drops?: number | null
          id?: string
          industry?: string | null
          margin_ratio?: number | null
          source?: string | null
          tiebreaker_used?: boolean | null
          transition_detected?: boolean | null
          used_fallback?: boolean | null
        }
        Relationships: []
      }
      email_logs: {
        Row: {
          created_at: string
          email_type: string
          error_message: string | null
          id: string
          metadata: Json | null
          recipient: string
          status: string
          subject: string | null
        }
        Insert: {
          created_at?: string
          email_type: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          recipient: string
          status?: string
          subject?: string | null
        }
        Update: {
          created_at?: string
          email_type?: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          recipient?: string
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      error_telemetry: {
        Row: {
          context: Json | null
          created_at: string
          error_code: string
          error_message: string | null
          error_type: string
          function_name: string | null
          http_status: number | null
          id: string
          visitor_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          error_code: string
          error_message?: string | null
          error_type: string
          function_name?: string | null
          http_status?: number | null
          id?: string
          visitor_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          error_code?: string
          error_message?: string | null
          error_type?: string
          function_name?: string | null
          http_status?: number | null
          id?: string
          visitor_id?: string | null
        }
        Relationships: []
      }
      free_scan_leads: {
        Row: {
          ats_score_estimate: number | null
          created_at: string
          email: string
          id: string
          industry: string | null
        }
        Insert: {
          ats_score_estimate?: number | null
          created_at?: string
          email: string
          id?: string
          industry?: string | null
        }
        Update: {
          ats_score_estimate?: number | null
          created_at?: string
          email?: string
          id?: string
          industry?: string | null
        }
        Relationships: []
      }
      heartbeat_results: {
        Row: {
          checks_passed: Json | null
          created_at: string
          error_message: string | null
          function_name: string
          id: string
          metadata: Json | null
          response_time_ms: number | null
          status: string
          test_passed: boolean
        }
        Insert: {
          checks_passed?: Json | null
          created_at?: string
          error_message?: string | null
          function_name: string
          id?: string
          metadata?: Json | null
          response_time_ms?: number | null
          status: string
          test_passed: boolean
        }
        Update: {
          checks_passed?: Json | null
          created_at?: string
          error_message?: string | null
          function_name?: string
          id?: string
          metadata?: Json | null
          response_time_ms?: number | null
          status?: string
          test_passed?: boolean
        }
        Relationships: []
      }
      industry_corrections: {
        Row: {
          ai_suggested_industry: string | null
          corrected_industry: string
          created_at: string
          detection_source: string | null
          id: string
          ip_country: string | null
          original_confidence: string | null
          original_industry: string
          resume_text_length: number | null
          server_signals: string[] | null
          visitor_id: string | null
        }
        Insert: {
          ai_suggested_industry?: string | null
          corrected_industry: string
          created_at?: string
          detection_source?: string | null
          id?: string
          ip_country?: string | null
          original_confidence?: string | null
          original_industry: string
          resume_text_length?: number | null
          server_signals?: string[] | null
          visitor_id?: string | null
        }
        Update: {
          ai_suggested_industry?: string | null
          corrected_industry?: string
          created_at?: string
          detection_source?: string | null
          id?: string
          ip_country?: string | null
          original_confidence?: string | null
          original_industry?: string
          resume_text_length?: number | null
          server_signals?: string[] | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      industry_detection_metrics: {
        Row: {
          ai_suggested_industry: string | null
          alternative_industries: Json | null
          created_at: string
          detection_duration_ms: number | null
          detection_source: string
          final_confidence: string
          final_industry: string
          id: string
          ip_country: string | null
          matched_context_patterns: boolean | null
          matched_skill_count: number | null
          matched_title_patterns: string[] | null
          resume_text_length: number
          server_ai_match: boolean | null
          server_ai_parent_match: boolean | null
          server_confidence: string
          server_industry: string
          server_parent_industry: string | null
          server_score: number
          server_signals: string[] | null
          server_sub_industry: string | null
          visitor_id: string | null
        }
        Insert: {
          ai_suggested_industry?: string | null
          alternative_industries?: Json | null
          created_at?: string
          detection_duration_ms?: number | null
          detection_source: string
          final_confidence: string
          final_industry: string
          id?: string
          ip_country?: string | null
          matched_context_patterns?: boolean | null
          matched_skill_count?: number | null
          matched_title_patterns?: string[] | null
          resume_text_length: number
          server_ai_match?: boolean | null
          server_ai_parent_match?: boolean | null
          server_confidence: string
          server_industry: string
          server_parent_industry?: string | null
          server_score: number
          server_signals?: string[] | null
          server_sub_industry?: string | null
          visitor_id?: string | null
        }
        Update: {
          ai_suggested_industry?: string | null
          alternative_industries?: Json | null
          created_at?: string
          detection_duration_ms?: number | null
          detection_source?: string
          final_confidence?: string
          final_industry?: string
          id?: string
          ip_country?: string | null
          matched_context_patterns?: boolean | null
          matched_skill_count?: number | null
          matched_title_patterns?: string[] | null
          resume_text_length?: number
          server_ai_match?: boolean | null
          server_ai_parent_match?: boolean | null
          server_confidence?: string
          server_industry?: string
          server_parent_industry?: string | null
          server_score?: number
          server_signals?: string[] | null
          server_sub_industry?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      job_board_closure_rollup: {
        Row: {
          category: string
          company: string
          company_token: string
          fills: number
          first_closed_at: string | null
          last_closed_at: string | null
          month: string
          p50_days_open: number | null
          p75_days_open: number | null
          relists: number
          rolled_at: string
        }
        Insert: {
          category?: string
          company?: string
          company_token: string
          fills?: number
          first_closed_at?: string | null
          last_closed_at?: string | null
          month: string
          p50_days_open?: number | null
          p75_days_open?: number | null
          relists?: number
          rolled_at?: string
        }
        Update: {
          category?: string
          company?: string
          company_token?: string
          fills?: number
          first_closed_at?: string | null
          last_closed_at?: string | null
          month?: string
          p50_days_open?: number | null
          p75_days_open?: number | null
          relists?: number
          rolled_at?: string
        }
        Relationships: []
      }
      job_board_closures: {
        Row: {
          category: string
          closed_at: string
          company: string
          company_token: string
          event_id: number
          first_seen: string | null
          posted_at: string | null
          posting_id: string
          source: string
          superseded: boolean
          title: string
        }
        Insert: {
          category?: string
          closed_at?: string
          company?: string
          company_token: string
          event_id?: never
          first_seen?: string | null
          posted_at?: string | null
          posting_id: string
          source: string
          superseded?: boolean
          title?: string
        }
        Update: {
          category?: string
          closed_at?: string
          company?: string
          company_token?: string
          event_id?: never
          first_seen?: string | null
          posted_at?: string | null
          posting_id?: string
          source?: string
          superseded?: boolean
          title?: string
        }
        Relationships: []
      }
      job_board_company_snapshots: {
        Row: {
          company: string
          company_token: string
          open_roles: number
          snapshot_date: string
        }
        Insert: {
          company?: string
          company_token: string
          open_roles?: number
          snapshot_date: string
        }
        Update: {
          company?: string
          company_token?: string
          open_roles?: number
          snapshot_date?: string
        }
        Relationships: []
      }
      job_board_embeddings: {
        Row: {
          embedded_desc: boolean
          embedding: string
          id: string
          updated_at: string
        }
        Insert: {
          embedded_desc?: boolean
          embedding: string
          id: string
          updated_at?: string
        }
        Update: {
          embedded_desc?: boolean
          embedding?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_board_embeddings_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "job_board_postings"
            referencedColumns: ["id"]
          },
        ]
      }
      job_board_exits: {
        Row: {
          category: string
          company_token: string
          days_on_board: number | null
          event_id: number
          exit_reason: string
          exited_at: string
          posting_id: string
          source: string
        }
        Insert: {
          category?: string
          company_token: string
          days_on_board?: number | null
          event_id?: never
          exit_reason: string
          exited_at?: string
          posting_id: string
          source: string
        }
        Update: {
          category?: string
          company_token?: string
          days_on_board?: number | null
          event_id?: never
          exit_reason?: string
          exited_at?: string
          posting_id?: string
          source?: string
        }
        Relationships: []
      }
      job_board_meta: {
        Row: {
          k: string
          updated_at: string
          v: Json
        }
        Insert: {
          k: string
          updated_at?: string
          v?: Json
        }
        Update: {
          k?: string
          updated_at?: string
          v?: Json
        }
        Relationships: []
      }
      job_board_pool_samples: {
        Row: {
          sampled_at: string
          serving: number
          total: number | null
        }
        Insert: {
          sampled_at?: string
          serving: number
          total?: number | null
        }
        Update: {
          sampled_at?: string
          serving?: number
          total?: number | null
        }
        Relationships: []
      }
      job_board_posting_reports: {
        Row: {
          at: string
          company_token: string
          id: number
          note: string
          posting_id: string
          reason: string
        }
        Insert: {
          at?: string
          company_token?: string
          id?: never
          note?: string
          posting_id: string
          reason: string
        }
        Update: {
          at?: string
          company_token?: string
          id?: never
          note?: string
          posting_id?: string
          reason?: string
        }
        Relationships: []
      }
      job_board_postings: {
        Row: {
          apply_url: string
          category: string
          company: string
          company_token: string
          country: string | null
          department: string | null
          description: string | null
          effective_posted: string | null
          experience_band: string | null
          first_seen: string
          id: string
          last_seen: string
          location: string
          min_years: number | null
          missing_since: string | null
          posted_at: string | null
          remote: boolean
          salary: string | null
          salary_currency: string | null
          salary_max_annual: number | null
          salary_min_annual: number | null
          salary_period: string | null
          salary_rank_usd: number | null
          search_tsv: unknown
          source: string
          title: string
          title_tsv: unknown
          work_mode: string | null
        }
        Insert: {
          apply_url: string
          category?: string
          company: string
          company_token: string
          country?: string | null
          department?: string | null
          description?: string | null
          effective_posted?: string | null
          experience_band?: string | null
          first_seen?: string
          id: string
          last_seen?: string
          location?: string
          min_years?: number | null
          missing_since?: string | null
          posted_at?: string | null
          remote?: boolean
          salary?: string | null
          salary_currency?: string | null
          salary_max_annual?: number | null
          salary_min_annual?: number | null
          salary_period?: string | null
          salary_rank_usd?: number | null
          search_tsv?: unknown
          source: string
          title: string
          title_tsv?: unknown
          work_mode?: string | null
        }
        Update: {
          apply_url?: string
          category?: string
          company?: string
          company_token?: string
          country?: string | null
          department?: string | null
          description?: string | null
          effective_posted?: string | null
          experience_band?: string | null
          first_seen?: string
          id?: string
          last_seen?: string
          location?: string
          min_years?: number | null
          missing_since?: string | null
          posted_at?: string | null
          remote?: boolean
          salary?: string | null
          salary_currency?: string | null
          salary_max_annual?: number | null
          salary_min_annual?: number | null
          salary_period?: string | null
          salary_rank_usd?: number | null
          search_tsv?: unknown
          source?: string
          title?: string
          title_tsv?: unknown
          work_mode?: string | null
        }
        Relationships: []
      }
      job_board_search_clicks: {
        Row: {
          at: string
          id: number
          kind: string
          position: number | null
          posting_id: string
          q: string
          search_id: string | null
        }
        Insert: {
          at?: string
          id?: never
          kind?: string
          position?: number | null
          posting_id: string
          q?: string
          search_id?: string | null
        }
        Update: {
          at?: string
          id?: never
          kind?: string
          position?: number | null
          posting_id?: string
          q?: string
          search_id?: string | null
        }
        Relationships: []
      }
      job_board_search_events: {
        Row: {
          at: string
          filters: Json
          id: number
          location: string
          offset_n: number
          q: string
          rescued: string | null
          results: number
          route: string
          search_id: string
          total: number | null
        }
        Insert: {
          at?: string
          filters?: Json
          id?: never
          location?: string
          offset_n?: number
          q?: string
          rescued?: string | null
          results?: number
          route?: string
          search_id: string
          total?: number | null
        }
        Update: {
          at?: string
          filters?: Json
          id?: never
          location?: string
          offset_n?: number
          q?: string
          rescued?: string | null
          results?: number
          route?: string
          search_id?: string
          total?: number | null
        }
        Relationships: []
      }
      job_board_search_misses: {
        Row: {
          at: string
          filters: Json
          id: number
          location: string
          q: string
          src: string
        }
        Insert: {
          at?: string
          filters?: Json
          id?: never
          location?: string
          q?: string
          src?: string
        }
        Update: {
          at?: string
          filters?: Json
          id?: never
          location?: string
          q?: string
          src?: string
        }
        Relationships: []
      }
      job_board_stats_rollup: {
        Row: {
          computed_at: string
          k: string
          v: Json
        }
        Insert: {
          computed_at?: string
          k: string
          v: Json
        }
        Update: {
          computed_at?: string
          k?: string
          v?: Json
        }
        Relationships: []
      }
      job_board_verifications: {
        Row: {
          company_token: string
          feed_total: number | null
          verified_at: string
        }
        Insert: {
          company_token: string
          feed_total?: number | null
          verified_at?: string
        }
        Update: {
          company_token?: string
          feed_total?: number | null
          verified_at?: string
        }
        Relationships: []
      }
      market_pulse_subscribers: {
        Row: {
          email: string
          industry: string
          last_score: number | null
          last_sent_at: string | null
          subscribed_at: string
          unsubscribed_at: string | null
        }
        Insert: {
          email: string
          industry?: string
          last_score?: number | null
          last_sent_at?: string | null
          subscribed_at?: string
          unsubscribed_at?: string | null
        }
        Update: {
          email?: string
          industry?: string
          last_score?: number | null
          last_sent_at?: string | null
          subscribed_at?: string
          unsubscribed_at?: string | null
        }
        Relationships: []
      }
      parse_failures: {
        Row: {
          created_at: string
          error_code: string | null
          error_message: string | null
          file_size_bytes: number | null
          file_type: string
          id: string
          metadata: Json | null
          visitor_id: string | null
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          file_size_bytes?: number | null
          file_type: string
          id?: string
          metadata?: Json | null
          visitor_id?: string | null
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          file_size_bytes?: number | null
          file_type?: string
          id?: string
          metadata?: Json | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      payment_failures: {
        Row: {
          amount: number
          created_at: string
          currency: string
          customer_email: string | null
          failure_code: string | null
          failure_message: string | null
          id: string
          metadata: Json | null
          payment_intent_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          customer_email?: string | null
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          metadata?: Json | null
          payment_intent_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          customer_email?: string | null
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          metadata?: Json | null
          payment_intent_id?: string
        }
        Relationships: []
      }
      pro_grants: {
        Row: {
          consumed_at: string | null
          created_at: string
          credits: number | null
          email: string
          id: string
          job_company: string | null
          job_title: string | null
          language: string | null
          product_id: string
          product_name: string | null
          product_type: string | null
          resume_session_id: string | null
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          credits?: number | null
          email: string
          id?: string
          job_company?: string | null
          job_title?: string | null
          language?: string | null
          product_id: string
          product_name?: string | null
          product_type?: string | null
          resume_session_id?: string | null
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          credits?: number | null
          email?: string
          id?: string
          job_company?: string | null
          job_title?: string | null
          language?: string | null
          product_id?: string
          product_name?: string | null
          product_type?: string | null
          resume_session_id?: string | null
        }
        Relationships: []
      }
      pro_subscribers: {
        Row: {
          current_period_end: string | null
          email: string
          status: string
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          current_period_end?: string | null
          email: string
          status?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          current_period_end?: string | null
          email?: string
          status?: string
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      product_deliveries: {
        Row: {
          ai_model_used: string | null
          ai_parse_error: string | null
          ai_response_valid: boolean | null
          amount_cents: number | null
          content_generation_completed_at: string | null
          content_generation_started_at: string | null
          created_at: string
          customer_email: string | null
          email_delivered_at: string | null
          email_error: string | null
          email_sent_at: string | null
          email_success: boolean | null
          generation_duration_ms: number | null
          generation_error: string | null
          generation_success: boolean | null
          id: string
          last_retry_error: string | null
          max_retries: number
          metadata: Json | null
          next_retry_at: string | null
          payment_completed_at: string | null
          product_name: string | null
          product_type: string
          retry_count: number
          status: string
          stripe_session_id: string
        }
        Insert: {
          ai_model_used?: string | null
          ai_parse_error?: string | null
          ai_response_valid?: boolean | null
          amount_cents?: number | null
          content_generation_completed_at?: string | null
          content_generation_started_at?: string | null
          created_at?: string
          customer_email?: string | null
          email_delivered_at?: string | null
          email_error?: string | null
          email_sent_at?: string | null
          email_success?: boolean | null
          generation_duration_ms?: number | null
          generation_error?: string | null
          generation_success?: boolean | null
          id?: string
          last_retry_error?: string | null
          max_retries?: number
          metadata?: Json | null
          next_retry_at?: string | null
          payment_completed_at?: string | null
          product_name?: string | null
          product_type: string
          retry_count?: number
          status?: string
          stripe_session_id: string
        }
        Update: {
          ai_model_used?: string | null
          ai_parse_error?: string | null
          ai_response_valid?: boolean | null
          amount_cents?: number | null
          content_generation_completed_at?: string | null
          content_generation_started_at?: string | null
          created_at?: string
          customer_email?: string | null
          email_delivered_at?: string | null
          email_error?: string | null
          email_sent_at?: string | null
          email_success?: boolean | null
          generation_duration_ms?: number | null
          generation_error?: string | null
          generation_success?: boolean | null
          id?: string
          last_retry_error?: string | null
          max_retries?: number
          metadata?: Json | null
          next_retry_at?: string | null
          payment_completed_at?: string | null
          product_name?: string | null
          product_type?: string
          retry_count?: number
          status?: string
          stripe_session_id?: string
        }
        Relationships: []
      }
      purchased_content: {
        Row: {
          created_at: string
          customer_email: string
          expires_at: string | null
          generated_content: Json | null
          id: string
          product_name: string | null
          product_type: string
          stripe_session_id: string
        }
        Insert: {
          created_at?: string
          customer_email: string
          expires_at?: string | null
          generated_content?: Json | null
          id?: string
          product_name?: string | null
          product_type: string
          stripe_session_id: string
        }
        Update: {
          created_at?: string
          customer_email?: string
          expires_at?: string | null
          generated_content?: Json | null
          id?: string
          product_name?: string | null
          product_type?: string
          stripe_session_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          function_name: string
          ip_address: string
          request_count: number | null
          window_start: string | null
        }
        Insert: {
          function_name: string
          ip_address: string
          request_count?: number | null
          window_start?: string | null
        }
        Update: {
          function_name?: string
          ip_address?: string
          request_count?: number | null
          window_start?: string | null
        }
        Relationships: []
      }
      resume_analyses: {
        Row: {
          analysis_result: Json
          created_at: string
          expires_at: string | null
          id: string
          resume_text: string | null
          share_id: string
        }
        Insert: {
          analysis_result: Json
          created_at?: string
          expires_at?: string | null
          id?: string
          resume_text?: string | null
          share_id?: string
        }
        Update: {
          analysis_result?: Json
          created_at?: string
          expires_at?: string | null
          id?: string
          resume_text?: string | null
          share_id?: string
        }
        Relationships: []
      }
      scan_feedback: {
        Row: {
          ats_score: number | null
          created_at: string
          feedback_text: string | null
          had_job_description: boolean | null
          id: string
          industry: string | null
          rating: boolean
          resume_word_count: number | null
          visitor_id: string | null
        }
        Insert: {
          ats_score?: number | null
          created_at?: string
          feedback_text?: string | null
          had_job_description?: boolean | null
          id?: string
          industry?: string | null
          rating: boolean
          resume_word_count?: number | null
          visitor_id?: string | null
        }
        Update: {
          ats_score?: number | null
          created_at?: string
          feedback_text?: string | null
          had_job_description?: boolean | null
          id?: string
          industry?: string | null
          rating?: boolean
          resume_word_count?: number | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      scan_industry_pins: {
        Row: {
          confidence: string
          created_at: string
          industry: string
          resume_hash: string
          source: string
          updated_at: string
        }
        Insert: {
          confidence?: string
          created_at?: string
          industry: string
          resume_hash: string
          source?: string
          updated_at?: string
        }
        Update: {
          confidence?: string
          created_at?: string
          industry?: string
          resume_hash?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      scan_metrics: {
        Row: {
          ai_model: string | null
          cache_hit: boolean | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          id: string
          input_length: number | null
          ip_country: string | null
          metadata: Json | null
          output_valid: boolean | null
          response_score: number | null
          scan_type: string
          status: string
          visitor_id: string | null
        }
        Insert: {
          ai_model?: string | null
          cache_hit?: boolean | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          input_length?: number | null
          ip_country?: string | null
          metadata?: Json | null
          output_valid?: boolean | null
          response_score?: number | null
          scan_type?: string
          status: string
          visitor_id?: string | null
        }
        Update: {
          ai_model?: string | null
          cache_hit?: boolean | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          input_length?: number | null
          ip_country?: string | null
          metadata?: Json | null
          output_valid?: boolean | null
          response_score?: number | null
          scan_type?: string
          status?: string
          visitor_id?: string | null
        }
        Relationships: []
      }
      scan_outcomes: {
        Row: {
          created_at: string
          id: string
          ip_hash: string
          outcome: string
          report_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_hash: string
          outcome: string
          report_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_hash?: string
          outcome?: string
          report_id?: string
        }
        Relationships: []
      }
      scan_report_cache: {
        Row: {
          cache_key: string
          created_at: string
          engine_version: string | null
          report: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          engine_version?: string | null
          report: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          engine_version?: string | null
          report?: Json
        }
        Relationships: []
      }
      scan_slots: {
        Row: {
          id: string
          started_at: string
        }
        Insert: {
          id?: string
          started_at?: string
        }
        Update: {
          id?: string
          started_at?: string
        }
        Relationships: []
      }
      seniority_corrections: {
        Row: {
          corrected_level: string
          created_at: string
          detected_level: string
          detected_years: string | null
          id: string
          industry: string | null
          resume_text_length: number | null
          visitor_id: string | null
        }
        Insert: {
          corrected_level: string
          created_at?: string
          detected_level: string
          detected_years?: string | null
          id?: string
          industry?: string | null
          resume_text_length?: number | null
          visitor_id?: string | null
        }
        Update: {
          corrected_level?: string
          created_at?: string
          detected_level?: string
          detected_years?: string | null
          id?: string
          industry?: string | null
          resume_text_length?: number | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      shortlist_candidates: {
        Row: {
          candidate_jurisdiction: string | null
          created_at: string
          exclusions_applied: Json | null
          file_name: string | null
          flags: Json | null
          id: string
          interview_questions: Json | null
          jd_version: number
          level_read: string | null
          model_version: string | null
          owner_id: string
          parsed_fields: Json | null
          redacted_text: string | null
          role_id: string
          score: number | null
          signals: Json | null
          status: string
        }
        Insert: {
          candidate_jurisdiction?: string | null
          created_at?: string
          exclusions_applied?: Json | null
          file_name?: string | null
          flags?: Json | null
          id?: string
          interview_questions?: Json | null
          jd_version?: number
          level_read?: string | null
          model_version?: string | null
          owner_id: string
          parsed_fields?: Json | null
          redacted_text?: string | null
          role_id: string
          score?: number | null
          signals?: Json | null
          status?: string
        }
        Update: {
          candidate_jurisdiction?: string | null
          created_at?: string
          exclusions_applied?: Json | null
          file_name?: string | null
          flags?: Json | null
          id?: string
          interview_questions?: Json | null
          jd_version?: number
          level_read?: string | null
          model_version?: string | null
          owner_id?: string
          parsed_fields?: Json | null
          redacted_text?: string | null
          role_id?: string
          score?: number | null
          signals?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shortlist_candidates_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "shortlist_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      shortlist_decisions: {
        Row: {
          action: string
          actor_email: string | null
          candidate_id: string
          created_at: string
          id: string
          new_value: string | null
          old_value: string | null
          owner_id: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          candidate_id: string
          created_at?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          owner_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          candidate_id?: string
          created_at?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          owner_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shortlist_decisions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "shortlist_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      shortlist_demographics: {
        Row: {
          candidate_id: string
          created_at: string
          owner_id: string
          race_ethnicity: string | null
          sex: string | null
        }
        Insert: {
          candidate_id: string
          created_at?: string
          owner_id: string
          race_ethnicity?: string | null
          sex?: string | null
        }
        Update: {
          candidate_id?: string
          created_at?: string
          owner_id?: string
          race_ethnicity?: string | null
          sex?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shortlist_demographics_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "shortlist_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      shortlist_notices: {
        Row: {
          content: string
          id: string
          jurisdiction: string
          notice_type: string
          owner_id: string
          role_id: string
          sent_at: string
        }
        Insert: {
          content: string
          id?: string
          jurisdiction: string
          notice_type: string
          owner_id: string
          role_id: string
          sent_at?: string
        }
        Update: {
          content?: string
          id?: string
          jurisdiction?: string
          notice_type?: string
          owner_id?: string
          role_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shortlist_notices_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "shortlist_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      shortlist_roles: {
        Row: {
          created_at: string
          id: string
          jd_text: string
          jd_version: number
          jurisdiction: string
          owner_id: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          jd_text: string
          jd_version?: number
          jurisdiction?: string
          owner_id: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          jd_text?: string
          jd_version?: number
          jurisdiction?: string
          owner_id?: string
          title?: string
        }
        Relationships: []
      }
      showcase_excluded: {
        Row: {
          company_token: string
          reason: string
        }
        Insert: {
          company_token: string
          reason?: string
        }
        Update: {
          company_token?: string
          reason?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      temp_resume_storage: {
        Row: {
          created_at: string | null
          expires_at: string
          job_description_text: string | null
          linkedin_text: string | null
          resume_text: string
          session_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string
          job_description_text?: string | null
          linkedin_text?: string | null
          resume_text: string
          session_id?: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          job_description_text?: string | null
          linkedin_text?: string | null
          resume_text?: string
          session_id?: string
        }
        Relationships: []
      }
      used_stripe_sessions: {
        Row: {
          ip_address: string | null
          session_id: string
          used_at: string
        }
        Insert: {
          ip_address?: string | null
          session_id: string
          used_at?: string
        }
        Update: {
          ip_address?: string | null
          session_id?: string
          used_at?: string
        }
        Relationships: []
      }
      user_applications: {
        Row: {
          applied_at: string
          apply_url: string | null
          company: string
          created_at: string
          fit_missing: Json | null
          fit_pct: number | null
          followed_up_at: string | null
          id: string
          interview_at: string | null
          job_id: string | null
          job_posting: string | null
          kit: Json | null
          kit_generated_at: string | null
          label: string | null
          location: string | null
          posting_checked_at: string | null
          posting_closed_at: string | null
          posting_closed_notified_at: string | null
          role: string
          scan_id: string | null
          scan_score: number | null
          status: string
          status_changed_at: string | null
          user_id: string
        }
        Insert: {
          applied_at?: string
          apply_url?: string | null
          company: string
          created_at?: string
          fit_missing?: Json | null
          fit_pct?: number | null
          followed_up_at?: string | null
          id?: string
          interview_at?: string | null
          job_id?: string | null
          job_posting?: string | null
          kit?: Json | null
          kit_generated_at?: string | null
          label?: string | null
          location?: string | null
          posting_checked_at?: string | null
          posting_closed_at?: string | null
          posting_closed_notified_at?: string | null
          role?: string
          scan_id?: string | null
          scan_score?: number | null
          status?: string
          status_changed_at?: string | null
          user_id: string
        }
        Update: {
          applied_at?: string
          apply_url?: string | null
          company?: string
          created_at?: string
          fit_missing?: Json | null
          fit_pct?: number | null
          followed_up_at?: string | null
          id?: string
          interview_at?: string | null
          job_id?: string | null
          job_posting?: string | null
          kit?: Json | null
          kit_generated_at?: string | null
          label?: string | null
          location?: string | null
          posting_checked_at?: string | null
          posting_closed_at?: string | null
          posting_closed_notified_at?: string | null
          role?: string
          scan_id?: string | null
          scan_score?: number | null
          status?: string
          status_changed_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_applications_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "user_scans"
            referencedColumns: ["id"]
          },
        ]
      }
      user_job_searches: {
        Row: {
          created_at: string
          digest_cadence: string
          digest_last_sent_at: string | null
          digest_opt_in: boolean
          fit_threshold: number
          id: string
          last_seen_at: string
          name: string
          params: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          digest_cadence?: string
          digest_last_sent_at?: string | null
          digest_opt_in?: boolean
          fit_threshold?: number
          id?: string
          last_seen_at?: string
          name: string
          params?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          digest_cadence?: string
          digest_last_sent_at?: string | null
          digest_opt_in?: boolean
          fit_threshold?: number
          id?: string
          last_seen_at?: string
          name?: string
          params?: Json
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          closure_alerts_opt_in: boolean
          confirmed_experience: string | null
          confirmed_industry: string | null
          matching_resume_text: string | null
          matching_resume_updated_at: string | null
          matching_scan_id: string | null
          situation: string | null
          target_role: string | null
          target_score: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          closure_alerts_opt_in?: boolean
          confirmed_experience?: string | null
          confirmed_industry?: string | null
          matching_resume_text?: string | null
          matching_resume_updated_at?: string | null
          matching_scan_id?: string | null
          situation?: string | null
          target_role?: string | null
          target_score?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          closure_alerts_opt_in?: boolean
          confirmed_experience?: string | null
          confirmed_industry?: string | null
          matching_resume_text?: string | null
          matching_resume_updated_at?: string | null
          matching_scan_id?: string | null
          situation?: string | null
          target_role?: string | null
          target_score?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_scan_credits: {
        Row: {
          created_at: string
          credits_remaining: number
          email: string
          id: string
          total_credits_purchased: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          credits_remaining?: number
          email: string
          id?: string
          total_credits_purchased?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          credits_remaining?: number
          email?: string
          id?: string
          total_credits_purchased?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_scans: {
        Row: {
          ats_score: number
          created_at: string
          fix_plan: Json | null
          id: string
          industry: string | null
          label: string | null
          projected_score: number | null
          red_flag_count: number | null
          report_id: string | null
          resume_text: string | null
          user_id: string
          verdict: string | null
        }
        Insert: {
          ats_score: number
          created_at?: string
          fix_plan?: Json | null
          id?: string
          industry?: string | null
          label?: string | null
          projected_score?: number | null
          red_flag_count?: number | null
          report_id?: string | null
          resume_text?: string | null
          user_id: string
          verdict?: string | null
        }
        Update: {
          ats_score?: number
          created_at?: string
          fix_plan?: Json | null
          id?: string
          industry?: string | null
          label?: string | null
          projected_score?: number | null
          red_flag_count?: number | null
          report_id?: string | null
          resume_text?: string | null
          user_id?: string
          verdict?: string | null
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string
          event_id: string
          event_type: string
          id: string
          payload: Json | null
          processed: boolean | null
          processing_error: string | null
          processing_time_ms: number | null
        }
        Insert: {
          created_at?: string
          event_id: string
          event_type: string
          id?: string
          payload?: Json | null
          processed?: boolean | null
          processing_error?: string | null
          processing_time_ms?: number | null
        }
        Update: {
          created_at?: string
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json | null
          processed?: boolean | null
          processing_error?: string | null
          processing_time_ms?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_scan_slot: {
        Args: { p_max: number; p_ttl_seconds: number }
        Returns: string
      }
      add_scan_credits: {
        Args: { p_credits: number; p_email: string }
        Returns: boolean
      }
      agent_cancel_pending: {
        Args: { p_submission_id: number }
        Returns: boolean
      }
      agent_claim_submission: {
        Args: { p_lease_minutes?: number; p_worker: string }
        Returns: {
          answers: Json
          apply_url: string
          attempts: number
          blockers: Json
          claimable_at: string | null
          claimed_at: string | null
          claimed_by: string
          company: string
          company_token: string
          cover_letter: string
          created_at: string
          error: string
          fields: Json
          fit_pct: number | null
          id: number
          posting_id: string
          prepared_at: string | null
          questions: Json
          questions_are_real: boolean
          release_refusal: string
          released_at: string | null
          resume_version_id: string | null
          sent_answers: Json
          sent_evidence: string
          source: string
          status: string
          submitted_at: string | null
          submitted_via: string | null
          title: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "agent_submissions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      agent_confirmation_gaps: {
        Args: { p_days?: number }
        Returns: {
          last_seen: string
          occurrences: number
          wording: string
        }[]
      }
      agent_employer_in_cooldown: {
        Args: { p_company: string; p_days: number; p_user_id: string }
        Returns: boolean
      }
      agent_fill_gaps: {
        Args: { p_days?: number }
        Returns: {
          last_seen: string
          occurrences: number
          source: string
          stage: string
          wording: string
        }[]
      }
      agent_maintenance_key_matches: {
        Args: { p_key: string }
        Returns: boolean
      }
      agent_mark_uncertain: {
        Args: { p_id: number; p_reason: string }
        Returns: undefined
      }
      agent_note_auto_release: { Args: { p_user_id: string }; Returns: number }
      agent_prepare_now: { Args: never; Returns: boolean }
      agent_sender_online: {
        Args: { p_max_age_seconds?: number }
        Returns: boolean
      }
      agent_sender_public_status: { Args: never; Returns: boolean }
      agent_sender_state: {
        Args: never
        Returns: {
          active_mandates: number
          ever_seen: boolean
          last_seen: string
          offline_seconds: number
          pending_packets: number
        }[]
      }
      agent_sent_today: { Args: { p_user: string }; Returns: number }
      agent_work_pending: { Args: never; Returns: Json }
      agent_worker_ping: {
        Args: { p_claimed?: number; p_version?: string; p_worker: string }
        Returns: undefined
      }
      apply_posting_corrections: { Args: { p_patches: Json }; Returns: number }
      board_serving_count: { Args: never; Returns: number }
      build_missing_since_index_oneshot: { Args: never; Returns: undefined }
      build_sitemap_day_index_oneshot: { Args: never; Returns: undefined }
      build_speed_indexes_oneshot: { Args: never; Returns: undefined }
      check_global_rate_limit: {
        Args: {
          p_ip: string
          p_max_requests?: number
          p_window_minutes?: number
        }
        Returns: boolean
      }
      check_rate_limit: {
        Args: {
          p_function: string
          p_ip: string
          p_max_requests: number
          p_window_minutes?: number
        }
        Returns: boolean
      }
      check_user_health: {
        Args: { p_visitor_id: string }
        Returns: {
          error_trend: string
          primary_issue: string
          recent_errors: number
          recommendation: string
          status: string
        }[]
      }
      cleanup_expired_analyses: { Args: never; Returns: number }
      cleanup_expired_cache: { Args: never; Returns: number }
      cleanup_expired_stripe_sessions: { Args: never; Returns: number }
      cleanup_expired_temp_resumes: { Args: never; Returns: number }
      cleanup_old_rate_limits: { Args: never; Returns: number }
      compare_cohorts: {
        Args: {
          p_cohort_a: string
          p_cohort_b: string
          p_days_back?: number
          p_dimension?: string
        }
        Returns: {
          cohort_a_value: number
          cohort_b_value: number
          difference: number
          lift_percent: number
          metric: string
        }[]
      }
      count_jobs_capped: {
        Args: {
          p_cap?: number
          p_category?: string
          p_companies?: string[]
          p_country?: string
          p_experience?: string[]
          p_fresh_cutoff: string
          p_location?: string
          p_max_age_days?: number
          p_posted_after?: string
          p_q?: string
          p_remote?: boolean
          p_salary_floor?: number
          p_sources?: string[]
          p_work_mode?: string
        }
        Returns: {
          capped: boolean
          n: number
        }[]
      }
      delete_analysis_by_share_id: {
        Args: { p_share_id: string }
        Returns: boolean
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      detect_user_error_spikes: {
        Args: {
          p_baseline_hours?: number
          p_recent_minutes?: number
          p_spike_threshold?: number
        }
        Returns: {
          baseline_hourly_rate: number
          is_spike: boolean
          last_error_at: string
          recent_error_count: number
          recent_error_types: string[]
          spike_multiplier: number
          visitor_id: string
        }[]
      }
      email_delivery_health: {
        Args: { p_hours?: number }
        Returns: {
          last_at: string
          n: number
          status: string
          stuck: number
        }[]
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      enqueue_email_delayed: {
        Args: { delay_seconds: number; payload: Json; queue_name: string }
        Returns: number
      }
      fuzzy_title_search: {
        Args: {
          p_category?: string
          p_companies?: string[]
          p_country?: string
          p_experience?: string[]
          p_fresh_cutoff: string
          p_limit?: number
          p_location?: string
          p_max_age_days?: number
          p_posted_after?: string
          p_q: string
          p_remote?: boolean
          p_salary_floor?: number
          p_vendors?: string[]
          p_work_mode?: string
        }
        Returns: {
          apply_url: string
          category: string
          company: string
          company_token: string
          country: string
          department: string
          experience_band: string
          id: string
          last_seen: string
          location: string
          min_years: number
          missing_since: string
          posted_at: string
          remote: boolean
          salary: string
          salary_currency: string
          salary_max_annual: number
          salary_min_annual: number
          salary_period: string
          source: string
          title: string
          total_rows: number
          work_mode: string
        }[]
      }
      get_ab_test_stats: {
        Args: { p_test_name: string }
        Returns: {
          conversion_rate: number
          conversions: number
          variant: string
          views: number
        }[]
      }
      get_actively_hiring_companies: {
        Args: { p_limit?: number }
        Returns: {
          closed_90d: number
          company: string
          company_token: string
          dated_n: number
          open_roles: number
          p50_days_open: number
          tracking_days: number
        }[]
      }
      get_affiliate_clicks: {
        Args: { p_days_back?: number; p_session_token: string }
        Returns: {
          click_count: number
          click_date: string
          unique_referrers: number
        }[]
      }
      get_affiliate_dashboard: {
        Args: { p_session_token: string }
        Returns: Json
      }
      get_affiliate_stats_by_date: {
        Args: {
          p_end_date?: string
          p_session_token: string
          p_start_date?: string
        }
        Returns: {
          conversion_rate: number
          paid_out: number
          pending_payout: number
          total_clicks: number
          total_conversions: number
          total_revenue: number
        }[]
      }
      get_ai_generation_metrics_hourly: {
        Args: { p_hours_back?: number }
        Returns: {
          avg_duration_ms: number
          failed_generations: number
          hour_bucket: string
          success_rate: number
          successful_generations: number
          total_generations: number
        }[]
      }
      get_ai_quality_stats: {
        Args: { p_hours_back?: number }
        Returns: {
          avg_duration_ms: number
          p95_duration_ms: number
          parse_failures: number
          recent_errors: Json
          success_rate: number
          successful: number
          total_generations: number
        }[]
      }
      get_analysis_by_share_id: {
        Args: { share_id_param: string }
        Returns: {
          analysis_result: Json
          created_at: string
          id: string
          share_id: string
        }[]
      }
      get_application_lifecycle: {
        Args: { p_job_ids: string[] }
        Returns: {
          closed_at: string
          days_standing: number
          job_id: string
          outcome: string
          relisted: boolean
        }[]
      }
      get_audit_result: { Args: never; Returns: Json }
      get_board_flow: {
        Args: { p_hours?: number }
        Returns: {
          closed: number
          computed_at: string
          departed: number
          intake: number
          serving: number
          serving_basis: string
          serving_delta: number
          serving_prev: number
          superseded: number
          window_hours: number
        }[]
      }
      get_board_velocity: {
        Args: { days?: number; top_n?: number }
        Returns: {
          company_token: string
          recent: number
        }[]
      }
      get_board_vendor_counts: { Args: never; Returns: Json }
      get_cached_response: {
        Args: { p_cache_key: string; p_function_name: string }
        Returns: Json
      }
      get_category_fill_speed: {
        Args: { p_days?: number; p_min_closures?: number }
        Returns: {
          category: string
          closures: number
          median_days_open: number
          p75_days_open: number
          window_days: number
        }[]
      }
      get_checkout_funnel: {
        Args: { p_hours_back?: number }
        Returns: {
          checkout_to_payment_rate: number
          checkouts_started: number
          content_generated: number
          end_to_end_rate: number
          fully_delivered: number
          payment_to_delivery_rate: number
          payments_completed: number
        }[]
      }
      get_company_claim_status: { Args: { p_token: string }; Returns: Json }
      get_company_financials: { Args: { p_token: string }; Returns: Json }
      get_company_hiring_health: {
        Args: { p_tokens: string[] }
        Returns: {
          closed_90d: number
          company_token: string
          feed_total: number
          median_days_open: number
          median_days_to_close: number
          open_roles: number
          superseded_90d: number
          tracking_days: number
        }[]
      }
      get_company_intel: { Args: { p_token: string }; Returns: Json }
      get_company_suggest: {
        Args: { p_q: string }
        Returns: {
          name: string
          tokens: string[]
        }[]
      }
      get_country_facet: {
        Args: never
        Returns: {
          country: string
          n: number
        }[]
      }
      get_date_coverage: {
        Args: never
        Returns: {
          computed_at: string
          dated: number
          source: string
          total: number
        }[]
      }
      get_db_size_stats: { Args: never; Returns: Json }
      get_delivery_health: {
        Args: { p_hours_back?: number }
        Returns: {
          avg_generation_time_ms: number
          delivery_rate: number
          email_failed: number
          fully_delivered: number
          generation_failed: number
          pending: number
          recent_failures: Json
          total_orders: number
        }[]
      }
      get_email_health: {
        Args: { p_hours_back?: number }
        Returns: {
          failed_emails: number
          recent_emails: Json
          success_rate: number
          successful_emails: number
          total_emails: number
        }[]
      }
      get_email_metrics_hourly: {
        Args: { p_hours_back?: number }
        Returns: {
          failed_emails: number
          hour_bucket: string
          success_rate: number
          successful_emails: number
          total_emails: number
        }[]
      }
      get_embed_batch: {
        Args: { p_limit?: number }
        Returns: {
          company: string
          descr: string
          has_desc: boolean
          id: string
          location: string
          title: string
        }[]
      }
      get_employer_benchmarks: {
        Args: { p_days?: number; p_limit?: number; p_min_closures?: number }
        Returns: {
          closures: number
          company: string
          median_days_open: number
          observed_days: number
          window_days: number
        }[]
      }
      get_empty_boards: { Args: { p_tokens: string[] }; Returns: string[] }
      get_entry_level_companies: {
        Args: { p_limit?: number }
        Returns: {
          company: string
          company_token: string
          entry_roles: number
          open_roles: number
        }[]
      }
      get_entry_level_stats: {
        Args: never
        Returns: {
          by_category: Json
          companies_with_entry: number
          remote_entry: number
          total_entry: number
          total_open: number
        }[]
      }
      get_error_diagnostics: {
        Args: { p_hours_back?: number }
        Returns: {
          affected_functions: string[]
          avg_per_user: number
          error_code: string
          error_count: number
          error_type: string
          most_recent: string
          sample_message: string
          unique_users: number
        }[]
      }
      get_explore_cache: { Args: never; Returns: Json }
      get_explore_denominators: { Args: never; Returns: Json }
      get_failed_deliveries_for_retry: {
        Args: { p_limit?: number }
        Returns: {
          customer_email: string
          id: string
          metadata: Json
          product_name: string
          product_type: string
          retry_count: number
          status: string
          stripe_session_id: string
        }[]
      }
      get_freshness_stats: {
        Args: never
        Returns: {
          boards: number
          computed_at: string
          max_min: number
          p50_min: number
          p95_min: number
        }[]
      }
      get_function_error_rates: {
        Args: { p_hours_back?: number }
        Returns: {
          error_types: string[]
          function_name: string
          last_error_at: string
          sample_message: string
          total_errors: number
        }[]
      }
      get_funnel_cohort_stats: {
        Args: { p_cohort_dimension?: string; p_days_back?: number }
        Returns: {
          checkout_rate: number
          checkout_started: number
          cohort_value: string
          conversion_rate: number
          landing_view: number
          product_clicked: number
          purchase_completed: number
          results_viewed: number
          scan_completed: number
          scan_rate: number
          scan_started: number
          upload_completed: number
          upload_rate: number
          upload_started: number
          view_rate: number
        }[]
      }
      get_geo_latency_stats: {
        Args: { p_hours_back?: number }
        Returns: {
          avg_latency_ms: number
          country: string
          failed_scans: number
          failure_rate: number
          max_latency_ms: number
          min_latency_ms: number
          p50_latency_ms: number
          p95_latency_ms: number
          total_scans: number
        }[]
      }
      get_ghost_job_index_stats: {
        Args: never
        Returns: {
          closed_90d: number
          computed_at: string
          median_days_open: number
          median_days_to_close: number
          observed_days: number
          posted_coverage_pct: number
          total_companies: number
          total_company_names: number
          total_open: number
        }[]
      }
      get_hiring_trends: {
        Args: never
        Returns: {
          closed: number
          entry_new: number
          new_postings: number
          remote_new: number
          week_start: string
        }[]
      }
      get_industry_correction_stats: {
        Args: { p_days?: number }
        Returns: {
          corrected: string
          corrections: number
          detected: string
          last_seen: string
        }[]
      }
      get_industry_detection_breakdown: {
        Args: { p_hours_back?: number }
        Returns: {
          final_confidence: string
          final_industry: string
        }[]
      }
      get_industry_detection_recent: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          detection_source: string
          final_confidence: string
          final_industry: string
          matched_skill_count: number
          server_score: number
        }[]
      }
      get_industry_detection_stats: {
        Args: { p_hours_back?: number }
        Returns: {
          avg_server_score: number
          confidence_by_industry: Json
          detection_sources: Json
          high_confidence_rate: number
          low_confidence_rate: number
          medium_confidence_rate: number
          server_ai_match_rate: number
          top_industries: Json
          total_detections: number
        }[]
      }
      get_industry_score_benchmark: {
        Args: {
          p_days_back?: number
          p_industry: string
          p_min_sample_size?: number
          p_score: number
        }
        Returns: {
          industry_avg: number
          percentile: number
          sample_size: number
        }[]
      }
      get_job_board_facets: { Args: never; Returns: Json }
      get_job_board_facets_cached: { Args: never; Returns: Json }
      get_newest_companies: {
        Args: { p_limit?: number }
        Returns: {
          company: string
          company_token: string
          first_added: string
          open_roles: number
        }[]
      }
      get_parse_failure_stats: {
        Args: { p_hours_back?: number }
        Returns: {
          common_errors: Json
          docx_failures: number
          pdf_failures: number
          recent_failures: Json
          spreadsheet_failures: number
          total_failures: number
        }[]
      }
      get_pay_transparency: { Args: never; Returns: Json }
      get_payment_health: {
        Args: { p_hours_back?: number }
        Returns: {
          failed: number
          recent_failures: Json
          success_rate: number
          successful: number
          total_attempts: number
        }[]
      }
      get_public_scan_insights: { Args: never; Returns: Json }
      get_purchased_content_by_email: {
        Args: { p_email: string }
        Returns: {
          created_at: string
          generated_content: Json
          id: string
          product_name: string
          product_type: string
          stripe_session_id: string
        }[]
      }
      get_purchased_content_by_session: {
        Args: { p_session_id: string }
        Returns: {
          created_at: string
          customer_email: string
          generated_content: Json
          id: string
          product_name: string
          product_type: string
        }[]
      }
      get_quiet_boards: {
        Args: { days?: number }
        Returns: {
          company_token: string
        }[]
      }
      get_rate_limit_stats: {
        Args: { p_hours_back?: number }
        Returns: {
          by_function: Json
          recent_limits: Json
          total_limited: number
          unique_ips: number
        }[]
      }
      get_real_score_distribution: {
        Args: { p_industry: string }
        Returns: {
          median: number
          n: number
          p25: number
          p75: number
        }[]
      }
      get_repost_churn_companies: {
        Args: { p_limit?: number }
        Returns: {
          company: string
          company_token: string
          repost_events: number
          reposted_roles: number
          tracking_days: number
          worst_count: number
          worst_title: string
        }[]
      }
      get_repost_index: { Args: never; Returns: Json }
      get_salary_benchmarks: {
        Args: never
        Returns: {
          category: string
          currency: string
          median_annual_min: number
          n: number
        }[]
      }
      get_scan_credits: { Args: { p_email: string }; Returns: number }
      get_scan_geo_stats: {
        Args: { p_hours_back?: number }
        Returns: {
          country: string
          failed_scans: number
          failure_rate: number
          total_scans: number
        }[]
      }
      get_scan_health_status: {
        Args: never
        Returns: {
          avg_latency_last_hour: number
          issues: string[]
          last_heartbeat_status: string
          last_heartbeat_time: string
          last_successful_scan: string
          scans_last_hour: number
          status: string
          success_rate_last_hour: number
        }[]
      }
      get_scan_metrics_hourly: {
        Args: { p_hours_back?: number }
        Returns: {
          avg_duration_ms: number
          cache_hit_rate: number
          completed_scans: number
          failed_scans: number
          hour_bucket: string
          total_scans: number
        }[]
      }
      get_scan_success_rate: {
        Args: { p_hours_back?: number; p_scan_type?: string }
        Returns: {
          avg_duration_ms: number
          cache_hit_rate: number
          completed_scans: number
          failed_scans: number
          p50_duration_ms: number
          p95_duration_ms: number
          success_rate: number
          total_scans: number
          validation_errors: number
        }[]
      }
      get_scan_totals: { Args: never; Returns: Json }
      get_search_quality: {
        Args: { p_days?: number }
        Returns: {
          clicks: number
          ctr: number
          ctr_at_5: number
          day: string
          rescued: number
          searches: number
          zero_rate: number
          zero_result: number
        }[]
      }
      get_similar_companies: {
        Args: { p_limit?: number; p_token: string }
        Returns: Json
      }
      get_size_segment_companies: {
        Args: { p_band: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      get_size_segments: { Args: never; Returns: Json }
      get_stale_board_count: { Args: never; Returns: number }
      get_stats_cache: { Args: never; Returns: Json }
      get_storage_footprint: {
        Args: never
        Returns: {
          closures_bytes: number
          db_bytes: number
          postings_bytes: number
        }[]
      }
      get_takedowns_today: { Args: never; Returns: number }
      get_temp_resume: {
        Args: { p_session_id: string }
        Returns: {
          job_description_text: string
          linkedin_text: string
          resume_text: string
        }[]
      }
      get_today_scan_count: { Args: never; Returns: number }
      get_top_search_misses: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          clicks: number
          q: string
          searches: number
          zero_results: number
        }[]
      }
      get_transparency_cache: { Args: never; Returns: Json }
      get_transparency_coverage: { Args: never; Returns: Json }
      get_transparent_employers: { Args: { p_limit?: number }; Returns: Json }
      get_trending_categories: {
        Args: never
        Returns: {
          category: string
          last7: number
          prior7: number
        }[]
      }
      get_trending_companies: {
        Args: { p_limit?: number }
        Returns: {
          company: string
          company_token: string
          open_roles: number
          recent: number
        }[]
      }
      get_user_score_trend: {
        Args: { p_email: string }
        Returns: {
          ats_score: number
          created_at: string
        }[]
      }
      get_visitor_error_history: {
        Args: { p_visitor_id: string }
        Returns: {
          error_types: string[]
          last_error_at: string
          recent_errors: number
          total_errors: number
        }[]
      }
      get_webhook_health: {
        Args: { p_hours_back?: number }
        Returns: {
          avg_processing_time_ms: number
          events_by_type: Json
          processed_successfully: number
          processing_failed: number
          recent_failures: Json
          success_rate: number
          total_received: number
        }[]
      }
      get_webhook_metrics_hourly: {
        Args: { p_hours_back?: number }
        Returns: {
          avg_processing_time_ms: number
          failed_webhooks: number
          hour_bucket: string
          success_rate: number
          successful_webhooks: number
          total_webhooks: number
        }[]
      }
      increment_free_scan_count: { Args: never; Returns: undefined }
      log_alert_sent: {
        Args: {
          p_actual: number
          p_alert_type: string
          p_metric_name: string
          p_sent_to: string
          p_success: boolean
          p_threshold: number
        }
        Returns: string
      }
      log_delivery_step: {
        Args: {
          p_duration_ms?: number
          p_error?: string
          p_metadata?: Json
          p_step: string
          p_stripe_session_id: string
          p_success?: boolean
        }
        Returns: string
      }
      log_email_send: {
        Args: {
          p_email_type: string
          p_error_message?: string
          p_metadata?: Json
          p_recipient: string
          p_status?: string
          p_subject?: string
        }
        Returns: string
      }
      log_error_telemetry: {
        Args: {
          p_context?: Json
          p_error_code: string
          p_error_message?: string
          p_error_type: string
          p_function_name?: string
          p_http_status?: number
        }
        Returns: boolean
      }
      log_heartbeat_result: {
        Args: {
          p_checks_passed?: Json
          p_error_message?: string
          p_function_name: string
          p_metadata?: Json
          p_response_time_ms: number
          p_status: string
          p_test_passed: boolean
        }
        Returns: string
      }
      log_industry_correction:
        | {
            Args: {
              p_confidence?: string
              p_corrected: string
              p_detected: string
              p_source?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_ai_suggested_industry?: string
              p_corrected_industry: string
              p_detection_source?: string
              p_ip_country?: string
              p_original_confidence?: string
              p_original_industry: string
              p_resume_text_length?: number
              p_server_signals?: string[]
              p_visitor_id?: string
            }
            Returns: string
          }
      log_industry_detection: {
        Args: {
          p_ai_suggested_industry?: string
          p_alternative_industries?: Json
          p_detection_duration_ms?: number
          p_detection_source?: string
          p_final_confidence?: string
          p_final_industry?: string
          p_ip_country?: string
          p_matched_context_patterns?: boolean
          p_matched_skill_count?: number
          p_matched_title_patterns?: string[]
          p_resume_text_length: number
          p_server_ai_match?: boolean
          p_server_ai_parent_match?: boolean
          p_server_confidence?: string
          p_server_industry?: string
          p_server_parent_industry?: string
          p_server_score?: number
          p_server_signals?: string[]
          p_server_sub_industry?: string
          p_visitor_id?: string
        }
        Returns: string
      }
      log_parse_failure: {
        Args: {
          p_error_code?: string
          p_error_message?: string
          p_file_size?: number
          p_file_type: string
          p_metadata?: Json
          p_visitor_id?: string
        }
        Returns: string
      }
      log_scan_metric: {
        Args: {
          p_ai_model?: string
          p_cache_hit?: boolean
          p_duration_ms?: number
          p_error_code?: string
          p_error_message?: string
          p_input_length?: number
          p_ip_country?: string
          p_metadata?: Json
          p_output_valid?: boolean
          p_response_score?: number
          p_scan_type?: string
          p_status?: string
          p_visitor_id?: string
        }
        Returns: string
      }
      log_seniority_correction: {
        Args: {
          p_corrected_level: string
          p_detected_level: string
          p_detected_years?: string
          p_industry?: string
          p_resume_text_length?: number
          p_visitor_id?: string
        }
        Returns: boolean
      }
      log_webhook_event: {
        Args: {
          p_error?: string
          p_event_id: string
          p_event_type: string
          p_payload?: Json
          p_processed?: boolean
          p_time_ms?: number
        }
        Returns: string
      }
      login_affiliate: {
        Args: { p_email: string; p_password: string }
        Returns: Json
      }
      logout_affiliate: { Args: { p_session_token: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      product_delivery_health: {
        Args: { p_hours?: number }
        Returns: {
          exhausted: number
          last_at: string
          n: number
          status: string
          stuck: number
        }[]
      }
      rate_budget_state: {
        Args: { p_function?: string; p_ip: string; p_window_minutes?: number }
        Returns: {
          budget_used: number
          function_used: number
          oldest_window: string
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reconcile_stripe_tick: { Args: never; Returns: undefined }
      record_affiliate_conversion:
        | {
            Args: {
              p_product_name: string
              p_referral_code: string
              p_sale_amount: number
              p_stripe_session_id: string
            }
            Returns: boolean
          }
        | {
            Args: {
              p_commission_override?: number
              p_product_name: string
              p_referral_code: string
              p_sale_amount: number
              p_stripe_session_id: string
            }
            Returns: boolean
          }
        | {
            Args: {
              p_commission_override?: number
              p_product_name: string
              p_referral_code: string
              p_sale_amount: number
              p_stripe_session_id: string
            }
            Returns: boolean
          }
      record_board_pool_sample: { Args: never; Returns: number }
      record_scan_feedback: {
        Args: {
          p_ats_score?: number
          p_feedback_text?: string
          p_had_job_description?: boolean
          p_industry?: string
          p_rating?: boolean
          p_resume_word_count?: number
          p_visitor_id?: string
        }
        Returns: undefined
      }
      record_scan_outcome: {
        Args: { p_ip: string; p_outcome: string; p_report_id: string }
        Returns: boolean
      }
      record_tenant_wall: {
        Args: {
          p_token: string
          p_vendor: string
          p_walled: boolean
          p_walls?: string[]
        }
        Returns: undefined
      }
      refresh_explore_cache: { Args: never; Returns: undefined }
      refresh_ghost_stats: { Args: never; Returns: undefined }
      refresh_job_board_facets: { Args: never; Returns: Json }
      refresh_job_board_stats: { Args: never; Returns: undefined }
      refresh_stats_cache: { Args: never; Returns: undefined }
      refresh_transparency_cache: { Args: never; Returns: undefined }
      register_affiliate: {
        Args: { p_email: string; p_password: string }
        Returns: Json
      }
      release_scan_slot: { Args: { p_id: string }; Returns: undefined }
      roll_up_and_prune_closures: {
        Args: { p_keep_days?: number }
        Returns: {
          months_rolled: number
          rows_pruned: number
        }[]
      }
      save_free_scan_lead: {
        Args: { p_ats_score?: number; p_email: string; p_industry?: string }
        Returns: boolean
      }
      save_purchased_content: {
        Args: {
          p_customer_email: string
          p_generated_content: Json
          p_product_name: string
          p_product_type: string
          p_stripe_session_id: string
        }
        Returns: string
      }
      scrub_emails: { Args: { p_text: string }; Returns: string }
      search_jobs: {
        Args: {
          p_category?: string
          p_companies?: string[]
          p_country?: string
          p_experience?: string[]
          p_fresh_cutoff: string
          p_limit?: number
          p_location?: string
          p_max_age_days?: number
          p_offset?: number
          p_posted_after?: string
          p_q: string
          p_remote?: boolean
          p_salary_floor?: number
          p_sources?: string[]
          p_work_mode?: string
        }
        Returns: {
          apply_url: string
          category: string
          company: string
          company_token: string
          country: string
          department: string
          experience_band: string
          id: string
          last_seen: string
          location: string
          min_years: number
          posted_at: string
          related_rows: number
          remote: boolean
          salary: string
          salary_currency: string
          salary_max_annual: number
          salary_min_annual: number
          salary_period: string
          snippet: string
          source: string
          title: string
          title_match: boolean
          total_rows: number
          work_mode: string
        }[]
      }
      search_jobs_semantic: {
        Args: { p_embedding: string; p_limit?: number; p_max_distance?: number }
        Returns: {
          apply_url: string
          category: string
          company: string
          company_token: string
          department: string
          experience_band: string
          id: string
          last_seen: string
          location: string
          min_years: number
          posted_at: string
          remote: boolean
          salary: string
          salary_currency: string
          salary_max_annual: number
          salary_min_annual: number
          salary_period: string
          similarity: number
          source: string
          title: string
          work_mode: string
        }[]
      }
      should_generate_weekly_report: { Args: never; Returns: boolean }
      should_send_alert: {
        Args: {
          p_alert_type: string
          p_cooldown_minutes?: number
          p_metric_name: string
        }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      snapshot_company_counts: { Args: never; Returns: undefined }
      store_cached_response: {
        Args: {
          p_cache_key: string
          p_function_name: string
          p_response: Json
          p_ttl_hours?: number
        }
        Returns: boolean
      }
      store_temp_resume:
        | { Args: { p_linkedin?: string; p_resume: string }; Returns: string }
        | {
            Args: {
              p_job_description?: string
              p_linkedin?: string
              p_resume: string
            }
            Returns: string
          }
      track_ab_event: {
        Args: {
          p_event_type: string
          p_metadata?: Json
          p_test_name: string
          p_variant: string
          p_visitor_id: string
        }
        Returns: boolean
      }
      track_ab_event_optimized: {
        Args: {
          p_client_ip?: string
          p_event_type: string
          p_max_requests?: number
          p_metadata?: Json
          p_test_name: string
          p_variant: string
          p_visitor_id: string
          p_window_minutes?: number
        }
        Returns: Json
      }
      track_affiliate_click: {
        Args: {
          p_ip_hash?: string
          p_referral_code: string
          p_referrer?: string
          p_user_agent?: string
        }
        Returns: boolean
      }
      update_delivery_retry: {
        Args: {
          p_error?: string
          p_id: string
          p_increment_retry?: boolean
          p_status: string
        }
        Returns: boolean
      }
      use_scan_credit: { Args: { p_email: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
