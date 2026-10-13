import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAdditionalContacts, resolveSellerContact, resolveReplyTo } from '../lib/contact-persons'

const company = {
  contact_name: 'Max Mustermann',
  contact_phone: '+49 30 1',
  contact_email: 'kontakt@firma.de',
  additional_contacts: [
    { id: 'vertrieb', name: 'Vertrieb – Erika', email: 'vertrieb@firma.de' },
    { name: 'kaputt ohne id' },
  ],
}

test('getAdditionalContacts ignores malformed entries and missing columns', () => {
  assert.deepEqual(getAdditionalContacts(company).map((c) => c.id), ['vertrieb'])
  assert.deepEqual(getAdditionalContacts({}), [])
  assert.deepEqual(getAdditionalContacts(null), [])
})

test('resolveSellerContact uses the chosen contact, else the company default', () => {
  assert.deepEqual(resolveSellerContact(company, 'vertrieb'), { name: 'Vertrieb – Erika', phone: undefined, email: 'vertrieb@firma.de' })
  assert.deepEqual(resolveSellerContact(company, null), { name: 'Max Mustermann', phone: '+49 30 1', email: 'kontakt@firma.de' })
  // deleted in the settings since the draft was saved
  assert.equal(resolveSellerContact(company, 'geloescht')?.email, 'kontakt@firma.de')
  assert.equal(resolveSellerContact({}, null), undefined)
})

test('resolveReplyTo routes replies to a chosen contact, otherwise keeps the company setting', () => {
  const settings = { mode: 'default' as const, reply_to_email: 'buchhaltung@firma.de', reply_to_name: 'Buchhaltung' }
  const snapshot = { contact: { name: 'Vertrieb – Erika', email: 'vertrieb@firma.de' } }

  assert.equal(resolveReplyTo({ contact_person_id: 'vertrieb', seller_snapshot: snapshot }, settings), 'Vertrieb – Erika <vertrieb@firma.de>')
  assert.equal(resolveReplyTo({ contact_person_id: null, seller_snapshot: snapshot }, settings), 'Buchhaltung <buchhaltung@firma.de>')
  // chosen contact without e-mail keeps the company reply-to
  assert.equal(resolveReplyTo({ contact_person_id: 'vertrieb', seller_snapshot: { contact: { name: 'X' } } }, settings), 'Buchhaltung <buchhaltung@firma.de>')
  assert.equal(resolveReplyTo({ contact_person_id: null, seller_snapshot: null }, { mode: 'default' }), undefined)
})
