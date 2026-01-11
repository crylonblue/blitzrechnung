'use client'

import { useState, useEffect } from 'react'
import { Invoice, Company, PartySnapshot, EmailSettings } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LoaderCircle, FileText, FileCode } from 'lucide-react'
import { toast } from 'sonner'
import {
  generateEmailSubject,
  generateEmailBody,
} from '@/lib/email-templates'

interface SendInvoiceModalProps {
  invoice: Invoice
  isOpen: boolean
  onClose: () => void
  onSent: () => void
}

export default function SendInvoiceModal({
  invoice,
  isOpen,
  onClose,
  onSent,
}: SendInvoiceModalProps) {
  const supabase = createClient()
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [company, setCompany] = useState<Company | null>(null)

  const buyerSnapshot = invoice.buyer_snapshot as PartySnapshot | null

  // Form state
  const [recipientEmail, setRecipientEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  // Load company data and initialize form when modal opens
  useEffect(() => {
    if (isOpen) {
      loadCompanyAndInitialize()
    }
  }, [isOpen, invoice])

  const loadCompanyAndInitialize = async () => {
    setIsLoading(true)
    setError(null)

    const { data: companyData, error: companyError } = await supabase
      .from('companies')
      .select('*')
      .eq('id', invoice.company_id)
      .single()

    if (companyError || !companyData) {
      setError('Fehler beim Laden der Firmendaten')
      setIsLoading(false)
      return
    }

    setCompany(companyData)

    // Initialize form values
    const emailSettings = (companyData.email_settings as EmailSettings) || { mode: 'default' }

    if (buyerSnapshot) {
      // Set recipient email from invoice or buyer
      setRecipientEmail(invoice.recipient_email || buyerSnapshot.email || '')

      // Generate subject and body from templates
      setSubject(generateEmailSubject(emailSettings.invoice_email_subject, invoice, buyerSnapshot))
      setBody(generateEmailBody(emailSettings.invoice_email_body, invoice, buyerSnapshot))
    }

    setIsLoading(false)
  }

  const handleSend = async () => {
    if (!recipientEmail) {
      setError('Bitte geben Sie eine E-Mail-Adresse ein.')
      return
    }

    if (!subject) {
      setError('Bitte geben Sie einen Betreff ein.')
      return
    }

    setIsSending(true)
    setError(null)

    try {
      const response = await fetch(`/api/invoices/${invoice.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_email: recipientEmail,
          subject,
          body,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Fehler beim Versenden')
      }

      toast.success('Rechnung versendet', {
        description: `Die Rechnung wurde an ${recipientEmail} gesendet.`,
      })

      onSent()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Versenden')
    } finally {
      setIsSending(false)
    }
  }

  const hasAttachments = invoice.pdf_url || invoice.xml_url

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Rechnung versenden</DialogTitle>
          <DialogDescription>
            Senden Sie die Rechnung {invoice.invoice_number} per E-Mail.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <LoaderCircle className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        ) : (
          <>
            {error && (
              <div className="message-error text-sm">
                {error}
              </div>
            )}

            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="recipient_email">An</Label>
                <Input
                  id="recipient_email"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="rechnung@kunde.de"
                  className="mt-1.5"
                />
              </div>

              <div>
                <Label htmlFor="subject">Betreff</Label>
                <Input
                  id="subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-1.5"
                />
              </div>

              <div>
                <Label htmlFor="body">Nachricht</Label>
                <textarea
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="mt-1.5 w-full min-h-[120px] rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800"
                />
              </div>

              {hasAttachments && (
                <div>
                  <Label className="mb-2 block">Anhänge</Label>
                  <div className="space-y-2">
                    {invoice.pdf_url && (
                      <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                        <FileText className="h-4 w-4" />
                        <span>{invoice.invoice_number}.pdf</span>
                      </div>
                    )}
                    {invoice.xml_url && (
                      <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                        <FileCode className="h-4 w-4" />
                        <span>{invoice.invoice_number}.xml (XRechnung/ZUGFeRD)</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={isSending}>
                Abbrechen
              </Button>
              <Button onClick={handleSend} disabled={isSending || !recipientEmail || !company}>
                {isSending && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
                Jetzt senden
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
