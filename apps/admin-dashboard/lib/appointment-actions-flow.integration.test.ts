import { describe, expect, it } from 'vitest'
import { confirmAppointmentWithDeps } from './appointment-actions-flow'

function makeDeps(initialDoctorId: string | null = null) {
  const assignedDoctors: string[] = []
  const guardedAppointments: string[] = []
  const notificationPayloads: Record<string, unknown>[] = []
  const errors: string[] = []
  let doctorId = initialDoctorId
  let revalidateCount = 0

  return {
    assignedDoctors,
    guardedAppointments,
    notificationPayloads,
    errors,
    get revalidateCount() {
      return revalidateCount
    },
    deps: {
      assignDoctor: async (_appointmentId: string, selectedDoctorId: string) => {
        assignedDoctors.push(selectedDoctorId)
        doctorId = selectedDoctorId
      },
      getAppointmentDoctorId: async () => doctorId,
      markNeedsDoctorAssignment: async (appointmentId: string) => {
        guardedAppointments.push(appointmentId)
      },
      callNotificationFunction: async (payload: Record<string, unknown>) => {
        notificationPayloads.push(payload)
        return { ok: true }
      },
      logError: (message: string, error?: string) => {
        errors.push(`${message} ${error ?? ''}`.trim())
      },
      revalidate: () => {
        revalidateCount += 1
      },
    },
  }
}

describe('dashboard appointment action integration flow', () => {
  it('assigns a selected doctor before confirming through the notification function', async () => {
    const harness = makeDeps(null)

    const result = await confirmAppointmentWithDeps('appt-assign', 'doctor-olaleye', harness.deps)

    expect(result).toEqual({ status: 'confirmed' })
    expect(harness.assignedDoctors).toEqual(['doctor-olaleye'])
    expect(harness.guardedAppointments).toHaveLength(0)
    expect(harness.notificationPayloads).toEqual([
      {
        type: 'appointment_dashboard_confirmation',
        appointmentId: 'appt-assign',
      },
    ])
    expect(harness.revalidateCount).toBe(1)
  })

  it('keeps any-available-doctor appointments pending until staff assigns a doctor', async () => {
    const harness = makeDeps(null)

    const result = await confirmAppointmentWithDeps('appt-no-doctor', null, harness.deps)

    expect(result).toEqual({ status: 'missing_doctor' })
    expect(harness.assignedDoctors).toHaveLength(0)
    expect(harness.guardedAppointments).toEqual(['appt-no-doctor'])
    expect(harness.notificationPayloads).toHaveLength(0)
    expect(harness.revalidateCount).toBe(1)
  })

  it('logs notification service failures without reverting doctor assignment', async () => {
    const harness = makeDeps('doctor-grace')
    const deps = {
      ...harness.deps,
      callNotificationFunction: async (payload: Record<string, unknown>) => {
        harness.notificationPayloads.push(payload)
        return { ok: false, errorText: 'service unavailable' }
      },
    }

    const result = await confirmAppointmentWithDeps('appt-notification-fail', null, deps)

    expect(result).toEqual({ status: 'notification_failed' })
    expect(harness.notificationPayloads).toHaveLength(1)
    expect(harness.errors.join('\n')).toContain('dashboard confirmation failed')
    expect(harness.revalidateCount).toBe(1)
  })
})
