// Unit tests for anthropicErrorFromResponse (fix/worker-placement-sg).
//
// NOTE ON RUNNER: see worker/lib/iso-date.test.ts — this repo has no unit-test
// runner configured (only Playwright e2e), so this file uses Node's built-in
// `node:test` + `node:assert/strict`, exercised through the already-present
// `tsx` devDependency:
//
//   npx tsx --test worker/lib/anthropic.test.ts
//
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anthropicErrorFromResponse } from './anthropic'

function fakeResponse(status: number, headers: Record<string, string>, body: string): Response {
  return new Response(body, { status, headers })
}

test('403 with no request-id gets the region-block prefix', async () => {
  const res = fakeResponse(
    403,
    { 'cf-ray': 'abc123-HKG' },
    JSON.stringify({ error: { type: 'forbidden_error', message: 'Request not allowed' } }),
  )
  const err = await anthropicErrorFromResponse(res)
  assert.match(err.message, /^Blocked before reaching Anthropic/)
  assert.match(err.message, /Anthropic API responded 403/)
  assert.match(err.message, /Request not allowed/)
  assert.match(err.message, /cf-ray abc123-HKG/)
})

test('403 with a request-id is left unprefixed', async () => {
  const res = fakeResponse(
    403,
    { 'request-id': 'req_123', 'cf-ray': 'abc123-SIN' },
    JSON.stringify({ error: { type: 'permission_error', message: 'Invalid API key' } }),
  )
  const err = await anthropicErrorFromResponse(res)
  assert.doesNotMatch(err.message, /^Blocked before reaching Anthropic/)
  assert.match(err.message, /^Anthropic API responded 403/)
  assert.match(err.message, /request-id req_123/)
})

test('500 is unchanged', async () => {
  const res = fakeResponse(500, {}, JSON.stringify({ error: { type: 'api_error', message: 'Internal error' } }))
  const err = await anthropicErrorFromResponse(res)
  assert.doesNotMatch(err.message, /^Blocked before reaching Anthropic/)
  assert.match(err.message, /^Anthropic API responded 500/)
  assert.match(err.message, /Internal error/)
})
