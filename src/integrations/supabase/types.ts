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
      cleanup_expired_analyses: { Args: never; Returns: number }
      cleanup_expired_cache: { Args: never; Returns: number }
      cleanup_expired_stripe_sessions: { Args: never; Returns: number }
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
      get_scan_credits: { Args: { p_email: string }; Returns: number }
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
      increment_free_scan_count: { Args: never; Returns: undefined }
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
      register_affiliate: {
        Args: { p_email: string; p_password: string }
        Returns: Json
      }
      save_free_scan_lead: {
        Args: { p_ats_score?: number; p_email: string; p_industry?: string }
        Returns: boolean
      }
      should_generate_weekly_report: { Args: never; Returns: boolean }
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
      track_affiliate_click: {
        Args: {
          p_ip_hash?: string
          p_referral_code: string
          p_referrer?: string
          p_user_agent?: string
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
