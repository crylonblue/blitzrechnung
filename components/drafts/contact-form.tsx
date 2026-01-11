'use client'

import { useState } from 'react'
import { PartySnapshot, Address } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Check, ChevronsUpDown, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COUNTRIES } from '@/lib/countries'
import { Switch } from '@/components/ui/switch'

interface ContactFormProps {
  companyId: string
  onSave: (contact: PartySnapshot) => void
  onCancel: () => void
}

export default function ContactForm({ companyId, onSave, onCancel }: ContactFormProps) {
  const supabase = createClient()
  const [contact, setContact] = useState({
    name: '',
    street: '',
    streetnumber: '',
    city: '',
    zip: '',
    country: 'DE',
    email: '',
    vat_id: '',
    canBeSeller: false,
    invoice_number_prefix: '',
    tax_id: '',
    bank_iban: '',
    bank_name: '',
    bank_bic: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countryOpen, setCountryOpen] = useState(false)
  const [countrySearchQuery, setCountrySearchQuery] = useState('')

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault()
    }
    
    if (!contact.name || !contact.street || !contact.streetnumber || !contact.zip || !contact.city || !contact.country) {
      setError('Bitte füllen Sie alle Pflichtfelder aus.')
      return
    }

    setIsSaving(true)
    setError(null)

    // Build bank details object if any field is filled
    const bankDetails = (contact.bank_iban || contact.bank_name || contact.bank_bic) ? {
      iban: contact.bank_iban || null,
      bank_name: contact.bank_name || null,
      bic: contact.bank_bic || null,
    } : null

    try {
      // Create contact in database
      const { data, error: insertError } = await supabase
        .from('contacts')
        .insert({
          company_id: companyId,
          name: contact.name,
          address: {
            street: contact.street,
            streetnumber: contact.streetnumber,
            city: contact.city,
            zip: contact.zip,
            country: contact.country,
          },
          email: contact.email || null,
          vat_id: contact.vat_id || null,
          invoice_number_prefix: contact.canBeSeller ? contact.invoice_number_prefix || null : null,
          tax_id: contact.canBeSeller ? contact.tax_id || null : null,
          bank_details: contact.canBeSeller ? bankDetails : null,
        })
        .select()
        .single()

      if (insertError) {
        setError(insertError.message)
        setIsSaving(false)
        return
      }

      // Create snapshot for the draft
      const snapshot: PartySnapshot = {
        id: data.id,
        name: data.name,
        address: {
          street: contact.street,
          streetnumber: contact.streetnumber,
          city: contact.city,
          zip: contact.zip,
          country: contact.country,
        },
        email: contact.email || undefined,
        vat_id: contact.vat_id || undefined,
        invoice_number_prefix: contact.canBeSeller ? contact.invoice_number_prefix || undefined : undefined,
        tax_id: contact.canBeSeller ? contact.tax_id || undefined : undefined,
        bank_details: contact.canBeSeller && bankDetails ? {
          bank_name: bankDetails.bank_name || undefined,
          iban: bankDetails.iban || undefined,
          bic: bankDetails.bic || undefined,
        } : undefined,
      }

      onSave(snapshot)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Speichern')
    }
    
    setIsSaving(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 p-6 pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div>
          <h1 className="text-headline">Neuen Kontakt erstellen</h1>
          <p className="mt-2 text-meta">
            Erstellen Sie einen neuen Kontakt für Rechnungen
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex-shrink-0 px-6 pt-6 pb-4">
          <div className="message-error">
            {error}
          </div>
        </div>
      )}

      {/* Scrollable Content */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6" style={{ paddingTop: error ? '0' : '1.5rem' }}>
        <div className="space-y-4 pb-6">
          <div>
            <Label htmlFor="contact_name">Name *</Label>
            <Input
              id="contact_name"
              value={contact.name}
              onChange={(e) => setContact({ ...contact, name: e.target.value })}
              className="mt-1.5"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Label htmlFor="contact_street">Straße *</Label>
              <Input
                id="contact_street"
                value={contact.street}
                onChange={(e) => setContact({ ...contact, street: e.target.value })}
                className="mt-1.5"
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="contact_streetnumber">Hausnummer *</Label>
              <Input
                id="contact_streetnumber"
                value={contact.streetnumber}
                onChange={(e) => setContact({ ...contact, streetnumber: e.target.value })}
                className="mt-1.5"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contact_zip">PLZ *</Label>
              <Input
                id="contact_zip"
                value={contact.zip}
                onChange={(e) => setContact({ ...contact, zip: e.target.value })}
                className="mt-1.5"
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="contact_city">Stadt *</Label>
              <Input
                id="contact_city"
                value={contact.city}
                onChange={(e) => setContact({ ...contact, city: e.target.value })}
                className="mt-1.5"
                autoComplete="off"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="contact_country">Land *</Label>
            <Popover open={countryOpen} onOpenChange={setCountryOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className={cn(
                    "w-full justify-between mt-1.5",
                    !contact.country && "text-muted-foreground"
                  )}
                  style={{ height: 'auto', minHeight: '2.25rem' }}
                >
                  {contact.country
                    ? COUNTRIES.find((c) => c.code === contact.country)?.name
                    : "Land auswählen"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 border-zinc-200 dark:border-zinc-700" align="start">
                <Command>
                  <CommandInput
                    placeholder="Land suchen..."
                    value={countrySearchQuery}
                    onValueChange={setCountrySearchQuery}
                  />
                  <CommandList style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    <CommandEmpty>Kein Land gefunden.</CommandEmpty>
                    <CommandGroup>
                      {COUNTRIES.map((country) => {
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
                              color: isSelected ? 'var(--text-primary)' : '',
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                isSelected ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {country.name}
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
            <Label htmlFor="contact_email">E-Mail</Label>
            <Input
              id="contact_email"
              type="email"
              value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
              className="mt-1.5"
              autoComplete="off"
            />
          </div>

          <div>
            <Label htmlFor="contact_vat_id">USt-IdNr.</Label>
            <Input
              id="contact_vat_id"
              value={contact.vat_id}
              onChange={(e) => setContact({ ...contact, vat_id: e.target.value })}
              className="mt-1.5"
              autoComplete="off"
            />
          </div>

          {/* Seller Section */}
          <div className="pt-4 mt-4 border-t" style={{ borderColor: 'var(--border-default)' }}>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="canBeSeller" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Kann Rechnungen stellen
                </Label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  Aktivieren, wenn dieser Kontakt als Absender für Rechnungen verwendet werden kann
                </p>
              </div>
              <Switch
                id="canBeSeller"
                checked={contact.canBeSeller}
                onCheckedChange={(checked) => setContact({ ...contact, canBeSeller: checked })}
              />
            </div>
          </div>

          {contact.canBeSeller && (
            <div className="space-y-4 pl-4 border-l-2" style={{ borderColor: 'var(--border-default)' }}>
              <div>
                <Label htmlFor="invoice_number_prefix">Rechnungsnummer-Präfix</Label>
                <Input
                  id="invoice_number_prefix"
                  value={contact.invoice_number_prefix}
                  onChange={(e) => setContact({ ...contact, invoice_number_prefix: e.target.value.toUpperCase() })}
                  className="mt-1.5"
                  autoComplete="off"
                  placeholder="z.B. LISA"
                />
              </div>
              <div>
                <Label htmlFor="contact_tax_id">Steuernummer</Label>
                <Input
                  id="contact_tax_id"
                  value={contact.tax_id}
                  onChange={(e) => setContact({ ...contact, tax_id: e.target.value })}
                  className="mt-1.5"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="bank_iban">IBAN</Label>
                <Input
                  id="bank_iban"
                  value={contact.bank_iban}
                  onChange={(e) => setContact({ ...contact, bank_iban: e.target.value })}
                  className="mt-1.5"
                  autoComplete="off"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="bank_name">Bank</Label>
                  <Input
                    id="bank_name"
                    value={contact.bank_name}
                    onChange={(e) => setContact({ ...contact, bank_name: e.target.value })}
                    className="mt-1.5"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <Label htmlFor="bank_bic">BIC</Label>
                  <Input
                    id="bank_bic"
                    value={contact.bank_bic}
                    onChange={(e) => setContact({ ...contact, bank_bic: e.target.value })}
                    className="mt-1.5"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </form>

      {/* Actions Footer */}
      <div className="flex-shrink-0 border-t px-6 py-4" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="text-sm"
          >
            Abbrechen
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={isSaving || !contact.name || !contact.street || !contact.streetnumber || !contact.zip || !contact.city || !contact.country}
            className="text-sm"
          >
            {isSaving && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
            Erstellen & Auswählen
          </Button>
        </div>
      </div>
    </div>
  )
}
