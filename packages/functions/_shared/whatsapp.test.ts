import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadMedia, sendAudioMessage } from './whatsapp.ts'

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

  it('uploads generated audio to Meta and sends it by media ID', async () => {
    stubDenoEnv({
      WHATSAPP_PROVIDER: 'meta',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id',
      WHATSAPP_PERMANENT_ACCESS_TOKEN: 'meta-token',
      META_GRAPH_API_VERSION: 'v21.0',
    })

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://graph.facebook.com/v21.0/phone-number-id/media') {
        expect(init?.headers).toEqual({ Authorization: 'Bearer meta-token' })
        expect(init?.method).toBe('POST')
        const form = init?.body as FormData
        expect(form.get('messaging_product')).toBe('whatsapp')
        expect(form.get('type')).toBe('audio/ogg; codecs=opus')
        expect(form.get('file')).toBeInstanceOf(Blob)
        return Response.json({ id: 'media-audio-1' })
      }

      if (url === 'https://graph.facebook.com/v21.0/phone-number-id/messages') {
        expect(init?.headers).toEqual({
          Authorization: 'Bearer meta-token',
          'Content-Type': 'application/json',
        })
        const body = JSON.parse(String(init?.body))
        expect(body).toMatchObject({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '2347026743998',
          type: 'audio',
          audio: { id: 'media-audio-1' },
        })
        return Response.json({ messages: [{ id: 'wamid.audio-reply-1' }] })
      }

      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const messageId = await sendAudioMessage(
      '+234 702 674 3998',
      new Uint8Array([1, 2, 3]).buffer,
      'audio/ogg; codecs=opus',
    )

    expect(messageId).toBe('wamid.audio-reply-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
