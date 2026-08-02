-- Billing: 14-day Pro trial + Stripe subscriptions.
--
-- The trial is app-managed rather than Stripe-managed, matching what the
-- pricing page promises: "14 Tage voller Pro-Zugriff · keine Kreditkarte".
-- Stripe only gets involved once a company actually converts.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ NOT NULL
    DEFAULT (NOW() + INTERVAL '14 days');

-- Adding the column backfills existing rows with the default, so companies that
-- predate billing get a full 14 days starting from this migration instead of
-- being locked out the moment it deploys.

CREATE TABLE IF NOT EXISTS subscriptions (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'none' CHECK (plan IN ('none', 'basis', 'pro')),
  -- Deliberately no CHECK on status: Stripe can introduce new subscription
  -- statuses, and a constraint violation here would break the webhook for
  -- every event, not just this row.
  status TEXT NOT NULL DEFAULT 'none',
  price_id TEXT,
  -- Marks one of the 100 launch slots as claimed. The row survives
  -- cancellation, so a churned early adopter never reopens their slot.
  early_bird BOOLEAN NOT NULL DEFAULT FALSE,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Members may read their company's billing state. Nobody may write it from the
-- client: every mutation arrives through the Stripe webhook via service role.
CREATE POLICY "Members can view their company subscription"
  ON subscriptions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.company_id = subscriptions.company_id
        AND company_users.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_subscriptions_early_bird
  ON subscriptions (early_bird) WHERE early_bird;
