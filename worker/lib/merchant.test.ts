// Run with: npx tsx --test worker/lib/merchant.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalizeMerchantForDisplay } from './merchant.ts'

test('transfers keep the counterparty and drop the bank wording', () => {
  assert.equal(canonicalizeMerchantForDisplay('TRANSFER FR A/C DODO KOREA SDN BHD * QR88632730 DUITNOW QR'), 'Dodo Korea')
  assert.equal(canonicalizeMerchantForDisplay("TRANSFER FR A/C KAM'S NASI LEMAK * MBBQR111114012937042"), 'Kams Nasi Lemak')
  assert.equal(canonicalizeMerchantForDisplay('MBB CT- MOHAMMAD ALI *Nov'), 'Mohammad Ali')
})

test('"TO A/C" and "FR A/C" give the same name for the same person', () => {
  assert.equal(
    canonicalizeMerchantForDisplay('TRANSFER TO A/C MOHAMMAD ALI *'),
    canonicalizeMerchantForDisplay('TRANSFER FR A/C MOHAMMAD ALI *'),
  )
})

test('different counterparties no longer share one name', () => {
  const a = canonicalizeMerchantForDisplay('TRANSFER FR A/C RANAJOWEL * QR73158815 DUITNOW QR')
  const b = canonicalizeMerchantForDisplay('TRANSFER FR A/C NURUL SYAZWANI BINT* QR87574893')
  assert.notEqual(a, b)
})
