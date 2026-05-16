import { describe, expect, it } from 'vitest'
import { resolveEdgeFunctionBaseUrl } from './edge-functions'

describe('edge function URL resolution', () => {
  it('uses a test override base URL when provided', () => {
    expect(resolveEdgeFunctionBaseUrl('https://project.supabase.co', 'http://127.0.0.1:54321/functions/v1/')).toBe(
      'http://127.0.0.1:54321/functions/v1',
    )
  })

  it('defaults to the Supabase production functions URL', () => {
    expect(resolveEdgeFunctionBaseUrl('https://project.supabase.co', '')).toBe(
      'https://project.supabase.co/functions/v1',
    )
  })

  it('returns null when no URL is configured', () => {
    expect(resolveEdgeFunctionBaseUrl('', '')).toBeNull()
  })
})
