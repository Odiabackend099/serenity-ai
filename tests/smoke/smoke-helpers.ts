import { expect, type Page, type APIRequestContext } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const smokeBaseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:3001'
const smokeAdminEmail = process.env.SMOKE_ADMIN_EMAIL ?? 'dr.adekunle@serenityroyalehospital.com'
const smokeAdminPassword = process.env.SMOKE_ADMIN_PASSWORD
const smokeSupabaseUrl = process.env.SMOKE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const smokeServiceRoleKey = process.env.SMOKE_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
const canUseMagicLink = Boolean(smokeAdminEmail && smokeSupabaseUrl && smokeServiceRoleKey)

export const hasSmokeCredentials = Boolean((smokeAdminEmail && smokeAdminPassword) || canUseMagicLink)
export const allowMutation = process.env.SMOKE_ALLOW_MUTATION === '1'

export async function expectNoCrashText(page: Page): Promise<void> {
  await expect(page.getByText("This page couldn't load")).toHaveCount(0)
  await expect(page.getByText(/server error occurred/i)).toHaveCount(0)
  await expect(page.getByText(/Unhandled Runtime Error/i)).toHaveCount(0)
  await expect(page.getByText(/Application error/i)).toHaveCount(0)
}

export async function expectNoDeveloperFirstText(page: Page): Promise<void> {
  await expect(page.getByText(/ops contact/i)).toHaveCount(0)
  await expect(page.getByText(/\bNo proof\b/i)).toHaveCount(0)
  await expect(page.getByText(/Google Calendar POST \/freeBusy failed/i)).toHaveCount(0)
  await expect(page.getByText(/\{"error"/i)).toHaveCount(0)
}

export async function login(page: Page): Promise<void> {
  if (!hasSmokeCredentials) {
    throw new Error(
      'Authenticated smoke tests require either SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD, or a Supabase service-role environment that can mint magic links.'
    )
  }

  if (canUseMagicLink) {
    const adminClient = createClient(smokeSupabaseUrl!, smokeServiceRoleKey!)
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: smokeAdminEmail!,
    })

    if (error) throw error
    if (!data?.properties?.email_otp) throw new Error('Supabase did not return a one-time email token for smoke login')

    const anonClient = createClient(smokeSupabaseUrl!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { data: verified, error: verifyError } = await anonClient.auth.verifyOtp({
      email: smokeAdminEmail!,
      token: data.properties.email_otp,
      type: 'magiclink',
    })
    if (verifyError) throw verifyError
    if (!verified.session?.access_token || !verified.session.refresh_token) {
      throw new Error('Supabase verifyOtp did not return an authenticated session for smoke login')
    }

    const serializedSession = await createSerializedSession(
      smokeSupabaseUrl!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      verified.session.access_token,
      verified.session.refresh_token
    )
    const targetUrl = new URL(smokeBaseUrl)
    await page.context().addCookies([
      {
        name: buildStorageKey(smokeSupabaseUrl!),
        value: `base64-${toBase64Url(serializedSession)}`,
        domain: targetUrl.hostname,
        path: '/',
        httpOnly: false,
        secure: targetUrl.protocol === 'https:',
        sameSite: 'Lax',
      },
    ])

    await page.goto('/dashboard')
    await page.waitForURL(/\/dashboard(?:$|\/|\?)/, { timeout: 30_000 })
    await expectNoCrashText(page)
    return
  }

  await page.goto('/auth/login')
  await page.getByLabel(/email address/i).fill(smokeAdminEmail!)
  await page.getByLabel(/password/i).fill(smokeAdminPassword!)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/dashboard(?:$|\/|\?)/, { timeout: 20_000 })
  await expectNoCrashText(page)
}

export async function expectSafeUnauthenticatedExport(request: APIRequestContext, path: string): Promise<void> {
  const response = await request.get(path)
  expect([401, 302, 307, 308]).toContain(response.status())
}

async function createSerializedSession(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
  refreshToken: string
): Promise<string> {
  const stored: Record<string, string> = {}
  const captureStorage = {
    async getItem(key: string) {
      return stored[key] ?? null
    },
    async setItem(key: string, value: string) {
      stored[key] = value
    },
    async removeItem(key: string) {
      delete stored[key]
    },
  }

  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      storage: captureStorage,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
  if (error) throw error

  const storageKey = buildStorageKey(supabaseUrl)
  const serialized = stored[storageKey]
  if (!serialized) throw new Error(`Supabase client did not persist a session for ${storageKey}`)
  return serialized
}

function buildStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}
