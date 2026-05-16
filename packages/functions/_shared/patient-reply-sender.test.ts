import { describe, expect, it, vi } from 'vitest'
import { sendPatientReplyWithDeps, type PatientReplySenderDeps } from './patient-reply-sender.ts'

function deps(overrides: Partial<PatientReplySenderDeps> = {}): PatientReplySenderDeps {
  return {
    sendText: vi.fn(async () => undefined),
    synthesizeSpeech: vi.fn(async () => ({
      audioData: new Uint8Array([1, 2, 3]).buffer,
      mimeType: 'audio/ogg; codecs=opus',
    })),
    sendAudio: vi.fn(async () => 'wamid.audio-1'),
    trackUsage: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('patient reply sender', () => {
  it('sends voice-note general replies as audio', async () => {
    const testDeps = deps()

    const result = await sendPatientReplyWithDeps({
      to: '+2347026743998',
      text: 'Hello, how can I help?',
      inboundMessageType: 'audio',
      route: 'general_ai',
      deps: testDeps,
    })

    expect(result.audioSent).toBe(true)
    expect(result.textSent).toBe(false)
    expect(testDeps.synthesizeSpeech).toHaveBeenCalledWith('Hello, how can I help?')
    expect(testDeps.sendAudio).toHaveBeenCalledWith(
      '+2347026743998',
      expect.any(ArrayBuffer),
      'audio/ogg; codecs=opus',
    )
    expect(testDeps.trackUsage).toHaveBeenCalledWith('deepgram-tts', 0)
  })

  it('falls back to text when voice-note TTS fails', async () => {
    const testDeps = deps({
      synthesizeSpeech: vi.fn(async () => {
        throw new Error('tts down')
      }),
    })

    const result = await sendPatientReplyWithDeps({
      to: '+2347026743998',
      text: 'I can still help by text.',
      inboundMessageType: 'audio',
      route: 'general_ai',
      deps: testDeps,
    })

    expect(result.audioSent).toBe(false)
    expect(result.fellBackToText).toBe(true)
    expect(testDeps.sendText).toHaveBeenCalledWith('+2347026743998', 'I can still help by text.')
  })

  it('keeps booking replies text-only even when the patient used a voice note', async () => {
    const testDeps = deps()

    const result = await sendPatientReplyWithDeps({
      to: '+2347026743998',
      text: 'What date would you prefer?',
      inboundMessageType: 'audio',
      route: 'booking',
      deps: testDeps,
    })

    expect(result.delivery).toBe('text')
    expect(result.textSent).toBe(true)
    expect(testDeps.synthesizeSpeech).not.toHaveBeenCalled()
    expect(testDeps.sendAudio).not.toHaveBeenCalled()
  })

  it('sends emergency voice-note replies as text plus audio', async () => {
    const testDeps = deps()

    const result = await sendPatientReplyWithDeps({
      to: '+2347026743998',
      text: 'Please call Serenity Royale Hospital now.',
      inboundMessageType: 'audio',
      route: 'emergency',
      deps: testDeps,
    })

    expect(result.delivery).toBe('text_plus_audio')
    expect(result.textSent).toBe(true)
    expect(result.audioSent).toBe(true)
    expect(vi.mocked(testDeps.sendText).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(testDeps.synthesizeSpeech).mock.invocationCallOrder[0])
  })
})
