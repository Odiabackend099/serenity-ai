import { describe, expect, it } from 'vitest'

const runLiveIntegration = process.env.RUN_LIVE_INTEGRATION === '1'

describe('optional live integration smoke checks', () => {
  it('loads the deployed dashboard login page when LIVE_DASHBOARD_URL is provided', async () => {
    if (!runLiveIntegration) {
      expect(runLiveIntegration).toBe(false)
      return
    }

    const dashboardUrl = process.env.LIVE_DASHBOARD_URL
    if (!dashboardUrl) {
      expect(dashboardUrl).toBeUndefined()
      return
    }

    const response = await fetch(dashboardUrl)
    expect(response.ok).toBe(true)
    expect(await response.text()).toContain('Serenity Royale Hospital')
  })

  it('rejects unauthenticated internal Edge Function requests when SUPABASE_FUNCTIONS_URL is provided', async () => {
    if (!runLiveIntegration) {
      expect(runLiveIntegration).toBe(false)
      return
    }

    const functionsUrl = process.env.SUPABASE_FUNCTIONS_URL
    if (!functionsUrl) {
      expect(functionsUrl).toBeUndefined()
      return
    }

    const response = await fetch(`${functionsUrl.replace(/\/+$/, '')}/send-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'manual_message', phone: '+15550000000', message: 'test' }),
    })

    expect(response.status).toBe(401)
  })
})
