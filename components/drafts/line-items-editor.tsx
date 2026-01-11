'use client'

import { useState, useEffect } from 'react'
import { LineItem, Product } from '@/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { ProductDrawerProvider } from '@/contexts/product-drawer-context'
import ProductSelector from './product-selector'
import ProductDrawer from './product-drawer'
import { UNITS, getUnitLabel } from '@/lib/units'
import { Check, ChevronsUpDown, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

// NumberInput that allows empty state during editing and only commits on blur
interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  className?: string
  placeholder?: string
}

function NumberInput({ value, onChange, min, max, className, placeholder }: NumberInputProps) {
  const [localValue, setLocalValue] = useState(value.toString())
  
  // Sync with external value changes (e.g. from template selection)
  useEffect(() => {
    setLocalValue(value.toString())
  }, [value])
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value
    // Allow empty, numbers, and decimal point/comma
    if (input === '' || /^-?\d*[.,]?\d*$/.test(input)) {
      setLocalValue(input)
    }
  }
  
  const handleBlur = () => {
    // Convert comma to dot for parsing
    const normalized = localValue.replace(',', '.')
    let numValue = parseFloat(normalized)
    
    // Handle invalid or empty input
    if (isNaN(numValue)) {
      numValue = 0
    }
    
    // Apply min/max constraints
    if (min !== undefined && numValue < min) numValue = min
    if (max !== undefined && numValue > max) numValue = max
    
    setLocalValue(numValue.toString())
    onChange(numValue)
  }
  
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={(e) => e.target.select()}
      className={className}
      placeholder={placeholder}
    />
  )
}

interface LineItemsEditorProps {
  companyId: string
  lineItems: LineItem[]
  onChange: (items: LineItem[]) => void
}

export default function LineItemsEditor({ companyId, lineItems, onChange }: LineItemsEditorProps) {
  const [pendingTemplateItemId, setPendingTemplateItemId] = useState<string | null>(null)

  const addLineItem = () => {
    const newItem: LineItem = {
      id: crypto.randomUUID(),
      product_id: undefined,
      description: '',
      quantity: 1,
      unit: 'piece',
      unit_price: 0,
      vat_rate: 19,
      total: 0,
    }
    onChange([...lineItems, newItem])
  }

  const updateLineItem = (id: string, updates: Partial<LineItem>) => {
    const updated = lineItems.map((item) => {
      if (item.id === id) {
        const updatedItem = { ...item, ...updates }
        // Recalculate total
        updatedItem.total = updatedItem.quantity * updatedItem.unit_price
        return updatedItem
      }
      return item
    })
    onChange(updated)
  }

  const handleTemplateSelect = (itemId: string, product: Product) => {
    updateLineItem(itemId, {
      product_id: product.id,
      description: product.description || product.name,
      unit: product.unit,
      unit_price: product.unit_price,
      vat_rate: product.default_vat_rate,
    })
  }

  const handleNewProductFromDrawer = (product: Product) => {
    // If we have a pending item waiting for a template, apply it
    if (pendingTemplateItemId) {
      handleTemplateSelect(pendingTemplateItemId, product)
      setPendingTemplateItemId(null)
    }
  }

  const removeLineItem = (id: string) => {
    onChange(lineItems.filter((item) => item.id !== id))
  }

  return (
    <ProductDrawerProvider>
      <div className="space-y-4">
        {lineItems.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Noch keine Positionen hinzugefügt.
          </p>
        ) : (
          <div className="space-y-3">
            {lineItems.map((item, index) => (
              <LineItemCard
                key={item.id}
                item={item}
                index={index}
                companyId={companyId}
                onUpdate={(updates) => updateLineItem(item.id, updates)}
                onTemplateSelect={(product) => handleTemplateSelect(item.id, product)}
                onRemove={() => removeLineItem(item.id)}
                onOpenDrawer={() => setPendingTemplateItemId(item.id)}
              />
            ))}
          </div>
        )}

        <button
          onClick={addLineItem}
          className="w-full rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          + Position hinzufügen
        </button>
      </div>

      <ProductDrawer companyId={companyId} onSelect={handleNewProductFromDrawer} />
    </ProductDrawerProvider>
  )
}

interface LineItemCardProps {
  item: LineItem
  index: number
  companyId: string
  onUpdate: (updates: Partial<LineItem>) => void
  onTemplateSelect: (product: Product) => void
  onRemove: () => void
  onOpenDrawer: () => void
}

function LineItemCard({ item, index, companyId, onUpdate, onTemplateSelect, onRemove, onOpenDrawer }: LineItemCardProps) {
  const [unitOpen, setUnitOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="mb-3 flex items-start justify-between">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Position {index + 1}
        </span>
        <div className="flex items-center gap-2">
          {/* Template Button */}
          <Popover open={templateOpen} onOpenChange={setTemplateOpen}>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
              >
                <FileText className="h-3 w-3" />
                Vorlage
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="end">
              <ProductSelector
                companyId={companyId}
                selectedProductId={item.product_id}
                onSelect={(product) => {
                  onTemplateSelect(product)
                  setTemplateOpen(false)
                }}
                onOpenDrawer={() => {
                  setTemplateOpen(false)
                  onOpenDrawer()
                }}
              />
            </PopoverContent>
          </Popover>
          <button
            onClick={onRemove}
            className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
          >
            Entfernen
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {/* Description - always editable */}
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Beschreibung
          </label>
          <Input
            type="text"
            value={item.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="z.B. Beratungsleistung, Webentwicklung..."
            className="mt-1"
          />
        </div>

        {/* Quantity and Unit */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Menge
            </label>
            <NumberInput
              value={item.quantity}
              onChange={(quantity) => onUpdate({ quantity })}
              min={0}
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Einheit
            </label>
            <Popover open={unitOpen} onOpenChange={setUnitOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={unitOpen}
                  className="mt-1 w-full justify-between"
                >
                  {getUnitLabel(item.unit)}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Einheit suchen..." />
                  <CommandList className="max-h-[200px]">
                    <CommandEmpty>Keine Einheit gefunden.</CommandEmpty>
                    <CommandGroup>
                      {UNITS.map((unit) => {
                        const isSelected = item.unit === unit.value
                        return (
                          <CommandItem
                            key={unit.value}
                            value={unit.label}
                            onSelect={() => {
                              onUpdate({ unit: unit.value })
                              setUnitOpen(false)
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                isSelected ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            {unit.label}
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Price and VAT */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Einzelpreis (€)
            </label>
            <NumberInput
              value={item.unit_price}
              onChange={(unit_price) => onUpdate({ unit_price })}
              min={0}
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              MwSt. %
            </label>
            <NumberInput
              value={item.vat_rate}
              onChange={(vat_rate) => onUpdate({ vat_rate })}
              min={0}
              max={100}
              className="mt-1"
            />
          </div>
        </div>

        {/* Total */}
        <div className="text-right pt-2 border-t border-zinc-200 dark:border-zinc-700">
          <p className="text-sm font-medium text-black dark:text-zinc-50">
            Gesamt:{' '}
            {new Intl.NumberFormat('de-DE', {
              style: 'currency',
              currency: 'EUR',
            }).format(item.total)}
          </p>
        </div>
      </div>
    </div>
  )
}
