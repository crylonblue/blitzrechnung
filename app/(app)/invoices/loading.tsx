import { TableSkeleton } from '@/components/ui/table-skeleton'

// Spiegelt InvoicesTable: Suchzeile, dann fünf Status-Umschalter (h-[34px],
// höher als die Popover-Knöpfe) mit Trennern, "Überfällig", Zeitraum und
// Betrag — deshalb hat die Filterzeile hier mehr Chips als bei den Entwürfen.
export default function Loading() {
  return (
    <TableSkeleton
      titleWidth="w-32"
      subtitleWidth="w-48"
      actionWidths={['w-36']}
      headerAlign="start"
      filterChips={[
        'h-[34px] w-24',
        'h-[34px] w-28',
        'h-[34px] w-24',
        'h-[34px] w-24',
        'h-[34px] w-24',
        'mx-1 h-6 w-px',
        'h-[34px] w-24',
        'mx-1 h-6 w-px',
        'h-8 w-24',
        'h-8 w-24',
      ]}
      rows={8}
      columns={[
        { head: 'w-28', cell: 'h-5 w-28' },
        { head: 'w-20', cell: 'h-5 w-40' },
        { head: 'w-12', cell: 'h-5 w-20', align: 'right' },
        { head: 'w-24', cell: 'h-5 w-24' },
        { head: 'w-12', cell: 'h-6 w-16' },
        // Versand-Knopf ohne Überschrift.
        { cell: 'h-8 w-8', width: 'w-[50px]' },
      ]}
    />
  )
}
