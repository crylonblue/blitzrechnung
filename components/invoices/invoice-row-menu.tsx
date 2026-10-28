'use client'

import { useState } from 'react'
import { Copy, Ellipsis, LoaderCircle, SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface InvoiceRowMenuProps {
  onSend: () => void
  /** Fehlt bei Belegen, die keine Vorlage sind (Stornorechnung) — dann entfällt der Eintrag. */
  onDuplicate?: () => void
  isDuplicating?: boolean
}

/**
 * Aktionen einer Zeile der Rechnungsliste hinter einem Knopf.
 *
 * Auf Popover statt eines Dropdown-Menüs, weil das Projekt nur jenes hat.
 * Klicks im Menü dürfen die Zeile nicht erreichen: React-Ereignisse laufen auch
 * durch Portale nach oben, und ein Klick auf „Duplizieren" würde sonst
 * zusätzlich die Rechnungsschublade öffnen.
 */
export default function InvoiceRowMenu({ onSend, onDuplicate, isDuplicating }: InvoiceRowMenuProps) {
  const [open, setOpen] = useState(false)

  const choose = (action: () => void) => {
    setOpen(false)
    action()
  }

  const itemClass =
    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:outline-none disabled:opacity-50 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label="Aktionen"
          onClick={(e) => e.stopPropagation()}
        >
          {isDuplicating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Ellipsis className="h-4 w-4" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1" onClick={(e) => e.stopPropagation()}>
        <button type="button" className={itemClass} onClick={() => choose(onSend)}>
          <SendHorizontal className="h-4 w-4" />
          Per E-Mail versenden
        </button>
        {onDuplicate && (
          <button type="button" className={itemClass} onClick={() => choose(onDuplicate)} disabled={isDuplicating}>
            <Copy className="h-4 w-4" />
            Duplizieren
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
