# ADR 006: Hosted fameboy accepts a seed phrase, used only in the browser

## Status

**implemented** (2026-10-25). Live on demo.createfc.org. Built in `client/src/phrase-browser.ts` (the browser), `client/src/phrase-signin.ts` (the server) and `client/ui/signin.js`.

## Context

The bounty asks for a client that can "import an existing seed phrase for an account that already has storage, use that seed phrase to issue the client its own app key". `fameboy login` and the seed phrase option on `fameboy ui` already do this on your own computer (`client/src/keys.ts`).

A hosted fameboy (`fameboy serve`, ADR 003) refuses seed phrases. The local sign-in posts the phrase to the fameboy server (`POST /api/signin/phrase`). On your own computer that server is yours. On a hosted copy it belongs to the operator, who could log every visitor's phrase. A seed phrase controls the whole account: it can transfer the FID and add or remove keys. So ADR 003 left hosted copies with phone approval only.

Phone approval needs the Farcaster app. Hosted fameboy is meant for people who don't run anything themselves, and many won't have the app (ADR 005). For them, a hosted copy is a dead end today.

The phrase is only needed to sign two things. A gasless KEY_ADD carries three signatures (`buildKeyAdd` in `client/src/keys.ts`):

1. **SignedKeyRequest** (EIP-712, custody key): "app *fid* asks for this key".
2. **KeyAdd** (EIP-712, custody key): "add this key to *fid* with these scopes, this TTL and this nonce".
3. **The message envelope**, signed by the new app key, proving whoever adds it holds it.

A hosted browser already holds its app key (WebCrypto Ed25519, `extractable: false`, `client/ui/mine.js`) and signs envelopes for the server (`client/src/remote-sign.ts`). So a browser that also derived the custody key from the phrase could make all three signatures itself.

Options:

1. **Keep refusing seed phrases on hosted copies.** No new risk. People without the Farcaster app can't use hosted fameboy.
2. **Send the phrase to the server, as `fameboy ui` does.** Least work. Every operator sees every phrase. Rejected for the same reason ADR 003 rejected keys on the server.
3. **Use the phrase only in the browser.** The browser derives the custody key, signs 1 and 2 itself, and sends the server only signatures and public data.

## Decision

**A hosted fameboy offers seed phrase sign-in. The phrase and the custody key stay in the browser. The server gets only public data and signatures.**

### The flow

1. **The browser checks the phrase** (12 or 24 words, valid checksum) and derives the custody address at `m/44'/60'/0'/0/0`.
2. **The browser asks the server about that address** (`POST /api/signin/phrase/account`). The server answers from the node: the FID it owns, whether it still owns it, the FID's storage units and the next key nonce. All of this is public. If index 0 owns no FID, the browser tries indexes 1 to 9, as `findCustody` does.
3. **The browser builds and signs both EIP-712 messages itself.** It fills in the fields from things it knows or can check: its own app public key, the FID from step 2, fameboy's fixed scopes and TTL (`SCOPES`, `TTL`), the nonce, and a deadline 10 minutes out. The account names itself as the requesting app (requestFid = fid), as `fameboy login` does. The browser never signs a hash the server hands it, so a server that has been tampered with (but still serves the honest page) can't get it to sign something else, such as an FID transfer.
4. **The server checks the signatures and builds the KEY_ADD** (`POST /api/signin/phrase/prepare`), and returns its hash. The browser signs that hash with its new app key (`POST /api/signin/phrase/finish`), and the server checks it with `validateMessage` and submits it to the node. This hash is the only thing the browser signs without building it itself, and only with an app key the node doesn't know yet.
5. **Once the node has the key**, the browser signs the usual session challenge and gets a session cookie, exactly like phone sign-in.
6. **The browser drops the phrase and the custody key.** The phrase is never stored, logged or sent. The app key is the same kind of key phone sign-in makes.

The crypto runs in one checked-in browser bundle, `client/ui/vendor/phrase-browser.js`, built from `phrase-browser.ts` with esbuild (`pnpm build:browser`). It uses the same libraries `fameboy login` does: viem's account code, which is built on `@scure/bip39`, `@scure/bip32` and `@noble/curves`. The server imports the same module for the scopes and TTL, so the two can't drift. The rest of the UI stays plain scripts with no bundler.

### Limits

- **Operators can turn it off.** `fc-node signin phrase off` hides the option, and the companion refuses the key. It's on by default, like open sign-in, because it's the only way in for people without the Farcaster app.
- **Invites still apply.** When the node is invite-only (`fc-node signin invite`), seed phrase sign-in needs a code too. The companion checks it with the same codes and the same 20 tries an hour per address as phone sign-in. Without this, a seed phrase would get around invite-only, since the operator's app account isn't involved.
- **Address lookups are rate limited.** An address that owns no FID makes the node scan every ID registry event: 30 to 40 seconds. The server allows each visitor 10 lookups an hour, enough for one full pass over indexes 0 to 9, and at most 3 at once across the node. It remembers each answer for 10 minutes, and a remembered answer is free.
- **The page warns before the phrase box**, in plain words: anyone who controls this site's page could take your account, so only use a copy run by someone you trust, or run fameboy on your own computer. The phone option stays first.

`fameboy ui` on your own computer is unchanged.

### Later: changing your username (2026-10-25)

The me page edits the profile: picture, display name and bio are messages the app key signs, so they need no phrase. A username also needs a name from Farcaster's fname server, which only the custody key can claim. The me page asks for the phrase for that alone, the same way: the browser derives the custody key, checks it owns the account (it must match the address the server names), and signs the fname transfers itself (`signName`, `custodyFor` in `phrase-browser.ts`). The server only relays the signed transfers to the fname server, then sets the username with the app key. The operator switch covers it too: with `fc-node signin phrase off`, the me page says to change the username in the Farcaster app.

## Consequences

- People without the Farcaster app can sign in to a hosted copy. That fills the gap ADR 005 pointed out for hosted sign-in.
- The operator never receives a phrase, and a leaked server disk still leaks no secrets (ADR 003).
- **People still trust the operator's page.** A dishonest operator can change the JavaScript to steal the phrase. With phone approval, a bad page can at most misuse one limited app key; with a seed phrase, it can take the account. The warning says so. Publishing a hash of each page build would let people check what they're running; that's a follow-up.
- **Casts say "via @their-username"**, not "via" the node's app account, because the account names itself as the requesting app. Hosted and local seed phrase keys look the same in fameboy. Other clients may label self-requested keys differently; not checked yet.
- **The operator pays nothing per seed phrase sign-in.** No app account signs and no warps are spent, unlike phone approval. These users also don't appear as users of the node's app account.
- **Signing out could revoke the key on chain.** A self-requested gasless key can sign its own KEY_REMOVE, as `fameboy ui`'s sign-out already does. Hosted sign-out only deletes the key from the browser for now; revoking there is a follow-up.
- Each sign-in uses one of the FID's gasless key slots, the same as any other sign-in.
- Two code paths sign KEY_ADDs: `keys.ts` for `fameboy login`, and the browser bundle for hosted copies. `test/phrase-browser.test.ts` checks the browser's signatures and message match `fameboy login`'s byte for byte, and that the node accepts the message.
- Hosted copies serve more JavaScript (the crypto bundle, about 110 KB minified, 40 KB compressed), loaded only when someone picks the seed phrase option.
- An older companion doesn't report the setting, so a hosted fameboy hides the option until command 1 updates the node.

## Provenance

| Date | Commit | Change |
| --- | --- | --- |
| 2026-10-25 | e6aeedb | Created, status proposed |
| 2026-10-25 | e6aeedb | Accepted and built (PR #34) |
| 2026-10-25 | 3e3eb84 | Implemented: deployed to demo.createfc.org |
| 2026-10-25 | (this commit) | Username changes on the me page use the same in-browser signing |
