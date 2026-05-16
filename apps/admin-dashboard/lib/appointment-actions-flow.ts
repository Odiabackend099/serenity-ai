export type DashboardAppointmentActionDeps = {
  assignDoctor: (appointmentId: string, doctorId: string) => Promise<void>
  getAppointmentDoctorId: (appointmentId: string) => Promise<string | null>
  markNeedsDoctorAssignment: (appointmentId: string) => Promise<void>
  callNotificationFunction: (payload: Record<string, unknown>) => Promise<{ ok: boolean; errorText?: string; json?: unknown } | null>
  logError?: (message: string, error?: string) => void
  revalidate: () => void
}

export type ConfirmAppointmentResult =
  | { status: 'confirmed' }
  | { status: 'missing_doctor' }
  | { status: 'assignment_failed' }
  | { status: 'lookup_failed' }
  | { status: 'notification_failed' }
  | { status: 'schedule_needs_check' }

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

  const edgeResult = parseDashboardConfirmationResult(res.json)
  if (edgeResult && !edgeResult.confirmed) {
    deps.logError?.('[appointments] dashboard confirmation blocked:', edgeResult.message ?? edgeResult.calendarStatus ?? 'not confirmed')
    deps.revalidate()
    return edgeResult.calendarStatus === 'pending_no_matched_doctor'
      ? { status: 'missing_doctor' }
      : { status: 'schedule_needs_check' }
  }

  if (edgeResult?.confirmed && hasRequiredNotificationFailure(edgeResult.results)) {
    deps.logError?.('[appointments] dashboard confirmation saved with notification failures:', JSON.stringify(edgeResult.results))
    deps.revalidate()
    return { status: 'notification_failed' }
  }

  deps.revalidate()
  return { status: 'confirmed' }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

type DashboardConfirmationEdgeResult = {
  confirmed?: boolean
  calendarStatus?: string | null
  message?: string
  results?: Record<string, unknown>
}

function parseDashboardConfirmationResult(value: unknown): DashboardConfirmationEdgeResult | null {
  if (!value || typeof value !== 'object') return null
  return value as DashboardConfirmationEdgeResult
}

function hasRequiredNotificationFailure(results: Record<string, unknown> | undefined): boolean {
  if (!results) return false
  return ['whatsapp', 'email', 'assignedDoctorWhatsapp', 'operations_manager', 'primary_doctor']
    .some((key) => results[key] === false)
}
