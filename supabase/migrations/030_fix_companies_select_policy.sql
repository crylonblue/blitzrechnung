-- Remove the 60-second "recently created" window from the companies SELECT
-- policy. Migration 003 added it as a signup workaround, but it let ANY
-- authenticated user read ANY company created in the last minute — a
-- cross-tenant read leak. create_company_with_owner() (SECURITY DEFINER) already
-- creates the company_users membership row in the same transaction, and the
-- onboarding flow uses that RPC, so membership-based access is sufficient.
DROP POLICY IF EXISTS "Users can view their companies" ON companies;

CREATE POLICY "Users can view their companies"
  ON companies FOR SELECT
  USING (id = ANY(SELECT get_user_company_ids()));
