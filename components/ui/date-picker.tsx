"use client"

import * as React from "react"
import { format } from "date-fns"
import { de } from "date-fns/locale"
import { CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerProps {
  value?: string | null
  onChange: (date: string | null) => void
  placeholder?: string
  className?: string
}

export function DatePicker({ value, onChange, placeholder = "Datum auswählen", className }: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  
  // Parse date string (YYYY-MM-DD) to Date object
  // Use UTC to avoid timezone issues when comparing dates
  const date = React.useMemo(() => {
    if (!value) return undefined
    // Handle YYYY-MM-DD format
    const parts = value.split('-')
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10)
      const month = parseInt(parts[1], 10) - 1 // Month is 0-indexed
      const day = parseInt(parts[2], 10)
      // Create date at noon UTC to avoid timezone issues
      return new Date(Date.UTC(year, month, day, 12, 0, 0))
    }
    return new Date(value)
  }, [value])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground",
            className
          )}
          style={{ height: 'auto', minHeight: '2.25rem' }}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "dd.MM.yyyy", { locale: de }) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 border-zinc-200 dark:border-zinc-700" align="start">
        {/* Kein locale nötig: Calendar ist von sich aus deutsch (siehe die
            Vorgabe locale={de} in components/ui/calendar.tsx). Hier eins
            mitzugeben hiesse nur, die Sprache an zwei Stellen zu pflegen —
            genau daran ist es vorher auseinandergelaufen. */}
        <Calendar
          mode="single"
          selected={date}
          onSelect={(selectedDate) => {
            if (selectedDate) {
              // Format as YYYY-MM-DD for database
              const year = selectedDate.getFullYear()
              const month = String(selectedDate.getMonth() + 1).padStart(2, '0')
              const day = String(selectedDate.getDate()).padStart(2, '0')
              onChange(`${year}-${month}-${day}`)
            } else {
              onChange(null)
            }
            setOpen(false)
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}

