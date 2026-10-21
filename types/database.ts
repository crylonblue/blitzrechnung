export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string
          name: string
          address: Json
          country: string
          vat_id: string | null
          tax_id: string | null
          logo_url: string | null
          invoice_number_prefix: string
          invoice_number_format: string
          invoice_number_counter: number
          cancellation_number_counter: number
          cancellation_number_prefix: string
          default_vat_rate: number
          bank_details: Json | null
          accounting_email: string | null
          email_settings: Json | null
          datev_settings: Json | null
          contact_name: string | null
          contact_phone: string | null
          contact_email: string | null
          enable_english_invoices: boolean
          invoice_show_girocode: boolean
          kleinunternehmer: boolean
          additional_contacts: Json
          default_intro_text: string | null
          default_outro_text: string | null
          default_intro_text_en: string | null
          default_outro_text_en: string | null
          court: string | null
          register_number: string | null
          managing_director: string | null
          trial_ends_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          address: Json
          country: string
          vat_id?: string | null
          tax_id?: string | null
          logo_url?: string | null
          invoice_number_prefix?: string
          invoice_number_format?: string
          invoice_number_counter?: number
          cancellation_number_counter?: number
          cancellation_number_prefix?: string
          default_vat_rate?: number
          bank_details?: Json | null
          accounting_email?: string | null
          email_settings?: Json | null
          datev_settings?: Json | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_email?: string | null
          enable_english_invoices?: boolean
          invoice_show_girocode?: boolean
          kleinunternehmer?: boolean
          additional_contacts?: Json
          default_intro_text?: string | null
          default_outro_text?: string | null
          default_intro_text_en?: string | null
          default_outro_text_en?: string | null
          court?: string | null
          register_number?: string | null
          managing_director?: string | null
          trial_ends_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          address?: Json
          country?: string
          vat_id?: string | null
          tax_id?: string | null
          logo_url?: string | null
          invoice_number_prefix?: string
          invoice_number_format?: string
          invoice_number_counter?: number
          cancellation_number_counter?: number
          cancellation_number_prefix?: string
          default_vat_rate?: number
          bank_details?: Json | null
          accounting_email?: string | null
          email_settings?: Json | null
          datev_settings?: Json | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_email?: string | null
          enable_english_invoices?: boolean
          invoice_show_girocode?: boolean
          kleinunternehmer?: boolean
          additional_contacts?: Json
          default_intro_text?: string | null
          default_outro_text?: string | null
          default_intro_text_en?: string | null
          default_outro_text_en?: string | null
          court?: string | null
          register_number?: string | null
          managing_director?: string | null
          trial_ends_at?: string
          created_at?: string
          updated_at?: string
        }
      }
      subscriptions: {
        Row: {
          company_id: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          plan: 'none' | 'basis' | 'pro'
          status: string
          price_id: string | null
          early_bird: boolean
          current_period_end: string | null
          cancel_at_period_end: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          company_id: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          plan?: 'none' | 'basis' | 'pro'
          status?: string
          price_id?: string | null
          early_bird?: boolean
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          plan?: 'none' | 'basis' | 'pro'
          status?: string
          price_id?: string | null
          early_bird?: boolean
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      user_profiles: {
        Row: {
          id: string
          email: string
          name: string | null
          auth_provider: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          name?: string | null
          auth_provider?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string | null
          auth_provider?: string
          created_at?: string
          updated_at?: string
        }
      }
      company_users: {
        Row: {
          id: string
          user_id: string
          company_id: string
          role: 'owner' | 'member'
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          company_id: string
          role?: 'owner' | 'member'
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          company_id?: string
          role?: 'owner' | 'member'
          created_at?: string
        }
      }
      contacts: {
        Row: {
          id: string
          company_id: string
          name: string
          address: Json
          email: string | null
          vat_id: string | null
          invoice_number_prefix: string | null
          invoice_number_counter: number
          cancellation_number_prefix: string | null
          cancellation_number_counter: number
          tax_id: string | null
          bank_details: Json | null
          court: string | null
          register_number: string | null
          managing_director: string | null
          contact_name: string | null
          contact_phone: string | null
          contact_email: string | null
          /** 'business' | 'consumer'; NULL = unbekannt (wird erst beim Mahnen erfragt). */
          customer_type: 'business' | 'consumer' | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          address: Json
          email?: string | null
          vat_id?: string | null
          invoice_number_prefix?: string | null
          invoice_number_counter?: number
          cancellation_number_prefix?: string | null
          cancellation_number_counter?: number
          tax_id?: string | null
          bank_details?: Json | null
          court?: string | null
          register_number?: string | null
          managing_director?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_email?: string | null
          customer_type?: 'business' | 'consumer' | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          address?: Json
          email?: string | null
          vat_id?: string | null
          invoice_number_prefix?: string | null
          invoice_number_counter?: number
          cancellation_number_prefix?: string | null
          cancellation_number_counter?: number
          tax_id?: string | null
          bank_details?: Json | null
          court?: string | null
          register_number?: string | null
          managing_director?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_email?: string | null
          customer_type?: 'business' | 'consumer' | null
          created_at?: string
          updated_at?: string
        }
      }
      invoices: {
        Row: {
          id: string
          company_id: string
          status: 'draft' | 'created' | 'sent' | 'reminded' | 'paid' | 'cancelled' | 'uneinbringlich'
          invoice_type: 'invoice' | 'cancellation'
          invoice_number: string | null
          invoice_date: string | null
          due_date: string | null
          service_date: string | null
          seller_is_self: boolean
          seller_contact_id: string | null
          seller_snapshot: Json | null
          buyer_is_self: boolean
          buyer_contact_id: string | null
          buyer_snapshot: Json | null
          line_items: Json
          subtotal: number
          vat_amount: number
          total_amount: number
          invoice_file_reference: string | null
          pdf_url: string | null
          xml_url: string | null
          recipient_email: string | null
          language: string
          intro_text: string | null
          outro_text: string | null
          buyer_reference: string | null
          contact_person_id: string | null
          cancelled_invoice_id: string | null
          created_at: string
          updated_at: string
          finalized_at: string | null
        }
        Insert: {
          id?: string
          company_id: string
          status?: 'draft' | 'created' | 'sent' | 'reminded' | 'paid' | 'cancelled' | 'uneinbringlich'
          invoice_type?: 'invoice' | 'cancellation'
          invoice_number?: string | null
          invoice_date?: string | null
          due_date?: string | null
          service_date?: string | null
          seller_is_self?: boolean
          seller_contact_id?: string | null
          seller_snapshot?: Json | null
          buyer_is_self?: boolean
          buyer_contact_id?: string | null
          buyer_snapshot?: Json | null
          line_items?: Json
          subtotal?: number
          vat_amount?: number
          total_amount?: number
          invoice_file_reference?: string | null
          pdf_url?: string | null
          xml_url?: string | null
          recipient_email?: string | null
          language?: string
          intro_text?: string | null
          outro_text?: string | null
          buyer_reference?: string | null
          contact_person_id?: string | null
          cancelled_invoice_id?: string | null
          created_at?: string
          updated_at?: string
          finalized_at?: string | null
        }
        Update: {
          id?: string
          company_id?: string
          status?: 'draft' | 'created' | 'sent' | 'reminded' | 'paid' | 'cancelled' | 'uneinbringlich'
          invoice_type?: 'invoice' | 'cancellation'
          invoice_number?: string | null
          invoice_date?: string | null
          due_date?: string | null
          service_date?: string | null
          seller_is_self?: boolean
          seller_contact_id?: string | null
          seller_snapshot?: Json | null
          buyer_is_self?: boolean
          buyer_contact_id?: string | null
          buyer_snapshot?: Json | null
          line_items?: Json
          subtotal?: number
          vat_amount?: number
          total_amount?: number
          invoice_file_reference?: string | null
          pdf_url?: string | null
          xml_url?: string | null
          recipient_email?: string | null
          language?: string
          intro_text?: string | null
          outro_text?: string | null
          buyer_reference?: string | null
          contact_person_id?: string | null
          cancelled_invoice_id?: string | null
          created_at?: string
          updated_at?: string
          finalized_at?: string | null
        }
      }
      api_keys: {
        Row: {
          id: string
          company_id: string
          user_id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          user_id: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          user_id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      products: {
        Row: {
          id: string
          company_id: string
          name: string
          description: string | null
          unit: string
          unit_price: number
          default_vat_rate: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          description?: string | null
          unit?: string
          unit_price?: number
          default_vat_rate?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          description?: string | null
          unit?: string
          unit_price?: number
          default_vat_rate?: number
          created_at?: string
          updated_at?: string
        }
      }
      dunning_stages: {
        Row: {
          id: string
          company_id: string
          position: number
          name: string
          days_after_previous: number
          grace_days: number
          fee_amount: number
          charge_interest: boolean
          charge_late_fee_flat: boolean
          intro_text: string | null
          outro_text: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          position: number
          name: string
          days_after_previous: number
          grace_days: number
          fee_amount?: number
          charge_interest?: boolean
          charge_late_fee_flat?: boolean
          intro_text?: string | null
          outro_text?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          position?: number
          name?: string
          days_after_previous?: number
          grace_days?: number
          fee_amount?: number
          charge_interest?: boolean
          charge_late_fee_flat?: boolean
          intro_text?: string | null
          outro_text?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      payment_reminders: {
        Row: {
          id: string
          company_id: string
          invoice_id: string
          /** Eingefroren aus dunning_stages, ohne Fremdschluessel. */
          stage_position: number
          stage_name: string
          status: 'created' | 'sent'
          reminder_date: string
          due_date: string
          /** Verzugsbeginn inkl. 30-Tage-Boden — nicht die Faelligkeit der Rechnung. */
          default_since: string
          /** Roh aus invoices.due_date; NULL, wenn die Rechnung keine traegt. */
          invoice_due_date: string | null
          claimed_amount: number
          fee_amount: number
          late_fee_flat: number
          interest_amount: number
          /** Zinsabschnitte (InterestSegment[] aus lib/dunning-interest.ts) — massgeblich. */
          interest_segments: Json | null
          /** Nur Anzeige; NULL, sobald der Zeitraum mehr als einen Satz traegt. */
          interest_rate: number | null
          base_rate: number | null
          interest_from: string | null
          interest_days: number | null
          total_amount: number
          seller_snapshot: Json | null
          buyer_snapshot: Json | null
          language: string
          intro_text: string | null
          outro_text: string | null
          pdf_url: string | null
          recipient_email: string | null
          sent_at: string | null
          /** Verweis auf die Fassung, die diese hier abloest; NULL = gueltig. */
          superseded_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          invoice_id: string
          stage_position: number
          stage_name: string
          status?: 'created' | 'sent'
          reminder_date: string
          due_date: string
          default_since: string
          invoice_due_date?: string | null
          claimed_amount: number
          fee_amount?: number
          late_fee_flat?: number
          interest_amount?: number
          interest_segments?: Json | null
          interest_rate?: number | null
          base_rate?: number | null
          interest_from?: string | null
          interest_days?: number | null
          total_amount: number
          seller_snapshot?: Json | null
          buyer_snapshot?: Json | null
          language?: string
          intro_text?: string | null
          outro_text?: string | null
          pdf_url?: string | null
          recipient_email?: string | null
          sent_at?: string | null
          superseded_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          invoice_id?: string
          stage_position?: number
          stage_name?: string
          status?: 'created' | 'sent'
          reminder_date?: string
          due_date?: string
          default_since?: string
          invoice_due_date?: string | null
          claimed_amount?: number
          fee_amount?: number
          late_fee_flat?: number
          interest_amount?: number
          interest_segments?: Json | null
          interest_rate?: number | null
          base_rate?: number | null
          interest_from?: string | null
          interest_days?: number | null
          total_amount?: number
          seller_snapshot?: Json | null
          buyer_snapshot?: Json | null
          language?: string
          intro_text?: string | null
          outro_text?: string | null
          pdf_url?: string | null
          recipient_email?: string | null
          sent_at?: string | null
          superseded_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}
