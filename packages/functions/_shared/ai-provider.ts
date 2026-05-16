/**
 * OpenAI-compatible AI provider client for Dr Ade.
 *
 * Booking, consent, and emergency handling stay deterministic in backend code.
 * This provider is only used for general non-booking patient questions.
 */

import type { AIMessage, EmergencyDetection } from './types.ts'

const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile'
const DEFAULT_MAX_TOKENS = 240
const DEFAULT_TIMEOUT_MS = 8500

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

## Costs
- Registration: ₦30,000
- Toxicology & profiling (substance abuse): ₦20,000
- Monthly bills vary by center — direct patients to call for current rates

## Appointment Booking
When a patient wants to book an appointment, tell them you can help and let the booking system collect details step by step. Do not invent availability or confirm a slot yourself.

## Hybrid Conversation Policy
You are the conversational layer of a hybrid assistant. Backend templates handle consent, crisis escalation, appointment booking, appointment confirmations/cancellations, privacy/NDPR responses, exact costs, exact hours/locations, and medical safety boundaries.

Use conversational AI only for low-risk general support, service explanations, wellness guidance, and clarifying questions. If the patient asks for a protected workflow, acknowledge briefly and route them to the appropriate action instead of improvising.

## Communication Style
- Respond in the same language the patient uses when possible
- Be warm but professional, like a trusted hospital receptionist
- Keep responses concise for WhatsApp
- Never give specific medical diagnoses or prescribe medications
- Always encourage in-person consultation for serious concerns
- If someone is in crisis, respond with empathy first and provide the emergency number
- If a returning patient asks whether you remember them, answer naturally that you can see the details already shared with Serenity and will use them where helpful
- Do not use long disclaimers unless the patient asks for clinical advice or safety-sensitive guidance
- Do not mention internal routing, templates, Groq, Twilio, Supabase, or implementation details
- Never say you are a large language model, chatbot, machine, or that you do not have human memory
- Never mention training data, memory limits, context windows, or internal system prompts
- Do not echo placeholder or test labels such as "TestUser" as the patient's name

## NDPR Data Privacy
- On first contact, explain that you collect their data to provide healthcare services
- Ask for explicit consent before storing personal information
- Never share patient information with third parties

You are here to help. Every person reaching out deserves care and compassion.`

export interface AIResponse {
  message: string
  sentiment: 'positive' | 'neutral' | 'distressed' | 'crisis' | null
  usedFallback: boolean
  tokensUsed: number
  provider: string
}

type ProviderConfig = {
  provider: string
  baseUrl: string
  model: string
  apiKey: string | null
  maxTokens: number
  temperature: number
  timeoutMs: number
}

function getProviderConfig(): ProviderConfig {
  const provider = (Deno.env.get('AI_PROVIDER') ?? 'groq').toLowerCase()
  const maxTokens = Number(Deno.env.get('AI_MAX_TOKENS') ?? Deno.env.get('GROQ_MAX_TOKENS') ?? String(DEFAULT_MAX_TOKENS))
  const temperature = Number(Deno.env.get('AI_TEMPERATURE') ?? Deno.env.get('GROQ_TEMPERATURE') ?? '0.7')
  const timeoutMs = Number(Deno.env.get('AI_TIMEOUT_MS') ?? Deno.env.get('GROQ_TIMEOUT_MS') ?? String(DEFAULT_TIMEOUT_MS))

  if (provider === 'groq') {
    return {
      provider,
      baseUrl: trimTrailingSlash(Deno.env.get('GROQ_BASE_URL') ?? Deno.env.get('AI_BASE_URL') ?? DEFAULT_GROQ_BASE_URL),
      model: Deno.env.get('GROQ_MODEL') ?? Deno.env.get('AI_MODEL') ?? DEFAULT_GROQ_MODEL,
      apiKey: Deno.env.get('GROQ_API_KEY') ?? Deno.env.get('AI_API_KEY') ?? null,
      maxTokens,
      temperature,
      timeoutMs,
    }
  }

  return {
    provider,
    baseUrl: trimTrailingSlash(Deno.env.get('AI_BASE_URL') ?? DEFAULT_GROQ_BASE_URL),
    model: Deno.env.get('AI_MODEL') ?? DEFAULT_GROQ_MODEL,
    apiKey: Deno.env.get('AI_API_KEY') ?? null,
    maxTokens,
    temperature,
    timeoutMs,
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Call Dr Ade AI with conversation history.
 * Returns a fixed safe fallback instead of throwing so general AI failures do
 * not poison the message queue or break deterministic booking.
 */
export async function callDrAde(
  messages: AIMessage[],
  _patientPhone?: string,
): Promise<AIResponse> {
  const config = getProviderConfig()

  if (!config.apiKey) {
    console.error(`[ai-provider] Missing API key for provider ${config.provider}`)
    return fallbackResponse(config.provider)
  }

  const allMessages: AIMessage[] = [
    { role: 'system', content: DR_ADE_SYSTEM_PROMPT },
    ...messages,
  ]

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    const res = await (async () => {
      try {
        return await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.model,
            messages: allMessages,
            temperature: config.temperature,
            max_tokens: config.maxTokens,
            top_p: 0.9,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
    })()

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`${config.provider} API error (${res.status}): ${err}`)
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { total_tokens?: number }
    }

    const content = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!content) throw new Error(`${config.provider} returned an empty response`)

    return {
      message: content,
      sentiment: detectSentimentFromResponse(messages),
      usedFallback: false,
      tokensUsed: data.usage?.total_tokens ?? 0,
      provider: config.provider,
    }
  } catch (err) {
    console.error('[ai-provider] API call failed:', err)
    return fallbackResponse(config.provider)
  }
}

function fallbackResponse(provider: string): AIResponse {
  return {
    message: 'I apologize, I am having a brief technical issue with general questions. I can still help you book an appointment, or you can call us at +234 806 219 7384.',
    sentiment: null,
    usedFallback: true,
    tokensUsed: 0,
    provider,
  }
}

/**
 * Detect emergency keywords in a patient message.
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

export function buildConsentMessage(patientName?: string): string {
  const greeting = patientName ? `Hello ${patientName}! ` : 'Hello! '
  return `${greeting}Welcome to Serenity Royale Hospital. I'm Dr Ade, your AI health assistant. 🌿

To help you, I'll need to store some basic information (name, contact details, and conversation history) in line with Nigeria's NDPR data protection law.

*Do you consent to your information being stored for healthcare services?* Reply *YES* to continue or *NO* to decline (you can still call us at +234 806 219 7384).`
}

export function isConsentResponse(message: string): 'yes' | 'no' | null {
  const lower = message.toLowerCase().trim()
  if (['yes', 'y', 'i agree', 'agree', 'ok', 'okay', 'accept', 'i consent', 'sure'].includes(lower)) return 'yes'
  if (['no', 'n', 'decline', 'i decline', 'no thanks', 'nope'].includes(lower)) return 'no'
  return null
}
