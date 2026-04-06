-- Babun CRM — Initial Migration
-- Target: AirFix AC Service, Cyprus
-- Run in Supabase SQL Editor

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Get current user's tenant_id from JWT
CREATE OR REPLACE FUNCTION get_my_tenant_id()
RETURNS UUID AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Get current user's role from JWT
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'role';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TENANTS (компании)
-- ============================================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  settings JSONB DEFAULT '{
    "currency": "EUR",
    "timezone": "Asia/Nicosia",
    "languages": ["ru", "en"],
    "default_language": "ru"
  }',
  subscription_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- PROFILES (пользователи, расширение auth.users)
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'worker' CHECK (role IN ('owner', 'manager', 'worker')),
  crew_id UUID, -- FK добавим после создания crews
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- CREWS (бригады)
-- ============================================================
CREATE TABLE crews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lead_name TEXT,
  phone TEXT,
  city TEXT NOT NULL CHECK (city IN ('limassol', 'paphos', 'larnaca', 'nicosia')),
  color TEXT DEFAULT '#3B82F6',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add FK from profiles to crews
ALTER TABLE profiles ADD CONSTRAINT profiles_crew_id_fkey
  FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE SET NULL;

-- ============================================================
-- CLIENTS (клиенты)
-- ============================================================
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_secondary TEXT,
  email TEXT,
  city TEXT CHECK (city IN ('limassol', 'paphos', 'larnaca', 'nicosia')),
  address TEXT,
  address_details TEXT, -- этаж, подъезд, ориентир
  location JSONB, -- {lat, lng} для карты
  source TEXT DEFAULT 'manual' CHECK (source IN (
    'manual', 'facebook', 'instagram', 'google', 'referral',
    'telegram', 'whatsapp', 'website', 'bazaraki', 'repeat'
  )),
  language TEXT DEFAULT 'ru' CHECK (language IN ('ru', 'en', 'el', 'uk')),
  telegram_chat_id TEXT,
  whatsapp_number TEXT,
  notes TEXT,
  total_orders INTEGER DEFAULT 0,
  total_revenue DECIMAL(10,2) DEFAULT 0,
  last_service_date DATE,
  next_service_date DATE, -- для ре-энгейджмента
  is_vip BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- CLIENT EQUIPMENT (оборудование клиентов)
-- ============================================================
CREATE TABLE client_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'indoor' CHECK (type IN ('indoor', 'outdoor')),
  brand TEXT,
  model TEXT,
  location_in_house TEXT, -- "спальня", "гостиная"
  last_cleaned DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SERVICES (прайс-лист)
-- ============================================================
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT,
  name_el TEXT,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  price_bulk DECIMAL(10,2), -- цена от 3 единиц
  bulk_threshold INTEGER DEFAULT 3,
  unit TEXT DEFAULT 'unit', -- unit, hour, visit
  duration_minutes INTEGER DEFAULT 60,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- DISCOUNT RULES
-- ============================================================
CREATE TABLE discount_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('volume', 'repeat', 'promo')),
  min_units INTEGER,
  discount_percent DECIMAL(5,2),
  discount_fixed DECIMAL(10,2),
  valid_from DATE,
  valid_until DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ORDERS (заказы — ядро CRM)
-- ============================================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_number SERIAL,
  client_id UUID NOT NULL REFERENCES clients(id),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'confirmed', 'scheduled', 'in_progress',
    'completed', 'cancelled', 'no_show'
  )),
  city TEXT NOT NULL CHECK (city IN ('limassol', 'paphos', 'larnaca', 'nicosia')),
  address TEXT,
  address_details TEXT,
  scheduled_date DATE,
  scheduled_time_start TIME,
  scheduled_time_end TIME,
  crew_id UUID REFERENCES crews(id),
  assigned_to UUID REFERENCES profiles(id),
  source TEXT DEFAULT 'manual' CHECK (source IN (
    'manual', 'facebook', 'instagram', 'google', 'telegram',
    'whatsapp', 'website', 'referral', 'repeat'
  )),
  subtotal DECIMAL(10,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) DEFAULT 0,
  payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  payment_method TEXT CHECK (payment_method IN ('cash', 'card', 'transfer', 'revolut')),
  client_notes TEXT,
  internal_notes TEXT,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ORDER ITEMS (позиции заказа)
-- ============================================================
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id),
  equipment_id UUID REFERENCES client_equipment(id),
  description TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ORDER COMMENTS (activity log)
-- ============================================================
CREATE TABLE order_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_id UUID REFERENCES profiles(id),
  type TEXT DEFAULT 'comment' CHECK (type IN (
    'comment', 'status_change', 'assignment', 'payment', 'system'
  )),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ORDER PHOTOS (before/after)
-- ============================================================
CREATE TABLE order_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  type TEXT DEFAULT 'before' CHECK (type IN ('before', 'after', 'other')),
  uploaded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id),
  client_id UUID REFERENCES clients(id),
  amount DECIMAL(10,2) NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'transfer', 'revolut')),
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'refunded')),
  notes TEXT,
  paid_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- EXPENSES
-- ============================================================
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'fuel', 'materials', 'equipment', 'ads', 'rent',
    'salary', 'tax', 'insurance', 'other'
  )),
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  crew_id UUID REFERENCES crews(id),
  created_by UUID REFERENCES profiles(id),
  receipt_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SALARY RECORDS
-- ============================================================
CREATE TABLE salary_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  base_amount DECIMAL(10,2) DEFAULT 0,
  bonus_amount DECIMAL(10,2) DEFAULT 0,
  deductions DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- CONVERSATIONS (Inbox)
-- ============================================================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'whatsapp', 'sms', 'email')),
  external_chat_id TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'resolved', 'spam')),
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('client', 'manager', 'ai', 'system')),
  sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  content_type TEXT DEFAULT 'text' CHECK (content_type IN ('text', 'image', 'document', 'location')),
  metadata JSONB DEFAULT '{}',
  is_ai_generated BOOLEAN DEFAULT false,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- NOTIFICATION TEMPLATES
-- ============================================================
CREATE TABLE notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL, -- order_created, order_confirmed, order_completed, reminder_1d, re_engage_3m
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'whatsapp', 'sms', 'email')),
  template_ru TEXT NOT NULL,
  template_en TEXT,
  template_el TEXT,
  variables TEXT[] DEFAULT '{}', -- {client_name}, {order_date}, {crew_name}
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- NOTIFICATION LOG
-- ============================================================
CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id UUID REFERENCES notification_templates(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'failed', 'read')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- AI LOG
-- ============================================================
CREATE TABLE ai_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- auto_reply, re_engage, suggest_schedule
  input JSONB,
  output JSONB,
  tokens_used INTEGER,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_profiles_tenant ON profiles(tenant_id);
CREATE INDEX idx_clients_tenant ON clients(tenant_id);
CREATE INDEX idx_clients_phone ON clients(tenant_id, phone);
CREATE INDEX idx_clients_city ON clients(tenant_id, city);
CREATE INDEX idx_client_equipment_client ON client_equipment(client_id);
CREATE INDEX idx_orders_tenant ON orders(tenant_id);
CREATE INDEX idx_orders_status ON orders(tenant_id, status);
CREATE INDEX idx_orders_date ON orders(tenant_id, scheduled_date);
CREATE INDEX idx_orders_crew ON orders(tenant_id, crew_id, scheduled_date);
CREATE INDEX idx_orders_client ON orders(client_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_comments_order ON order_comments(order_id);
CREATE INDEX idx_order_photos_order ON order_photos(order_id);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_tenant_date ON payments(tenant_id, paid_at);
CREATE INDEX idx_expenses_tenant_date ON expenses(tenant_id, date);
CREATE INDEX idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX idx_conversations_client ON conversations(client_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_notification_log_tenant ON notification_log(tenant_id, created_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crews ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_log ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy (applied to all tables with tenant_id)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'profiles', 'crews', 'clients', 'client_equipment', 'services',
      'discount_rules', 'orders', 'order_items', 'order_comments',
      'order_photos', 'payments', 'expenses', 'salary_records',
      'conversations', 'messages', 'notification_templates',
      'notification_log', 'ai_log'
    ])
  LOOP
    EXECUTE format('
      CREATE POLICY tenant_isolation ON %I
        FOR ALL USING (tenant_id = get_my_tenant_id());
    ', tbl);
  END LOOP;
END;
$$;

-- Tenants: users can only see their own tenant
CREATE POLICY tenant_self ON tenants
  FOR ALL USING (id = get_my_tenant_id());

-- Workers can only see their own orders (assigned or crew)
CREATE POLICY worker_orders ON orders
  FOR SELECT USING (
    get_my_role() IN ('owner', 'manager')
    OR assigned_to = auth.uid()
    OR crew_id IN (SELECT crew_id FROM profiles WHERE id = auth.uid())
  );

-- ============================================================
-- TRIGGERS: Auto-update client stats
-- ============================================================
CREATE OR REPLACE FUNCTION update_client_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    UPDATE clients SET
      total_orders = total_orders + 1,
      total_revenue = total_revenue + NEW.total,
      last_service_date = COALESCE(NEW.completed_at::date, CURRENT_DATE)
    WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER order_completed_stats
  AFTER UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_client_stats();

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES
  ('order-photos', 'order-photos', false),
  ('receipts', 'receipts', false),
  ('avatars', 'avatars', true);

-- Storage policies
CREATE POLICY storage_order_photos ON storage.objects
  FOR ALL USING (
    bucket_id = 'order-photos'
    AND (storage.foldername(name))[1] = get_my_tenant_id()::text
  );

CREATE POLICY storage_receipts ON storage.objects
  FOR ALL USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = get_my_tenant_id()::text
  );

CREATE POLICY storage_avatars ON storage.objects
  FOR ALL USING (bucket_id = 'avatars');

-- ============================================================
-- SEED DATA: AirFix
-- ============================================================
-- Run after first user signs up and tenant is created
-- See docs/SEED.md for AirFix initial data
