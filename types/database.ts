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
          default_vat_rate: number
          bank_details: Json | null
          accounting_email: string | null
          email_settings: Json | null
          contact_name: string | null
          contact_phone: string | null
          contact_email: string | null
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
          default_vat_rate?: number
          bank_details?: Json | null
          accounting_email?: string | null
          email_settings?: Json | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_email?: string | null
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
          default_vat_rate?: number
          bank_details?: Json | null
          accounting_email?: string | null
          email_settings?: Json | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_email?: string | null
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
          tax_id: string | null
          bank_details: Json | null
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
          tax_id?: string | null
          bank_details?: Json | null
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
          tax_id?: string | null
          bank_details?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
      invoices: {
        Row: {
          id: string
          company_id: string
          status: 'draft' | 'created' | 'sent' | 'reminded' | 'paid' | 'cancelled'
          invoice_number: string | null
          invoice_date: string | null
          due_date: string | null
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
          created_at: string
          updated_at: string
          finalized_at: string | null
        }
        Insert: {
          id?: string
          company_id: string
          status?: 'draft' | 'created' | 'sent' | 'reminded' | 'paid' | 'cancelled'
          invoice_number?: string | null
          invoice_date?: string | null
          due_date?: string | null
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
          created_at?: string
          updated_at?: string
          finalized_at?: string | null
        }
        Update: {
          id?: string
          company_id?: string
          status?: 'draft' | 'created' | 'sent' | 'reminded' | 'paid' | 'cancelled'
          invoice_number?: string | null
          invoice_date?: string | null
          due_date?: string | null
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
    }
  }
}
