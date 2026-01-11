import { NextResponse } from 'next/server'
import { APP_NAME } from '@/lib/config'

const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: `${APP_NAME} API`,
    description: 'REST API für programmatischen Zugriff auf Rechnungen, Entwürfe und Kontakte.',
    version: '1.0.0',
  },
  servers: [
    {
      url: '/api/v1',
      description: 'API v1',
    },
  ],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API Key im Format: flx_xxxxx',
      },
    },
    schemas: {
      Address: {
        type: 'object',
        required: ['street', 'city', 'zip', 'country'],
        properties: {
          street: { type: 'string', example: 'Musterstraße' },
          streetnumber: { type: 'string', example: '42' },
          city: { type: 'string', example: 'Berlin' },
          zip: { type: 'string', example: '10115' },
          country: { type: 'string', example: 'Deutschland' },
        },
      },
      BankDetails: {
        type: 'object',
        properties: {
          bank_name: { type: 'string', example: 'Sparkasse Berlin' },
          iban: { type: 'string', example: 'DE89370400440532013000' },
          bic: { type: 'string', example: 'COBADEFFXXX' },
          account_holder: { type: 'string', example: 'Max Mustermann' },
        },
      },
      Contact: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          company_id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Acme GmbH' },
          address: { $ref: '#/components/schemas/Address' },
          email: { type: 'string', format: 'email', nullable: true },
          vat_id: { type: 'string', nullable: true, example: 'DE123456789' },
          invoice_number_prefix: { type: 'string', nullable: true, example: 'ACME', description: 'Wenn gesetzt, kann dieser Kontakt Rechnungen stellen' },
          invoice_number_counter: { type: 'integer', default: 0, description: 'Aktueller Zähler für Rechnungsnummern' },
          tax_id: { type: 'string', nullable: true, description: 'Steuernummer (für Verkäufer)' },
          bank_details: { $ref: '#/components/schemas/BankDetails', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      ContactCreate: {
        type: 'object',
        required: ['name', 'address'],
        properties: {
          name: { type: 'string', example: 'Acme GmbH' },
          address: { $ref: '#/components/schemas/Address' },
          email: { type: 'string', format: 'email' },
          vat_id: { type: 'string', example: 'DE123456789' },
          invoice_number_prefix: { type: 'string', example: 'ACME', description: 'Wenn gesetzt, kann dieser Kontakt Rechnungen stellen' },
          tax_id: { type: 'string', description: 'Steuernummer (für Verkäufer)' },
          bank_details: { $ref: '#/components/schemas/BankDetails' },
        },
      },
      LineItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          product_id: { type: 'string', format: 'uuid', nullable: true, description: 'Referenz zur Produktvorlage' },
          description: { type: 'string', example: 'Beratungsleistung' },
          quantity: { type: 'number', example: 10 },
          unit: { type: 'string', example: 'hour', description: 'Einheit (piece, hour, day, etc.)' },
          unit_price: { type: 'number', example: 100 },
          vat_rate: { type: 'number', example: 19 },
          total: { type: 'number', example: 1000 },
        },
      },
      Draft: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          company_id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['draft'] },
          invoice_number: { type: 'string', nullable: true },
          invoice_date: { type: 'string', format: 'date' },
          due_date: { type: 'string', format: 'date' },
          seller_is_self: { type: 'boolean', default: true, description: 'Wenn true, ist die eigene Firma der Verkäufer' },
          seller_contact_id: { type: 'string', format: 'uuid', nullable: true, description: 'ID des externen Verkäufer-Kontakts' },
          seller_snapshot: { type: 'object', nullable: true },
          buyer_is_self: { type: 'boolean', default: false, description: 'Wenn true, ist die eigene Firma der Käufer' },
          buyer_contact_id: { type: 'string', format: 'uuid', nullable: true, description: 'ID des Käufer-Kontakts' },
          buyer_snapshot: { type: 'object', nullable: true },
          line_items: { type: 'array', items: { $ref: '#/components/schemas/LineItem' } },
          subtotal: { type: 'number' },
          vat_amount: { type: 'number' },
          total_amount: { type: 'number' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      DraftCreate: {
        type: 'object',
        properties: {
          seller_contact_id: { type: 'string', format: 'uuid', description: 'ID eines externen Kontakts als Verkäufer (optional, Standard: eigene Firma)' },
          buyer_contact_id: { type: 'string', format: 'uuid', description: 'ID eines Kontakts als Käufer (oder "self" für eigene Firma)' },
          line_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'string', format: 'uuid', description: 'Optional: ID einer Produktvorlage' },
                description: { type: 'string' },
                quantity: { type: 'number', default: 1 },
                unit: { type: 'string', default: 'piece', description: 'Einheit (piece, hour, day, etc.)' },
                unit_price: { type: 'number' },
                vat_rate: { type: 'number', default: 19 },
              },
            },
          },
          invoice_date: { type: 'string', format: 'date' },
          due_date: { type: 'string', format: 'date' },
          invoice_number: { type: 'string', description: 'Optionale manuelle Rechnungsnummer (für externe Verkäufer)' },
        },
      },
      Invoice: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          company_id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['created', 'sent', 'reminded', 'paid', 'cancelled'] },
          invoice_number: { type: 'string', example: 'INV-0001' },
          invoice_date: { type: 'string', format: 'date' },
          due_date: { type: 'string', format: 'date' },
          seller_is_self: { type: 'boolean' },
          seller_contact_id: { type: 'string', format: 'uuid', nullable: true },
          seller_snapshot: { type: 'object' },
          buyer_is_self: { type: 'boolean' },
          buyer_contact_id: { type: 'string', format: 'uuid', nullable: true },
          buyer_snapshot: { type: 'object' },
          line_items: { type: 'array', items: { $ref: '#/components/schemas/LineItem' } },
          subtotal: { type: 'number' },
          vat_amount: { type: 'number' },
          total_amount: { type: 'number' },
          recipient_email: { type: 'string', format: 'email', nullable: true, description: 'E-Mail-Adresse für Rechnungsversand' },
          pdf_url: { type: 'string', nullable: true },
          xml_url: { type: 'string', nullable: true, description: 'XRechnung/ZUGFeRD XML (EN 16931)' },
          finalized_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          code: { type: 'string', enum: ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR', 'SERVER_ERROR'] },
        },
      },
      Product: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          company_id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Beratungsleistung' },
          description: { type: 'string', nullable: true, example: 'Professionelle IT-Beratung' },
          unit: { type: 'string', example: 'hour', description: 'Einheit (piece, hour, day, etc.)' },
          unit_price: { type: 'number', example: 120 },
          default_vat_rate: { type: 'number', example: 19 },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      ProductCreate: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', example: 'Beratungsleistung' },
          description: { type: 'string', example: 'Professionelle IT-Beratung' },
          unit: { type: 'string', default: 'piece', description: 'Einheit (piece, hour, day, etc.)' },
          unit_price: { type: 'number', default: 0 },
          default_vat_rate: { type: 'number', default: 19 },
        },
      },
      SendInvoiceRequest: {
        type: 'object',
        required: ['recipient_email'],
        properties: {
          recipient_email: { type: 'string', format: 'email', example: 'kunde@beispiel.de' },
          subject: { type: 'string', example: 'Rechnung INV-0001', description: 'E-Mail-Betreff (optional, wird aus Vorlage generiert)' },
          body: { type: 'string', description: 'E-Mail-Text (optional, wird aus Vorlage generiert)' },
        },
      },
    },
  },
  paths: {
    '/contacts': {
      get: {
        tags: ['Contacts'],
        summary: 'Liste aller Kontakte',
        responses: {
          '200': {
            description: 'Erfolgreich',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Contact' } },
                    count: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { description: 'Nicht autorisiert', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        tags: ['Contacts'],
        summary: 'Kontakt erstellen',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ContactCreate' } } },
        },
        responses: {
          '201': {
            description: 'Erstellt',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Contact' } } } } },
          },
          '400': { description: 'Validierungsfehler', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Nicht autorisiert', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/contacts/{id}': {
      get: {
        tags: ['Contacts'],
        summary: 'Einzelnen Kontakt abrufen',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Contact' } } } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      patch: {
        tags: ['Contacts'],
        summary: 'Kontakt aktualisieren',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  address: { $ref: '#/components/schemas/Address' },
                  email: { type: 'string' },
                  vat_id: { type: 'string' },
                  invoice_number_prefix: { type: 'string' },
                  tax_id: { type: 'string' },
                  bank_details: { $ref: '#/components/schemas/BankDetails' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Contact' } } } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        tags: ['Contacts'],
        summary: 'Kontakt löschen',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/drafts': {
      get: {
        tags: ['Drafts'],
        summary: 'Liste aller Entwürfe',
        responses: {
          '200': {
            description: 'Erfolgreich',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Draft' } }, count: { type: 'integer' } } } } },
          },
        },
      },
      post: {
        tags: ['Drafts'],
        summary: 'Entwurf erstellen',
        description: 'Erstellt einen neuen Rechnungsentwurf. seller_contact_id ist optional (Standard: eigene Firma als Verkäufer). buyer_contact_id kann eine Kontakt-ID oder "self" sein.',
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/DraftCreate' } } },
        },
        responses: {
          '201': { description: 'Erstellt', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Draft' } } } } } },
        },
      },
    },
    '/drafts/{id}': {
      get: {
        tags: ['Drafts'],
        summary: 'Einzelnen Entwurf abrufen',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Draft' } } } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      patch: {
        tags: ['Drafts'],
        summary: 'Entwurf aktualisieren',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/DraftCreate' } } },
        },
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Draft' } } } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        tags: ['Drafts'],
        summary: 'Entwurf löschen',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/drafts/{id}/finalize': {
      post: {
        tags: ['Drafts'],
        summary: 'Entwurf finalisieren',
        description: 'Generiert PDF (mit eingebetteter ZUGFeRD-XML) und separate XRechnung/ZUGFeRD-XML (EN 16931), lädt zu S3 hoch und setzt Status auf "created". Die Rechnungsnummer wird automatisch generiert basierend auf dem Verkäufer (eigene Firma oder externer Kontakt).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': {
            description: 'Erfolgreich',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { $ref: '#/components/schemas/Invoice' },
                    pdf_url: { type: 'string' },
                    xml_url: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { description: 'Käufer fehlt oder Validierungsfehler', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/invoices': {
      get: {
        tags: ['Invoices'],
        summary: 'Liste aller Rechnungen',
        parameters: [
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['created', 'sent', 'reminded', 'paid', 'cancelled'] },
            description: 'Nach Status filtern',
          },
        ],
        responses: {
          '200': {
            description: 'Erfolgreich',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Invoice' } }, count: { type: 'integer' } } } } },
          },
        },
      },
    },
    '/invoices/{id}': {
      get: {
        tags: ['Invoices'],
        summary: 'Einzelne Rechnung abrufen',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Invoice' } } } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      patch: {
        tags: ['Invoices'],
        summary: 'Rechnungsstatus ändern',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['created', 'sent', 'reminded', 'paid', 'cancelled'] },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Invoice' } } } } } },
          '400': { description: 'Ungültiger Status', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/invoices/{id}/pdf': {
      get: {
        tags: ['Invoices'],
        summary: 'PDF Download URL',
        description: 'Gibt presigned URLs für PDF (mit eingebetteter ZUGFeRD-XML) und separate XRechnung/ZUGFeRD-XML zurück (1 Stunde gültig).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': {
            description: 'Erfolgreich',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    pdf_url: { type: 'string', format: 'uri' },
                    xml_url: { type: 'string', format: 'uri', nullable: true },
                    expires_in: { type: 'integer', example: 3600 },
                  },
                },
              },
            },
          },
          '400': { description: 'PDF nicht verfügbar', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/invoices/{id}/send': {
      post: {
        tags: ['Invoices'],
        summary: 'Rechnung per E-Mail versenden',
        description: 'Versendet die Rechnung mit PDF und XRechnung/ZUGFeRD-XML als Anhang per E-Mail. Setzt den Status auf "sent".',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SendInvoiceRequest' } } },
        },
        responses: {
          '200': {
            description: 'Erfolgreich versendet',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string', example: 'Rechnung wurde versendet' },
                  },
                },
              },
            },
          },
          '400': { description: 'Versand nicht möglich (z.B. Entwurf oder keine PDF)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/products': {
      get: {
        tags: ['Products'],
        summary: 'Liste aller Produktvorlagen',
        responses: {
          '200': {
            description: 'Erfolgreich',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
                    count: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { description: 'Nicht autorisiert', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        tags: ['Products'],
        summary: 'Produktvorlage erstellen',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductCreate' } } },
        },
        responses: {
          '201': {
            description: 'Erstellt',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Product' } } } } },
          },
          '400': { description: 'Validierungsfehler', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Nicht autorisiert', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/products/{id}': {
      get: {
        tags: ['Products'],
        summary: 'Einzelne Produktvorlage abrufen',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Product' } } } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      patch: {
        tags: ['Products'],
        summary: 'Produktvorlage aktualisieren',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  unit: { type: 'string' },
                  unit_price: { type: 'number' },
                  default_vat_rate: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Product' } } } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        tags: ['Products'],
        summary: 'Produktvorlage löschen',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
  tags: [
    { name: 'Contacts', description: 'Kontaktverwaltung (Kunden, Lieferanten, Partner)' },
    { name: 'Drafts', description: 'Rechnungsentwürfe' },
    { name: 'Invoices', description: 'Fertige Rechnungen' },
    { name: 'Products', description: 'Produktvorlagen für wiederkehrende Positionen' },
  ],
}

export async function GET() {
  return NextResponse.json(openApiSpec, {
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  })
}
