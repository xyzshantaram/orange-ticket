# Orange Ticket — Cryptographic Specification

---

## Abstract

This document defines a scheme for creating self-contained physical Bitcoin vouchers
intended for small gifted amounts. It is not suitable for cold storage or significant
holdings. The private key is never known to any single party during issuance. A random
issuer secret (`K_x`) and a user-chosen passphrase (`K_a`) are combined using Argon2id
to derive a BIP32 HD wallet seed. Neither secret alone is sufficient to reconstruct the
private key. The issuer prints `K_x` on the voucher; the sender writes `K_a` on the
voucher. Any party holding both halves can sweep the funds.

---

## Motivation

Paper wallets and hardware wallet seeds require the issuer or creator to know the private
key at generation time, making them unsuitable when the issuer is a third-party print
service. Existing schemes such as BIP38 encrypt a private key with a passphrase but still
require the issuer to generate and briefly hold the raw private key.

This scheme ensures:

- The issuer generates `K_x` and derives the Bitcoin address client-side. The issuer's
  server receives only the address and `K_x` (for printing). The issuer never sees `K_a`.
- The sender (A) chooses `K_a` and writes it on the card. The sender never transmits
  `K_a` to the issuer.
- Neither the issuer alone (knows `K_x`, not `K_a`) nor the sender alone (knows `K_a`,
  not `K_x` after handing over the card) can sweep the funds.
- The recipient (B) receives both halves and can recover the private key using any
  compliant implementation.

---

## Specification

### Terminology

| Term | Description |
|------|-------------|
| `K_x` | Issuer random secret. 128 bits of cryptographically random data. |
| `K_a` | Sender passphrase. A UTF-8 string chosen by the sender. |
| `seed` | 64-byte BIP32 root seed derived from `K_x` and `K_a`. |
| Issuer | Third-party who prints the voucher. Knows `K_x`, never sees `K_a`. |
| Sender (A) | Funds the voucher. Chooses `K_a`, writes it on the card, hands card to recipient. |
| Recipient (B) | Receives the card. Learns both `K_x` and `K_a` to claim funds. |

### Key Generation (Issuer, client-side)

1. Generate `K_x`: 16 bytes (128 bits) from a cryptographically secure random number
   generator (CSPRNG).
2. Encode `K_x` as base64url (RFC 4648 §5, no padding): 22 characters.
3. Transmit `K_x` (base64url) and the derived address (see below) to the print server.
   `K_a` is never transmitted.

### Seed Derivation

Given `K_x` (raw 16 bytes) and `K_a` (implementation-defined passphrase string, encoded as UTF-8):

```
seed = Argon2id(
    password = K_x,     // 16 bytes, raw (not base64)
    salt     = K_a,     // UTF-8 encoded passphrase bytes
    m        = 65536,   // 64 MiB memory
    t        = 3,       // 3 iterations
    p        = 4,       // 4 parallel lanes
    tag_len  = 64       // 64-byte output
)
```

The resulting 64-byte `seed` is used directly as a BIP32 root seed (as in BIP39 step 2,
bypassing the mnemonic and PBKDF2 steps).

**Rationale for parameter roles:** `K_x` is used as the password (the value being
stretched) because it has fixed, high entropy. `K_a` is used as the salt because Argon2id
requires the salt to be available at derivation time and the salt role is well-suited to
a value that is human-memorable but of variable entropy. This assignment also means that
an attacker who knows `K_x` (e.g. the issuer) but not `K_a` must pay the full Argon2id
cost per guess of `K_a`, which is the intended threat model.

### Derivation Path

```
m / 71737084' / 0' / 0 / 0
```

- `71737084` is the ASCII encoding of `GIFT`, used as a namespace to avoid collision
  with other BIP32 uses of the same seed.
- `0'` is the account index, reserved for future multi-account use.
- `0 / 0` is the standard external chain / first address index.

The receiving address at this path uses P2TR (Taproot, bech32m, key-path spend, no script
tree). Only a single address is used per voucher.

The x-only public key passed to P2TR is derived by dropping the 33-byte compressed public
key's prefix byte (the BIP32 `publicKey` field, strip the first byte).

### Address Encoding

The Bitcoin address is encoded as a bech32m address (BIP350) and printed on the front of
the voucher as a QR code.

### Physical Card Format

This specification covers the cryptographic scheme only. Physical card layouts are
implementation-defined. The following is a non-normative reference design:

- **Outside front**: Bitcoin address as a QR code.
- **Outside back**: Space for the sender to hand-write `K_a`.
- **Inside** (sealed, e.g. folded and glued or under a scratch-off panel): `K_x` encoded
  as a Code128 barcode, with the base64url string printed in small text beneath it as a
  transcription fallback.

Using a barcode (rather than a QR code) for `K_x` is strongly recommended to prevent
confusion with standard BIP39 mnemonics or Bitcoin addresses, which are conventionally
encoded as QR codes.

### Recovery

To claim funds, the recipient:

1. Obtains `K_x` by scanning the barcode or manually entering the base64url string.
2. Decodes `K_x` from base64url to raw bytes.
3. Obtains `K_a` from the hand-written passphrase on the card.
4. Runs Argon2id with the parameters above to derive `seed`.
5. Derives the BIP32 root from `seed`.
6. Derives the private key at `m / 71737084' / 0' / 0 / 0`.
7. Sweeps funds to a wallet the recipient controls.

---

## Security Considerations

### Intended use

This scheme is designed for small gifted amounts — think physical gift cards. It is
**not** suitable for cold storage or significant holdings. Recipients should sweep funds
immediately to a wallet they control. The physical card should be treated as bearer
cash: whoever holds both halves owns the funds.

### Threat: Issuer brute-forces K_a

The issuer knows `K_x` and can attempt offline dictionary attacks against `K_a`. The
Argon2id parameters (m=65536, t=3, p=4) are chosen to make each attempt cost
approximately 64 MiB of memory and ~1 second on commodity hardware, limiting an attacker
to roughly 1–3 attempts per second per GPU.

`K_a` MUST have a minimum of 25 bits of entropy. Two randomly chosen words from a large
dictionary (~7000+ words) satisfies this requirement (~25.8 bits). A single common word,
a name, or a short numeric PIN does not. At 25 bits of entropy, an attacker is expected
to require ~1 year of sustained computation per GPU to crack `K_a`.

Implementations MUST estimate passphrase entropy and MUST reject passphrases below 25
bits with a clear error. Implementations MUST NOT suggest that users choose passphrases
related to the recipient (e.g. their name or birthday), as these can be guessed without
exhaustive search.

### Threat: Physical interception of K_x

If the card is opened before delivery, the attacker learns `K_x` but not `K_a`. They are
in the same position as the issuer. See above.

### Threat: K_a observation

If `K_a` is written visibly or is guessable from context, an observer who also sees `K_x`
can sweep the funds. Senders SHOULD choose a passphrase unknown to the recipient.

### Threat: Double-spend / card reuse

Once the recipient claims the funds, the private key can be derived by anyone holding
both halves. Implementations SHOULD guide recipients to sweep immediately and SHOULD NOT
encourage long-term storage of funds on a voucher wallet.

### Passphrase encoding

`K_a` is passed to Argon2id as raw UTF-8 bytes. Implementations that accept non-ASCII
input SHOULD apply NFC normalization before encoding to ensure consistent derivation
across platforms.

### K_x minimum entropy

`K_x` MUST be generated by a CSPRNG. Implementations MUST NOT allow user-supplied `K_x`.
A length of 16 bytes (128 bits) is mandatory; longer values provide no meaningful
additional security given the Argon2id memory hardness.

---

## Test Vectors

### Vector 1

```
K_x (hex):       deadbeefcafebabe0102030405060708
K_x (base64url): 3q2-78r-ur4BAgMEBQYHCA
K_a (UTF-8):     correct horse
```

Argon2id output (hex):
```
0f9d79ab99aa4433b50c17d7280420dc66d845f2681a1e50ceec496d0843e466
cfa5c1e1e5acb56d14d60f436132a4004e6fd8f3b43353712e501e67cf08151d
```

BIP32 root (xprv):
```
xprv9s21ZrQH143K3jiR5CVAm7pQjAMeCzksD7e1aak5wPmAE4BjojAtnbEit4cDbE9Ng7iCErXx9gV3DmcwXorBNUFoRMtKjDbZLAmxGKiMsx9
```

Address at m/71737084'/0'/0/0 (P2TR, mainnet):
```
bc1ptgz85c43z79jt8gay04ux3h4j2j6ktun30d4d7mdzerj0lna487src0g3n
```

---

## Reference Implementation

A reference implementation is provided in the accompanying application covering:

- Client-side key generation and address derivation (TypeScript/WASM)
- Argon2id seed derivation
- Sweep transaction construction
- Barcode generation for print layout

---

## Rationale

### Why not BIP38?

BIP38 encrypts an existing private key with a passphrase. The issuer must generate and
briefly hold the raw private key, violating the trust model this scheme targets.

### Why not standard BIP39 + passphrase?

BIP39 uses PBKDF2-HMAC-SHA512 with 2048 iterations. When the mnemonic (equivalent to
`K_x`) is known to the issuer, 2048 iterations provides insufficient brute-force
resistance against modern GPUs (~1–3M derivations/second). Argon2id with the parameters
above reduces this to ~1–3 derivations/second, a factor of ~10^6 improvement.

### Why Argon2id over scrypt?

Argon2id is the winner of the Password Hashing Competition (2015) and is recommended by
OWASP and NIST SP 800-63B. It provides better resistance to both GPU and side-channel
attacks than scrypt, and has wider library support.

### Why a barcode for K_x instead of a QR code or mnemonic words?

QR codes are strongly associated with Bitcoin addresses and BIP39 mnemonics. A user
scanning `K_x` as a QR and importing it into a standard wallet would derive a different
address (using standard BIP39 PBKDF2 derivation), fund the wrong address, and lose funds.
A Code128 barcode is visually distinct and unambiguously requires an app that understands
this scheme.

### Why base64url?

Base64url (no padding) gives a compact 22-character ASCII representation of 16 bytes,
suitable for both barcode encoding and manual transcription. Hex would require 32
characters; base64url is ~30% more compact.

---

## Copyright

This specification is licensed under the BSD 2-Clause License.
