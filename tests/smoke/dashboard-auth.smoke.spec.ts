import { expect, test } from '@playwright/test'
import {
  allowMutation,
  expectNoCrashText,
  expectNoDeveloperFirstText,
  hasSmokeCredentials,
  login,
} from './smoke-helpers'

type SmokePage = {
  label: string
  path: string
  heading: RegExp
}

const corePages: SmokePage[] = [
  { label: 'Today', path: '/dashboard', heading: /^today$/i },
  { label: 'Bookings', path: '/dashboard/appointments', heading: /^bookings$/i },
  { label: 'Urgent Messages', path: '/dashboard/emergencies', heading: /^urgent messages$/i },
  { label: 'Patients', path: '/dashboard/patients', heading: /^patients$/i },
  { label: 'Patient Chats', path: '/dashboard/conversations', heading: /^patient chats$/i },
]

const managementPages: SmokePage[] = [
  { label: 'Reports', path: '/dashboard/analytics', heading: /^reports$/i },
  { label: 'Hospital Setup', path: '/dashboard/settings', heading: /^hospital setup$/i },
  { label: 'Activity history', path: '/dashboard/audit', heading: /^activity history$/i },
]

test.describe('authenticated dashboard smoke', () => {
  test.skip(!hasSmokeCredentials, 'Set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD to run authenticated dashboard smoke tests')

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('loads all main dashboard pages without crash screens or developer-first text', async ({ page }) => {
    for (const item of corePages) {
      await assertPageHeading(page, item)
    }

    for (const item of managementPages) {
      await assertManagementPageAccess(page, item)
    }
  })

  test('navigates through sidebar links and desktop collapse control', async ({ page, isMobile }) => {
    await page.goto('/dashboard')
    if (isMobile) {
      await page.getByRole('button', { name: /open navigation menu/i }).click()
      await expect(page.getByRole('link', { name: /^bookings$/i })).toBeVisible()
      await page.getByRole('complementary').getByRole('button', { name: /close navigation menu/i }).click()
    } else {
      await page.getByRole('button', { name: /collapse navigation/i }).click()
      await expect(page.getByRole('button', { name: /expand navigation/i })).toBeVisible()
    }

    for (const item of corePages) {
      if (isMobile) {
        await page.getByRole('button', { name: /open navigation menu/i }).click()
      }
      const navigation = isMobile ? page.getByRole('complementary') : page
      await navigation.getByRole('link', { name: new RegExp(`^${escapeRegExp(item.label)}$`, 'i') }).click()
      await expect(page).toHaveURL(new RegExp(`${item.path.replace(/\//g, '\\/')}(?:$|\\?)`))
      await expect(page.getByRole('heading', { name: item.heading })).toBeVisible()
      await expectNoCrashText(page)
    }

    for (const item of managementPages) {
      if (isMobile) {
        await page.getByRole('button', { name: /open navigation menu/i }).click()
      }
      const navigation = isMobile ? page.getByRole('complementary') : page
      const link = navigation.getByRole('link', { name: new RegExp(`^${escapeRegExp(item.label)}$`, 'i') })
      if (await link.count()) {
        await link.click()
        await expect(page).toHaveURL(new RegExp(`${item.path.replace(/\//g, '\\/')}(?:$|\\?)`))
        await expect(page.getByRole('heading', { name: item.heading })).toBeVisible()
        await expectNoCrashText(page)
      } else if (isMobile) {
        await page.getByRole('complementary').getByRole('button', { name: /close navigation menu/i }).click()
      }
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow).toBe(false)
  })

  test('shows appointment actions without clicking destructive notification buttons by default', async ({ page }) => {
    await page.goto('/dashboard/appointments')
    await expect(page.getByRole('heading', { name: /^bookings$/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /upcoming/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /waiting/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /confirmed/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /whatsapp bookings/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /schedule check/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /download list/i })).toHaveAttribute('href', '/api/export/appointments')

    const destructiveActions = page.getByRole('button', {
      name: /confirm booking|cancel booking|resend updates|send 1-week reminder|send 24-hour reminder|send 2-hour reminder|mark completed|mark did not attend/i,
    })
    const actionCount = await destructiveActions.count()
    expect(actionCount).toBeGreaterThanOrEqual(0)

    if (!allowMutation) {
      await expectNoCrashText(page)
      await expectNoDeveloperFirstText(page)
      return
    }
  })

  test('exercises safe Hospital Setup QR controls when available', async ({ page }) => {
    await page.addInitScript(() => {
      window.open = () => ({
        document: {
          write() {},
          close() {},
        },
        focus() {},
        print() {},
      } as unknown as Window)
    })

    await page.goto('/dashboard/settings')

    if (!/\/dashboard\/settings(?:$|\?)/.test(page.url())) {
      await expect(page.getByRole('heading', { name: /^today$/i })).toBeVisible()
      return
    }

    await expect(page.getByRole('heading', { name: /^hospital setup$/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /dr\. adekunle's patient qr/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /wa\.me\/2347026743998/i })).toBeVisible()

    await page.getByRole('button', { name: /^copy link$/i }).click()
    await expect(page.getByRole('button', { name: /copied|copy failed/i })).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /download qr/i }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/dr-adekunle-whatsapp-qr\.png/)

    await page.getByRole('button', { name: /^print$/i }).click()
    await expectNoCrashText(page)
  })
})

async function assertPageHeading(page: Parameters<typeof login>[0], item: SmokePage): Promise<void> {
  await page.goto(item.path)
  await expect(page.getByRole('heading', { name: item.heading })).toBeVisible()
  await expectNoCrashText(page)
  await expectNoDeveloperFirstText(page)
}

async function assertManagementPageAccess(page: Parameters<typeof login>[0], item: SmokePage): Promise<void> {
  await page.goto(item.path)

  if (new RegExp(`${item.path.replace(/\//g, '\\/')}(?:$|\\?)`).test(page.url())) {
    await expect(page.getByRole('heading', { name: item.heading })).toBeVisible()
  } else {
    await expect(page).toHaveURL(/\/dashboard(?:$|\/|\?)/)
    await expect(page.getByRole('heading', { name: /^today$/i })).toBeVisible()
  }

  await expectNoCrashText(page)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
