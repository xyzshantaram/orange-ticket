import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Address } from '../components/Address.js'

interface Voucher {
  address: string
  kx_b64: string
}

interface Batch {
  id: string
  created_at: number
  vouchers: Voucher[]
}

interface KaEntry {
  index: number
  word1: string
  word2: string
}

type OnChainStatus = 'loading' | 'unfunded' | 'funded' | 'swept'

async function fetchStatus(address: string): Promise<OnChainStatus> {
  try {
    const res = await fetch(`https://blockstream.info/api/address/${address}`)
    if (!res.ok) return 'unfunded'
    const data = await res.json()
    const funded = data.chain_stats.funded_txo_sum + data.mempool_stats.funded_txo_sum
    const spent = data.chain_stats.spent_txo_sum + data.mempool_stats.spent_txo_sum
    if (funded === 0) return 'unfunded'
    if (funded > spent) return 'funded'
    return 'swept'
  } catch {
    return 'unfunded'
  }
}

const STATUS_LABELS: Record<OnChainStatus, string> = {
  loading: '⋯',
  unfunded: 'Unfunded',
  funded: 'Funded ✓',
  swept: 'Swept',
}

export default function BatchPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const [batch, setBatch] = useState<Batch | null>(null)
  const [statuses, setStatuses] = useState<OnChainStatus[]>([])
  const [kaEntries, setKaEntries] = useState<KaEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!batchId) return
    fetch(`/api/batch/${batchId}`)
      .then((r) => r.json())
      .then((data: Batch) => {
        setBatch(data)
        setStatuses(data.vouchers.map(() => 'loading'))
        data.vouchers.forEach((v, i) => {
          fetchStatus(v.address).then((s) =>
            setStatuses((prev) => {
              const next = [...prev]
              next[i] = s
              return next
            })
          )
        })
      })
      .catch(() => setError('Batch not found.'))

    // Load K_a from localStorage
    try {
      const stored = JSON.parse(localStorage.getItem('orange-ticket-batches') ?? '{}')
      if (stored[batchId]) setKaEntries(stored[batchId] as KaEntry[])
    } catch {}
  }, [batchId])

  if (error) return <div className="page"><p className="error">{error}</p></div>
  if (!batch) return <div className="page"><p>Loading…</p></div>

  const created = new Date(batch.created_at).toLocaleString()

  return (
    <div className="page">
      <h1>Batch</h1>
      <p className="meta">Created: {created}</p>
      {kaEntries.length > 0 && (
        <p className="notice">
          Passphrases are stored on this device only. Note them down before closing this
          tab or clearing browser storage.
        </p>
      )}
      <table className="voucher-table">
        <thead>
          <tr>
            <th>#</th>
            {kaEntries.length > 0 && <th>Passphrase</th>}
            <th>Address</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {batch.vouchers.map((v, i) => {
            const ka = kaEntries.find((e) => e.index === i + 1)
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                {kaEntries.length > 0 && (
                  <td className="passphrase">
                    {ka ? `${ka.word1} ${ka.word2}` : '—'}
                  </td>
                )}
                <td>
                  <Address address={v.address} />
                </td>
                <td className={`status status-${statuses[i]}`}>
                  {STATUS_LABELS[statuses[i] ?? 'loading']}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <a
        className="btn-primary"
        href={`/api/batch/${batchId}/pdf`}
        target="_blank"
        rel="noreferrer"
      >
        Download PDF
      </a>
    </div>
  )
}
