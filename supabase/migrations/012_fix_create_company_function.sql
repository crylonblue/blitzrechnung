-- Fix create_company_with_owner to accept user_id as parameter
-- This is needed because auth.uid() returns NULL when email confirmation is pending

CREATE OR REPLACE FUNCTION create_company_with_owner(
  p_user_id UUID,
  p_name TEXT,
  p_address JSONB,
  p_country TEXT
)
RETURNS UUID AS $$
DECLARE
  v_company_id UUID;
BEGIN
  -- Insert company
  INSERT INTO companies (name, address, country)
  VALUES (p_name, p_address, p_country)
  RETURNING id INTO v_company_id;

  -- Link user as owner (using passed user_id, not auth.uid())
  INSERT INTO company_users (user_id, company_id, role)
  VALUES (p_user_id, v_company_id, 'owner');

  RETURN v_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
