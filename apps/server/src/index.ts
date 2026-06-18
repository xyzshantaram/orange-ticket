import express from 'express'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { v4 as uuidv4 } from 'uuid'
import { decodeKx } from '@orange-ticket/core'
import { insertBatch, getBatch, type Voucher } from './db.js'
import { generatePdf, generateCardBackPdf } from './print.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLIENT_DIST = join(__dirname, '../../client/dist')
const CACHE_DIR = join(process.cwd(), '.ot-cache')
const CARD_BACK_CACHE = join(CACHE_DIR, 'card-back.pdf')

async function getCardBackPdf(): Promise<Buffer> {
  try {
    return await readFile(CARD_BACK_CACHE)
  } catch {
    // not cached yet — generate and save
    const pdf = await generateCardBackPdf()
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(CARD_BACK_CACHE, pdf)
    return Buffer.from(pdf)
  }
}

const app = express()
app.use(express.json())

// Serve Vite build — set correct MIME type for WASM
app.use(express.static(CLIENT_DIST, {
  setHeaders(res, path) {
    if (path.endsWith('.wasm')) {
      res.setHeader('Content-Type', 'application/wasm')
    }
  },
}))

// Validate a bech32m P2TR address (mainnet bc1p...)
function isValidP2trAddress(address: string): boolean {
  return /^bc1p[ac-hj-np-z02-9]{58}$/.test(address)
}

// Validate base64url K_x (22 chars, decodes to 16 bytes)
function isValidKxB64(kxB64: string): boolean {
  if (!/^[A-Za-z0-9_-]{22}$/.test(kxB64)) return false
  try {
    decodeKx(kxB64)
    return true
  } catch {
    return false
  }
}

app.post('/api/batch', (req, res) => {
  const { vouchers } = req.body as { vouchers: Voucher[] }

  if (!Array.isArray(vouchers) || vouchers.length === 0 || vouchers.length > 10) {
    res.status(400).json({ error: 'vouchers must be an array of 1–10 items' })
    return
  }

  for (const [i, v] of vouchers.entries()) {
    if (!isValidP2trAddress(v.address)) {
      res.status(400).json({ error: `voucher ${i}: invalid bech32m P2TR address` })
      return
    }
    if (!isValidKxB64(v.kx_b64)) {
      res.status(400).json({ error: `voucher ${i}: invalid kx_b64` })
      return
    }
  }

  const batchId = uuidv4()
  insertBatch(batchId, vouchers)
  res.json({ batchId })
})

app.get('/api/batch/:batchId', (req, res) => {
  const batch = getBatch(req.params.batchId)
  if (!batch) {
    res.status(404).json({ error: 'batch not found' })
    return
  }
  res.json(batch)
})

app.get('/api/batch/:batchId/pdf', async (req, res) => {
  const batch = getBatch(req.params.batchId)
  if (!batch) {
    res.status(404).json({ error: 'batch not found' })
    return
  }

  try {
    const pdf = await generatePdf(batch.vouchers)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `inline; filename="orange-ticket-${req.params.batchId}.pdf"`
    )
    res.send(Buffer.from(pdf))
  } catch (err) {
    console.error('PDF generation error:', err)
    res.status(500).json({ error: 'failed to generate PDF' })
  }
})

app.get('/api/card-back', async (_req, res) => {
  try {
    const pdf = await getCardBackPdf()
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="orange-ticket-card-back.pdf"')
    res.send(pdf)
  } catch (err) {
    console.error('Card back PDF error:', err)
    res.status(500).json({ error: 'failed to generate card back PDF' })
  }
})

// SPA fallback — must come after all API routes
app.get('/{*path}', (_req, res) => {
  res.sendFile(join(CLIENT_DIST, 'index.html'))
})

const PORT = process.env.PORT ?? 3000
app.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`)
})
