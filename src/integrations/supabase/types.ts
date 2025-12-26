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
      add_scan_credits: {
        Args: { p_credits: number; p_email: string }
        Returns: boolean
      }
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
      delete_analysis_by_share_id: {
        Args: { p_share_id: string }
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
      get_ab_test_stats: {
        Args: { p_test_name: string }
        Returns: {
          conversion_rate: number
          conversions: number
          variant: string
          views: number
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
      get_cached_response: {
        Args: { p_cache_key: string; p_function_name: string }
        Returns: Json
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
      get_industry_correction_stats: {
        Args: { p_days_back?: number }
        Returns: {
          avg_confidence: string
          common_signals: string[]
          corrected_to: string
          correction_count: number
          original_industry: string
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
      get_rate_limit_stats: {
        Args: { p_hours_back?: number }
        Returns: {
          by_function: Json
          recent_limits: Json
          total_limited: number
          unique_ips: number
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
      get_temp_resume: {
        Args: { p_session_id: string }
        Returns: {
          job_description_text: string
          linkedin_text: string
          resume_text: string
        }[]
      }
      get_today_scan_count: { Args: never; Returns: number }
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
      log_industry_correction: {
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
      register_affiliate: {
        Args: { p_email: string; p_password: string }
        Returns: Json
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
      should_generate_weekly_report: { Args: never; Returns: boolean }
      should_send_alert: {
        Args: {
          p_alert_type: string
          p_cooldown_minutes?: number
          p_metric_name: string
        }
        Returns: boolean
      }
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
