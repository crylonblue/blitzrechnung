'use client'

import { useState, useEffect } from 'react'
import { Contact, Address } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Check, ChevronsUpDown, LoaderCircle, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COUNTRIES } from '@/lib/countries'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

interface ContactEditFormProps {
  contact: Contact | null
  onClose: () => void
}

export default function ContactEditForm({ contact: initialContact, onClose }: ContactEditFormProps) {
  const supabase = createClient()
  const isEditing = !!initialContact
  const address = (initialContact?.address as unknown as Address) || null
  const bankDetails = (initialContact?.bank_details as any) || null

  const [contact, setContact] = useState({
    name: initialContact?.name || '',
    street: address?.street || '',
    streetnumber: address?.streetnumber || '',
    city: address?.city || '',
    zip: address?.zip || '',
    country: address?.country || 'DE',
    email: initialContact?.email || '',
    vat_id: initialContact?.vat_id || '',
    // Seller fields
    canBeSeller: !!initialContact?.invoice_number_prefix,
    invoice_number_prefix: initialContact?.invoice_number_prefix || '',
    tax_id: initialContact?.tax_id || '',
    bank_iban: bankDetails?.iban || '',
    bank_name: bankDetails?.bank_name || '',
    bank_bic: bankDetails?.bic || '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [countryOpen, setCountryOpen] = useState(false)
  const [countrySearchQuery, setCountrySearchQuery] = useState('')
  const [shouldClose, setShouldClose] = useState(false)

  // Reset form when contact changes
  useEffect(() => {
    if (initialContact) {
      const addr = (initialContact.address as unknown as Address) || null
      const bank = (initialContact.bank_details as any) || null
      setContact({
        name: initialContact.name || '',
        street: addr?.street || '',
        streetnumber: addr?.streetnumber || '',
        city: addr?.city || '',
        zip: addr?.zip || '',
        country: addr?.country || 'DE',
        email: initialContact.email || '',
        vat_id: initialContact.vat_id || '',
        canBeSeller: !!initialContact.invoice_number_prefix,
        invoice_number_prefix: initialContact.invoice_number_prefix || '',
        tax_id: initialContact.tax_id || '',
        bank_iban: bank?.iban || '',
        bank_name: bank?.bank_name || '',
        bank_bic: bank?.bic || '',
      })
    } else {
      setContact({
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
    }
    setError(null)
    setShouldClose(false)
  }, [initialContact])

  // Handle closing after save
  useEffect(() => {
    if (shouldClose && !isSaving) {
      onClose()
      setShouldClose(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldClose, isSaving])

  const handleSave = async () => {
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
      if (isEditing && initialContact) {
        // Update existing contact
        const { error: updateError } = await supabase
          .from('contacts')
          .update({
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
          .eq('id', initialContact.id)

        if (updateError) {
          setError(updateError.message)
          setIsSaving(false)
          return
        }

        toast.success('Kontakt aktualisiert', {
          description: `${contact.name} wurde erfolgreich aktualisiert.`,
        })
      } else {
        // Create new contact - we need company_id
        // Get user's company_id
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setError('Benutzer nicht gefunden')
          setIsSaving(false)
          return
        }

        const { data: companyUsers } = await supabase
          .from('company_users')
          .select('company_id')
          .eq('user_id', user.id)
          .limit(1)
          .single()

        if (!companyUsers) {
          setError('Keine Firma gefunden')
          setIsSaving(false)
          return
        }

        const { data, error: insertError } = await supabase
          .from('contacts')
          .insert({
            company_id: companyUsers.company_id,
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

        toast.success('Kontakt erstellt', {
          description: `${contact.name} wurde erfolgreich erstellt.`,
        })
      }

      // Reset saving state and trigger close
      setIsSaving(false)
      setShouldClose(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Speichern')
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!initialContact?.id) return

    setIsDeleting(true)
    setError(null)

    const { error: deleteError } = await supabase
      .from('contacts')
      .delete()
      .eq('id', initialContact.id)

    setIsDeleting(false)
    setDeleteDialogOpen(false)

    if (deleteError) {
      // Check if it's a foreign key constraint error
      if (deleteError.code === '23503' || deleteError.message?.includes('foreign key') || deleteError.message?.includes('referenced')) {
        setError('Dieser Kontakt wird noch in Rechnungen verwendet und kann nicht gelöscht werden.')
      } else {
        setError(`Fehler beim Löschen: ${deleteError.message}`)
      }
      return
    }

    toast.success('Kontakt gelöscht', {
      description: 'Der Kontakt wurde erfolgreich gelöscht.',
    })

    onClose()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 p-6 pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div>
          <h1 className="text-headline">{isEditing ? 'Kontakt bearbeiten' : 'Neuen Kontakt erstellen'}</h1>
          <p className="mt-2 text-meta">
            {isEditing ? 'Bearbeiten Sie die Kontaktdaten' : 'Erstellen Sie einen neuen Kontakt'}
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
      <div className="flex-1 overflow-y-auto px-6" style={{ paddingTop: error ? '0' : '1.5rem' }}>
        <div className="space-y-4 pb-6">
          <div>
            <Label htmlFor="name" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Name *
            </Label>
            <Input
              id="name"
              type="text"
              value={contact.name}
              onChange={(e) => setContact({ ...contact, name: e.target.value })}
              className="mt-1"
              autoComplete="off"
              required
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Label htmlFor="street" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Straße *
              </Label>
              <Input
                id="street"
                type="text"
                value={contact.street}
                onChange={(e) => setContact({ ...contact, street: e.target.value })}
                className="mt-1"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <Label htmlFor="streetnumber" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Hausnummer *
              </Label>
              <Input
                id="streetnumber"
                type="text"
                value={contact.streetnumber}
                onChange={(e) => setContact({ ...contact, streetnumber: e.target.value })}
                className="mt-1"
                autoComplete="off"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="zip" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                PLZ *
              </Label>
              <Input
                id="zip"
                type="text"
                value={contact.zip}
                onChange={(e) => setContact({ ...contact, zip: e.target.value })}
                className="mt-1"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <Label htmlFor="city" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Stadt *
              </Label>
              <Input
                id="city"
                type="text"
                value={contact.city}
                onChange={(e) => setContact({ ...contact, city: e.target.value })}
                className="mt-1"
                autoComplete="off"
                required
              />
            </div>
          </div>
          <div>
            <Label htmlFor="country" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Land *
            </Label>
            <Popover open={countryOpen} onOpenChange={setCountryOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="country"
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
            <Label htmlFor="email" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              E-Mail
            </Label>
            <Input
              id="email"
              type="email"
              value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
              className="mt-1"
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="vat_id" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              USt-IdNr.
            </Label>
            <Input
              id="vat_id"
              type="text"
              value={contact.vat_id}
              onChange={(e) => setContact({ ...contact, vat_id: e.target.value })}
              className="mt-1"
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
                <Label htmlFor="invoice_number_prefix" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Rechnungsnummer-Präfix
                </Label>
                <Input
                  id="invoice_number_prefix"
                  type="text"
                  value={contact.invoice_number_prefix}
                  onChange={(e) => setContact({ ...contact, invoice_number_prefix: e.target.value.toUpperCase() })}
                  className="mt-1"
                  autoComplete="off"
                  placeholder="z.B. LISA"
                />
                <p className="text-xs text-zinc-500 mt-1">
                  Rechnungsnummern werden als {contact.invoice_number_prefix || 'PREFIX'}-0001, {contact.invoice_number_prefix || 'PREFIX'}-0002, ... generiert
                </p>
              </div>
              <div>
                <Label htmlFor="tax_id" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Steuernummer
                </Label>
                <Input
                  id="tax_id"
                  type="text"
                  value={contact.tax_id}
                  onChange={(e) => setContact({ ...contact, tax_id: e.target.value })}
                  className="mt-1"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="bank_iban" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  IBAN
                </Label>
                <Input
                  id="bank_iban"
                  type="text"
                  value={contact.bank_iban}
                  onChange={(e) => setContact({ ...contact, bank_iban: e.target.value })}
                  className="mt-1"
                  autoComplete="off"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="bank_name" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Bank
                  </Label>
                  <Input
                    id="bank_name"
                    type="text"
                    value={contact.bank_name}
                    onChange={(e) => setContact({ ...contact, bank_name: e.target.value })}
                    className="mt-1"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <Label htmlFor="bank_bic" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    BIC
                  </Label>
                  <Input
                    id="bank_bic"
                    type="text"
                    value={contact.bank_bic}
                    onChange={(e) => setContact({ ...contact, bank_bic: e.target.value })}
                    className="mt-1"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actions Footer */}
      <div className="flex-shrink-0 border-t px-6 py-4" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex items-center justify-between">
          {isEditing ? (
            <Button
              onClick={() => setDeleteDialogOpen(true)}
              disabled={isSaving || isDeleting}
              variant="destructive"
              className="text-sm"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Löschen
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-3">
            <Button
              onClick={onClose}
              disabled={isSaving || isDeleting}
              variant="outline"
              className="text-sm"
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || isDeleting || !contact.name || !contact.street || !contact.streetnumber || !contact.zip || !contact.city || !contact.country}
              className="text-sm"
            >
              {isSaving && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
              {isEditing ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kontakt löschen?</DialogTitle>
            <DialogDescription>
              Möchten Sie diesen Kontakt wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleDelete}
              disabled={isDeleting}
              variant="destructive"
            >
              {isDeleting && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
