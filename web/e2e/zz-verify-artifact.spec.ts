import { expect, test } from '@playwright/test'

// TEMPORARY — forces a failure so the artifact-upload step runs. Removed before merge.
test('temporary failure to exercise artifact upload', async () => {
  expect(1).toBe(2)
})
