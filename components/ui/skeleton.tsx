/**
 * Platzhalter für Inhalt, der noch geladen wird.
 *
 * Bewusst sehr zurückhaltend animiert: Die App wirbt mit einer ruhigen
 * Oberfläche, und ein pulsierendes Raster ist beim Seitenwechsel schnell
 * unruhiger als die Wartezeit, die es überbrücken soll.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-zinc-200/70 dark:bg-zinc-800/70 ${className}`}
    />
  )
}
