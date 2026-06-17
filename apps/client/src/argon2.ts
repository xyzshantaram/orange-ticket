import argon2 from 'argon2-browser/dist/argon2-bundled.min.js'
import { ARGON2_PARAMS } from '@orange-ticket/core'

export async function argon2Hash(opts: {
  pass: Uint8Array
  salt: string
}): Promise<Uint8Array> {
  const result = await argon2.hash({
    pass: opts.pass,
    salt: opts.salt,
    type: argon2.ArgonType.Argon2id,
    mem: ARGON2_PARAMS.memoryCost,
    time: ARGON2_PARAMS.timeCost,
    parallelism: ARGON2_PARAMS.parallelism,
    hashLen: ARGON2_PARAMS.hashLength,
  })
  return result.hash
}
