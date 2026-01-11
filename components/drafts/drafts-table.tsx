'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { Trash2, LoaderCircle } from 'lucide-react'
import { useDraftDrawer } from '@/contexts/draft-drawer-context'
import { Invoice } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface DraftsTableProps {
  drafts: Invoice[]
  companyNames?: Record<string, string>
}

export default function DraftsTable({ drafts, companyNames = {} }: DraftsTableProps) {
  const { openDrawer } = useDraftDrawer()
  const router = useRouter()
  const supabase = createClient()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [draftToDelete, setDraftToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleRowClick = (draftId: string, e: React.MouseEvent) => {
    // Don't open drawer if clicking on action buttons
    if ((e.target as HTMLElement).closest('button')) {
      return
    }
    openDrawer(draftId)
  }

  const handleDeleteClick = (e: React.MouseEvent, draftId: string) => {
    e.stopPropagation()
    setDraftToDelete(draftId)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!draftToDelete) return

    setIsDeleting(true)
    setDeleteError(null)
    
    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', draftToDelete)
      .eq('status', 'draft')

    if (error) {
      console.error('Error deleting draft:', error)
      setDeleteError('Fehler beim Löschen des Entwurfs. Bitte versuchen Sie es erneut.')
      setIsDeleting(false)
      return
    }

    // Show success toast
    toast.success('Entwurf gelöscht', {
      description: 'Der Entwurf wurde erfolgreich gelöscht.',
    })

    setIsDeleting(false)
    setDeleteDialogOpen(false)
    setDraftToDelete(null)
    router.refresh()
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Empfänger</TableHead>
            <TableHead className="text-right">Betrag</TableHead>
            <TableHead>Erstellt am</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[100px]">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {drafts.map((draft) => {
            const buyerSnapshot = draft.buyer_snapshot as any
            const total = draft.total_amount || 0
            const buyerName = draft.buyer_is_self 
              ? (companyNames[draft.company_id] || 'Eigene Firma')
              : (buyerSnapshot?.name || 'Kein Empfänger')

            return (
              <TableRow
                key={draft.id}
                onClick={(e) => handleRowClick(draft.id, e)}
                className="cursor-pointer"
              >
                <TableCell>
                  <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {buyerName}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {new Intl.NumberFormat('de-DE', {
                      style: 'currency',
                      currency: 'EUR',
                    }).format(total)}
                  </div>
                </TableCell>
                <TableCell style={{ color: 'var(--text-secondary)' }}>
                  {format(new Date(draft.created_at), 'd. MMM yyyy', { locale: de })}
                </TableCell>
                <TableCell>
                  <span className="status-badge info">Entwurf</span>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => handleDeleteClick(e, draft.id)}
                    className="h-8 w-8 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" style={{ color: 'var(--status-error)' }} />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <Dialog open={deleteDialogOpen} onOpenChange={(open) => {
        setDeleteDialogOpen(open)
        if (!open) {
          setDeleteError(null)
          setDraftToDelete(null)
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Entwurf löschen?</DialogTitle>
            <DialogDescription>
              Möchten Sie diesen Entwurf wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div className="message-error">{deleteError}</div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false)
                setDeleteError(null)
                setDraftToDelete(null)
              }}
              disabled={isDeleting}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              variant="destructive"
            >
              {isDeleting && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

