import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Mehrzeiliges Eingabefeld, gestaltet wie `Input`, damit Formulare einheitlich
 * bleiben. Wächst nicht von selbst — die Zeilenzahl gibt der Aufrufer vor.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm',
        'placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400',
        'disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700',
        'resize-y',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
