import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateKx, encodeKx, validateKaWord } from '@orange-ticket/core'
import { useDeriveWorker } from '../useDeriveWorker.js'
import { long as WORDLIST } from '@wordlist/english-eff/long'
import { Address } from '../components/Address.js'

interface VoucherRow {
  kxBytes: Uint8Array
  kxB64: string
  word1: string
  word2: string
  address: string | null
  deriving: boolean
  error: string | null
}

function randomWord(): string {
  return WORDLIST[Math.floor(Math.random() * WORDLIST.length)]
}

function initRow(): VoucherRow {
  const kxBytes = generateKx()
  return {
    kxBytes,
    kxB64: encodeKx(kxBytes),
    word1: randomWord(),
    word2: randomWord(),
    address: null,
    deriving: true,
    error: null,
  }
}

export default function CreatePage() {
  const navigate = useNavigate()
  const { derive } = useDeriveWorker()
  const [quantity, setQuantity] = useState<number | null>(null)
  const [rows, setRows] = useState<VoucherRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const debounceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const deriveRow = useCallback(
    async (index: number, row: VoucherRow) => {
      const response = await derive({
        id: `${index}-${row.kxB64}-${row.word1}-${row.word2}`,
        kxBytes: Array.from(row.kxBytes),
        word1: row.word1,
        word2: row.word2,
      })
      setRows((prev) => {
        const next = [...prev]
        if (!next[index]) return prev
        next[index] = {
          ...next[index],
          address: response.address ?? null,
          deriving: false,
          error: response.error ?? null,
        }
        return next
      })
    },
    [derive]
  )

  function handleQuantitySubmit(q: number) {
    const initial = Array.from({ length: q }, () => initRow())
    setRows(initial)
    setQuantity(q)
    initial.forEach((row, i) => deriveRow(i, row))
  }

  function handleWordChange(index: number, field: 'word1' | 'word2', value: string) {
    setRows((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value, deriving: true, address: null, error: null }
      return next
    })

    const existing = debounceTimers.current.get(index)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      setRows((prev) => {
        const row = prev[index]
        if (!row) return prev
        if (validateKaWord(row.word1) && validateKaWord(row.word2)) {
          deriveRow(index, row)
        }
        return prev
      })
    }, 500)
    debounceTimers.current.set(index, timer)
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const vouchers = rows.map((r) => ({ address: r.address!, kx_b64: r.kxB64 }))
      const res = await fetch('/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vouchers }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error)
      }
      const { batchId } = await res.json()

      // Store K_a values in localStorage
      const kaMap = rows.map((r, i) => ({ index: i + 1, word1: r.word1, word2: r.word2 }))
      const existing = JSON.parse(localStorage.getItem('orange-ticket-batches') ?? '{}')
      existing[batchId] = kaMap
      localStorage.setItem('orange-ticket-batches', JSON.stringify(existing))

      navigate(`/batch/${batchId}`)
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const allValid = rows.length > 0 &&
    rows.every((r) => !r.deriving && r.address && validateKaWord(r.word1) && validateKaWord(r.word2))

  if (quantity === null) {
    return <QuantityPicker onSubmit={handleQuantitySubmit} />
  }

  return (
    <div className="page">
      <h1>Create Vouchers</h1>
      <p className="notice">
        Passphrases are generated randomly. You can change them. Each card's passphrase
        will be stored on this device only — write them on the cards after printing.
      </p>
      <p className="security-notice">
        Only addresses and K_x values are sent to the server. Passphrases are never transmitted.
      </p>
      <table className="voucher-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Word 1</th>
            <th>Word 2</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <VoucherRowComponent
              key={i}
              index={i}
              row={row}
              onChange={handleWordChange}
            />
          ))}
        </tbody>
      </table>
      <button
        className="btn-primary"
        disabled={!allValid || submitting}
        onClick={handleSubmit}
      >
        {submitting ? 'Creating…' : 'Create Batch'}
      </button>
    </div>
  )
}

function QuantityPicker({ onSubmit }: { onSubmit: (q: number) => void }) {
  const [value, setValue] = useState(1)
  return (
    <div className="page centered">
      <h1>Create Vouchers</h1>
      <label>
        How many vouchers?
        <input
          type="number"
          min={1}
          max={10}
          value={value}
          onChange={(e) => setValue(Math.min(10, Math.max(1, Number(e.target.value))))}
        />
      </label>
      <button className="btn-primary" onClick={() => onSubmit(value)}>
        Generate
      </button>
    </div>
  )
}

function VoucherRowComponent({
  index,
  row,
  onChange,
}: {
  index: number
  row: VoucherRow
  onChange: (i: number, field: 'word1' | 'word2', value: string) => void
}) {
  const word1Valid = validateKaWord(row.word1)
  const word2Valid = validateKaWord(row.word2)

  return (
    <tr>
      <td>{index + 1}</td>
      <td>
        <input
          className={word1Valid ? '' : 'invalid'}
          value={row.word1}
          onChange={(e) => onChange(index, 'word1', e.target.value.toLowerCase())}
        />
      </td>
      <td>
        <input
          className={word2Valid ? '' : 'invalid'}
          value={row.word2}
          onChange={(e) => onChange(index, 'word2', e.target.value.toLowerCase())}
        />
      </td>
      <td className="address-cell">
        {row.deriving && <span className="spinner">Deriving…</span>}
        {!row.deriving && row.error && <span className="error">{row.error}</span>}
        {!row.deriving && row.address && <Address address={row.address} />}
      </td>
    </tr>
  )
}
