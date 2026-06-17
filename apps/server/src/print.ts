import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import QRCode from 'qrcode'
import bwipjs from 'bwip-js'
import type { Voucher } from './db.js'

// All measurements in mm, converted to px at 300 DPI
const DPI = 300
const MM = DPI / 25.4 // px per mm

const A4_W = Math.round(210 * MM) // 2480px
const A4_H = Math.round(297 * MM) // 3508px

const CELL_W = Math.round(85 * MM)  // 1004px
const CELL_H = Math.round(54 * MM)  // 638px

const COLS = 2
const ROWS = 5

// Center the grid on the page
const GRID_W = COLS * CELL_W
const GRID_H = ROWS * CELL_H
const ORIGIN_X = Math.round((A4_W - GRID_W) / 2)
const ORIGIN_Y = Math.round((A4_H - GRID_H) / 2)

// QR: 44x44mm centered in cell
const QR_SIZE = Math.round(44 * MM)

// Barcode: up to 65mm wide, 18mm tall — rendered at natural width by bwip-js
const BAR_H = Math.round(18 * MM)
const TEXT_H = Math.round(5 * MM)
const FONT_SIZE = Math.round(3.5 * MM)

// Index label
const LABEL_FONT_SIZE = Math.round(3 * MM)
const LABEL_MARGIN = Math.round(2 * MM)

function cellOrigin(index: number): { x: number; y: number } {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  return {
    x: ORIGIN_X + col * CELL_W,
    y: ORIGIN_Y + row * CELL_H,
  }
}

async function renderQrSheet(vouchers: Voucher[]): Promise<Buffer> {
  const canvas = createCanvas(A4_W, A4_H)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, A4_W, A4_H)

  for (let i = 0; i < vouchers.length; i++) {
    const { x, y } = cellOrigin(i)

    // Draw cell border (cut guide)
    ctx.strokeStyle = '#cccccc'
    ctx.lineWidth = 1
    ctx.strokeRect(x, y, CELL_W, CELL_H)

    // QR code
    const qrDataUrl = await QRCode.toDataURL(vouchers[i].address, {
      width: QR_SIZE,
      margin: 0,
      errorCorrectionLevel: 'M',
    })
    const img = await loadImage(qrDataUrl)
    const qrX = x + Math.round((CELL_W - QR_SIZE) / 2)
    const qrY = y + Math.round((CELL_H - QR_SIZE) / 2)
    ctx.drawImage(img, qrX, qrY, QR_SIZE, QR_SIZE)

    // Index label — bottom right
    ctx.fillStyle = '#888888'
    ctx.font = `${LABEL_FONT_SIZE}px sans-serif`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(
      String(i + 1),
      x + CELL_W - LABEL_MARGIN,
      y + CELL_H - LABEL_MARGIN
    )
  }

  return canvas.toBuffer('image/png')
}

async function renderBarcodeSheet(vouchers: Voucher[]): Promise<Buffer> {
  const canvas = createCanvas(A4_W, A4_H)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, A4_W, A4_H)

  for (let i = 0; i < vouchers.length; i++) {
    const { x, y } = cellOrigin(i)

    // Draw cell border (cut guide)
    ctx.strokeStyle = '#cccccc'
    ctx.lineWidth = 1
    ctx.strokeRect(x, y, CELL_W, CELL_H)

    // Barcode PNG via bwip-js — render at natural width, fixed height
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: vouchers[i].kx_b64,
      scale: 3,
      height: Math.round(BAR_H / MM), // bwip-js height in mm
      includetext: false,
      backgroundcolor: 'ffffff',
    })

    const barcodeDataUrl = `data:image/png;base64,${barcodeBuffer.toString('base64')}`
    const barcodeImg = await loadImage(barcodeDataUrl)

    // Use natural barcode dimensions — do not stretch
    const natW = barcodeImg.width as number
    const natH = barcodeImg.height as number

    const contentH = natH + TEXT_H + Math.round(1 * MM)
    const barX = x + Math.round((CELL_W - natW) / 2)
    const barY = y + Math.round((CELL_H - contentH) / 2)

    ctx.drawImage(barcodeImg, barX, barY, natW, natH)

    // base64url text beneath barcode
    ctx.fillStyle = '#000000'
    ctx.font = `${FONT_SIZE}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(
      vouchers[i].kx_b64,
      x + CELL_W / 2,
      barY + natH + Math.round(1 * MM)
    )

    // Index label — bottom right
    ctx.fillStyle = '#888888'
    ctx.font = `${LABEL_FONT_SIZE}px sans-serif`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(
      String(i + 1),
      x + CELL_W - LABEL_MARGIN,
      y + CELL_H - LABEL_MARGIN
    )
  }

  return canvas.toBuffer('image/png')
}

// Helper: load a data URL into a canvas Image
async function loadImage(dataUrl: string): ReturnType<typeof import('@napi-rs/canvas').loadImage> {
  const { loadImage } = await import('@napi-rs/canvas')
  return loadImage(dataUrl)
}

export async function generatePdf(vouchers: Voucher[]): Promise<Uint8Array> {
  const [qrSheet, barcodeSheet] = await Promise.all([
    renderQrSheet(vouchers),
    renderBarcodeSheet(vouchers),
  ])

  const pdf = await PDFDocument.create()

  for (const pngBuffer of [qrSheet, barcodeSheet]) {
    const pngImage = await pdf.embedPng(pngBuffer)
    const page = pdf.addPage([pngImage.width, pngImage.height])
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pngImage.width,
      height: pngImage.height,
    })
  }

  return pdf.save()
}
