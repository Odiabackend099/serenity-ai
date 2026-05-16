import { describe, expect, it } from 'vitest'
import { getPatientReplyDelivery } from './voice-reply-policy.ts'

describe('voice reply policy integration', () => {
  it('uses audio for voice-note general, memory, and hybrid replies', () => {
    expect(getPatientReplyDelivery('audio', 'general_ai')).toBe('audio')
    expect(getPatientReplyDelivery('audio', 'memory')).toBe('audio')
    expect(getPatientReplyDelivery('audio', 'hybrid_template')).toBe('audio')
  })

  it('keeps appointment booking and images as text', () => {
    expect(getPatientReplyDelivery('audio', 'booking')).toBe('text')
    expect(getPatientReplyDelivery('audio', 'booking_start')).toBe('text')
    expect(getPatientReplyDelivery('image', 'image_analysis')).toBe('text')
  })

  it('uses text plus audio for emergency responses to voice notes', () => {
    expect(getPatientReplyDelivery('audio', 'emergency')).toBe('text_plus_audio')
    expect(getPatientReplyDelivery('text', 'emergency')).toBe('text')
  })
})
