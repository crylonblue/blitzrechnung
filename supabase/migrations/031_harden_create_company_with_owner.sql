-- Harden onboarding company creation.
--
-- Migration 012 introduced a 4-argument create_company_with_owner() but did
-- not remove the previous 3-argument overload from migration 003. Remove the
-- old function, then require the passed user id to match auth.uid().

DROP FUNCTION IF EXISTS public.create_company_with_owner(TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.create_company_with_owner(
  p_user_id UUID,
  p_name TEXT,
  p_address JSONB,
  p_country TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
      USING ERRCODE = '28000';
  END IF;

  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cannot create a company for another user'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO companies (name, address, country)
  VALUES (p_name, p_address, p_country)
  RETURNING id INTO v_company_id;

  INSERT INTO company_users (user_id, company_id, role)
  VALUES (p_user_id, v_company_id, 'owner');

  RETURN v_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_company_with_owner(UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_company_with_owner(UUID, TEXT, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_company_with_owner(UUID, TEXT, JSONB, TEXT) TO authenticated;
