import { getPatientReplyDelivery, type PatientReplyDelivery, type PatientReplyRoute } from './voice-reply-policy.ts'

type SpeechResult = {
  audioData: ArrayBuffer
  mimeType: string
}

export type PatientReplySenderDeps = {
  sendText: (to: string, text: string) => Promise<unknown>
  synthesizeSpeech: (text: string) => Promise<SpeechResult>
  sendAudio: (to: string, audioData: ArrayBuffer, mimeType: string) => Promise<string>
  trackUsage: (provider: string, costUsd: number) => Promise<void>
}

export type PatientReplySendResult = {
  delivery: PatientReplyDelivery
  textSent: boolean
  audioSent: boolean
  audioMessageId: string | null
  fellBackToText: boolean
  audioError: Error | null
}

export async function sendPatientReplyWithDeps(params: {
  to: string
  text: string
  inboundMessageType: string | null
  route: PatientReplyRoute
  deps: PatientReplySenderDeps
}): Promise<PatientReplySendResult> {
  const { to, text, inboundMessageType, route, deps } = params
  const delivery = getPatientReplyDelivery(inboundMessageType, route)
  const result: PatientReplySendResult = {
    delivery,
    textSent: false,
    audioSent: false,
    audioMessageId: null,
    fellBackToText: false,
    audioError: null,
  }

  if (delivery === 'text') {
    await deps.sendText(to, text)
    result.textSent = true
    return result
  }

  if (delivery === 'text_plus_audio') {
    await deps.sendText(to, text)
    result.textSent = true
    const audioResult = await trySendAudio(to, text, deps)
    return { ...result, ...audioResult }
  }

  const audioResult = await trySendAudio(to, text, deps)
  if (audioResult.audioSent) return { ...result, ...audioResult }

  await deps.sendText(to, text)
  return {
    ...result,
    ...audioResult,
    textSent: true,
    fellBackToText: true,
  }
}

async function trySendAudio(
  to: string,
  text: string,
  deps: PatientReplySenderDeps,
): Promise<Pick<PatientReplySendResult, 'audioSent' | 'audioMessageId' | 'audioError'>> {
  try {
    const speech = await deps.synthesizeSpeech(text)
    await deps.trackUsage('deepgram-tts', 0)
    const audioMessageId = await deps.sendAudio(to, speech.audioData, speech.mimeType)
    return {
      audioSent: true,
      audioMessageId,
      audioError: null,
    }
  } catch (err) {
    return {
      audioSent: false,
      audioMessageId: null,
      audioError: err instanceof Error ? err : new Error(String(err)),
    }
  }
}
