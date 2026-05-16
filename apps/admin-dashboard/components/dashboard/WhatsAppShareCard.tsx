'use client'

import { useEffect, useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

type WhatsAppShareCardProps = {
  shareUrl: string
}

export default function WhatsAppShareCard({ shareUrl }: WhatsAppShareCardProps) {
  const qrWrapperRef = useRef<HTMLDivElement | null>(null)
  const [copyLabel, setCopyLabel] = useState('Copy link')

  useEffect(() => {
    if (copyLabel === 'Copy link') return

    const timer = window.setTimeout(() => {
      setCopyLabel('Copy link')
    }, 2000)

    return () => window.clearTimeout(timer)
  }, [copyLabel])

  function getCanvas(): HTMLCanvasElement | null {
    return qrWrapperRef.current?.querySelector('canvas') ?? null
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyLabel('Copied')
    } catch {
      setCopyLabel('Copy failed')
    }
  }

  function handleDownload() {
    const canvas = getCanvas()
    if (!canvas) return

    const link = document.createElement('a')
    link.href = canvas.toDataURL('image/png')
    link.download = 'dr-adekunle-whatsapp-qr.png'
    link.click()
  }

  function handlePrint() {
    const canvas = getCanvas()
    if (!canvas) return

    const dataUrl = canvas.toDataURL('image/png')
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=720,height=900')
    if (!printWindow) return

    printWindow.document.write(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Dr. Adekunle WhatsApp QR</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 32px;
              color: #111827;
              text-align: center;
            }
            .card {
              max-width: 520px;
              margin: 0 auto;
              border: 1px solid #d1d5db;
              border-radius: 16px;
              padding: 24px;
            }
            img {
              width: 320px;
              height: 320px;
              max-width: 100%;
            }
            h1 {
              margin: 0 0 12px;
              font-size: 28px;
            }
            p {
              margin: 8px 0;
              line-height: 1.5;
            }
            .link {
              word-break: break-all;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Dr. Adekunle's AI Chat QR</h1>
            <p>Scan to start chatting with Serenity Royale Hospital AI on WhatsApp.</p>
            <img src="${dataUrl}" alt="Dr. Adekunle WhatsApp QR code" />
            <p class="link">${shareUrl}</p>
          </div>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    window.setTimeout(() => {
      printWindow.print()
    }, 250)
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
        <div className="flex justify-center lg:w-72">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm">
            <div ref={qrWrapperRef} className="rounded-xl bg-white p-3">
              <QRCodeCanvas
                value={shareUrl}
                size={240}
                marginSize={2}
                level="H"
                bgColor="#ffffff"
                fgColor="#111827"
              />
            </div>
          </div>
        </div>

        <div className="flex-1">
          <h2 className="font-semibold text-gray-900">Dr. Adekunle&apos;s patient QR</h2>
          <p className="mt-2 text-sm text-gray-500">
            Put this QR code on Dr. Adekunle&apos;s table so patients can scan and start chatting with the AI immediately.
          </p>

          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Shareable WhatsApp link</p>
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block break-all text-sm font-medium text-serenity-700 hover:text-serenity-900"
            >
              {shareUrl}
            </a>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg bg-serenity-600 px-4 py-2 text-sm font-medium text-white hover:bg-serenity-700 transition"
            >
              {copyLabel}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              Download QR
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              Print
            </button>
          </div>

          <p className="mt-4 text-xs text-gray-400">
            The QR code, copy button, and printed card all use the exact same WhatsApp link.
          </p>
        </div>
      </div>
    </section>
  )
}
