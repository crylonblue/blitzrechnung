'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useInvoiceDrawer } from '@/contexts/invoice-drawer-context'
import { Invoice, PartySnapshot, LineItem } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import {
  User,
  ShoppingCart,
  Check,
  SendHorizontal,
  Ban,
  ExternalLink,
  LoaderCircle,
  Copy,
} from 'lucide-react'
import SendInvoiceModal from './send-invoice-modal'
import DunningAxis from './dunning-axis'
import { useDuplicateInvoice } from './use-duplicate-invoice'
import { useMahnstatus } from './use-dunning-status'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { isOverdue, getStatusLabel, getStatusClass } from '@/lib/invoice-utils'
import { istMahnbarerBeleg, istMahnbarerStatus } from '@/lib/dunning-claim'

type InvoiceStatus = 'created' | 'sent' | 'reminded' | 'paid' | 'cancelled'

// Manual status changes exclude 'cancelled' — cancellation only happens via the
// real Storno flow (which creates a Stornorechnung), not by flipping the status.
const AVAILABLE_STATUSES: InvoiceStatus[] = ['created', 'sent', 'reminded', 'paid']

export default function InvoiceDrawer() {
  const { isOpen, invoiceId, closeDrawer } = useInvoiceDrawer()
  const { duplicate, duplicatingId } = useDuplicateInvoice()
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
  const [isCancelling, setIsCancelling] = useState(false)
  // Der Storno läuft über ein eigenes Modal statt über `window.confirm` —
  // siehe den Dialog am Ende der Datei.
  const [stornoDialogOffen, setStornoDialogOffen] = useState(false)
  const [cancellationInvoice, setCancellationInvoice] = useState<{ id: string; invoice_number: string } | null>(null)
  const [originalInvoice, setOriginalInvoice] = useState<{ id: string; invoice_number: string } | null>(null)

  /**
   * Der Mahnstatus, einmal für die ganze Schublade.
   *
   * Gefragt wird nur dort, wo es etwas zu holen gibt: nicht bei Entwürfen
   * (die den Empfänger nie erreicht haben) und nicht bei Stornorechnungen
   * (eine Gutschrift wird nicht gemahnt). Für alle anderen wird er geholt —
   * **auch** für bezahlte, stornierte und abgeschriebene Rechnungen. Das ist
   * neu und der Kern dieser Änderung: Bisher verschwand mit dem Mahnblock
   * auch der Verlauf, sobald die Rechnung bezahlt war. Genau dann will man
   * aber nachsehen können, was man geschickt hat.
   */
  const mahnstatusId =
    invoice && istMahnbarerBeleg(invoice) && invoice.status !== 'draft' ? invoice.id : null
  const { status: mahnstatus, neuLaden: mahnstatusNeuLaden } = useMahnstatus(mahnstatusId)

  useEffect(() => {
    if (isOpen && invoiceId) {
      loadInvoice(invoiceId)
    }
  }, [isOpen, invoiceId])

  const loadInvoice = async (id: string) => {
    setIsLoading(true)
    setError(null)
    setCancellationInvoice(null)
    setOriginalInvoice(null)

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

    // If this is a cancelled invoice, check if a cancellation invoice exists
    if (data.status === 'cancelled' && (data as any).invoice_type !== 'cancellation') {
      const { data: cancellation } = await supabase
        .from('invoices')
        .select('id, invoice_number')
        .eq('cancelled_invoice_id', id)
        .single()
      
      if (cancellation) {
        setCancellationInvoice(cancellation)
      }
    }

    // If this is a cancellation invoice, load the original invoice info
    if ((data as any).invoice_type === 'cancellation' && (data as any).cancelled_invoice_id) {
      const { data: original } = await supabase
        .from('invoices')
        .select('id, invoice_number')
        .eq('id', (data as any).cancelled_invoice_id)
        .single()
      
      if (original) {
        setOriginalInvoice(original)
      }
    }

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
      // Der Mahnstatus trägt die Empfängeradresse mit (`mail.empfaenger`, aus
      // `invoice.recipient_email` abgeleitet). Ohne dieses Nachladen bliebe er
      // auf dem Stand vom Öffnen der Schublade: Die Achse nennt dann die alte
      // Adresse, das Mahnschreiben ginge dorthin, und der Nutzer hat die neue
      // eine Zeile darüber soeben gespeichert. Genau dieser Fehler war es.
      mahnstatusNeuLaden()
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

  const handleCreateCancellation = async () => {
    if (!invoice) return

    setIsCancelling(true)
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/cancel`, {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.details || 'Fehler beim Erstellen der Stornorechnung')
      }

      toast.success(`Stornorechnung ${data.cancellationInvoice.invoice_number} erstellt`)

      // Erst nach dem Erfolg schliessen: Schlägt der Storno fehl, bleibt der
      // Dialog stehen und trägt die Fehlermeldung, statt den Nutzer mit einem
      // Toast vor einer unveränderten Schublade zurückzulassen.
      setStornoDialogOffen(false)

      // Reload invoice to show updated status
      loadInvoice(invoice.id)
      router.refresh()
    } catch (err) {
      console.error('Error creating cancellation invoice:', err)
      toast.error(err instanceof Error ? err.message : 'Fehler beim Erstellen der Stornorechnung')
    } finally {
      setIsCancelling(false)
    }
  }

  // Note: handleOpenInvoice is not used currently but can be enabled for navigation
  // const handleOpenInvoice = (invoiceIdToOpen: string) => {
  //   closeDrawer()
  //   setTimeout(() => openDrawer(invoiceIdToOpen), 100)
  // }

  // Check if this invoice can be cancelled
  const canBeCancelled = invoice && 
    invoice.status !== 'draft' && 
    invoice.status !== 'cancelled' && 
    (invoice as any).invoice_type !== 'cancellation' &&
    !cancellationInvoice

  // Check if this is a cancellation invoice
  const isCancellationInvoice = invoice && (invoice as any).invoice_type === 'cancellation'

  // Welche Dateien es überhaupt gibt. Die Bedingung ist unverändert die alte
  // des Download-Blocks — nur benannt, damit sie unten zweimal lesbar bleibt.
  const hatPdf = Boolean(invoice?.pdf_url || invoice?.invoice_file_reference)
  const hatXml = Boolean(invoice?.xml_url)
  const hatDateien = hatPdf || hatXml

  // Alles außer der Stornorechnung — die hat negierte Positionen und gehört zu
  // genau einer Rechnung. Der Server prüft dasselbe noch einmal.
  const kannDuplizieren = Boolean(invoice && !isCancellationInvoice)

  /**
   * Wird der Versand der **Rechnung** betont?
   *
   * Nur bei `created` — dem einzigen Status, in dem sicher ist, dass sie noch
   * nie draussen war (siehe `nextStatusAfterSend` in `lib/invoice-service`).
   * Dann ist der Versand der nächste Schritt, auch wenn sie bereits überfällig
   * ist.
   *
   * Der zweite Fall von früher ist entfallen: Bei einer zugestellten,
   * überfälligen Rechnung wurde hier das Mahnen betont. Das entscheidet jetzt
   * die Achse (`dunning-axis.tsx`), und sie kann es besser — sie kennt die
   * Leiter der Firma und weiss, welche Stufe dran ist. Zwei Stellen, die
   * dieselbe Betonung aus verschiedenen Quellen ableiten, laufen irgendwann
   * auseinander.
   */
  const betontDenVersand = invoice?.status === 'created'

  /**
   * Darf diese Rechnung überhaupt gemahnt werden?
   *
   * Früher hing der Mahnbereich an `isOverdue` — er erschien also erst, wenn
   * die Rechnung überfällig war. Eine Erinnerung **vor** Fälligkeit ist aber
   * zulässig und nützlich (sie stellt nur keinen Verzug fest, siehe den
   * vorbereiteten Text in `dunning-drawer.tsx`), und sie zu verstecken hiess,
   * sie unmöglich zu machen.
   *
   * Die Bedingung wird deshalb aus `lib/dunning-claim.ts` abgeleitet statt als
   * zweite Liste gepflegt: Dieselben zwei Fragen stellt die Route, bevor sie
   * rechnet — ist der **Beleg** seiner Natur nach eine Forderung (kein
   * Storno), und steht er in einem **Status**, in dem noch etwas offen ist
   * (nicht Entwurf, bezahlt, storniert oder uneinbringlich). Was hier
   * durchkommt, entscheidet am Ende ohnehin der Server: `DunningSection`
   * zeigt nichts, solange die Route `mahnbar: false` meldet.
   */
  const istMahnbar = Boolean(
    invoice && istMahnbarerBeleg(invoice) && istMahnbarerStatus(invoice.status)
  )

  /**
   * Nach einer Mahnänderung: beides neu holen.
   *
   * Die Rechnung, weil sich ihr Status geändert haben kann, und der
   * Mahnstatus, weil Verlauf und Ausblick daran hängen. Früher stand dieses
   * Paar auseinander — die Schublade lud die Rechnung, der Mahnblock seinen
   * eigenen Stand. Mit einer Quelle gibt es auch nur einen Auffrischpunkt.
   */
  const nachMahnaenderung = () => {
    if (!invoice) return
    mahnstatusNeuLaden()
    loadInvoice(invoice.id)
    router.refresh()
  }

  /**
   * Duplizieren: aus dieser Rechnung einen neuen Entwurf machen. Gleiches
   * Gewicht wie der Versand, aber nie betont — es ist nie der nächste Schritt
   * dieser Rechnung, sondern der Anfang der nächsten.
   */
  const duplizierenKnopf = invoice && (
    <Button
      variant="outline"
      className="w-full"
      onClick={() => duplicate(invoice.id)}
      disabled={duplicatingId === invoice.id}
    >
      {duplicatingId === invoice.id ? (
        <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Copy className="h-4 w-4 mr-2" />
      )}
      Duplizieren
    </Button>
  )

  /** Der Versandknopf, einmal betont und einmal gewöhnlich. */
  const versandKnopf = (
    <Button
      variant={betontDenVersand ? 'default' : 'outline'}
      className="w-full"
      onClick={() => setShowSendModal(true)}
    >
      <SendHorizontal className="h-4 w-4 mr-2" />
      Per E-Mail versenden
    </Button>
  )

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
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className={getStatusClass(invoice.status)}>
                  {getStatusLabel(invoice.status)}
                </span>
                {isCancellationInvoice && (
                  <span className="status-badge" style={{ backgroundColor: '#f97316', color: 'white' }}>
                    Stornorechnung
                  </span>
                )}
                {isOverdue(invoice) && (
                  <span className="status-badge error">
                    Überfällig
                  </span>
                )}
              </div>
              
              {/* Link to related invoice */}
              {cancellationInvoice && (
                <div className="mb-3 p-2 rounded-md bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                  <p className="text-xs text-orange-700 dark:text-orange-300 flex items-center gap-1">
                    <Ban className="h-3 w-3" />
                    Stornorechnung: {cancellationInvoice.invoice_number}
                  </p>
                </div>
              )}
              {originalInvoice && (
                <div className="mb-3 p-2 rounded-md bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" />
                    Storno zu: {originalInvoice.invoice_number}
                  </p>
                </div>
              )}

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

              {/* Der Mahnweg dieser Rechnung als eine Spur: was war, was dran
                  ist, was kommt. Steht **vor** dem Aktionsbereich, weil der
                  fällige Schritt seinen Knopf selbst trägt — der Aktionsstapel
                  darunter betrifft nur noch die Rechnung. */}
              <DunningAxis
                invoice={invoice}
                status={mahnstatus}
                hatPdf={hatPdf}
                hatXml={hatXml}
                onPdf={handleDownloadPdf}
                onXml={handleDownloadXml}
                pdfLaedt={isDownloadingPdf}
                xmlLaedt={isDownloadingXml}
                onGeaendert={nachMahnaenderung}
                empfaenger={buyerName}
                absender={companyName || 'Ihr Unternehmen'}
                istMahnbar={istMahnbar}
                onPaid={() => {
                  loadInvoice(invoice.id)
                  closeDrawer()
                }}
              />

              {/* Aktionsbereich — ein Stapel, eine Trennlinie.
                  Hier steht jetzt nur noch, was die **Rechnung** betrifft: sie
                  versenden, sie stornieren. Das Mahnen ist in die
                  Dokumentenliste darüber gewandert, wo auch die Mahnungen
                  stehen — ein Knopf namens „Dokument hinzufügen" gehört unter
                  die Dokumente und nicht zwischen Versand und Storno.
                  `empty:hidden` fängt den Randfall ab, dass es weder Datei
                  noch Storno gibt — dann bliebe sonst eine Trennlinie ohne
                  Inhalt stehen. */}
              {(hatDateien || kannDuplizieren) && (
                <div className="mt-6 space-y-2 border-t border-zinc-200 pt-4 empty:hidden dark:border-zinc-700">
                  {hatDateien && versandKnopf}
                  {kannDuplizieren && duplizierenKnopf}

                  {/* Storno: selten gebraucht, folgenreich, nicht rückgängig zu
                      machen — und deshalb kein Kasten im Gewicht eines
                      Downloads. Leiser Textknopf, abgesetzt vom Stapel; die
                      Bestätigung steht davor, jetzt als eigenes Modal. */}
                  {hatDateien && canBeCancelled && (
                    <div className="flex justify-center pt-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-zinc-500 hover:bg-orange-50 hover:text-orange-700 dark:text-zinc-400"
                        onClick={() => setStornoDialogOffen(true)}
                        disabled={isCancelling}
                      >
                        {isCancelling ? 'Erstelle Stornorechnung...' : 'Rechnung stornieren'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Stornieren bestätigen.

            Vorher stand hier `window.confirm` — der einzige Browserdialog in
            diesem Ablauf, während das Projekt überall sonst eigene Modale
            benutzt. Der Aufbau ist der des Löschen-Dialogs im Entwurfseditor
            (`components/drafts/draft-editor.tsx`): `Dialog` aus
            `components/ui/dialog.tsx` — Radix fängt damit den Fokus, schliesst
            auf Escape und beschriftet sich über Titel und Beschreibung —,
            abbrechen links, die folgenreiche Schaltfläche rechts als
            `destructive`, der laufende Vorgang als Spinner darin.

            Die Schaltfläche heisst nicht „Stornieren", sondern nennt das, was
            entsteht: Der Klick legt einen Beleg mit eigener fortlaufender
            Nummer an, und das ist etwas anderes als ein Schalter, den man
            wieder umlegt. */}
        {invoice && (
          <Dialog open={stornoDialogOffen} onOpenChange={setStornoDialogOffen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rechnung stornieren?</DialogTitle>
                <DialogDescription>
                  Zu Rechnung {invoice.invoice_number || 'ohne Nummer'} wird eine
                  Stornorechnung mit einer eigenen fortlaufenden Nummer erstellt. Die
                  Rechnung selbst wird dadurch als „Storniert“ markiert.
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Das lässt sich nicht rückgängig machen: Die Stornorechnung ist ein Beleg
                und bleibt bestehen, auch wenn Sie es sich anders überlegen.
              </p>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setStornoDialogOffen(false)}
                  disabled={isCancelling}
                >
                  Abbrechen
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleCreateCancellation}
                  disabled={isCancelling}
                >
                  {isCancelling && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
                  Stornorechnung erstellen
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

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
