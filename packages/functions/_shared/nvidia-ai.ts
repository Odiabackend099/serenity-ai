/**
 * NVIDIA NIM API client for Dr Ade AI assistant.
 * Uses OpenAI-compatible API at https://integrate.api.nvidia.com/v1
 * Model: nvidia/llama-3.3-70b-instruct (primary) or mistralai/mixtral-8x7b-instruct-v0.1 (fallback)
 *
 * Rate limit: 40 RPM free tier — we cap at 35 RPM (sliding window)
 * Daily budget tracking via api_quotas table
 */

import type { AIMessage, EmergencyDetection } from './types.ts'

const NVIDIA_API_BASE = 'https://integrate.api.nvidia.com/v1'
const PRIMARY_MODEL = 'nvidia/llama-3.3-70b-instruct'
const MAX_RPM = 35 // Buffer below 40 RPM free tier limit

// Simple in-memory rate limiter (per Edge Function instance)
const requestTimestamps: number[] = []

function checkRateLimit(): boolean {
  const now = Date.now()
  const windowStart = now - 60_000 // 1-minute window

  // Remove timestamps outside the window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < windowStart) {
    requestTimestamps.shift()
  }

  if (requestTimestamps.length >= MAX_RPM) {
    return false // Rate limit hit
  }

  requestTimestamps.push(now)
  return true
}

// Dr Ade system prompt — DO NOT change without MD approval
const DR_ADE_SYSTEM_PROMPT = `You are Dr Ade, the AI-powered receptionist and health assistant for Serenity Royale Hospital in Abuja, Nigeria. You represent the hospital with warmth, professionalism, and cultural sensitivity.

## Hospital Information
- **Name**: Serenity Royale Hospital
- **MD**: Dr. Kunle Adesina
- **Tagline**: "Every life is valuable. Every individual has the potential to create positive change."
- **Mission**: Transform lives by setting a higher standard for total and holistic recovery through innovation, accountability, and non-judgmental care.
- **Values**: Integrity, Confidentiality, Innovation, Excellence, Team Work, Fear of God

## Our Centers
- **Head Office (Galadimawa)**: No. 10 Royal Homes Estate, Galadinmawa, Abuja
- **Annex (Karu)**: No. 11 Ali Amodu Close (behind CBN Quarters), Karu, Abuja

## Services We Offer
1. Psychological Medicine & Psychiatry — comprehensive, compassionate psychiatric care
2. Drug Abuse Treatment & Rehabilitation — addiction recovery and support programs
3. Encephalography (EEG) — brain wave diagnostic testing
4. Neurology — headaches, tremors, memory disorders, neurological conditions
5. Physiotherapy — hands-on, drug-free treatment (massage, heat therapy, exercises)
6. Consultancy Services — professional healthcare consultancy
7. General Medical Practice — acute and chronic disease care
- **Specialty**: Dual diagnosis (co-occurring mental health and substance use disorders)

## Contact
- **Phone 1**: +234 806 219 7384
- **Phone 2**: +234 811 689 1990
- **Email**: info@serenityroyalehospital.com
- **Website**: serenityroyalehospital.com
- **Social**: @serenityroyale_ (all platforms)

## Hours
- **Emergency**: 24/7 every day including Sunday
- **Outpatient**: 8am - 4pm daily except Sunday

## Costs (what patients ask about)
- Registration: ₦30,000
- Toxicology & profiling (substance abuse): ₦20,000
- Monthly bills vary by center — direct them to call for current rates

## Appointment Booking
When a patient wants to book an appointment, collect step by step:
1. Full name (if not already known)
2. Gender/Sex
3. Location (within Abuja / outside Abuja)
4. Service type (rehabilitation / psychiatric evaluation / physiotherapy / EEG / neurology / general medicine)
5. Doctor preference (explain Dr. Adesina is the MD; other doctors available)
6. Preferred date (within 6 months from today)
7. Preferred time (8am–4pm window for outpatient)
8. Preferred center (Karu / Galadimawa)

## Communication Style
- Respond in the same language the patient uses (English, Hausa, Yoruba, Igbo)
- Be warm but professional — like a trusted family doctor's receptionist
- Keep responses concise for WhatsApp (3-4 sentences max unless explaining something complex)
- Never give specific medical diagnoses or prescribe medications
- Always encourage in-person consultation for serious concerns
- If someone is in a mental health crisis, respond with empathy FIRST, then provide the emergency number

## NDPR Data Privacy
- On first contact, explain that you collect their data to provide healthcare services
- Ask for explicit consent before storing personal information
- Never share patient information with third parties

## CRITICAL: Emergency Response
If a patient expresses suicidal thoughts, self-harm intent, drug overdose, or panic attack:
1. Respond with immediate empathy and de-escalation
2. Provide emergency number: +234 806 219 7384 (available 24/7)
3. Encourage them to call or come in immediately
4. Do NOT minimize their feelings or dismiss the situation
5. The system will automatically alert hospital staff

You are here to help. Every person reaching out deserves care and compassion.`

export interface AIResponse {
  message: string
  sentiment: 'positive' | 'neutral' | 'distressed' | 'crisis' | null
  usedFallback: boolean
  tokensUsed: number
}

/**
 * Call NVIDIA NIM API with conversation history.
 * Falls back to a template response if rate-limited or API fails.
 */
export async function callDrAde(
  messages: AIMessage[],
  patientPhone?: string,
): Promise<AIResponse> {
  const apiKey = Deno.env.get('NVIDIA_API_KEY')
  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY must be set')
  }

  // Rate limit check
  if (!checkRateLimit()) {
    console.warn(`[nvidia-ai] Rate limit reached — using fallback response`)
    return {
      message: 'I\'m receiving a lot of messages right now. Please try again in a moment, or call us directly at +234 806 219 7384.',
      sentiment: null,
      usedFallback: true,
      tokensUsed: 0,
    }
  }

  const allMessages: AIMessage[] = [
    { role: 'system', content: DR_ADE_SYSTEM_PROMPT },
    ...messages,
  ]

  try {
    const res = await fetch(`${NVIDIA_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PRIMARY_MODEL,
        messages: allMessages,
        temperature: 0.7,
        max_tokens: 512,
        top_p: 0.9,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`NVIDIA API error (${res.status}): ${err}`)
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>
      usage: { total_tokens: number }
    }

    const content = data.choices[0]?.message?.content ?? ''
    const tokensUsed = data.usage?.total_tokens ?? 0

    // Detect sentiment from the AI response tone
    const sentiment = detectSentimentFromResponse(messages)

    return {
      message: content.trim(),
      sentiment,
      usedFallback: false,
      tokensUsed,
    }
  } catch (err) {
    console.error('[nvidia-ai] API call failed:', err)
    return {
      message: 'I apologize, I\'m having a brief technical issue. Please call us at +234 806 219 7384 or try again shortly.',
      sentiment: null,
      usedFallback: true,
      tokensUsed: 0,
    }
  }
}

/**
 * Detect emergency keywords in a patient message.
 * Returns detection result with confidence score.
 */
export function detectEmergency(message: string): EmergencyDetection {
  const lower = message.toLowerCase()

  const patterns = {
    suicidal: {
      keywords: ['kill myself', 'end my life', 'suicide', 'want to die', 'no reason to live', 'better off dead', 'take my own life', 'kms', 'kill me'],
      alertType: 'suicidal' as const,
      severity: 'critical' as const,
    },
    self_harm: {
      keywords: ['hurt myself', 'cut myself', 'self harm', 'self-harm', 'cutting myself', 'burning myself', 'harming myself'],
      alertType: 'self_harm' as const,
      severity: 'critical' as const,
    },
    drug_overdose: {
      keywords: ['overdose', 'took too many', 'took too much', 'swallowed pills', 'od\'d', 'drug overdose', 'pill overdose'],
      alertType: 'drug_overdose' as const,
      severity: 'critical' as const,
    },
    panic_attack: {
      keywords: ['panic attack', 'can\'t breathe', "can't breathe", 'heart racing', 'dying right now', 'chest pain', 'hyperventilating', 'severe anxiety'],
      alertType: 'panic_attack' as const,
      severity: 'high' as const,
    },
  }

  let bestMatch: EmergencyDetection = {
    isEmergency: false,
    alertType: null,
    severity: null,
    keywordsFound: [],
    confidence: 0,
  }

  for (const [, pattern] of Object.entries(patterns)) {
    const found = pattern.keywords.filter((kw) => lower.includes(kw))
    if (found.length > 0) {
      const confidence = Math.min(0.7 + found.length * 0.1, 1.0)
      if (confidence > bestMatch.confidence) {
        bestMatch = {
          isEmergency: true,
          alertType: pattern.alertType,
          severity: pattern.severity,
          keywordsFound: found,
          confidence,
        }
      }
    }
  }

  return bestMatch
}

/**
 * Simple sentiment detection from conversation messages.
 */
function detectSentimentFromResponse(
  messages: AIMessage[],
): 'positive' | 'neutral' | 'distressed' | 'crisis' | null {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content?.toLowerCase() ?? ''

  const crisisWords = ['kill', 'suicide', 'die', 'overdose', 'self harm', 'hurt myself']
  const distressWords = ['anxious', 'depressed', 'sad', 'hopeless', 'scared', 'panic', 'worried', 'stressed', 'can\'t cope']
  const positiveWords = ['thank', 'better', 'great', 'good', 'appointment', 'book', 'hello', 'hi']

  if (crisisWords.some((w) => lastUserMsg.includes(w))) return 'crisis'
  if (distressWords.some((w) => lastUserMsg.includes(w))) return 'distressed'
  if (positiveWords.some((w) => lastUserMsg.includes(w))) return 'positive'

  return 'neutral'
}

/**
 * Build the NDPR consent request message for first-time patients.
 */
export function buildConsentMessage(patientName?: string): string {
  const greeting = patientName ? `Hello ${patientName}! ` : 'Hello! '
  return `${greeting}Welcome to Serenity Royale Hospital. I'm Dr Ade, your AI health assistant. 🌿

To help you, I'll need to store some basic information (name, contact details, and conversation history) in line with Nigeria's NDPR data protection law.

*Do you consent to your information being stored for healthcare services?* Reply *YES* to continue or *NO* to decline (you can still call us at +234 806 219 7384).`
}

/**
 * Check if a message is a consent response.
 */
export function isConsentResponse(message: string): 'yes' | 'no' | null {
  const lower = message.toLowerCase().trim()
  if (['yes', 'y', 'i agree', 'agree', 'ok', 'okay', 'accept', 'i consent', 'sure'].includes(lower)) return 'yes'
  if (['no', 'n', 'decline', 'i decline', 'no thanks', 'nope'].includes(lower)) return 'no'
  return null
}
