import { expect, test } from '@playwright/test'
import { expectNoCrashText, expectSafeUnauthenticatedExport } from './smoke-helpers'

test.describe('public dashboard shell smoke', () => {
  test('redirects public root users to login', async ({ page }) => {
    await page.goto('/')
    await page.waitForURL(/\/auth\/login/)
    await expect(page.getByRole('heading', { name: /serenity royale hospital/i })).toBeVisible()
    await expectNoCrashText(page)
  })

  test('loads login page with Serenity branding and form controls', async ({ page }) => {
    await page.goto('/auth/login')

    await expect(page.getByAltText(/serenity royale hospital logo/i)).toBeVisible()
    await expect(page.getByRole('heading', { name: /serenity royale hospital/i })).toBeVisible()
    await expect(page.getByLabel(/email address/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
    await expectNoCrashText(page)
  })

  test('serves PWA manifest and icons', async ({ request }) => {
    const manifest = await request.get('/manifest.webmanifest')
    expect(manifest.ok()).toBe(true)

    const json = await manifest.json()
    expect(json.name).toContain('Serenity')
    expect(json.display).toBe('standalone')
    expect(json.icons?.length).toBeGreaterThanOrEqual(2)

    expect((await request.get('/icons/icon-192.png')).ok()).toBe(true)
    expect((await request.get('/icons/icon-512.png')).ok()).toBe(true)
    expect((await request.get('/brand/serenity-royale-logo.png')).ok()).toBe(true)
  })

  test('returns hardened security headers on public and protected responses', async ({ request }) => {
    const login = await request.get('/auth/login')
    expect(login.ok()).toBe(true)

    assertSecurityHeaders(login.headers())

    const redirect = await request.get('/dashboard', { maxRedirects: 0 })
    expect(redirect.status()).toBe(307)
    expect(redirect.headers().location).toBe('/auth/login')
    assertSecurityHeaders(redirect.headers())
  })

  test('protects dashboard and export routes without login', async ({ page, request }) => {
    await page.goto('/dashboard')
    await page.waitForURL(/\/auth\/login/)
    await expectNoCrashText(page)

    await expectSafeUnauthenticatedExport(request, '/api/export/appointments')
    await expectSafeUnauthenticatedExport(request, '/api/export/patients')
  })
})

function assertSecurityHeaders(headers: Record<string, string>): void {
  expect(headers['content-security-policy']).toContain("default-src 'self'")
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['permissions-policy']).toContain('camera=()')
  expect(headers['strict-transport-security']).toContain('max-age=63072000')
  expect(headers['x-powered-by']).toBeUndefined()
}
