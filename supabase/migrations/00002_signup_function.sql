-- Function to handle user signup: creates tenant + profile in one step
-- Uses SECURITY DEFINER to bypass RLS (runs as postgres owner)
CREATE OR REPLACE FUNCTION public.handle_signup(
  p_user_id UUID,
  p_full_name TEXT,
  p_email TEXT,
  p_company_name TEXT,
  p_company_slug TEXT
)
RETURNS JSON AS $$
DECLARE
  v_tenant_id UUID;
  v_result JSON;
BEGIN
  -- Create tenant
  INSERT INTO tenants (name, slug)
  VALUES (p_company_name, p_company_slug)
  RETURNING id INTO v_tenant_id;

  -- Create profile with role=owner
  INSERT INTO profiles (id, tenant_id, full_name, email, role)
  VALUES (p_user_id, v_tenant_id, p_full_name, p_email, 'owner');

  -- Set tenant_id in user's app_metadata for RLS
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object(
    'tenant_id', v_tenant_id::text,
    'role', 'owner'
  )
  WHERE id = p_user_id;

  v_result := json_build_object(
    'tenant_id', v_tenant_id,
    'success', true
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
