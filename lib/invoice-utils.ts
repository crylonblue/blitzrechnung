import { Invoice } from '@/types'

export function isOverdue(invoice: Invoice): boolean {
  if (!invoice.due_date) return false
  if (['paid', 'cancelled', 'draft'].includes(invoice.status)) return false
  // Ein Storno-Beleg erbt Status 'created' und das Fälligkeitsdatum der
  // Ursprungsrechnung, ist aber eine Gutschrift — aus ihm wird nie eine
  // überfällige Forderung.
  if (invoice.invoice_type === 'cancellation') return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const dueDate = new Date(invoice.due_date)
  dueDate.setHours(0, 0, 0, 0)
  
  return dueDate < today
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return 'Entwurf'
    case 'created':
      return 'Erstellt'
    case 'sent':
      return 'Versendet'
    case 'reminded':
      return 'Gemahnt'
    case 'paid':
      return 'Bezahlt'
    case 'cancelled':
      return 'Storniert'
    default:
      return status
  }
}

export function getStatusClass(status: string): string {
  switch (status) {
    case 'created':
      return 'status-badge info'
    case 'sent':
      return 'status-badge warning'
    case 'reminded':
      return 'status-badge warning'
    case 'paid':
      return 'status-badge success'
    case 'cancelled':
      return 'status-badge error'
    default:
      return 'status-badge info'
  }
}
