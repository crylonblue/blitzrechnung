'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { useDraftDrawer } from '@/contexts/draft-drawer-context'
import { Invoice } from '@/types'

interface DraftItemProps {
  draft: Invoice
  companyName?: string
}

export default function DraftItem({ draft, companyName }: DraftItemProps) {
  const { openDrawer } = useDraftDrawer()
  const buyerSnapshot = draft.buyer_snapshot as any
  const lineItems = draft.line_items as any[]
  const total = draft.total_amount || 0
  const buyerName = draft.buyer_is_self 
    ? (companyName || 'Eigene Firma')
    : (buyerSnapshot?.name || 'Kein Empfänger')

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    openDrawer(draft.id)
  }

  return (
    <Link
      href={`/drafts/${draft.id}`}
      onClick={handleClick}
      className="card block transition-colors hover:border-[var(--border-strong)]"
      style={{ textDecoration: 'none' }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
              {buyerName}
            </h3>
            <span className="status-badge info">
              Entwurf
            </span>
          </div>
          <p className="mt-2 text-meta">
            {lineItems?.length || 0} Position{lineItems?.length !== 1 ? 'en' : ''} •{' '}
            {format(new Date(draft.created_at), 'd. MMMM yyyy', { locale: de })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {new Intl.NumberFormat('de-DE', {
              style: 'currency',
              currency: 'EUR',
            }).format(total)}
          </p>
        </div>
      </div>
    </Link>
  )
}

