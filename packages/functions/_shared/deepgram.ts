/**
 * Deepgram STT (Speech-to-Text) integration.
 * PII/PHI redaction is EXPLICITLY enabled — not enabled by default.
 * Model: nova-2 (best accuracy for healthcare)
 *
 * IMPORTANT: redact=true must always be set for NDPR compliance.
 * Never store raw transcriptions — only store the redacted version.
 */

const DEEPGRAM_API_BASE = 'https://api.deepgram.com/v1'

function getApiKey(): string {
  const key = Deno.env.get('DEEPGRAM_API_KEY')
  if (!key) throw new Error('DEEPGRAM_API_KEY must be set')
  return key
}

export interface TranscriptionResult {
  transcript: string         // Original (with PII)
  redacted: string           // PII-redacted version for storage
  confidence: number
  durationSeconds: number
  language: string
}

/**
 * Transcribe an audio file using Deepgram nova-2.
 * PII redaction is always enabled for NDPR compliance.
 *
 * @param audioData - Raw audio bytes
 * @param mimeType - Audio MIME type (audio/ogg, audio/mpeg, audio/wav, etc.)
 */
export async function transcribeAudio(
  audioData: ArrayBuffer,
  mimeType: string,
): Promise<TranscriptionResult> {
  const apiKey = getApiKey()

  // Build query params — always enable redaction
  const params = new URLSearchParams({
    model: 'nova-2',
    smart_format: 'true',
    punctuate: 'true',
    language: 'en',         // WhatsApp voice notes are typically English or mixed
    redact: 'pci',          // PII/PCI redaction
    redact_entities: 'true', // Enables NER-based redaction (names, phones, addresses)
    diarize: 'false',
    filler_words: 'false',
  })

  const res = await fetch(`${DEEPGRAM_API_BASE}/listen?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': mimeType,
    },
    body: audioData,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Deepgram transcription failed (${res.status}): ${err}`)
  }

  const data = await res.json() as {
    results: {
      channels: Array<{
        alternatives: Array<{
          transcript: string
          confidence: number
          words: Array<{ word: string; redacted?: boolean }>
        }>
      }>
      redacted_transcript?: {
        transcript: string
      }
    }
    metadata: {
      duration: number
      detected_language?: string
    }
  }

  const channel = data.results?.channels?.[0]
  const alternative = channel?.alternatives?.[0]

  if (!alternative) {
    throw new Error('Deepgram returned no transcription')
  }

  // Build redacted transcript (replace redacted words with [REDACTED])
  const originalTranscript = alternative.transcript
  const redactedTranscript = data.results.redacted_transcript?.transcript
    ?? buildRedactedFromWords(alternative.words ?? [])

  return {
    transcript: originalTranscript,
    redacted: redactedTranscript,
    confidence: alternative.confidence ?? 0,
    durationSeconds: data.metadata?.duration ?? 0,
    language: data.metadata?.detected_language ?? 'en',
  }
}

/**
 * Build a redacted transcript from word-level redaction metadata.
 */
function buildRedactedFromWords(
  words: Array<{ word: string; redacted?: boolean }>,
): string {
  return words.map((w) => (w.redacted ? '[REDACTED]' : w.word)).join(' ')
}

/**
 * Apply regex-based PII masking to a text string.
 * Used as a secondary layer on top of Deepgram's NER redaction.
 * Catches phone numbers, emails, dates of birth, etc.
 */
export function redactPII(text: string): string {
  return text
    // Nigerian phone numbers (+234, 0xx patterns)
    .replace(/(\+?234|0)[789]\d{9}/g, '[PHONE]')
    // Generic phone numbers
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE]')
    // Email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    // Bank account numbers (10 digits common in Nigeria)
    .replace(/\b\d{10}\b/g, '[ACCOUNT]')
    // NIN (National Identity Number) — 11 digits
    .replace(/\b\d{11}\b/g, '[ID]')
    // Date patterns (various formats)
    .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, '[DATE]')
}

/**
 * Detect if a message is asking about rating/feedback (1-5 scale response).
 * Used by feedback collection flow.
 */
export function parseFeedbackRating(message: string): number | null {
  const trimmed = message.trim()

  // Direct numeric response
  const num = parseInt(trimmed, 10)
  if (!isNaN(num) && num >= 1 && num <= 5) return num

  // Word responses
  const map: Record<string, number> = {
    'one': 1, '1 star': 1, 'one star': 1,
    'two': 2, '2 stars': 2, 'two stars': 2,
    'three': 3, '3 stars': 3, 'three stars': 3,
    'four': 4, '4 stars': 4, 'four stars': 4,
    'five': 5, '5 stars': 5, 'five stars': 5,
    'excellent': 5, 'very good': 4, 'good': 4, 'average': 3, 'poor': 2, 'bad': 1,
  }

  const lower = trimmed.toLowerCase()
  return map[lower] ?? null
}
