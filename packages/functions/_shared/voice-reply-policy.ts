export type PatientReplyRoute =
  | 'admin'
  | 'consent'
  | 'emergency'
  | 'booking'
  | 'booking_start'
  | 'feedback'
  | 'memory'
  | 'hybrid_template'
  | 'image_analysis'
  | 'general_ai'

export type PatientReplyDelivery = 'text' | 'audio' | 'text_plus_audio'

export function getPatientReplyDelivery(
  inboundMessageType: string | null | undefined,
  route: PatientReplyRoute,
): PatientReplyDelivery {
  const isVoiceNote = inboundMessageType === 'audio' || inboundMessageType === 'voice'

  if (route === 'emergency') return isVoiceNote ? 'text_plus_audio' : 'text'

  if (!isVoiceNote) return 'text'

  if (route === 'memory' || route === 'hybrid_template' || route === 'general_ai') {
    return 'audio'
  }

  return 'text'
}
