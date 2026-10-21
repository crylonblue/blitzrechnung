"use client"

import * as React from "react"
import { useState, useMemo, useCallback, useEffect } from "react"
import { Search, X, ChevronDown, Calendar, Euro } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { Invoice } from "@/types"

// Time period presets
const TIME_PERIODS = [
  { id: "all", label: "Alle" },
  { id: "today", label: "Heute" },
  { id: "this_week", label: "Diese Woche" },
  { id: "this_month", label: "Dieser Monat" },
  { id: "custom", label: "Benutzerdefiniert" },
] as const

type TimePeriod = (typeof TIME_PERIODS)[number]["id"]

export interface DraftFilters {
  search: string
  timePeriod: TimePeriod
  dateFrom: string | null
  dateTo: string | null
  amountMin: string
  amountMax: string
}

const DEFAULT_FILTERS: DraftFilters = {
  search: "",
  timePeriod: "all",
  dateFrom: null,
  dateTo: null,
  amountMin: "",
  amountMax: "",
}

interface DraftFiltersProps {
  drafts: Invoice[]
  onFilteredDraftsChange: (filtered: Invoice[]) => void
  companyNames?: Record<string, string>
}

export function DraftFiltersToolbar({
  drafts,
  onFilteredDraftsChange,
  companyNames = {},
}: DraftFiltersProps) {
  const [filters, setFilters] = useState<DraftFilters>(DEFAULT_FILTERS)
  const [datePopoverOpen, setDatePopoverOpen] = useState(false)
  const [amountPopoverOpen, setAmountPopoverOpen] = useState(false)

  // Calculate date ranges for time periods
  const getDateRange = useCallback((period: TimePeriod): { from: Date | null; to: Date | null } => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const day = now.getDate()
    const dayOfWeek = now.getDay()
    
    switch (period) {
      case "today":
        return {
          from: new Date(year, month, day),
          to: new Date(year, month, day, 23, 59, 59),
        }
      case "this_week": {
        const weekStart = new Date(year, month, day - dayOfWeek + (dayOfWeek === 0 ? -6 : 1))
        const weekEnd = new Date(weekStart)
        weekEnd.setDate(weekStart.getDate() + 6)
        return { from: weekStart, to: weekEnd }
      }
      case "this_month":
        return {
          from: new Date(year, month, 1),
          to: new Date(year, month + 1, 0),
        }
      default:
        return { from: null, to: null }
    }
  }, [])

  // Filter drafts based on all criteria
  const filteredDrafts = useMemo(() => {
    return drafts.filter((draft) => {
      // Search filter
      if (filters.search.trim()) {
        const searchLower = filters.search.toLowerCase()
        const buyerSnapshot = draft.buyer_snapshot as any
        const buyerName = draft.buyer_is_self
          ? (companyNames[draft.company_id] || "")
          : (buyerSnapshot?.name || "")
        
        const searchableFields = [
          buyerName,
          draft.total_amount?.toString(),
        ].filter(Boolean)

        const matches = searchableFields.some((field) =>
          field?.toLowerCase().includes(searchLower)
        )
        if (!matches) return false
      }

      // Date filter (based on created_at for drafts)
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

        if (draft.created_at) {
          const createdDate = new Date(draft.created_at)
          if (dateFrom && createdDate < dateFrom) return false
          if (dateTo && createdDate > dateTo) return false
        }
      }

      // Amount filter
      const minAmount = filters.amountMin ? parseFloat(filters.amountMin) : null
      const maxAmount = filters.amountMax ? parseFloat(filters.amountMax) : null
      
      if (minAmount !== null && (draft.total_amount || 0) < minAmount) return false
      if (maxAmount !== null && (draft.total_amount || 0) > maxAmount) return false

      return true
    })
  }, [drafts, filters, companyNames, getDateRange])

  // Notify parent of filtered results
  useEffect(() => {
    onFilteredDraftsChange(filteredDrafts)
  }, [filteredDrafts, onFilteredDraftsChange])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      filters.search !== "" ||
      filters.timePeriod !== "all" ||
      filters.amountMin !== "" ||
      filters.amountMax !== ""
    )
  }, [filters])

  // Reset all filters
  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS)
  }

  // Get active time period label
  const getTimePeriodLabel = () => {
    const period = TIME_PERIODS.find((p) => p.id === filters.timePeriod)
    if (filters.timePeriod === "custom" && (filters.dateFrom || filters.dateTo)) {
      return "Benutzerdefiniert"
    }
    return period?.label || "Zeitraum"
  }

  // Get amount filter label
  const getAmountLabel = () => {
    if (filters.amountMin && filters.amountMax) {
      return `${filters.amountMin}€ - ${filters.amountMax}€`
    }
    if (filters.amountMin) return `ab ${filters.amountMin}€`
    if (filters.amountMax) return `bis ${filters.amountMax}€`
    return "Betrag"
  }

  return (
    <div className="space-y-4 mb-6">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
        <Input
          placeholder="Suchen nach Empfänger oder Betrag..."
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
        {/* Time period filter */}
        <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "gap-1.5",
                filters.timePeriod !== "all" && "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
              )}
            >
              <Calendar className="h-3.5 w-3.5" />
              {getTimePeriodLabel()}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className="space-y-1">
              {TIME_PERIODS.filter((p) => p.id !== "custom").map((period) => (
                <button
                  key={period.id}
                  onClick={() => {
                    setFilters((prev) => ({
                      ...prev,
                      timePeriod: period.id,
                      dateFrom: null,
                      dateTo: null,
                    }))
                    setDatePopoverOpen(false)
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm rounded-md transition-colors",
                    filters.timePeriod === period.id
                      ? "bg-neutral-100 font-medium"
                      : "hover:bg-neutral-50"
                  )}
                >
                  {period.label}
                </button>
              ))}
              
              <div className="border-t border-neutral-100 pt-2 mt-2">
                <div className="px-3 py-1 text-xs font-medium text-neutral-500 uppercase">
                  Benutzerdefiniert
                </div>
                <div className="space-y-2 p-2">
                  <div>
                    <label className="text-xs text-neutral-500 mb-1 block">Von</label>
                    <DatePicker
                      value={filters.dateFrom}
                      onChange={(date) =>
                        setFilters((prev) => ({
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
                      value={filters.dateTo}
                      onChange={(date) =>
                        setFilters((prev) => ({
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
            </div>
          </PopoverContent>
        </Popover>

        {/* Amount filter */}
        <Popover open={amountPopoverOpen} onOpenChange={setAmountPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "gap-1.5",
                (filters.amountMin || filters.amountMax) &&
                  "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
              )}
            >
              <Euro className="h-3.5 w-3.5" />
              {getAmountLabel()}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-4" align="start">
            <div className="space-y-3">
              <div className="text-sm font-medium">Betragsbereich</div>
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-neutral-500 mb-1 block">Mindestens</label>
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0,00"
                      value={filters.amountMin}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, amountMin: e.target.value }))
                      }
                      className="pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">
                      €
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 mb-1 block">Höchstens</label>
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="∞"
                      value={filters.amountMax}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, amountMax: e.target.value }))
                      }
                      className="pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">
                      €
                    </span>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setFilters((prev) => ({ ...prev, amountMin: "", amountMax: "" }))
                  setAmountPopoverOpen(false)
                }}
              >
                Zurücksetzen
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Clear filters button */}
        {hasActiveFilters && (
          <>
            <div className="h-6 w-px bg-neutral-200 mx-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="gap-1.5 text-neutral-500 hover:text-neutral-900"
            >
              <X className="h-3.5 w-3.5" />
              Filter zurücksetzen
            </Button>
          </>
        )}

        {/* Results count */}
        <div className="ml-auto text-sm text-neutral-500">
          {/*
            Das Substantiv richtet sich nach der Gesamtzahl, auch in der
            gefilterten Form: Es steht hinter dem „von" samt Gesamtzahl und
            wird von dieser Zahl regiert. Bei einem einzigen Entwurf ist
            „0 von 1 Entwurf" richtig und die Mehrzahl falsch — umgekehrt ist
            „1 von 3 Entwürfen" richtig, obwohl die vordere Zahl 1 ist.
            Die zweite Form steht ausserdem im Dativ.
          */}
          {filteredDrafts.length === drafts.length ? (
            <span>
              {drafts.length} {drafts.length === 1 ? 'Entwurf' : 'Entwürfe'}
            </span>
          ) : (
            <span>
              {filteredDrafts.length} von {drafts.length}{' '}
              {drafts.length === 1 ? 'Entwurf' : 'Entwürfen'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
