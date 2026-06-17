import { useState } from 'react'

interface AddressProps {
  address: string
}

export function Address({ address }: AddressProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <span className="address-widget">
      <span
        className="address address-copyable"
        title={copied ? 'Copied!' : 'Click to copy'}
        onClick={handleCopy}
      >
        {copied ? 'Copied!' : `${address.slice(0, 10)}…${address.slice(-6)}`}
      </span>
      <a
        href={`https://blockstream.info/address/${address}`}
        target="_blank"
        rel="noreferrer"
        className="address-explorer"
        title="View on Blockstream"
      >
        ↗
      </a>
    </span>
  )
}
