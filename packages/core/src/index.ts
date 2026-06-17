import { base64url } from '@scure/base'
import { HDKey } from '@scure/bip32'
import { p2tr } from '@scure/btc-signer'

// Argon2id parameters per SPEC.md
export const ARGON2_PARAMS = {
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
  hashLength: 64,
} as const

// BIP32 derivation path: m/71737084'/0'/0/0 (GIFT namespace)
export const DERIVATION_PATH = [
  0x80000000 + 71737084,
  0x80000000 + 0,
  0,
  0,
] as const

export const KA_WORD_REGEX = /^[a-z0-9-]{3,}$/

/**
 * Generate a cryptographically random K_x (16 bytes).
 * Accepts an optional RNG for testing.
 */
export function generateKx(
  rng: (bytes: Uint8Array) => void = (b) => crypto.getRandomValues(b)
): Uint8Array {
  const bytes = new Uint8Array(16)
  rng(bytes)
  return bytes
}

/** Encode K_x bytes as base64url (no padding, 22 chars). */
export function encodeKx(kx: Uint8Array): string {
  return base64url.encode(kx).replace(/=+$/, '')
}

/** Decode base64url K_x string back to raw bytes. Throws if not 16 bytes. */
export function decodeKx(kxB64: string): Uint8Array {
  // Accept both padded and unpadded base64url
  const padded = kxB64.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (padded.length % 4)) % 4
  const bytes = base64url.decode(kxB64 + '='.repeat(padLen))
  if (bytes.length !== 16) {
    throw new Error(`K_x must decode to 16 bytes, got ${bytes.length}`)
  }
  return bytes
}

/** Validate a single K_a word: [a-z0-9-], min 3 chars. */
export function validateKaWord(word: string): boolean {
  return KA_WORD_REGEX.test(word)
}

/** Combine two K_a words into the passphrase string passed to Argon2id. */
export function buildKa(word1: string, word2: string): string {
  return `${word1} ${word2}`
}

/**
 * Derive a BIP32 seed from K_x and K_a using Argon2id.
 * This function is environment-agnostic: the caller supplies the argon2id
 * implementation to allow use in both browser (WASM) and Node (native).
 *
 * @param kx     Raw 16-byte K_x
 * @param ka     Passphrase string (e.g. "word1 word2")
 * @param argon2 Function: (password, salt, params) => Promise<Uint8Array>
 */
export async function deriveSeed(
  kx: Uint8Array,
  ka: string,
  argon2: (password: Uint8Array, salt: Uint8Array, params: typeof ARGON2_PARAMS) => Promise<Uint8Array>
): Promise<Uint8Array> {
  const salt = new TextEncoder().encode(ka)
  return argon2(kx, salt, ARGON2_PARAMS)
}

/**
 * Derive the P2TR address and private key from a 64-byte seed.
 * Path: m/71737084'/0'/0/0
 * Uses BIP86 key-path taproot (no script tree).
 */
export function deriveFromSeed(seed: Uint8Array): {
  address: string
  privateKey: Uint8Array
  publicKey: Uint8Array
} {
  const root = HDKey.fromMasterSeed(seed)
  let node = root
  for (const index of DERIVATION_PATH) {
    node = node.deriveChild(index)
  }

  if (!node.privateKey) throw new Error('Failed to derive private key')
  if (!node.publicKey) throw new Error('Failed to derive public key')

  // p2tr expects a 32-byte x-only public key (drop the 02/03 prefix byte)
  const xOnlyPubKey = node.publicKey.slice(1)
  const { address } = p2tr(xOnlyPubKey)
  if (!address) throw new Error('Failed to derive address')

  return { address, privateKey: node.privateKey, publicKey: node.publicKey }
}
