'use client'

import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { Contact } from '@/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useContactEditDrawer } from '@/contexts/contact-edit-drawer-context'

interface ContactsTableProps {
  contacts: Contact[]
}

export default function ContactsTable({ contacts }: ContactsTableProps) {
  const { openDrawer } = useContactEditDrawer()

  const formatAddress = (address: any) => {
    if (!address) return '-'
    const parts = []
    if (address.street && address.streetnumber) {
      parts.push(`${address.street} ${address.streetnumber}`)
    } else if (address.street) {
      parts.push(address.street)
    }
    if (address.zip && address.city) {
      parts.push(`${address.zip} ${address.city}`)
    }
    if (address.country) {
      parts.push(address.country)
    }
    return parts.length > 0 ? parts.join(', ') : '-'
  }

  const handleContactClick = (contactId: string) => {
    openDrawer(contactId)
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Adresse</TableHead>
          <TableHead>E-Mail</TableHead>
          <TableHead>USt-IdNr.</TableHead>
          <TableHead>Rechnungs-Präfix</TableHead>
          <TableHead>Erstellt am</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {contacts.map((contact) => {
          const address = contact.address as any

          return (
            <TableRow
              key={contact.id}
              className="cursor-pointer"
              onClick={() => handleContactClick(contact.id)}
            >
              <TableCell>
                <span
                  className="font-medium hover:underline"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {contact.name}
                </span>
              </TableCell>
              <TableCell style={{ color: 'var(--text-secondary)' }}>
                {formatAddress(address)}
              </TableCell>
              <TableCell style={{ color: 'var(--text-secondary)' }}>
                {contact.email || '-'}
              </TableCell>
              <TableCell style={{ color: 'var(--text-secondary)' }}>
                {contact.vat_id || '-'}
              </TableCell>
              <TableCell style={{ color: 'var(--text-secondary)' }}>
                {contact.invoice_number_prefix ? (
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
                    {contact.invoice_number_prefix}
                  </span>
                ) : '-'}
              </TableCell>
              <TableCell style={{ color: 'var(--text-secondary)' }}>
                {format(new Date(contact.created_at), 'd. MMM yyyy', { locale: de })}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
