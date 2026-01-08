# Add authorization check in invoice finalize API endpoint

## Overview

The /api/invoices/finalize endpoint authenticates the user but does NOT verify that the user belongs to the company that owns the invoice. An authenticated attacker could finalize any invoice by guessing/knowing invoice IDs, potentially generating PDFs and manipulating invoice data for invoices they don't own.

## Rationale

This is an IDOR (Insecure Direct Object Reference) vulnerability. While Supabase RLS policies provide a database-level safety net, the API route performs file generation and S3 uploads before the database operation, meaning an attacker could trigger resource consumption and potentially receive error messages that leak information about invoices they shouldn't access.

---
*This spec was created from ideation and is pending detailed specification.*
