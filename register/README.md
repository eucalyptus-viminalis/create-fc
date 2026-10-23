# register

The Network Decentralization Authority's register: where the microsite's membership form (NDA Form 1) is sent. A Cloudflare Worker with a D1 database.

| Route | What it does |
| --- | --- |
| `POST /apply` | Records a filing and returns a new member number. Filings never change each other, even with the same FID or e-mail: nothing on the form proves who owns them. |
| `GET /m/:n` | A member's page, which is what a cast embed links to. Its preview image is the card. |
| `GET /m/:n/card.png` | The member card, 1200×630. Rendered once per version, then cached. |
| `GET`/`POST /confirm` | The link in a bulletin confirmation e-mail. Opening it shows a button; the button confirms. |
| `GET`/`POST /unsubscribe` | The link that stops bulletins, for the bulletins themselves. |

`POST /apply` takes JSON:

```json
{ "contact": "1234", "name": "@fameboyteal", "signature": "Ada Operator", "certify": { "sync": true, "cast": true }, "bulletins": false,
  "claim": { "node": "203.0.113.7", "payout": "0x97547ffbA3F3e5a7553aA36948F618f39647F2Ea" } }
```

`claim` is optional: Part IV, the $5 server reimbursement. `node` is the node's IP or host name (a pasted URL is trimmed to that), and `payout` is any EVM address. Both are needed to claim, and both stay in D1 like `contact`.

`contact` is an FID or an e-mail address. It is stored in D1 and never shown anywhere. Member pages and cards show only the name, number, enrolled date and signature.

## Bulletins

Ticking bulletins with an e-mail address only sends a confirmation e-mail. Bulletins go only to addresses whose owner pressed the button behind that link (`subscribers.status = 'confirmed'`), and only links sent to the address can change that. So nobody can unsubscribe someone else, or subscribe a stranger, by filing the form. An address gets at most one confirmation e-mail a day, and the register sends at most 200 a day in all. FID bulletins aren't set up yet.

The reply to `POST /apply` says what happened in `bulletins.state`: `sent`, `confirmed` or `unsent`. On localhost nothing is sent: the Worker logs the confirmation link and returns it as `bulletins.confirm`.

E-mail goes out through Cloudflare Email Sending, which needs Workers Paid (3,000 e-mails a month included, then $0.35 per 1,000). Once per account, in the Cloudflare dashboard: **Compute → Email Service → Email Sending → Onboard Domain**, and pick createfc.org. It adds the DNS records it needs. The sender is `MAIL_FROM` in `wrangler.toml`.

## Run it locally

```bash
pnpm install
pnpm db:init
pnpm dev
```

The Worker runs at http://localhost:8787 with a local database in `.wrangler/`. Pages allowed to send the form are listed in `ALLOWED_ORIGINS` in `wrangler.toml`.

```bash
pnpm test
```

## Deploy

Needs a Cloudflare account. Run these in your own terminal: the first one opens a browser to sign in.

```bash
pnpm wrangler login
pnpm wrangler d1 create nda-register
```

Put the `database_id` it prints into `wrangler.toml`, then:

```bash
pnpm db:init:remote
pnpm deploy
```

**A register made before filings stopped overwriting each other** (contact was unique, and there was no `subscribers` table) needs this once, before deploying the new code:

```bash
pnpm db:migrate:remote
```

It keeps every member and number. (`pnpm db:migrate` does the same to the local database.)

**A register made before Part IV** (no `node` and `payout` columns) needs this once, before deploying the new code:

```bash
pnpm db:migrate:002:remote
```

(`pnpm db:migrate:002` for the local database.)

**Plan:** drawing a card takes about 300 ms of CPU. The Workers Free plan allows 10 ms per request, so card images need **Workers Paid** ($5/month). Applying and member pages fit in the free plan.

## Who has applied

```bash
pnpm wrangler d1 execute nda-register --remote --command "SELECT id, name, kind, bulletins, created_at FROM members ORDER BY id"
```

Add `contact` to the columns to see FIDs and e-mail addresses.

## Reimbursement claims

The first five operators get $5 USDC for their server. To see every claim, oldest first:

```bash
pnpm claims:remote
```

Check each node is in sync (`curl http://<node>:3381/v1/info`, every shard's `blockDelay` in single digits), then pay its `payout` address.
