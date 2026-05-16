'use client'

import { useEffect, useRef, useState } from 'react'
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react'

type WhatsAppShareCardProps = {
  shareUrl: string
}

export default function WhatsAppShareCard({ shareUrl }: WhatsAppShareCardProps) {
  const qrWrapperRef = useRef<HTMLDivElement | null>(null)
  const [copyLabel, setCopyLabel] = useState('Copy link')
  const [printLabel, setPrintLabel] = useState('Print')

  useEffect(() => {
    if (copyLabel === 'Copy link') return undefined
    const timer = window.setTimeout(() => {
      setCopyLabel('Copy link')
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [copyLabel])

  useEffect(() => {
    if (printLabel === 'Print') return undefined
    const timer = window.setTimeout(() => {
      setPrintLabel('Print')
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [printLabel])

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
    setPrintLabel('Print ready')
    window.requestAnimationFrame(() => window.print())
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
              {printLabel}
            </button>
          </div>

          <p className="mt-4 text-xs text-gray-400">
            The QR code, copy button, and printed card all use the exact same WhatsApp link.
          </p>
        </div>
      </div>
      <div
        id="dr-adekunle-qr-print"
        data-testid="qr-print-card"
        aria-hidden="true"
        className="hidden"
      >
        <div className="qr-print-card">
          <p className="qr-print-eyebrow">Serenity Royale Hospital</p>
          <h1>Dr. Adekunle&apos;s AI Chat</h1>
          <p className="qr-print-copy">
            Scan this QR code to start a WhatsApp chat with the hospital booking assistant.
          </p>
          <QRCodeSVG
            value={shareUrl}
            size={340}
            marginSize={3}
            level="H"
            bgColor="#ffffff"
            fgColor="#111827"
          />
          <p className="qr-print-link">{shareUrl}</p>
        </div>
      </div>
      <style>{`
        @media screen {
          #dr-adekunle-qr-print {
            display: none;
          }
        }

        @media print {
          body * {
            visibility: hidden !important;
          }

          #dr-adekunle-qr-print,
          #dr-adekunle-qr-print * {
            visibility: visible !important;
          }

          #dr-adekunle-qr-print {
            display: flex !important;
            position: fixed;
            inset: 0;
            align-items: center;
            justify-content: center;
            background: white;
            padding: 24mm;
            color: #111827;
          }

          #dr-adekunle-qr-print .qr-print-card {
            width: 148mm;
            min-height: 190mm;
            border: 1px solid #d1d5db;
            border-radius: 12px;
            padding: 18mm 14mm;
            text-align: center;
            font-family: Arial, sans-serif;
          }

          #dr-adekunle-qr-print .qr-print-eyebrow {
            margin: 0 0 8px;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #047857;
          }

          #dr-adekunle-qr-print h1 {
            margin: 0;
            font-size: 30px;
            line-height: 1.2;
          }

          #dr-adekunle-qr-print .qr-print-copy {
            margin: 12px auto 22px;
            max-width: 420px;
            font-size: 15px;
            line-height: 1.45;
            color: #374151;
          }

          #dr-adekunle-qr-print svg {
            width: 95mm;
            height: 95mm;
          }

          #dr-adekunle-qr-print .qr-print-link {
            margin: 22px auto 0;
            max-width: 440px;
            overflow-wrap: anywhere;
            font-size: 11px;
            line-height: 1.4;
            color: #374151;
          }
        }
      `}</style>
    </section>
  )
}
