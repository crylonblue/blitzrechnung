'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Contact, Address } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Check, ChevronsUpDown, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COUNTRIES } from '@/lib/countries'

interface ContactEditorProps {
  contact: Contact
}

export default function ContactEditor({ contact: initialContact }: ContactEditorProps) {
  const router = useRouter()
  const supabase = createClient()
  const initialAddress = initialContact.address as unknown as Address
  const [contact, setContact] = useState({
    name: initialContact.name,
    street: initialAddress?.street || '',
    city: initialAddress?.city || '',
    zip: initialAddress?.zip || '',
    country: initialAddress?.country || 'DE',
    email: initialContact.email || '',
    vat_id: initialContact.vat_id || '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countryOpen, setCountryOpen] = useState(false)
  const [countrySearchQuery, setCountrySearchQuery] = useState('')

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)

    const { error: updateError } = await supabase
      .from('contacts')
      .update({
        name: contact.name,
        address: {
          street: contact.street,
          city: contact.city,
          zip: contact.zip,
          country: contact.country,
        },
        email: contact.email || null,
        vat_id: contact.vat_id || null,
      })
      .eq('id', initialContact.id)

    if (updateError) {
      setError(updateError.message)
      setIsSaving(false)
    } else {
      router.refresh()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Kontakt bearbeiten</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Änderungen gelten nur für zukünftige Rechnungen
          </p>
        </div>
        <Link
          href="/contacts"
          className="text-sm font-medium text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          ← Zurück
        </Link>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Name *
            </label>
            <Input
              type="text"
              value={contact.name}
              onChange={(e) => setContact({ ...contact, name: e.target.value })}
              required
              className="mt-1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Straße
            </label>
            <Input
              type="text"
              value={contact.street}
              onChange={(e) => setContact({ ...contact, street: e.target.value })}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                PLZ
              </label>
              <Input
                type="text"
                value={contact.zip}
                onChange={(e) => setContact({ ...contact, zip: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Stadt
              </label>
              <Input
                type="text"
                value={contact.city}
                onChange={(e) => setContact({ ...contact, city: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Land
            </label>
            <Popover open={countryOpen} onOpenChange={setCountryOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={countryOpen}
                  className="mt-1 w-full justify-between"
                  style={{ height: 'auto', minHeight: '2.25rem' }}
                >
                  {contact.country
                    ? COUNTRIES.find((country) => country.code === contact.country)?.name || contact.country
                    : 'Land auswählen...'}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 border-zinc-200 dark:border-zinc-700" align="start">
                <Command className="flex flex-col">
                  <CommandInput
                    placeholder="Land suchen..."
                    value={countrySearchQuery}
                    onValueChange={setCountrySearchQuery}
                  />
                  <CommandList className="flex-1 max-h-[300px] overflow-y-auto">
                    <CommandEmpty>Kein Land gefunden.</CommandEmpty>
                    <CommandGroup>
                      {COUNTRIES.filter((country) =>
                        country.name.toLowerCase().includes(countrySearchQuery.toLowerCase()) ||
                        country.code.toLowerCase().includes(countrySearchQuery.toLowerCase())
                      ).map((country) => {
                        const isSelected = contact.country === country.code
                        return (
                          <CommandItem
                            key={country.code}
                            value={country.name}
                            onSelect={() => {
                              setContact({ ...contact, country: country.code })
                              setCountryOpen(false)
                              setCountrySearchQuery('')
                            }}
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
                            <span style={{ color: isSelected ? 'var(--text-primary)' : undefined }}>
                              {country.name} ({country.code})
                            </span>
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              E-Mail
            </label>
            <Input
              type="email"
              value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
              className="mt-1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              USt-IdNr.
            </label>
            <Input
              type="text"
              value={contact.vat_id}
              onChange={(e) => setContact({ ...contact, vat_id: e.target.value })}
              className="mt-1"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Link
              href="/contacts"
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Abbrechen
            </Link>
            <button
              onClick={handleSave}
              disabled={isSaving || !contact.name}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
            >
              {isSaving && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
              Speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
