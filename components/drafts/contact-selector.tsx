'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PartySnapshot, Contact, Company } from '@/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Check, ChevronsUpDown, Plus, Building2, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useContactDrawer } from '@/contexts/contact-drawer-context'
import ContactDrawer from './contact-drawer'

interface ContactSelectorProps {
  companyId: string
  company: Company | null
  selectedContact: PartySnapshot | null
  isSelf: boolean
  showSelfOption?: boolean
  filterSellersOnly?: boolean
  label?: string
  onSelect: (contact: PartySnapshot | null, isSelf: boolean) => void
}

export default function ContactSelector({
  companyId,
  company,
  selectedContact,
  isSelf,
  showSelfOption = true,
  filterSellersOnly = false,
  label = 'Kontakt auswählen...',
  onSelect,
}: ContactSelectorProps) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const { openDrawer } = useContactDrawer()
  const supabase = createClient()

  useEffect(() => {
    loadContacts()
  }, [companyId])

  const loadContacts = async () => {
    setIsLoading(true)
    let query = supabase
      .from('contacts')
      .select('*')
      .eq('company_id', companyId)
      .order('name')

    // If filtering for sellers only, only show contacts with invoice_number_prefix
    if (filterSellersOnly) {
      query = query.not('invoice_number_prefix', 'is', null)
    }

    const { data } = await query

    if (data) {
      setContacts(data)
    }
    setIsLoading(false)
  }

  const filteredContacts = contacts.filter((contact) =>
    contact.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleSelectSelf = () => {
    if (company) {
      const companyAddress = company.address as any
      const snapshot: PartySnapshot = {
        name: company.name,
        address: {
          street: companyAddress?.street || '',
          streetnumber: companyAddress?.streetnumber || '',
          city: companyAddress?.city || '',
          zip: companyAddress?.zip || '',
          country: companyAddress?.country || 'DE',
        },
        vat_id: company.vat_id || undefined,
      }
      onSelect(snapshot, true)
    } else {
      onSelect(null, true)
    }
    setOpen(false)
    setSearchQuery('')
  }

  const handleSelectContact = (contact: Contact) => {
    const contactAddress = contact.address as any
    const snapshot: PartySnapshot = {
      id: contact.id,
      name: contact.name,
      address: {
        street: contactAddress?.street || '',
        streetnumber: contactAddress?.streetnumber || '',
        city: contactAddress?.city || '',
        zip: contactAddress?.zip || '',
        country: contactAddress?.country || 'DE',
      },
      email: contact.email || undefined,
      vat_id: contact.vat_id || undefined,
      invoice_number_prefix: contact.invoice_number_prefix || undefined,
      tax_id: contact.tax_id || undefined,
      bank_details: contact.bank_details ? {
        bank_name: (contact.bank_details as any)?.bank_name,
        iban: (contact.bank_details as any)?.iban,
        bic: (contact.bank_details as any)?.bic,
      } : undefined,
    }
    onSelect(snapshot, false)
    setOpen(false)
    setSearchQuery('')
  }

  const handleNewContactSelect = (snapshot: PartySnapshot) => {
    onSelect(snapshot, false)
    // Reload contacts to include the new one
    loadContacts()
  }

  // Display value
  const displayValue = isSelf
    ? (company?.name || 'Meine Firma')
    : selectedContact
      ? selectedContact.name
      : label

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            <div className="flex items-center gap-2 truncate">
              {isSelf ? (
                <Building2 className="h-4 w-4 shrink-0 opacity-50" />
              ) : selectedContact ? (
                <User className="h-4 w-4 shrink-0 opacity-50" />
              ) : null}
              <span className="truncate">{displayValue}</span>
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command className="flex flex-col">
            <CommandInput
              placeholder="Kontakt suchen..."
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList className="flex-1 max-h-[300px] overflow-y-auto">
              <CommandEmpty>
                {isLoading ? 'Lädt...' : 'Kein Kontakt gefunden.'}
              </CommandEmpty>
              
              {/* Self option (company) */}
              {showSelfOption && company && (
                <>
                  <CommandGroup heading="Eigene Firma">
                    <CommandItem
                      value={`self-${company.name}`}
                      onSelect={handleSelectSelf}
                      style={{
                        backgroundColor: isSelf ? 'rgba(45, 45, 45, 0.08)' : 'transparent',
                        transition: 'background-color 0.2s ease, color 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelf) {
                          e.currentTarget.style.backgroundColor = 'rgba(45, 45, 45, 0.04)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelf) {
                          e.currentTarget.style.backgroundColor = 'transparent'
                        }
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          isSelf ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 opacity-50" />
                        <div className="flex flex-col">
                          <span style={{ color: isSelf ? 'var(--text-primary)' : undefined }}>
                            {company.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Aus Firmeneinstellungen
                          </span>
                        </div>
                      </div>
                    </CommandItem>
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}

              {/* Contacts */}
              <CommandGroup heading={filterSellersOnly ? "Externe Absender" : "Kontakte"}>
                {filteredContacts.map((contact) => {
                  const isSelected = !isSelf && selectedContact?.id === contact.id
                  return (
                    <CommandItem
                      key={contact.id}
                      value={contact.name}
                      onSelect={() => handleSelectContact(contact)}
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
                        <div className="flex items-center gap-2">
                          <span style={{ color: isSelected ? 'var(--text-primary)' : undefined }}>
                            {contact.name}
                          </span>
                          {contact.invoice_number_prefix && (
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
                              {contact.invoice_number_prefix}
                            </span>
                          )}
                        </div>
                        {contact.address && (
                          <span className="text-xs text-muted-foreground">
                            {(contact.address as any).city}
                          </span>
                        )}
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
                  setOpen(false)
                  openDrawer()
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Neuen Kontakt hinzufügen
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      <ContactDrawer companyId={companyId} onSelect={handleNewContactSelect} />
    </>
  )
}
