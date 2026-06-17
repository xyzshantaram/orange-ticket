import { useState, useRef, useEffect } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { decodeKx, validateKaWord, buildKa, deriveFromSeed } from '@orange-ticket/core'
import { argon2Hash } from '../argon2.js'
import { p2tr, Transaction } from '@scure/btc-signer'
import { hex } from '@scure/base'

type Step = 'scan-kx' | 'enter-ka' | 'sweep' | 'done'

interface UTXO {
  txid: string
  vout: number
  value: number
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
  const [utxos, setUtxos] = useState<UTXO[]>([])
  const [deriving, setDeriving] = useState(false)
  const [destination, setDestination] = useState('')
  const [sweeping, setSweeping] = useState(false)
  const [txid, setTxid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

      // Fetch balance
      const res = await fetch(`https://blockstream.info/api/address/${derived}`)
      const data = await res.json()
      const funded: number = data.chain_stats.funded_txo_sum + data.mempool_stats.funded_txo_sum
      const spent: number = data.chain_stats.spent_txo_sum + data.mempool_stats.spent_txo_sum
      const bal = funded - spent
      setBalance(bal)

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
    setSweeping(true)
    setError(null)
    try {
      // Fetch fee estimate (sat/vbyte)
      const feeRes = await fetch('https://blockstream.info/api/fee-estimates')
      const fees = await feeRes.json() as Record<string, number>
      const feeRate = Math.ceil(fees['1'] ?? 5)

      const totalIn = utxos.reduce((s, u) => s + u.value, 0)
      // Estimate vbytes: 10.5 overhead + 57.5 per P2TR key-path input + 43 P2TR output (worst case)
      const estimatedSize = Math.ceil(10.5 + utxos.length * 57.5 + 43)
      const fee = feeRate * estimatedSize
      const amountOut = totalIn - fee

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

  return (
    <div className="page">
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
                <strong>{balance} sats</strong>
              )}
            </p>
          )}
          {balance !== null && balance > 0 && (
            <>
              <ScanOrTypeAddress value={destination} onChange={setDestination} />
              {error && <p className="error">{error}</p>}
              <button
                className="btn-primary"
                disabled={!destination || sweeping}
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
    // Reset so the same file can be re-selected
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
    <div className="step">
      <h2>Scan K_x Barcode</h2>
      <p>Open the card and scan the barcode inside.</p>
      <video
        ref={videoRef}
        style={{ display: scanning ? 'block' : 'none', width: '100%', maxWidth: 400 }}
      />
      <div className="scan-buttons">
        {!scanning
          ? <button className="btn-secondary" onClick={startCamera}>Open Camera</button>
          : <button className="btn-secondary" onClick={stopScan}>Stop Camera</button>
        }
        {!scanning && (
          <>
            <button className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
              Upload Image
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </>
        )}
      </div>
      {scanError && <p className="error">{scanError}</p>}
      <p>Or type the base64url string below:</p>
      <input
        placeholder="3q2-78r-ur4BAgMEBQYHCA — or paste an image"
        value={kxB64}
        onChange={(e) => setKxB64(e.target.value.trim())}
        onPaste={handlePaste}
        className={kxB64 && !kxValid ? 'invalid' : ''}
      />
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
