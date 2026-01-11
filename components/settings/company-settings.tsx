'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Company, Address, EmailSettings } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Check, ChevronsUpDown, LoaderCircle, Copy, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COUNTRIES } from '@/lib/countries'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import ApiKeysSection from './api-keys-section'
import { DEFAULT_INVOICE_EMAIL_SUBJECT, DEFAULT_INVOICE_EMAIL_BODY, EMAIL_PLACEHOLDERS } from '@/lib/email-templates'

interface CompanySettingsProps {
  company: Company
}

export default function CompanySettings({ company: initialCompany }: CompanySettingsProps) {
  const router = useRouter()
  const supabase = createClient()
  const bankDetails = (initialCompany.bank_details as any) || {}
  const initialEmailSettings = (initialCompany.email_settings as unknown as EmailSettings) || { mode: 'default' }
  const initialAddress = initialCompany.address as unknown as Address
  const [company, setCompany] = useState({
    name: initialCompany.name,
    street: initialAddress?.street || '',
    streetnumber: initialAddress?.streetnumber || '',
    city: initialAddress?.city || '',
    zip: initialAddress?.zip || '',
    country: initialCompany.country,
    vat_id: initialCompany.vat_id || '',
    tax_id: initialCompany.tax_id || '',
    invoice_number_prefix: initialCompany.invoice_number_prefix,
    default_vat_rate: initialCompany.default_vat_rate.toString(),
    bank_name: bankDetails.bank_name || '',
    iban: bankDetails.iban || '',
    bic: bankDetails.bic || '',
    account_holder: bankDetails.account_holder || '',
    accounting_email: initialCompany.accounting_email || '',
    // XRechnung BR-DE-2: Seller Contact (Pflichtfeld)
    contact_name: initialCompany.contact_name || '',
    contact_phone: initialCompany.contact_phone || '',
    contact_email: initialCompany.contact_email || '',
  })
  const [emailSettings, setEmailSettings] = useState<EmailSettings>(initialEmailSettings)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countryOpen, setCountryOpen] = useState(false)
  const [countrySearchQuery, setCountrySearchQuery] = useState('')
  
  // Email domain setup state
  const [isSettingUpDomain, setIsSettingUpDomain] = useState(false)
  const [isVerifyingDomain, setIsVerifyingDomain] = useState(false)
  const [isDeletingDomain, setIsDeletingDomain] = useState(false)
  const [newDomainEmail, setNewDomainEmail] = useState('')
  const [newDomainName, setNewDomainName] = useState(initialCompany.name || '')

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)

    try {
      const { error: updateError } = await supabase
        .from('companies')
        .update({
          name: company.name,
          address: {
            street: company.street,
            streetnumber: company.streetnumber,
            city: company.city,
            zip: company.zip,
            country: company.country,
          },
          country: company.country,
          vat_id: company.vat_id || null,
          tax_id: company.tax_id || null,
          invoice_number_prefix: company.invoice_number_prefix,
          default_vat_rate: parseFloat(company.default_vat_rate) || 19.0,
          bank_details: {
            bank_name: company.bank_name || null,
            iban: company.iban || null,
            bic: company.bic || null,
            account_holder: company.account_holder || null,
          },
          accounting_email: company.accounting_email || null,
          // XRechnung BR-DE-2: Seller Contact
          contact_name: company.contact_name || null,
          contact_phone: company.contact_phone || null,
          contact_email: company.contact_email || null,
        })
        .eq('id', initialCompany.id)

      if (updateError) {
        setError(updateError.message)
        setIsSaving(false)
        return
      }

      // Show success toast
      toast.success('Einstellungen gespeichert', {
        description: 'Die Einstellungen wurden erfolgreich aktualisiert.',
      })

      // Reset saving state before refresh
      setIsSaving(false)
      
      // Refresh page after a short delay to ensure state update is processed
      setTimeout(() => {
        router.refresh()
      }, 100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Speichern')
      setIsSaving(false)
    }
  }

  const handleSaveEmailSettings = async () => {
    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/domains/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reply_to_email: emailSettings.reply_to_email,
          reply_to_name: emailSettings.reply_to_name,
          invoice_email_subject: emailSettings.invoice_email_subject,
          invoice_email_body: emailSettings.invoice_email_body,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Fehler beim Speichern')
      }

      toast.success('E-Mail-Einstellungen gespeichert')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Speichern')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSetupDomain = async () => {
    if (!newDomainEmail || !newDomainName) {
      toast.error('Bitte E-Mail-Adresse und Absendername eingeben')
      return
    }

    setIsSettingUpDomain(true)
    setError(null)

    try {
      const response = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_email: newDomainEmail,
          from_name: newDomainName,
          reply_to_email: emailSettings.reply_to_email,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Fehler beim Einrichten der Domain')
      }

      // Update local state immediately with the new settings
      setEmailSettings({
        ...emailSettings,
        mode: 'custom_domain',
        custom_domain: data.domain,
        from_email: newDomainEmail,
        from_name: newDomainName,
        domain_verified: false,
        dns_records: data.dns_records,
      })

      toast.success('Domain eingerichtet', {
        description: 'Bitte fügen Sie die DNS-Einträge hinzu und verifizieren Sie die Domain.',
      })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Einrichten der Domain')
    } finally {
      setIsSettingUpDomain(false)
    }
  }

  const handleVerifyDomain = async () => {
    setIsVerifyingDomain(true)
    setError(null)

    try {
      const response = await fetch('/api/domains/verify', {
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Fehler bei der Verifizierung')
      }

      // Update local state with verification result
      setEmailSettings({
        ...emailSettings,
        domain_verified: data.verified,
        domain_verified_at: data.verified ? new Date().toISOString() : undefined,
        dns_records: data.dns_records,
      })

      if (data.verified) {
        toast.success('Domain verifiziert!', {
          description: 'Sie können jetzt E-Mails von Ihrer eigenen Domain versenden.',
        })
      }
      // No toast for incomplete verification - the UI shows the status directly
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler bei der Verifizierung')
    } finally {
      setIsVerifyingDomain(false)
    }
  }

  const handleDeleteDomain = async () => {
    if (!confirm('Möchten Sie die eigene Domain wirklich entfernen? E-Mails werden dann wieder über blitzrechnung.de versendet.')) {
      return
    }

    setIsDeletingDomain(true)
    setError(null)

    try {
      const response = await fetch('/api/domains', {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Fehler beim Entfernen der Domain')
      }

      // Reset to default mode
      setEmailSettings({
        mode: 'default',
        reply_to_email: emailSettings.reply_to_email,
        reply_to_name: emailSettings.reply_to_name,
      })

      toast.success('Domain entfernt')
      setNewDomainEmail('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Entfernen der Domain')
    } finally {
      setIsDeletingDomain(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('In Zwischenablage kopiert')
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-headline">Einstellungen</h1>
        <p className="mt-2 text-meta">
          Firmendaten und Standardwerte verwalten
        </p>
      </div>

      {error && (
        <div className="message-error">
          {error}
        </div>
      )}

      <Tabs defaultValue="company" className="w-full">
        <TabsList className="mb-8 bg-transparent border-b border-zinc-200 rounded-none h-auto p-0 gap-8 w-full justify-start">
          <TabsTrigger 
            value="company"
            className="bg-transparent border-0 border-b-2 border-transparent rounded-none px-0 pb-3.5 text-sm font-medium transition-colors duration-150 hover:text-zinc-900 hover:border-zinc-300 data-[state=active]:border-zinc-900 data-[state=active]:text-zinc-900 data-[state=active]:font-semibold data-[state=active]:shadow-none"
            style={{ 
              color: 'var(--text-secondary)',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none'
            }}
          >
            Firmendaten
          </TabsTrigger>
          <TabsTrigger 
            value="invoices"
            className="bg-transparent border-0 border-b-2 border-transparent rounded-none px-0 pb-3.5 text-sm font-medium transition-colors duration-150 hover:text-zinc-900 hover:border-zinc-300 data-[state=active]:border-zinc-900 data-[state=active]:text-zinc-900 data-[state=active]:font-semibold data-[state=active]:shadow-none"
            style={{ 
              color: 'var(--text-secondary)',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none'
            }}
          >
            Rechnungen
          </TabsTrigger>
          <TabsTrigger 
            value="email"
            className="bg-transparent border-0 border-b-2 border-transparent rounded-none px-0 pb-3.5 text-sm font-medium transition-colors duration-150 hover:text-zinc-900 hover:border-zinc-300 data-[state=active]:border-zinc-900 data-[state=active]:text-zinc-900 data-[state=active]:font-semibold data-[state=active]:shadow-none"
            style={{ 
              color: 'var(--text-secondary)',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none'
            }}
          >
            E-Mail
          </TabsTrigger>
          <TabsTrigger 
            value="api"
            className="bg-transparent border-0 border-b-2 border-transparent rounded-none px-0 pb-3.5 text-sm font-medium transition-colors duration-150 hover:text-zinc-900 hover:border-zinc-300 data-[state=active]:border-zinc-900 data-[state=active]:text-zinc-900 data-[state=active]:font-semibold data-[state=active]:shadow-none"
            style={{ 
              color: 'var(--text-secondary)',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none'
            }}
          >
            API
          </TabsTrigger>
        </TabsList>

        <Card className="bg-white mt-6">
          <CardContent className="pt-6">
            {/* Firmendaten Tab */}
            <TabsContent value="company" className="space-y-6 mt-0">
              <CardHeader className="px-0 pb-4">
                <CardTitle className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                  Firmendaten
                </CardTitle>
                <CardDescription className="text-sm">
                  Grundlegende Informationen zu Ihrem Unternehmen
                </CardDescription>
              </CardHeader>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Firmenname *</Label>
                  <Input
                    id="name"
                    type="text"
                    value={company.name}
                    onChange={(e) => setCompany({ ...company, name: e.target.value })}
                    required
                    className="mt-1.5"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <Label htmlFor="street">Straße</Label>
                    <Input
                      id="street"
                      type="text"
                      value={company.street}
                      onChange={(e) => setCompany({ ...company, street: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="streetnumber">Hausnummer</Label>
                    <Input
                      id="streetnumber"
                      type="text"
                      value={company.streetnumber}
                      onChange={(e) => setCompany({ ...company, streetnumber: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="zip">PLZ</Label>
                    <Input
                      id="zip"
                      type="text"
                      value={company.zip}
                      onChange={(e) => setCompany({ ...company, zip: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="city">Stadt</Label>
                    <Input
                      id="city"
                      type="text"
                      value={company.city}
                      onChange={(e) => setCompany({ ...company, city: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="country">Land</Label>
                  <Popover open={countryOpen} onOpenChange={setCountryOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="country"
                        variant="outline"
                        role="combobox"
                        aria-expanded={countryOpen}
                        className="mt-1.5 w-full justify-between"
                        style={{ height: 'auto', minHeight: '2.25rem' }}
                      >
                        {company.country
                          ? COUNTRIES.find((c) => c.code === company.country)?.name || company.country
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
                            {COUNTRIES.filter((c) =>
                              c.name.toLowerCase().includes(countrySearchQuery.toLowerCase()) ||
                              c.code.toLowerCase().includes(countrySearchQuery.toLowerCase())
                            ).map((c) => {
                              const isSelected = company.country === c.code
                              return (
                                <CommandItem
                                  key={c.code}
                                  value={c.name}
                                  onSelect={() => {
                                    setCompany({ ...company, country: c.code })
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
                                    {c.name} ({c.code})
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
                  <Label htmlFor="vat_id">USt-IdNr.</Label>
                  <Input
                    id="vat_id"
                    type="text"
                    value={company.vat_id}
                    onChange={(e) => setCompany({ ...company, vat_id: e.target.value })}
                    className="mt-1.5"
                  />
                </div>

                <div>
                  <Label htmlFor="tax_id">Steuernummer</Label>
                  <Input
                    id="tax_id"
                    type="text"
                    value={company.tax_id}
                    onChange={(e) => setCompany({ ...company, tax_id: e.target.value })}
                    className="mt-1.5"
                  />
                </div>

                <div className="pt-6 mt-6 border-t" style={{ borderColor: 'var(--border-default)' }}>
                  <h2 className="mb-4 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>Bankdaten</h2>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="account_holder">Kontoinhaber</Label>
                      <Input
                        id="account_holder"
                        type="text"
                        value={company.account_holder}
                        onChange={(e) => setCompany({ ...company, account_holder: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>

                    <div>
                      <Label htmlFor="bank_name">Bankname</Label>
                      <Input
                        id="bank_name"
                        type="text"
                        value={company.bank_name}
                        onChange={(e) => setCompany({ ...company, bank_name: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>

                    <div>
                      <Label htmlFor="iban">IBAN</Label>
                      <Input
                        id="iban"
                        type="text"
                        value={company.iban}
                        onChange={(e) => setCompany({ ...company, iban: e.target.value.toUpperCase().replace(/\s/g, '') })}
                        className="mt-1.5"
                        placeholder="DE89 3704 0044 0532 0130 00"
                      />
                    </div>

                    <div>
                      <Label htmlFor="bic">BIC / SWIFT</Label>
                      <Input
                        id="bic"
                        type="text"
                        value={company.bic}
                        onChange={(e) => setCompany({ ...company, bic: e.target.value.toUpperCase().replace(/\s/g, '') })}
                        className="mt-1.5"
                        placeholder="COBADEFFXXX"
                      />
                    </div>
                  </div>
                </div>

                {/* Ansprechpartner Section - XRechnung BR-DE-2 */}
                <div className="pt-6 mt-6 border-t" style={{ borderColor: 'var(--border-default)' }}>
                  <h2 className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
                    Ansprechpartner
                  </h2>
                  <p className="mb-4 text-xs" style={{ color: 'var(--text-meta)' }}>
                    Pflichtfeld für XRechnung-konforme Rechnungen
                  </p>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="contact_name">Name</Label>
                      <Input
                        id="contact_name"
                        type="text"
                        value={company.contact_name}
                        onChange={(e) => setCompany({ ...company, contact_name: e.target.value })}
                        className="mt-1.5"
                        placeholder="Max Mustermann"
                      />
                    </div>

                    <div>
                      <Label htmlFor="contact_phone">Telefon</Label>
                      <Input
                        id="contact_phone"
                        type="tel"
                        value={company.contact_phone}
                        onChange={(e) => setCompany({ ...company, contact_phone: e.target.value })}
                        className="mt-1.5"
                        placeholder="+49 30 123456"
                      />
                    </div>

                    <div>
                      <Label htmlFor="contact_email">E-Mail</Label>
                      <Input
                        id="contact_email"
                        type="email"
                        value={company.contact_email}
                        onChange={(e) => setCompany({ ...company, contact_email: e.target.value })}
                        className="mt-1.5"
                        placeholder="kontakt@firma.de"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Rechnungseinstellungen Tab */}
            <TabsContent value="invoices" className="space-y-6 mt-0">
              <CardHeader className="px-0 pb-4">
                <CardTitle className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                  Rechnungseinstellungen
                </CardTitle>
                <CardDescription className="text-sm">
                  Standardwerte für neue Rechnungen
                </CardDescription>
              </CardHeader>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="invoice_number_prefix">Rechnungsnummer-Präfix</Label>
                  <Input
                    id="invoice_number_prefix"
                    type="text"
                    value={company.invoice_number_prefix}
                    onChange={(e) => setCompany({ ...company, invoice_number_prefix: e.target.value })}
                    className="mt-1.5"
                  />
                  <p className="mt-1.5 text-xs text-meta">
                    Beispiel: INV → Rechnungen werden als INV-0001, INV-0002, ... nummeriert
                  </p>
                </div>

                <div>
                  <Label htmlFor="default_vat_rate">Standard-MwSt.-Satz (%)</Label>
                  <Input
                    id="default_vat_rate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={company.default_vat_rate}
                    onChange={(e) => setCompany({ ...company, default_vat_rate: e.target.value })}
                    className="mt-1.5"
                  />
                </div>

                <div>
                  <Label htmlFor="accounting_email">Buchhaltungs-E-Mailadresse</Label>
                  <Input
                    id="accounting_email"
                    type="email"
                    value={company.accounting_email}
                    onChange={(e) => setCompany({ ...company, accounting_email: e.target.value })}
                    className="mt-1.5"
                    placeholder="datev@beispiel.de oder buchhaltung@beispiel.de"
                  />
                  <p className="mt-1.5 text-xs text-meta">
                    An diese Adresse werden fertige Rechnungen automatisch versendet (z.B. für Datev oder andere Buchhaltungssysteme)
                  </p>
                </div>

                {/* Email Template Section */}
                <div className="pt-6 mt-6 border-t" style={{ borderColor: 'var(--border-default)' }}>
                  <h2 className="mb-4 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
                    E-Mail-Vorlage für Rechnungsversand
                  </h2>
                  
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="invoice_email_subject">Betreff</Label>
                      <Input
                        id="invoice_email_subject"
                        type="text"
                        value={emailSettings.invoice_email_subject || ''}
                        onChange={(e) => setEmailSettings({ ...emailSettings, invoice_email_subject: e.target.value })}
                        className="mt-1.5"
                        placeholder={DEFAULT_INVOICE_EMAIL_SUBJECT}
                      />
                    </div>

                    <div>
                      <Label htmlFor="invoice_email_body">Nachricht</Label>
                      <textarea
                        id="invoice_email_body"
                        value={emailSettings.invoice_email_body || ''}
                        onChange={(e) => setEmailSettings({ ...emailSettings, invoice_email_body: e.target.value })}
                        className="mt-1.5 w-full min-h-[150px] rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800"
                        placeholder={DEFAULT_INVOICE_EMAIL_BODY}
                      />
                    </div>

                    <div className="p-3 rounded-md bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
                      <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                        Verfügbare Platzhalter:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {EMAIL_PLACEHOLDERS.map((p) => (
                          <span
                            key={p.placeholder}
                            className="inline-flex items-center px-2 py-1 rounded text-xs bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600"
                          >
                            <code className="font-mono text-zinc-700 dark:text-zinc-300">{p.placeholder}</code>
                            <span className="ml-1.5 text-zinc-500">= {p.description}</span>
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end pt-4">
                      <Button onClick={handleSaveEmailSettings} disabled={isSaving}>
                        {isSaving && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
                        E-Mail-Vorlage speichern
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* E-Mail-Einstellungen Tab */}
            <TabsContent value="email" className="space-y-6 mt-0">
              <CardHeader className="px-0 pb-4">
                <CardTitle className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                  E-Mail-Einstellungen
                </CardTitle>
                <CardDescription className="text-sm">
                  Konfiguration für den Versand von Rechnungen per E-Mail
                </CardDescription>
              </CardHeader>

              <div className="space-y-6">
                {/* Current Mode Display */}
                <div className="p-4 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--background)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    {emailSettings.mode === 'default' ? (
                      <>
                        <AlertCircle className="h-4 w-4 text-blue-500" />
                        <span className="font-medium">Standard-Versand</span>
                      </>
                    ) : emailSettings.domain_verified ? (
                      <>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span className="font-medium">Eigene Domain (verifiziert)</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                        <span className="font-medium">Eigene Domain (Verifizierung ausstehend)</span>
                      </>
                    )}
                  </div>
                  <p className="text-sm text-meta">
                    {emailSettings.mode === 'default' 
                      ? 'E-Mails werden über rechnung@blitzrechnung.de versendet.'
                      : emailSettings.domain_verified
                        ? `E-Mails werden über ${emailSettings.from_email} versendet.`
                        : `E-Mails werden über rechnung@blitzrechnung.de versendet, bis ${emailSettings.custom_domain} verifiziert ist.`
                    }
                  </p>
                </div>

                {/* Reply-To Setting */}
                <div>
                  <Label htmlFor="reply_to_email">Antwort-Adresse (Reply-To)</Label>
                  <Input
                    id="reply_to_email"
                    type="email"
                    value={emailSettings.reply_to_email || ''}
                    onChange={(e) => setEmailSettings({ ...emailSettings, reply_to_email: e.target.value })}
                    className="mt-1.5"
                    placeholder="buchhaltung@ihre-firma.de"
                  />
                  <p className="mt-1.5 text-xs text-meta">
                    Antworten Ihrer Kunden werden an diese Adresse gesendet
                  </p>
                </div>

                <div>
                  <Label htmlFor="reply_to_name">Antwort-Name (optional)</Label>
                  <Input
                    id="reply_to_name"
                    type="text"
                    value={emailSettings.reply_to_name || ''}
                    onChange={(e) => setEmailSettings({ ...emailSettings, reply_to_name: e.target.value })}
                    className="mt-1.5"
                    placeholder="Buchhaltung Muster GmbH"
                  />
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSaveEmailSettings} disabled={isSaving}>
                    {isSaving && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
                    Antwort-Adresse speichern
                  </Button>
                </div>

                {/* Custom Domain Section */}
                <div className="pt-6 mt-6 border-t" style={{ borderColor: 'var(--border-default)' }}>
                  <h2 className="mb-4 text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
                    Eigene Absender-Domain
                  </h2>
                  
                  {emailSettings.mode === 'custom_domain' && emailSettings.custom_domain ? (
                    <div className="space-y-4">
                      {/* Domain Info */}
                      <div className="p-4 rounded-lg border" style={{ borderColor: 'var(--border-default)' }}>
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="font-medium">{emailSettings.from_email}</p>
                            <p className="text-sm text-meta">{emailSettings.from_name}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {emailSettings.domain_verified ? (
                              <span className="status-badge success">Verifiziert</span>
                            ) : (
                              <span className="status-badge warning">Ausstehend</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* DNS Records */}
                      {emailSettings.dns_records && (
                        <div className="space-y-3">
                          <p className="text-sm font-medium">Erforderliche DNS-Einträge:</p>
                          
                          {/* DKIM Record */}
                          {emailSettings.dns_records.dkim?.value && (
                            <div 
                              className="p-3 rounded border"
                              style={{ 
                                borderColor: emailSettings.dns_records.dkim?.verified === true 
                                  ? '#22c55e' 
                                  : emailSettings.dns_records.dkim?.verified === false 
                                    ? '#ef4444' 
                                    : 'var(--border-default)',
                                backgroundColor: emailSettings.dns_records.dkim?.verified === true 
                                  ? '#f0fdf4' 
                                  : emailSettings.dns_records.dkim?.verified === false 
                                    ? '#fef2f2' 
                                    : 'var(--background)'
                              }}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  {emailSettings.dns_records.dkim?.verified === true ? (
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                  ) : emailSettings.dns_records.dkim?.verified === false ? (
                                    <XCircle className="h-4 w-4 text-red-500" />
                                  ) : (
                                    <AlertCircle className="h-4 w-4 text-zinc-400" />
                                  )}
                                  <span className="text-xs font-medium uppercase text-meta">DKIM (TXT)</span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2"
                                  onClick={() => copyToClipboard(emailSettings.dns_records?.dkim?.value || '')}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                              <p className="text-xs text-meta mb-1">Host: {emailSettings.dns_records.dkim?.host}</p>
                              <p className="text-xs font-mono break-all">{emailSettings.dns_records.dkim?.value}</p>
                            </div>
                          )}

                          {/* Return Path Record */}
                          {emailSettings.dns_records.return_path?.value && (
                            <div 
                              className="p-3 rounded border"
                              style={{ 
                                borderColor: emailSettings.dns_records.return_path?.verified === true 
                                  ? '#22c55e' 
                                  : emailSettings.dns_records.return_path?.verified === false 
                                    ? '#ef4444' 
                                    : 'var(--border-default)',
                                backgroundColor: emailSettings.dns_records.return_path?.verified === true 
                                  ? '#f0fdf4' 
                                  : emailSettings.dns_records.return_path?.verified === false 
                                    ? '#fef2f2' 
                                    : 'var(--background)'
                              }}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  {emailSettings.dns_records.return_path?.verified === true ? (
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                  ) : emailSettings.dns_records.return_path?.verified === false ? (
                                    <XCircle className="h-4 w-4 text-red-500" />
                                  ) : (
                                    <AlertCircle className="h-4 w-4 text-zinc-400" />
                                  )}
                                  <span className="text-xs font-medium uppercase text-meta">Return-Path (CNAME)</span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2"
                                  onClick={() => copyToClipboard(emailSettings.dns_records?.return_path?.value || '')}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                              <p className="text-xs text-meta mb-1">Host: {emailSettings.dns_records.return_path?.host}</p>
                              <p className="text-xs font-mono break-all">{emailSettings.dns_records.return_path?.value}</p>
                            </div>
                          )}

                          {/* Info if no DNS records available */}
                          {!emailSettings.dns_records.dkim?.value &&
                           !emailSettings.dns_records.return_path?.value && (
                            <p className="text-sm text-meta">
                              Keine DNS-Einträge erforderlich. Die Domain wird automatisch über Postmark verifiziert.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2">
                        {!emailSettings.domain_verified && (
                          <Button onClick={handleVerifyDomain} disabled={isVerifyingDomain}>
                            {isVerifyingDomain && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
                            Domain verifizieren
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          onClick={handleDeleteDomain}
                          disabled={isDeletingDomain}
                        >
                          {isDeletingDomain && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
                          Domain entfernen
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm text-meta">
                        Richten Sie eine eigene Domain ein, um E-Mails von Ihrer Firmenadresse zu versenden.
                        Sie müssen dafür DNS-Einträge bei Ihrem Domain-Anbieter hinzufügen.
                      </p>

                      <div>
                        <Label htmlFor="new_domain_email">Absender E-Mail-Adresse</Label>
                        <Input
                          id="new_domain_email"
                          type="email"
                          value={newDomainEmail}
                          onChange={(e) => setNewDomainEmail(e.target.value)}
                          className="mt-1.5"
                          placeholder="rechnung@ihre-firma.de"
                        />
                      </div>

                      <div>
                        <Label htmlFor="new_domain_name">Absender-Name</Label>
                        <Input
                          id="new_domain_name"
                          type="text"
                          value={newDomainName}
                          onChange={(e) => setNewDomainName(e.target.value)}
                          className="mt-1.5"
                          placeholder="Muster GmbH"
                        />
                      </div>

                      <Button onClick={handleSetupDomain} disabled={isSettingUpDomain || !newDomainEmail || !newDomainName}>
                        {isSettingUpDomain && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
                        Eigene Domain einrichten
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* API Tab */}
            <TabsContent value="api" className="mt-0">
              <ApiKeysSection companyId={initialCompany.id} />
            </TabsContent>

            <div className="flex justify-end border-t pt-6 mt-8" style={{ borderColor: 'var(--border-default)' }}>
              <Button
                onClick={handleSave}
                disabled={isSaving || !company.name}
              >
                {isSaving && <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />}
                Speichern
              </Button>
            </div>
          </CardContent>
        </Card>
      </Tabs>
    </div>
  )
}
