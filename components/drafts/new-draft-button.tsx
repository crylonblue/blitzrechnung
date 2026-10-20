'use client'

import { ReactNode, CSSProperties } from 'react'
import { useDraftDrawer } from '@/contexts/draft-drawer-context'

interface NewDraftButtonProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

/**
 * Öffnet die Entwurfs-Schublade, statt auf eine eigene Seite zu navigieren.
 * Nötig, weil die aufrufenden Seiten Server Components sind und dort kein
 * onClick möglich ist. Aussehen kommt komplett von außen (className/style),
 * damit die bestehenden Stellen unverändert wirken.
 */
export default function NewDraftButton({ children, className, style }: NewDraftButtonProps) {
  const { openDrawer } = useDraftDrawer()

  return (
    <button type="button" onClick={() => openDrawer(null)} className={className} style={style}>
      {children}
    </button>
  )
}
