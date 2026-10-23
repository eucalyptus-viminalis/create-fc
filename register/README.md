# register

The Network Decentralization Authority's register: where the microsite's membership form (NDA Form 1) is sent. A Cloudflare Worker with a D1 database.

| Route | What it does |
| --- | --- |
| `POST /apply` | Records an application and returns the member number. The same FID or e-mail applying again keeps its number and updates the card. |
| `GET /m/:n` | A member's page, which is what a cast embed links to. Its preview image is the card. |
| `GET /m/:n/card.png` | The member card, 1200×630. Rendered once per version, then cached. |

`POST /apply` takes JSON:

```json
{ "contact": "1234", "name": "@fameboyteal", "signature": "Ada Operator", "certify": { "sync": true, "cast": true }, "bulletins": false }
```

`contact` is an FID or an e-mail address. It is stored in D1 and never shown anywhere. Member pages and cards show only the name, number, enrolled date and signature.

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

**Plan:** drawing a card takes about 300 ms of CPU. The Workers Free plan allows 10 ms per request, so card images need **Workers Paid** ($5/month). Applying and member pages fit in the free plan.

## Who has applied

```bash
pnpm wrangler d1 execute nda-register --remote --command "SELECT id, name, kind, bulletins, created_at FROM members ORDER BY id"
```

Add `contact` to the columns to see FIDs and e-mail addresses.
