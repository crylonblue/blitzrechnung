'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Invoice, LineItem, PartySnapshot, Address, Company } from '@/types'

// Type for the atomic invoice number RPC result
interface InvoiceNumberResult {
  next_number: number
  formatted_number: string
}
import { createClient } from '@/lib/supabase/client'
import ContactSelector from './contact-selector'
import LineItemsEditor from './line-items-editor'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { LoaderCircle, Trash2, Check } from 'lucide-react'
import { useDraftDrawer } from '@/contexts/draft-drawer-context'
import { ContactDrawerProvider } from '@/contexts/contact-drawer-context'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { validateInvoiceForFinalization, formatValidationErrors } from '@/lib/invoice-validation'

interface DraftEditorProps {
  draft: Invoice
}

export default function DraftEditor({ draft: initialDraft }: DraftEditorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { closeDrawer } = useDraftDrawer()
  const supabase = createClient()
  const [draft, setDraft] = useState(initialDraft)
  const [isSaving, setIsSaving] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [company, setCompany] = useState<Company | null>(null)

  // Seller state
  const [sellerIsSelf, setSellerIsSelf] = useState(draft.seller_is_self ?? true)
  const [sellerSnapshot, setSellerSnapshot] = useState<PartySnapshot | null>(
    (draft.seller_snapshot as PartySnapshot | null) || null
  )

  // Buyer state
  const [buyerIsSelf, setBuyerIsSelf] = useState(draft.buyer_is_self ?? false)
  const [buyerSnapshot, setBuyerSnapshot] = useState<PartySnapshot | null>(
    (draft.buyer_snapshot as PartySnapshot | null) || null
  )

  const lineItems = (draft.line_items as unknown as LineItem[]) || []
  const [isSaved, setIsSaved] = useState(!!draft.id && draft.status === 'draft')

  // Load company data
  useEffect(() => {
    const loadCompany = async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', draft.company_id)
        .single()

      if (!error && data) {
        setCompany(data)
      }
    }

    loadCompany()
  }, [draft.company_id])

  const saveDraft = async () => {
    setIsSaving(true)
    setError(null)

    // Calculate totals
    const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0)
    const vatAmount = lineItems.reduce((sum, item) => sum + (item.total * item.vat_rate) / 100, 0)
    const totalAmount = subtotal + vatAmount

    let savedDraft: Invoice

    if (draft.id) {
      // Update existing draft
      const { data, error } = await supabase
        .from('invoices')
        .update({
          line_items: lineItems,
          seller_is_self: sellerIsSelf,
          seller_contact_id: sellerIsSelf ? null : sellerSnapshot?.id || null,
          seller_snapshot: sellerIsSelf ? null : sellerSnapshot,
          buyer_is_self: buyerIsSelf,
          buyer_contact_id: buyerIsSelf ? null : buyerSnapshot?.id || null,
          buyer_snapshot: buyerIsSelf ? null : buyerSnapshot,
          invoice_date: draft.invoice_date,
          due_date: draft.due_date,
          subtotal: subtotal,
          vat_amount: vatAmount,
          total_amount: totalAmount,
        })
        .eq('id', draft.id)
        .select()
        .single()

      if (error) {
        setError(error.message)
        setIsSaving(false)
        return
      }

      savedDraft = data
    } else {
      // Create new draft
      const { data, error } = await supabase
        .from('invoices')
        .insert({
          company_id: draft.company_id,
          status: 'draft',
          line_items: lineItems,
          seller_is_self: sellerIsSelf,
          seller_contact_id: sellerIsSelf ? null : sellerSnapshot?.id || null,
          seller_snapshot: sellerIsSelf ? null : sellerSnapshot,
          buyer_is_self: buyerIsSelf,
          buyer_contact_id: buyerIsSelf ? null : buyerSnapshot?.id || null,
          buyer_snapshot: buyerIsSelf ? null : buyerSnapshot,
          invoice_date: draft.invoice_date,
          due_date: draft.due_date,
          subtotal: subtotal,
          vat_amount: vatAmount,
          total_amount: totalAmount,
        })
        .select()
        .single()

      if (error) {
        setError(error.message)
        setIsSaving(false)
        return
      }

      savedDraft = data
    }

    setDraft(savedDraft)
    setIsSaved(true)
    setIsSaving(false)
    
    // Show success toast
    toast.success('Entwurf gespeichert', {
      description: 'Der Entwurf wurde erfolgreich gespeichert.',
    })
    
    // Close drawer and refresh if on drafts page
    closeDrawer()
    if (pathname === '/drafts') {
      router.refresh()
    }
  }

  const handleSaveDraft = async () => {
    await saveDraft()
  }

  const handleSellerSelect = (contact: PartySnapshot | null, isSelf: boolean) => {
    setSellerIsSelf(isSelf)
    setSellerSnapshot(contact)
  }

  const handleBuyerSelect = (contact: PartySnapshot | null, isSelf: boolean) => {
    setBuyerIsSelf(isSelf)
    setBuyerSnapshot(contact)
  }

  const handleLineItemsChange = (items: LineItem[]) => {
    setDraft((prev) => ({
      ...prev,
      line_items: items as any,
    }))
  }

  const handleDateChange = (field: 'invoice_date' | 'due_date', value: string) => {
    setDraft((prev) => ({
      ...prev,
      [field]: value || null,
    }))
  }

  const handleDelete = async () => {
    if (!draft.id) return

    setIsDeleting(true)
    setError(null)

    const { error: deleteError } = await supabase
      .from('invoices')
      .delete()
      .eq('id', draft.id)
      .eq('status', 'draft')

    setIsDeleting(false)
    setDeleteDialogOpen(false)

    if (deleteError) {
      setError('Fehler beim Löschen des Entwurfs')
      return
    }

    // Show success toast
    toast.success('Entwurf gelöscht', {
      description: 'Der Entwurf wurde erfolgreich gelöscht.',
    })

    // Close drawer and refresh
    closeDrawer()
    router.refresh()
  }

  const handleFinalize = async () => {
    setError(null)

    // Build seller snapshot for validation
    let validationSellerSnapshot: PartySnapshot | null = null
    if (sellerIsSelf && company) {
      const companyAddress = company.address as unknown as Address
      const bankDetails = company.bank_details as any
      validationSellerSnapshot = {
        name: company.name,
        address: companyAddress,
        vat_id: company.vat_id || undefined,
        tax_id: company.tax_id || undefined,
        bank_details: bankDetails ? {
          bank_name: bankDetails.bank_name,
          iban: bankDetails.iban,
          bic: bankDetails.bic,
          account_holder: bankDetails.account_holder,
        } : undefined,
      }
    } else if (!sellerIsSelf && sellerSnapshot) {
      validationSellerSnapshot = sellerSnapshot
    }

    // Get buyer snapshot for validation
    let validationBuyerSnapshot: PartySnapshot | null = null
    if (buyerIsSelf && company) {
      const companyAddress = company.address as unknown as Address
      validationBuyerSnapshot = {
        name: company.name,
        address: companyAddress,
        vat_id: company.vat_id || undefined,
      }
    } else {
      validationBuyerSnapshot = buyerSnapshot
    }

    // Comprehensive validation according to §14 UStG
    const validationResult = validateInvoiceForFinalization({
      company,
      issuerSnapshot: sellerIsSelf ? null : validationSellerSnapshot,
      customerSnapshot: validationBuyerSnapshot,
      lineItems,
      invoiceDate: draft.invoice_date,
      useDefaultIssuer: sellerIsSelf,
    })

    if (!validationResult.isValid) {
      setError(formatValidationErrors(validationResult.errors))
      return
    }

    setIsFinalizing(true)

    try {
      // Reload company to ensure we have latest data
      const { data: latestCompany } = await supabase
        .from('companies')
        .select('*')
        .eq('id', draft.company_id)
        .single()

      // Get next invoice number using atomic RPC function
      let invoiceNumber: string
      if (sellerIsSelf) {
        // Use company's invoice number sequence (atomic)
        const { data: numberResult, error: numberError } = await supabase
          .rpc('get_next_invoice_number', {
            p_seller_type: 'company',
            p_seller_id: draft.company_id,
            p_prefix: latestCompany?.invoice_number_prefix || 'INV'
          })
          .single() as { data: InvoiceNumberResult | null, error: any }

        if (numberError || !numberResult) {
          console.error('Error generating invoice number:', numberError)
          setError('Fehler bei der Rechnungsnummern-Generierung')
          setIsFinalizing(false)
          return
        }

        invoiceNumber = numberResult.formatted_number
      } else if (sellerSnapshot?.invoice_number_prefix && sellerSnapshot.id) {
        // Use external seller's invoice number sequence (atomic)
        const { data: numberResult, error: numberError } = await supabase
          .rpc('get_next_invoice_number', {
            p_seller_type: 'contact',
            p_seller_id: sellerSnapshot.id,
            p_prefix: sellerSnapshot.invoice_number_prefix
          })
          .single() as { data: InvoiceNumberResult | null, error: any }

        if (numberError || !numberResult) {
          console.error('Error generating invoice number:', numberError)
          setError('Fehler bei der Rechnungsnummern-Generierung')
          setIsFinalizing(false)
          return
        }

        invoiceNumber = numberResult.formatted_number
      } else {
        setError('Rechnungsnummer kann nicht generiert werden. Bitte hinterlegen Sie ein Präfix für den Absender.')
        setIsFinalizing(false)
        return
      }

      // Calculate final totals
      const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0)
      const vatAmount = lineItems.reduce((sum, item) => sum + (item.total * item.vat_rate) / 100, 0)
      const totalAmount = subtotal + vatAmount

      let finalizedInvoice: Invoice

      if (draft.id) {
        // Update existing draft - keep as draft until upload succeeds
        const { data, error: updateError } = await supabase
          .from('invoices')
          .update({
            status: 'draft', // Keep as draft until upload succeeds
            invoice_number: invoiceNumber,
            invoice_date: draft.invoice_date,
            due_date: draft.due_date,
            seller_is_self: sellerIsSelf,
            seller_contact_id: sellerIsSelf ? null : sellerSnapshot?.id || null,
            seller_snapshot: sellerIsSelf ? null : sellerSnapshot,
            buyer_is_self: buyerIsSelf,
            buyer_contact_id: buyerIsSelf ? null : buyerSnapshot?.id || null,
            buyer_snapshot: buyerIsSelf ? null : buyerSnapshot,
            line_items: lineItems,
            subtotal: subtotal,
            vat_amount: vatAmount,
            total_amount: totalAmount,
            finalized_at: new Date().toISOString(),
          })
          .eq('id', draft.id)
          .select()
          .single()

        if (updateError) {
          setError(updateError.message)
          setIsFinalizing(false)
          return
        }

        finalizedInvoice = data
      } else {
        // Create new invoice - keep as draft until upload succeeds
        const { data, error: insertError } = await supabase
          .from('invoices')
          .insert({
            company_id: draft.company_id,
            status: 'draft', // Keep as draft until upload succeeds
            invoice_number: invoiceNumber,
            invoice_date: draft.invoice_date,
            due_date: draft.due_date,
            seller_is_self: sellerIsSelf,
            seller_contact_id: sellerIsSelf ? null : sellerSnapshot?.id || null,
            seller_snapshot: sellerIsSelf ? null : sellerSnapshot,
            buyer_is_self: buyerIsSelf,
            buyer_contact_id: buyerIsSelf ? null : buyerSnapshot?.id || null,
            buyer_snapshot: buyerIsSelf ? null : buyerSnapshot,
            line_items: lineItems,
            subtotal: subtotal,
            vat_amount: vatAmount,
            total_amount: totalAmount,
            finalized_at: new Date().toISOString(),
          })
          .select()
          .single()

        if (insertError) {
          setError(insertError.message)
          setIsFinalizing(false)
          return
        }

        finalizedInvoice = data
      }

      // Generate PDF and XML, upload to S3
      const response = await fetch('/api/invoices/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoiceId: finalizedInvoice.id,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || 'Fehler beim Generieren der Rechnung')
        setIsFinalizing(false)
        return
      }

      setIsFinalizing(false)
      
      // Show success toast
      toast.success('Rechnung erstellt', {
        description: `Rechnung ${invoiceNumber} wurde erfolgreich erstellt.`,
      })
      
      // Close drawer and refresh after successful finalize
      closeDrawer()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Finalisieren')
      setIsFinalizing(false)
    }
  }

  return (
    <ContactDrawerProvider>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex-shrink-0 p-6 pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
          <div>
            <h1 className="text-headline">Rechnung erstellen</h1>
            <p className="mt-2 text-meta">
              {isSaved ? 'Entwurf • Gespeichert' : 'Noch nicht gespeichert'}
            </p>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex-shrink-0 px-6 pt-6 pb-4">
            <div className="message-error">
              {error}
            </div>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6" style={{ paddingTop: error ? '0' : '1.5rem' }}>
          <div className="space-y-8 pb-6">
            <div>
              <h2 className="mb-4 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>Von (Absender)</h2>
              <ContactSelector
                companyId={draft.company_id}
                company={company}
                selectedContact={sellerSnapshot}
                isSelf={sellerIsSelf}
                showSelfOption={true}
                filterSellersOnly={true}
                label="Absender auswählen..."
                onSelect={handleSellerSelect}
              />

              <div className="pt-6 mt-6 border-t" style={{ borderColor: 'var(--border-default)' }}>
                <h2 className="mb-4 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>An (Empfänger)</h2>
                <ContactSelector
                  companyId={draft.company_id}
                  company={company}
                  selectedContact={buyerSnapshot}
                  isSelf={buyerIsSelf}
                  showSelfOption={true}
                  filterSellersOnly={false}
                  label="Empfänger auswählen..."
                  onSelect={handleBuyerSelect}
                />
              </div>
            </div>

            <div>
              <h2 className="mb-4 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>Datum</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="invoice_date">
                    Rechnungsdatum
                  </Label>
                  <DatePicker
                    value={draft.invoice_date}
                    onChange={(date) => handleDateChange('invoice_date', date || '')}
                    placeholder="Rechnungsdatum auswählen"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="due_date">
                    Fälligkeitsdatum
                  </Label>
                  <DatePicker
                    value={draft.due_date}
                    onChange={(date) => handleDateChange('due_date', date || '')}
                    placeholder="Fälligkeitsdatum auswählen"
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>

            <div>
              <h2 className="mb-4 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>Positionen</h2>
              <LineItemsEditor companyId={draft.company_id} lineItems={lineItems} onChange={handleLineItemsChange} />
              
              {lineItems.length > 0 && (() => {
                const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0)
                const vatAmount = lineItems.reduce((sum, item) => sum + (item.total * item.vat_rate) / 100, 0)
                const totalAmount = subtotal + vatAmount
                
                return (
                  <div className="mt-6 pt-6 border-t" style={{ borderColor: 'var(--border-default)' }}>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span style={{ color: 'var(--text-secondary)' }}>Netto</span>
                        <span style={{ color: 'var(--text-primary)' }}>
                          {new Intl.NumberFormat('de-DE', {
                            style: 'currency',
                            currency: 'EUR',
                          }).format(subtotal)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span style={{ color: 'var(--text-secondary)' }}>MwSt.</span>
                        <span style={{ color: 'var(--text-primary)' }}>
                          {new Intl.NumberFormat('de-DE', {
                            style: 'currency',
                            currency: 'EUR',
                          }).format(vatAmount)}
                        </span>
                      </div>
                      <div className="flex justify-between pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Brutto</span>
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          {new Intl.NumberFormat('de-DE', {
                            style: 'currency',
                            currency: 'EUR',
                          }).format(totalAmount)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>

        {/* Actions Footer */}
        <div className="flex-shrink-0 border-t px-6 py-4" style={{ borderColor: 'var(--border-default)' }}>
          <div className="flex items-center justify-between">
            {draft.id && isSaved ? (
              <Button
                onClick={() => setDeleteDialogOpen(true)}
                disabled={isSaving || isFinalizing || isDeleting}
                variant="destructive"
                className="text-sm"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Löschen
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-3">
              <Button
                onClick={handleFinalize}
                disabled={isFinalizing || isSaving || isDeleting}
                variant="outline"
                className="text-sm"
              >
                {isFinalizing ? (
                  <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Rechnung fertigstellen
              </Button>
              <Button
                onClick={handleSaveDraft}
                disabled={isSaving || isFinalizing || isDeleting}
                className="text-sm"
              >
                {isSaving && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
                {isSaved ? 'Aktualisieren' : 'Als Entwurf speichern'}
              </Button>
            </div>
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Entwurf löschen?</DialogTitle>
              <DialogDescription>
                Möchten Sie diesen Entwurf wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteDialogOpen(false)}
                disabled={isDeleting}
              >
                Abbrechen
              </Button>
              <Button
                onClick={handleDelete}
                disabled={isDeleting}
                variant="destructive"
              >
                {isDeleting && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
                Löschen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ContactDrawerProvider>
  )
}
