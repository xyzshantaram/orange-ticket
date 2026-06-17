declare module 'argon2-browser/dist/argon2-bundled.min.js' {
  export enum ArgonType {
    Argon2d = 0,
    Argon2i = 1,
    Argon2id = 2,
  }

  export interface HashResult {
    hash: Uint8Array
    hashHex: string
    encoded: string
  }

  export function hash(opts: {
    pass: Uint8Array | string
    salt: Uint8Array | string
    type?: ArgonType
    mem?: number
    time?: number
    parallelism?: number
    hashLen?: number
  }): Promise<HashResult>

  const argon2: {
    ArgonType: typeof ArgonType
    hash: typeof hash
  }
  export default argon2
}
