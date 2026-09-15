-- Migration: Move email_settings from Postmark to AhaSend
--
-- The Postmark account behind the previous integration is gone, so every
-- identifier stored for it is dead: the per-company server token, the numeric
-- domain id, and the DKIM/Return-Path records customers published.
--
-- Companies keep their sender address and template settings. What they lose is
-- the verified state, because the new provider issues its own DKIM keys and the
-- customer has to publish new DNS records. Until they do, `domain_verified` is
-- false and invoices go out from the shared blitzrechnung.de sender instead of
-- failing - see sendInvoice() in lib/invoice-service.ts.
--
-- The absence of an `provider` key marks a domain as "registered nowhere", which
-- /api/domains/verify reports back as "needs setup".

UPDATE companies
SET email_settings = (email_settings
    - 'postmark_domain_id'
    - 'postmark_server_id'
    - 'postmark_server_token'
    - 'domain_verified_at'
    - 'dns_records')
    || jsonb_build_object('domain_verified', false)
WHERE email_settings ?| array['postmark_domain_id', 'postmark_server_id', 'postmark_server_token'];

COMMENT ON COLUMN companies.email_settings IS 'Email configuration for AhaSend: { mode: "default"|"custom_domain", reply_to_email?, reply_to_name?, custom_domain?, from_email?, from_name?, domain_verified?, domain_verified_at?, provider?: "ahasend", dns_records?: [{ type, host, value, required, verified }], invoice_email_subject?, invoice_email_body? }';
