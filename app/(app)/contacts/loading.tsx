import { TableSkeleton } from '@/components/ui/table-skeleton'

// Kontakte haben keine Filterleiste, dafür zwei Kopfknöpfe (Importieren, Neuer
// Kontakt) und sechs reine Textspalten — ohne Knopf bleiben die Zeilen flacher,
// also passen mehr davon ohne Scrollen ins Bild.
export default function Loading() {
  return (
    <TableSkeleton
      titleWidth="w-24"
      subtitleWidth="w-80"
      actionWidths={['w-32', 'w-36']}
      rows={10}
      columns={[
        { head: 'w-10', cell: 'h-5 w-32' },
        { head: 'w-14', cell: 'h-5 w-48' },
        { head: 'w-12', cell: 'h-5 w-40' },
        { head: 'w-16', cell: 'h-5 w-24' },
        { head: 'w-28', cell: 'h-5 w-10' },
        { head: 'w-20', cell: 'h-5 w-24' },
      ]}
    />
  )
}
