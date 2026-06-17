# Orange Ticket

Physical Bitcoin vouchers where no single party knows the private key at issuance time.

A sender and recipient share a physical card. The issuer generates a random secret (`K_x`) and prints it as a barcode inside the card. The sender chooses a two-word passphrase (`K_a`) and writes it on the back. Neither half alone can derive the private key — only the recipient holding both can claim the funds.

See [SPEC.md](./SPEC.md) for the full cryptographic specification.

## How it works

1. **Create** — sender generates a batch of vouchers in the browser. Argon2id combines `K_x` + `K_a` to derive a Taproot address. Only the address and `K_x` are sent to the server; `K_a` never leaves the browser.
2. **Print** — download a PDF: one sheet of QR codes (addresses, for funding), one sheet of barcodes (`K_x` values, for the inside of the card).
3. **Fund** — sender sends Bitcoin to each address and writes the two-word passphrase on the back of the matching card.
4. **Claim** — recipient scans the barcode, enters the two words, and sweeps the funds to their own wallet. Entirely client-side.

## Repository structure

```
packages/core        # Framework-agnostic crypto library (K_x gen, Argon2id, BIP32, P2TR)
apps/server          # Express 5 API + PDF generation + static file serving
apps/client          # Vite + React SPA (create, batch status, claim flows)
```

## Development

Requires Node 24 and pnpm.

```sh
pnpm install
pnpm start        # builds everything, then starts the server at http://localhost:3000
```

## Deployment

The app is packaged as a Docker image. SQLite data lives at `/data` — mount a persistent volume there.

```sh
docker build -t orange-ticket .
docker run -p 3000:3000 -v /your/data:/data orange-ticket
```

For Dokku:

```sh
dokku apps:create orange-ticket
dokku storage:mount orange-ticket /var/lib/dokku/data/storage/orange-ticket:/data
git push dokku main
```

## License

MIT — see [LICENSE](./LICENSE).
