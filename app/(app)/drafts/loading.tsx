import { TableSkeleton } from '@/components/ui/table-skeleton'

// Spiegelt DraftsTable: Suchzeile, zwei Filter-Chips ("Alle", "Betrag") und
// fünf Spalten, von denen der Löschknopf (h-8) die Zeilenhöhe setzt.
export default function Loading() {
  return (
    <TableSkeleton
      titleWidth="w-24"
      subtitleWidth="w-72"
      actionWidths={['w-32']}
      filterChips={['h-8 w-24', 'h-8 w-28']}
      rows={8}
      columns={[
        { head: 'w-20', cell: 'h-5 w-40' },
        { head: 'w-12', cell: 'h-5 w-20', align: 'right' },
        { head: 'w-20', cell: 'h-5 w-24' },
        // Status ist ein Badge (.status-badge), keine Textzeile.
        { head: 'w-12', cell: 'h-6 w-16' },
        { head: 'w-16', cell: 'h-8 w-8', width: 'w-[100px]' },
      ]}
    />
  )
}
