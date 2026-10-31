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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      advisory_actions: {
        Row: {
          client_id: string
          due_date: string | null
          id: string
          is_demo: boolean
          notes: string | null
          owner: string | null
          report_id: string | null
          status: string
          title: string
        }
        Insert: {
          client_id: string
          due_date?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          owner?: string | null
          report_id?: string | null
          status?: string
          title: string
        }
        Update: {
          client_id?: string
          due_date?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          owner?: string | null
          report_id?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "advisory_actions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advisory_actions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "advisory_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      advisory_reports: {
        Row: {
          budget_vs_actual: string | null
          business_challenges: string | null
          cash_bank: number | null
          cash_flow: number | null
          client_id: string
          created_at: string
          gross_profit: number | null
          gross_profit_pct: number | null
          id: string
          inventory: number | null
          is_demo: boolean
          key_ratios: string | null
          meeting_notes: string | null
          net_profit: number | null
          operating_expenses: number | null
          payables: number | null
          period: string
          receivables: number | null
          recommendations: string | null
          sales: number | null
          source: string | null
        }
        Insert: {
          budget_vs_actual?: string | null
          business_challenges?: string | null
          cash_bank?: number | null
          cash_flow?: number | null
          client_id: string
          created_at?: string
          gross_profit?: number | null
          gross_profit_pct?: number | null
          id?: string
          inventory?: number | null
          is_demo?: boolean
          key_ratios?: string | null
          meeting_notes?: string | null
          net_profit?: number | null
          operating_expenses?: number | null
          payables?: number | null
          period: string
          receivables?: number | null
          recommendations?: string | null
          sales?: number | null
          source?: string | null
        }
        Update: {
          budget_vs_actual?: string | null
          business_challenges?: string | null
          cash_bank?: number | null
          cash_flow?: number | null
          client_id?: string
          created_at?: string
          gross_profit?: number | null
          gross_profit_pct?: number | null
          id?: string
          inventory?: number | null
          is_demo?: boolean
          key_ratios?: string | null
          meeting_notes?: string | null
          net_profit?: number | null
          operating_expenses?: number | null
          payables?: number | null
          period?: string
          receivables?: number | null
          recommendations?: string | null
          sales?: number | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advisory_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_comments: {
        Row: {
          assignment_id: string
          author_id: string | null
          body: string
          created_at: string
          id: string
        }
        Insert: {
          assignment_id: string
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
        }
        Update: {
          assignment_id?: string
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_comments_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "work_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_stages: {
        Row: {
          assignment_id: string
          completed: boolean
          completed_at: string | null
          completed_by: string | null
          id: string
          position: number
          title: string
        }
        Insert: {
          assignment_id: string
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          id?: string
          position: number
          title: string
        }
        Update: {
          assignment_id?: string
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          id?: string
          position?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_stages_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "work_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_stages_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_engagements: {
        Row: {
          areas_reviewed: string | null
          audit_period: string
          client_id: string
          created_at: string
          follow_up_date: string | null
          id: string
          is_demo: boolean
          notes: string | null
          report_version: string | null
          scope: string | null
          status: string
          team: string | null
          visit_dates: string | null
        }
        Insert: {
          areas_reviewed?: string | null
          audit_period: string
          client_id: string
          created_at?: string
          follow_up_date?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          report_version?: string | null
          scope?: string | null
          status?: string
          team?: string | null
          visit_dates?: string | null
        }
        Update: {
          areas_reviewed?: string | null
          audit_period?: string
          client_id?: string
          created_at?: string
          follow_up_date?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          report_version?: string | null
          scope?: string | null
          status?: string
          team?: string | null
          visit_dates?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_engagements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_findings: {
        Row: {
          closed_at: string | null
          description: string | null
          engagement_id: string
          id: string
          is_demo: boolean
          management_response: string | null
          recommendation: string | null
          reference: string | null
          responsible_person: string | null
          risk_category: string
          status: string
          target_date: string | null
          title: string
        }
        Insert: {
          closed_at?: string | null
          description?: string | null
          engagement_id: string
          id?: string
          is_demo?: boolean
          management_response?: string | null
          recommendation?: string | null
          reference?: string | null
          responsible_person?: string | null
          risk_category?: string
          status?: string
          target_date?: string | null
          title: string
        }
        Update: {
          closed_at?: string | null
          description?: string | null
          engagement_id?: string
          id?: string
          is_demo?: boolean
          management_response?: string | null
          recommendation?: string | null
          reference?: string | null
          responsible_person?: string | null
          risk_category?: string
          status?: string
          target_date?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_findings_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          assignment_id: string
          done: boolean
          done_at: string | null
          done_by: string | null
          id: string
          title: string
        }
        Insert: {
          assignment_id: string
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          id?: string
          title: string
        }
        Update: {
          assignment_id?: string
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "work_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_branches: {
        Row: {
          address: string | null
          branch_name: string
          client_id: string
          gstin: string | null
          id: string
          is_demo: boolean
          is_primary: boolean
          state: string | null
        }
        Insert: {
          address?: string | null
          branch_name: string
          client_id: string
          gstin?: string | null
          id?: string
          is_demo?: boolean
          is_primary?: boolean
          state?: string | null
        }
        Update: {
          address?: string | null
          branch_name?: string
          client_id?: string
          gstin?: string | null
          id?: string
          is_demo?: boolean
          is_primary?: boolean
          state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_branches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          client_id: string
          designation: string | null
          email: string | null
          id: string
          is_demo: boolean
          is_primary: boolean
          name: string
          phone: string | null
          whatsapp: string | null
        }
        Insert: {
          client_id: string
          designation?: string | null
          email?: string | null
          id?: string
          is_demo?: boolean
          is_primary?: boolean
          name: string
          phone?: string | null
          whatsapp?: string | null
        }
        Update: {
          client_id?: string
          designation?: string | null
          email?: string | null
          id?: string
          is_demo?: boolean
          is_primary?: boolean
          name?: string
          phone?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tax_money: {
        Row: {
          amount_paid: number
          amount_received: number
          assignment_id: string | null
          client_id: string
          id: string
          is_demo: boolean
          notes: string | null
          paid_on: string | null
          payment_reference: string | null
          purpose: string
          received_on: string | null
          responsible: string | null
          status: string
          tax_period: string | null
        }
        Insert: {
          amount_paid?: number
          amount_received?: number
          assignment_id?: string | null
          client_id: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          paid_on?: string | null
          payment_reference?: string | null
          purpose?: string
          received_on?: string | null
          responsible?: string | null
          status?: string
          tax_period?: string | null
        }
        Update: {
          amount_paid?: number
          amount_received?: number
          assignment_id?: string | null
          client_id?: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          paid_on?: string | null
          payment_reference?: string | null
          purpose?: string
          received_on?: string | null
          responsible?: string | null
          status?: string
          tax_period?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_tax_money_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "work_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tax_money_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tax_money_responsible_fkey"
            columns: ["responsible"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address_line: string | null
          alt_contact_email: string | null
          alt_contact_name: string | null
          alt_contact_phone: string | null
          billing_frequency: string | null
          category: string | null
          city: string | null
          client_code: string
          client_type: string
          contact_designation: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          fee_terms: string | null
          gstin: string | null
          id: string
          industry: string | null
          is_demo: boolean
          mobile: string | null
          name: string
          nature_of_business: string | null
          notes: string | null
          onboarded_on: string | null
          other_registrations: string | null
          pan: string | null
          payment_due_days: number
          pin_code: string | null
          primary_department: string | null
          primary_staff: string | null
          recurring_fee: number
          relationship_manager: string | null
          source: string | null
          state: string | null
          status: string
          trade_name: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          address_line?: string | null
          alt_contact_email?: string | null
          alt_contact_name?: string | null
          alt_contact_phone?: string | null
          billing_frequency?: string | null
          category?: string | null
          city?: string | null
          client_code: string
          client_type?: string
          contact_designation?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          fee_terms?: string | null
          gstin?: string | null
          id?: string
          industry?: string | null
          is_demo?: boolean
          mobile?: string | null
          name: string
          nature_of_business?: string | null
          notes?: string | null
          onboarded_on?: string | null
          other_registrations?: string | null
          pan?: string | null
          payment_due_days?: number
          pin_code?: string | null
          primary_department?: string | null
          primary_staff?: string | null
          recurring_fee?: number
          relationship_manager?: string | null
          source?: string | null
          state?: string | null
          status?: string
          trade_name?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          address_line?: string | null
          alt_contact_email?: string | null
          alt_contact_name?: string | null
          alt_contact_phone?: string | null
          billing_frequency?: string | null
          category?: string | null
          city?: string | null
          client_code?: string
          client_type?: string
          contact_designation?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          fee_terms?: string | null
          gstin?: string | null
          id?: string
          industry?: string | null
          is_demo?: boolean
          mobile?: string | null
          name?: string
          nature_of_business?: string | null
          notes?: string | null
          onboarded_on?: string | null
          other_registrations?: string | null
          pan?: string | null
          payment_due_days?: number
          pin_code?: string | null
          primary_department?: string | null
          primary_staff?: string | null
          recurring_fee?: number
          relationship_manager?: string | null
          source?: string | null
          state?: string | null
          status?: string
          trade_name?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_primary_department_fkey"
            columns: ["primary_department"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_primary_staff_fkey"
            columns: ["primary_staff"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_relationship_manager_fkey"
            columns: ["relationship_manager"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_followups: {
        Row: {
          client_id: string
          id: string
          invoice_id: string | null
          is_demo: boolean
          last_follow_up: string | null
          next_follow_up: string | null
          notes: string | null
          owner: string | null
          promised_date: string | null
          response: string | null
        }
        Insert: {
          client_id: string
          id?: string
          invoice_id?: string | null
          is_demo?: boolean
          last_follow_up?: string | null
          next_follow_up?: string | null
          notes?: string | null
          owner?: string | null
          promised_date?: string | null
          response?: string | null
        }
        Update: {
          client_id?: string
          id?: string
          invoice_id?: string | null
          is_demo?: boolean
          last_follow_up?: string | null
          next_follow_up?: string | null
          notes?: string | null
          owner?: string | null
          promised_date?: string | null
          response?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_followups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_followups_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_followups_owner_fkey"
            columns: ["owner"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comm_logs: {
        Row: {
          assignment_id: string | null
          channel: string
          client_id: string | null
          content: string
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string | null
          message_type: string
          next_follow_up: string | null
          status: string
          template_id: string | null
        }
        Insert: {
          assignment_id?: string | null
          channel?: string
          client_id?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          message_type: string
          next_follow_up?: string | null
          status?: string
          template_id?: string | null
        }
        Update: {
          assignment_id?: string | null
          channel?: string
          client_id?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          message_type?: string
          next_follow_up?: string | null
          status?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comm_logs_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "work_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comm_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comm_logs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comm_logs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "comm_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      comm_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          is_active: boolean
          language: string
          message_type: string
          name: string
          subject: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_active?: boolean
          language?: string
          message_type: string
          name: string
          subject?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_active?: boolean
          language?: string
          message_type?: string
          name?: string
          subject?: string | null
        }
        Relationships: []
      }
      departments: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      document_items: {
        Row: {
          assignment_id: string | null
          category: string | null
          client_id: string
          created_at: string
          due_date: string | null
          file_path: string | null
          id: string
          is_demo: boolean
          name: string
          notes: string | null
          period: string | null
          received_on: string | null
          requested_on: string | null
          responsible: string | null
          status: string
        }
        Insert: {
          assignment_id?: string | null
          category?: string | null
          client_id: string
          created_at?: string
          due_date?: string | null
          file_path?: string | null
          id?: string
          is_demo?: boolean
          name: string
          notes?: string | null
          period?: string | null
          received_on?: string | null
          requested_on?: string | null
          responsible?: string | null
          status?: string
        }
        Update: {
          assignment_id?: string | null
          category?: string | null
          client_id?: string
          created_at?: string
          due_date?: string | null
          file_path?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          notes?: string | null
          period?: string | null
          received_on?: string | null
          requested_on?: string | null
          responsible?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_items_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "work_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_items_responsible_fkey"
            columns: ["responsible"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      engagements: {
        Row: {
          agreed_fee: number
          billing_frequency: string | null
          client_id: string
          created_at: string
          engagement_code: string
          fee_terms: string | null
          id: string
          is_demo: boolean
          notes: string | null
          service_id: string
          start_date: string | null
          status: string
        }
        Insert: {
          agreed_fee?: number
          billing_frequency?: string | null
          client_id: string
          created_at?: string
          engagement_code: string
          fee_terms?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          service_id: string
          start_date?: string | null
          status?: string
        }
        Update: {
          agreed_fee?: number
          billing_frequency?: string | null
          client_id?: string
          created_at?: string
          engagement_code?: string
          fee_terms?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          service_id?: string
          start_date?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagements_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          amount: number
          description: string
          id: string
          invoice_id: string
          is_demo: boolean
          quantity: number
          rate: number
        }
        Insert: {
          amount?: number
          description: string
          id?: string
          invoice_id: string
          is_demo?: boolean
          quantity?: number
          rate?: number
        }
        Update: {
          amount?: number
          description?: string
          id?: string
          invoice_id?: string
          is_demo?: boolean
          quantity?: number
          rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_received: number
          assignment_id: string | null
          client_id: string
          created_at: string
          description: string | null
          discount: number
          due_date: string | null
          engagement_id: string | null
          id: string
          invoice_date: string
          invoice_number: string
          is_demo: boolean
          notes: string | null
          prepared_by: string | null
          status: string
          subtotal: number
          tax_amount: number
          tax_rate: number
          total: number
        }
        Insert: {
          amount_received?: number
          assignment_id?: string | null
          client_id: string
          created_at?: string
          description?: string | null
          discount?: number
          due_date?: string | null
          engagement_id?: string | null
          id?: string
          invoice_date?: string
          invoice_number: string
          is_demo?: boolean
          notes?: string | null
          prepared_by?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
        }
        Update: {
          amount_received?: number
          assignment_id?: string | null
          client_id?: string
          created_at?: string
          description?: string | null
          discount?: number
          due_date?: string | null
          engagement_id?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          is_demo?: boolean
          notes?: string | null
          prepared_by?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "work_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_settings: {
        Row: {
          address: string | null
          bank_account: string | null
          bank_name: string | null
          default_tax_rate: number
          email: string | null
          firm_name: string
          id: number
          ifsc: string | null
          invoice_prefix: string
          logo_url: string | null
          phone: string | null
          reminder_rules: Json
          tax_label: string | null
          updated_at: string
          upi_id: string | null
          whatsapp_provider: string | null
        }
        Insert: {
          address?: string | null
          bank_account?: string | null
          bank_name?: string | null
          default_tax_rate?: number
          email?: string | null
          firm_name?: string
          id?: number
          ifsc?: string | null
          invoice_prefix?: string
          logo_url?: string | null
          phone?: string | null
          reminder_rules?: Json
          tax_label?: string | null
          updated_at?: string
          upi_id?: string | null
          whatsapp_provider?: string | null
        }
        Update: {
          address?: string | null
          bank_account?: string | null
          bank_name?: string | null
          default_tax_rate?: number
          email?: string | null
          firm_name?: string
          id?: number
          ifsc?: string | null
          invoice_prefix?: string
          logo_url?: string | null
          phone?: string | null
          reminder_rules?: Json
          tax_label?: string | null
          updated_at?: string
          upi_id?: string | null
          whatsapp_provider?: string | null
        }
        Relationships: []
      }
      payment_allocations: {
        Row: {
          amount: number
          id: string
          invoice_id: string
          is_demo: boolean
          payment_id: string
        }
        Insert: {
          amount?: number
          id?: string
          invoice_id: string
          is_demo?: boolean
          payment_id: string
        }
        Update: {
          amount?: number
          id?: string
          invoice_id?: string
          is_demo?: boolean
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          bank_account: string | null
          client_id: string
          created_at: string
          id: string
          is_demo: boolean
          method: string
          notes: string | null
          receipt_date: string
          receipt_number: string
          recorded_by: string | null
          reference_no: string | null
        }
        Insert: {
          amount?: number
          bank_account?: string | null
          client_id: string
          created_at?: string
          id?: string
          is_demo?: boolean
          method?: string
          notes?: string | null
          receipt_date?: string
          receipt_number: string
          recorded_by?: string | null
          reference_no?: string | null
        }
        Update: {
          amount?: number
          bank_account?: string | null
          client_id?: string
          created_at?: string
          id?: string
          is_demo?: boolean
          method?: string
          notes?: string | null
          receipt_date?: string
          receipt_number?: string
          recorded_by?: string | null
          reference_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          designation: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
        }
        Insert: {
          created_at?: string
          designation?: string | null
          email?: string
          full_name?: string
          id: string
          is_active?: boolean
          phone?: string | null
        }
        Update: {
          created_at?: string
          designation?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
        }
        Relationships: []
      }
      services: {
        Row: {
          billing_frequency: string | null
          billing_milestone: string | null
          code: string
          created_at: string
          default_fee: number
          default_staff_role: string | null
          default_workflow_template_id: string | null
          department_id: string | null
          id: string
          is_active: boolean
          is_recurring: boolean
          name: string
          recurrence_frequency: string | null
          reminder_schedule: string | null
          required_documents: string | null
          requires_review: boolean
          service_group: string
          timeline_days: number | null
        }
        Insert: {
          billing_frequency?: string | null
          billing_milestone?: string | null
          code: string
          created_at?: string
          default_fee?: number
          default_staff_role?: string | null
          default_workflow_template_id?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean
          is_recurring?: boolean
          name: string
          recurrence_frequency?: string | null
          reminder_schedule?: string | null
          required_documents?: string | null
          requires_review?: boolean
          service_group: string
          timeline_days?: number | null
        }
        Update: {
          billing_frequency?: string | null
          billing_milestone?: string | null
          code?: string
          created_at?: string
          default_fee?: number
          default_staff_role?: string | null
          default_workflow_template_id?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean
          is_recurring?: boolean
          name?: string
          recurrence_frequency?: string | null
          reminder_schedule?: string | null
          required_documents?: string | null
          requires_review?: boolean
          service_group?: string
          timeline_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "services_default_workflow_template_id_fkey"
            columns: ["default_workflow_template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_date: string | null
          assignee: string | null
          assignment_id: string | null
          blocker: string | null
          client_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          is_demo: boolean
          priority: string
          progress: number
          reviewer: string | null
          service_id: string | null
          status: string
          task_code: string
          title: string
        }
        Insert: {
          assigned_date?: string | null
          assignee?: string | null
          assignment_id?: string | null
          blocker?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          is_demo?: boolean
          priority?: string
          progress?: number
          reviewer?: string | null
          service_id?: string | null
          status?: string
          task_code: string
          title: string
        }
        Update: {
          assigned_date?: string | null
          assignee?: string | null
          assignment_id?: string | null
          blocker?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          is_demo?: boolean
          priority?: string
          progress?: number
          reviewer?: string | null
          service_id?: string | null
          status?: string
          task_code?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_fkey"
            columns: ["assignee"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "work_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_fkey"
            columns: ["reviewer"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      user_departments: {
        Row: {
          department_id: string
          id: string
          user_id: string
        }
        Insert: {
          department_id: string
          id?: string
          user_id: string
        }
        Update: {
          department_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_departments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      work_assignments: {
        Row: {
          actual_completion: string | null
          agreed_fee: number
          assigned_on: string | null
          assigned_staff: string | null
          assignment_code: string
          blocker: string | null
          client_id: string
          collaborators: string[]
          completion_notes: string | null
          created_at: string
          created_by: string | null
          department_id: string | null
          engagement_id: string | null
          est_completion: string | null
          follow_up_on: string | null
          id: string
          internal_due: string | null
          is_demo: boolean
          priority: string
          progress: number
          reviewer: string | null
          service_id: string | null
          status: string
          statutory_due: string | null
          title: string
          updated_at: string
          work_period: string | null
          workflow_stage: number
        }
        Insert: {
          actual_completion?: string | null
          agreed_fee?: number
          assigned_on?: string | null
          assigned_staff?: string | null
          assignment_code: string
          blocker?: string | null
          client_id: string
          collaborators?: string[]
          completion_notes?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          engagement_id?: string | null
          est_completion?: string | null
          follow_up_on?: string | null
          id?: string
          internal_due?: string | null
          is_demo?: boolean
          priority?: string
          progress?: number
          reviewer?: string | null
          service_id?: string | null
          status?: string
          statutory_due?: string | null
          title: string
          updated_at?: string
          work_period?: string | null
          workflow_stage?: number
        }
        Update: {
          actual_completion?: string | null
          agreed_fee?: number
          assigned_on?: string | null
          assigned_staff?: string | null
          assignment_code?: string
          blocker?: string | null
          client_id?: string
          collaborators?: string[]
          completion_notes?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          engagement_id?: string | null
          est_completion?: string | null
          follow_up_on?: string | null
          id?: string
          internal_due?: string | null
          is_demo?: boolean
          priority?: string
          progress?: number
          reviewer?: string | null
          service_id?: string | null
          status?: string
          statutory_due?: string | null
          title?: string
          updated_at?: string
          work_period?: string | null
          workflow_stage?: number
        }
        Relationships: [
          {
            foreignKeyName: "work_assignments_assigned_staff_fkey"
            columns: ["assigned_staff"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_assignments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_assignments_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_assignments_reviewer_fkey"
            columns: ["reviewer"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_assignments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_stages: {
        Row: {
          description: string | null
          id: string
          position: number
          template_id: string
          title: string
        }
        Insert: {
          description?: string | null
          id?: string
          position: number
          template_id: string
          title: string
        }
        Update: {
          description?: string | null
          id?: string
          position?: number
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_stages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assignment_involvement: {
        Args: { _assignment: string }
        Returns: boolean
      }
      client_visible: { Args: { _client: string }; Returns: boolean }
      has_any_role: {
        Args: { _roles: Database["public"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      is_finance: { Args: never; Returns: boolean }
      is_finance_or_manager: { Args: never; Returns: boolean }
      is_founder: { Args: never; Returns: boolean }
      is_management: { Args: never; Returns: boolean }
      my_department_ids: { Args: never; Returns: string[] }
      next_code: {
        Args: { _pad: number; _prefix: string; _seq: unknown }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "founder"
        | "manager"
        | "senior_staff"
        | "staff"
        | "trainee"
        | "accounts"
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
    Enums: {
      app_role: [
        "founder",
        "manager",
        "senior_staff",
        "staff",
        "trainee",
        "accounts",
      ],
    },
  },
} as const
