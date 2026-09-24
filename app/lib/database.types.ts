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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          country_code: string | null
          created_at: string
          id: string
          industry: string | null
          name: string
          region: string | null
          segment: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          name: string
          region?: string | null
          segment?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          country_code?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          name?: string
          region?: string | null
          segment?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      actions: {
        Row: {
          action_type: string
          body: string | null
          completed_at: string | null
          created_at: string
          deal_id: string
          decision_id: string | null
          due_date: string | null
          exception_id: string | null
          id: string
          prepared_by: string
          source_finding_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          action_type: string
          body?: string | null
          completed_at?: string | null
          created_at?: string
          deal_id: string
          decision_id?: string | null
          due_date?: string | null
          exception_id?: string | null
          id?: string
          prepared_by: string
          source_finding_id?: string | null
          status: string
          title: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          body?: string | null
          completed_at?: string | null
          created_at?: string
          deal_id?: string
          decision_id?: string | null
          due_date?: string | null
          exception_id?: string | null
          id?: string
          prepared_by?: string
          source_finding_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "actions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_decision_fkey"
            columns: ["decision_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id", "deal_id"]
          },
          {
            foreignKeyName: "actions_exception_fkey"
            columns: ["exception_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "exceptions"
            referencedColumns: ["id", "deal_id"]
          },
          {
            foreignKeyName: "actions_source_finding_fkey"
            columns: ["source_finding_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "ai_findings"
            referencedColumns: ["id", "deal_id"]
          },
        ]
      }
      ai_finding_excerpts: {
        Row: {
          created_at: string
          deal_id: string
          excerpt_id: string
          finding_id: string
          quote: string | null
        }
        Insert: {
          created_at?: string
          deal_id: string
          excerpt_id: string
          finding_id: string
          quote?: string | null
        }
        Update: {
          created_at?: string
          deal_id?: string
          excerpt_id?: string
          finding_id?: string
          quote?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_finding_excerpts_excerpt_fkey"
            columns: ["excerpt_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "evidence_excerpts"
            referencedColumns: ["id", "deal_id"]
          },
          {
            foreignKeyName: "ai_finding_excerpts_finding_fkey"
            columns: ["finding_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "ai_findings"
            referencedColumns: ["id", "deal_id"]
          },
        ]
      }
      ai_findings: {
        Row: {
          content: string
          created_at: string
          deal_id: string
          finding_type: string
          id: string
          model: string
          payload: Json | null
          prompt_version: string
          rule_key: string | null
          rule_version: string | null
          status: string
        }
        Insert: {
          content: string
          created_at?: string
          deal_id: string
          finding_type: string
          id?: string
          model: string
          payload?: Json | null
          prompt_version: string
          rule_key?: string | null
          rule_version?: string | null
          status?: string
        }
        Update: {
          content?: string
          created_at?: string
          deal_id?: string
          finding_type?: string
          id?: string
          model?: string
          payload?: Json | null
          prompt_version?: string
          rule_key?: string | null
          rule_version?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_findings_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_outcomes: {
        Row: {
          created_at: string
          deal_id: string
          final_arr_eur: number | null
          id: string
          note: string | null
          outcome: string
          outcome_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          final_arr_eur?: number | null
          id?: string
          note?: string | null
          outcome: string
          outcome_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          final_arr_eur?: number | null
          id?: string
          note?: string | null
          outcome?: string
          outcome_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_outcomes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          account_id: string
          arr_eur: number
          auto_renew: boolean | null
          created_at: string
          deal_type: string
          discount_pct: number | null
          end_date: string | null
          id: string
          list_price_eur: number | null
          name: string
          notice_period_days: number | null
          predecessor_deal_id: string | null
          renewal_date: string | null
          stage: string
          start_date: string | null
          tcv_eur: number | null
          term_months: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          arr_eur: number
          auto_renew?: boolean | null
          created_at?: string
          deal_type: string
          discount_pct?: number | null
          end_date?: string | null
          id?: string
          list_price_eur?: number | null
          name: string
          notice_period_days?: number | null
          predecessor_deal_id?: string | null
          renewal_date?: string | null
          stage: string
          start_date?: string | null
          tcv_eur?: number | null
          term_months?: number | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          account_id?: string
          arr_eur?: number
          auto_renew?: boolean | null
          created_at?: string
          deal_type?: string
          discount_pct?: number | null
          end_date?: string | null
          id?: string
          list_price_eur?: number | null
          name?: string
          notice_period_days?: number | null
          predecessor_deal_id?: string | null
          renewal_date?: string | null
          stage?: string
          start_date?: string | null
          tcv_eur?: number | null
          term_months?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_account_fkey"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "deals_predecessor_fkey"
            columns: ["predecessor_deal_id", "user_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      decisions: {
        Row: {
          conditions: string | null
          considered_finding_id: string | null
          created_at: string
          deal_id: string
          decision_type: string
          exception_id: string | null
          id: string
          rationale: string
        }
        Insert: {
          conditions?: string | null
          considered_finding_id?: string | null
          created_at?: string
          deal_id: string
          decision_type: string
          exception_id?: string | null
          id?: string
          rationale: string
        }
        Update: {
          conditions?: string | null
          considered_finding_id?: string | null
          created_at?: string
          deal_id?: string
          decision_type?: string
          exception_id?: string | null
          id?: string
          rationale?: string
        }
        Relationships: [
          {
            foreignKeyName: "decisions_considered_finding_fkey"
            columns: ["considered_finding_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "ai_findings"
            referencedColumns: ["id", "deal_id"]
          },
          {
            foreignKeyName: "decisions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decisions_exception_fkey"
            columns: ["exception_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "exceptions"
            referencedColumns: ["id", "deal_id"]
          },
        ]
      }
      evidence_excerpts: {
        Row: {
          content: string
          content_tsv: unknown
          created_at: string
          deal_id: string
          end_offset: number
          evidence_item_id: string
          id: string
          ordinal: number
          section_label: string | null
          start_offset: number
        }
        Insert: {
          content: string
          content_tsv?: unknown
          created_at?: string
          deal_id: string
          end_offset: number
          evidence_item_id: string
          id?: string
          ordinal: number
          section_label?: string | null
          start_offset: number
        }
        Update: {
          content?: string
          content_tsv?: unknown
          created_at?: string
          deal_id?: string
          end_offset?: number
          evidence_item_id?: string
          id?: string
          ordinal?: number
          section_label?: string | null
          start_offset?: number
        }
        Relationships: [
          {
            foreignKeyName: "evidence_excerpts_evidence_item_fkey"
            columns: ["evidence_item_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id", "deal_id"]
          },
        ]
      }
      evidence_items: {
        Row: {
          author: string | null
          body_text: string
          created_at: string
          deal_id: string
          document_date: string | null
          evidence_type: string
          id: string
          is_executed: boolean
          mime_type: string | null
          original_filename: string | null
          source_kind: string
          storage_path: string | null
          supersedes_evidence_id: string | null
          title: string
          version_label: string | null
        }
        Insert: {
          author?: string | null
          body_text: string
          created_at?: string
          deal_id: string
          document_date?: string | null
          evidence_type: string
          id?: string
          is_executed?: boolean
          mime_type?: string | null
          original_filename?: string | null
          source_kind: string
          storage_path?: string | null
          supersedes_evidence_id?: string | null
          title: string
          version_label?: string | null
        }
        Update: {
          author?: string | null
          body_text?: string
          created_at?: string
          deal_id?: string
          document_date?: string | null
          evidence_type?: string
          id?: string
          is_executed?: boolean
          mime_type?: string | null
          original_filename?: string | null
          source_kind?: string
          storage_path?: string | null
          supersedes_evidence_id?: string | null
          title?: string
          version_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_items_supersedes_fkey"
            columns: ["supersedes_evidence_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id", "deal_id"]
          },
        ]
      }
      exceptions: {
        Row: {
          created_at: string
          deal_id: string
          id: string
          kind: string
          origin: string
          provision_id: string | null
          rule_key: string
          rule_version: string
          severity: string
          source_finding_id: string | null
          status: string
          status_changed_at: string
          title: string
          updated_at: string
          why: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          id?: string
          kind: string
          origin: string
          provision_id?: string | null
          rule_key: string
          rule_version: string
          severity: string
          source_finding_id?: string | null
          status?: string
          status_changed_at?: string
          title: string
          updated_at?: string
          why: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          id?: string
          kind?: string
          origin?: string
          provision_id?: string | null
          rule_key?: string
          rule_version?: string
          severity?: string
          source_finding_id?: string | null
          status?: string
          status_changed_at?: string
          title?: string
          updated_at?: string
          why?: string
        }
        Relationships: [
          {
            foreignKeyName: "exceptions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_provision_fkey"
            columns: ["provision_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "provisions"
            referencedColumns: ["id", "deal_id"]
          },
          {
            foreignKeyName: "exceptions_source_finding_fkey"
            columns: ["source_finding_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "ai_findings"
            referencedColumns: ["id", "deal_id"]
          },
        ]
      }
      provision_excerpts: {
        Row: {
          created_at: string
          deal_id: string
          excerpt_id: string
          provision_id: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          excerpt_id: string
          provision_id: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          excerpt_id?: string
          provision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provision_excerpts_excerpt_fkey"
            columns: ["excerpt_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "evidence_excerpts"
            referencedColumns: ["id", "deal_id"]
          },
          {
            foreignKeyName: "provision_excerpts_provision_fkey"
            columns: ["provision_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "provisions"
            referencedColumns: ["id", "deal_id"]
          },
        ]
      }
      provisions: {
        Row: {
          confirmed_at: string
          created_at: string
          deal_id: string
          id: string
          provision_type: string
          source: string
          source_finding_id: string | null
          updated_at: string
          value_numeric: number | null
          value_text: string
          value_unit: string | null
        }
        Insert: {
          confirmed_at?: string
          created_at?: string
          deal_id: string
          id?: string
          provision_type: string
          source: string
          source_finding_id?: string | null
          updated_at?: string
          value_numeric?: number | null
          value_text: string
          value_unit?: string | null
        }
        Update: {
          confirmed_at?: string
          created_at?: string
          deal_id?: string
          id?: string
          provision_type?: string
          source?: string
          source_finding_id?: string | null
          updated_at?: string
          value_numeric?: number | null
          value_text?: string
          value_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provisions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provisions_source_finding_fkey"
            columns: ["source_finding_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "ai_findings"
            referencedColumns: ["id", "deal_id"]
          },
        ]
      }
      saved_assessments: {
        Row: {
          answers_version: number
          contacts_enriched_per_month: number | null
          created_at: string
          crm_system: string | null
          emails_sent_per_month: number | null
          eu_data_residency_required: boolean
          id: string
          label: string | null
          mailboxes: number | null
          seats: number | null
          track: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answers_version?: number
          contacts_enriched_per_month?: number | null
          created_at?: string
          crm_system?: string | null
          emails_sent_per_month?: number | null
          eu_data_residency_required?: boolean
          id?: string
          label?: string | null
          mailboxes?: number | null
          seats?: number | null
          track?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          answers_version?: number
          contacts_enriched_per_month?: number | null
          created_at?: string
          crm_system?: string | null
          emails_sent_per_month?: number | null
          eu_data_residency_required?: boolean
          id?: string
          label?: string | null
          mailboxes?: number | null
          seats?: number | null
          track?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
