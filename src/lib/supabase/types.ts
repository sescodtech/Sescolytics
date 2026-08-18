export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      branches: {
        Row: {
          active: boolean
          address: string | null
          code: string
          created_at: string
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          code: string
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          code?: string
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      collection_notes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          loan_id: string
          note: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          loan_id: string
          note: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          loan_id?: string
          note?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          branch_id: string | null
          created_at: string
          created_by: string | null
          customer_code: string
          date_joined: string
          email: string | null
          full_name: string
          gender: "male" | "female" | "other" | null
          id: string
          phone: string
          status: "active" | "inactive" | "archived"
          updated_at: string
        }
        Insert: {
          address?: string | null
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_code: string
          date_joined?: string
          email?: string | null
          full_name: string
          gender?: "male" | "female" | "other" | null
          id?: string
          phone: string
          status?: "active" | "inactive" | "archived"
          updated_at?: string
        }
        Update: {
          address?: string | null
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_code?: string
          date_joined?: string
          email?: string | null
          full_name?: string
          gender?: "male" | "female" | "other" | null
          id?: string
          phone?: string
          status?: "active" | "inactive" | "archived"
          updated_at?: string
        }
        Relationships: []
      }
      investments: {
        Row: {
          amount: number
          branch_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          duration_days: number
          id: string
          interest_rate: number
          investment_number: string
          maturity_date: string
          notes: string | null
          renewed_from: string | null
          start_date: string
          status: "active" | "maturing_soon" | "matured" | "renewed" | "closed"
          updated_at: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          duration_days: number
          id?: string
          interest_rate: number
          investment_number: string
          maturity_date: string
          notes?: string | null
          renewed_from?: string | null
          start_date: string
          status?: "active" | "maturing_soon" | "matured" | "renewed" | "closed"
          updated_at?: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          duration_days?: number
          id?: string
          interest_rate?: number
          investment_number?: string
          maturity_date?: string
          notes?: string | null
          renewed_from?: string | null
          start_date?: string
          status?: "active" | "maturing_soon" | "matured" | "renewed" | "closed"
          updated_at?: string
        }
        Relationships: []
      }
      loan_import_batches: {
        Row: {
          created_at: string
          errors_json: Json | null
          failed_records: number
          filename: string
          id: string
          status: "processing" | "completed" | "failed"
          successful_records: number
          total_records: number
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          errors_json?: Json | null
          failed_records?: number
          filename: string
          id?: string
          status?: "processing" | "completed" | "failed"
          successful_records?: number
          total_records?: number
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          errors_json?: Json | null
          failed_records?: number
          filename?: string
          id?: string
          status?: "processing" | "completed" | "failed"
          successful_records?: number
          total_records?: number
          uploaded_by?: string | null
        }
        Relationships: []
      }
      loans: {
        Row: {
          amount_paid: number
          assigned_officer_id: string | null
          branch_id: string | null
          collection_status: "current" | "reminder_sent" | "follow_up_required" | "promise_to_pay" | "partially_paid" | "fully_paid"
          created_at: string
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          due_date: string
          id: string
          import_batch_id: string | null
          interest_amount: number
          loan_number: string
          next_due_date: string | null
          outstanding_balance: number
          principal_amount: number
          repayment_frequency: "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "bullet"
          start_date: string
          status: "active" | "due_today" | "due_tomorrow" | "overdue" | "completed"
          total_amount: number
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          assigned_officer_id?: string | null
          branch_id?: string | null
          collection_status?: "current" | "reminder_sent" | "follow_up_required" | "promise_to_pay" | "partially_paid" | "fully_paid"
          created_at?: string
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          due_date: string
          id?: string
          import_batch_id?: string | null
          interest_amount?: number
          loan_number: string
          next_due_date?: string | null
          outstanding_balance: number
          principal_amount: number
          repayment_frequency?: "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "bullet"
          start_date: string
          status?: "active" | "due_today" | "due_tomorrow" | "overdue" | "completed"
          total_amount: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          assigned_officer_id?: string | null
          branch_id?: string | null
          collection_status?: "current" | "reminder_sent" | "follow_up_required" | "promise_to_pay" | "partially_paid" | "fully_paid"
          created_at?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          due_date?: string
          id?: string
          import_batch_id?: string | null
          interest_amount?: number
          loan_number?: string
          next_due_date?: string | null
          outstanding_balance?: number
          principal_amount?: number
          repayment_frequency?: "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "bullet"
          start_date?: string
          status?: "active" | "due_today" | "due_tomorrow" | "overdue" | "completed"
          total_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          branch_id: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      promise_to_pay: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          loan_id: string
          notes: string | null
          promise_date: string
          promised_amount: number
          status: "pending" | "fulfilled" | "broken"
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          loan_id: string
          notes?: string | null
          promise_date: string
          promised_amount: number
          status?: "pending" | "fulfilled" | "broken"
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          loan_id?: string
          notes?: string | null
          promise_date?: string
          promised_amount?: number
          status?: "pending" | "fulfilled" | "broken"
          updated_at?: string
        }
        Relationships: []
      }
      reminder_templates: {
        Row: {
          active: boolean
          body: string
          channel: "sms" | "whatsapp" | "email"
          created_at: string
          id: string
          name: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          body: string
          channel: "sms" | "whatsapp" | "email"
          created_at?: string
          id?: string
          name: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          channel?: "sms" | "whatsapp" | "email"
          created_at?: string
          id?: string
          name?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          channel: "sms" | "whatsapp" | "email"
          created_at: string
          customer_id: string | null
          error: string | null
          id: string
          loan_id: string | null
          message: string
          reason: string | null
          recipient: string
          sent_at: string | null
          sent_by: string | null
          status: "queued" | "sent" | "failed"
          subject: string | null
          template_id: string | null
        }
        Insert: {
          channel: "sms" | "whatsapp" | "email"
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          loan_id?: string | null
          message: string
          reason?: string | null
          recipient: string
          sent_at?: string | null
          sent_by?: string | null
          status?: "queued" | "sent" | "failed"
          subject?: string | null
          template_id?: string | null
        }
        Update: {
          channel?: "sms" | "whatsapp" | "email"
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          loan_id?: string | null
          message?: string
          reason?: string | null
          recipient?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: "queued" | "sent" | "failed"
          subject?: string | null
          template_id?: string | null
        }
        Relationships: []
      }
      repayments: {
        Row: {
          amount: number
          created_at: string
          id: string
          loan_id: string
          method: string | null
          notes: string | null
          payment_date: string
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          loan_id: string
          method?: string | null
          notes?: string | null
          payment_date?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          loan_id?: string
          method?: string | null
          notes?: string | null
          payment_date?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: "super_admin" | "branch_manager" | "collection_officer" | "investment_officer" | "auditor"
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: "super_admin" | "branch_manager" | "collection_officer" | "investment_officer" | "auditor"
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: "super_admin" | "branch_manager" | "collection_officer" | "investment_officer" | "auditor"
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      has_role: {
        Args: { _role: string; _user_id: string }
        Returns: boolean
      }
      has_any_role: {
        Args: { _roles: string[]; _user_id: string }
        Returns: boolean
      }
      refresh_loan_statuses: { Args: Record<string, never>; Returns: undefined }
      refresh_investment_statuses: { Args: Record<string, never>; Returns: undefined }
    }
    Enums: {
      app_role: "super_admin" | "branch_manager" | "collection_officer" | "investment_officer" | "auditor"
      collection_status: "current" | "reminder_sent" | "follow_up_required" | "promise_to_pay" | "partially_paid" | "fully_paid"
      customer_status: "active" | "inactive" | "archived"
      gender: "male" | "female" | "other"
      import_status: "processing" | "completed" | "failed"
      investment_status: "active" | "maturing_soon" | "matured" | "renewed" | "closed"
      loan_status: "active" | "due_today" | "due_tomorrow" | "overdue" | "completed"
      ptp_status: "pending" | "fulfilled" | "broken"
      reminder_channel: "sms" | "whatsapp" | "email"
      reminder_status: "queued" | "sent" | "failed"
      repayment_freq: "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "bullet"
    }
    CompositeTypes: Record<string, never>
  }
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"]
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T]
