import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadMedia } from './whatsapp.ts'

function stubDenoEnv(values: Record<string, string>) {
  vi.stubGlobal('Deno', {
    env: {
      get: (key: string) => values[key],
    },
  })
}

describe('WhatsApp media downloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads Meta media IDs through the Graph API before returning bytes', async () => {
    stubDenoEnv({
      WHATSAPP_PROVIDER: 'meta',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id',
      WHATSAPP_PERMANENT_ACCESS_TOKEN: 'meta-token',
      META_GRAPH_API_VERSION: 'v21.0',
    })

    const audioBytes = new Uint8Array([1, 2, 3]).buffer
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toEqual({ Authorization: 'Bearer meta-token' })

      if (url === 'https://graph.facebook.com/v21.0/media-123') {
        return Response.json({
          url: 'https://lookaside.fbsbx.com/whatsapp-media/audio',
          mime_type: 'audio/ogg; codecs=opus',
        })
      }

      if (url === 'https://lookaside.fbsbx.com/whatsapp-media/audio') {
        return new Response(audioBytes, {
          status: 200,
          headers: { 'content-type': 'audio/ogg; codecs=opus' },
        })
      }

      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadMedia('media-123')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]))
    expect(result.mimeType).toBe('audio/ogg; codecs=opus')
  })

  it('uses Meta metadata MIME type when the media download response omits content-type', async () => {
    stubDenoEnv({
      WHATSAPP_PROVIDER: 'meta',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id',
      WHATSAPP_PERMANENT_ACCESS_TOKEN: 'meta-token',
      META_GRAPH_API_VERSION: 'v21.0',
    })

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://graph.facebook.com/v21.0/image-123') {
        return Response.json({
          url: 'https://lookaside.fbsbx.com/whatsapp-media/image',
          mime_type: 'image/jpeg',
        })
      }

      return new Response(new Uint8Array([9]).buffer)
    }))

    const result = await downloadMedia('image-123')

    expect(result.mimeType).toBe('image/jpeg')
  })
})
