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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      app_releases: {
        Row: {
          created_at: string
          file_size_bytes: number
          id: string
          is_current: boolean
          min_supported_version_code: number
          notes: string[]
          platform: string
          release_date: string
          storage_path: string
          version_code: number
          version_name: string
        }
        Insert: {
          created_at?: string
          file_size_bytes: number
          id?: string
          is_current?: boolean
          min_supported_version_code?: number
          notes?: string[]
          platform?: string
          release_date?: string
          storage_path: string
          version_code: number
          version_name: string
        }
        Update: {
          created_at?: string
          file_size_bytes?: number
          id?: string
          is_current?: boolean
          min_supported_version_code?: number
          notes?: string[]
          platform?: string
          release_date?: string
          storage_path?: string
          version_code?: number
          version_name?: string
        }
        Relationships: []
      }
      dashboard_layouts: {
        Row: {
          org_id: string
          updated_at: string
          user_id: string
          widget_ids: string[]
        }
        Insert: {
          org_id: string
          updated_at?: string
          user_id: string
          widget_ids: string[]
        }
        Update: {
          org_id?: string
          updated_at?: string
          user_id?: string
          widget_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_layouts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_layouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      file_groups: {
        Row: {
          file_id: string
          store_group_id: string
        }
        Insert: {
          file_id: string
          store_group_id: string
        }
        Update: {
          file_id?: string
          store_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_groups_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_groups_store_group_id_fkey"
            columns: ["store_group_id"]
            isOneToOne: false
            referencedRelation: "store_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      file_reps: {
        Row: {
          file_id: string
          rep_id: string
        }
        Insert: {
          file_id: string
          rep_id: string
        }
        Update: {
          file_id?: string
          rep_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_reps_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_reps_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          audience: string
          created_at: string
          description: string | null
          id: string
          mime_type: string | null
          name: string
          org_id: string
          size_bytes: number | null
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          audience?: string
          created_at?: string
          description?: string | null
          id?: string
          mime_type?: string | null
          name: string
          org_id: string
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          audience?: string
          created_at?: string
          description?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          org_id?: string
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      form_fields: {
        Row: {
          field_type: string
          form_template_id: string
          id: string
          label: string
          metric_key: string | null
          options: Json | null
          required: boolean
          sort_order: number
        }
        Insert: {
          field_type: string
          form_template_id: string
          id?: string
          label: string
          metric_key?: string | null
          options?: Json | null
          required?: boolean
          sort_order?: number
        }
        Update: {
          field_type?: string
          form_template_id?: string
          id?: string
          label?: string
          metric_key?: string | null
          options?: Json | null
          required?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_fields_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      form_responses: {
        Row: {
          form_field_id: string
          form_submission_id: string
          id: string
          photo_id: string | null
          value_boolean: boolean | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          form_field_id: string
          form_submission_id: string
          id?: string
          photo_id?: string | null
          value_boolean?: boolean | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          form_field_id?: string
          form_submission_id?: string
          id?: string
          photo_id?: string | null
          value_boolean?: boolean | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_responses_form_field_id_fkey"
            columns: ["form_field_id"]
            isOneToOne: false
            referencedRelation: "form_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_responses_form_submission_id_fkey"
            columns: ["form_submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_responses_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          client_generated_id: string
          created_at: string
          form_template_id: string
          id: string
          org_id: string
          rep_id: string
          submitted_at: string
          visit_id: string
        }
        Insert: {
          client_generated_id: string
          created_at?: string
          form_template_id: string
          id?: string
          org_id: string
          rep_id: string
          submitted_at?: string
          visit_id: string
        }
        Update: {
          client_generated_id?: string
          created_at?: string
          form_template_id?: string
          id?: string
          org_id?: string
          rep_id?: string
          submitted_at?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      form_templates: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          client_generated_id: string
          company_name: string
          completed_at: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          end_lat: number | null
          end_lng: number | null
          follow_up_on: string | null
          follow_up_required: boolean
          id: string
          notes: string | null
          org_id: string
          outcome: string | null
          purpose: string
          rep_id: string
          stage: string
          start_lat: number | null
          start_lng: number | null
          started_at: string
          status: string
        }
        Insert: {
          client_generated_id: string
          company_name: string
          completed_at?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          end_lat?: number | null
          end_lng?: number | null
          follow_up_on?: string | null
          follow_up_required?: boolean
          id?: string
          notes?: string | null
          org_id: string
          outcome?: string | null
          purpose: string
          rep_id: string
          stage?: string
          start_lat?: number | null
          start_lng?: number | null
          started_at?: string
          status?: string
        }
        Update: {
          client_generated_id?: string
          company_name?: string
          completed_at?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          end_lat?: number | null
          end_lng?: number | null
          follow_up_on?: string | null
          follow_up_required?: boolean
          id?: string
          notes?: string | null
          org_id?: string
          outcome?: string | null
          purpose?: string
          rep_id?: string
          stage?: string
          start_lat?: number | null
          start_lng?: number | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      location_pings: {
        Row: {
          accuracy_m: number | null
          client_generated_id: string
          created_at: string
          id: string
          lat: number
          lng: number
          org_id: string
          recorded_at: string
          rep_id: string
          source: string
          workday_session_id: string | null
        }
        Insert: {
          accuracy_m?: number | null
          client_generated_id: string
          created_at?: string
          id?: string
          lat: number
          lng: number
          org_id: string
          recorded_at?: string
          rep_id: string
          source?: string
          workday_session_id?: string | null
        }
        Update: {
          accuracy_m?: number | null
          client_generated_id?: string
          created_at?: string
          id?: string
          lat?: number
          lng?: number
          org_id?: string
          recorded_at?: string
          rep_id?: string
          source?: string
          workday_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_pings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_pings_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_pings_workday_session_id_fkey"
            columns: ["workday_session_id"]
            isOneToOne: false
            referencedRelation: "workday_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          created_at: string
          default_visit_frequency: string
          id: string
          industry: string | null
          legal_name: string | null
          name: string
          stores_per_day: number
          support_email: string | null
          website: string | null
          working_days: number[]
        }
        Insert: {
          address?: string | null
          created_at?: string
          default_visit_frequency?: string
          id?: string
          industry?: string | null
          legal_name?: string | null
          name: string
          stores_per_day?: number
          support_email?: string | null
          website?: string | null
          working_days?: number[]
        }
        Update: {
          address?: string | null
          created_at?: string
          default_visit_frequency?: string
          id?: string
          industry?: string | null
          legal_name?: string | null
          name?: string
          stores_per_day?: number
          support_email?: string | null
          website?: string | null
          working_days?: number[]
        }
        Relationships: []
      }
      photos: {
        Row: {
          client_generated_id: string
          created_at: string
          id: string
          lat: number | null
          lng: number | null
          org_id: string
          rep_id: string
          storage_path: string
          taken_at: string | null
          uploaded_at: string | null
          visit_id: string
        }
        Insert: {
          client_generated_id: string
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          org_id: string
          rep_id: string
          storage_path: string
          taken_at?: string | null
          uploaded_at?: string | null
          visit_id: string
        }
        Update: {
          client_generated_id?: string
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          org_id?: string
          rep_id?: string
          storage_path?: string
          taken_at?: string | null
          uploaded_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photos_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          brand: string | null
          category: string | null
          created_at: string
          id: string
          name: string
          org_id: string
          shrink_barcode: string | null
          shrink_price_excl_vat: number | null
          shrink_price_incl_vat: number | null
          sku_code: string | null
          unit_barcode: string | null
          units_per_shrink: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          name: string
          org_id: string
          shrink_barcode?: string | null
          shrink_price_excl_vat?: number | null
          shrink_price_incl_vat?: number | null
          sku_code?: string | null
          unit_barcode?: string | null
          units_per_shrink?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          shrink_barcode?: string | null
          shrink_price_excl_vat?: number | null
          shrink_price_incl_vat?: number | null
          sku_code?: string | null
          unit_barcode?: string | null
          units_per_shrink?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          job_title: string | null
          org_id: string
          phone: string | null
          role: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          job_title?: string | null
          org_id: string
          phone?: string | null
          role: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          org_id?: string
          phone?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_checks: {
        Row: {
          checked_at: string
          client_generated_id: string
          created_at: string
          id: string
          note: string | null
          org_id: string
          product_id: string
          promotion_id: string
          rep_id: string
          status: string
          store_id: string
          visit_id: string | null
        }
        Insert: {
          checked_at?: string
          client_generated_id: string
          created_at?: string
          id?: string
          note?: string | null
          org_id: string
          product_id: string
          promotion_id: string
          rep_id: string
          status: string
          store_id: string
          visit_id?: string | null
        }
        Update: {
          checked_at?: string
          client_generated_id?: string
          created_at?: string
          id?: string
          note?: string | null
          org_id?: string
          product_id?: string
          promotion_id?: string
          rep_id?: string
          status?: string
          store_id?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promotion_checks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_checks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_checks_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_checks_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_checks_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_checks_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_products: {
        Row: {
          product_id: string
          promotion_id: string
        }
        Insert: {
          product_id: string
          promotion_id: string
        }
        Update: {
          product_id?: string
          promotion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_products_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_stores: {
        Row: {
          promotion_id: string
          store_id: string
        }
        Insert: {
          promotion_id: string
          store_id: string
        }
        Update: {
          promotion_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_stores_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_stores_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          active: boolean
          brief: string | null
          created_at: string
          created_by: string | null
          ends_on: string
          id: string
          name: string
          org_id: string
          starts_on: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          brief?: string | null
          created_at?: string
          created_by?: string | null
          ends_on: string
          id?: string
          name: string
          org_id: string
          starts_on: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          brief?: string | null
          created_at?: string
          created_by?: string | null
          ends_on?: string
          id?: string
          name?: string
          org_id?: string
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          subject: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          subject: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          subject?: string
          window_start?: string
        }
        Relationships: []
      }
      routes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          rep_id: string
          scheduled_date: string
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          sequence_order: number | null
          source: string
          store_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          org_id: string
          rep_id: string
          scheduled_date: string
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          sequence_order?: number | null
          source?: string
          store_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          org_id?: string
          rep_id?: string
          scheduled_date?: string
          scheduled_end_at?: string | null
          scheduled_start_at?: string | null
          sequence_order?: number | null
          source?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      security_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json | null
          id: number
          org_id: string | null
          subject_id: string | null
          subject_type: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: never
          org_id?: string | null
          subject_id?: string | null
          subject_type: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: never
          org_id?: string | null
          subject_id?: string | null
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_flags: {
        Row: {
          geocoding_enabled: boolean
          id: boolean
          insights_enabled: boolean
          notice: string | null
          updated_at: string
        }
        Insert: {
          geocoding_enabled?: boolean
          id?: boolean
          insights_enabled?: boolean
          notice?: string | null
          updated_at?: string
        }
        Update: {
          geocoding_enabled?: boolean
          id?: boolean
          insights_enabled?: boolean
          notice?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      store_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          day_of_week: number | null
          id: string
          is_primary: boolean
          org_id: string
          rep_id: string
          store_id: string
          week_of_cycle: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          day_of_week?: number | null
          id?: string
          is_primary?: boolean
          org_id: string
          rep_id: string
          store_id: string
          week_of_cycle?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          day_of_week?: number | null
          id?: string
          is_primary?: boolean
          org_id?: string
          rep_id?: string
          store_id?: string
          week_of_cycle?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "store_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_assignments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_assignments_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_assignments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_groups_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          active: boolean
          address: string | null
          city: string | null
          created_at: string
          geocode_accuracy_m: number | null
          geocode_result: string | null
          geocode_source: string | null
          geocode_visit_id: string | null
          geocoded_at: string | null
          geofence_radius_m: number
          id: string
          lat: number | null
          lng: number | null
          location_confirmed_at: string | null
          location_confirmed_by: string | null
          name: string
          org_id: string
          place_code: string | null
          state: string | null
          store_group_id: string | null
          sub_territory_id: string | null
          territory_id: string | null
          visit_frequency: string
          zip: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          city?: string | null
          created_at?: string
          geocode_accuracy_m?: number | null
          geocode_result?: string | null
          geocode_source?: string | null
          geocode_visit_id?: string | null
          geocoded_at?: string | null
          geofence_radius_m?: number
          id?: string
          lat?: number | null
          lng?: number | null
          location_confirmed_at?: string | null
          location_confirmed_by?: string | null
          name: string
          org_id: string
          place_code?: string | null
          state?: string | null
          store_group_id?: string | null
          sub_territory_id?: string | null
          territory_id?: string | null
          visit_frequency?: string
          zip?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          city?: string | null
          created_at?: string
          geocode_accuracy_m?: number | null
          geocode_result?: string | null
          geocode_source?: string | null
          geocode_visit_id?: string | null
          geocoded_at?: string | null
          geofence_radius_m?: number
          id?: string
          lat?: number | null
          lng?: number | null
          location_confirmed_at?: string | null
          location_confirmed_by?: string | null
          name?: string
          org_id?: string
          place_code?: string | null
          state?: string | null
          store_group_id?: string | null
          sub_territory_id?: string | null
          territory_id?: string | null
          visit_frequency?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stores_geocode_visit_id_fkey"
            columns: ["geocode_visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_location_confirmed_by_fkey"
            columns: ["location_confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_store_group_id_fkey"
            columns: ["store_group_id"]
            isOneToOne: false
            referencedRelation: "store_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_sub_territory_id_fkey"
            columns: ["sub_territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
        ]
      }
      territories: {
        Row: {
          active: boolean
          created_at: string
          id: string
          level: string
          name: string
          org_id: string
          parent_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          level?: string
          name: string
          org_id: string
          parent_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          level?: string
          name?: string
          org_id?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "territories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
        ]
      }
      territory_reps: {
        Row: {
          created_at: string
          id: string
          org_id: string
          rep_id: string
          territory_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          rep_id: string
          territory_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          rep_id?: string
          territory_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "territory_reps_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territory_reps_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territory_reps_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          checkin_at: string | null
          checkin_distance_from_store_m: number | null
          checkin_gps_accuracy_m: number | null
          checkin_lat: number | null
          checkin_lng: number | null
          checkout_at: string | null
          checkout_lat: number | null
          checkout_lng: number | null
          client_generated_id: string
          created_at: string
          duration_seconds: number | null
          id: string
          org_id: string
          rep_id: string
          route_id: string | null
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          checkin_at?: string | null
          checkin_distance_from_store_m?: number | null
          checkin_gps_accuracy_m?: number | null
          checkin_lat?: number | null
          checkin_lng?: number | null
          checkout_at?: string | null
          checkout_lat?: number | null
          checkout_lng?: number | null
          client_generated_id: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          org_id: string
          rep_id: string
          route_id?: string | null
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          checkin_at?: string | null
          checkin_distance_from_store_m?: number | null
          checkin_gps_accuracy_m?: number | null
          checkin_lat?: number | null
          checkin_lng?: number | null
          checkout_at?: string | null
          checkout_lat?: number | null
          checkout_lng?: number | null
          client_generated_id?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          org_id?: string
          rep_id?: string
          route_id?: string | null
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      workday_sessions: {
        Row: {
          client_generated_id: string
          created_at: string
          distance_meters: number
          duration_seconds: number | null
          end_lat: number | null
          end_lng: number | null
          ended_at: string | null
          ended_by: string | null
          id: string
          org_id: string
          rep_id: string
          start_lat: number | null
          start_lng: number | null
          started_at: string
          updated_at: string
        }
        Insert: {
          client_generated_id: string
          created_at?: string
          distance_meters?: number
          duration_seconds?: number | null
          end_lat?: number | null
          end_lng?: number | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          org_id: string
          rep_id: string
          start_lat?: number | null
          start_lng?: number | null
          started_at?: string
          updated_at?: string
        }
        Update: {
          client_generated_id?: string
          created_at?: string
          distance_meters?: number
          duration_seconds?: number | null
          end_lat?: number | null
          end_lng?: number | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          org_id?: string
          rep_id?: string
          start_lat?: number | null
          start_lng?: number | null
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workday_sessions_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workday_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workday_sessions_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activity_feed: {
        Args: {
          p_from: string
          p_limit?: number
          p_offset?: number
          p_only_flagged?: boolean
          p_rep_ids?: string[]
          p_store_ids?: string[]
          p_to: string
        }
        Returns: {
          accuracy_m: number
          distance_m: number
          event_id: string
          geofence_radius_m: number
          kind: string
          occurred_at: string
          rep_id: string
          rep_name: string
          store_id: string
          store_name: string
          submission_id: string
          total_count: number
          verdict: string
          visit_id: string
        }[]
      }
      activity_feed_summary: {
        Args: {
          p_from: string
          p_rep_ids?: string[]
          p_store_ids?: string[]
          p_to: string
        }
        Returns: Json
      }
      call_cycle_gaps: {
        Args: never
        Returns: {
          reps_active: number
          reps_without_stores: number
          reps_without_stores_names: string[]
          stores_active: number
          stores_unassigned: number
          stores_without_city: number
          stores_without_coords: number
          unassigned_store_names: string[]
          unplanned_assignments: number
          unplanned_by_rep: Json
        }[]
      }
      call_cycle_review: {
        Args: { p_weeks?: number }
        Returns: {
          avg_stores: number
          cities: string[]
          day_of_week: number
          frequency_mix: Json
          occurrences: number
          peak_stores: number
          rep_id: string
          rep_name: string
          span_km: number
          stores_without_city: number
        }[]
      }
      can_see_file: {
        Args: { p_audience: string; p_file_id: string }
        Returns: boolean
      }
      close_abandoned_workday: { Args: { p_session_id: string }; Returns: Json }
      compliance_trends: {
        Args: {
          p_bucket?: string
          p_from: string
          p_store_group_id?: string
          p_to: string
        }
        Returns: {
          avg_facings: number
          bucket_start: string
          oos_rate: number
          planogram_rate: number
          price_correct_rate: number
          submissions: number
        }[]
      }
      consume_rate_limit: {
        Args: {
          p_bucket: string
          p_cost?: number
          p_limit: number
          p_window_seconds: number
        }
        Returns: Json
      }
      coverage_gaps: {
        Args: { p_from: string; p_to: string }
        Returns: {
          assigned_count: number
          assigned_reps: string
          city: string
          days_since: number
          last_visit_at: string
          state: string
          store_group: string
          store_id: string
          store_name: string
          visits_in_period: number
        }[]
      }
      current_org_id: { Args: never; Returns: string }
      current_role: { Args: never; Returns: string }
      dashboard_operations: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      dashboard_summary: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      file_in_my_org: { Args: { p_file_id: string }; Returns: boolean }
      form_field_delete_impact: {
        Args: { p_field_id: string }
        Returns: {
          answers: number
          field_label: string
          first_answered_at: string
          last_answered_at: string
          metric_key: string
          photos: number
          stores_answered: number
          submissions: number
        }[]
      }
      form_report: {
        Args: {
          p_from: string
          p_rep_ids?: string[]
          p_store_ids?: string[]
          p_template_id: string
          p_to: string
        }
        Returns: {
          field_id: string
          field_type: string
          label: string
          metric_key: string
          response_count: number
          sort_order: number
          stats: Json
        }[]
      }
      generate_routes: {
        Args: { p_dry_run?: boolean; p_weeks?: number }
        Returns: {
          created: number
          first_date: string
          last_date: string
          removed: number
          reps_covered: number
        }[]
      }
      haversine_m: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      oos_hotspots: {
        Args: { p_from: string; p_to: string }
        Returns: {
          checks: number
          last_oos_at: string
          max_consecutive_oos: number
          oos_count: number
          oos_rate: number
          store_id: string
          store_name: string
          top_skus: Json
        }[]
      }
      perfect_store_score: {
        Args: { p_from: string; p_to: string }
        Returns: {
          audits: number
          availability_pct: number
          condition_pct: number
          planogram_pct: number
          price_pct: number
          score: number
          store_group: string
          store_id: string
          store_name: string
        }[]
      }
      product_delete_impact: {
        Args: { p_product_id: string }
        Returns: {
          checks: number
          product_name: string
          promotions: number
          promotions_live: number
          stores_answered: number
        }[]
      }
      promotion_store_status: {
        Args: { p_promotion_id: string }
        Returns: {
          answered: number
          city: string
          last_checked_at: string
          not_running: number
          not_stocked: number
          rep_name: string
          running: number
          store_id: string
          store_name: string
        }[]
      }
      promotion_summaries: {
        Args: never
        Returns: {
          active: boolean
          brief: string
          ends_on: string
          last_checked_at: string
          name: string
          products: number
          promotion_id: string
          starts_on: string
          stores: number
          stores_checked: number
          stores_not_stocked: number
          stores_running: number
        }[]
      }
      prune_rate_limits: { Args: never; Returns: number }
      rep_day_times: {
        Args: { p_from: string; p_to: string }
        Returns: {
          avg_end_seconds: number
          avg_length_seconds: number
          avg_start_seconds: number
          days_worked: number
          rep_id: string
          rep_name: string
        }[]
      }
      rep_delete_impact: {
        Args: { p_rep_id: string }
        Returns: {
          assignments: number
          photos: number
          rep_name: string
          routes: number
          submissions: number
          visits: number
          workdays: number
        }[]
      }
      rep_directory: {
        Args: never
        Returns: {
          assigned_stores: number
          email: string
          is_active: boolean
          job_title: string
          joined_at: string
          last_active_at: string
          phone: string
          rep_id: string
          rep_name: string
          store_names: string
          visits_30d: number
        }[]
      }
      rep_scorecard: {
        Args: { p_from: string; p_to: string }
        Returns: {
          avg_duration_seconds: number
          completion_rate: number
          form_compliance_rate: number
          rep_id: string
          rep_name: string
          score: number
          stores_covered: number
          submissions: number
          verified_rate: number
          visits_completed: number
          visits_total: number
        }[]
      }
      schedule_adherence: {
        Args: { p_from: string; p_to: string }
        Returns: {
          adherence_rate: number
          completed: number
          missed: number
          missed_detail: Json
          planned: number
          rep_id: string
          rep_name: string
        }[]
      }
      service_flag: { Args: { p_name: string }; Returns: boolean }
      set_store_location_from_visit: {
        Args: {
          p_accuracy_m: number
          p_lat: number
          p_lng: number
          p_visit_client_id: string
        }
        Returns: Json
      }
      store_delete_impact: {
        Args: { p_store_id: string }
        Returns: {
          assignments: number
          photos: number
          reps: number
          routes: number
          store_name: string
          submissions: number
          visits: number
        }[]
      }
      store_geocode_capture: {
        Args: never
        Returns: {
          rep_id: string
          rep_name: string
          store_id: string
          visit_checkin_at: string
          visit_id: string
        }[]
      }
      store_last_visit: {
        Args: never
        Returns: {
          last_visit_at: string
          store_id: string
          visits_total: number
        }[]
      }
      store_location_drift: {
        Args: { p_min_median_m?: number; p_min_visits?: number }
        Returns: {
          city: string
          cluster_lat: number
          cluster_lng: number
          cluster_offset_m: number
          geofence_radius_m: number
          last_visit_at: string
          location_source: string
          median_offset_m: number
          reps_involved: number
          spread_m: number
          store_id: string
          store_name: string
          visits_considered: number
        }[]
      }
      workday_trail: {
        Args: { p_from: string; p_to: string }
        Returns: {
          dropped_legs: number
          duration_seconds: number
          ended_at: string
          legs: number
          max_gap_seconds: number
          rep_id: string
          rep_name: string
          reported_m: number
          session_id: string
          started_at: string
          trail_m: number
          worst_accuracy_m: number
        }[]
      }
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
