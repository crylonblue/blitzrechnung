import { TableSkeleton } from '@/components/ui/table-skeleton'

// Kontakte haben keine Filterleiste.
export default function Loading() {
  return <TableSkeleton rows={6} withToolbar={false} />
}
