import { TableSkeleton } from '@/components/ui/table-skeleton'

// Spiegelt InvoiceFiltersToolbar: Suchzeile, darunter vier Filter-Chips
// (Status, Überfällig, Zeitraum, Betrag) in Pillenform mit 34 px Höhe und
// rechts die Trefferzahl. Der Link "Filter löschen" erscheint erst, wenn ein
// Filter gesetzt ist — beim Laden ist er nie da und gehört deshalb nicht ins
// Skelett.
export default function Loading() {
  return (
    <TableSkeleton
      titleWidth="w-32"
      subtitleWidth="w-48"
      actionWidths={['w-36']}
      headerAlign="start"
      filterChips={[
        'h-[34px] w-24 rounded-full',
        'h-[34px] w-28 rounded-full',
        'h-[34px] w-28 rounded-full',
        'h-[34px] w-24 rounded-full',
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
