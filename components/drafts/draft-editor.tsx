'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Invoice, LineItem, PartySnapshot, Address, Company } from '@/types'
import { createClient } from '@/lib/supabase/client'
import ContactSelector from './contact-selector'
import LineItemsEditor from './line-items-editor'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { LoaderCircle, Trash2, Check, Eye, ChevronRight } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAccess } from '@/contexts/access-context'
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
import {
  validateInvoiceForFinalization,
  validateInvoiceDates,
  formatValidationErrors,
  type ValidationError,
} from '@/lib/invoice-validation'
import { getAdditionalContacts } from '@/lib/contact-persons'

interface DraftEditorProps {
  draft: Invoice
}

// Kurzbezeichnungen der Firmenangaben für den Hinweis über der Aktionsleiste.
// Die vollen Sätze aus lib/invoice-validation.ts erklären zusätzlich das Warum
// ("Für die E-Rechnung erforderlich") und sprengen die eine Zeile; hier zählt
// nur, welches Feld in den Einstellungen anzufassen ist.
const COMPANY_FIELD_LABELS: Record<string, string> = {
  'issuer.name': 'Firmenname',
  'issuer.address': 'Firmenadresse',
  'issuer.address.street': 'Straße',
  'issuer.address.streetnumber': 'Hausnummer',
  'issuer.address.zip': 'PLZ',
  'issuer.address.city': 'Stadt',
  'issuer.address.country': 'Land',
  'issuer.tax': 'Steuernummer oder USt-IdNr.',
  'issuer.bank': 'IBAN',
  'issuer.email': 'Kontakt-E-Mail',
}

export default function DraftEditor({ draft: initialDraft }: DraftEditorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { closeDrawer } = useDraftDrawer()
  const supabase = createClient()
  const [draft, setDraft] = useState(initialDraft)
  const { departments } = useAccess()
  const writableDepartments = departments.filter((d) => d.writable)
  // Bestehender Entwurf: seine Abteilung. Neuer Entwurf: die einzige beschreibbare,
  // sonst die Standardabteilung, falls dort schreibbar, sonst die erste.
  const [departmentId, setDepartmentId] = useState<string>(
    draft.department_id ||
      (writableDepartments.find((d) => d.isDefault) ?? writableDepartments[0])?.id ||
      ''
  )
  const [isSaving, setIsSaving] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [finalizeConfirmOpen, setFinalizeConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  // Solange die Firmendaten laden, wissen wir noch nicht, was wirklich fehlt —
  // dann zeigen wir keinen Hinweis, statt einen falschen aufblitzen zu lassen.
  const [isCompanyLoading, setIsCompanyLoading] = useState(true)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false)

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

  // Das `|| []` erzeugt sonst bei jedem Rendern ein neues Array und lässt die
  // Fertigstellungs-Prüfung weiter unten unnötig immer wieder laufen.
  const lineItems = useMemo(
    () => (draft.line_items as unknown as LineItem[]) || [],
    [draft.line_items]
  )
  const [isSaved, setIsSaved] = useState(!!draft.id && draft.status === 'draft')
  
  // Language state
  const [language, setLanguage] = useState<'de' | 'en'>(draft.language as 'de' | 'en' || 'de')
  
  // Text fields state
  const [buyerReference, setBuyerReference] = useState(draft.buyer_reference || '')

  // Die manuelle Rechnungsnummer ist ein Notausgang für den Umstieg aus einem
  // Altsystem — fast niemand braucht sie, deshalb startet der Bereich zu.
  // Trägt der Entwurf aber schon eine Nummer, darf sie nicht hinter einer
  // zugeklappten Zeile verschwinden: dann startet er offen.
  const [invoiceNumberOpen, setInvoiceNumberOpen] = useState(!!initialDraft.invoice_number)

  // Contact person: null = the company's default Ansprechpartner
  const [contactPersonId, setContactPersonId] = useState<string | null>(draft.contact_person_id ?? null)
  const additionalContacts = getAdditionalContacts(company)
  const selectedContactPerson = additionalContacts.find((c) => c.id === contactPersonId)

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
      setIsCompanyLoading(false)
    }

    loadCompany()
  }, [draft.company_id])

  // Fertigstellen ist der einzige unumkehrbare Schritt der Anwendung: Es vergibt
  // atomar eine fortlaufende Rechnungsnummer, die sich nicht zurücknehmen lässt —
  // eine falsch fertiggestellte Rechnung muss storniert werden. Deshalb prüfen wir
  // die Pflichtangaben nach § 14 UStG schon vor dem Klick und nicht erst im
  // Bestätigungsdialog, damit der Knopf nicht "bereit" aussieht, wenn er es nicht ist.
  // Es ist exakt dieselbe Prüfung, die handleFinalize ohnehin fährt — ein Entwurf,
  // der bisher fertiggestellt werden konnte, kann es damit unverändert.
  const finalizeValidation = useMemo(() => {
    // Absender: entweder die eigene Firma oder ein ausgewählter Kontakt
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

    // Empfänger: eigene Firma (Gutschrift an sich selbst) oder ausgewählter Kontakt
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

    const result = validateInvoiceForFinalization({
      company,
      issuerSnapshot: sellerIsSelf ? null : validationSellerSnapshot,
      customerSnapshot: validationBuyerSnapshot,
      lineItems,
      invoiceDate: draft.invoice_date,
      useDefaultIssuer: sellerIsSelf,
    })

    // Fehlende Kontakt-IDs laufen sonst erst in die Datenbank-Constraints —
    // sie gehören deshalb in dieselbe Vorab-Prüfung.
    const errors: ValidationError[] = [...result.errors]
    if (!sellerIsSelf && !sellerSnapshot?.id) {
      errors.push({
        field: 'issuer.id',
        message: 'Der ausgewählte Absender hat keine gültige ID. Bitte wählen Sie einen anderen Absender aus.',
      })
    }
    if (!buyerIsSelf && !buyerSnapshot?.id) {
      errors.push({
        field: 'customer.id',
        message: 'Der ausgewählte Empfänger hat keine gültige ID. Bitte wählen Sie einen anderen Empfänger aus.',
      })
    }

    return { isValid: errors.length === 0, errors }
  }, [company, sellerIsSelf, sellerSnapshot, buyerIsSelf, buyerSnapshot, lineItems, draft.invoice_date])

  // Kurzfassung für den Hinweis in der Aktionsleiste: ein ausgegrauter Knopf ohne
  // Erklärung ist eine Sackgasse.
  //
  // Bei Empfänger und Positionen genügt das Stichwort — die stehen im Formular
  // direkt daneben. Bei den Firmendaten nicht: die liegen in einem langen
  // Einstellungsformular in einem anderen Bereich, und welches Feld dort fehlt,
  // stand bisher nur im title-Attribut. Ein title erscheint erst beim
  // Darüberfahren mit der Maus und auf einem Tastgerät gar nicht. Deshalb werden
  // die fehlenden Firmenangaben hier ausdrücklich benannt.
  const missingSections = useMemo(() => {
    const hasError = (prefix: string) => finalizeValidation.errors.some((e) => e.field.startsWith(prefix))
    const sections: string[] = []

    if (hasError('issuer')) {
      if (sellerIsSelf) {
        // 'issuer' selbst bleibt aussen vor: das ist der Fall "Firmendaten
        // konnten nicht geladen werden" — da gibt es kein einzelnes Feld zu
        // benennen. Ohne Kurzbezeichnung lieber den vollen Satz als gar nichts:
        // käme in lib/invoice-validation.ts eine Prüfung hinzu, verschwände sie
        // sonst stillschweigend aus der Zeile.
        const fields = finalizeValidation.errors
          .filter((e) => e.field.startsWith('issuer.'))
          .map((e) => COMPANY_FIELD_LABELS[e.field] ?? e.message)
        if (fields.length === 0) {
          sections.push('Firmendaten (Einstellungen)')
        } else {
          // Die Zeile soll kurz bleiben: bei einer noch leeren Firma stünden hier
          // sonst acht Angaben. Drei benennen reicht, um zu wissen, worum es geht.
          const shown = fields.slice(0, 3).join(', ')
          const rest = fields.length - 3
          sections.push(`Firmendaten (${shown}${rest > 0 ? ` und ${rest} weitere Angaben` : ''})`)
        }
      } else {
        sections.push('Absender')
      }
    }
    if (hasError('customer')) sections.push('Empfänger')
    if (hasError('lineItems')) sections.push('Positionen')
    if (hasError('invoiceDate')) sections.push('Rechnungsdatum')
    return sections
  }, [finalizeValidation, sellerIsSelf])

  // Zeigt der Hinweis Firmenangaben, führt ein Verweis direkt dorthin — sonst
  // muss man die Einstellungen selbst suchen (gleiches Muster wie beim
  // Fehlerbanner weiter oben, neuer Tab, damit der Entwurf offen bleibt).
  const missingCompanyData = sellerIsSelf && finalizeValidation.errors.some((e) => e.field.startsWith('issuer'))

  // Plausibilität der Datumsangaben: ein Hinweis, kein Riegel. Begründung in
  // lib/invoice-validation.ts bei validateInvoiceDates.
  const dateWarnings = useMemo(
    () => validateInvoiceDates({ invoiceDate: draft.invoice_date, dueDate: draft.due_date }),
    [draft.invoice_date, draft.due_date]
  )

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
          department_id: departmentId,
          line_items: lineItems,
          seller_is_self: sellerIsSelf,
          seller_contact_id: sellerIsSelf ? null : sellerSnapshot?.id || null,
          seller_snapshot: sellerIsSelf ? null : sellerSnapshot,
          buyer_is_self: buyerIsSelf,
          buyer_contact_id: buyerIsSelf ? null : buyerSnapshot?.id || null,
          buyer_snapshot: buyerIsSelf ? null : buyerSnapshot,
          invoice_date: draft.invoice_date,
          due_date: draft.due_date,
          service_date: draft.service_date,
          subtotal: subtotal,
          vat_amount: vatAmount,
          total_amount: totalAmount,
          language: language,
          buyer_reference: buyerReference || null,
          contact_person_id: sellerIsSelf ? contactPersonId : null,
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
          department_id: departmentId,
          line_items: lineItems,
          seller_is_self: sellerIsSelf,
          seller_contact_id: sellerIsSelf ? null : sellerSnapshot?.id || null,
          seller_snapshot: sellerIsSelf ? null : sellerSnapshot,
          buyer_is_self: buyerIsSelf,
          buyer_contact_id: buyerIsSelf ? null : buyerSnapshot?.id || null,
          buyer_snapshot: buyerIsSelf ? null : buyerSnapshot,
          invoice_date: draft.invoice_date,
          due_date: draft.due_date,
          service_date: draft.service_date,
          subtotal: subtotal,
          vat_amount: vatAmount,
          total_amount: totalAmount,
          language: language,
          buyer_reference: buyerReference || null,
          contact_person_id: sellerIsSelf ? contactPersonId : null,
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
    if (!isSelf && contact?.id) preselectLastContactPerson(contact.id)
  }

  // Departments usually serve the same customers, so preselect whichever
  // Ansprechpartner was used on the last invoice to this customer.
  const preselectLastContactPerson = async (buyerContactId: string) => {
    if (additionalContacts.length === 0) return
    let query = supabase
      .from('invoices')
      .select('contact_person_id')
      .eq('company_id', draft.company_id)
      .eq('buyer_contact_id', buyerContactId)
      .eq('seller_is_self', true)
      .order('created_at', { ascending: false })
      .limit(1)
    if (draft.id) query = query.neq('id', draft.id)
    const { data } = await query
    const lastId = data?.[0]?.contact_person_id ?? null
    if (data?.length && (lastId === null || additionalContacts.some((c) => c.id === lastId))) {
      setContactPersonId(lastId)
    }
  }

  const handleLineItemsChange = (items: LineItem[]) => {
    setDraft((prev) => ({
      ...prev,
      line_items: items as any,
    }))
  }

  const handleDateChange = (field: 'invoice_date' | 'due_date' | 'service_date', value: string) => {
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

    // Vollständige Prüfung nach § 14 UStG. Der Knopf ist zwar schon gesperrt,
    // solange sie fehlschlägt — die Prüfung bleibt hier aber als letzte
    // Client-Absicherung stehen (die eigentliche liegt ohnehin auf dem Server).
    if (!finalizeValidation.isValid) {
      setError(formatValidationErrors(finalizeValidation.errors))
      return
    }

    setIsFinalizing(true)

    try {
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
            department_id: departmentId,
            invoice_number: draft.invoice_number || null,
            invoice_date: draft.invoice_date,
            due_date: draft.due_date,
            service_date: draft.service_date,
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
            language: language,
            buyer_reference: buyerReference || null,
            contact_person_id: sellerIsSelf ? contactPersonId : null,
          })
          .eq('id', draft.id)
          .eq('status', 'draft')
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
            department_id: departmentId,
            status: 'draft', // Keep as draft until upload succeeds
            invoice_number: draft.invoice_number || null,
            invoice_date: draft.invoice_date,
            due_date: draft.due_date,
            service_date: draft.service_date,
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
            language: language,
            buyer_reference: buyerReference || null,
            contact_person_id: sellerIsSelf ? contactPersonId : null,
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

      // The paywall. The draft is already saved at this point, so nothing the
      // user typed is lost — they just can't turn it into a numbered invoice.
      if (response.status === 402) {
        const errorData = await response.json()
        setError(errorData.details || errorData.error)
        setIsFinalizing(false)
        toast.error(errorData.error || 'Testphase abgelaufen', {
          description: errorData.details,
          action: { label: 'Tarif wählen', onClick: () => router.push('/settings') },
        })
        return
      }

      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage = errorData.details
          ? `${errorData.error}: ${errorData.details}`
          : (errorData.error || 'Fehler beim Generieren der Rechnung')
        setError(errorMessage)
        setIsFinalizing(false)
        return
      }

      const result = await response.json()
      setIsFinalizing(false)
      
      // Show success toast
      toast.success('Rechnung erstellt', {
        description: `Rechnung ${result.invoice_number || ''} wurde erfolgreich erstellt.`,
      })
      
      // Close the drawer and take the user straight to the finished invoice,
      // where "Versenden" is the obvious next step.
      closeDrawer()
      router.push(`/invoices/${finalizedInvoice.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Finalisieren')
      setIsFinalizing(false)
    }
  }

  const handlePreview = async () => {
    setError(null)
    setIsPreviewLoading(true)

    try {
      const response = await fetch('/api/drafts/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyId: draft.company_id,
          sellerIsSelf,
          sellerSnapshot,
          buyerIsSelf,
          buyerSnapshot,
          lineItems,
          invoiceDate: draft.invoice_date,
          dueDate: draft.due_date,
          serviceDate: draft.service_date,
          language,
          buyerReference,
          contactPersonId: sellerIsSelf ? contactPersonId : null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || 'Fehler beim Erstellen der Vorschau')
        setIsPreviewLoading(false)
        return
      }

      // Get the PDF blob and create a URL
      const pdfBlob = await response.blob()
      const url = URL.createObjectURL(pdfBlob)
      
      // Clean up previous URL if exists
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
      
      setPreviewUrl(url)
      setPreviewDialogOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Erstellen der Vorschau')
    } finally {
      setIsPreviewLoading(false)
    }
  }

  // Clean up preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

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
              {error.includes('Einstellungen') && (
                <div className="mt-2">
                  <a
                    href="/settings"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium underline"
                  >
                    Einstellungen in neuem Tab öffnen →
                  </a>
                </div>
              )}
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

              {/* Only shown once the company has more than one Ansprechpartner */}
              {sellerIsSelf && additionalContacts.length > 0 && (
                <div className="mt-4">
                  <Label htmlFor="contact_person">Ansprechpartner</Label>
                  <Select
                    value={selectedContactPerson?.id ?? 'default'}
                    onValueChange={(value) => setContactPersonId(value === 'default' ? null : value)}
                  >
                    <SelectTrigger id="contact_person" className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">{company?.contact_name || 'Standard'}</SelectItem>
                      {additionalContacts.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedContactPerson && (
                    <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Steht auf der Rechnung; Antworten auf die Rechnungs-E-Mail gehen an diesen Ansprechpartner.
                    </p>
                  )}
                </div>
              )}

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
                {buyerSnapshot && !buyerIsSelf && (
                  <div className="mt-4">
                    <Label htmlFor="buyer_email">E-Mail des Empfängers</Label>
                    <Input
                      id="buyer_email"
                      type="email"
                      value={buyerSnapshot.email || ''}
                      onChange={(e) => setBuyerSnapshot({ ...buyerSnapshot, email: e.target.value })}
                      placeholder="rechnung@kunde.de"
                      className="mt-1.5"
                    />
                    {!buyerSnapshot.email?.trim() && (
                      <p className="mt-1 text-xs" style={{ color: 'var(--status-warning)' }}>
                        Für den Versand der E-Rechnung erforderlich.
                      </p>
                    )}
                  </div>
                )}
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
                <div>
                  <Label htmlFor="service_date">
                    Leistungsdatum
                  </Label>
                  <DatePicker
                    value={draft.service_date || draft.invoice_date}
                    onChange={(date) => handleDateChange('service_date', date || '')}
                    placeholder="Leistungsdatum auswählen"
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>

            {/* Abteilung - nur wenn es etwas zu wählen gibt */}
            {writableDepartments.length > 1 && (
              <div>
                <h2 className="mb-4 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>Abteilung</h2>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger id="department" className="mt-1.5">
                    <SelectValue placeholder="Abteilung auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {writableDepartments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Language Selector - Only show if English invoices are enabled */}
            {company?.enable_english_invoices && (
              <div>
                <h2 className="mb-4 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>Sprache</h2>
                <div>
                  <Label htmlFor="language">
                    Rechnungssprache
                  </Label>
                  <Select value={language} onValueChange={(value: 'de' | 'en') => setLanguage(value)}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Sprache auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="de">Deutsch</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div>
              <h2 className="mb-4 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>Referenz</h2>
              <div>
                <Label htmlFor="buyer_reference">
                  Bestellnummer / Referenz (optional)
                </Label>
                <Input
                  id="buyer_reference"
                  value={buyerReference}
                  onChange={(e) => setBuyerReference(e.target.value)}
                  placeholder="z.B. PO-12345"
                  className="mt-1.5"
                />
                <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Erscheint als &quot;REFERENZ&quot; auf der Rechnung
                </p>
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

            {/* Kein eigenes Bauteil: components/ui/ hat weder Collapsible noch
                Accordion, und <details>/<summary> bringt Tastaturbedienung und
                die Zustandsansage (auf-/zugeklappt) ohne neue Abhängigkeit mit. */}
            <details
              open={invoiceNumberOpen}
              onToggle={(e) => setInvoiceNumberOpen(e.currentTarget.open)}
              className="border-t pt-6"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className={`h-4 w-4 shrink-0 transition-transform ${invoiceNumberOpen ? 'rotate-90' : ''}`}
                  style={{ color: 'var(--text-secondary)' }}
                  aria-hidden="true"
                />
                <span style={{ color: 'var(--text-secondary)' }}>Rechnungsnummer manuell vergeben</span>
                {/* Eine gesetzte Nummer muss auch zugeklappt sichtbar bleiben —
                    sonst versteckt der Bereich genau das, was man wissen muss. */}
                {!invoiceNumberOpen && draft.invoice_number && (
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {draft.invoice_number}
                  </span>
                )}
              </summary>
              <div className="mt-4">
                <Label htmlFor="invoice_number">Rechnungsnummer</Label>
                <Input
                  id="invoice_number"
                  type="text"
                  value={draft.invoice_number || ''}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, invoice_number: e.target.value.trim() || null }))
                  }
                  placeholder="Leer lassen für automatische Vergabe"
                  className="mt-1.5"
                />
                <p className="mt-1.5 text-xs text-meta">
                  Tragen Sie hier eine Nummer ein, um einen bestehenden Nummernkreis fortzuführen.
                  Der automatische Zähler bleibt dann unberührt und überspringt keine Nummer.
                </p>
              </div>
            </details>

          </div>
        </div>

        {/* Aktionsleiste. In der Schublade sitzt sie durch flex-shrink-0 in einer
            Hülle mit fester Höhe ohnehin unten; auf der eigenen Seite hat die Hülle
            keine Höhe (h-full läuft dort ins Leere), weshalb sie zusätzlich sticky
            am unteren Rand klebt. Die Schublade scrollt nicht, dort bleibt sticky
            ohne Wirkung — der Hintergrund ist nötig, damit auf der Seite kein Inhalt
            durchscheint (bg-background entspricht der Hintergrundfarbe beider Hüllen). */}
        <div
          className="sticky bottom-0 z-10 flex-shrink-0 border-t bg-background px-6 py-4"
          style={{ borderColor: 'var(--border-default)' }}
        >
          {/* Erklärt den gesperrten Knopf — zurückhaltend und erst, wenn die
              Firmendaten geladen sind. Volltext der Fehler im title-Attribut. */}
          {!isCompanyLoading && !finalizeValidation.isValid && missingSections.length > 0 && (
            <p
              className="mb-3 text-xs"
              style={{ color: 'var(--text-secondary)' }}
              title={formatValidationErrors(finalizeValidation.errors)}
            >
              Zum Fertigstellen fehlt noch: {missingSections.join(', ')}.
              {missingCompanyData && (
                <>
                  {' '}
                  <a
                    href="/settings"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Einstellungen öffnen →
                  </a>
                </>
              )}
            </p>
          )}

          {/* Plausibilitätshinweis, kein Riegel: Das Fertigstellen bleibt
              möglich, der Fehler wird aber nicht stumm übernommen. Eigene Farbe,
              damit er nicht als "fehlt noch" gelesen wird — gesperrt ist der
              Knopf dadurch nämlich nicht. */}
          {dateWarnings.length > 0 && (
            <p className="mb-3 text-xs" style={{ color: 'var(--status-warning)' }}>
              {dateWarnings.map((w) => w.message).join(' ')}
            </p>
          )}
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
                onClick={handlePreview}
                disabled={isPreviewLoading || isSaving || isFinalizing || isDeleting || lineItems.length === 0}
                variant="outline"
                className="text-sm"
              >
                {isPreviewLoading ? (
                  <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4 mr-2" />
                )}
                Vorschau
              </Button>
              <Button
                onClick={handleSaveDraft}
                disabled={isSaving || isFinalizing || isDeleting}
                variant="outline"
                className="text-sm"
              >
                {isSaving && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
                {isSaved ? 'Aktualisieren' : 'Als Entwurf speichern'}
              </Button>
              <Button
                onClick={() => setFinalizeConfirmOpen(true)}
                disabled={isFinalizing || isSaving || isDeleting || !finalizeValidation.isValid}
                className="text-sm"
              >
                {isFinalizing ? (
                  <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Rechnung fertigstellen
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

        {/* Finalize Confirmation Dialog */}
        <Dialog open={finalizeConfirmOpen} onOpenChange={setFinalizeConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rechnung fertigstellen?</DialogTitle>
              <DialogDescription>
                Die Rechnung erhält eine endgültige, fortlaufende Rechnungsnummer und kann
                danach nicht mehr bearbeitet werden. PDF und E-Rechnung (XRechnung/ZUGFeRD)
                werden erzeugt.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFinalizeConfirmOpen(false)} disabled={isFinalizing}>
                Abbrechen
              </Button>
              <Button onClick={() => { setFinalizeConfirmOpen(false); handleFinalize() }} disabled={isFinalizing}>
                {isFinalizing && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
                Jetzt fertigstellen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* PDF Preview Dialog */}
        <Dialog open={previewDialogOpen} onOpenChange={(open) => {
          setPreviewDialogOpen(open)
          if (!open && previewUrl) {
            URL.revokeObjectURL(previewUrl)
            setPreviewUrl(null)
          }
        }}>
          <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>PDF Vorschau</DialogTitle>
              <DialogDescription>
                Vorschau der Rechnung. Die finale Rechnung erhält eine echte Rechnungsnummer.
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0">
              {previewUrl && (
                <iframe
                  src={previewUrl}
                  className="w-full h-full border rounded-lg"
                  title="PDF Preview"
                />
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setPreviewDialogOpen(false)
                  if (previewUrl) {
                    URL.revokeObjectURL(previewUrl)
                    setPreviewUrl(null)
                  }
                }}
              >
                Schließen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ContactDrawerProvider>
  )
}
