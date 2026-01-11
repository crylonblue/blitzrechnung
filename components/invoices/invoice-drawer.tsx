'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useInvoiceDrawer } from '@/contexts/invoice-drawer-context'
import { Invoice, PartySnapshot, LineItem } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { User, ShoppingCart, FileText, FileCode, Check, SendHorizontal } from 'lucide-react'
import SendInvoiceModal from './send-invoice-modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { isOverdue, getStatusLabel, getStatusClass } from '@/lib/invoice-utils'

type InvoiceStatus = 'created' | 'sent' | 'reminded' | 'paid' | 'cancelled'

const AVAILABLE_STATUSES: InvoiceStatus[] = ['created', 'sent', 'reminded', 'paid', 'cancelled']

export default function InvoiceDrawer() {
  const { isOpen, invoiceId, closeDrawer } = useInvoiceDrawer()
  const router = useRouter()
  const supabase = createClient()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [companyName, setCompanyName] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const [isDownloadingXml, setIsDownloadingXml] = useState(false)
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [recipientEmail, setRecipientEmail] = useState('')
  const [isSavingEmail, setIsSavingEmail] = useState(false)
  const [showSendModal, setShowSendModal] = useState(false)

  useEffect(() => {
    if (isOpen && invoiceId) {
      loadInvoice(invoiceId)
    }
  }, [isOpen, invoiceId])

  const loadInvoice = async (id: string) => {
    setIsLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !data) {
      setError(fetchError?.message || 'Fehler beim Laden der Rechnung')
      setIsLoading(false)
      return
    }

    setInvoice(data)
    setRecipientEmail(data.recipient_email || '')

    // Load company name
    const { data: company } = await supabase
      .from('companies')
      .select('name')
      .eq('id', data.company_id)
      .single()

    setCompanyName(company?.name || null)
    setIsLoading(false)
  }

  const buyerSnapshot = invoice?.buyer_snapshot as PartySnapshot | null
  const buyerName = invoice?.buyer_is_self 
    ? (companyName || 'Eigene Firma')
    : (buyerSnapshot?.name || 'Unbekannter Empfänger')
  const lineItems = (invoice?.line_items as unknown as LineItem[]) || []

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(amount)
  }

  const calculateGrossAmount = (item: LineItem) => {
    return item.total * (1 + item.vat_rate / 100)
  }

  const handleStatusChange = async (newStatus: string) => {
    if (!invoice || newStatus === invoice.status) return

    setIsUpdatingStatus(true)
    const { error } = await supabase
      .from('invoices')
      .update({ status: newStatus })
      .eq('id', invoice.id)

    if (error) {
      toast.error('Fehler beim Aktualisieren des Status')
    } else {
      setInvoice({ ...invoice, status: newStatus as InvoiceStatus })
      toast.success(`Status auf "${getStatusLabel(newStatus)}" geändert`)
      router.refresh() // Aktualisiert die Tabelle
    }
    setIsUpdatingStatus(false)
  }

  const handleSaveRecipientEmail = async () => {
    if (!invoice) return

    setIsSavingEmail(true)
    const { error } = await supabase
      .from('invoices')
      .update({ recipient_email: recipientEmail || null })
      .eq('id', invoice.id)

    if (error) {
      toast.error('Fehler beim Speichern der E-Mail-Adresse')
    } else {
      setInvoice({ ...invoice, recipient_email: recipientEmail || null })
      toast.success('E-Mail-Adresse gespeichert')
    }
    setIsSavingEmail(false)
  }

const handleDownloadPdf = async () => {
    if (!invoice) return

    setIsDownloadingPdf(true)
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/pdf`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Fehler beim Laden der PDF')
      }

      window.open(data.pdf_url || data.url, '_blank')
    } catch (err) {
      console.error('Error downloading PDF:', err)
    } finally {
      setIsDownloadingPdf(false)
    }
  }

  const handleDownloadXml = async () => {
    if (!invoice) return

    setIsDownloadingXml(true)
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/pdf`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Fehler beim Laden der XML')
      }

      if (data.xml_url) {
        window.open(data.xml_url, '_blank')
      }
    } catch (err) {
      console.error('Error downloading XML:', err)
    } finally {
      setIsDownloadingXml(false)
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeDrawer()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 bg-background flex flex-col"
        style={{ maxWidth: '28rem', backgroundColor: 'rgb(250, 250, 250)' }}
        onClose={closeDrawer}
      >
        <SheetTitle className="sr-only">Rechnungsdetails</SheetTitle>
        
        {isLoading ? (
          <div className="flex items-center justify-center flex-1 min-h-[200px]">
            <p className="text-secondary">Lädt...</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center flex-1 min-h-[200px]">
            <div className="message-error">{error}</div>
          </div>
        ) : invoice ? (
          <div className="flex flex-col h-full">
            {/* Header Section */}
            <div className="p-6 pt-12">
              {/* Status Badges */}
              <div className="flex items-center gap-2 mb-3">
                <span className={getStatusClass(invoice.status)}>
                  {getStatusLabel(invoice.status)}
                </span>
                {isOverdue(invoice) && (
                  <span className="status-badge error">
                    Überfällig
                  </span>
                )}
              </div>

              {/* Recipient (Buyer) */}
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                {buyerName}
              </h2>
              
              {/* Invoice Number */}
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                {invoice.invoice_number || 'Keine Rechnungsnummer'}
              </p>
              
              {/* Amount and Date */}
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                  {formatCurrency(invoice.total_amount)}
                </span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {invoice.invoice_date
                    ? format(new Date(invoice.invoice_date), 'd. MMM yyyy', { locale: de })
                    : '-'}
                </span>
              </div>
            </div>

            {/* Sender Section */}
            <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700">
                  <User className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
                </div>
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {companyName || 'Unbekannter Absender'}
                </span>
              </div>
            </div>

            {/* Line Items Section */}
            <div className="flex-1 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
              <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4">
                Positionen
              </h3>
              
              <div className="space-y-3">
                {lineItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                      <ShoppingCart className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    </div>
                    <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300 truncate">
                      {item.description || 'Ohne Beschreibung'}
                    </span>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {formatCurrency(calculateGrossAmount(item))}
                    </span>
                  </div>
                ))}
                
                {lineItems.length === 0 && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Keine Positionen vorhanden
                  </p>
                )}
              </div>

              {/* Status Dropdown */}
              <div className="mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <label className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2 block">
                  Status ändern
                </label>
                <Select
                  value={invoice.status}
                  onValueChange={handleStatusChange}
                  disabled={isUpdatingStatus}
                >
                  <SelectTrigger className="w-full bg-white dark:bg-zinc-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABLE_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {getStatusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Recipient Email */}
              <div className="mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <Label htmlFor="recipient_email" className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2 block">
                  Empfänger E-Mail
                </Label>
                <div className="flex gap-2 items-center">
                  <Input
                    id="recipient_email"
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="rechnung@kunde.de"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    onClick={handleSaveRecipientEmail}
                    disabled={isSavingEmail}
                    className="h-9 w-9 p-0 shrink-0"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                  E-Mail-Adresse für den Rechnungsversand
                </p>
              </div>

              {/* Download Buttons */}
              {(invoice.pdf_url || invoice.invoice_file_reference || invoice.xml_url) && (
                <div className="mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700 space-y-2">
                  {(invoice.pdf_url || invoice.invoice_file_reference) && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleDownloadPdf}
                      disabled={isDownloadingPdf}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      {isDownloadingPdf ? 'Lädt...' : 'PDF herunterladen'}
                    </Button>
                  )}
                  {invoice.xml_url && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleDownloadXml}
                      disabled={isDownloadingXml}
                    >
                      <FileCode className="h-4 w-4 mr-2" />
                      {isDownloadingXml ? 'Lädt...' : 'XML herunterladen (XRechnung/ZUGFeRD)'}
                    </Button>
                  )}
                  
                  {/* Send Email Button */}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowSendModal(true)}
                  >
                    <SendHorizontal className="h-4 w-4 mr-2" />
                    Per E-Mail versenden
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Send Invoice Modal */}
        {invoice && (
          <SendInvoiceModal
            invoice={invoice}
            isOpen={showSendModal}
            onClose={() => setShowSendModal(false)}
            onSent={() => {
              setShowSendModal(false)
              loadInvoice(invoice.id) // Reload to update status
              router.refresh()
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
