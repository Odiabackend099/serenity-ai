import { afterEach, describe, expect, it, vi } from 'vitest'
import { synthesizeSpeechForWhatsApp } from './deepgram.ts'

function stubDenoEnv(values: Record<string, string>) {
  vi.stubGlobal('Deno', {
    env: {
      get: (key: string) => values[key],
    },
  })
}

describe('Deepgram TTS', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('generates WhatsApp-ready Aura speech with OGG/Opus defaults', async () => {
    stubDenoEnv({ DEEPGRAM_API_KEY: 'deepgram-key' })

    const audioBytes = new Uint8Array([1, 2, 3]).buffer
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const requestUrl = new URL(url)
      expect(requestUrl.pathname).toBe('/v1/speak')
      expect(requestUrl.searchParams.get('model')).toBe('aura-2-thalia-en')
      expect(requestUrl.searchParams.get('encoding')).toBe('opus')
      expect(requestUrl.searchParams.get('container')).toBe('ogg')
      expect(init?.headers).toEqual({
        Authorization: 'Token deepgram-key',
        'Content-Type': 'application/json',
      })
      expect(JSON.parse(String(init?.body))).toEqual({ text: 'Hello from Dr Ade.' })

      return new Response(audioBytes, {
        status: 200,
        headers: { 'content-type': 'audio/ogg; codecs=opus' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await synthesizeSpeechForWhatsApp('Hello from Dr Ade.')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new Uint8Array(result.audioData)).toEqual(new Uint8Array([1, 2, 3]))
    expect(result.mimeType).toBe('audio/ogg; codecs=opus')
    expect(result.model).toBe('aura-2-thalia-en')
  })
})
