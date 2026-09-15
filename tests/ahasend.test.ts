import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertMessageAccepted, mapDomain, parseAddress } from '../lib/email/ahasend'

test('mapDomain renames the provider fields onto our DNS record shape', () => {
  const result = mapDomain({
    id: 'dom_1',
    domain: 'kunde.de',
    dns_valid: false,
    last_dns_check_at: null,
    dns_records: [
      { type: 'TXT', host: 'kunde.de', content: 'v=spf1 include:ahasend.com ~all', required: true, propagated: true },
      { type: 'CNAME', host: 'click.kunde.de', content: 'track.ahasend.com', required: false, propagated: false },
    ],
  } as Parameters<typeof mapDomain>[0])

  assert.equal(result.domain_id, 'kunde.de')
  assert.equal(result.verified, false)
  assert.deepEqual(result.dns_records, [
    { type: 'TXT', host: 'kunde.de', value: 'v=spf1 include:ahasend.com ~all', required: true, verified: true },
    { type: 'CNAME', host: 'click.kunde.de', value: 'track.ahasend.com', required: false, verified: false },
  ])
})

test('mapDomain tolerates a domain without records', () => {
  const result = mapDomain({ domain: 'kunde.de', dns_valid: true } as Parameters<typeof mapDomain>[0])
  assert.deepEqual(result.dns_records, [])
  assert.equal(result.verified, true)
})

test('mapDomain trusts dns_valid over a stale per-record flag', () => {
  // Observed against the live API: the domain was valid and the DKIM CNAME
  // resolved, but the record still came back with propagated=false.
  const result = mapDomain({
    domain: 'email.blitzrechnung.de',
    dns_valid: true,
    dns_records: [
      { type: 'CNAME', host: 'ahasend._domainkey.email.blitzrechnung.de', content: 'x.setup.ahasend.com', required: true, propagated: false },
      { type: 'CNAME', host: 't.email.blitzrechnung.de', content: 'track.ahasend.com', required: false, propagated: false },
    ],
  } as Parameters<typeof mapDomain>[0])

  assert.equal(result.dns_records[0].verified, true, 'required record follows dns_valid')
  assert.equal(result.dns_records[1].verified, false, 'optional record keeps its own state')
})

test('mapDomain keeps required records unverified while the domain is invalid', () => {
  const result = mapDomain({
    domain: 'kunde.de',
    dns_valid: false,
    dns_records: [
      { type: 'TXT', host: 'kunde.de', content: 'v=spf1', required: true, propagated: true },
      { type: 'CNAME', host: 'ahasend._domainkey.kunde.de', content: 'x', required: true, propagated: false },
    ],
  } as Parameters<typeof mapDomain>[0])

  assert.equal(result.dns_records[0].verified, true, 'a propagated record stays verified')
  assert.equal(result.dns_records[1].verified, false, 'a missing record stays unverified')
})

test('parseAddress splits display name from address', () => {
  assert.deepEqual(parseAddress('Muster GmbH <rechnung@muster.de>'), {
    email: 'rechnung@muster.de',
    name: 'Muster GmbH',
  })
  assert.deepEqual(parseAddress('"Muster, GmbH" <rechnung@muster.de>'), {
    email: 'rechnung@muster.de',
    name: 'Muster, GmbH',
  })
  assert.deepEqual(parseAddress('rechnung@muster.de'), { email: 'rechnung@muster.de' })
  assert.deepEqual(parseAddress('  rechnung@muster.de  '), { email: 'rechnung@muster.de' })
})

test('assertMessageAccepted treats a per-recipient error as a failed send', () => {
  // AhaSend answers 202 even when it rejects the recipient, so the HTTP status
  // alone would report a bounce back to the user as a successful send.
  assert.throws(
    () =>
      assertMessageAccepted({
        data: [{ id: null, status: 'error', error: 'recipient is suppressed' }],
      }),
    /recipient is suppressed/
  )
})

test('assertMessageAccepted rejects an empty result set', () => {
  assert.throws(() => assertMessageAccepted({ data: [] }), /nicht angenommen/)
  assert.throws(() => assertMessageAccepted({}), /nicht angenommen/)
})

test('assertMessageAccepted passes a queued message', () => {
  assert.doesNotThrow(() =>
    assertMessageAccepted({ data: [{ id: 'msg_1', status: 'queued', error: null }] })
  )
})
