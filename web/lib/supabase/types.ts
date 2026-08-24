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
      delivery_documents: {
        Row: {
          created_at: string
          dispatch_id: string | null
          doc_type: string
          file_name: string | null
          id: string
          mime_type: string | null
          order_id: string
          org_id: string
          signed_at: string | null
          signed_by_name: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          dispatch_id?: string | null
          doc_type: string
          file_name?: string | null
          id?: string
          mime_type?: string | null
          order_id: string
          org_id: string
          signed_at?: string | null
          signed_by_name?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          dispatch_id?: string | null
          doc_type?: string
          file_name?: string | null
          id?: string
          mime_type?: string | null
          order_id?: string
          org_id?: string
          signed_at?: string | null
          signed_by_name?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_documents_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_lines: {
        Row: {
          batch_id: string | null
          created_at: string
          dispatch_id: string
          id: string
          order_allocation_id: string | null
          order_line_id: string
          org_id: string
          qty: number
          qty_delivered: number
          qty_returned: number
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          dispatch_id: string
          id?: string
          order_allocation_id?: string | null
          order_line_id: string
          org_id: string
          qty: number
          qty_delivered?: number
          qty_returned?: number
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          dispatch_id?: string
          id?: string
          order_allocation_id?: string | null
          order_line_id?: string
          org_id?: string
          qty?: number
          qty_delivered?: number
          qty_returned?: number
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_lines_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_lines_order_allocation_id_fkey"
            columns: ["order_allocation_id"]
            isOneToOne: false
            referencedRelation: "order_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_lines_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatches: {
        Row: {
          carrier_name: string | null
          created_at: string
          delivered_at: string | null
          delivered_by: string | null
          dispatch_location_id: string
          dispatch_number: string
          dispatched_at: string
          dispatched_by: string | null
          driver_id: string | null
          expected_delivery_on: string | null
          failure_reason: string | null
          id: string
          notes: string | null
          order_id: string
          org_id: string
          received_by_name: string | null
          status: string
          tracking_reference: string | null
          transit_location_id: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          carrier_name?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_by?: string | null
          dispatch_location_id: string
          dispatch_number: string
          dispatched_at?: string
          dispatched_by?: string | null
          driver_id?: string | null
          expected_delivery_on?: string | null
          failure_reason?: string | null
          id?: string
          notes?: string | null
          order_id: string
          org_id: string
          received_by_name?: string | null
          status?: string
          tracking_reference?: string | null
          transit_location_id: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          carrier_name?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_by?: string | null
          dispatch_location_id?: string
          dispatch_number?: string
          dispatched_at?: string
          dispatched_by?: string | null
          driver_id?: string | null
          expected_delivery_on?: string | null
          failure_reason?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          org_id?: string
          received_by_name?: string | null
          status?: string
          tracking_reference?: string | null
          transit_location_id?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatches_delivered_by_fkey"
            columns: ["delivered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_dispatch_location_id_fkey"
            columns: ["dispatch_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_dispatched_by_fkey"
            columns: ["dispatched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_transit_location_id_fkey"
            columns: ["transit_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_counters: {
        Row: {
          doc_type: string
          next_value: number
          org_id: string
          updated_at: string
        }
        Insert: {
          doc_type: string
          next_value?: number
          org_id: string
          updated_at?: string
        }
        Update: {
          doc_type?: string
          next_value?: number
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_counters_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          full_name: string
          id: string
          id_number: string | null
          licence_expires_on: string | null
          licence_number: string | null
          notes: string | null
          org_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          full_name: string
          id?: string
          id_number?: string | null
          licence_expires_on?: string | null
          licence_number?: string | null
          notes?: string | null
          org_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          full_name?: string
          id?: string
          id_number?: string | null
          licence_expires_on?: string | null
          licence_number?: string | null
          notes?: string | null
          org_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      goods_receipt_lines: {
        Row: {
          batch_number: string | null
          created_at: string
          expiry_date: string | null
          goods_receipt_id: string
          id: string
          manufactured_on: string | null
          notes: string | null
          org_id: string
          product_id: string
          qty_base: number | null
          qty_damaged: number
          qty_received: number
          unit_cost: number | null
          units_per_uom: number | null
          uom: string
        }
        Insert: {
          batch_number?: string | null
          created_at?: string
          expiry_date?: string | null
          goods_receipt_id: string
          id?: string
          manufactured_on?: string | null
          notes?: string | null
          org_id: string
          product_id: string
          qty_base?: number | null
          qty_damaged?: number
          qty_received: number
          unit_cost?: number | null
          units_per_uom?: number | null
          uom?: string
        }
        Update: {
          batch_number?: string | null
          created_at?: string
          expiry_date?: string | null
          goods_receipt_id?: string
          id?: string
          manufactured_on?: string | null
          notes?: string | null
          org_id?: string
          product_id?: string
          qty_base?: number | null
          qty_damaged?: number
          qty_received?: number
          unit_cost?: number | null
          units_per_uom?: number | null
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_lines_goods_receipt_id_fkey"
            columns: ["goods_receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipts: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          grn_number: string
          id: string
          invoice_number: string | null
          location_id: string
          notes: string | null
          org_id: string
          posted_at: string | null
          posted_by: string | null
          receipt_type: string
          received_at: string
          received_by: string | null
          source_order_id: string | null
          status: string
          supplier_id: string | null
          supplier_name: string | null
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          grn_number: string
          id?: string
          invoice_number?: string | null
          location_id: string
          notes?: string | null
          org_id: string
          posted_at?: string | null
          posted_by?: string | null
          receipt_type?: string
          received_at?: string
          received_by?: string | null
          source_order_id?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          grn_number?: string
          id?: string
          invoice_number?: string | null
          location_id?: string
          notes?: string | null
          org_id?: string
          posted_at?: string | null
          posted_by?: string | null
          receipt_type?: string
          received_at?: string
          received_by?: string | null
          source_order_id?: string | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
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
      order_allocations: {
        Row: {
          batch_id: string | null
          created_at: string
          id: string
          location_id: string
          order_id: string
          order_line_id: string
          org_id: string
          qty_dispatched: number
          qty_picked: number
          qty_reserved: number
          status: string
          updated_at: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          id?: string
          location_id: string
          order_id: string
          order_line_id: string
          org_id: string
          qty_dispatched?: number
          qty_picked?: number
          qty_reserved?: number
          status?: string
          updated_at?: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          id?: string
          location_id?: string
          order_id?: string
          order_line_id?: string
          org_id?: string
          qty_dispatched?: number
          qty_picked?: number
          qty_reserved?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_allocations_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_allocations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_allocations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_allocations_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_allocations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          client_generated_id: string
          created_at: string
          id: string
          line_status: string
          order_id: string
          org_id: string
          product_id: string
          qty_delivered: number
          qty_dispatched: number
          qty_ordered: number
          qty_picked: number
          qty_reserved: number
          qty_returned: number
          unit_price: number | null
        }
        Insert: {
          client_generated_id: string
          created_at?: string
          id?: string
          line_status?: string
          order_id: string
          org_id: string
          product_id: string
          qty_delivered?: number
          qty_dispatched?: number
          qty_ordered: number
          qty_picked?: number
          qty_reserved?: number
          qty_returned?: number
          unit_price?: number | null
        }
        Update: {
          client_generated_id?: string
          created_at?: string
          id?: string
          line_status?: string
          order_id?: string
          org_id?: string
          product_id?: string
          qty_delivered?: number
          qty_dispatched?: number
          qty_ordered?: number
          qty_picked?: number
          qty_reserved?: number
          qty_returned?: number
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json | null
          from_status: string | null
          id: number
          note: string | null
          order_id: string
          org_id: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          from_status?: string | null
          id?: never
          note?: string | null
          order_id: string
          org_id: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          from_status?: string | null
          id?: never
          note?: string | null
          order_id?: string
          org_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_generated_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          delivered_by: string | null
          dispatched_at: string | null
          dispatched_by: string | null
          fulfil_location_id: string | null
          held_at: string | null
          held_by: string | null
          hold_reason: string | null
          id: string
          invoice_number: string | null
          notes: string | null
          on_hold: boolean
          order_number: string
          org_id: string
          packed_at: string | null
          packed_by: string | null
          parent_order_id: string | null
          picking_started_at: string | null
          picking_started_by: string | null
          pod_status: string
          received_via: string
          rep_id: string | null
          required_by: string | null
          source: string
          status: string
          store_id: string
          updated_at: string
          vat_rate: number
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_generated_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          delivered_by?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          fulfil_location_id?: string | null
          held_at?: string | null
          held_by?: string | null
          hold_reason?: string | null
          id?: string
          invoice_number?: string | null
          notes?: string | null
          on_hold?: boolean
          order_number: string
          org_id: string
          packed_at?: string | null
          packed_by?: string | null
          parent_order_id?: string | null
          picking_started_at?: string | null
          picking_started_by?: string | null
          pod_status?: string
          received_via?: string
          rep_id?: string | null
          required_by?: string | null
          source: string
          status?: string
          store_id: string
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_generated_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          delivered_by?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          fulfil_location_id?: string | null
          held_at?: string | null
          held_by?: string | null
          hold_reason?: string | null
          id?: string
          invoice_number?: string | null
          notes?: string | null
          on_hold?: boolean
          order_number?: string
          org_id?: string
          packed_at?: string | null
          packed_by?: string | null
          parent_order_id?: string | null
          picking_started_at?: string | null
          picking_started_by?: string | null
          pod_status?: string
          received_via?: string
          rep_id?: string | null
          required_by?: string | null
          source?: string
          status?: string
          store_id?: string
          updated_at?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_delivered_by_fkey"
            columns: ["delivered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_dispatched_by_fkey"
            columns: ["dispatched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_fulfil_location_id_fkey"
            columns: ["fulfil_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_held_by_fkey"
            columns: ["held_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_packed_by_fkey"
            columns: ["packed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_picking_started_by_fkey"
            columns: ["picking_started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
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
          vat_rate: number
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
          vat_rate?: number
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
          vat_rate?: number
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
      product_batches: {
        Row: {
          batch_number: string
          created_at: string
          expiry_date: string | null
          first_received_at: string
          id: string
          manufactured_on: string | null
          org_id: string
          product_id: string
        }
        Insert: {
          batch_number: string
          created_at?: string
          expiry_date?: string | null
          first_received_at?: string
          id?: string
          manufactured_on?: string | null
          org_id: string
          product_id: string
        }
        Update: {
          batch_number?: string
          created_at?: string
          expiry_date?: string | null
          first_received_at?: string
          id?: string
          manufactured_on?: string | null
          org_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_batches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_location_settings: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          min_stock_level: number | null
          org_id: string
          product_id: string
          reorder_point: number | null
          reorder_qty: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          min_stock_level?: number | null
          org_id: string
          product_id: string
          reorder_point?: number | null
          reorder_qty?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          min_stock_level?: number | null
          org_id?: string
          product_id?: string
          reorder_point?: number | null
          reorder_qty?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_location_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_location_settings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_location_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_location_settings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
          is_batch_tracked: boolean
          is_stock_tracked: boolean
          min_stock_level: number | null
          name: string
          org_id: string
          reorder_point: number | null
          reorder_qty: number | null
          shrink_barcode: string | null
          shrink_price_excl_vat: number | null
          shrink_price_incl_vat: number | null
          sku_code: string | null
          unit_barcode: string | null
          unit_cost_excl_vat: number | null
          unit_cost_incl_vat: number | null
          unit_of_measure: string
          units_per_shrink: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_batch_tracked?: boolean
          is_stock_tracked?: boolean
          min_stock_level?: number | null
          name: string
          org_id: string
          reorder_point?: number | null
          reorder_qty?: number | null
          shrink_barcode?: string | null
          shrink_price_excl_vat?: number | null
          shrink_price_incl_vat?: number | null
          sku_code?: string | null
          unit_barcode?: string | null
          unit_cost_excl_vat?: number | null
          unit_cost_incl_vat?: number | null
          unit_of_measure?: string
          units_per_shrink?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_batch_tracked?: boolean
          is_stock_tracked?: boolean
          min_stock_level?: number | null
          name?: string
          org_id?: string
          reorder_point?: number | null
          reorder_qty?: number | null
          shrink_barcode?: string | null
          shrink_price_excl_vat?: number | null
          shrink_price_incl_vat?: number | null
          sku_code?: string | null
          unit_barcode?: string | null
          unit_cost_excl_vat?: number | null
          unit_cost_incl_vat?: number | null
          unit_of_measure?: string
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
      stock_adjustment_lines: {
        Row: {
          adjustment_id: string
          batch_id: string | null
          created_at: string
          from_bucket: string | null
          id: string
          note: string | null
          org_id: string
          product_id: string
          qty: number
          to_bucket: string | null
        }
        Insert: {
          adjustment_id: string
          batch_id?: string | null
          created_at?: string
          from_bucket?: string | null
          id?: string
          note?: string | null
          org_id: string
          product_id: string
          qty: number
          to_bucket?: string | null
        }
        Update: {
          adjustment_id?: string
          batch_id?: string | null
          created_at?: string
          from_bucket?: string | null
          id?: string
          note?: string | null
          org_id?: string
          product_id?: string
          qty?: number
          to_bucket?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustment_lines_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          adjustment_number: string
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          issued_to_name: string | null
          location_id: string
          org_id: string
          reason_code: string
          reason_note: string | null
          requested_at: string | null
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          adjustment_number: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          issued_to_name?: string | null
          location_id: string
          org_id: string
          reason_code: string
          reason_note?: string | null
          requested_at?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          adjustment_number?: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          issued_to_name?: string | null
          location_id?: string
          org_id?: string
          reason_code?: string
          reason_note?: string | null
          requested_at?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_balances: {
        Row: {
          batch_id: string | null
          id: string
          location_id: string
          org_id: string
          product_id: string
          qty_available: number
          qty_damaged: number
          qty_expired: number
          qty_in_transit: number
          qty_on_hand: number | null
          qty_promotional: number
          qty_reserved: number
          updated_at: string
        }
        Insert: {
          batch_id?: string | null
          id?: string
          location_id: string
          org_id: string
          product_id: string
          qty_available?: number
          qty_damaged?: number
          qty_expired?: number
          qty_in_transit?: number
          qty_on_hand?: number | null
          qty_promotional?: number
          qty_reserved?: number
          updated_at?: string
        }
        Update: {
          batch_id?: string | null
          id?: string
          location_id?: string
          org_id?: string
          product_id?: string
          qty_available?: number
          qty_damaged?: number
          qty_expired?: number
          qty_in_transit?: number
          qty_on_hand?: number | null
          qty_promotional?: number
          qty_reserved?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_locations: {
        Row: {
          active: boolean
          address: string | null
          code: string | null
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          name: string
          org_id: string
          rep_id: string | null
          type: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name: string
          org_id: string
          rep_id?: string | null
          type: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name?: string
          org_id?: string
          rep_id?: string | null
          type?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_locations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_locations_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_locations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          actor_id: string | null
          approved_by: string | null
          batch_id: string | null
          created_at: string
          from_bucket: string | null
          from_location_id: string | null
          id: number
          note: string | null
          occurred_at: string
          org_id: string
          product_id: string
          qty: number
          reason: string
          reference: string | null
          source_doc_id: string | null
          source_doc_type: string
          source_line_id: string | null
          to_bucket: string | null
          to_location_id: string | null
        }
        Insert: {
          actor_id?: string | null
          approved_by?: string | null
          batch_id?: string | null
          created_at?: string
          from_bucket?: string | null
          from_location_id?: string | null
          id?: never
          note?: string | null
          occurred_at?: string
          org_id: string
          product_id: string
          qty: number
          reason: string
          reference?: string | null
          source_doc_id?: string | null
          source_doc_type: string
          source_line_id?: string | null
          to_bucket?: string | null
          to_location_id?: string | null
        }
        Update: {
          actor_id?: string | null
          approved_by?: string | null
          batch_id?: string | null
          created_at?: string
          from_bucket?: string | null
          from_location_id?: string | null
          id?: never
          note?: string | null
          occurred_at?: string
          org_id?: string
          product_id?: string
          qty?: number
          reason?: string
          reference?: string | null
          source_doc_id?: string | null
          source_doc_type?: string
          source_line_id?: string | null
          to_bucket?: string | null
          to_location_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfer_lines: {
        Row: {
          batch_id: string | null
          created_at: string
          id: string
          notes: string | null
          org_id: string
          product_id: string
          qty_received: number | null
          qty_sent: number
          transfer_id: string
          variance_reason: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          org_id: string
          product_id: string
          qty_received?: number | null
          qty_sent: number
          transfer_id: string
          variance_reason?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          org_id?: string
          product_id?: string
          qty_received?: number | null
          qty_sent?: number
          transfer_id?: string
          variance_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          dispatched_at: string | null
          dispatched_by: string | null
          from_location_id: string
          id: string
          notes: string | null
          org_id: string
          received_at: string | null
          received_by: string | null
          status: string
          to_location_id: string
          transfer_number: string
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          from_location_id: string
          id?: string
          notes?: string | null
          org_id: string
          received_at?: string | null
          received_by?: string | null
          status?: string
          to_location_id: string
          transfer_number: string
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          from_location_id?: string
          id?: string
          notes?: string | null
          org_id?: string
          received_at?: string | null
          received_by?: string | null
          status?: string
          to_location_id?: string
          transfer_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_dispatched_by_fkey"
            columns: ["dispatched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      stocktake_lines: {
        Row: {
          batch_id: string | null
          counted_qty: number | null
          created_at: string
          id: string
          line_status: string
          note: string | null
          org_id: string
          product_id: string
          recount_qty: number | null
          stocktake_id: string
          system_qty_at_open: number
          system_qty_at_submit: number | null
          updated_at: string
          variance_qty: number | null
          variance_reason: string | null
        }
        Insert: {
          batch_id?: string | null
          counted_qty?: number | null
          created_at?: string
          id?: string
          line_status?: string
          note?: string | null
          org_id: string
          product_id: string
          recount_qty?: number | null
          stocktake_id: string
          system_qty_at_open: number
          system_qty_at_submit?: number | null
          updated_at?: string
          variance_qty?: number | null
          variance_reason?: string | null
        }
        Update: {
          batch_id?: string | null
          counted_qty?: number | null
          created_at?: string
          id?: string
          line_status?: string
          note?: string | null
          org_id?: string
          product_id?: string
          recount_qty?: number | null
          stocktake_id?: string
          system_qty_at_open?: number
          system_qty_at_submit?: number | null
          updated_at?: string
          variance_qty?: number | null
          variance_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stocktake_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_lines_stocktake_id_fkey"
            columns: ["stocktake_id"]
            isOneToOne: false
            referencedRelation: "stocktakes"
            referencedColumns: ["id"]
          },
        ]
      }
      stocktakes: {
        Row: {
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          freeze_movements: boolean
          id: string
          location_id: string
          notes: string | null
          org_id: string
          scheduled_for: string | null
          started_at: string | null
          started_by: string | null
          status: string
          stocktake_number: string
          stocktake_type: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          freeze_movements?: boolean
          id?: string
          location_id: string
          notes?: string | null
          org_id: string
          scheduled_for?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          stocktake_number: string
          stocktake_type: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          freeze_movements?: boolean
          id?: string
          location_id?: string
          notes?: string | null
          org_id?: string
          scheduled_for?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          stocktake_number?: string
          stocktake_type?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stocktakes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      suppliers: {
        Row: {
          account_ref: string | null
          active: boolean
          contact_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          account_ref?: string | null
          active?: boolean
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          account_ref?: string | null
          active?: boolean
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      vehicles: {
        Row: {
          active: boolean
          capacity_note: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          make_model: string | null
          org_id: string
          registration: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          capacity_note?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          make_model?: string | null
          org_id: string
          registration: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          capacity_note?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          make_model?: string | null
          org_id?: string
          registration?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      delivery_document_register: {
        Args: {
          p_dispatch_id?: string
          p_doc_type: string
          p_file_name?: string
          p_mime_type?: string
          p_order_id: string
          p_signed_at?: string
          p_signed_by_name?: string
          p_size_bytes?: number
          p_storage_path: string
        }
        Returns: Json
      }
      expiring_stock: {
        Args: { p_location_id?: string; p_within_days?: number }
        Returns: {
          already_expired: boolean
          batch_id: string
          batch_number: string
          days_until_expiry: number
          expiry_date: string
          location_id: string
          location_name: string
          product_id: string
          product_name: string
          qty_on_hand: number
        }[]
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
      goods_receipt_cancel: {
        Args: { p_goods_receipt_id: string; p_reason: string }
        Returns: Json
      }
      goods_receipt_post: {
        Args: { p_goods_receipt_id: string }
        Returns: Json
      }
      haversine_m: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      low_stock_alerts: {
        Args: { p_location_id?: string }
        Returns: {
          brand: string
          location_id: string
          location_name: string
          min_stock_level: number
          product_id: string
          product_name: string
          qty_available: number
          recommended_order_qty: number
          reorder_point: number
          severity: string
        }[]
      }
      next_document_number: {
        Args: { p_doc_type: string; p_org_id: string; p_prefix: string }
        Returns: string
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
      order_availability_check: {
        Args: { p_location_id?: string; p_order_id: string }
        Returns: {
          order_line_id: string
          product_id: string
          product_name: string
          qty_already_reserved: number
          qty_available: number
          qty_ordered: number
          qty_short: number
        }[]
      }
      order_cancel: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      order_confirm: {
        Args: {
          p_location_id?: string
          p_order_id: string
          p_shortfall_action?: string
        }
        Returns: Json
      }
      order_dispatch: {
        Args: {
          p_carrier_name?: string
          p_driver_id?: string
          p_expected_delivery_on?: string
          p_notes?: string
          p_order_id: string
          p_tracking_reference?: string
          p_vehicle_id?: string
        }
        Returns: Json
      }
      order_hold: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      order_mark_delivered: {
        Args: {
          p_delivered_at?: string
          p_dispatch_id: string
          p_lines?: Json
          p_received_by_name: string
        }
        Returns: Json
      }
      order_mark_packed: {
        Args: { p_accept_short?: boolean; p_order_id: string }
        Returns: Json
      }
      order_picking_list: {
        Args: { p_order_id: string }
        Returns: {
          allocation_id: string
          allocation_status: string
          batch_id: string
          batch_number: string
          brand: string
          expiry_date: string
          location_name: string
          order_line_id: string
          product_id: string
          product_name: string
          qty_picked: number
          qty_to_pick: number
          unit_barcode: string
        }[]
      }
      order_record_pick: {
        Args: { p_lines: Json; p_order_id: string }
        Returns: Json
      }
      order_release_hold: { Args: { p_order_id: string }; Returns: Json }
      order_return_undelivered: {
        Args: { p_cancel?: boolean; p_dispatch_id: string; p_reason: string }
        Returns: Json
      }
      order_start_picking: { Args: { p_order_id: string }; Returns: Json }
      orders_missing_pod: {
        Args: { p_min_days?: number }
        Returns: {
          days_outstanding: number
          delivered_at: string
          driver_name: string
          order_id: string
          order_number: string
          received_by_name: string
          store_name: string
        }[]
      }
      orders_pipeline_summary: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          hours_waiting: number
          oldest_created_at: string
          orders: number
          status: string
          units: number
          value_excl_vat: number
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
      product_velocity: {
        Args: { p_days?: number; p_location_id?: string }
        Returns: {
          avg_units_per_day: number
          brand: string
          days_of_stock_remaining: number
          movement_class: string
          product_id: string
          product_name: string
          qty_available: number
          times_backordered: number
          units_sold: number
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
      rep_day_times_per_day: {
        Args: { p_from: string; p_to: string }
        Returns: {
          end_seconds: number
          length_seconds: number
          local_day: string
          rep_id: string
          rep_name: string
          start_seconds: number
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
      stock_adjustment_decide: {
        Args: { p_adjustment_id: string; p_approve: boolean; p_note?: string }
        Returns: Json
      }
      stock_adjustment_submit: {
        Args: { p_adjustment_id: string }
        Returns: Json
      }
      stock_ageing: {
        Args: { p_location_id?: string }
        Returns: {
          age_band: string
          products: number
          qty_on_hand: number
        }[]
      }
      stock_balance_drift: {
        Args: never
        Returns: {
          batch_id: string
          bucket: string
          cached: number
          drift: number
          ledger: number
          location_id: string
          product_id: string
        }[]
      }
      stock_movement_history: {
        Args: {
          p_from?: string
          p_location_id?: string
          p_product_id: string
          p_to?: string
        }
        Returns: {
          actor_name: string
          approved_by_name: string
          batch_number: string
          from_bucket: string
          from_location: string
          movement_id: number
          net_change: number
          note: string
          occurred_at: string
          qty: number
          reason: string
          reference: string
          running_balance: number
          to_bucket: string
          to_location: string
        }[]
      }
      stock_movement_summary: {
        Args: { p_from?: string; p_location_id?: string; p_to?: string }
        Returns: {
          category: string
          movements: number
          units: number
        }[]
      }
      stock_on_hand: {
        Args: {
          p_location_id?: string
          p_only_below_min?: boolean
          p_search?: string
        }
        Returns: {
          brand: string
          is_below_min: boolean
          is_out_of_stock: boolean
          location_id: string
          location_name: string
          min_stock_level: number
          product_id: string
          product_name: string
          qty_available: number
          qty_damaged: number
          qty_expired: number
          qty_in_transit: number
          qty_on_hand: number
          qty_promotional: number
          qty_reserved: number
          reorder_point: number
          sku_code: string
        }[]
      }
      stock_position_summary: {
        Args: { p_location_id?: string }
        Returns: {
          products_below_min: number
          products_out_of_stock: number
          products_stocked: number
          qty_available: number
          qty_damaged: number
          qty_expired: number
          qty_in_transit: number
          qty_on_hand: number
          qty_promotional: number
          qty_reserved: number
        }[]
      }
      stock_reservation_drift: {
        Args: never
        Returns: {
          batch_id: string
          drift: number
          location_id: string
          product_id: string
          qty_allocated: number
          qty_reserved: number
        }[]
      }
      stock_transfer_dispatch: {
        Args: { p_transfer_id: string }
        Returns: Json
      }
      stock_transfer_receive: {
        Args: { p_lines?: Json; p_transfer_id: string }
        Returns: Json
      }
      stock_valuation: {
        Args: { p_location_id?: string }
        Returns: {
          last_unit_cost: number
          product_id: string
          product_name: string
          qty_available: number
          qty_on_hand: number
          value_at_cost: number
        }[]
      }
      stocktake_decide: {
        Args: {
          p_approve: boolean
          p_note?: string
          p_reconfirm_line_ids?: string[]
          p_stocktake_id: string
        }
        Returns: Json
      }
      stocktake_open: {
        Args: {
          p_freeze?: boolean
          p_location_id: string
          p_product_ids?: string[]
          p_stocktake_type?: string
        }
        Returns: Json
      }
      stocktake_submit: { Args: { p_stocktake_id: string }; Returns: Json }
      stocktake_variance_report: {
        Args: { p_stocktake_id: string }
        Returns: {
          batch_number: string
          counted_qty: number
          line_id: string
          line_status: string
          live_qty: number
          moved_since_submit: boolean
          product_id: string
          product_name: string
          system_qty_at_open: number
          system_qty_at_submit: number
          variance_qty: number
          variance_reason: string
        }[]
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
      warehouse_performance: {
        Args: { p_from?: string; p_group_by?: string; p_to?: string }
        Returns: {
          avg_delivery_hours: number
          avg_fulfilment_hours: number
          bucket: string
          fulfilment_accuracy: number
          late_deliveries: number
          orders_delivered: number
          outstanding_pods: number
          units_delivered: number
          units_ordered: number
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
