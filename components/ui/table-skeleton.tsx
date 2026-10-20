import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table'

/**
 * Eine Spalte im Skelett.
 *
 * Kopf- und Zellenbalken werden getrennt angegeben: Der Kopf deutet die
 * Überschrift an, die Zelle den Inhalt — und deren Höhe (Textzeile, Badge oder
 * Icon-Knopf) bestimmt am Ende die Zeilenhöhe.
 */
export type TableSkeletonColumn = {
  /** Breite des Kopfbalkens; ohne Angabe bleibt die Spalte im Kopf leer. */
  head?: string
  /** Klassen des Zellenbalkens, inklusive Höhe (z. B. `h-8 w-8` für Icon-Knöpfe). */
  cell: string
  /** Rechtsbündige Spalten (Beträge) müssen auch im Skelett rechts stehen. */
  align?: 'right'
  /** Feste Spaltenbreite der echten Tabelle, z. B. `w-[100px]`. */
  width?: string
}

/**
 * Ladezustand für die Listenseiten (Rechnungen, Entwürfe, Kontakte).
 *
 * Das Skelett benutzt dieselben Tabellen-Bausteine wie die fertige Seite,
 * damit Rahmen, Kopfhöhe, Zellenpolster und Zeilentrenner nicht von Hand
 * nachgebaut (und beim nächsten Umbau vergessen) werden. Weicht das Skelett von
 * der fertigen Tabelle ab, springt der Inhalt beim Umschalten — und ein
 * springendes Layout wirkt langsamer als gar kein Skelett.
 *
 * Die drei Seiten unterscheiden sich in Spalten, Kopfknöpfen und Filterleiste;
 * genau diese Unterschiede kommen über Props herein, statt eingeebnet zu werden.
 */
export function TableSkeleton({
  columns,
  rows = 8,
  titleWidth = 'w-32',
  subtitleWidth = 'w-72',
  actionWidths = ['w-32'],
  headerAlign = 'center',
  filterChips,
}: {
  columns: TableSkeletonColumn[]
  rows?: number
  titleWidth?: string
  subtitleWidth?: string
  /** Breiten der Knöpfe rechts im Seitenkopf — Kontakte haben zwei. */
  actionWidths?: string[]
  /** Rechnungen richten den Kopf oben aus (`items-start`), die anderen mittig. */
  headerAlign?: 'center' | 'start'
  /** Filter-Chips der Werkzeugleiste; ohne Angabe entfällt sie (Kontakte). */
  filterChips?: string[]
}) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      {/* Höhen folgen .text-headline (24px/1.3), .text-meta (13px/1.5) und Button h-9. */}
      <div
        className={cn(
          'mb-12 flex justify-between gap-4',
          headerAlign === 'start' ? 'items-start' : 'items-center'
        )}
      >
        <div>
          <Skeleton className={cn('h-8', titleWidth)} />
          <Skeleton className={cn('mt-2 h-5', subtitleWidth)} />
        </div>
        <div className="flex items-center gap-2">
          {actionWidths.map((width, i) => (
            <Skeleton key={i} className={cn('h-9', width)} />
          ))}
        </div>
      </div>

      {filterChips && (
        <div className="mb-6 space-y-4">
          {/* Suche über die volle Breite — <Input> ist py-2 + 20px Textzeile + Rahmen. */}
          <Skeleton className="h-[38px] w-full" />
          <div className="flex flex-wrap items-center gap-2">
            {filterChips.map((chip, i) => (
              <Skeleton key={i} className={chip} />
            ))}
            {/* Trefferzahl ganz rechts. */}
            <Skeleton className="ml-auto h-5 w-24" />
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column, i) => (
              <TableHead key={i} className={column.width}>
                {column.head && (
                  <Skeleton
                    className={cn(
                      'h-3',
                      column.head,
                      column.align === 'right' && 'ml-auto'
                    )}
                  />
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, row) => (
            <TableRow key={row}>
              {columns.map((column, i) => (
                <TableCell key={i}>
                  <Skeleton
                    className={cn(
                      column.cell,
                      column.align === 'right' && 'ml-auto'
                    )}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
