import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'
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

// QR: 39x39mm
const QR_SIZE = Math.round(39 * MM)

// Address text beneath QR — two lines
const ADDR_TEXT_H = Math.round(4 * MM) * 2
const ADDR_FONT_SIZE = Math.round(2.5 * MM)
const ADDR_GAP = Math.round(3 * MM)
const ADDR_LINE_H = Math.round(4 * MM)

// Barcode: 65x18mm centered horizontally, with text beneath
const BAR_W = Math.round(65 * MM)
const BAR_H = Math.round(18 * MM)
const TEXT_H = Math.round(5 * MM)
const FONT_SIZE = Math.round(3.5 * MM)

// Index label
const LABEL_FONT_SIZE = Math.round(3 * MM)
const LABEL_MARGIN = Math.round(2 * MM)

// Notch radius for ticket perforation effect
const NOTCH_R = Math.round(3 * MM)

function drawTicketCell(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, index: number) {
  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x, y, w, h)

  // Black border
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = Math.round(0.5 * MM)
  ctx.strokeRect(x, y, w, h)

  // Notches on left and right edges at mid-height
  const notchY = y + Math.round(h / 2)
  ctx.fillStyle = '#ffffff' // matches page background
  ctx.beginPath()
  ctx.arc(x, notchY, NOTCH_R, -Math.PI / 2, Math.PI / 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x + w, notchY, NOTCH_R, Math.PI / 2, -Math.PI / 2)
  ctx.fill()

  // Dashed perforation line
  ctx.strokeStyle = '#aaaaaa'
  ctx.lineWidth = Math.round(0.3 * MM)
  ctx.setLineDash([Math.round(2 * MM), Math.round(1.5 * MM)])
  ctx.beginPath()
  ctx.moveTo(x + NOTCH_R, notchY)
  ctx.lineTo(x + w - NOTCH_R, notchY)
  ctx.stroke()
  ctx.setLineDash([])

  // Index — small, grey, bottom right
  ctx.fillStyle = '#bbbbbb'
  ctx.font = `${LABEL_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(String(index), x + w - LABEL_MARGIN, y + h - LABEL_MARGIN)
}

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

    drawTicketCell(ctx, x, y, CELL_W, CELL_H, i + 1)

    // Bitcoin ₿ logo — top left corner
    const LOGO_SIZE = Math.round(12 * MM)
    const LOGO_MARGIN = Math.round(2.5 * MM)
    const LOGO_NUDGE = Math.round(2 * MM)
    ctx.fillStyle = '#aaaaaa'
    ctx.font = `bold ${LOGO_SIZE}px sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('₿', x + LOGO_MARGIN, y + LOGO_MARGIN + LOGO_NUDGE)

    // QR + address — centered in the full cell
    const qrDataUrl = await QRCode.toDataURL(vouchers[i].address, {
      width: QR_SIZE,
      margin: 0,
      errorCorrectionLevel: 'M',
    })
    const img = await loadImage(qrDataUrl)
    // Center the QR in the cell, address text hangs below
    const qrX = x + Math.round((CELL_W - QR_SIZE) / 2)
    const qrY = y + Math.round((CELL_H - QR_SIZE) / 2) - Math.round(ADDR_TEXT_H / 2)
    ctx.drawImage(img, qrX, qrY, QR_SIZE, QR_SIZE)

    // Address text beneath QR — split in half across two lines
    const addr = vouchers[i].address
    const mid = Math.ceil(addr.length / 2)
    const line1 = addr.slice(0, mid)
    const line2 = addr.slice(mid)
    ctx.fillStyle = '#333333'
    ctx.font = `${ADDR_FONT_SIZE}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const textX = x + CELL_W / 2
    const textY = qrY + QR_SIZE + ADDR_GAP
    ctx.fillText(line1, textX, textY)
    ctx.fillText(line2, textX, textY + ADDR_LINE_H)
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

    // Barcode PNG via bwip-js — PDF417
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: 'pdf417',
      text: vouchers[i].kx_b64,
      scale: 3,
      height: Math.round(BAR_H / MM),
      includetext: false,
      backgroundcolor: 'ffffff',
    })

    const barcodeDataUrl = `data:image/png;base64,${barcodeBuffer.toString('base64')}`
    const barcodeImg = await loadImage(barcodeDataUrl)

    const GAP = Math.round(3 * MM)
    const contentH = BAR_H + GAP + TEXT_H
    const barX = x + Math.round((CELL_W - BAR_W) / 2)
    const barY = y + Math.round((CELL_H - contentH) / 2)

    ctx.drawImage(barcodeImg, barX, barY, BAR_W, BAR_H)

    // Bracket rules — hug the barcode horizontally, caps extend vertically beyond barcode
    const H_PAD = Math.round(4 * MM)
    const V_PAD = Math.round(3 * MM)
    const ruleX1 = barX - H_PAD
    const ruleX2 = barX + BAR_W + H_PAD
    const ruleTop = barY - V_PAD
    const ruleBot = barY + BAR_H + V_PAD
    const capLen = Math.round(5 * MM) // inward cap length
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = Math.round(1.8 * MM)
    ctx.lineJoin = 'miter'
    ctx.setLineDash([])
    ctx.beginPath()
    // Left bracket
    ctx.moveTo(ruleX1 + capLen, ruleTop)
    ctx.lineTo(ruleX1, ruleTop)
    ctx.lineTo(ruleX1, ruleBot)
    ctx.lineTo(ruleX1 + capLen, ruleBot)
    // Right bracket
    ctx.moveTo(ruleX2 - capLen, ruleTop)
    ctx.lineTo(ruleX2, ruleTop)
    ctx.lineTo(ruleX2, ruleBot)
    ctx.lineTo(ruleX2 - capLen, ruleBot)
    ctx.stroke()

    // Cut guide border
    ctx.strokeStyle = '#cccccc'
    ctx.lineWidth = 1
    ctx.strokeRect(x, y, CELL_W, CELL_H)

    // base64url text beneath barcode
    ctx.fillStyle = '#000000'
    ctx.font = `${FONT_SIZE}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(
      vouchers[i].kx_b64,
      x + CELL_W / 2,
      barY + BAR_H + GAP
    )

    // Index label — bottom right
    ctx.fillStyle = '#bbbbbb'
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

export interface CardBackRow {
  index: number
  word1?: string
  word2?: string
  amount?: string  // free-form, e.g. "1000 sats" or "$1"
  notes?: string
}

export async function generateCardBackPdf(rows: CardBackRow[]): Promise<Uint8Array> {
  const canvas = createCanvas(A4_W, A4_H)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, A4_W, A4_H)

  const URL_STR = 'orange-ticket.containers.shantaram.xyz'

  const PAD = Math.round(4 * MM)
  const LINE_H = Math.round(5.5 * MM)
  const LABEL_FS = Math.round(2.8 * MM)
  const VALUE_FS = Math.round(4 * MM)
  const SMALL_FS = Math.round(2.5 * MM)

  for (let i = 0; i < 10; i++) {
    const row = rows.find(r => r.index === i + 1)
    const { x, y } = cellOrigin(i)

    // Cut guide
    ctx.strokeStyle = '#cccccc'
    ctx.lineWidth = 1
    ctx.strokeRect(x, y, CELL_W, CELL_H)

    // Index — bottom right
    ctx.fillStyle = '#bbbbbb'
    ctx.font = `${LABEL_FONT_SIZE}px sans-serif`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(String(i + 1), x + CELL_W - LABEL_MARGIN, y + CELL_H - LABEL_MARGIN)

    // URL — bottom left, small
    ctx.fillStyle = '#bbbbbb'
    ctx.font = `${SMALL_FS}px monospace`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(URL_STR, x + PAD, y + CELL_H - LABEL_MARGIN)

    // Content rows
    let curY = y + PAD
    ctx.textBaseline = 'top'

    // Passphrase
    ctx.fillStyle = '#888888'
    ctx.font = `${LABEL_FS}px sans-serif`
    ctx.textAlign = 'left'
    ctx.fillText('Secret phrase', x + PAD, curY)
    curY += Math.round(3.5 * MM)

    const phrase = row?.word1 && row?.word2
      ? `${row.word1}  ${row.word2}`
      : '____________  ____________'
    ctx.fillStyle = '#000000'
    ctx.font = `bold ${VALUE_FS}px monospace`
    ctx.fillText(phrase, x + PAD, curY)
    curY += LINE_H + Math.round(2 * MM)

    // Amount
    ctx.fillStyle = '#888888'
    ctx.font = `${LABEL_FS}px sans-serif`
    ctx.fillText('Amount', x + PAD, curY)
    curY += Math.round(3.5 * MM)

    ctx.fillStyle = '#000000'
    ctx.font = `bold ${VALUE_FS}px monospace`
    ctx.fillText(row?.amount ?? '___________', x + PAD, curY)
    curY += LINE_H + Math.round(2 * MM)

    // Notes
    ctx.fillStyle = '#888888'
    ctx.font = `${LABEL_FS}px sans-serif`
    ctx.fillText('Note', x + PAD, curY)
    curY += Math.round(3.5 * MM)

    ctx.fillStyle = '#000000'
    ctx.font = `${VALUE_FS}px sans-serif`
    ctx.fillText(row?.notes ?? '', x + PAD, curY)
  }

  const png = canvas.toBuffer('image/png')
  const pdf = await PDFDocument.create()
  const pngImage = await pdf.embedPng(png)
  const page = pdf.addPage([pngImage.width, pngImage.height])
  page.drawImage(pngImage, { x: 0, y: 0, width: pngImage.width, height: pngImage.height })
  return pdf.save()
}
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
