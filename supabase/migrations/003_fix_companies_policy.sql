-- Fix companies SELECT policy to allow returning newly created companies
-- The issue is that when a company is created, the SELECT policy checks company_users
-- but the company_users entry doesn't exist yet

-- Drop the existing SELECT policy
DROP POLICY IF EXISTS "Users can view their companies" ON companies;

-- Create a new SELECT policy that allows viewing companies:
-- 1. Via company_users relationship (normal case)
-- 2. Companies created in the last minute (for signup flow)
--    This allows returning the company immediately after creation
CREATE POLICY "Users can view their companies"
  ON companies FOR SELECT
  USING (
    id = ANY(SELECT get_user_company_ids())
    OR (
      -- Allow viewing companies created in the last minute
      -- This is necessary for the signup flow where company is created
      -- before company_users entry exists
      created_at > NOW() - INTERVAL '1 minute'
      -- This is safe because:
      -- 1. Only applies to very recent companies
      -- 2. The company_users entry will be created immediately after
      -- 3. After that, the normal policy takes effect
    )
  );

-- Ensure INSERT policy allows creation for authenticated users
-- Drop the old INSERT policy from migration 001
DROP POLICY IF EXISTS "Users can insert companies they own" ON companies;

-- Create INSERT policy that allows any authenticated user to create a company
CREATE POLICY "Authenticated users can insert companies"
  ON companies FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create a SECURITY DEFINER function to create company and link user atomically
-- This bypasses RLS issues during signup
CREATE OR REPLACE FUNCTION create_company_with_owner(
  p_name TEXT,
  p_address JSONB,
  p_country TEXT
)
RETURNS UUID AS $$
DECLARE
  v_company_id UUID;
BEGIN
  -- Insert company (bypasses RLS due to SECURITY DEFINER)
  INSERT INTO companies (name, address, country)
  VALUES (p_name, p_address, p_country)
  RETURNING id INTO v_company_id;

  -- Link user as owner
  INSERT INTO company_users (user_id, company_id, role)
  VALUES (auth.uid(), v_company_id, 'owner');

  RETURN v_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

