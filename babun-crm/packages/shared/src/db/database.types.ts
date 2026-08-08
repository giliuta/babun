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
      _finance_write_context: {
        Row: {
          entity_id: string
          kind: string
          tenant_id: string
          transaction_id: number
        }
        Insert: {
          entity_id: string
          kind: string
          tenant_id: string
          transaction_id: number
        }
        Update: {
          entity_id?: string
          kind?: string
          tenant_id?: string
          transaction_id?: number
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
          brigade_id: string | null
          color: string | null
          created_at: string
          created_by: string | null
          icon: string | null
          id: string
          is_active: boolean
          kind: string
          name: string
          opening_balance: number
          owner_master_id: string | null
          position: number
          scope: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          balance_hidden?: boolean
          brigade_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          kind: string
          name: string
          opening_balance?: number
          owner_master_id?: string | null
          position?: number
          scope?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          balance_hidden?: boolean
          brigade_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          opening_balance?: number
          owner_master_id?: string | null
          position?: number
          scope?: string
          tenant_id?: string
          updated_at?: string
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
          paid_amount: number
          payment: Json | null
          payment_account_id: string | null
          payment_method: string | null
          payment_status: string
          payments: Json
          prepaid_amount: number
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
        }
        Insert: {
          address?: string
          address_lat?: number | null
          address_lng?: number | null
          address_note?: string
          cancel_reason?: string | null
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
          paid_amount?: number
          payment?: Json | null
          payment_account_id?: string | null
          payment_method?: string | null
          payment_status?: string
          payments?: Json
          prepaid_amount?: number
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
        }
        Update: {
          address?: string
          address_lat?: number | null
          address_lng?: number | null
          address_note?: string
          cancel_reason?: string | null
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
          paid_amount?: number
          payment?: Json | null
          payment_account_id?: string | null
          payment_method?: string | null
          payment_status?: string
          payments?: Json
          prepaid_amount?: number
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
      calendar_settings: {
        Row: {
          allow_overtime: boolean
          buffer_minutes: number
          created_at: string
          days_off: Json
          end_hour: number
          grid_step: number
          hide_cancelled: boolean
          personal_default_label: string | null
          personal_labels: Json | null
          scroll_open_hour: number | null
          start_hour: number
          tenant_id: string
          timezone: string
          updated_at: string
          week_start: string
          work_end_hour: number | null
          work_start_hour: number | null
        }
        Insert: {
          allow_overtime?: boolean
          buffer_minutes?: number
          created_at?: string
          days_off?: Json
          end_hour?: number
          grid_step?: number
          hide_cancelled?: boolean
          personal_default_label?: string | null
          personal_labels?: Json | null
          scroll_open_hour?: number | null
          start_hour?: number
          tenant_id: string
          timezone?: string
          updated_at?: string
          week_start?: string
          work_end_hour?: number | null
          work_start_hour?: number | null
        }
        Update: {
          allow_overtime?: boolean
          buffer_minutes?: number
          created_at?: string
          days_off?: Json
          end_hour?: number
          grid_step?: number
          hide_cancelled?: boolean
          personal_default_label?: string | null
          personal_labels?: Json | null
          scroll_open_hour?: number | null
          start_hour?: number
          tenant_id?: string
          timezone?: string
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
      cities: {
        Row: {
          color: string | null
          country: string
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
          country?: string
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
          country?: string
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
      client_tag_assignments: {
        Row: {
          client_id: string
          tag_id: string
          tenant_id: string
        }
        Insert: {
          client_id: string
          tag_id: string
          tenant_id: string
        }
        Update: {
          client_id?: string
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
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          color: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          color?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
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
          birthday: string
          blacklisted: boolean
          city: string
          city_manual: boolean
          comment: string
          created_at: string
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
          locations: Json
          notes: Json
          phone: string
          phone_e164: string | null
          phones: Json
          pinned_at: string | null
          property_type: string
          purge_at: string | null
          referred_by_client_id: string | null
          reminder_at: string | null
          sms_name: string
          telegram_username: string
          tenant_id: string
          updated_at: string
          whatsapp_phone: string
        }
        Insert: {
          acquisition_source?: string
          address?: string
          avatar_url?: string | null
          balance?: number
          birthday?: string
          blacklisted?: boolean
          city?: string
          city_manual?: boolean
          comment?: string
          created_at?: string
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
          locations?: Json
          notes?: Json
          phone?: string
          phone_e164?: string | null
          phones?: Json
          pinned_at?: string | null
          property_type?: string
          purge_at?: string | null
          referred_by_client_id?: string | null
          reminder_at?: string | null
          sms_name?: string
          telegram_username?: string
          tenant_id: string
          updated_at?: string
          whatsapp_phone?: string
        }
        Update: {
          acquisition_source?: string
          address?: string
          avatar_url?: string | null
          balance?: number
          birthday?: string
          blacklisted?: boolean
          city?: string
          city_manual?: boolean
          comment?: string
          created_at?: string
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
          locations?: Json
          notes?: Json
          phone?: string
          phone_e164?: string | null
          phones?: Json
          pinned_at?: string | null
          property_type?: string
          purge_at?: string | null
          referred_by_client_id?: string | null
          reminder_at?: string | null
          sms_name?: string
          telegram_username?: string
          tenant_id?: string
          updated_at?: string
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
      day_closures: {
        Row: {
          actual_cash_cents: number
          business_date: string
          closed_at: string
          closed_by: string | null
          created_at: string
          currency: string
          delta_cash_cents: number
          expected_cash_cents: number
          is_closed: boolean
          reopened_at: string | null
          reopened_by: string | null
          revision: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          actual_cash_cents: number
          business_date: string
          closed_at?: string
          closed_by?: string | null
          created_at?: string
          currency?: string
          delta_cash_cents: number
          expected_cash_cents: number
          is_closed?: boolean
          reopened_at?: string | null
          reopened_by?: string | null
          revision?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          actual_cash_cents?: number
          business_date?: string
          closed_at?: string
          closed_by?: string | null
          created_at?: string
          currency?: string
          delta_cash_cents?: number
          expected_cash_cents?: number
          is_closed?: boolean
          reopened_at?: string | null
          reopened_by?: string | null
          revision?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_closures_tenant_id_fkey"
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
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          slug: string
          tenant_id: string | null
          type: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          slug: string
          tenant_id?: string | null
          type: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          slug?: string
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
      finance_templates: {
        Row: {
          account_id: string | null
          amount: number
          brigade_id: string | null
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
          brigade_id?: string | null
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
          brigade_id?: string | null
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
      finance_transactions: {
        Row: {
          account_id: string | null
          amount: number
          appointment_id: string | null
          appointment_payment_kind: string | null
          category_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          invoice_id: string | null
          master_id: string | null
          notes: string | null
          occurred_on: string
          payment_method: string | null
          receipt_url: string | null
          refund_of_id: string | null
          source: string
          team_id: string | null
          tenant_id: string
          transfer_group_id: string | null
          vat_amount: number | null
          vat_rate: number | null
          type: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          appointment_id?: string | null
          appointment_payment_kind?: string | null
          category_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id?: string | null
          master_id?: string | null
          notes?: string | null
          occurred_on?: string
          payment_method?: string | null
          receipt_url?: string | null
          refund_of_id?: string | null
          source?: string
          team_id?: string | null
          tenant_id: string
          transfer_group_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
          type: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          appointment_id?: string | null
          appointment_payment_kind?: string | null
          category_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id?: string | null
          master_id?: string | null
          notes?: string | null
          occurred_on?: string
          payment_method?: string | null
          receipt_url?: string | null
          refund_of_id?: string | null
          source?: string
          team_id?: string | null
          tenant_id?: string
          transfer_group_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
          type?: string
          updated_at?: string
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
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by_user_id: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by_user_id: string | null
          master_id: string | null
          role: string
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by_user_id?: string | null
          master_id?: string | null
          role: string
          tenant_id: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by_user_id?: string | null
          master_id?: string | null
          role?: string
          tenant_id?: string
          token?: string
        }
        Relationships: [
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
          id: string
          invoice_id: string
          position: number
          qty: number
          title: string
          total: number
          unit_price: number
        }
        Insert: {
          id?: string
          invoice_id: string
          position?: number
          qty?: number
          title: string
          total: number
          unit_price: number
        }
        Update: {
          id?: string
          invoice_id?: string
          position?: number
          qty?: number
          title?: string
          total?: number
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
          appointment_id: string | null
          brigade_id: string | null
          client_snapshot: Json | null
          client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          notes: string | null
          number: string
          pdf_url: string | null
          seq: number
          seller_snapshot: Json
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_percent: number
          year: number
        }
        Insert: {
          appointment_id?: string | null
          brigade_id?: string | null
          client_snapshot?: Json | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          due_on?: string | null
          id?: string
          issued_on?: string
          notes?: string | null
          number: string
          pdf_url?: string | null
          seq: number
          seller_snapshot?: Json
          status?: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at?: string
          vat_amount: number
          vat_percent?: number
          year: number
        }
        Update: {
          appointment_id?: string | null
          brigade_id?: string | null
          client_snapshot?: Json | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          due_on?: string | null
          id?: string
          issued_on?: string
          notes?: string | null
          number?: string
          pdf_url?: string | null
          seq?: number
          seller_snapshot?: Json
          status?: string
          subtotal_net?: number
          tenant_id?: string
          total?: number
          updated_at?: string
          vat_amount?: number
          vat_percent?: number
          year?: number
        }
        Relationships: [
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
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      location_labels: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id: string
          is_active?: boolean
          name: string
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_labels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      master_documents: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          issued_at: string | null
          kind: string
          label: string
          master_id: string
          mime_type: string | null
          notes: string | null
          size_bytes: number | null
          storage_path: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          issued_at?: string | null
          kind: string
          label: string
          master_id: string
          mime_type?: string | null
          notes?: string | null
          size_bytes?: number | null
          storage_path: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          issued_at?: string | null
          kind?: string
          label?: string
          master_id?: string
          mime_type?: string | null
          notes?: string | null
          size_bytes?: number | null
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_documents_tenant_id_fkey"
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
      personal_event_types: {
        Row: {
          all_day: boolean
          color: string
          created_at: string
          created_by: string | null
          default_duration: number
          icon: string
          id: string
          is_active: boolean
          label: string
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          color?: string
          created_at?: string
          created_by?: string | null
          default_duration?: number
          icon?: string
          id: string
          is_active?: boolean
          label: string
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          color?: string
          created_at?: string
          created_by?: string | null
          default_duration?: number
          icon?: string
          id?: string
          is_active?: boolean
          label?: string
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
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
      services: {
        Row: {
          available_weekdays: Json
          brigade_ids: Json
          bulk_price: number
          bulk_threshold: number
          category_id: string | null
          color: string
          cost_per_unit: number
          created_at: string
          duration_minutes: number
          duration_tiers: Json | null
          id: string
          is_active: boolean
          is_countable: boolean
          material_costs: Json
          name: string
          online_enabled: boolean
          position: number
          price: number
          price_tiers: Json | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          available_weekdays?: Json
          brigade_ids?: Json
          bulk_price?: number
          bulk_threshold?: number
          category_id?: string | null
          color?: string
          cost_per_unit?: number
          created_at?: string
          duration_minutes?: number
          duration_tiers?: Json | null
          id: string
          is_active?: boolean
          is_countable?: boolean
          material_costs?: Json
          name: string
          online_enabled?: boolean
          position?: number
          price?: number
          price_tiers?: Json | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          available_weekdays?: Json
          brigade_ids?: Json
          bulk_price?: number
          bulk_threshold?: number
          category_id?: string | null
          color?: string
          cost_per_unit?: number
          created_at?: string
          duration_minutes?: number
          duration_tiers?: Json | null
          id?: string
          is_active?: boolean
          is_countable?: boolean
          material_costs?: Json
          name?: string
          online_enabled?: boolean
          position?: number
          price?: number
          price_tiers?: Json | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_tenant_id_fkey"
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
          client_id: string | null
          created_at: string
          delivered_at: string | null
          error_code: string | null
          error_message: string | null
          id: string
          message_body: string
          mode: string
          status: string
          tenant_id: string
          to_phone: string
          trigger_type: string
          twilio_sid: string | null
        }
        Insert: {
          appointment_id?: string | null
          client_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          message_body: string
          mode: string
          status: string
          tenant_id: string
          to_phone: string
          trigger_type: string
          twilio_sid?: string | null
        }
        Update: {
          appointment_id?: string | null
          client_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          message_body?: string
          mode?: string
          status?: string
          tenant_id?: string
          to_phone?: string
          trigger_type?: string
          twilio_sid?: string | null
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
        Relationships: []
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
          id: string
          is_active: boolean
          lead_id: string | null
          lead_ids: Json
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
          id: string
          is_active?: boolean
          lead_id?: string | null
          lead_ids?: Json
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
          id?: string
          is_active?: boolean
          lead_id?: string | null
          lead_ids?: Json
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
          invited_by_user_id: string | null
          joined_at: string
          master_id: string | null
          metadata: Json
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          invited_by_user_id?: string | null
          joined_at?: string
          master_id?: string | null
          metadata?: Json
          role: string
          tenant_id: string
          user_id: string
        }
        Update: {
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
          mode: string
          quota_period_start: string
          remind_24h_before: boolean
          remind_2h_before: boolean
          sender_approved_at: string | null
          sender_name: string | null
          sender_rejection_reason: string | null
          sender_requested_at: string | null
          sender_status: string | null
          sent_this_month: number
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
          mode?: string
          quota_period_start?: string
          remind_24h_before?: boolean
          remind_2h_before?: boolean
          sender_approved_at?: string | null
          sender_name?: string | null
          sender_rejection_reason?: string | null
          sender_requested_at?: string | null
          sender_status?: string | null
          sent_this_month?: number
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
          mode?: string
          quota_period_start?: string
          remind_24h_before?: boolean
          remind_2h_before?: boolean
          sender_approved_at?: string | null
          sender_name?: string | null
          sender_rejection_reason?: string | null
          sender_requested_at?: string | null
          sender_status?: string | null
          sent_this_month?: number
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
          track_units: boolean
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
          iban: string | null
          id: string
          invoice_prefix: string
          legal_name: string | null
          logo_url: string | null
          name: string
          onboarded_at: string | null
          personal_calendar_enabled: boolean
          plan: string
          plan_override: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          trial_ends_at: string | null
          vat_number: string | null
          vertical: string | null
          document_language: string
          vat_exemption_note: string | null
          vat_mode: string
          vat_rate: number
        }
        Insert: {
          track_units?: boolean
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
          iban?: string | null
          id?: string
          invoice_prefix?: string
          legal_name?: string | null
          logo_url?: string | null
          name: string
          onboarded_at?: string | null
          personal_calendar_enabled?: boolean
          plan?: string
          plan_override?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          trial_ends_at?: string | null
          vat_number?: string | null
          vertical?: string | null
          document_language?: string
          vat_exemption_note?: string | null
          vat_mode?: string
          vat_rate?: number
        }
        Update: {
          track_units?: boolean
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
          iban?: string | null
          id?: string
          invoice_prefix?: string
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          onboarded_at?: string | null
          personal_calendar_enabled?: boolean
          plan?: string
          plan_override?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          trial_ends_at?: string | null
          vat_number?: string | null
          vertical?: string | null
          document_language?: string
          vat_exemption_note?: string | null
          vat_mode?: string
          vat_rate?: number
        }
        Relationships: []
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
      _dispatch_push: {
        Args: { p_data: Json; p_event_type: string; p_recipients: string[] }
        Returns: undefined
      }
      accept_invitation: { Args: { p_token: string }; Returns: string }
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
        Returns: Database["public"]["Tables"]["location_labels"]["Row"][]
      }
      bump_sms_balance: {
        Args: { p_amount_cents: number; p_tenant_id: string }
        Returns: Json
      }
      close_business_day: {
        Args: { p_actual_cash_cents: number; p_business_date: string }
        Returns: Database["public"]["Tables"]["day_closures"]["Row"][]
      }
      create_client_with_tags: {
        Args: {
          p_client: Json
          p_client_id: string | null
          p_tag_ids?: string[]
          p_tenant_id: string
        }
        Returns: Json
      }
      current_tenant_id: { Args: never; Returns: string }
      current_tenant_profile_safe: { Args: never; Returns: Json }
      current_user_can_access_client: {
        Args: { p_client_id: string }
        Returns: boolean
      }
      current_user_can_access_client_tag: {
        Args: { p_tag_id: string }
        Returns: boolean
      }
      current_user_can_access_appointment: {
        Args: { p_appointment_id: string }
        Returns: boolean
      }
      current_user_can_mutate_appointment_photo: {
        Args: { p_appointment_id: string }
        Returns: boolean
      }
      current_user_master_id: { Args: never; Returns: string }
      current_user_role: { Args: never; Returns: string }
      current_user_team_ids: { Args: never; Returns: string[] }
      create_invitation: {
        Args: { p_email: string; p_master_id?: string; p_role: string }
        Returns: Json
      }
      delete_account_transfer: {
        Args: { p_transfer_group_id: string }
        Returns: boolean
      }
      import_schedule: {
        Args: {
          p_calendar_settings?: Json
          p_day_cities?: Json
          p_day_extras?: Json
          p_schedules?: Json
        }
        Returns: undefined
      }
      is_platform_admin: { Args: never; Returns: boolean }
      invitation_preview: { Args: { p_token: string }; Returns: Json }
      list_master_clients_safe: {
        Args: { p_client_id?: string }
        Returns: Json[]
      }
      list_master_appointments_safe: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json[]
      }
      list_master_services_safe: { Args: never; Returns: Json[] }
      list_dispatcher_services_safe: { Args: never; Returns: Json[] }
      list_operational_masters_safe: { Args: never; Returns: Json[] }
      list_operational_teams_safe: { Args: never; Returns: Json[] }
      list_payment_accounts_safe: {
        Args: { p_team_id: string }
        Returns: Json[]
      }
      normalize_client_tag_ids: {
        Args: { p_tag_ids: string[]; p_tenant_id: string }
        Returns: string[]
      }
      patch_master_profile: {
        Args: { p_master_id: string; p_patch: Json }
        Returns: Json
      }
      replace_day_extras: {
        Args: { p_date: string; p_extras: Json; p_team_id: string }
        Returns: Database["public"]["Tables"]["day_extras"]["Row"][]
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
      update_client_with_tags: {
        Args: {
          p_client_id: string
          p_patch: Json
          p_tag_ids?: string[]
          p_tenant_id: string
        }
        Returns: Json
      }
      read_sms_templates_safe: { Args: never; Returns: Json }
      read_day_closure: {
        Args: { p_business_date: string }
        Returns: {
          actual_cash_cents: number | null
          business_date: string
          closed_at: string | null
          closed_by: string | null
          created_at: string | null
          currency: string
          delta_cash_cents: number | null
          expected_cash_cents: number
          is_closed: boolean
          reopened_at: string | null
          reopened_by: string | null
          revision: number
          tenant_id: string
          updated_at: string | null
        }[]
      }
      read_operational_calendar_settings_safe: {
        Args: never
        Returns: {
          allow_overtime: boolean
          buffer_minutes: number
          end_hour: number
          grid_step: number
          hide_cancelled: boolean
          scroll_open_hour: number | null
          start_hour: number
          timezone: string
          week_start: string
          work_end_hour: number | null
          work_start_hour: number | null
        }[]
      }
      reopen_business_day: {
        Args: { p_business_date: string }
        Returns: Database["public"]["Tables"]["day_closures"]["Row"][]
      }
      try_uuid: { Args: { p_value: string }; Returns: string }
      update_master_appointment_safe: {
        Args: { p_appointment_id: string; p_patch: Json }
        Returns: Json
      }
      write_sms_templates_safe: {
        Args: { p_templates: Json }
        Returns: Json
      }
      issue_invoice: {
        Args: {
          p_appointment_id: string | null
          p_brigade_id: string | null
          p_client_id: string | null
          p_due_on: string | null
          p_issued_on: string
          p_lines: Json
          p_link_to_tx_id?: string | null
          p_notes?: string | null
          p_request_id: string
          p_vat_mode: string
          p_vat_percent: number
        }
        Returns: {
          appointment_id: string | null
          brigade_id: string | null
          client_snapshot: Json | null
          client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          notes: string | null
          number: string
          pdf_url: string | null
          seq: number
          seller_snapshot: Json
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_percent: number
          year: number
        }
      }
      record_invoice_payment: {
        Args: {
          p_account_id: string
          p_amount: number
          p_invoice_id: string
          p_notes?: string | null
          p_occurred_on?: string
          p_payment_method: string
          p_request_id: string
        }
        Returns: {
          account_id: string | null
          amount: number
          appointment_id: string | null
          appointment_payment_kind: string | null
          category_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          invoice_id: string | null
          master_id: string | null
          notes: string | null
          occurred_on: string
          payment_method: string | null
          receipt_url: string | null
          refund_of_id: string | null
          source: string
          team_id: string | null
          tenant_id: string
          transfer_group_id: string | null
          type: string
          updated_at: string
        }
      }
      refund_invoice_payment: {
        Args: {
          p_amount: number
          p_notes?: string | null
          p_occurred_on?: string
          p_payment_id: string
          p_request_id: string
        }
        Returns: Database["public"]["Tables"]["finance_transactions"]["Row"]
      }
      record_account_transfer: {
        Args: {
          p_amount: number
          p_from_account_id: string
          p_notes?: string | null
          p_occurred_on?: string
          p_request_id: string
          p_to_account_id: string
        }
        Returns: Database["public"]["Tables"]["finance_transactions"]["Row"][]
      }
      reset_appointment_payment: {
        Args: { p_appointment_id: string }
        Returns: Database["public"]["Tables"]["appointments"]["Row"]
      }
      set_appointment_prepayment: {
        Args: {
          p_amount: number
          p_appointment_id: string
          p_payment_method: string | null
        }
        Returns: Database["public"]["Tables"]["appointments"]["Row"]
      }
      update_invoice_draft: {
        Args: {
          p_appointment_id: string | null
          p_brigade_id: string | null
          p_client_id: string | null
          p_due_on: string | null
          p_invoice_id: string
          p_lines: Json
          p_notes?: string | null
          p_vat_mode: string
          p_vat_percent: number
        }
        Returns: {
          appointment_id: string | null
          brigade_id: string | null
          client_snapshot: Json | null
          client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          notes: string | null
          number: string
          pdf_url: string | null
          seq: number
          seller_snapshot: Json
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_percent: number
          year: number
        }
      }
      undo_appointment_payment: {
        Args: { p_appointment_id: string }
        Returns: Database["public"]["Tables"]["appointments"]["Row"][]
      }
      void_invoice: {
        Args: { p_invoice_id: string }
        Returns: {
          appointment_id: string | null
          brigade_id: string | null
          client_snapshot: Json | null
          client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          due_on: string | null
          id: string
          issued_on: string
          notes: string | null
          number: string
          pdf_url: string | null
          seq: number
          seller_snapshot: Json
          status: string
          subtotal_net: number
          tenant_id: string
          total: number
          updated_at: string
          vat_amount: number
          vat_percent: number
          year: number
        }
      }
      submit_rating: {
        Args: { p_comment: string; p_stars: number; p_token: string }
        Returns: {
          code: string
          ok: boolean
        }[]
      }
      tenant_business_date: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      tenant_cash_ledger_cents: {
        Args: { p_as_of_date: string; p_tenant_id: string }
        Returns: number
      }
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
