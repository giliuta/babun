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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      _calendar_delete_context: {
        Row: {
          started_at: string
          team_id: string
          tenant_id: string
          transaction_id: number
        }
        Insert: {
          started_at?: string
          team_id: string
          tenant_id: string
          transaction_id: number
        }
        Update: {
          started_at?: string
          team_id?: string
          tenant_id?: string
          transaction_id?: number
        }
        Relationships: []
      }
      _finance_write_context: {
        Row: {
          entity_id: string
          kind: string
          occurred_on: string | null
          payment_id: string | null
          tenant_id: string
          transaction_id: number
        }
        Insert: {
          entity_id: string
          kind: string
          occurred_on?: string | null
          payment_id?: string | null
          tenant_id: string
          transaction_id: number
        }
        Update: {
          entity_id?: string
          kind?: string
          occurred_on?: string | null
          payment_id?: string | null
          tenant_id?: string
          transaction_id?: number
        }
        Relationships: []
      }
      access_blocks: {
        Row: {
          area: string
          enforced_by: string[]
          key: string
          levels: string[]
          live: boolean
          owner_only: boolean
          position: number
          scope: string
          title_ru: string
        }
        Insert: {
          area: string
          enforced_by?: string[]
          key: string
          levels: string[]
          live?: boolean
          owner_only?: boolean
          position: number
          scope: string
          title_ru: string
        }
        Update: {
          area?: string
          enforced_by?: string[]
          key?: string
          levels?: string[]
          live?: boolean
          owner_only?: boolean
          position?: number
          scope?: string
          title_ru?: string
        }
        Relationships: []
      }
      access_templates: {
        Row: {
          created_at: string
          id: string
          levels: Json
          name: string
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          levels?: Json
          name: string
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          levels?: Json
          name?: string
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      account_deletion_cleanup: {
        Row: {
          attempt_count: number
          deleted_tenant_count: number
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_retry_at: string
          requested_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          deleted_tenant_count?: number
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_retry_at?: string
          requested_at?: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          deleted_tenant_count?: number
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_retry_at?: string
          requested_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      account_teams: {
        Row: {
          account_id: string
          created_at: string
          team_id: string
          tenant_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          team_id: string
          tenant_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          team_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_teams_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_teams_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          balance_hidden: boolean
          brigade_id: string
          color: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          icon: string | null
          id: string
          is_active: boolean
          is_hidden: boolean
          is_primary: boolean
          kind: string
          name: string
          note: string | null
          opening_balance: number
          owner_master_id: string | null
          position: number
          purge_at: string | null
          scope: string
          show_in_payments: boolean
          tenant_id: string
          updated_at: string
          vat_mode: string | null
        }
        Insert: {
          balance_hidden?: boolean
          brigade_id: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          is_hidden?: boolean
          is_primary?: boolean
          kind: string
          name: string
          note?: string | null
          opening_balance?: number
          owner_master_id?: string | null
          position?: number
          purge_at?: string | null
          scope?: string
          show_in_payments?: boolean
          tenant_id: string
          updated_at?: string
          vat_mode?: string | null
        }
        Update: {
          balance_hidden?: boolean
          brigade_id?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          is_hidden?: boolean
          is_primary?: boolean
          kind?: string
          name?: string
          note?: string | null
          opening_balance?: number
          owner_master_id?: string | null
          position?: number
          purge_at?: string | null
          scope?: string
          show_in_payments?: boolean
          tenant_id?: string
          updated_at?: string
          vat_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_release: {
        Row: {
          latest_version: string
          min_version: string
          platform: string
          store_url: string
          updated_at: string
        }
        Insert: {
          latest_version: string
          min_version?: string
          platform: string
          store_url: string
          updated_at?: string
        }
        Update: {
          latest_version?: string
          min_version?: string
          platform?: string
          store_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      appointment_links: {
        Row: {
          answer: string | null
          answered_at: string | null
          appointment_id: string
          created_at: string
          tenant_id: string
          token: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          appointment_id: string
          created_at?: string
          tenant_id: string
          token: string
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          appointment_id?: string
          created_at?: string
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_links_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_photos: {
        Row: {
          appointment_id: string
          caption: string
          created_at: string
          id: string
          kind: string
          location_id: string | null
          sort_order: number
          storage_path: string
          taken_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          caption?: string
          created_at?: string
          id?: string
          kind?: string
          location_id?: string | null
          sort_order?: number
          storage_path: string
          taken_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          caption?: string
          created_at?: string
          id?: string
          kind?: string
          location_id?: string | null
          sort_order?: number
          storage_path?: string
          taken_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_photos_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          address: string
          address_lat: number | null
          address_lng: number | null
          address_note: string
          cancel_reason: string | null
          city: string | null
          client_id: string | null
          color_override: string | null
          comment: string
          consent_given: boolean
          created_at: string
          created_by: string | null
          custom_total: boolean
          date: string
          discount_amount: number
          event_all_day: boolean
          event_notes: string
          event_push_at: string | null
          event_push_enabled: boolean
          event_push_offsets: Json
          event_repeat: Json
          event_url: string
          expenses: Json
          global_discount: Json | null
          id: string
          is_online_booking: boolean
          kind: string
          location_id: string | null
          master_id: string | null
          material_lines: Json | null
          paid_amount: number
          payment: Json | null
          payment_account_id: string | null
          payment_method: string | null
          payment_status: string
          payments: Json
          prepaid_amount: number
          prepayments: Json
          reminder_enabled: boolean
          reminder_offsets: Json
          reminder_template: string
          service_ids: Json
          service_price_overrides: Json
          services: Json
          source: string | null
          status: string
          team_id: string | null
          tenant_id: string
          time_end: string
          time_start: string
          total_amount: number
          total_duration: number
          updated_at: string
          vat_mode: string | null
          vat_rate: number | null
        }
        Insert: {
          address?: string
          address_lat?: number | null
          address_lng?: number | null
          address_note?: string
          cancel_reason?: string | null
          city?: string | null
          client_id?: string | null
          color_override?: string | null
          comment?: string
          consent_given?: boolean
          created_at?: string
          created_by?: string | null
          custom_total?: boolean
          date: string
          discount_amount?: number
          event_all_day?: boolean
          event_notes?: string
          event_push_at?: string | null
          event_push_enabled?: boolean
          event_push_offsets?: Json
          event_repeat?: Json
          event_url?: string
          expenses?: Json
          global_discount?: Json | null
          id?: string
          is_online_booking?: boolean
          kind?: string
          location_id?: string | null
          master_id?: string | null
          material_lines?: Json | null
          paid_amount?: number
          payment?: Json | null
          payment_account_id?: string | null
          payment_method?: string | null
          payment_status?: string
          payments?: Json
          prepaid_amount?: number
          prepayments?: Json
          reminder_enabled?: boolean
          reminder_offsets?: Json
          reminder_template?: string
          service_ids?: Json
          service_price_overrides?: Json
          services?: Json
          source?: string | null
          status?: string
          team_id?: string | null
          tenant_id: string
          time_end: string
          time_start: string
          total_amount?: number
          total_duration?: number
          updated_at?: string
          vat_mode?: string | null
          vat_rate?: number | null
        }
        Update: {
          address?: string
          address_lat?: number | null
          address_lng?: number | null
          address_note?: string
          cancel_reason?: string | null
          city?: string | null
          client_id?: string | null
          color_override?: string | null
          comment?: string
          consent_given?: boolean
          created_at?: string
          created_by?: string | null
          custom_total?: boolean
          date?: string
          discount_amount?: number
          event_all_day?: boolean
          event_notes?: string
          event_push_at?: string | null
          event_push_enabled?: boolean
          event_push_offsets?: Json
          event_repeat?: Json
          event_url?: string
          expenses?: Json
          global_discount?: Json | null
          id?: string
          is_online_booking?: boolean
          kind?: string
          location_id?: string | null
          master_id?: string | null
          material_lines?: Json | null
          paid_amount?: number
          payment?: Json | null
          payment_account_id?: string | null
          payment_method?: string | null
          payment_status?: string
          payments?: Json
          prepaid_amount?: number
          prepayments?: Json
          reminder_enabled?: boolean
          reminder_offsets?: Json
          reminder_template?: string
          service_ids?: Json
          service_price_overrides?: Json
          services?: Json
          source?: string | null
          status?: string
          team_id?: string | null
          tenant_id?: string
          time_end?: string
          time_start?: string
          total_amount?: number
          total_duration?: number
          updated_at?: string
          vat_mode?: string | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_payment_account_id_fkey"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          event_type: string
          id: string
          payload: Json
          processed_at: string
          stripe_event_id: string
          tenant_id: string | null
        }
        Insert: {
          event_type: string
          id?: string
          payload: Json
          processed_at?: string
          stripe_event_id: string
          tenant_id?: string | null
        }
        Update: {
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string
          stripe_event_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_feed_tokens: {
        Row: {
          created_at: string
          revoked_at: string | null
          tenant_id: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          revoked_at?: string | null
          tenant_id: string
          token?: string
          user_id: string
        }
        Update: {
          created_at?: string
          revoked_at?: string | null
          tenant_id?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feed_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_feed_tokens_tenant_id_user_id_fkey"
            columns: ["tenant_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tenant_members"
            referencedColumns: ["tenant_id", "user_id"]
          },
        ]
      }
      calendar_members: {
        Row: {
          created_at: string
          created_by: string | null
          grants: string[]
          master_id: string | null
          team_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          grants?: string[]
          master_id?: string | null
          team_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          grants?: string[]
          master_id?: string | null
          team_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_members_member_fkey"
            columns: ["tenant_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tenant_members"
            referencedColumns: ["tenant_id", "user_id"]
          },
          {
            foreignKeyName: "calendar_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_members_tenant_id_team_id_fkey"
            columns: ["tenant_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      calendar_settings: {
        Row: {
          allow_overtime: boolean
          booking_block_order: string[] | null
          buffer_minutes: number
          created_at: string
          days_off: Json
          disabled_features: string[]
          end_hour: number
          end_minute: number
          grid_step: number
          hide_cancelled: boolean
          personal_default_label: string | null
          personal_labels: Json | null
          record_color_fallback: string | null
          record_color_palette: Json | null
          record_color_rule: string
          scroll_open_hour: number | null
          show_day_finance: boolean
          start_hour: number
          start_minute: number
          tenant_id: string
          timezone: string
          timezone_auto: boolean
          updated_at: string
          week_start: string
          work_end_hour: number | null
          work_start_hour: number | null
        }
        Insert: {
          allow_overtime?: boolean
          booking_block_order?: string[] | null
          buffer_minutes?: number
          created_at?: string
          days_off?: Json
          disabled_features?: string[]
          end_hour?: number
          end_minute?: number
          grid_step?: number
          hide_cancelled?: boolean
          personal_default_label?: string | null
          personal_labels?: Json | null
          record_color_fallback?: string | null
          record_color_palette?: Json | null
          record_color_rule?: string
          scroll_open_hour?: number | null
          show_day_finance?: boolean
          start_hour?: number
          start_minute?: number
          tenant_id: string
          timezone?: string
          timezone_auto?: boolean
          updated_at?: string
          week_start?: string
          work_end_hour?: number | null
          work_start_hour?: number | null
        }
        Update: {
          allow_overtime?: boolean
          booking_block_order?: string[] | null
          buffer_minutes?: number
          created_at?: string
          days_off?: Json
          disabled_features?: string[]
          end_hour?: number
          end_minute?: number
          grid_step?: number
          hide_cancelled?: boolean
          personal_default_label?: string | null
          personal_labels?: Json | null
          record_color_fallback?: string | null
          record_color_palette?: Json | null
          record_color_rule?: string
          scroll_open_hour?: number | null
          show_day_finance?: boolean
          start_hour?: number
          start_minute?: number
          tenant_id?: string
          timezone?: string
          timezone_auto?: boolean
          updated_at?: string
          week_start?: string
          work_end_hour?: number | null
          work_start_hour?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      change_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          changes: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: number
          label: string | null
          meta: Json | null
          team_id: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          changes?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: never
          label?: string | null
          meta?: Json | null
          team_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          changes?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: never
          label?: string | null
          meta?: Json | null
          team_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          color: string | null
          country: string
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          position: number
          team_id: string
          tenant_id: string
          tint_day: boolean
          updated_at: string
          weekdays: number[]
        }
        Insert: {
          color?: string | null
          country?: string
          created_at?: string
          deleted_at?: string | null
          id: string
          is_active?: boolean
          name: string
          position?: number
          team_id: string
          tenant_id: string
          tint_day?: boolean
          updated_at?: string
          weekdays?: number[]
        }
        Update: {
          color?: string | null
          country?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          team_id?: string
          tenant_id?: string
          tint_day?: boolean
          updated_at?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "cities_team_fk"
            columns: ["tenant_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "cities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_attachments: {
        Row: {
          appointment_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          filename: string
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          tenant_id: string
        }
        Insert: {
          appointment_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          filename?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path: string
          tenant_id: string
        }
        Update: {
          appointment_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          filename?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_attachments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_attachments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contact_alerts: {
        Row: {
          clients_count: number
          created_at: string
          id: number
          kind: string
          seen_at: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          clients_count: number
          created_at?: string
          id?: never
          kind: string
          seen_at?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          clients_count?: number
          created_at?: string
          id?: never
          kind?: string
          seen_at?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_contact_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contact_views: {
        Row: {
          client_id: string
          counted: boolean
          id: number
          opened_at: string
          outcome: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          client_id: string
          counted?: boolean
          id?: never
          opened_at?: string
          outcome: string
          tenant_id: string
          user_id: string
        }
        Update: {
          client_id?: string
          counted?: boolean
          id?: never
          opened_at?: string
          outcome?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_contact_views_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_list_disclosures: {
        Row: {
          clients_count: number
          disclosed_at: string
          id: number
          tenant_id: string
          user_id: string
        }
        Insert: {
          clients_count: number
          disclosed_at?: string
          id?: never
          tenant_id: string
          user_id: string
        }
        Update: {
          clients_count?: number
          disclosed_at?: string
          id?: never
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_list_disclosures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_phone_lookups: {
        Row: {
          id: number
          looked_up_at: string
          phone_hash: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          id?: never
          looked_up_at?: string
          phone_hash: string
          tenant_id: string
          user_id: string
        }
        Update: {
          id?: never
          looked_up_at?: string
          phone_hash?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_phone_lookups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_sources: {
        Row: {
          created_at: string
          id: string
          key: string | null
          name: string
          position: number
          team_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key?: string | null
          name: string
          position?: number
          team_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string | null
          name?: string
          position?: number
          team_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_sources_team_fk"
            columns: ["tenant_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "client_sources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tag_assignments: {
        Row: {
          client_id: string
          position: number
          tag_id: string
          tenant_id: string
        }
        Insert: {
          client_id: string
          position?: number
          tag_id: string
          tenant_id: string
        }
        Update: {
          client_id?: string
          position?: number
          tag_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tag_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "client_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tag_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tags: {
        Row: {
          color: string
          hidden: boolean
          icon: string | null
          id: string
          name: string
          position: number
          team_id: string
          tenant_id: string
        }
        Insert: {
          color: string
          hidden?: boolean
          icon?: string | null
          id?: string
          name: string
          position?: number
          team_id: string
          tenant_id: string
        }
        Update: {
          color?: string
          hidden?: boolean
          icon?: string | null
          id?: string
          name?: string
          position?: number
          team_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tags_team_fk"
            columns: ["tenant_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "client_tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          acquisition_source: string
          address: string
          avatar_url: string | null
          balance: number
          billing_address: string | null
          birthday: string
          blacklisted: boolean
          city: string
          city_manual: boolean
          comment: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          discount: number
          email: string
          equipment: Json
          favorite_master_id: string | null
          first_contact_date: string | null
          full_name: string
          id: string
          instagram_username: string
          language: string | null
          legal_name: string | null
          locations: Json
          memberships: Json
          notes: Json
          phone: string
          phone_e164: string | null
          phones: Json
          pinned_at: string | null
          property_type: string
          purge_at: string | null
          referred_by_client_id: string | null
          reg_number: string | null
          reminder_at: string | null
          requisites: Json
          sms_name: string
          sms_opt_out: boolean
          team_id: string | null
          telegram_username: string
          tenant_id: string
          updated_at: string
          vat_number: string | null
          whatsapp_phone: string
        }
        Insert: {
          acquisition_source?: string
          address?: string
          avatar_url?: string | null
          balance?: number
          billing_address?: string | null
          birthday?: string
          blacklisted?: boolean
          city?: string
          city_manual?: boolean
          comment?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discount?: number
          email?: string
          equipment?: Json
          favorite_master_id?: string | null
          first_contact_date?: string | null
          full_name: string
          id?: string
          instagram_username?: string
          language?: string | null
          legal_name?: string | null
          locations?: Json
          memberships?: Json
          notes?: Json
          phone?: string
          phone_e164?: string | null
          phones?: Json
          pinned_at?: string | null
          property_type?: string
          purge_at?: string | null
          referred_by_client_id?: string | null
          reg_number?: string | null
          reminder_at?: string | null
          requisites?: Json
          sms_name?: string
          sms_opt_out?: boolean
          team_id?: string | null
          telegram_username?: string
          tenant_id: string
          updated_at?: string
          vat_number?: string | null
          whatsapp_phone?: string
        }
        Update: {
          acquisition_source?: string
          address?: string
          avatar_url?: string | null
          balance?: number
          billing_address?: string | null
          birthday?: string
          blacklisted?: boolean
          city?: string
          city_manual?: boolean
          comment?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discount?: number
          email?: string
          equipment?: Json
          favorite_master_id?: string | null
          first_contact_date?: string | null
          full_name?: string
          id?: string
          instagram_username?: string
          language?: string | null
          legal_name?: string | null
          locations?: Json
          memberships?: Json
          notes?: Json
          phone?: string
          phone_e164?: string | null
          phones?: Json
          pinned_at?: string | null
          property_type?: string
          purge_at?: string | null
          referred_by_client_id?: string | null
          reg_number?: string | null
          reminder_at?: string | null
          requisites?: Json
          sms_name?: string
          sms_opt_out?: boolean
          team_id?: string | null
          telegram_username?: string
          tenant_id?: string
          updated_at?: string
          vat_number?: string | null
          whatsapp_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_referred_by_client_id_fkey"
            columns: ["referred_by_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_team_fk"
            columns: ["tenant_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      day_cities: {
        Row: {
          city: string
          created_at: string
          date: string
          team_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          city: string
          created_at?: string
          date: string
          team_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          city?: string
          created_at?: string
          date?: string
          team_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_cities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      day_extras: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          date: string
          id: string
          kind: string
          name: string
          payment_method: string | null
          receipt_url: string | null
          team_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          date: string
          id?: string
          kind: string
          name: string
          payment_method?: string | null
          receipt_url?: string | null
          team_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          date?: string
          id?: string
          kind?: string
          name?: string
          payment_method?: string | null
          receipt_url?: string | null
          team_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_extras_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      debts: {
        Row: {
          amount: number
          category_id: string | null
          client_id: string | null
          counterparty: string
          created_at: string
          created_by: string | null
          currency: string
          direction: string
          id: string
          note: string | null
          occurred_on: string
          occurred_time: string | null
          receipt_url: string | null
          team_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          category_id?: string | null
          client_id?: string | null
          counterparty: string
          created_at?: string
          created_by?: string | null
          currency?: string
          direction: string
          id?: string
          note?: string | null
          occurred_on: string
          occurred_time?: string | null
          receipt_url?: string | null
          team_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category_id?: string | null
          client_id?: string | null
          counterparty?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          direction?: string
          id?: string
          note?: string | null
          occurred_on?: string
          occurred_time?: string | null
          receipt_url?: string | null
          team_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "debts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_appointments: {
        Row: {
          appointment: Json
          created_by: string | null
          deleted_at: string
          deleted_by: string | null
          dependents: Json
          id: string
          kind: string
          purge_at: string
          team_id: string
          tenant_id: string
        }
        Insert: {
          appointment: Json
          created_by?: string | null
          deleted_at?: string
          deleted_by?: string | null
          dependents?: Json
          id: string
          kind: string
          purge_at: string
          team_id: string
          tenant_id: string
        }
        Update: {
          appointment?: Json
          created_by?: string | null
          deleted_at?: string
          deleted_by?: string | null
          dependents?: Json
          id?: string
          kind?: string
          purge_at?: string
          team_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deleted_appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_operations: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          id: string
          operation: Json
          purge_at: string
          team_id: string
          tenant_id: string
          type: string
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          id: string
          operation: Json
          purge_at: string
          team_id: string
          tenant_id: string
          type: string
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          operation?: Json
          purge_at?: string
          team_id?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "deleted_operations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          doc_type: string
          last_number: number
          legal_entity_id: string
          tenant_id: string
          updated_at: string
          year: number
        }
        Insert: {
          doc_type: string
          last_number?: number
          legal_entity_id: string
          tenant_id: string
          updated_at?: string
          year: number
        }
        Update: {
          doc_type?: string
          last_number?: number
          legal_entity_id?: string
          tenant_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_sequences_tenant_id_legal_entity_id_fkey"
            columns: ["tenant_id", "legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      edge_cron_secrets: {
        Row: {
          created_at: string
          name: string
          rotated_at: string | null
          secret: string
        }
        Insert: {
          created_at?: string
          name: string
          rotated_at?: string | null
          secret: string
        }
        Update: {
          created_at?: string
          name?: string
          rotated_at?: string | null
          secret?: string
        }
        Relationships: []
      }
      equipment: {
        Row: {
          assigned_team_id: string | null
          category: string | null
          color: string | null
          created_at: string
          id: string
          installed_at: string | null
          is_active: boolean
          last_service_at: string | null
          name: string
          next_service_at: string | null
          notes: string | null
          position: number
          serial: string | null
          service_interval_months: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_team_id?: string | null
          category?: string | null
          color?: string | null
          created_at?: string
          id: string
          installed_at?: string | null
          is_active?: boolean
          last_service_at?: string | null
          name: string
          next_service_at?: string | null
          notes?: string | null
          position?: number
          serial?: string | null
          service_interval_months?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_team_id?: string | null
          category?: string | null
          color?: string | null
          created_at?: string
          id?: string
          installed_at?: string | null
          is_active?: boolean
          last_service_at?: string | null
          name?: string
          next_service_at?: string | null
          notes?: string | null
          position?: number
          serial?: string | null
          service_interval_months?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      erased_appointment_blobs: {
        Row: {
          appointment_id: string
          created_by: string | null
          erased_at: string
          erased_by: string | null
          kind: string
          team_id: string
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          created_by?: string | null
          erased_at?: string
          erased_by?: string | null
          kind: string
          team_id: string
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          created_by?: string | null
          erased_at?: string
          erased_by?: string | null
          kind?: string
          team_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "erased_appointment_blobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_templates: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          duration_min: number
          emoji: string | null
          id: string
          name: string
          push_offset_min: number | null
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color: string
          created_at?: string
          created_by?: string | null
          duration_min: number
          emoji?: string | null
          id?: string
          name: string
          push_offset_min?: number | null
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          duration_min?: number
          emoji?: string | null
          id?: string
          name?: string
          push_offset_min?: number | null
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_categories: {
        Row: {
          ask_client: boolean
          ask_employee: boolean
          color: string | null
          created_at: string
          hidden: boolean
          icon: string | null
          id: string
          is_system: boolean
          monthly_budget: number | null
          name: string
          position: number
          require_receipt: boolean
          retired: boolean
          slug: string
          team_id: string | null
          tenant_id: string | null
          type: string
        }
        Insert: {
          ask_client?: boolean
          ask_employee?: boolean
          color?: string | null
          created_at?: string
          hidden?: boolean
          icon?: string | null
          id?: string
          is_system?: boolean
          monthly_budget?: number | null
          name: string
          position?: number
          require_receipt?: boolean
          retired?: boolean
          slug: string
          team_id?: string | null
          tenant_id?: string | null
          type: string
        }
        Update: {
          ask_client?: boolean
          ask_employee?: boolean
          color?: string | null
          created_at?: string
          hidden?: boolean
          icon?: string | null
          id?: string
          is_system?: boolean
          monthly_budget?: number | null
          name?: string
          position?: number
          require_receipt?: boolean
          retired?: boolean
          slug?: string
          team_id?: string | null
          tenant_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_category_hidden: {
        Row: {
          category_id: string
          created_at: string
          tenant_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          tenant_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_category_hidden_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_category_hidden_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_category_order: {
        Row: {
          category_id: string
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category_id: string
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_category_order_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_category_order_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_occurred_on_fixes: {
        Row: {
          fixed_at: string
          new_occurred_on: string
          old_occurred_on: string
          transaction_id: string
        }
        Insert: {
          fixed_at?: string
          new_occurred_on: string
          old_occurred_on: string
          transaction_id: string
        }
        Update: {
          fixed_at?: string
          new_occurred_on?: string
          old_occurred_on?: string
          transaction_id?: string
        }
        Relationships: []
      }
      finance_templates: {
        Row: {
          account_id: string | null
          amount: number
          brigade_id: string
          category_id: string | null
          created_at: string
          id: string
          is_active: boolean
          kind: string
          master_id: string | null
          name: string
          payment_method: string | null
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          brigade_id: string
          category_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind: string
          master_id?: string | null
          name: string
          payment_method?: string | null
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          brigade_id?: string
          category_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          master_id?: string | null
          name?: string
          payment_method?: string | null
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_templates_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_transactions: {
        Row: {
          account_id: string | null
          amount: number
          appointment_id: string | null
          appointment_payment_id: string | null
          appointment_payment_kind: string | null
          category_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          debt_id: string | null
          from_calendar: boolean
          id: string
          invoice_id: string | null
          master_id: string | null
          notes: string | null
          occurred_on: string
          occurred_time: string | null
          payment_method: string | null
          receipt_url: string | null
          refund_of_id: string | null
          reversal_kind: string | null
          source: string
          team_id: string
          tenant_id: string
          transfer_group_id: string | null
          type: string
          updated_at: string
          vat_amount: number | null
          vat_mode: string | null
          vat_rate: number | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          appointment_id?: string | null
          appointment_payment_id?: string | null
          appointment_payment_kind?: string | null
          category_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          debt_id?: string | null
          from_calendar?: boolean
          id?: string
          invoice_id?: string | null
          master_id?: string | null
          notes?: string | null
          occurred_on?: string
          occurred_time?: string | null
          payment_method?: string | null
          receipt_url?: string | null
          refund_of_id?: string | null
          reversal_kind?: string | null
          source?: string
          team_id: string
          tenant_id: string
          transfer_group_id?: string | null
          type: string
          updated_at?: string
          vat_amount?: number | null
          vat_mode?: string | null
          vat_rate?: number | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          appointment_id?: string | null
          appointment_payment_id?: string | null
          appointment_payment_kind?: string | null
          category_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          debt_id?: string | null
          from_calendar?: boolean
          id?: string
          invoice_id?: string | null
          master_id?: string | null
          notes?: string | null
          occurred_on?: string
          occurred_time?: string | null
          payment_method?: string | null
          receipt_url?: string | null
          refund_of_id?: string | null
          reversal_kind?: string | null
          source?: string
          team_id?: string
          tenant_id?: string
          transfer_group_id?: string | null
          type?: string
          updated_at?: string
          vat_amount?: number | null
          vat_mode?: string | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "debts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_refund_of_id_fkey"
            columns: ["refund_of_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_tx_invoice_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_transfer_requests: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          from_account_id: string
          id: string
          notes: string | null
          occurred_on: string
          status: string
          team_id: string
          tenant_id: string
          to_account_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          from_account_id: string
          id: string
          notes?: string | null
          occurred_on: string
          status?: string
          team_id: string
          tenant_id: string
          to_account_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          from_account_id?: string
          id?: string
          notes?: string | null
          occurred_on?: string
          status?: string
          team_id?: string
          tenant_id?: string
          to_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_transfer_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation_email_log: {
        Row: {
          email_lower: string
          id: number
          sender: string
          sent_at: string
          tenant_id: string
        }
        Insert: {
          email_lower: string
          id?: number
          sender: string
          sent_at?: string
          tenant_id: string
        }
        Update: {
          email_lower?: string
          id?: number
          sender?: string
          sent_at?: string
          tenant_id?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by_user_id: string | null
          access_changes: Json
          created_at: string
          email: string
          email_sent_at: string | null
          expires_at: string
          full_name: string | null
          id: string
          invited_by_user_id: string | null
          master_color: string | null
          master_id: string | null
          master_title: string | null
          phone: string | null
          role: string
          team_id: string | null
          team_ids: string[] | null
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          access_changes?: Json
          created_at?: string
          email: string
          email_sent_at?: string | null
          expires_at?: string
          full_name?: string | null
          id?: string
          invited_by_user_id?: string | null
          master_color?: string | null
          master_id?: string | null
          master_title?: string | null
          phone?: string | null
          role: string
          team_id?: string | null
          team_ids?: string[] | null
          tenant_id: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          access_changes?: Json
          created_at?: string
          email?: string
          email_sent_at?: string | null
          expires_at?: string
          full_name?: string | null
          id?: string
          invited_by_user_id?: string | null
          master_color?: string | null
          master_id?: string | null
          master_title?: string | null
          phone?: string | null
          role?: string
          team_id?: string | null
          team_ids?: string[] | null
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_master_fkey"
            columns: ["tenant_id", "master_id"]
            isOneToOne: false
            referencedRelation: "masters"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "invitations_team_fkey"
            columns: ["tenant_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          description: string | null
          id: string
          invoice_id: string
          position: number
          qty: number
          title: string
          total: number
          unit: string | null
          unit_price: number
        }
        Insert: {
          description?: string | null
          id?: string
          invoice_id: string
          position?: number
          qty?: number
          title: string
          total: number
          unit?: string | null
          unit_price: number
        }
        Update: {
          description?: string | null
          id?: string
          invoice_id?: string
          position?: number
          qty?: number
          title?: string
          total?: number
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          account_id: string | null
          appointment_id: string | null
          brigade_id: string
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          created_by: string | null
          credit_note_of_id: string | null
          credit_note_of_receipt_id: string | null
          credit_partial: boolean
          credited_amount: number
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          kind: string
          language: string
          location_id: string | null
          notes: string | null
          number: string
          payment_id: string | null
          pdf_url: string | null
          seller_snapshot: Json
          seq: number
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_mode: string | null
          vat_percent: number
          year: number
        }
        Insert: {
          account_id?: string | null
          appointment_id?: string | null
          brigade_id: string
          client_id?: string | null
          client_requisites_id?: string | null
          client_snapshot?: Json | null
          company_id: string
          created_at?: string
          created_by?: string | null
          credit_note_of_id?: string | null
          credit_note_of_receipt_id?: string | null
          credit_partial?: boolean
          credited_amount?: number
          currency?: string
          due_on?: string | null
          id?: string
          issued_on?: string
          kind?: string
          language?: string
          location_id?: string | null
          notes?: string | null
          number: string
          payment_id?: string | null
          pdf_url?: string | null
          seller_snapshot: Json
          seq: number
          status?: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at?: string
          vat_amount: number
          vat_mode?: string | null
          vat_percent?: number
          year: number
        }
        Update: {
          account_id?: string | null
          appointment_id?: string | null
          brigade_id?: string
          client_id?: string | null
          client_requisites_id?: string | null
          client_snapshot?: Json | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          credit_note_of_id?: string | null
          credit_note_of_receipt_id?: string | null
          credit_partial?: boolean
          credited_amount?: number
          currency?: string
          due_on?: string | null
          id?: string
          issued_on?: string
          kind?: string
          language?: string
          location_id?: string | null
          notes?: string | null
          number?: string
          payment_id?: string | null
          pdf_url?: string | null
          seller_snapshot?: Json
          seq?: number
          status?: string
          subtotal_net?: number
          tenant_id?: string
          total?: number
          updated_at?: string
          vat_amount?: number
          vat_mode?: string | null
          vat_percent?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
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
            foreignKeyName: "invoices_credit_note_of_id_fkey"
            columns: ["credit_note_of_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_credit_note_of_receipt_id_fkey"
            columns: ["credit_note_of_receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_legal_entity_fkey"
            columns: ["tenant_id", "company_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_entities: {
        Row: {
          archived_at: string | null
          bank_name: string | null
          business_address: string | null
          color: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          credit_note_prefix: string
          iban: string | null
          icon: string | null
          id: string
          invoice_prefix: string
          is_default: boolean
          legal_name: string | null
          logo_url: string | null
          name: string
          number_padding: number
          position: number
          receipt_prefix: string
          reg_number: string | null
          tenant_id: string
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          archived_at?: string | null
          bank_name?: string | null
          business_address?: string | null
          color?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          credit_note_prefix?: string
          iban?: string | null
          icon?: string | null
          id?: string
          invoice_prefix?: string
          is_default?: boolean
          legal_name?: string | null
          logo_url?: string | null
          name: string
          number_padding?: number
          position?: number
          receipt_prefix?: string
          reg_number?: string | null
          tenant_id: string
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          archived_at?: string | null
          bank_name?: string | null
          business_address?: string | null
          color?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          credit_note_prefix?: string
          iban?: string | null
          icon?: string | null
          id?: string
          invoice_prefix?: string
          is_default?: boolean
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          number_padding?: number
          position?: number
          receipt_prefix?: string
          reg_number?: string | null
          tenant_id?: string
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_entities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      location_labels: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          position: number
          team_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id: string
          is_active?: boolean
          name: string
          position?: number
          team_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          team_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_labels_team_fk"
            columns: ["tenant_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "location_labels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      location_requests: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          location_id: string | null
          tenant_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          location_id?: string | null
          tenant_id: string
          token: string
          used_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          location_id?: string | null
          tenant_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      master_rating_tokens: {
        Row: {
          appointment_id: string | null
          created_at: string
          expires_at: string
          master_id: string
          tenant_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          expires_at?: string
          master_id: string
          tenant_id: string
          token: string
          used_at?: string | null
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          expires_at?: string
          master_id?: string
          tenant_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_rating_tokens_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_rating_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      master_ratings: {
        Row: {
          appointment_id: string | null
          client_id: string | null
          comment: string | null
          created_at: string
          id: string
          master_id: string
          stars: number
          tenant_id: string
          token: string | null
        }
        Insert: {
          appointment_id?: string | null
          client_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          master_id: string
          stars: number
          tenant_id: string
          token?: string | null
        }
        Update: {
          appointment_id?: string | null
          client_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          master_id?: string
          stars?: number
          tenant_id?: string
          token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_ratings_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_ratings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_ratings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_ratings_token_fkey"
            columns: ["token"]
            isOneToOne: false
            referencedRelation: "master_rating_tokens"
            referencedColumns: ["token"]
          },
        ]
      }
      masters: {
        Row: {
          account_status: string | null
          avatar_url: string | null
          color: string | null
          created_at: string
          created_by: string | null
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          position: number
          profile: Json
          role: string
          team_id: string | null
          tenant_id: string
          title: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_status?: string | null
          avatar_url?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          full_name: string
          id: string
          is_active?: boolean
          phone?: string | null
          position?: number
          profile?: Json
          role?: string
          team_id?: string | null
          tenant_id: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_status?: string | null
          avatar_url?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          position?: number
          profile?: Json
          role?: string
          team_id?: string | null
          tenant_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "masters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      member_access: {
        Row: {
          block: string
          level: string
          set_at: string
          set_by: string | null
          team_id: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          block: string
          level: string
          set_at?: string
          set_by?: string | null
          team_id?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          block?: string
          level?: string
          set_at?: string
          set_by?: string | null
          team_id?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_access_block_fkey"
            columns: ["block"]
            isOneToOne: false
            referencedRelation: "access_blocks"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "member_access_calendar_fkey"
            columns: ["tenant_id", "user_id", "team_id"]
            isOneToOne: false
            referencedRelation: "member_calendars"
            referencedColumns: ["tenant_id", "user_id", "team_id"]
          },
          {
            foreignKeyName: "member_access_member_fkey"
            columns: ["tenant_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tenant_members"
            referencedColumns: ["tenant_id", "user_id"]
          },
        ]
      }
      member_calendars: {
        Row: {
          attached_at: string
          attached_by: string | null
          team_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          attached_at?: string
          attached_by?: string | null
          team_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          attached_at?: string
          attached_by?: string | null
          team_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_calendars_member_fkey"
            columns: ["tenant_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tenant_members"
            referencedColumns: ["tenant_id", "user_id"]
          },
          {
            foreignKeyName: "member_calendars_team_fkey"
            columns: ["tenant_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      onboarding_progress: {
        Row: {
          created_at: string
          done: string[]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          done?: string[]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          done?: string[]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      online_booking_pages: {
        Row: {
          created_at: string
          enabled: boolean
          team_id: string
          tenant_id: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          team_id: string
          tenant_id: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          team_id?: string
          tenant_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_booking_pages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      online_booking_requests: {
        Row: {
          created_at: string
          id: number
          phone_e164: string
          team_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          phone_e164: string
          team_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: number
          phone_e164?: string
          team_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_booking_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_files: {
        Row: {
          created_at: string
          created_by: string | null
          filename: string
          id: string
          master_id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          filename: string
          id?: string
          master_id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          filename?: string
          id?: string
          master_id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_files_tenant_id_master_id_fkey"
            columns: ["tenant_id", "master_id"]
            isOneToOne: false
            referencedRelation: "masters"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      personal_event_types: {
        Row: {
          all_day: boolean
          color: string
          created_at: string
          created_by: string | null
          default_duration: number
          deleted_at: string | null
          icon: string
          id: string
          is_active: boolean
          label: string
          position: number
          team_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          color?: string
          created_at?: string
          created_by?: string | null
          default_duration?: number
          deleted_at?: string | null
          icon?: string
          id: string
          is_active?: boolean
          label: string
          position?: number
          team_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          color?: string
          created_at?: string
          created_by?: string | null
          default_duration?: number
          deleted_at?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          label?: string
          position?: number
          team_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_event_types_team_fk"
            columns: ["tenant_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "personal_event_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          granted_at: string
          granted_by: string | null
          notes: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          notes?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          notes?: string | null
          user_id?: string
        }
        Relationships: []
      }
      push_badges: {
        Row: {
          count: number
          day: string
          user_id: string
        }
        Insert: {
          count?: number
          day: string
          user_id: string
        }
        Update: {
          count?: number
          day?: string
          user_id?: string
        }
        Relationships: []
      }
      push_devices: {
        Row: {
          created_at: string
          last_seen_at: string
          locale: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_seen_at?: string
          locale?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_seen_at?: string
          locale?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      push_held: {
        Row: {
          created_at: string
          id: number
          kind: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          kind: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: number
          kind?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      push_settings: {
        Row: {
          digest_evening: boolean
          digest_morning: boolean
          quiet_end: number | null
          quiet_start: number | null
          time_zone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          digest_evening?: boolean
          digest_morning?: boolean
          quiet_end?: number | null
          quiet_start?: number | null
          time_zone?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          digest_evening?: boolean
          digest_morning?: boolean
          quiet_end?: number | null
          quiet_start?: number | null
          time_zone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string
          device_label: string | null
          endpoint: string
          id: string
          keys: Json
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_label?: string | null
          endpoint: string
          id?: string
          keys: Json
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_label?: string | null
          endpoint?: string
          id?: string
          keys?: Json
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          account_id: string | null
          amount: number
          appointment_id: string | null
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          currency: string
          id: string
          invoice_id: string | null
          issued_on: string
          lines: Json | null
          location_id: string | null
          number: string
          payment_method: string | null
          seller_snapshot: Json
          seq: number
          status: string
          team_id: string
          tenant_id: string
          transaction_id: string | null
          vat_amount: number | null
          vat_rate: number | null
          year: number
        }
        Insert: {
          account_id?: string | null
          amount: number
          appointment_id?: string | null
          client_id?: string | null
          client_requisites_id?: string | null
          client_snapshot?: Json | null
          company_id: string
          created_at?: string
          currency?: string
          id?: string
          invoice_id?: string | null
          issued_on: string
          lines?: Json | null
          location_id?: string | null
          number: string
          payment_method?: string | null
          seller_snapshot?: Json
          seq: number
          status?: string
          team_id: string
          tenant_id: string
          transaction_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
          year: number
        }
        Update: {
          account_id?: string | null
          amount?: number
          appointment_id?: string | null
          client_id?: string | null
          client_requisites_id?: string | null
          client_snapshot?: Json | null
          company_id?: string
          created_at?: string
          currency?: string
          id?: string
          invoice_id?: string | null
          issued_on?: string
          lines?: Json | null
          location_id?: string | null
          number?: string
          payment_method?: string | null
          seller_snapshot?: Json
          seq?: number
          status?: string
          team_id?: string
          tenant_id?: string
          transaction_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_legal_entity_fkey"
            columns: ["tenant_id", "company_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "receipts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_reminders: {
        Row: {
          client_id: string | null
          client_name: string
          created_at: string
          id: string
          interval_months: number
          last_date: string
          manual: boolean
          next_due_date: string
          note: string
          notify_channel: string
          phone: string
          service_ids: Json
          service_summary: string
          status: string
          team_id: string | null
          tenant_id: string
          type: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          client_name: string
          created_at?: string
          id?: string
          interval_months: number
          last_date: string
          manual?: boolean
          next_due_date: string
          note?: string
          notify_channel?: string
          phone?: string
          service_ids?: Json
          service_summary?: string
          status?: string
          team_id?: string | null
          tenant_id: string
          type?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          client_name?: string
          created_at?: string
          id?: string
          interval_months?: number
          last_date?: string
          manual?: boolean
          next_due_date?: string
          note?: string
          notify_channel?: string
          phone?: string
          service_ids?: Json
          service_summary?: string
          status?: string
          team_id?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_reminders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_reminders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_categories: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id: string
          is_active?: boolean
          name: string
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_variants: {
        Row: {
          cost: number
          created_at: string
          duration_min: number
          id: string
          name: string
          position: number
          price: number
          service_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cost?: number
          created_at?: string
          duration_min?: number
          id: string
          name: string
          position?: number
          price?: number
          service_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cost?: number
          created_at?: string
          duration_min?: number
          id?: string
          name?: string
          position?: number
          price?: number
          service_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_variants_service_fk"
            columns: ["tenant_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "service_variants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          available_weekdays: Json
          brigade_ids: Json
          buffer_after_min: number
          buffer_before_min: number
          bulk_price: number
          bulk_threshold: number
          category_id: string | null
          color: string
          copied_from_service_id: string | null
          cost_per_unit: number
          cost_tiers: Json
          created_at: string
          description: string | null
          duration_minutes: number
          duration_tiers: Json | null
          icon: string | null
          id: string
          is_active: boolean
          material_costs: Json
          max_qty: number | null
          min_qty: number
          name: string
          online_enabled: boolean
          overflow_duration_min: number | null
          overflow_price: number | null
          position: number
          price: number
          price_entry: string
          price_tiers: Json | null
          required_staff: number
          service_type: string
          team_id: string
          tenant_id: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          available_weekdays?: Json
          brigade_ids?: Json
          buffer_after_min?: number
          buffer_before_min?: number
          bulk_price?: number
          bulk_threshold?: number
          category_id?: string | null
          color?: string
          copied_from_service_id?: string | null
          cost_per_unit?: number
          cost_tiers?: Json
          created_at?: string
          description?: string | null
          duration_minutes?: number
          duration_tiers?: Json | null
          icon?: string | null
          id: string
          is_active?: boolean
          material_costs?: Json
          max_qty?: number | null
          min_qty?: number
          name: string
          online_enabled?: boolean
          overflow_duration_min?: number | null
          overflow_price?: number | null
          position?: number
          price?: number
          price_entry?: string
          price_tiers?: Json | null
          required_staff?: number
          service_type?: string
          team_id: string
          tenant_id: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          available_weekdays?: Json
          brigade_ids?: Json
          buffer_after_min?: number
          buffer_before_min?: number
          bulk_price?: number
          bulk_threshold?: number
          category_id?: string | null
          color?: string
          copied_from_service_id?: string | null
          cost_per_unit?: number
          cost_tiers?: Json
          created_at?: string
          description?: string | null
          duration_minutes?: number
          duration_tiers?: Json | null
          icon?: string | null
          id?: string
          is_active?: boolean
          material_costs?: Json
          max_qty?: number | null
          min_qty?: number
          name?: string
          online_enabled?: boolean
          overflow_duration_min?: number | null
          overflow_price?: number | null
          position?: number
          price?: number
          price_entry?: string
          price_tiers?: Json | null
          required_staff?: number
          service_type?: string
          team_id?: string
          tenant_id?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_copied_from_fk"
            columns: ["tenant_id", "copied_from_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "services_team_fk"
            columns: ["tenant_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_alerts: {
        Row: {
          created_at: string
          id: number
          kind: string
          message: string
          resolved_at: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          kind: string
          message: string
          resolved_at?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          kind?: string
          message?: string
          resolved_at?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_autotopup: {
        Row: {
          amount_cents: number
          card_label: string | null
          card_session: string | null
          day: string | null
          day_count: number
          enabled: boolean
          last_error: string | null
          last_error_at: string | null
          last_success_at: string | null
          payment_method: string | null
          pending_amount: number | null
          pending_key: string | null
          pending_since: string | null
          stripe_customer: string | null
          tenant_id: string
          threshold_cents: number
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          card_label?: string | null
          card_session?: string | null
          day?: string | null
          day_count?: number
          enabled?: boolean
          last_error?: string | null
          last_error_at?: string | null
          last_success_at?: string | null
          payment_method?: string | null
          pending_amount?: number | null
          pending_key?: string | null
          pending_since?: string | null
          stripe_customer?: string | null
          tenant_id: string
          threshold_cents?: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          card_label?: string | null
          card_session?: string | null
          day?: string | null
          day_count?: number
          enabled?: boolean
          last_error?: string | null
          last_error_at?: string | null
          last_success_at?: string | null
          payment_method?: string | null
          pending_amount?: number | null
          pending_key?: string | null
          pending_since?: string | null
          stripe_customer?: string | null
          tenant_id?: string
          threshold_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_autotopup_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_ledger: {
        Row: {
          amount_cents: number
          balance_after: number
          created_at: string
          id: number
          kind: string
          note: string | null
          ref: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          balance_after: number
          created_at?: string
          id?: never
          kind: string
          note?: string | null
          ref?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          balance_after?: number
          created_at?: string
          id?: never
          kind?: string
          note?: string | null
          ref?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_logs: {
        Row: {
          appointment_id: string | null
          body: string
          cost_cents: number
          created_at: string
          delivered_at: string | null
          error_code: string | null
          error_message: string | null
          id: string
          sender_name_used: string
          tenant_id: string
          to_phone: string
          twilio_message_sid: string | null
          twilio_status: string | null
          was_free: boolean
        }
        Insert: {
          appointment_id?: string | null
          body: string
          cost_cents?: number
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          sender_name_used: string
          tenant_id: string
          to_phone: string
          twilio_message_sid?: string | null
          twilio_status?: string | null
          was_free?: boolean
        }
        Update: {
          appointment_id?: string | null
          body?: string
          cost_cents?: number
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          sender_name_used?: string
          tenant_id?: string
          to_phone?: string
          twilio_message_sid?: string | null
          twilio_status?: string | null
          was_free?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sms_logs_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          appointment_id: string | null
          claimed_at: string | null
          client_id: string | null
          cost_cents: number
          created_at: string
          delivered_at: string | null
          error_code: string | null
          error_message: string | null
          for_start: string | null
          id: string
          known_start: string | null
          message_body: string | null
          mode: string
          segments: number | null
          send_after: string | null
          sent_by: string | null
          status: string
          team_id: string | null
          template_body: string | null
          template_id: string | null
          tenant_id: string
          to_phone: string
          trigger_type: string
          twilio_sid: string | null
          was_free: boolean
        }
        Insert: {
          appointment_id?: string | null
          claimed_at?: string | null
          client_id?: string | null
          cost_cents?: number
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          for_start?: string | null
          id?: string
          known_start?: string | null
          message_body?: string | null
          mode: string
          segments?: number | null
          send_after?: string | null
          sent_by?: string | null
          status: string
          team_id?: string | null
          template_body?: string | null
          template_id?: string | null
          tenant_id: string
          to_phone: string
          trigger_type: string
          twilio_sid?: string | null
          was_free?: boolean
        }
        Update: {
          appointment_id?: string | null
          claimed_at?: string | null
          client_id?: string | null
          cost_cents?: number
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          for_start?: string | null
          id?: string
          known_start?: string | null
          message_body?: string | null
          mode?: string
          segments?: number | null
          send_after?: string | null
          sent_by?: string | null
          status?: string
          team_id?: string | null
          template_body?: string | null
          template_id?: string | null
          tenant_id?: string
          to_phone?: string
          trigger_type?: string
          twilio_sid?: string | null
          was_free?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_team_senders: {
        Row: {
          sender_name: string
          team_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          sender_name: string
          team_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          sender_name?: string
          team_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_team_senders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_team_templates: {
        Row: {
          at_time: string | null
          body: string
          color: string | null
          created_at: string
          enabled: boolean
          hours: number | null
          icon: string | null
          id: string
          months: number | null
          name: string
          position: number
          send_from: number
          send_to: number
          team_id: string
          tenant_id: string
          trigger: string
          updated_at: string
        }
        Insert: {
          at_time?: string | null
          body: string
          color?: string | null
          created_at?: string
          enabled?: boolean
          hours?: number | null
          icon?: string | null
          id?: string
          months?: number | null
          name: string
          position?: number
          send_from?: number
          send_to?: number
          team_id: string
          tenant_id: string
          trigger?: string
          updated_at?: string
        }
        Update: {
          at_time?: string | null
          body?: string
          color?: string | null
          created_at?: string
          enabled?: boolean
          hours?: number | null
          icon?: string | null
          id?: string
          months?: number | null
          name?: string
          position?: number
          send_from?: number
          send_to?: number
          team_id?: string
          tenant_id?: string
          trigger?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_team_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_topups: {
        Row: {
          amount_cents: number
          completed_at: string | null
          created_at: string
          credits_added: number
          id: string
          pack_label: string
          status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          completed_at?: string | null
          created_at?: string
          credits_added: number
          id?: string
          pack_label: string
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          completed_at?: string | null
          created_at?: string
          credits_added?: number
          id?: string
          pack_label?: string
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_topups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_janitor_keep: {
        Row: {
          bucket_id: string
          kept_at: string
          name: string
          reason: string
        }
        Insert: {
          bucket_id: string
          kept_at?: string
          name: string
          reason: string
        }
        Update: {
          bucket_id?: string
          kept_at?: string
          name?: string
          reason?: string
        }
        Relationships: []
      }
      team_design: {
        Row: {
          client_list_off: string[] | null
          contact_ways: Json | null
          disabled_blocks: string[]
          event_order: string[] | null
          map_services: Json | null
          record_color_fallback: string | null
          record_color_palette: Json | null
          record_color_rule: string
          record_order: string[] | null
          service_every_months: number | null
          team_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_list_off?: string[] | null
          contact_ways?: Json | null
          disabled_blocks?: string[]
          event_order?: string[] | null
          map_services?: Json | null
          record_color_fallback?: string | null
          record_color_palette?: Json | null
          record_color_rule?: string
          record_order?: string[] | null
          service_every_months?: number | null
          team_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_list_off?: string[] | null
          contact_ways?: Json | null
          disabled_blocks?: string[]
          event_order?: string[] | null
          map_services?: Json | null
          record_color_fallback?: string | null
          record_color_palette?: Json | null
          record_color_rule?: string
          record_order?: string[] | null
          service_every_months?: number | null
          team_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_design_team_fk"
            columns: ["tenant_id", "team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      team_finance_settings: {
        Row: {
          created_at: string
          team_id: string
          tenant_id: string
          updated_at: string
          vat_exemption_note: string | null
          vat_mode: string | null
          vat_rate: number | null
        }
        Insert: {
          created_at?: string
          team_id: string
          tenant_id: string
          updated_at?: string
          vat_exemption_note?: string | null
          vat_mode?: string | null
          vat_rate?: number | null
        }
        Update: {
          created_at?: string
          team_id?: string
          tenant_id?: string
          updated_at?: string
          vat_exemption_note?: string | null
          vat_mode?: string | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "team_finance_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      team_notification_prefs: {
        Row: {
          budget: boolean
          client_reminder_time: string | null
          notify_cancel: boolean
          notify_change: boolean
          notify_new: boolean
          notify_payment: boolean
          record_reminder: Json | null
          team_id: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          budget?: boolean
          client_reminder_time?: string | null
          notify_cancel?: boolean
          notify_change?: boolean
          notify_new?: boolean
          notify_payment?: boolean
          record_reminder?: Json | null
          team_id: string
          tenant_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          budget?: boolean
          client_reminder_time?: string | null
          notify_cancel?: boolean
          notify_change?: boolean
          notify_new?: boolean
          notify_payment?: boolean
          record_reminder?: Json | null
          team_id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_notification_prefs_team_fk"
            columns: ["tenant_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      team_schedules: {
        Row: {
          created_at: string
          id: string
          schedule: Json
          team_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          schedule?: Json
          team_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          schedule?: Json
          team_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_schedules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          allow_overtime: boolean | null
          appointment_blocks: Json | null
          buffer_minutes: number | null
          calendar_window_end: string | null
          calendar_window_start: string | null
          cities: Json
          color: string | null
          created_at: string
          default_city: string | null
          default_scroll_time: string | null
          default_slot_minutes: number | null
          helper_ids: Json
          hide_cancelled: boolean | null
          icon: string | null
          id: string
          is_active: boolean
          lead_id: string | null
          lead_ids: Json
          legal_entity_id: string | null
          members: Json
          name: string
          payout_percentage: number
          position: number
          region: string | null
          roles: Json
          tenant_id: string
          timezone: string | null
          tint_days_by_label: boolean | null
          updated_at: string
        }
        Insert: {
          allow_overtime?: boolean | null
          appointment_blocks?: Json | null
          buffer_minutes?: number | null
          calendar_window_end?: string | null
          calendar_window_start?: string | null
          cities?: Json
          color?: string | null
          created_at?: string
          default_city?: string | null
          default_scroll_time?: string | null
          default_slot_minutes?: number | null
          helper_ids?: Json
          hide_cancelled?: boolean | null
          icon?: string | null
          id: string
          is_active?: boolean
          lead_id?: string | null
          lead_ids?: Json
          legal_entity_id?: string | null
          members?: Json
          name: string
          payout_percentage?: number
          position?: number
          region?: string | null
          roles?: Json
          tenant_id: string
          timezone?: string | null
          tint_days_by_label?: boolean | null
          updated_at?: string
        }
        Update: {
          allow_overtime?: boolean | null
          appointment_blocks?: Json | null
          buffer_minutes?: number | null
          calendar_window_end?: string | null
          calendar_window_start?: string | null
          cities?: Json
          color?: string | null
          created_at?: string
          default_city?: string | null
          default_scroll_time?: string | null
          default_slot_minutes?: number | null
          helper_ids?: Json
          hide_cancelled?: boolean | null
          icon?: string | null
          id?: string
          is_active?: boolean
          lead_id?: string | null
          lead_ids?: Json
          legal_entity_id?: string | null
          members?: Json
          name?: string
          payout_percentage?: number
          position?: number
          region?: string | null
          roles?: Json
          tenant_id?: string
          timezone?: string | null
          tint_days_by_label?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_legal_entity_fkey"
            columns: ["tenant_id", "legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "teams_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_loyalty_settings: {
        Row: {
          created_at: string
          enabled: boolean
          tenant_id: string
          tiers: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          tenant_id: string
          tiers?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          tenant_id?: string
          tiers?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_loyalty_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          access_version: number
          invited_by_user_id: string | null
          joined_at: string
          master_id: string | null
          metadata: Json
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          access_version?: number
          invited_by_user_id?: string | null
          joined_at?: string
          master_id?: string | null
          metadata?: Json
          role: string
          tenant_id: string
          user_id: string
        }
        Update: {
          access_version?: number
          invited_by_user_id?: string | null
          joined_at?: string
          master_id?: string | null
          metadata?: Json
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_master_fkey"
            columns: ["tenant_id", "master_id"]
            isOneToOne: false
            referencedRelation: "masters"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_sms_config: {
        Row: {
          balance_cents: number
          created_at: string
          enabled: boolean
          free_quota_per_month: number | null
          free_sms_remaining: number
          frozen_at: string | null
          frozen_reason: string | null
          mode: string
          quiet_from: number
          quiet_to: number
          quota_period_start: string
          remind_24h_before: boolean
          remind_2h_before: boolean
          sender_approved_at: string | null
          sender_name: string | null
          sender_rejection_reason: string | null
          sender_requested_at: string | null
          sender_status: string | null
          sent_this_month: number
          team_ids: string[]
          template_24h: string
          template_2h: string
          tenant_id: string
          total_sent_count: number
          twilio_account_sid: string | null
          twilio_auth_token: string | null
          twilio_phone_number: string | null
          updated_at: string
        }
        Insert: {
          balance_cents?: number
          created_at?: string
          enabled?: boolean
          free_quota_per_month?: number | null
          free_sms_remaining?: number
          frozen_at?: string | null
          frozen_reason?: string | null
          mode?: string
          quiet_from?: number
          quiet_to?: number
          quota_period_start?: string
          remind_24h_before?: boolean
          remind_2h_before?: boolean
          sender_approved_at?: string | null
          sender_name?: string | null
          sender_rejection_reason?: string | null
          sender_requested_at?: string | null
          sender_status?: string | null
          sent_this_month?: number
          team_ids?: string[]
          template_24h?: string
          template_2h?: string
          tenant_id: string
          total_sent_count?: number
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_phone_number?: string | null
          updated_at?: string
        }
        Update: {
          balance_cents?: number
          created_at?: string
          enabled?: boolean
          free_quota_per_month?: number | null
          free_sms_remaining?: number
          frozen_at?: string | null
          frozen_reason?: string | null
          mode?: string
          quiet_from?: number
          quiet_to?: number
          quota_period_start?: string
          remind_24h_before?: boolean
          remind_2h_before?: boolean
          sender_approved_at?: string | null
          sender_name?: string | null
          sender_rejection_reason?: string | null
          sender_requested_at?: string | null
          sender_status?: string | null
          sent_this_month?: number
          team_ids?: string[]
          template_24h?: string
          template_2h?: string
          tenant_id?: string
          total_sent_count?: number
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_phone_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_sms_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_state: {
        Row: {
          prototype_state: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          prototype_state?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          prototype_state?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          address: string | null
          bank_name: string | null
          booking_slug: string | null
          business_address: string | null
          city: string | null
          contact_email: string | null
          contact_instagram: string | null
          contact_phone: string | null
          contact_telegram: string | null
          contact_whatsapp: string | null
          country: string
          created_at: string
          currency: string
          current_period_end: string | null
          document_language: string
          iban: string | null
          id: string
          invoice_default_line_title: string
          invoice_due_days: number
          invoice_footer_note: string | null
          invoice_line_source: string
          invoice_next_number: number | null
          invoice_number_padding: number
          invoice_number_yearly_reset: boolean
          invoice_prefix: string
          legal_name: string | null
          logo_url: string | null
          name: string
          onboarded_at: string | null
          paid_calendars: number | null
          personal_calendar_enabled: boolean
          plan: string
          plan_override: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          track_units: boolean
          trial_ends_at: string | null
          trial_started_at: string | null
          trial_tier: string | null
          vat_exemption_note: string | null
          vat_mode: string
          vat_number: string | null
          vat_rate: number
          vertical: string | null
          working_team_ids: string[] | null
        }
        Insert: {
          address?: string | null
          bank_name?: string | null
          booking_slug?: string | null
          business_address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_instagram?: string | null
          contact_phone?: string | null
          contact_telegram?: string | null
          contact_whatsapp?: string | null
          country?: string
          created_at?: string
          currency?: string
          current_period_end?: string | null
          document_language?: string
          iban?: string | null
          id?: string
          invoice_default_line_title?: string
          invoice_due_days?: number
          invoice_footer_note?: string | null
          invoice_line_source?: string
          invoice_next_number?: number | null
          invoice_number_padding?: number
          invoice_number_yearly_reset?: boolean
          invoice_prefix?: string
          legal_name?: string | null
          logo_url?: string | null
          name: string
          onboarded_at?: string | null
          paid_calendars?: number | null
          personal_calendar_enabled?: boolean
          plan?: string
          plan_override?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          track_units?: boolean
          trial_ends_at?: string | null
          trial_started_at?: string | null
          trial_tier?: string | null
          vat_exemption_note?: string | null
          vat_mode?: string
          vat_number?: string | null
          vat_rate?: number
          vertical?: string | null
          working_team_ids?: string[] | null
        }
        Update: {
          address?: string | null
          bank_name?: string | null
          booking_slug?: string | null
          business_address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_instagram?: string | null
          contact_phone?: string | null
          contact_telegram?: string | null
          contact_whatsapp?: string | null
          country?: string
          created_at?: string
          currency?: string
          current_period_end?: string | null
          document_language?: string
          iban?: string | null
          id?: string
          invoice_default_line_title?: string
          invoice_due_days?: number
          invoice_footer_note?: string | null
          invoice_line_source?: string
          invoice_next_number?: number | null
          invoice_number_padding?: number
          invoice_number_yearly_reset?: boolean
          invoice_prefix?: string
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          onboarded_at?: string | null
          paid_calendars?: number | null
          personal_calendar_enabled?: boolean
          plan?: string
          plan_override?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          track_units?: boolean
          trial_ends_at?: string | null
          trial_started_at?: string | null
          trial_tier?: string | null
          vat_exemption_note?: string | null
          vat_mode?: string
          vat_number?: string | null
          vat_rate?: number
          vertical?: string | null
          working_team_ids?: string[] | null
        }
        Relationships: []
      }
      user_calendar_order: {
        Row: {
          calendars: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          calendars?: string[]
          updated_at?: string
          user_id?: string
        }
        Update: {
          calendars?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_hidden_calendars: {
        Row: {
          created_at: string
          team_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          team_id: string
          tenant_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          team_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_hidden_calendars_tenant_id_team_id_fkey"
            columns: ["tenant_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string
          enabled: boolean
          events: Json
          failure_count: number
          id: string
          label: string
          last_fired_at: string | null
          last_status: number | null
          secret: string
          tenant_id: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          events?: Json
          failure_count?: number
          id?: string
          label: string
          last_fired_at?: string | null
          last_status?: number | null
          secret?: string
          tenant_id: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          events?: Json
          failure_count?: number
          id?: string
          label?: string
          last_fired_at?: string | null
          last_status?: number | null
          secret?: string
          tenant_id?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _assert_account_not_hidden: {
        Args: { p_account_id: string; p_tenant_id: string }
        Returns: undefined
      }
      _assert_invoice_wait_account: {
        Args: {
          p_account_id: string
          p_check_hidden: boolean
          p_team_id: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      _dispatch_push: {
        Args: { p_data: Json; p_event_type: string; p_recipients: string[] }
        Returns: undefined
      }
      _documents_write_invoice: {
        Args: { p_invoice_id: string }
        Returns: boolean
      }
      _documents_write_receipt: {
        Args: { p_receipt_id: string }
        Returns: boolean
      }
      _documents_write_team: { Args: { p_team: string }; Returns: boolean }
      _issue_credit_note: {
        Args: { p_invoice_id: string; p_reason?: string }
        Returns: string
      }
      _issue_receipt_core: {
        Args: {
          p_client_requisites_id?: string
          p_company_id?: string
          p_issued_on?: string
          p_lines?: Json
          p_location_id?: string
          p_tx: Database["public"]["Tables"]["finance_transactions"]["Row"]
        }
        Returns: {
          account_id: string | null
          amount: number
          appointment_id: string | null
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          currency: string
          id: string
          invoice_id: string | null
          issued_on: string
          lines: Json | null
          location_id: string | null
          number: string
          payment_method: string | null
          seller_snapshot: Json
          seq: number
          status: string
          team_id: string
          tenant_id: string
          transaction_id: string | null
          vat_amount: number | null
          vat_rate: number | null
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "receipts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _issue_receipt_credit_note: {
        Args: {
          p_amount: number
          p_language: string
          p_reason: string
          p_receipt_id: string
        }
        Returns: {
          account_id: string | null
          appointment_id: string | null
          brigade_id: string
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          created_by: string | null
          credit_note_of_id: string | null
          credit_note_of_receipt_id: string | null
          credit_partial: boolean
          credited_amount: number
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          kind: string
          language: string
          location_id: string | null
          notes: string | null
          number: string
          payment_id: string | null
          pdf_url: string | null
          seller_snapshot: Json
          seq: number
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_mode: string | null
          vat_percent: number
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _js_number: { Args: { p: Json }; Returns: number }
      _receipt_client_snapshot: {
        Args: {
          p_client_id: string
          p_client_requisites_id: string
          p_location_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      _receipt_lines_snapshot: { Args: { p_lines: Json }; Returns: Json }
      _receipt_num: { Args: { p_value: string }; Returns: number }
      _receipt_tx_allowed: {
        Args: {
          p_tx: Database["public"]["Tables"]["finance_transactions"]["Row"]
        }
        Returns: boolean
      }
      _refund_invoice_money: {
        Args: {
          p_amount: number
          p_invoice: Database["public"]["Tables"]["invoices"]["Row"]
          p_note: string
          p_on: string
          p_payment_id?: string
        }
        Returns: undefined
      }
      accept_invitation: { Args: { p_token: string }; Returns: string }
      accept_invitation_by_id: {
        Args: { p_invitation_id: string }
        Returns: string
      }
      access_accounts_for: {
        Args: { p_block: string; p_min: string }
        Returns: string[]
      }
      access_accounts_totals: { Args: never; Returns: string[] }
      access_apply_changes: {
        Args: {
          p_changes: Json
          p_set_by: string
          p_tenant: string
          p_user: string
        }
        Returns: undefined
      }
      access_block_client_ids: {
        Args: { p_block: string; p_min: string }
        Returns: string[]
      }
      access_calendars: {
        Args: { p_block: string; p_min: string }
        Returns: string[]
      }
      access_calendars_of: {
        Args: {
          p_block: string
          p_min: string
          p_tenant: string
          p_user: string
        }
        Returns: string[]
      }
      access_client_blocks: {
        Args: never
        Returns: {
          blocks: Json
          client_id: string
        }[]
      }
      access_client_ids: { Args: never; Returns: string[] }
      access_client_ids_in: { Args: { p_teams: string[] }; Returns: string[] }
      access_company: {
        Args: { p_block: string; p_min: string }
        Returns: boolean
      }
      access_company_level: { Args: { p_block: string }; Returns: string }
      access_contact_client_ids: { Args: never; Returns: string[] }
      access_map_for: {
        Args: { p_include_off: boolean; p_tenant_id: string; p_user_id: string }
        Returns: Json
      }
      access_records_level: {
        Args: { p_team: string; p_tenant: string; p_user: string }
        Returns: string
      }
      access_team_level: {
        Args: {
          p_block: string
          p_team: string
          p_tenant: string
          p_user: string
        }
        Returns: string
      }
      access_validate_changes: {
        Args: { p_changes: Json; p_team_ids: string[]; p_tenant: string }
        Returns: undefined
      }
      access_writer_target: { Args: { p_user_id: string }; Returns: string }
      account_balances: {
        Args: { p_tenant: string }
        Returns: {
          account_id: string
          delta: number
          first_tx_on: string
          has_history: boolean
          is_active: boolean
          last_outflow_on: string
          last_tx_on: string
        }[]
      }
      account_has_history: { Args: { p_account_id: string }; Returns: boolean }
      account_period_totals: {
        Args: { p_from: string; p_tenant: string; p_to: string }
        Returns: {
          account_id: string
          expense: number
          income: number
          net: number
          opening_before: number
          refund: number
          transfer_in: number
          transfer_out: number
        }[]
      }
      account_serves_team: {
        Args: { p_account_id: string; p_team_id: string }
        Returns: boolean
      }
      activate_tenant: { Args: { p_tenant_id: string }; Returns: Json }
      add_platform_admin: { Args: { p_email: string }; Returns: undefined }
      admin_billing_history: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      admin_dashboard_summary: { Args: never; Returns: Json }
      admin_pending_senders: { Args: never; Returns: Json }
      admin_resolve_tenant_owner_email: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      admin_stats_summary: { Args: { p_days?: number }; Returns: Json }
      admin_tenant_detail: { Args: { p_tenant_id: string }; Returns: Json }
      admin_tenants_list: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_plan_filter?: string
          p_search?: string
        }
        Returns: Json
      }
      apply_location_label_changes: {
        Args: { p_labels: Json; p_remove_ids?: Json }
        Returns: {
          color: string | null
          created_at: string
          created_by: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          position: number
          team_id: string
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "location_labels"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      apply_team_location_label_changes: {
        Args: { p_labels: Json; p_remove_ids?: Json; p_team_id: string }
        Returns: {
          color: string | null
          created_at: string
          created_by: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          position: number
          team_id: string
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "location_labels"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      appointment_history_entry_date: {
        Args: { p_appointment_id: string }
        Returns: string
      }
      appointment_link_answer: {
        Args: { p_answer: string; p_token: string }
        Returns: Json
      }
      appointment_link_lookup: { Args: { p_token: string }; Returns: Json }
      appointment_link_token: { Args: never; Returns: string }
      appointment_link_url: { Args: { p_appointment: string }; Returns: string }
      appointment_material_lines: {
        Args: { p_service_ids: Json; p_services: Json; p_tenant: string }
        Returns: Json
      }
      appointment_money_outside_invoices: {
        Args: { p_appointment: string }
        Returns: number
      }
      appointment_payment_mirror: { Args: { p_payments: Json }; Returns: Json }
      assert_document_date: {
        Args: {
          p_company: string
          p_date: string
          p_doc_type: string
          p_tenant: string
        }
        Returns: undefined
      }
      assert_invoice_account: {
        Args: { p_account_id: string; p_tenant_id: string }
        Returns: undefined
      }
      attach_invited_master_card: {
        Args: {
          p_invitation: Database["public"]["Tables"]["invitations"]["Row"]
          p_user_id: string
        }
        Returns: string
      }
      build_invoice_client_snapshot: {
        Args: { p_client_id: string; p_tenant_id: string }
        Returns: Json
      }
      build_invoice_client_snapshot_for: {
        Args: {
          p_client_id: string
          p_requisites_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      build_invoice_client_snapshot_with_object: {
        Args: {
          p_client_id: string
          p_location_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      build_invoice_seller_snapshot: {
        Args: { p_tenant_id: string }
        Returns: Json
      }
      build_seller_snapshot: {
        Args: { p_company_id: string; p_tenant_id: string }
        Returns: Json
      }
      bulk_edit_clients: { Args: { p_edits: Json }; Returns: Json }
      bump_sms_balance: {
        Args: { p_amount_cents: number; p_tenant_id: string }
        Returns: Json
      }
      cabinet_tariff_payments: { Args: { p_limit?: number }; Returns: Json }
      calendar_delete_in_progress: { Args: never; Returns: boolean }
      calendar_feed_events: {
        Args: { p_token: string }
        Returns: {
          address: string
          comment: string
          date: string
          id: string
          status: string
          time_end: string
          time_start: string
        }[]
      }
      can_watch_calendar: { Args: { p_topic: string }; Returns: boolean }
      cancel_appointment_payment: {
        Args: {
          p_appointment_id: string
          p_payment_id: string
          p_request_id: string
        }
        Returns: {
          address: string
          address_lat: number | null
          address_lng: number | null
          address_note: string
          cancel_reason: string | null
          city: string | null
          client_id: string | null
          color_override: string | null
          comment: string
          consent_given: boolean
          created_at: string
          created_by: string | null
          custom_total: boolean
          date: string
          discount_amount: number
          event_all_day: boolean
          event_notes: string
          event_push_at: string | null
          event_push_enabled: boolean
          event_push_offsets: Json
          event_repeat: Json
          event_url: string
          expenses: Json
          global_discount: Json | null
          id: string
          is_online_booking: boolean
          kind: string
          location_id: string | null
          master_id: string | null
          material_lines: Json | null
          paid_amount: number
          payment: Json | null
          payment_account_id: string | null
          payment_method: string | null
          payment_status: string
          payments: Json
          prepaid_amount: number
          prepayments: Json
          reminder_enabled: boolean
          reminder_offsets: Json
          reminder_template: string
          service_ids: Json
          service_price_overrides: Json
          services: Json
          source: string | null
          status: string
          team_id: string | null
          tenant_id: string
          time_end: string
          time_start: string
          total_amount: number
          total_duration: number
          updated_at: string
          vat_mode: string | null
          vat_rate: number | null
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_invoice: {
        Args: { p_invoice_id: string; p_reason?: string }
        Returns: {
          account_id: string | null
          appointment_id: string | null
          brigade_id: string
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          created_by: string | null
          credit_note_of_id: string | null
          credit_note_of_receipt_id: string | null
          credit_partial: boolean
          credited_amount: number
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          kind: string
          language: string
          location_id: string | null
          notes: string | null
          number: string
          payment_id: string | null
          pdf_url: string | null
          seller_snapshot: Json
          seq: number
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_mode: string | null
          vat_percent: number
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      catalog_unit_price: {
        Args: {
          p_bulk_price: number
          p_bulk_threshold: number
          p_price: number
          p_qty: number
          p_tiers: Json
        }
        Returns: number
      }
      change_log_array_diff: {
        Args: { p_new: Json; p_old: Json }
        Returns: Json
      }
      change_log_item_label: { Args: { p_item: Json }; Returns: string }
      change_log_partner_view: {
        Args: {
          p_changes: Json
          p_entity: string
          p_label: string
          p_meta: Json
          p_open: Json
        }
        Returns: Json
      }
      change_log_person_name: {
        Args: { p_tenant: string; p_user: string }
        Returns: string
      }
      choose_working_teams: {
        Args: { p_team_ids: string[] }
        Returns: string[]
      }
      claim_account_deletion_cleanup: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          deleted_tenant_count: number
          lease_token: string
          status: string
          user_id: string
        }[]
      }
      claim_invitation_email: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      client_attachment_owner: { Args: { p_name: string }; Returns: string }
      client_clock_skew: { Args: { p_sent_at: string }; Returns: string }
      client_contacts_of: { Args: { p_client: Json }; Returns: Json }
      client_has_history: {
        Args: { p_client: string; p_with_trash?: boolean }
        Returns: boolean
      }
      client_masked_for_member: {
        Args: { p_blocks: Json; p_client: Json }
        Returns: Json
      }
      client_seen_by_caller: { Args: { p_client: Json }; Returns: Json }
      client_without_contacts: { Args: { p_client: Json }; Returns: Json }
      client_without_money: { Args: { p_client: Json }; Returns: Json }
      create_client_with_tags: {
        Args: {
          p_client: Json
          p_client_id: string
          p_tag_ids?: string[]
          p_tenant_id: string
        }
        Returns: Json
      }
      create_first_calendar: {
        Args: { p_color?: string; p_id: string; p_name: string }
        Returns: {
          allow_overtime: boolean | null
          appointment_blocks: Json | null
          buffer_minutes: number | null
          calendar_window_end: string | null
          calendar_window_start: string | null
          cities: Json
          color: string | null
          created_at: string
          default_city: string | null
          default_scroll_time: string | null
          default_slot_minutes: number | null
          helper_ids: Json
          hide_cancelled: boolean | null
          icon: string | null
          id: string
          is_active: boolean
          lead_id: string | null
          lead_ids: Json
          legal_entity_id: string | null
          members: Json
          name: string
          payout_percentage: number
          position: number
          region: string | null
          roles: Json
          tenant_id: string
          timezone: string | null
          tint_days_by_label: boolean | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "teams"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_invitation: {
        Args: {
          p_access?: Json
          p_email: string
          p_full_name?: string
          p_master_color?: string
          p_master_id?: string
          p_master_title?: string
          p_phone?: string
          p_role: string
          p_team_id?: string
          p_team_ids?: string[]
        }
        Returns: Json
      }
      current_tenant_id: { Args: never; Returns: string }
      current_tenant_profile_safe: { Args: never; Returns: Json }
      current_user_calendar_ids: {
        Args: { p_grant?: string }
        Returns: string[]
      }
      current_user_can_access_appointment: {
        Args: { p_appointment_id: string }
        Returns: boolean
      }
      current_user_can_access_client: {
        Args: { p_client_id: string }
        Returns: boolean
      }
      current_user_can_access_client_tag: {
        Args: { p_tag_id: string }
        Returns: boolean
      }
      current_user_can_add_record_attachment: {
        Args: {
          p_appointment_id: string
          p_client_id: string
          p_id: string
          p_storage_path: string
        }
        Returns: boolean
      }
      current_user_can_delete_appointment_blob: {
        Args: { p_appointment_id: string }
        Returns: boolean
      }
      current_user_can_drop_record_attachment_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      current_user_can_edit_client: {
        Args: { p_client_id: string }
        Returns: boolean
      }
      current_user_can_edit_work_appointment: {
        Args: { p_team_id: string }
        Returns: boolean
      }
      current_user_can_mutate_appointment_photo: {
        Args: { p_appointment_id: string }
        Returns: boolean
      }
      current_user_can_pay_appointment: {
        Args: { p_master_id: string; p_team_id: string }
        Returns: boolean
      }
      current_user_can_reach_record_attachment_object: {
        Args: { p_name: string; p_write: boolean }
        Returns: boolean
      }
      current_user_can_see_appointment_blob: {
        Args: { p_appointment_id: string }
        Returns: boolean
      }
      current_user_can_see_appointment_files: {
        Args: { p_appointment_id: string }
        Returns: boolean
      }
      current_user_erased_appointment_blob: {
        Args: { p_appointment_id: string }
        Returns: boolean
      }
      current_user_has_calendar_grants: { Args: never; Returns: boolean }
      current_user_master_id: { Args: never; Returns: string }
      current_user_role: { Args: never; Returns: string }
      current_user_team_ids: { Args: never; Returns: string[] }
      decline_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      delete_account_transfer: {
        Args: { p_transfer_group_id: string }
        Returns: boolean
      }
      delete_appointment: { Args: { p_id: string }; Returns: string }
      delete_calendar: { Args: { p_team_id: string }; Returns: Json }
      delete_credit_note: { Args: { p_note_id: string }; Returns: undefined }
      delete_invoice: { Args: { p_invoice_id: string }; Returns: undefined }
      delete_operation: { Args: { p_id: string }; Returns: string }
      delete_receipt: { Args: { p_receipt_id: string }; Returns: undefined }
      delete_sole_owned_tenants_for_account: {
        Args: { p_user_id: string }
        Returns: number
      }
      deleted_appointment_for_restore: {
        Args: { p_id: string }
        Returns: {
          appointment: Json
          created_by: string | null
          deleted_at: string
          deleted_by: string | null
          dependents: Json
          id: string
          kind: string
          purge_at: string
          team_id: string
          tenant_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "deleted_appointments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      deleted_appointment_member_view: {
        Args: {
          p_appointment: Database["public"]["Tables"]["appointments"]["Row"]
        }
        Returns: Json
      }
      deleted_appointment_ready: {
        Args: { p_appointment: Json }
        Returns: Json
      }
      deleted_appointment_snapshot_open: {
        Args: { d: Database["public"]["Tables"]["deleted_appointments"]["Row"] }
        Returns: boolean
      }
      deleted_appointment_visible: {
        Args: { d: Database["public"]["Tables"]["deleted_appointments"]["Row"] }
        Returns: boolean
      }
      deleted_operation_ready: { Args: { p_operation: Json }; Returns: Json }
      document_prefix: {
        Args: {
          p_doc_type: string
          p_entity: Database["public"]["Tables"]["legal_entities"]["Row"]
        }
        Returns: string
      }
      document_series_max_seq: {
        Args: {
          p_doc_type: string
          p_legal_entity_id: string
          p_tenant_id: string
          p_year: number
        }
        Returns: number
      }
      effective_vat_settings: {
        Args: { p_team_id: string }
        Returns: {
          vat_exemption_note: string
          vat_mode: string
          vat_rate: number
        }[]
      }
      ensure_personal_space: { Args: { p_user: string }; Returns: string }
      format_document_number: {
        Args: {
          p_padding: number
          p_prefix: string
          p_seq: number
          p_year: number
        }
        Returns: string
      }
      grant_invitation_calendar: {
        Args: {
          p_invitation: Database["public"]["Tables"]["invitations"]["Row"]
          p_user_id: string
        }
        Returns: undefined
      }
      hidden_account_ids: { Args: never; Returns: string[] }
      import_schedule: {
        Args: {
          p_calendar_settings?: Json
          p_day_cities?: Json
          p_day_extras?: Json
          p_schedules?: Json
        }
        Returns: undefined
      }
      inbox_invitation_token: {
        Args: { p_invitation_id: string }
        Returns: string
      }
      invitation_inviter_live: {
        Args: { p_tenant: string; p_user: string }
        Returns: boolean
      }
      invitation_preview: { Args: { p_token: string }; Returns: Json }
      invitations_drop_by_inviter: {
        Args: { p_tenant: string; p_user: string }
        Returns: undefined
      }
      invoice_appointment_credit: {
        Args: { p_invoice: string }
        Returns: number
      }
      invoice_object_snapshot: {
        Args: {
          p_client_id: string
          p_location_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      is_platform_admin: { Args: never; Returns: boolean }
      issue_calendar_feed: { Args: never; Returns: Json }
      issue_invoice: {
        Args: {
          p_account_id?: string
          p_appointment_id: string
          p_brigade_id: string
          p_client_id: string
          p_client_requisites_id?: string
          p_company_id?: string
          p_due_on: string
          p_issued_on: string
          p_lines: Json
          p_link_to_tx_id: string
          p_location_id?: string
          p_notes: string
          p_request_id: string
          p_vat_mode: string
          p_vat_percent: number
        }
        Returns: {
          account_id: string | null
          appointment_id: string | null
          brigade_id: string
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          created_by: string | null
          credit_note_of_id: string | null
          credit_note_of_receipt_id: string | null
          credit_partial: boolean
          credited_amount: number
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          kind: string
          language: string
          location_id: string | null
          notes: string | null
          number: string
          payment_id: string | null
          pdf_url: string | null
          seller_snapshot: Json
          seq: number
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_mode: string | null
          vat_percent: number
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_partial_credit_note: {
        Args: {
          p_amount: number
          p_invoice_id: string
          p_language?: string
          p_payment_id?: string
          p_reason?: string
          p_request_id: string
        }
        Returns: {
          account_id: string | null
          appointment_id: string | null
          brigade_id: string
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          created_by: string | null
          credit_note_of_id: string | null
          credit_note_of_receipt_id: string | null
          credit_partial: boolean
          credited_amount: number
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          kind: string
          language: string
          location_id: string | null
          notes: string | null
          number: string
          payment_id: string | null
          pdf_url: string | null
          seller_snapshot: Json
          seq: number
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_mode: string | null
          vat_percent: number
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_receipt: {
        Args: {
          p_client_requisites_id?: string
          p_company_id?: string
          p_issued_on?: string
          p_lines?: Json
          p_location_id?: string
          p_transaction_id: string
        }
        Returns: {
          account_id: string | null
          amount: number
          appointment_id: string | null
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          currency: string
          id: string
          invoice_id: string | null
          issued_on: string
          lines: Json | null
          location_id: string | null
          number: string
          payment_method: string | null
          seller_snapshot: Json
          seq: number
          status: string
          team_id: string
          tenant_id: string
          transaction_id: string | null
          vat_amount: number | null
          vat_rate: number | null
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "receipts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      issue_receipt_credit_note: {
        Args: { p_language?: string; p_reason?: string; p_receipt_id: string }
        Returns: {
          account_id: string | null
          appointment_id: string | null
          brigade_id: string
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          created_by: string | null
          credit_note_of_id: string | null
          credit_note_of_receipt_id: string | null
          credit_partial: boolean
          credited_amount: number
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          kind: string
          language: string
          location_id: string | null
          notes: string | null
          number: string
          payment_id: string | null
          pdf_url: string | null
          seller_snapshot: Json
          seq: number
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_mode: string | null
          vat_percent: number
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_calendar: {
        Args: { p_team_id: string; p_tenant_id: string }
        Returns: Json
      }
      legal_entity_of_team: {
        Args: { p_team_id: string; p_tenant_id: string }
        Returns: string
      }
      list_change_log: {
        Args: {
          p_actor?: string
          p_before?: number
          p_from?: string
          p_limit?: number
          p_to?: string
        }
        Returns: {
          action: string
          actor_id: string
          actor_name: string
          changes: Json
          created_at: string
          entity: string
          entity_id: string
          id: number
          label: string
          meta: Json
          team_id: string
        }[]
      }
      list_client_members: { Args: { p_group_id: string }; Returns: Json[] }
      list_deleted_appointments: {
        Args: { p_team_id?: string }
        Returns: Json[]
      }
      list_dispatcher_services_safe: { Args: never; Returns: Json[] }
      list_master_appointments_safe: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json[]
      }
      list_master_clients_safe: {
        Args: { p_client_id?: string }
        Returns: Json[]
      }
      list_master_services_safe: { Args: never; Returns: Json[] }
      list_member_access: { Args: { p_user_id: string }; Returns: Json }
      list_member_clients: { Args: { p_client_id?: string }; Returns: Json[] }
      list_member_clients_rows: {
        Args: { p_client_id?: string }
        Returns: Json[]
      }
      list_members: { Args: { p_team_id?: string }; Returns: Json }
      list_my_calendars: {
        Args: never
        Returns: {
          grants: string[]
          is_active: boolean
          onboarded: boolean
          role: string
          team_color: string
          team_id: string
          team_name: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      list_operational_masters_safe: { Args: never; Returns: Json[] }
      list_operational_teams_safe: { Args: never; Returns: Json[] }
      list_payment_accounts_safe: {
        Args: { p_team_id: string }
        Returns: Json[]
      }
      location_request_coord: { Args: { p: number }; Returns: string }
      location_request_create: {
        Args: { p_client_id: string }
        Returns: string
      }
      location_request_lookup: { Args: { p_token: string }; Returns: Json }
      location_request_submit: {
        Args: { p_payload: Json; p_token: string }
        Returns: Json
      }
      lookup_rating_token: {
        Args: { p_token: string }
        Returns: {
          appointment_id: string
          brand_name: string
          expires_at: string
          master_id: string
          tenant_id: string
          token: string
          used_at: string
        }[]
      }
      member_appointment_copy: {
        Args: {
          p_date: string
          p_id?: string
          p_source: string
          p_time_end: string
          p_time_start: string
        }
        Returns: Json
      }
      member_appointment_create: { Args: { p_row: Json }; Returns: Json }
      member_appointment_delete: {
        Args: { p_appointment_id: string }
        Returns: undefined
      }
      member_appointment_restore: { Args: { p_id: string }; Returns: string }
      member_appointment_update: {
        Args: { p_appointment_id: string; p_patch: Json }
        Returns: Json
      }
      member_can: {
        Args: { p_block: string; p_min: string; p_team: string }
        Returns: boolean
      }
      member_catalog_priced: {
        Args: { p_rest: Json; p_team: string }
        Returns: Json
      }
      member_check_appointment_field: {
        Args: {
          p_created_by: string
          p_key: string
          p_kind: string
          p_old_status: string
          p_team: string
          p_value: Json
        }
        Returns: undefined
      }
      member_client_bookable: { Args: { p_client: string }; Returns: boolean }
      member_client_contacts: { Args: { p_client: string }; Returns: Json }
      member_client_history: { Args: { p_client?: string }; Returns: Json[] }
      member_client_in_team: {
        Args: { p_client: string; p_team: string }
        Returns: boolean
      }
      member_day_money_window_starts: { Args: never; Returns: Json }
      member_finance_window_starts: { Args: never; Returns: Json }
      member_find_client_by_phone: {
        Args: { p_phone_e164: string; p_team: string }
        Returns: Json
      }
      member_record_hidden: {
        Args: { p_date: string; p_kind: string; p_team: string }
        Returns: boolean
      }
      member_record_window_start: { Args: { p_team: string }; Returns: string }
      member_record_window_starts: { Args: never; Returns: Json }
      member_rename_day_label: {
        Args: { p_from: string; p_team: string; p_to: string }
        Returns: number
      }
      member_sees_calendar: { Args: { p_team: string }; Returns: boolean }
      member_trash_client: { Args: { p_client_id: string }; Returns: undefined }
      member_update_team: {
        Args: { p_patch: Json; p_team: string }
        Returns: Json
      }
      merge_clients: {
        Args: {
          p_duplicate: string
          p_location_remap?: Json
          p_patch?: Json
          p_primary: string
          p_tag_ids?: string[]
        }
        Returns: Json
      }
      my_access_map: { Args: never; Returns: Json }
      my_calendar_feed: { Args: never; Returns: Json }
      my_invitations: { Args: never; Returns: Json }
      my_onboarding: { Args: never; Returns: string[] }
      next_document_number: {
        Args: {
          p_doc_type: string
          p_legal_entity_id: string
          p_tenant_id: string
          p_year: number
        }
        Returns: {
          number: string
          seq: number
        }[]
      }
      normalize_client_requisites: { Args: { p_sets: Json }; Returns: Json }
      normalize_client_tag_ids: {
        Args: { p_tag_ids: string[]; p_tenant_id: string }
        Returns: string[]
      }
      onboarding_done: { Args: { p_chapter: string }; Returns: string[] }
      online_booking_create: {
        Args: {
          p_date: string
          p_name: string
          p_phone: string
          p_service: string
          p_time: string
          p_token: string
        }
        Returns: Json
      }
      online_booking_day_slots: {
        Args: {
          p_date: string
          p_duration: number
          p_team: string
          p_tenant: string
        }
        Returns: string[]
      }
      online_booking_hm: { Args: { p_value: string }; Returns: number }
      online_booking_new_link: { Args: { p_team: string }; Returns: Json }
      online_booking_owner_tenant: { Args: { p_team: string }; Returns: string }
      online_booking_page: { Args: { p_token: string }; Returns: Json }
      online_booking_resolve: {
        Args: { p_token: string }
        Returns: {
          business_name: string
          calendar_name: string
          country: string
          logo_url: string
          state: string
          team_id: string
          tenant_id: string
          tz: string
        }[]
      }
      online_booking_services: {
        Args: { p_team: string; p_tenant: string }
        Returns: Json
      }
      online_booking_set: {
        Args: { p_enabled: boolean; p_team: string }
        Returns: Json
      }
      online_booking_set_service: {
        Args: { p_online: boolean; p_service: string; p_team: string }
        Returns: Json
      }
      online_booking_settings: { Args: { p_team: string }; Returns: Json }
      online_booking_slots: {
        Args: { p_service: string; p_token: string }
        Returns: Json
      }
      paid_calendar_count: { Args: { p_tenant: string }; Returns: number }
      partners_card_manageable: {
        Args: { p_master_id: string }
        Returns: boolean
      }
      partners_check_caps: {
        Args: { p_changes: Json; p_tenant: string; p_user: string }
        Returns: undefined
      }
      partners_check_teams: {
        Args: { p_stored: string[]; p_wanted: string[] }
        Returns: undefined
      }
      partners_manageable: { Args: { p_user: string }; Returns: boolean }
      partners_removable: { Args: { p_user: string }; Returns: boolean }
      patch_master_profile: {
        Args: { p_master_id: string; p_patch: Json }
        Returns: Json
      }
      peek_document_number: {
        Args: { p_doc_type: string; p_legal_entity_id: string; p_year: number }
        Returns: {
          can_set_start: boolean
          number: string
          seq: number
        }[]
      }
      personal_calendar_name: { Args: { p_locale: string }; Returns: string }
      phone_to_e164: {
        Args: { p_country: string; p_phone: string }
        Returns: string
      }
      purge_deleted_appointments: { Args: never; Returns: number }
      purge_deleted_cities: { Args: never; Returns: number }
      purge_deleted_operations: { Args: never; Returns: number }
      purge_expired_accounts: { Args: never; Returns: number }
      purge_expired_clients: { Args: never; Returns: number }
      purge_unconfirmed_signups: { Args: never; Returns: number }
      push_activity_targets: {
        Args: { p_log: Database["public"]["Tables"]["change_log"]["Row"] }
        Returns: {
          kind: string
          pref_team: string
          show_client: boolean
          user_id: string
        }[]
      }
      push_badge_bump: {
        Args: { p_by: number; p_day: string; p_user: string }
        Returns: number
      }
      push_digest_dispatch: { Args: { p_now?: string }; Returns: number }
      push_in_quiet: {
        Args: { p_now?: string; p_user: string }
        Returns: boolean
      }
      push_local_now: {
        Args: { p_now?: string; p_tz: string }
        Returns: string
      }
      push_quiet_flush: { Args: { p_now?: string }; Returns: number }
      read_operational_calendar_settings_safe: {
        Args: never
        Returns: {
          allow_overtime: boolean
          booking_block_order: string[]
          buffer_minutes: number
          disabled_features: string[]
          end_hour: number
          end_minute: number
          grid_step: number
          hide_cancelled: boolean
          record_color_fallback: string
          record_color_palette: Json
          record_color_rule: string
          scroll_open_hour: number
          show_day_finance: boolean
          start_hour: number
          start_minute: number
          timezone: string
          week_start: string
          work_end_hour: number
          work_start_hour: number
        }[]
      }
      read_tenant_sms_config_safe: {
        Args: never
        Returns: {
          created_at: string
          enabled: boolean
          free_quota_per_month: number
          mode: string
          quota_period_start: string
          remind_24h_before: boolean
          remind_2h_before: boolean
          sent_this_month: number
          template_24h: string
          template_2h: string
          tenant_id: string
          twilio_account_sid: string
          twilio_auth_token_configured: boolean
          twilio_phone_number: string
          updated_at: string
        }[]
      }
      reconcile_appointment_finance: {
        Args: {
          p_appointment_id: string
          p_is_insert?: boolean
          p_old_paid: number
          p_old_payment_status: string
          p_old_prepaid: number
          p_old_status: string
          p_old_total: number
        }
        Returns: undefined
      }
      record_account_transfer: {
        Args: {
          p_amount: number
          p_from_account_id: string
          p_notes?: string
          p_occurred_on?: string
          p_request_id: string
          p_to_account_id: string
        }
        Returns: {
          account_id: string | null
          amount: number
          appointment_id: string | null
          appointment_payment_id: string | null
          appointment_payment_kind: string | null
          category_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          debt_id: string | null
          from_calendar: boolean
          id: string
          invoice_id: string | null
          master_id: string | null
          notes: string | null
          occurred_on: string
          occurred_time: string | null
          payment_method: string | null
          receipt_url: string | null
          refund_of_id: string | null
          reversal_kind: string | null
          source: string
          team_id: string
          tenant_id: string
          transfer_group_id: string | null
          type: string
          updated_at: string
          vat_amount: number | null
          vat_mode: string | null
          vat_rate: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "finance_transactions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_appointment_payment: {
        Args: {
          p_account_id: string
          p_amount: number
          p_appointment_id: string
          p_close_visit?: boolean
          p_kind?: string
          p_paid_at?: string
          p_request_id: string
          p_sent_at?: string
        }
        Returns: {
          address: string
          address_lat: number | null
          address_lng: number | null
          address_note: string
          cancel_reason: string | null
          city: string | null
          client_id: string | null
          color_override: string | null
          comment: string
          consent_given: boolean
          created_at: string
          created_by: string | null
          custom_total: boolean
          date: string
          discount_amount: number
          event_all_day: boolean
          event_notes: string
          event_push_at: string | null
          event_push_enabled: boolean
          event_push_offsets: Json
          event_repeat: Json
          event_url: string
          expenses: Json
          global_discount: Json | null
          id: string
          is_online_booking: boolean
          kind: string
          location_id: string | null
          master_id: string | null
          material_lines: Json | null
          paid_amount: number
          payment: Json | null
          payment_account_id: string | null
          payment_method: string | null
          payment_status: string
          payments: Json
          prepaid_amount: number
          prepayments: Json
          reminder_enabled: boolean
          reminder_offsets: Json
          reminder_template: string
          service_ids: Json
          service_price_overrides: Json
          services: Json
          source: string | null
          status: string
          team_id: string | null
          tenant_id: string
          time_end: string
          time_start: string
          total_amount: number
          total_duration: number
          updated_at: string
          vat_mode: string | null
          vat_rate: number | null
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_invoice_payment: {
        Args: {
          p_account_id: string
          p_amount: number
          p_invoice_id: string
          p_notes?: string
          p_occurred_on?: string
          p_payment_method: string
          p_request_id: string
        }
        Returns: {
          account_id: string | null
          amount: number
          appointment_id: string | null
          appointment_payment_id: string | null
          appointment_payment_kind: string | null
          category_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          debt_id: string | null
          from_calendar: boolean
          id: string
          invoice_id: string | null
          master_id: string | null
          notes: string | null
          occurred_on: string
          occurred_time: string | null
          payment_method: string | null
          receipt_url: string | null
          refund_of_id: string | null
          reversal_kind: string | null
          source: string
          team_id: string
          tenant_id: string
          transfer_group_id: string | null
          type: string
          updated_at: string
          vat_amount: number | null
          vat_mode: string | null
          vat_rate: number | null
        }
        SetofOptions: {
          from: "*"
          to: "finance_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refresh_invoice_status: {
        Args: { p_invoice: string }
        Returns: undefined
      }
      refund_appointment_overpayment: {
        Args: {
          p_amount: number
          p_appointment_id: string
          p_request_id: string
        }
        Returns: {
          address: string
          address_lat: number | null
          address_lng: number | null
          address_note: string
          cancel_reason: string | null
          city: string | null
          client_id: string | null
          color_override: string | null
          comment: string
          consent_given: boolean
          created_at: string
          created_by: string | null
          custom_total: boolean
          date: string
          discount_amount: number
          event_all_day: boolean
          event_notes: string
          event_push_at: string | null
          event_push_enabled: boolean
          event_push_offsets: Json
          event_repeat: Json
          event_url: string
          expenses: Json
          global_discount: Json | null
          id: string
          is_online_booking: boolean
          kind: string
          location_id: string | null
          master_id: string | null
          material_lines: Json | null
          paid_amount: number
          payment: Json | null
          payment_account_id: string | null
          payment_method: string | null
          payment_status: string
          payments: Json
          prepaid_amount: number
          prepayments: Json
          reminder_enabled: boolean
          reminder_offsets: Json
          reminder_template: string
          service_ids: Json
          service_price_overrides: Json
          services: Json
          source: string | null
          status: string
          team_id: string | null
          tenant_id: string
          time_end: string
          time_start: string
          total_amount: number
          total_duration: number
          updated_at: string
          vat_mode: string | null
          vat_rate: number | null
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refund_invoice_payment: {
        Args: {
          p_amount: number
          p_notes?: string
          p_occurred_on?: string
          p_payment_id: string
          p_request_id: string
        }
        Returns: {
          account_id: string | null
          amount: number
          appointment_id: string | null
          appointment_payment_id: string | null
          appointment_payment_kind: string | null
          category_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          debt_id: string | null
          from_calendar: boolean
          id: string
          invoice_id: string | null
          master_id: string | null
          notes: string | null
          occurred_on: string
          occurred_time: string | null
          payment_method: string | null
          receipt_url: string | null
          refund_of_id: string | null
          reversal_kind: string | null
          source: string
          team_id: string
          tenant_id: string
          transfer_group_id: string | null
          type: string
          updated_at: string
          vat_amount: number | null
          vat_mode: string | null
          vat_rate: number | null
        }
        SetofOptions: {
          from: "*"
          to: "finance_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refund_overpayment_and_save: {
        Args: {
          p_amount: number
          p_appointment_id: string
          p_expected_updated_at?: string
          p_patch: Json
          p_request_id: string
        }
        Returns: Json
      }
      refund_receipt: {
        Args: {
          p_amount: number
          p_language?: string
          p_reason?: string
          p_receipt_id: string
          p_request_id: string
        }
        Returns: {
          account_id: string | null
          appointment_id: string | null
          brigade_id: string
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          created_by: string | null
          credit_note_of_id: string | null
          credit_note_of_receipt_id: string | null
          credit_partial: boolean
          credited_amount: number
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          kind: string
          language: string
          location_id: string | null
          notes: string | null
          number: string
          payment_id: string | null
          pdf_url: string | null
          seller_snapshot: Json
          seq: number
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_mode: string | null
          vat_percent: number
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_push_device: {
        Args: { p_locale?: string; p_platform: string; p_token: string }
        Returns: Json
      }
      replace_day_extras: {
        Args: { p_date: string; p_extras: Json; p_team_id: string }
        Returns: {
          amount: number
          category: string | null
          created_at: string
          date: string
          id: string
          kind: string
          name: string
          payment_method: string | null
          receipt_url: string | null
          team_id: string
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "day_extras"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reset_appointment_payment: {
        Args: { p_appointment_id: string }
        Returns: {
          address: string
          address_lat: number | null
          address_lng: number | null
          address_note: string
          cancel_reason: string | null
          city: string | null
          client_id: string | null
          color_override: string | null
          comment: string
          consent_given: boolean
          created_at: string
          created_by: string | null
          custom_total: boolean
          date: string
          discount_amount: number
          event_all_day: boolean
          event_notes: string
          event_push_at: string | null
          event_push_enabled: boolean
          event_push_offsets: Json
          event_repeat: Json
          event_url: string
          expenses: Json
          global_discount: Json | null
          id: string
          is_online_booking: boolean
          kind: string
          location_id: string | null
          master_id: string | null
          material_lines: Json | null
          paid_amount: number
          payment: Json | null
          payment_account_id: string | null
          payment_method: string | null
          payment_status: string
          payments: Json
          prepaid_amount: number
          prepayments: Json
          reminder_enabled: boolean
          reminder_offsets: Json
          reminder_template: string
          service_ids: Json
          service_price_overrides: Json
          services: Json
          source: string | null
          status: string
          team_id: string | null
          tenant_id: string
          time_end: string
          time_start: string
          total_amount: number
          total_duration: number
          updated_at: string
          vat_mode: string | null
          vat_rate: number | null
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reset_push_badge: { Args: never; Returns: undefined }
      resolve_appointment_finance_account: {
        Args: {
          p_payment_method: string
          p_team_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      resolve_appointment_payment_account: {
        Args: {
          p_account_id: string
          p_payment_method: string
          p_team_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      resolve_company_id: {
        Args: { p_company_id: string; p_tenant_id: string }
        Returns: string
      }
      resolve_own_company_id: {
        Args: { p_company_id: string }
        Returns: string
      }
      restore_deleted_appointment: { Args: { p_id: string }; Returns: string }
      restore_deleted_operation: { Args: { p_id: string }; Returns: string }
      revoke_calendar_feed: { Args: never; Returns: Json }
      seed_client_sources: {
        Args: { p_team: string; p_tenant: string }
        Returns: undefined
      }
      seed_records_level: {
        Args: { p_by: string; p_tenant: string; p_user: string }
        Returns: undefined
      }
      set_appointment_prepayment: {
        Args: {
          p_amount: number
          p_appointment_id: string
          p_payment_method: string
        }
        Returns: {
          address: string
          address_lat: number | null
          address_lng: number | null
          address_note: string
          cancel_reason: string | null
          city: string | null
          client_id: string | null
          color_override: string | null
          comment: string
          consent_given: boolean
          created_at: string
          created_by: string | null
          custom_total: boolean
          date: string
          discount_amount: number
          event_all_day: boolean
          event_notes: string
          event_push_at: string | null
          event_push_enabled: boolean
          event_push_offsets: Json
          event_repeat: Json
          event_url: string
          expenses: Json
          global_discount: Json | null
          id: string
          is_online_booking: boolean
          kind: string
          location_id: string | null
          master_id: string | null
          material_lines: Json | null
          paid_amount: number
          payment: Json | null
          payment_account_id: string | null
          payment_method: string | null
          payment_status: string
          payments: Json
          prepaid_amount: number
          prepayments: Json
          reminder_enabled: boolean
          reminder_offsets: Json
          reminder_template: string
          service_ids: Json
          service_price_overrides: Json
          services: Json
          source: string | null
          status: string
          team_id: string | null
          tenant_id: string
          time_end: string
          time_start: string
          total_amount: number
          total_duration: number
          updated_at: string
          vat_mode: string | null
          vat_rate: number | null
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_appointment_vat_mode: {
        Args: { p_appointment_id: string; p_vat_mode: string }
        Returns: {
          address: string
          address_lat: number | null
          address_lng: number | null
          address_note: string
          cancel_reason: string | null
          city: string | null
          client_id: string | null
          color_override: string | null
          comment: string
          consent_given: boolean
          created_at: string
          created_by: string | null
          custom_total: boolean
          date: string
          discount_amount: number
          event_all_day: boolean
          event_notes: string
          event_push_at: string | null
          event_push_enabled: boolean
          event_push_offsets: Json
          event_repeat: Json
          event_url: string
          expenses: Json
          global_discount: Json | null
          id: string
          is_online_booking: boolean
          kind: string
          location_id: string | null
          master_id: string | null
          material_lines: Json | null
          paid_amount: number
          payment: Json | null
          payment_account_id: string | null
          payment_method: string | null
          payment_status: string
          payments: Json
          prepaid_amount: number
          prepayments: Json
          reminder_enabled: boolean
          reminder_offsets: Json
          reminder_template: string
          service_ids: Json
          service_price_overrides: Json
          services: Json
          source: string | null
          status: string
          team_id: string | null
          tenant_id: string
          time_end: string
          time_start: string
          total_amount: number
          total_duration: number
          updated_at: string
          vat_mode: string | null
          vat_rate: number | null
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_client_sms_opt_out: {
        Args: { p_client_id: string; p_value: boolean }
        Returns: boolean
      }
      set_client_team: {
        Args: { p_client_id: string; p_team_id: string }
        Returns: undefined
      }
      set_default_company: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      set_document_series_start: {
        Args: {
          p_doc_type: string
          p_legal_entity_id: string
          p_next_number: number
          p_year: number
        }
        Returns: {
          can_set_start: boolean
          number: string
          seq: number
        }[]
      }
      set_member_access: {
        Args: { p_changes: Json; p_user_id: string }
        Returns: Json
      }
      set_member_calendars: {
        Args: { p_team_ids: string[]; p_user_id: string }
        Returns: Json
      }
      sms_account: { Args: never; Returns: Json }
      sms_alert: {
        Args: { p_kind: string; p_message: string; p_tenant: string }
        Returns: undefined
      }
      sms_appointment_end: { Args: { p_appointment: string }; Returns: string }
      sms_appointment_link: {
        Args: { p_appointment_id: string }
        Returns: string
      }
      sms_appointment_start: {
        Args: { p_appointment: string }
        Returns: string
      }
      sms_appointment_tz: { Args: { p_appointment: string }; Returns: string }
      sms_autotopup_card: {
        Args: {
          p_amount: number
          p_customer: string
          p_label: string
          p_payment_method: string
          p_session: string
          p_tenant: string
          p_threshold: number
        }
        Returns: boolean
      }
      sms_autotopup_claim: {
        Args: never
        Returns: {
          amount_cents: number
          customer: string
          idem_key: string
          payment_method: string
          tenant_id: string
        }[]
      }
      sms_autotopup_customer: { Args: { p_tenant: string }; Returns: string }
      sms_autotopup_forget: { Args: never; Returns: Json }
      sms_autotopup_is_due: {
        Args: {
          a: Database["public"]["Tables"]["sms_autotopup"]["Row"]
          p_balance: number
          p_frozen: boolean
        }
        Returns: boolean
      }
      sms_autotopup_poke: {
        Args: { p_balance: number; p_tenant: string }
        Returns: undefined
      }
      sms_autotopup_result: {
        Args: {
          p_error: string
          p_key: string
          p_ok: boolean
          p_tenant: string
        }
        Returns: undefined
      }
      sms_autotopup_save: { Args: { p: Json }; Returns: Json }
      sms_autotopup_wake: { Args: never; Returns: undefined }
      sms_can_see_team: { Args: { p_team: string }; Returns: boolean }
      sms_charge: {
        Args: { p_body: string; p_id: string; p_segments: number }
        Returns: string
      }
      sms_claim: { Args: { p_limit?: number }; Returns: Json[] }
      sms_client_owns_phone: {
        Args: { p_client: string; p_phone: string }
        Returns: boolean
      }
      sms_credit_topup: {
        Args: {
          p_amount_cents: number
          p_pack: string
          p_payment_intent: string
          p_session: string
          p_tenant: string
        }
        Returns: boolean
      }
      sms_delete_team_template: { Args: { p_id: string }; Returns: boolean }
      sms_enqueue: {
        Args: { p_appointment: string; p_at?: string; p_template: string }
        Returns: boolean
      }
      sms_enqueue_due: { Args: { p_appointment?: string }; Returns: number }
      sms_enqueue_trigger: {
        Args: { p_appointment: string; p_at?: string; p_trigger: string }
        Returns: boolean
      }
      sms_for_appointment: { Args: { p_appointment_id: string }; Returns: Json }
      sms_for_client: {
        Args: { p_client_id: string; p_limit?: number }
        Returns: Json[]
      }
      sms_frozen: { Args: { p_tenant: string }; Returns: boolean }
      sms_history: {
        Args: {
          p_before?: string
          p_limit?: number
          p_team_id?: string
          p_trigger?: string
        }
        Returns: Json[]
      }
      sms_ledger_post: {
        Args: {
          p_amount: number
          p_kind: string
          p_note?: string
          p_ref: string
          p_tenant: string
        }
        Returns: number
      }
      sms_mark: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_id: string
          p_sid: string
          p_status: string
        }
        Returns: undefined
      }
      sms_message_json: {
        Args: {
          m: Database["public"]["Tables"]["sms_messages"]["Row"]
          p_owner: boolean
        }
        Returns: Json
      }
      sms_min_segments: { Args: { p_body: string }; Returns: number }
      sms_phone_allowed: { Args: { p_phone: string }; Returns: boolean }
      sms_price_cents: { Args: never; Returns: number }
      sms_quiet_shift: {
        Args: { p_at: string; p_from: number; p_to: number; p_tz: string }
        Returns: string
      }
      sms_reconcile: { Args: never; Returns: number }
      sms_reorder_team_templates: {
        Args: { p_ids: string[]; p_team_id: string }
        Returns: undefined
      }
      sms_save_settings: { Args: { p: Json }; Returns: Json }
      sms_save_team_sender: {
        Args: { p_name: string; p_team_id: string }
        Returns: Json
      }
      sms_save_team_template: { Args: { p: Json }; Returns: Json }
      sms_send_bulk: {
        Args: { p_items: Json; p_team_id: string }
        Returns: Json
      }
      sms_send_manual: {
        Args: {
          p_appointment_id: string
          p_body: string
          p_client_id: string
          p_phone?: string
          p_team_id?: string
          p_template_id?: string
        }
        Returns: string
      }
      sms_service_on: { Args: never; Returns: boolean }
      sms_set_team_template_enabled: {
        Args: { p_enabled: boolean; p_id: string }
        Returns: boolean
      }
      sms_strip_emoji: { Args: { p_text: string }; Returns: string }
      sms_stripe_dispute: {
        Args: {
          p_amount: number
          p_dispute: string
          p_payment_intent: string
          p_phase: string
        }
        Returns: number
      }
      sms_stripe_refund: {
        Args: { p_payment_intent: string; p_refunded_total: number }
        Returns: number
      }
      sms_team_sender: {
        Args: { p_team: string; p_tenant: string }
        Returns: string
      }
      sms_team_template_json: {
        Args: { t: Database["public"]["Tables"]["sms_team_templates"]["Row"] }
        Returns: Json
      }
      sms_team_templates: { Args: { p_team_id?: string }; Returns: Json[] }
      sms_tick: { Args: never; Returns: undefined }
      sms_topup_reversed: {
        Args: { p_payment_intent: string }
        Returns: Record<string, unknown>
      }
      sms_trigger_kind: { Args: { p_trigger: string }; Returns: string }
      sms_unfreeze: { Args: { p_tenant: string }; Returns: undefined }
      sms_wake: { Args: never; Returns: undefined }
      start_trial: { Args: { p_tier: string }; Returns: Json }
      storage_janitor_candidates: {
        Args: { p_limit?: number; p_min_age?: string }
        Returns: {
          bucket_id: string
          name: string
          reason: string
        }[]
      }
      submit_rating: {
        Args: { p_comment: string; p_stars: number; p_token: string }
        Returns: {
          code: string
          ok: boolean
        }[]
      }
      sync_tenant_claims: { Args: { p_user_id: string }; Returns: undefined }
      team_is_working: {
        Args: { p_team: string; p_tenant: string }
        Returns: boolean
      }
      tenant_business_date: { Args: { p_tenant_id: string }; Returns: string }
      tenant_currency: { Args: { p_tenant_id: string }; Returns: string }
      tenant_data_export: { Args: never; Returns: Json }
      tenant_effective_plan: { Args: { t_id: string }; Returns: string }
      tenant_quota_appointments_month: {
        Args: { t_id: string }
        Returns: number
      }
      tenant_quota_clients: { Args: { t_id: string }; Returns: number }
      tenant_quota_sms_month: { Args: { t_id: string }; Returns: number }
      tenant_quota_summary: { Args: { t_id: string }; Returns: Json }
      tenant_quota_team_members: { Args: { t_id: string }; Returns: number }
      tenant_sms_summary: { Args: never; Returns: Json }
      tenant_tier_limit: {
        Args: { p_what: string; t_id: string }
        Returns: number
      }
      try_uuid: { Args: { p_value: string }; Returns: string }
      undo_appointment_payment: {
        Args: { p_appointment_id: string }
        Returns: {
          address: string
          address_lat: number | null
          address_lng: number | null
          address_note: string
          cancel_reason: string | null
          city: string | null
          client_id: string | null
          color_override: string | null
          comment: string
          consent_given: boolean
          created_at: string
          created_by: string | null
          custom_total: boolean
          date: string
          discount_amount: number
          event_all_day: boolean
          event_notes: string
          event_push_at: string | null
          event_push_enabled: boolean
          event_push_offsets: Json
          event_repeat: Json
          event_url: string
          expenses: Json
          global_discount: Json | null
          id: string
          is_online_booking: boolean
          kind: string
          location_id: string | null
          master_id: string | null
          material_lines: Json | null
          paid_amount: number
          payment: Json | null
          payment_account_id: string | null
          payment_method: string | null
          payment_status: string
          payments: Json
          prepaid_amount: number
          prepayments: Json
          reminder_enabled: boolean
          reminder_offsets: Json
          reminder_template: string
          service_ids: Json
          service_price_overrides: Json
          services: Json
          source: string | null
          status: string
          team_id: string | null
          tenant_id: string
          time_end: string
          time_start: string
          total_amount: number
          total_duration: number
          updated_at: string
          vat_mode: string | null
          vat_rate: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      unregister_push_device: {
        Args: { p_other_devices?: boolean; p_token: string }
        Returns: undefined
      }
      update_client_with_tags: {
        Args: {
          p_client_id: string
          p_patch: Json
          p_tag_ids?: string[]
          p_tenant_id: string
        }
        Returns: Json
      }
      update_invitation: {
        Args: {
          p_access: Json
          p_full_name: string
          p_invitation_id: string
          p_master_color: string
          p_master_title: string
          p_phone: string
          p_team_ids: string[]
        }
        Returns: Json
      }
      update_invoice_draft: {
        Args: {
          p_account_id?: string
          p_appointment_id: string
          p_brigade_id: string
          p_client_id: string
          p_client_requisites_id?: string
          p_company_id?: string
          p_due_on: string
          p_invoice_id: string
          p_issued_on?: string
          p_lines: Json
          p_location_id?: string
          p_notes?: string
          p_vat_mode: string
          p_vat_percent: number
        }
        Returns: {
          account_id: string | null
          appointment_id: string | null
          brigade_id: string
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          created_by: string | null
          credit_note_of_id: string | null
          credit_note_of_receipt_id: string | null
          credit_partial: boolean
          credited_amount: number
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          kind: string
          language: string
          location_id: string | null
          notes: string | null
          number: string
          payment_id: string | null
          pdf_url: string | null
          seller_snapshot: Json
          seq: number
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_mode: string | null
          vat_percent: number
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_master_appointment_safe: {
        Args: { p_appointment_id: string; p_patch: Json }
        Returns: Json
      }
      update_receipt: {
        Args: {
          p_client_requisites_id?: string
          p_issued_on?: string
          p_lines?: Json
          p_location_id?: string
          p_receipt_id: string
        }
        Returns: {
          account_id: string | null
          amount: number
          appointment_id: string | null
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          currency: string
          id: string
          invoice_id: string | null
          issued_on: string
          lines: Json | null
          location_id: string | null
          number: string
          payment_method: string | null
          seller_snapshot: Json
          seq: number
          status: string
          team_id: string
          tenant_id: string
          transaction_id: string | null
          vat_amount: number | null
          vat_rate: number | null
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "receipts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_invoice: {
        Args: { p_invoice_id: string }
        Returns: {
          account_id: string | null
          appointment_id: string | null
          brigade_id: string
          client_id: string | null
          client_requisites_id: string | null
          client_snapshot: Json | null
          company_id: string
          created_at: string
          created_by: string | null
          credit_note_of_id: string | null
          credit_note_of_receipt_id: string | null
          credit_partial: boolean
          credited_amount: number
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          kind: string
          language: string
          location_id: string | null
          notes: string | null
          number: string
          payment_id: string | null
          pdf_url: string | null
          seller_snapshot: Json
          seq: number
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_mode: string | null
          vat_percent: number
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
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
