"use client"

import * as React from "react"
import { useState, useMemo, useCallback, useEffect } from "react"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import {
  FilterChip,
  FilterChipMenu,
  FilterChipOption,
} from "@/components/ui/filter-chip"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Invoice } from "@/types"
import { isOverdue } from "@/lib/invoice-utils"

// Status configuration with colors
const STATUS_CONFIG = {
  created: { label: "Erstellt", colorClass: "bg-blue-500" },
  sent: { label: "Versendet", colorClass: "bg-amber-500" },
  reminded: { label: "Gemahnt", colorClass: "bg-orange-500" },
  paid: { label: "Bezahlt", colorClass: "bg-emerald-500" },
  cancelled: { label: "Storniert", colorClass: "bg-neutral-500" },
} as const

type InvoiceStatus = keyof typeof STATUS_CONFIG

const STATUS_ORDER = Object.keys(STATUS_CONFIG) as InvoiceStatus[]

// Time period presets
const TIME_PERIODS = [
  { id: "all", label: "Alle" },
  { id: "this_month", label: "Dieser Monat" },
  { id: "last_month", label: "Letzter Monat" },
  { id: "this_quarter", label: "Dieses Quartal" },
  { id: "last_quarter", label: "Letztes Quartal" },
  { id: "this_year", label: "Dieses Jahr" },
  { id: "custom", label: "Benutzerdefiniert" },
] as const

type TimePeriod = (typeof TIME_PERIODS)[number]["id"]

export interface InvoiceFilters {
  search: string
  /**
   * Leere Menge heißt „keine Einschränkung" — passend zum ruhenden Chip `⊕ Status`.
   * Früher stand dafür „alle fünf ausgewählt"; beides zeigt dieselben Rechnungen,
   * weil die Seite Entwürfe schon in der Abfrage ausschließt und damit nur diese
   * fünf Status erreichen.
   */
  statuses: Set<InvoiceStatus>
  showOverdue: boolean
  timePeriod: TimePeriod
  dateFrom: string | null
  dateTo: string | null
  amountMin: string
  amountMax: string
}

const DEFAULT_FILTERS: InvoiceFilters = {
  search: "",
  statuses: new Set(),
  showOverdue: false,
  timePeriod: "all",
  dateFrom: null,
  dateTo: null,
  amountMin: "",
  amountMax: "",
}

interface InvoiceFiltersProps {
  invoices: Invoice[]
  onFilteredInvoicesChange: (filtered: Invoice[]) => void
  companyNames?: Record<string, string>
}

export function InvoiceFiltersToolbar({
  invoices,
  onFilteredInvoicesChange,
  companyNames = {},
}: InvoiceFiltersProps) {
  const [filters, setFilters] = useState<InvoiceFilters>(DEFAULT_FILTERS)
  const [statusOpen, setStatusOpen] = useState(false)
  const [datePopoverOpen, setDatePopoverOpen] = useState(false)
  const [amountPopoverOpen, setAmountPopoverOpen] = useState(false)

  // Entwurf je Menü: Angehaktes wirkt erst mit „Anwenden". Beim Öffnen wird der
  // Entwurf aus dem angewendeten Stand neu gesetzt — wer ohne „Anwenden"
  // schließt (Klick daneben, Escape), verwirft damit automatisch.
  const [statusDraft, setStatusDraft] = useState<Set<InvoiceStatus>>(new Set())
  const [periodDraft, setPeriodDraft] = useState({
    timePeriod: "all" as TimePeriod,
    dateFrom: null as string | null,
    dateTo: null as string | null,
  })
  const [amountDraft, setAmountDraft] = useState({ min: "", max: "" })

  // Calculate date ranges for time periods
  const getDateRange = useCallback((period: TimePeriod): { from: Date | null; to: Date | null } => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()

    switch (period) {
      case "this_month":
        return {
          from: new Date(year, month, 1),
          to: new Date(year, month + 1, 0),
        }
      case "last_month":
        return {
          from: new Date(year, month - 1, 1),
          to: new Date(year, month, 0),
        }
      case "this_quarter": {
        const quarterStart = Math.floor(month / 3) * 3
        return {
          from: new Date(year, quarterStart, 1),
          to: new Date(year, quarterStart + 3, 0),
        }
      }
      case "last_quarter": {
        const currentQuarterStart = Math.floor(month / 3) * 3
        const lastQuarterStart = currentQuarterStart - 3
        const lastQuarterYear = lastQuarterStart < 0 ? year - 1 : year
        const adjustedStart = lastQuarterStart < 0 ? lastQuarterStart + 12 : lastQuarterStart
        return {
          from: new Date(lastQuarterYear, adjustedStart, 1),
          to: new Date(lastQuarterYear, adjustedStart + 3, 0),
        }
      }
      case "this_year":
        return {
          from: new Date(year, 0, 1),
          to: new Date(year, 11, 31),
        }
      default:
        return { from: null, to: null }
    }
  }, [])

  // Filter invoices based on all criteria
  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      // Status filter (leere Auswahl = alle Status)
      if (
        filters.statuses.size > 0 &&
        !filters.statuses.has(invoice.status as InvoiceStatus)
      ) {
        return false
      }

      // Overdue filter (only show overdue if enabled)
      if (filters.showOverdue && !isOverdue(invoice)) {
        return false
      }

      // Search filter
      if (filters.search.trim()) {
        const searchLower = filters.search.toLowerCase()
        const buyerSnapshot = invoice.buyer_snapshot as any
        const buyerName = invoice.buyer_is_self
          ? (companyNames[invoice.company_id] || "")
          : (buyerSnapshot?.name || "")

        const searchableFields = [
          invoice.invoice_number,
          buyerName,
          invoice.total_amount?.toString(),
        ].filter(Boolean)

        const matches = searchableFields.some((field) =>
          field?.toLowerCase().includes(searchLower)
        )
        if (!matches) return false
      }

      // Date filter
      if (filters.timePeriod !== "all") {
        let dateFrom: Date | null = null
        let dateTo: Date | null = null

        if (filters.timePeriod === "custom") {
          dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null
          dateTo = filters.dateTo ? new Date(filters.dateTo) : null
        } else {
          const range = getDateRange(filters.timePeriod)
          dateFrom = range.from
          dateTo = range.to
        }

        if (invoice.invoice_date) {
          const invoiceDate = new Date(invoice.invoice_date)
          if (dateFrom && invoiceDate < dateFrom) return false
          if (dateTo && invoiceDate > dateTo) return false
        }
      }

      // Amount filter
      const minAmount = filters.amountMin ? parseFloat(filters.amountMin) : null
      const maxAmount = filters.amountMax ? parseFloat(filters.amountMax) : null

      if (minAmount !== null && invoice.total_amount < minAmount) return false
      if (maxAmount !== null && invoice.total_amount > maxAmount) return false

      return true
    })
  }, [invoices, filters, companyNames, getDateRange])

  // Notify parent of filtered results
  useEffect(() => {
    onFilteredInvoicesChange(filteredInvoices)
  }, [filteredInvoices, onFilteredInvoicesChange])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      filters.search !== "" ||
      filters.statuses.size > 0 ||
      filters.showOverdue ||
      filters.timePeriod !== "all" ||
      filters.amountMin !== "" ||
      filters.amountMax !== ""
    )
  }, [filters])

  // Beschriftung des Status-Chips: erste Auswahl ausgeschrieben, der Rest als
  // Zähler — fünf Beschriftungen nebeneinander würden die Leiste sprengen.
  const statusChip = useMemo(() => {
    const selected = STATUS_ORDER.filter((status) => filters.statuses.has(status))
    if (selected.length === 0) return null
    const [first, ...rest] = selected
    return {
      value:
        rest.length > 0
          ? `${STATUS_CONFIG[first].label} +${rest.length}`
          : STATUS_CONFIG[first].label,
      dotClass: STATUS_CONFIG[first].colorClass,
    }
  }, [filters.statuses])

  const timePeriodValue =
    filters.timePeriod === "all"
      ? null
      : TIME_PERIODS.find((p) => p.id === filters.timePeriod)?.label ?? null

  // Einzahl/Mehrzahl der Trefferzahl. Beide Formen richten sich nach der
  // Gesamtzahl, nicht nach der gefilterten: Im Satz „0 von 1 Rechnung" steht das
  // Wort hinter „von 1" und gehört grammatisch zu dieser Zahl — „0 von 1
  // Rechnungen" wäre falsch, „0 von 1 Rechnung" richtig. Dass damit dieselbe
  // Bedingung für beide Formen gilt, ist ein Nebeneffekt, kein Zufall.
  const invoiceNoun = `Rechnung${invoices.length === 1 ? "" : "en"}`

  const amountValue = useMemo(() => {
    if (filters.amountMin && filters.amountMax) {
      return `${filters.amountMin}€ – ${filters.amountMax}€`
    }
    if (filters.amountMin) return `ab ${filters.amountMin}€`
    if (filters.amountMax) return `bis ${filters.amountMax}€`
    return null
  }, [filters.amountMin, filters.amountMax])

  return (
    <div className="space-y-4 mb-6">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
        <Input
          placeholder="Suchen nach Rechnungsnummer, Empfänger oder Betrag..."
          value={filters.search}
          onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          className="pl-10 pr-10"
        />
        {filters.search && (
          <button
            onClick={() => setFilters((prev) => ({ ...prev, search: "" }))}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Status */}
        <Popover
          open={statusOpen}
          onOpenChange={(open) => {
            if (open) setStatusDraft(new Set(filters.statuses))
            setStatusOpen(open)
          }}
        >
          <PopoverTrigger asChild>
            <FilterChip
              label="Status"
              value={statusChip?.value}
              dotClass={statusChip?.dotClass}
              onClear={
                statusChip
                  ? () => setFilters((prev) => ({ ...prev, statuses: new Set() }))
                  : undefined
              }
            />
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            <FilterChipMenu
              onApply={() => {
                setFilters((prev) => ({ ...prev, statuses: new Set(statusDraft) }))
                setStatusOpen(false)
              }}
            >
              {STATUS_ORDER.map((status) => (
                <FilterChipOption
                  key={status}
                  label={STATUS_CONFIG[status].label}
                  dotClass={STATUS_CONFIG[status].colorClass}
                  checked={statusDraft.has(status)}
                  onSelect={() =>
                    setStatusDraft((prev) => {
                      const next = new Set(prev)
                      if (next.has(status)) next.delete(status)
                      else next.add(status)
                      return next
                    })
                  }
                />
              ))}
            </FilterChipMenu>
          </PopoverContent>
        </Popover>

        {/* Überfällig — Ja/Nein, deshalb schaltet der Chip direkt um: ein Menü
            mit einem einzigen Kästchen und „Anwenden" wäre ein Umweg. */}
        <FilterChip
          label="Überfällig"
          hideChevron
          onClear={
            filters.showOverdue
              ? () => setFilters((prev) => ({ ...prev, showOverdue: false }))
              : undefined
          }
          onClick={() =>
            setFilters((prev) => ({ ...prev, showOverdue: !prev.showOverdue }))
          }
          aria-pressed={filters.showOverdue}
        />

        {/* Zeitraum */}
        <Popover
          open={datePopoverOpen}
          onOpenChange={(open) => {
            if (open) {
              setPeriodDraft({
                timePeriod: filters.timePeriod,
                dateFrom: filters.dateFrom,
                dateTo: filters.dateTo,
              })
            }
            setDatePopoverOpen(open)
          }}
        >
          <PopoverTrigger asChild>
            <FilterChip
              label="Zeitraum"
              value={timePeriodValue}
              onClear={
                filters.timePeriod !== "all"
                  ? () =>
                      setFilters((prev) => ({
                        ...prev,
                        timePeriod: "all",
                        dateFrom: null,
                        dateTo: null,
                      }))
                  : undefined
              }
            />
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <FilterChipMenu
              onApply={() => {
                setFilters((prev) => ({ ...prev, ...periodDraft }))
                setDatePopoverOpen(false)
              }}
            >
              <div role="radiogroup" aria-label="Zeitraum" className="space-y-0.5">
                {TIME_PERIODS.filter((p) => p.id !== "custom").map((period) => (
                  <FilterChipOption
                    key={period.id}
                    role="radio"
                    label={period.label}
                    checked={periodDraft.timePeriod === period.id}
                    // Ein Vorgabezeitraum verwirft die eigenen Daten, sonst bliebe
                    // beim Zurückschalten auf „Benutzerdefiniert" ein alter Rest stehen.
                    onSelect={() =>
                      setPeriodDraft({
                        timePeriod: period.id,
                        dateFrom: null,
                        dateTo: null,
                      })
                    }
                  />
                ))}
              </div>

              <div className="mt-2 border-t border-neutral-100 pt-2">
                <div className="px-2 py-1 text-xs font-medium uppercase text-neutral-500">
                  Benutzerdefiniert
                </div>
                <div className="space-y-2 p-2">
                  <div>
                    <label className="text-xs text-neutral-500 mb-1 block">Von</label>
                    <DatePicker
                      value={periodDraft.dateFrom}
                      onChange={(date) =>
                        setPeriodDraft((prev) => ({
                          ...prev,
                          timePeriod: "custom",
                          dateFrom: date,
                        }))
                      }
                      placeholder="Startdatum"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 mb-1 block">Bis</label>
                    <DatePicker
                      value={periodDraft.dateTo}
                      onChange={(date) =>
                        setPeriodDraft((prev) => ({
                          ...prev,
                          timePeriod: "custom",
                          dateTo: date,
                        }))
                      }
                      placeholder="Enddatum"
                    />
                  </div>
                </div>
              </div>
            </FilterChipMenu>
          </PopoverContent>
        </Popover>

        {/* Betrag */}
        <Popover
          open={amountPopoverOpen}
          onOpenChange={(open) => {
            if (open) {
              setAmountDraft({ min: filters.amountMin, max: filters.amountMax })
            }
            setAmountPopoverOpen(open)
          }}
        >
          <PopoverTrigger asChild>
            <FilterChip
              label="Betrag"
              value={amountValue}
              onClear={
                amountValue
                  ? () =>
                      setFilters((prev) => ({ ...prev, amountMin: "", amountMax: "" }))
                  : undefined
              }
            />
          </PopoverTrigger>
          <PopoverContent className="w-60 p-3" align="start">
            <FilterChipMenu
              onApply={() => {
                setFilters((prev) => ({
                  ...prev,
                  amountMin: amountDraft.min,
                  amountMax: amountDraft.max,
                }))
                setAmountPopoverOpen(false)
              }}
            >
              <div>
                <label className="text-xs text-neutral-500 mb-1 block">Mindestens</label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0,00"
                    value={amountDraft.min}
                    onChange={(e) =>
                      setAmountDraft((prev) => ({ ...prev, min: e.target.value }))
                    }
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">
                    €
                  </span>
                </div>
              </div>
              <div className="pt-2">
                <label className="text-xs text-neutral-500 mb-1 block">Höchstens</label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="∞"
                    value={amountDraft.max}
                    onChange={(e) =>
                      setAmountDraft((prev) => ({ ...prev, max: e.target.value }))
                    }
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">
                    €
                  </span>
                </div>
              </div>
            </FilterChipMenu>
          </PopoverContent>
        </Popover>

        {/* Rechte Gruppe: „Filter löschen" und Trefferzahl.
            Vorher trugen beide ein eigenes ml-auto; der freie Platz wurde damit
            zwischen ihnen aufgeteilt, der Abstand war also von der Fensterbreite
            abhängig und schrumpfte bei vollen Leisten auf null — dann las sich
            der Knopf wie eine Beschriftung der Zahl. Ein ml-auto auf der Gruppe
            schiebt beide gemeinsam nach rechts, der Abstand dazwischen ist fest. */}
        <div className="ml-auto flex items-center gap-4">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              // Akzentfarbe schon im Ruhezustand — wie bei „Alle anzeigen →" auf
              // dem Dashboard und „Ersten Entwurf erstellen →" in der Entwurfsliste.
              // Das Unterstreichen beim Darüberfahren bleibt eine Zugabe für die
              // Maus; erkennbar ist der Knopf auch ohne sie, also auch auf
              // Tastgeräten. `text-brand` ist derselbe Wert wie `var(--accent)`
              // und passt zu `border-brand` der Chips daneben.
              className="text-sm font-medium text-brand underline-offset-4 transition-colors hover:text-brand-hover hover:underline"
            >
              Filter löschen
            </button>
          )}

          {/* Results count */}
          <div className="text-sm text-neutral-500">
            {filteredInvoices.length === invoices.length ? (
              <span>
                {invoices.length} {invoiceNoun}
              </span>
            ) : (
              <span>
                {filteredInvoices.length} von {invoices.length} {invoiceNoun}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
