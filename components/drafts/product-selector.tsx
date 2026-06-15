'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Product } from '@/types'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Check, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useProductDrawer } from '@/contexts/product-drawer-context'
import { getUnitLabel } from '@/lib/units'

interface ProductSelectorProps {
  companyId: string
  selectedProductId?: string
  onSelect: (product: Product) => void
  onOpenDrawer?: () => void
}

export default function ProductSelector({
  companyId,
  selectedProductId,
  onSelect,
  onOpenDrawer,
}: ProductSelectorProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const { openDrawer } = useProductDrawer()
  const supabase = useMemo(() => createClient(), [])

  const loadProducts = useCallback(async () => {
    setIsLoading(true)
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('company_id', companyId)
      .order('name')

    if (data) {
      setProducts(data)
    }
    setIsLoading(false)
  }, [companyId, supabase])

  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  const filteredProducts = products.filter((product) =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (product.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
  )

  const handleSelectProduct = (product: Product) => {
    onSelect(product)
    setSearchQuery('')
  }

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(price)
  }

  // This component is designed to be embedded in a popover/dropdown
  // The ProductDrawer should be rendered by the parent component
  return (
    <Command className="flex flex-col">
      <CommandInput
        placeholder="Artikel suchen..."
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList className="flex-1 max-h-[200px] overflow-y-auto">
        <CommandEmpty>
          {isLoading ? 'Lädt...' : 'Keine Vorlagen gefunden.'}
        </CommandEmpty>
        <CommandGroup>
          {filteredProducts.map((product) => {
            const isSelected = selectedProductId === product.id
            return (
              <CommandItem
                key={product.id}
                value={product.name}
                onSelect={() => handleSelectProduct(product)}
                style={{
                  backgroundColor: isSelected ? 'rgba(45, 45, 45, 0.08)' : 'transparent',
                  transition: 'background-color 0.2s ease, color 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'rgba(45, 45, 45, 0.04)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    isSelected ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <div className="flex flex-col">
                  <span style={{ color: isSelected ? 'var(--text-primary)' : undefined }}>
                    {product.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatPrice(product.unit_price)} / {getUnitLabel(product.unit)}
                  </span>
                </div>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
      <div className="border-t border-zinc-200 dark:border-zinc-700 p-1 flex-shrink-0">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => {
            // Always open the drawer
            openDrawer()
            // Also call the optional callback for additional handling (e.g., setting pending item)
            if (onOpenDrawer) {
              onOpenDrawer()
            }
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Neue Vorlage erstellen
        </Button>
      </div>
    </Command>
  )
}
