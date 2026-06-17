import { useState, useRef, useEffect } from 'react'
import { Camera, ImageUp, Square } from 'lucide-react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { decodeKx, validateKaWord, buildKa, deriveFromSeed } from '@orange-ticket/core'
import { argon2Hash } from '../argon2.js'
import { p2tr, Transaction } from '@scure/btc-signer'
import { hex } from '@scure/base'

type Step = 'scan-kx' | 'enter-ka' | 'sweep' | 'done'
type FeeTier = 'low' | 'medium' | 'custom'

interface UTXO {
  txid: string
  vout: number
  value: number
}

interface FeeEstimates {
  low: number     // lowest in mempool (~1+ hour)
  medium: number  // ~10 min (block target 6)
}

// Estimate vbytes for a P2TR key-path sweep tx
function estimateVbytes(inputCount: number): number {
  return Math.ceil(10.5 + inputCount * 57.5 + 43)
}

export default function ClaimPage() {
  const [step, setStep] = useState<Step>('scan-kx')
  const [kxB64, setKxB64] = useState('')
  const [word1, setWord1] = useState('')
  const [word2, setWord2] = useState('')
  const [address, setAddress] = useState('')
  const [privateKey, setPrivateKey] = useState<Uint8Array | null>(null)
  const [publicKey, setPublicKey] = useState<Uint8Array | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [btcPriceUsd, setBtcPriceUsd] = useState<number | null>(null)
  const [utxos, setUtxos] = useState<UTXO[]>([])
  const [deriving, setDeriving] = useState(false)
  const [destination, setDestination] = useState('')
  const [feeEstimates, setFeeEstimates] = useState<FeeEstimates | null>(null)
  const [feeTier, setFeeTier] = useState<FeeTier>('medium')
  const [customFeeRate, setCustomFeeRate] = useState('')
  const [sweeping, setSweeping] = useState(false)
  const [txid, setTxid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const word2Ref = useRef<HTMLInputElement>(null)

  // Derive the effective sat/vbyte from current tier selection
  function effectiveFeeRate(): number | null {
    if (!feeEstimates) return null
    if (feeTier === 'custom') {
      const v = parseFloat(customFeeRate)
      return isFinite(v) && v > 0 ? v : null
    }
    return feeEstimates[feeTier]
  }

  // Compute amountOut given a fee rate
  function computeAmountOut(rate: number): number {
    const totalIn = utxos.reduce((s, u) => s + u.value, 0)
    return totalIn - Math.ceil(rate * estimateVbytes(utxos.length))
  }

  async function handleDerive() {
    setDeriving(true)
    setError(null)
    try {
      const kxBytes = decodeKx(kxB64)
      const ka = buildKa(word1, word2)

      const seed = await argon2Hash({ pass: kxBytes, salt: ka })
      const { address: derived, privateKey: privKey, publicKey: pubKey } = deriveFromSeed(seed)
      setAddress(derived)
      setPrivateKey(privKey)
      setPublicKey(pubKey)

      // Fetch balance, fee estimates, and BTC price in parallel
      const [addrRes, feeRes, priceRes] = await Promise.all([
        fetch(`https://blockstream.info/api/address/${derived}`),
        fetch('https://blockstream.info/api/fee-estimates'),
        fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot'),
      ])

      const addrData = await addrRes.json()
      const funded: number = addrData.chain_stats.funded_txo_sum + addrData.mempool_stats.funded_txo_sum
      const spent: number = addrData.chain_stats.spent_txo_sum + addrData.mempool_stats.spent_txo_sum
      const bal = funded - spent
      setBalance(bal)

      const fees = await feeRes.json() as Record<string, number>
      setFeeEstimates({
        low:    Math.ceil(fees['144'] ?? fees['1'] ?? 1),
        medium: Math.ceil(fees['6']   ?? fees['1'] ?? 1),
      })

      const priceData = await priceRes.json() as { data?: { amount?: string } }
      const price = parseFloat(priceData.data?.amount ?? '')
      if (isFinite(price)) setBtcPriceUsd(price)

      if (bal > 0) {
        const utxoRes = await fetch(`https://blockstream.info/api/address/${derived}/utxo`)
        setUtxos(await utxoRes.json())
      }

      setStep('sweep')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeriving(false)
    }
  }

  async function handleSweep() {
    if (!privateKey || !publicKey || !utxos.length) return
    const rate = effectiveFeeRate()
    if (!rate) return
    setSweeping(true)
    setError(null)
    try {
      const amountOut = computeAmountOut(rate)
      if (amountOut <= 0) throw new Error('Balance too low to cover fees')

      const xOnlyPubKey = publicKey.slice(1)
      const p2trOut = p2tr(xOnlyPubKey)
      const script = p2trOut.script

      const tx = new Transaction()
      for (const u of utxos) {
        tx.addInput({
          txid: u.txid,
          index: u.vout,
          witnessUtxo: { script, amount: BigInt(u.value) },
          tapInternalKey: xOnlyPubKey,
        })
      }
      tx.addOutputAddress(destination, BigInt(amountOut))

      for (let i = 0; i < utxos.length; i++) {
        tx.signIdx(privateKey, i)
      }
      tx.finalize()

      const rawTx = hex.encode(tx.extract())

      const broadcastRes = await fetch('https://blockstream.info/api/tx', {
        method: 'POST',
        body: rawTx,
        headers: { 'Content-Type': 'text/plain' },
      })

      if (!broadcastRes.ok) {
        throw new Error(`Broadcast failed: ${await broadcastRes.text()}`)
      }

      setTxid(await broadcastRes.text())
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSweeping(false)
      privateKey.fill(0)
      setPrivateKey(null)
      setPublicKey(null)
    }
  }

  function formatUsd(sats: number): string | null {
    if (!btcPriceUsd) return null
    const usd = (sats / 1e8) * btcPriceUsd
    return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
  }

  const rate = effectiveFeeRate()
  const amountOut = rate && utxos.length ? computeAmountOut(rate) : null
  const feeSats = rate && utxos.length
    ? Math.ceil(rate * estimateVbytes(utxos.length))
    : null

  return (
    <div className="page page-centered-col">
      <h1>Claim Voucher</h1>

      {step === 'scan-kx' && (
        <ScanKxStep kxB64={kxB64} setKxB64={setKxB64} onNext={() => setStep('enter-ka')} />
      )}

      {step === 'enter-ka' && (
        <div className="step">
          <h2>Enter Passphrase</h2>
          <p>Enter the two words written on the back of the card.</p>
          <div className="word-inputs">
            <input
              placeholder="word 1"
              value={word1}
              onChange={(e) => setWord1(e.target.value.toLowerCase())}
              onKeyDown={(e) => {
                if (e.key === ' ') {
                  e.preventDefault()
                  word2Ref.current?.focus()
                }
              }}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text').trim().toLowerCase()
                const parts = text.split(/\s+/)
                if (parts.length === 2) {
                  e.preventDefault()
                  setWord1(parts[0])
                  setWord2(parts[1])
                }
              }}
            />
            <input
              ref={word2Ref}
              placeholder="word 2"
              value={word2}
              onChange={(e) => setWord2(e.target.value.toLowerCase())}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text').trim().toLowerCase()
                const parts = text.split(/\s+/)
                if (parts.length === 2) {
                  e.preventDefault()
                  setWord1(parts[0])
                  setWord2(parts[1])
                }
              }}
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button
            className="btn-primary"
            disabled={!validateKaWord(word1) || !validateKaWord(word2) || deriving}
            onClick={handleDerive}
          >
            {deriving ? 'Deriving (this takes a moment)…' : 'Derive Address'}
          </button>
        </div>
      )}

      {step === 'sweep' && (
        <div className="step">
          <h2>Sweep Funds</h2>
          <p>Address: <span className="address">{address}</span></p>
          {balance !== null && (
            <p>
              Balance:{' '}
              {balance === 0 ? (
                <span className="error">
                  No funds found — check your passphrase, or this voucher may already have been claimed.
                </span>
              ) : (
                <strong>
                  {balance.toLocaleString()} sats
                  {formatUsd(balance) && <span className="secondary"> ({formatUsd(balance)})</span>}
                </strong>
              )}
            </p>
          )}
          {balance !== null && balance > 0 && (
            <>
              <FeeSelector
                estimates={feeEstimates}
                tier={feeTier}
                onTier={setFeeTier}
                customRate={customFeeRate}
                onCustomRate={setCustomFeeRate}
                feeSats={feeSats}
                amountOut={amountOut}
                formatUsd={formatUsd}
              />
              <ScanOrTypeAddress value={destination} onChange={setDestination} />
              {error && <p className="error">{error}</p>}
              <button
                className="btn-primary"
                disabled={!destination || sweeping || !rate || (amountOut !== null && amountOut <= 0)}
                onClick={handleSweep}
              >
                {sweeping ? 'Broadcasting…' : 'Sweep to My Wallet'}
              </button>
            </>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className="step">
          <h2>Done!</h2>
          <p>Transaction broadcast successfully.</p>
          <a
            href={`https://blockstream.info/tx/${txid}`}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
          >
            View on Blockstream
          </a>
        </div>
      )}
    </div>
  )
}

function FeeSelector({
  estimates,
  tier,
  onTier,
  customRate,
  onCustomRate,
  feeSats,
  amountOut,
  formatUsd,
}: {
  estimates: FeeEstimates | null
  tier: FeeTier
  onTier: (t: FeeTier) => void
  customRate: string
  onCustomRate: (v: string) => void
  feeSats: number | null
  amountOut: number | null
  formatUsd: (sats: number) => string | null
}) {
  const tiers: { key: FeeTier; label: string; time: string; rate: number | null }[] = [
    { key: 'low',    label: 'Lowest fee',  time: '~1 hour',  rate: estimates?.low    ?? null },
    { key: 'medium', label: '~10 minutes', time: '~10 min',  rate: estimates?.medium ?? null },
    { key: 'custom', label: 'Custom',      time: '',         rate: null },
  ]

  return (
    <div className="fee-selector">
      <label className="fee-selector-label">Transaction fee</label>
      <div className="fee-tiers">
        {tiers.map(({ key, label, time, rate }) => (
          <label key={key} className={`fee-tier${tier === key ? ' selected' : ''}`}>
            <input
              type="radio"
              name="fee-tier"
              checked={tier === key}
              onChange={() => onTier(key)}
            />
            <span className="fee-tier-label">{label}</span>
            {key !== 'custom' && (
              <span className="fee-tier-rate">
                {rate !== null ? `${rate} sat/vbyte` : '…'}
              </span>
            )}
            {time && <span className="fee-tier-time">{time}</span>}
          </label>
        ))}
      </div>
      {tier === 'custom' && (
        <input
          type="number"
          min="1"
          step="0.1"
          placeholder="sat/vbyte"
          value={customRate}
          onChange={(e) => onCustomRate(e.target.value)}
          className="fee-custom-input"
        />
      )}
      {feeSats !== null && amountOut !== null && (
        <p className="fee-summary">
          Fee: <strong>{feeSats.toLocaleString()} sats</strong>
          {formatUsd(feeSats) && <span className="secondary"> ({formatUsd(feeSats)})</span>}
          {' · '}
          You receive: <strong>{amountOut > 0 ? amountOut.toLocaleString() : '—'} sats</strong>
          {amountOut > 0 && formatUsd(amountOut) && <span className="secondary"> ({formatUsd(amountOut)})</span>}
          {amountOut <= 0 && <span className="error"> (insufficient funds)</span>}
        </p>
      )}
    </div>
  )
}

function ScanKxStep({
  kxB64,
  setKxB64,
  onNext,
}: {
  kxB64: string
  setKxB64: (v: string) => void
  onNext: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)

  async function startCamera() {
    setScanning(true)
    setScanError(null)
    const reader = new BrowserMultiFormatReader()
    try {
      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result) => {
          if (result) {
            setKxB64(result.getText())
            stopScan()
          }
        }
      )
    } catch (e) {
      setScanError(String(e))
      setScanning(false)
    }
  }

  function stopScan() {
    controlsRef.current?.stop()
    controlsRef.current = null
    setScanning(false)
  }

  async function decodeImageBlob(blob: Blob) {
    setScanError(null)
    try {
      const imageBitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = imageBitmap.width
      canvas.height = imageBitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(imageBitmap, 0, 0)
      const reader = new BrowserMultiFormatReader()
      const result = await reader.decodeFromCanvas(canvas)
      setKxB64(result.getText())
    } catch {
      setScanError('Could not decode barcode from image. Try a clearer photo.')
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await decodeImageBlob(file)
    e.target.value = ''
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const imageItem = Array.from(e.clipboardData.items)
      .find((item) => item.type.startsWith('image/'))
    if (!imageItem) return
    e.preventDefault()
    const blob = imageItem.getAsFile()
    if (blob) await decodeImageBlob(blob)
  }

  useEffect(() => () => controlsRef.current?.stop(), [])

  let kxValid = false
  try { decodeKx(kxB64); kxValid = true } catch {}

  return (
    <div className="step scan-step">
      <h2>Open the card</h2>
      <p>Tear open the card and scan the secret inside, or take a photo of it.</p>
      <video
        ref={videoRef}
        style={{ display: scanning ? 'block' : 'none', width: '100%', maxWidth: 400 }}
      />
      <div className="scan-buttons">
        {!scanning ? (
          <>
            <button className="scan-btn" onClick={startCamera}>
              <Camera size={28} strokeWidth={1.5} />
              <span>Open Camera</span>
            </button>
            <button className="scan-btn" onClick={() => fileInputRef.current?.click()}>
              <ImageUp size={28} strokeWidth={1.5} />
              <span>Upload Image</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </>
        ) : (
          <button className="scan-btn scan-btn-stop" onClick={stopScan}>
            <Square size={28} strokeWidth={1.5} />
            <span>Stop Camera</span>
          </button>
        )}
      </div>
      {scanError && <p className="error">{scanError}</p>}
      <p>Or enter it manually:</p>
      <div className="input-with-action">
        <input
          placeholder="Can't scan? Type the code from inside the card"
          value={kxB64}
          onChange={(e) => setKxB64(e.target.value.trim())}
          onPaste={handlePaste}
          className={kxB64 && !kxValid ? 'invalid' : ''}
        />
        <button
          className="btn-secondary input-action-btn"
          onClick={async () => {
            try {
              const text = await navigator.clipboard.readText()
              setKxB64(text.trim())
            } catch {}
          }}
        >Paste</button>
      </div>
      <button className="btn-primary" disabled={!kxValid} onClick={onNext}>
        Next
      </button>
    </div>
  )
}

function ScanOrTypeAddress({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [scanning, setScanning] = useState(false)
  const controlsRef = useRef<IScannerControls | null>(null)

  async function startScan() {
    setScanning(true)
    const reader = new BrowserMultiFormatReader()
    controlsRef.current = await reader.decodeFromVideoDevice(
      undefined,
      videoRef.current!,
      (result) => {
        if (result) {
          onChange(result.getText())
          stopScan()
        }
      }
    )
  }

  function stopScan() {
    controlsRef.current?.stop()
    controlsRef.current = null
    setScanning(false)
  }

  useEffect(() => () => controlsRef.current?.stop(), [])

  return (
    <div className="scan-or-type">
      <label>Destination address:</label>
      <input
        placeholder="bc1p… or bc1q…"
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
      />
      <video
        ref={videoRef}
        style={{ display: scanning ? 'block' : 'none', width: '100%', maxWidth: 400 }}
      />
      {!scanning
        ? <button className="btn-secondary" onClick={startScan}>Scan QR Instead</button>
        : <button className="btn-secondary" onClick={stopScan}>Stop Camera</button>
      }
    </div>
  )
}
