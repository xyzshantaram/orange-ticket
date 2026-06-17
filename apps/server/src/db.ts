import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const DATA_DIR = process.env.DATA_DIR ?? '.'
const db = new DatabaseSync(join(DATA_DIR, 'orange-ticket.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    vouchers TEXT NOT NULL
  )
`)

export interface Voucher {
  address: string
  kx_b64: string
}

export function insertBatch(id: string, vouchers: Voucher[]): void {
  const stmt = db.prepare(
    'INSERT INTO batches (id, created_at, vouchers) VALUES (?, ?, ?)'
  )
  stmt.run(id, Date.now(), JSON.stringify(vouchers))
}

export function getBatch(
  id: string
): { id: string; created_at: number; vouchers: Voucher[] } | undefined {
  const stmt = db.prepare('SELECT * FROM batches WHERE id = ?')
  const row = stmt.get(id) as
    | { id: string; created_at: number; vouchers: string }
    | undefined
  if (!row) return undefined
  return { ...row, vouchers: JSON.parse(row.vouchers) as Voucher[] }
}
