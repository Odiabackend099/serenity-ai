import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeImageWithDrAde } from './ai-provider.ts'

function stubDenoEnv(values: Record<string, string>) {
  vi.stubGlobal('Deno', {
    env: {
      get: (key: string) => values[key],
    },
  })
}

describe('AI provider image analysis', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends WhatsApp images to the configured Groq vision model', async () => {
    stubDenoEnv({
      AI_PROVIDER: 'groq',
      GROQ_API_KEY: 'groq-key',
      GROQ_VISION_MODEL: 'meta-llama/llama-4-scout-17b-16e-instruct',
    })

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body))
      expect(payload.model).toBe('meta-llama/llama-4-scout-17b-16e-instruct')
      expect(payload.messages[1].content[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('Patient caption'),
      })
      expect(payload.messages[1].content[1]).toMatchObject({
        type: 'image_url',
        image_url: {
          url: expect.stringContaining('data:image/jpeg;base64,'),
        },
      })

      return Response.json({
        choices: [{ message: { content: 'I can see the image. Please bring this to your appointment.' } }],
        usage: { total_tokens: 42 },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await analyzeImageWithDrAde(
      new Uint8Array([1, 2, 3]).buffer,
      'image/jpeg',
      'Patient caption',
    )

    expect(result.usedFallback).toBe(false)
    expect(result.message).toContain('I can see the image')
    expect(result.provider).toBe('groq:vision')
    expect(result.tokensUsed).toBe(42)
  })

  it('returns a staff-safe fallback when the vision model is not configured', async () => {
    stubDenoEnv({})

    const result = await analyzeImageWithDrAde(new Uint8Array([1]).buffer, 'image/jpeg', '[Image]')

    expect(result.usedFallback).toBe(true)
    expect(result.message).toContain('I received the image')
  })
})
