import argon2 from 'argon2-browser/dist/argon2-bundled.min.js'
import { deriveFromSeed, ARGON2_PARAMS } from '@orange-ticket/core'
import type { DeriveRequest, DeriveResponse } from './derive.worker.types.js'

self.onmessage = async (e: MessageEvent<DeriveRequest>) => {
  const { id, kxBytes, word1, word2 } = e.data
  try {
    const ka = `${word1} ${word2}`
    const kx = new Uint8Array(kxBytes)

    const result = await argon2.hash({
      pass: kx,
      salt: ka,
      type: argon2.ArgonType.Argon2id,
      mem: ARGON2_PARAMS.memoryCost,
      time: ARGON2_PARAMS.timeCost,
      parallelism: ARGON2_PARAMS.parallelism,
      hashLen: ARGON2_PARAMS.hashLength,
    })

    const { address } = deriveFromSeed(result.hash)
    self.postMessage({ id, address } satisfies DeriveResponse)
  } catch (err) {
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies DeriveResponse)
  }
}
