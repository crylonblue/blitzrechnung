import { NextResponse } from 'next/server'
import { APP_NAME } from '@/lib/config'

const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: `${APP_NAME} API`,
    description: 'REST API für programmatischen Zugriff auf Rechnungen, Entwürfe und Kunden.',
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
      Customer: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          company_id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Acme GmbH' },
          address: { $ref: '#/components/schemas/Address' },
          email: { type: 'string', format: 'email', nullable: true },
          vat_id: { type: 'string', nullable: true, example: 'DE123456789' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      CustomerCreate: {
        type: 'object',
        required: ['name', 'address'],
        properties: {
          name: { type: 'string', example: 'Acme GmbH' },
          address: { $ref: '#/components/schemas/Address' },
          email: { type: 'string', format: 'email' },
          vat_id: { type: 'string', example: 'DE123456789' },
        },
      },
      LineItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          description: { type: 'string', example: 'Beratungsleistung' },
          quantity: { type: 'number', example: 10 },
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
          customer_snapshot: { type: 'object', nullable: true },
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
          customer_id: { type: 'string', format: 'uuid', description: 'ID eines existierenden Kunden' },
          line_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                quantity: { type: 'number', default: 1 },
                unit_price: { type: 'number' },
                vat_rate: { type: 'number', default: 19 },
              },
            },
          },
          invoice_date: { type: 'string', format: 'date' },
          due_date: { type: 'string', format: 'date' },
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
          customer_snapshot: { type: 'object' },
          line_items: { type: 'array', items: { $ref: '#/components/schemas/LineItem' } },
          subtotal: { type: 'number' },
          vat_amount: { type: 'number' },
          total_amount: { type: 'number' },
          pdf_url: { type: 'string', nullable: true },
          xml_url: { type: 'string', nullable: true },
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
    },
  },
  paths: {
    '/customers': {
      get: {
        tags: ['Customers'],
        summary: 'Liste aller Kunden',
        responses: {
          '200': {
            description: 'Erfolgreich',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Customer' } },
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
        tags: ['Customers'],
        summary: 'Kunde erstellen',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomerCreate' } } },
        },
        responses: {
          '201': {
            description: 'Erstellt',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Customer' } } } } },
          },
          '400': { description: 'Validierungsfehler', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Nicht autorisiert', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/customers/{id}': {
      get: {
        tags: ['Customers'],
        summary: 'Einzelnen Kunden abrufen',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Customer' } } } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      patch: {
        tags: ['Customers'],
        summary: 'Kunde aktualisieren',
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
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Erfolgreich', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Customer' } } } } } },
          '404': { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        tags: ['Customers'],
        summary: 'Kunde löschen',
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
        description: 'Generiert PDF und XML, lädt zu S3 hoch und setzt Status auf "created".',
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
          '400': { description: 'Kunde fehlt', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
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
        description: 'Gibt presigned URLs für PDF und XML zurück (1 Stunde gültig).',
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
  },
  tags: [
    { name: 'Customers', description: 'Kundenverwaltung' },
    { name: 'Drafts', description: 'Rechnungsentwürfe' },
    { name: 'Invoices', description: 'Fertige Rechnungen' },
  ],
}

export async function GET() {
  return NextResponse.json(openApiSpec, {
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  })
}
