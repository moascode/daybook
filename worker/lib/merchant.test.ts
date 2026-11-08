// Run with: npx tsx --test worker/lib/merchant.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalizeMerchantForDisplay, buildDuplicateKey } from './merchant.ts'

test('transfers keep the counterparty and take To/From from the row type', () => {
  assert.equal(canonicalizeMerchantForDisplay('TRANSFER FR A/C DODO KOREA SDN BHD * QR88632730 DUITNOW QR', 'expense'), 'To Dodo Korea')
  assert.equal(canonicalizeMerchantForDisplay("TRANSFER FR A/C KAM'S NASI LEMAK * MBBQR111114012937042", 'expense'), 'To Kams Nasi Lemak')
  assert.equal(canonicalizeMerchantForDisplay('MBB CT- MOHAMMAD ALI *Nov', 'income'), 'From Mohammad Ali')
})

test('the bank wording never decides the direction', () => {
  // "TO A/C" on a credit is money in.
  assert.equal(canonicalizeMerchantForDisplay('TRANSFER TO A/C MOHAMMAD ALI *', 'income'), 'From Mohammad Ali')
})

test('different counterparties no longer share one name', () => {
  const a = canonicalizeMerchantForDisplay('TRANSFER FR A/C RANAJOWEL * QR73158815 DUITNOW QR', 'expense')
  const b = canonicalizeMerchantForDisplay('TRANSFER FR A/C NURUL SYAZWANI BINT* QR87574893', 'expense')
  assert.notEqual(a, b)
})

test('without a type a transfer is just the counterparty', () => {
  assert.equal(canonicalizeMerchantForDisplay('TRANSFER FR A/C DODO KOREA SDN BHD *'), 'Dodo Korea')
})

test('a plain merchant is unchanged by the type', () => {
  assert.equal(canonicalizeMerchantForDisplay('GRABFOOD 123456', 'expense'), canonicalizeMerchantForDisplay('GRABFOOD 123456'))
})

test('duplicate key ignores the To/From prefix', () => {
  assert.equal(
    buildDuplicateKey('2026-10-19', 19, 'expense', 'To Dodo Korea'),
    buildDuplicateKey('2026-10-19', 19, 'expense', 'Dodo Korea'),
  )
})
