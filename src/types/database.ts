// Manually defined to match 00001_initial_schema.sql
// Regenerate with: npx supabase gen types typescript --project-id xxx > src/types/database.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          plan: string | null;
          settings: Json | null;
          subscription_ends_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          plan?: string | null;
          settings?: Json | null;
          subscription_ends_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          plan?: string | null;
          settings?: Json | null;
          subscription_ends_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          tenant_id: string;
          full_name: string;
          phone: string | null;
          email: string | null;
          role: string;
          crew_id: string | null;
          avatar_url: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          full_name: string;
          phone?: string | null;
          email?: string | null;
          role?: string;
          crew_id?: string | null;
          avatar_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          full_name?: string;
          phone?: string | null;
          email?: string | null;
          role?: string;
          crew_id?: string | null;
          avatar_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      crews: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          lead_name: string | null;
          phone: string | null;
          city: string;
          color: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          lead_name?: string | null;
          phone?: string | null;
          city: string;
          color?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          lead_name?: string | null;
          phone?: string | null;
          city?: string;
          color?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          tenant_id: string;
          full_name: string;
          phone: string;
          phone_secondary: string | null;
          email: string | null;
          city: string | null;
          address: string | null;
          address_details: string | null;
          location: Json | null;
          source: string | null;
          language: string | null;
          telegram_chat_id: string | null;
          whatsapp_number: string | null;
          notes: string | null;
          total_orders: number;
          total_revenue: number;
          last_service_date: string | null;
          next_service_date: string | null;
          is_vip: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          full_name: string;
          phone: string;
          phone_secondary?: string | null;
          email?: string | null;
          city?: string | null;
          address?: string | null;
          address_details?: string | null;
          location?: Json | null;
          source?: string | null;
          language?: string | null;
          telegram_chat_id?: string | null;
          whatsapp_number?: string | null;
          notes?: string | null;
          total_orders?: number;
          total_revenue?: number;
          last_service_date?: string | null;
          next_service_date?: string | null;
          is_vip?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          full_name?: string;
          phone?: string;
          phone_secondary?: string | null;
          email?: string | null;
          city?: string | null;
          address?: string | null;
          address_details?: string | null;
          location?: Json | null;
          source?: string | null;
          language?: string | null;
          telegram_chat_id?: string | null;
          whatsapp_number?: string | null;
          notes?: string | null;
          total_orders?: number;
          total_revenue?: number;
          last_service_date?: string | null;
          next_service_date?: string | null;
          is_vip?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      client_equipment: {
        Row: {
          id: string;
          tenant_id: string;
          client_id: string;
          type: string;
          brand: string | null;
          model: string | null;
          location_in_house: string | null;
          last_cleaned: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          client_id: string;
          type?: string;
          brand?: string | null;
          model?: string | null;
          location_in_house?: string | null;
          last_cleaned?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          client_id?: string;
          type?: string;
          brand?: string | null;
          model?: string | null;
          location_in_house?: string | null;
          last_cleaned?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      services: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          name_en: string | null;
          name_el: string | null;
          description: string | null;
          price: number;
          price_bulk: number | null;
          bulk_threshold: number | null;
          unit: string | null;
          duration_minutes: number | null;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          name_en?: string | null;
          name_el?: string | null;
          description?: string | null;
          price: number;
          price_bulk?: number | null;
          bulk_threshold?: number | null;
          unit?: string | null;
          duration_minutes?: number | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          name_en?: string | null;
          name_el?: string | null;
          description?: string | null;
          price?: number;
          price_bulk?: number | null;
          bulk_threshold?: number | null;
          unit?: string | null;
          duration_minutes?: number | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      discount_rules: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          type: string;
          min_units: number | null;
          discount_percent: number | null;
          discount_fixed: number | null;
          valid_from: string | null;
          valid_until: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          type: string;
          min_units?: number | null;
          discount_percent?: number | null;
          discount_fixed?: number | null;
          valid_from?: string | null;
          valid_until?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          type?: string;
          min_units?: number | null;
          discount_percent?: number | null;
          discount_fixed?: number | null;
          valid_from?: string | null;
          valid_until?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          tenant_id: string;
          order_number: number;
          client_id: string;
          status: string;
          city: string;
          address: string | null;
          address_details: string | null;
          scheduled_date: string | null;
          scheduled_time_start: string | null;
          scheduled_time_end: string | null;
          crew_id: string | null;
          assigned_to: string | null;
          source: string | null;
          subtotal: number;
          discount_amount: number;
          total: number;
          payment_status: string;
          payment_method: string | null;
          client_notes: string | null;
          internal_notes: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          client_id: string;
          status?: string;
          city: string;
          address?: string | null;
          address_details?: string | null;
          scheduled_date?: string | null;
          scheduled_time_start?: string | null;
          scheduled_time_end?: string | null;
          crew_id?: string | null;
          assigned_to?: string | null;
          source?: string | null;
          subtotal?: number;
          discount_amount?: number;
          total?: number;
          payment_status?: string;
          payment_method?: string | null;
          client_notes?: string | null;
          internal_notes?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          cancel_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          client_id?: string;
          status?: string;
          city?: string;
          address?: string | null;
          address_details?: string | null;
          scheduled_date?: string | null;
          scheduled_time_start?: string | null;
          scheduled_time_end?: string | null;
          crew_id?: string | null;
          assigned_to?: string | null;
          source?: string | null;
          subtotal?: number;
          discount_amount?: number;
          total?: number;
          payment_status?: string;
          payment_method?: string | null;
          client_notes?: string | null;
          internal_notes?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          cancel_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          tenant_id: string;
          order_id: string;
          service_id: string | null;
          equipment_id: string | null;
          description: string | null;
          quantity: number;
          unit_price: number;
          total: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          order_id: string;
          service_id?: string | null;
          equipment_id?: string | null;
          description?: string | null;
          quantity?: number;
          unit_price: number;
          total: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          order_id?: string;
          service_id?: string | null;
          equipment_id?: string | null;
          description?: string | null;
          quantity?: number;
          unit_price?: number;
          total?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      order_comments: {
        Row: {
          id: string;
          tenant_id: string;
          order_id: string;
          author_id: string | null;
          type: string;
          content: string;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          order_id: string;
          author_id?: string | null;
          type?: string;
          content: string;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          order_id?: string;
          author_id?: string | null;
          type?: string;
          content?: string;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      order_photos: {
        Row: {
          id: string;
          tenant_id: string;
          order_id: string;
          url: string;
          type: string;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          order_id: string;
          url: string;
          type?: string;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          order_id?: string;
          url?: string;
          type?: string;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          tenant_id: string;
          order_id: string | null;
          client_id: string | null;
          amount: number;
          method: string;
          status: string;
          notes: string | null;
          paid_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          order_id?: string | null;
          client_id?: string | null;
          amount: number;
          method: string;
          status?: string;
          notes?: string | null;
          paid_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          order_id?: string | null;
          client_id?: string | null;
          amount?: number;
          method?: string;
          status?: string;
          notes?: string | null;
          paid_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          id: string;
          tenant_id: string;
          category: string;
          amount: number;
          description: string | null;
          date: string;
          crew_id: string | null;
          created_by: string | null;
          receipt_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          category: string;
          amount: number;
          description?: string | null;
          date: string;
          crew_id?: string | null;
          created_by?: string | null;
          receipt_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          category?: string;
          amount?: number;
          description?: string | null;
          date?: string;
          crew_id?: string | null;
          created_by?: string | null;
          receipt_url?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      salary_records: {
        Row: {
          id: string;
          tenant_id: string;
          profile_id: string;
          period_start: string;
          period_end: string;
          base_amount: number;
          bonus_amount: number;
          deductions: number;
          total: number;
          status: string;
          paid_at: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          profile_id: string;
          period_start: string;
          period_end: string;
          base_amount?: number;
          bonus_amount?: number;
          deductions?: number;
          total: number;
          status?: string;
          paid_at?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          profile_id?: string;
          period_start?: string;
          period_end?: string;
          base_amount?: number;
          bonus_amount?: number;
          deductions?: number;
          total?: number;
          status?: string;
          paid_at?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          tenant_id: string;
          client_id: string | null;
          channel: string;
          external_chat_id: string | null;
          status: string;
          assigned_to: string | null;
          last_message_at: string | null;
          unread_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          client_id?: string | null;
          channel: string;
          external_chat_id?: string | null;
          status?: string;
          assigned_to?: string | null;
          last_message_at?: string | null;
          unread_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          client_id?: string | null;
          channel?: string;
          external_chat_id?: string | null;
          status?: string;
          assigned_to?: string | null;
          last_message_at?: string | null;
          unread_count?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          tenant_id: string;
          conversation_id: string;
          direction: string;
          sender_type: string;
          sender_id: string | null;
          content: string;
          content_type: string;
          metadata: Json | null;
          is_ai_generated: boolean;
          delivered_at: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          conversation_id: string;
          direction: string;
          sender_type: string;
          sender_id?: string | null;
          content: string;
          content_type?: string;
          metadata?: Json | null;
          is_ai_generated?: boolean;
          delivered_at?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          conversation_id?: string;
          direction?: string;
          sender_type?: string;
          sender_id?: string | null;
          content?: string;
          content_type?: string;
          metadata?: Json | null;
          is_ai_generated?: boolean;
          delivered_at?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      notification_templates: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          trigger_event: string;
          channel: string;
          template_ru: string;
          template_en: string | null;
          template_el: string | null;
          variables: string[] | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          trigger_event: string;
          channel: string;
          template_ru: string;
          template_en?: string | null;
          template_el?: string | null;
          variables?: string[] | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          trigger_event?: string;
          channel?: string;
          template_ru?: string;
          template_en?: string | null;
          template_el?: string | null;
          variables?: string[] | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      notification_log: {
        Row: {
          id: string;
          tenant_id: string;
          template_id: string | null;
          client_id: string | null;
          order_id: string | null;
          channel: string;
          content: string;
          status: string;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          template_id?: string | null;
          client_id?: string | null;
          order_id?: string | null;
          channel: string;
          content: string;
          status?: string;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          template_id?: string | null;
          client_id?: string | null;
          order_id?: string | null;
          channel?: string;
          content?: string;
          status?: string;
          error?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      ai_log: {
        Row: {
          id: string;
          tenant_id: string;
          action: string;
          input: Json | null;
          output: Json | null;
          tokens_used: number | null;
          model: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          action: string;
          input?: Json | null;
          output?: Json | null;
          tokens_used?: number | null;
          model?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          action?: string;
          input?: Json | null;
          output?: Json | null;
          tokens_used?: number | null;
          model?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_my_tenant_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      get_my_role: {
        Args: Record<string, never>;
        Returns: string;
      };
    };
    Enums: Record<string, never>;
  };
};
