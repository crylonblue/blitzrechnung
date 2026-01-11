'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import { Invoice } from '@/types'
import { useInvoiceDrawer } from '@/contexts/invoice-drawer-context'
import { isOverdue, getStatusLabel, getStatusClass } from '@/lib/invoice-utils'
import { Button } from '@/components/ui/button'
import { SendHorizontal } from 'lucide-react'
import SendInvoiceModal from './send-invoice-modal'
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
  const [sendModalInvoice, setSendModalInvoice] = useState<Invoice | null>(null)

  const handleSendClick = (e: React.MouseEvent, invoice: Invoice) => {
    e.stopPropagation()
    setSendModalInvoice(invoice)
  }

  const handleSent = () => {
    setSendModalInvoice(null)
    router.refresh()
  }

  return (
    <>
      <Table>
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
          {invoices.map((invoice) => {
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
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={(e) => handleSendClick(e, invoice)}
                    title="Per E-Mail versenden"
                  >
                    <SendHorizontal className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

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

