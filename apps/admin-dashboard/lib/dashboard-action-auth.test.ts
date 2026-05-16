import { describe, expect, it } from 'vitest'
import { DashboardActionError, assertDashboardRole } from './dashboard-action-auth'

describe('dashboard action role guard', () => {
  it('allows approved dashboard roles', () => {
    expect(() => assertDashboardRole('staff', ['staff', 'admin', 'super_admin'])).not.toThrow()
  })

  it('blocks missing or unapproved dashboard roles', () => {
    expect(() => assertDashboardRole(null, ['super_admin'])).toThrow(DashboardActionError)
    expect(() => assertDashboardRole('doctor', ['super_admin'])).toThrow(/not available/i)
  })
})
