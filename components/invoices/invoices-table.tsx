'use client'

import { useState, useCallback } from 'react'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import { Invoice } from '@/types'
import { useInvoiceDrawer } from '@/contexts/invoice-drawer-context'
import { isOverdue, getStatusLabel, getStatusClass } from '@/lib/invoice-utils'
import SendInvoiceModal from './send-invoice-modal'
import InvoiceRowMenu from './invoice-row-menu'
import { useDuplicateInvoice } from './use-duplicate-invoice'
import { InvoiceFiltersToolbar } from './invoice-filters'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface InvoicesTableProps {
  invoices: Invoice[]
  companyNames?: Record<string, string>
}

export default function InvoicesTable({ invoices, companyNames = {} }: InvoicesTableProps) {
  const router = useRouter()
  const { openDrawer } = useInvoiceDrawer()
  const { duplicate, duplicatingId } = useDuplicateInvoice()
  const [sendModalInvoice, setSendModalInvoice] = useState<Invoice | null>(null)
  const [filteredInvoices, setFilteredInvoices] = useState<Invoice[]>(invoices)

  const handleFilteredInvoicesChange = useCallback((filtered: Invoice[]) => {
    setFilteredInvoices(filtered)
  }, [])

  const handleSent = () => {
    setSendModalInvoice(null)
    router.refresh()
  }

  return (
    <>
      <InvoiceFiltersToolbar
        invoices={invoices}
        onFilteredInvoicesChange={handleFilteredInvoicesChange}
        companyNames={companyNames}
      />

      {filteredInvoices.length === 0 ? (
        <div className="card card-subtle p-12 text-center">
          <p className="text-secondary">Keine Rechnungen gefunden.</p>
          <p className="text-meta mt-1">Versuchen Sie, die Filter anzupassen.</p>
        </div>
      ) : (
        // Mindestbreite, damit die Tabelle bei schmalem Fenster seitlich scrollt
        // (der Container in `ui/table.tsx` scrollt schon) statt die Spalten
        // zusammenzuquetschen.
        <Table className="min-w-[56rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Rechnungsnummer</TableHead>
              <TableHead>Empfänger</TableHead>
              <TableHead className="text-right">Betrag</TableHead>
              <TableHead>Rechnungsdatum</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInvoices.map((invoice) => {
            const buyerSnapshot = invoice.buyer_snapshot as any
            const buyerName = invoice.buyer_is_self 
              ? (companyNames[invoice.company_id] || 'Eigene Firma')
              : (buyerSnapshot?.name || 'Unbekannter Empfänger')

            return (
              <TableRow
                key={invoice.id}
                className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                onClick={() => openDrawer(invoice.id)}
              >
                <TableCell>
                  <span
                    className="font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {invoice.invoice_number || 'Keine Nummer'}
                  </span>
                </TableCell>
                <TableCell style={{ color: 'var(--text-secondary)' }}>
                  {buyerName}
                </TableCell>
                <TableCell className="text-right">
                  <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {new Intl.NumberFormat('de-DE', {
                      style: 'currency',
                      currency: 'EUR',
                    }).format(invoice.total_amount)}
                  </div>
                </TableCell>
                <TableCell style={{ color: 'var(--text-secondary)' }}>
                  {invoice.invoice_date
                    ? format(new Date(invoice.invoice_date), 'd. MMM yyyy', { locale: de })
                    : '-'}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className={getStatusClass(invoice.status)}>
                      {getStatusLabel(invoice.status)}
                    </span>
                    {isOverdue(invoice) && (
                      <span className="status-badge error">
                        Überfällig
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <InvoiceRowMenu
                    onSend={() => setSendModalInvoice(invoice)}
                    // Eine Stornorechnung ist keine Vorlage — dort entfällt der Eintrag.
                    onDuplicate={invoice.invoice_type === 'cancellation' ? undefined : () => duplicate(invoice.id)}
                    isDuplicating={duplicatingId === invoice.id}
                  />
                </TableCell>
              </TableRow>
            )
          })}
          </TableBody>
        </Table>
      )}

      {sendModalInvoice && (
        <SendInvoiceModal
          invoice={sendModalInvoice}
          isOpen={!!sendModalInvoice}
          onClose={() => setSendModalInvoice(null)}
          onSent={handleSent}
        />
      )}
    </>
  )
}

