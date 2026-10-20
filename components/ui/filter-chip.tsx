"use client"

import * as React from "react"
import { Check, ChevronDown, Plus, X } from "lucide-react"
import { Button } from "./button"
import { cn } from "@/lib/utils"

/**
 * Chip einer Filterleiste — ruhend `⊕ Status`, mit Auswahl `⊗ Status ● Bezahlt ⌄`.
 *
 * Das Kreuz leert nur diese eine Dimension und muss deshalb ein eigener Knopf
 * sein; Knöpfe lassen sich nicht ineinander verschachteln, also liegen beide
 * nebeneinander in einer gemeinsamen Pille. Die äußeren Eigenschaften landen
 * auf dem Hauptknopf, damit `<PopoverTrigger asChild>` den Chip direkt
 * umschließen kann.
 */
export const FilterChip = React.forwardRef<
  HTMLButtonElement,
  // `value` muss aus den Button-Eigenschaften heraus: Dort ist es der
  // Formularwert (string | number | readonly string[]) und kollidiert mit
  // dem Anzeigewert des Chips, der auch null sein darf.
  Omit<React.ComponentProps<"button">, "value"> & {
    /** Name der Dimension, immer sichtbar. */
    label: string
    /** Gewählter Wert, z. B. `Bezahlt +2`; fehlt er, ruht der Chip. */
    value?: string | null
    /** Farbpunkt vor dem Wert, z. B. `bg-emerald-500` aus STATUS_CONFIG. */
    dotClass?: string
    /** Leert diese Dimension; ohne Handler zeigt der Chip das Plus. */
    onClear?: () => void
    /** Chips ohne Aufklappmenü (Ja/Nein) führen keinen Pfeil. */
    hideChevron?: boolean
  }
>(function FilterChip(
  { label, value, dotClass, onClear, hideChevron, className, ...props },
  ref
) {
  const active = Boolean(value) || Boolean(onClear)

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border text-sm transition-colors duration-150",
        // Der Akzent trägt Rahmen und Fläche; der Text bleibt neutral, weil das
        // gedeckte Akzentblau auf der hellen Akzentfläche zu wenig Kontrast hat.
        active
          ? "border-brand bg-brand-light text-neutral-900"
          : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900",
        className
      )}
    >
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Filter ${label} entfernen`}
          className="flex h-[34px] items-center pl-2.5 pr-1 opacity-70 hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        ref={ref}
        type="button"
        className={cn(
          "flex h-[34px] items-center gap-1.5 rounded-full pr-3 font-medium",
          onClear ? "pl-1" : "pl-3"
        )}
        {...props}
      >
        {!onClear && <Plus className="h-3.5 w-3.5" />}
        <span>{label}</span>
        {value && (
          <>
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                dotClass || "bg-neutral-400"
              )}
            />
            {/* Mehrfachauswahl kommt als "Bezahlt +2" herein, damit die Leiste
                nicht mit jeder weiteren Auswahl breiter wird. */}
            <span className="max-w-[12rem] truncate font-normal">{value}</span>
          </>
        )}
        {!hideChevron && <ChevronDown className="h-3 w-3 opacity-60" />}
      </button>
    </div>
  )
})

/**
 * Eine Zeile im Aufklappmenü. `role` unterscheidet Mehrfach- von Einfachauswahl:
 * Beim Zeitraum schließt eine Wahl die anderen aus, das muss auch der
 * Screenreader hören — sichtbar unterscheiden sich nur eckiges und rundes Kästchen.
 */
export function FilterChipOption({
  label,
  checked,
  onSelect,
  dotClass,
  role = "checkbox",
}: {
  label: string
  checked: boolean
  onSelect: () => void
  dotClass?: string
  role?: "checkbox" | "radio"
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-50"
    >
      <span
        aria-hidden
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center border transition-colors",
          role === "radio" ? "rounded-full" : "rounded-[4px]",
          checked
            ? "border-brand bg-brand text-white"
            : "border-neutral-300 bg-white"
        )}
      >
        {checked &&
          (role === "radio" ? (
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
          ) : (
            <Check className="h-3 w-3" strokeWidth={3} />
          ))}
      </span>
      {dotClass && (
        <span
          aria-hidden
          className={cn("h-2 w-2 shrink-0 rounded-full", dotClass)}
        />
      )}
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * Rahmen für den Inhalt eines Chip-Menüs: Liste oben, „Anwenden" unten.
 *
 * Der Knopf gehört in den Rahmen, weil erst er die Auswahl übernimmt — ohne ihn
 * wäre nicht erkennbar, dass das Angehakte noch nicht wirkt.
 */
export function FilterChipMenu({
  children,
  onApply,
}: {
  children: React.ReactNode
  onApply: () => void
}) {
  return (
    <div>
      <div className="space-y-0.5">{children}</div>
      <Button size="sm" className="mt-3 w-full" onClick={onApply}>
        Anwenden
      </Button>
    </div>
  )
}
