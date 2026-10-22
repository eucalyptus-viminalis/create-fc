# ADR 003: Hosted clearcast, with keys and personal state in the browser

## Status

**accepted** (2026-10-23). Design notes: `developer/hosted-clearcast.md`. The client is now called fameboy (ADR 004); read "clearcast" here as fameboy.

## Context

create-fc lets anyone run a Snapchain node and the clearcast client. Most people will never run a client, though. They want to open a URL, sign in, and use Farcaster. So whoever runs a node should also be able to host clearcast for others.

Today clearcast is built for one person on one computer:

- `clearcast ui` listens on 127.0.0.1 only, and the code says a shared mode must turn off local-only features (`client/src/ui-server.ts`).
- The server signs every write with one app key from `~/.fc-client/appkey.json`, so every visitor would be signed in as the operator.
- Personal state (cleared and saved casts, last visit, presence) lives in files in `~/.fc-client`.
- The page offers seed-phrase sign-in, which is only safe when the server is on your own computer.

Sign-in by phone approval already exists. The node's app account (`fc-node app-account`) vouches for key requests through fc-companion, and friends join with invite codes.

Options for where hosted users' app keys live:

1. **On the server.** Simplest port of today's code. The operator holds every user's key. A leaked disk or backup lets someone post as all of them.
2. **In the browser.** The browser makes the key and never sends it out. The server builds each message and the browser signs it.

## Decision

**Hosted clearcast keeps each person's app key and personal state in their own browser. The server holds no per-person secrets or data.**

- **Keys.** The browser makes an Ed25519 key with WebCrypto (`extractable: false`) and stores it in IndexedDB. Only the public key leaves the browser.
- **Sign-in.** Phone approval only. The companion signs the key request with the node's app account. Then the browser signs a server challenge and gets a session cookie: HttpOnly, SameSite=Lax, holding the fid and public key, signed by a server secret. There's no seed-phrase or new-account route in hosted mode.
- **Writes.** The server builds the message (`write.ts` keeps mentions, embeds and checks), and returns its hash. The browser signs the hash, and the server submits the message and confirms it. Image uploads and presence heartbeats, which the companion checks by app-key signature, work the same way.
- **Personal state.** Cleared and saved casts, last visit, presence status and device id move to IndexedDB, keyed by fid, in both local and hosted mode. Server endpoints take the fid and parameters such as `since` and keep nothing per person. Node-wide stats (network spans and hours) stay on the server.
- **Sign-in is open by default.** Operators can make it invite-only with the existing invite codes.
- **One codebase, two modes.** `clearcast ui` (local) is unchanged for the person using it: key file, seed-phrase sign-in, CLI. In local mode the page asks the server to sign (`/api/sign`). `clearcast serve --public <url>` is the hosted mode. It runs on the node box behind Caddy for TLS, set up by `fc-node client [domain]`.

## Consequences

- A leaked server disk or backup leaks no keys and no personal data. The hosted server is stateless apart from shared caches.
- Users still trust whoever serves the page's JavaScript, as with any hosted client. The docs must say so.
- Personal state is per device. Clearing a cast on a laptop doesn't clear it on a phone, and clearing site data loses saved casts. Encrypted sync can come later if people ask.
- Every browser or device is its own key and its own phone approval. Signing out deletes the key from the browser, but it stays valid on chain until the person removes it in the Farcaster app.
- Operators who sponsor sign-ins pay warps for each one. Open sign-in makes that cost unbounded, so invite-only stays available.
- Writes take two round trips (prepare, then submit).
- Per-user feed building is heavy on the node, so the server needs a shared cap on concurrent node calls and per-fid caches.
- Needs WebCrypto Ed25519: Chrome 137+, Safari 17+, Firefox 129+. Older browsers get a clear message.

## Provenance

| Date | Commit | Change |
| --- | --- | --- |
| 2026-10-23 | (this commit) | Created, status accepted |
