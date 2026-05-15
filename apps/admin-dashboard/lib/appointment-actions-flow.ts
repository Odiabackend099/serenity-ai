export type DashboardAppointmentActionDeps = {
  assignDoctor: (appointmentId: string, doctorId: string) => Promise<void>
  getAppointmentDoctorId: (appointmentId: string) => Promise<string | null>
  markNeedsDoctorAssignment: (appointmentId: string) => Promise<void>
  callNotificationFunction: (payload: Record<string, unknown>) => Promise<{ ok: boolean; errorText?: string } | null>
  logError?: (message: string, error?: string) => void
  revalidate: () => void
}

export type ConfirmAppointmentResult =
  | { status: 'confirmed' }
  | { status: 'missing_doctor' }
  | { status: 'assignment_failed' }
  | { status: 'lookup_failed' }
  | { status: 'notification_failed' }

export async function confirmAppointmentWithDeps(
  appointmentId: string,
  doctorId: string | null,
  deps: DashboardAppointmentActionDeps,
): Promise<ConfirmAppointmentResult> {
  if (doctorId) {
    try {
      await deps.assignDoctor(appointmentId, doctorId)
    } catch (err) {
      deps.logError?.('[appointments] doctor assignment failed:', errorMessage(err))
      deps.revalidate()
      return { status: 'assignment_failed' }
    }
  }

  let assignedDoctorId: string | null
  try {
    assignedDoctorId = await deps.getAppointmentDoctorId(appointmentId)
  } catch (err) {
    deps.logError?.('[appointments] appointment lookup failed:', errorMessage(err))
    deps.revalidate()
    return { status: 'lookup_failed' }
  }

  if (!assignedDoctorId) {
    try {
      await deps.markNeedsDoctorAssignment(appointmentId)
    } catch (err) {
      deps.logError?.('[appointments] missing doctor guard update failed:', errorMessage(err))
    }
    deps.revalidate()
    return { status: 'missing_doctor' }
  }

  const res = await deps.callNotificationFunction({
    type: 'appointment_dashboard_confirmation',
    appointmentId,
  })

  if (!res?.ok) {
    deps.logError?.('[appointments] dashboard confirmation failed:', res?.errorText ?? 'service not configured')
    deps.revalidate()
    return { status: 'notification_failed' }
  }

  deps.revalidate()
  return { status: 'confirmed' }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
