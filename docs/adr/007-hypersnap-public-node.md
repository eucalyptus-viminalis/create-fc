# ADR 007: The demo moves to a small server that reads from Hypersnap

## Status

**accepted** (2026-10-28). Not built yet. The steps are in `developer/hypersnap-migration-plan.md`. Until the small server is up, demo.createfc.org shows a maintenance page (`site/demo/`).

Partly supersedes ADR 001 (Hetzner for command 0) for the demo: the demo no longer runs its own Snapchain node. ADR 003 (hosted fameboy) and ADR 006 (hosted seed phrase sign-in) carry on unchanged on the new server.

## Context

create-fc runs one Snapchain read node for the demo: a cx43 server and a 1000 GB volume in nbg1 on Hetzner, about $105 a month (`docs/Costs.md`). The same server runs three other things:

1. **The companion** (`node/companion.mjs`, port 3390): phone sign-in through the @fameboyclear app account, invite codes, the seed phrase sign-in check (ADR 006), presence, and image hosting for casts.
2. **The hosted fameboy** at demo.createfc.org (`fc-node client`, ADR 003), behind Caddy with its own HTTPS certificate.
3. **Uploaded images** in `/var/lib/fc-companion/images`, served by Caddy at `https://91-99-76-223.sslip.io/img/`. Casts link to them.

The bounty didn't pay out, and nothing else covers the bill. The node is the expensive part: the volume alone is 80% of it. The companion, the hosted fameboy and the images need a few GB of disk and very little CPU.

[Hypersnap](https://hypersnap.org/) runs the open Snapchain code across independent operators, and says it's the same network and identities as Farcaster. Its canonical node, `https://haatz.quilibrium.com`, is public: no API key, and its docs say there's no built-in per-IP rate limit on reads.

### What we checked (2026-10-28)

Against `https://haatz.quilibrium.com`:

- `GET /v1/info`: version 0.15.0, 3 shards, about 914 million messages and 3.36 million FIDs, 2 to 4 seconds behind on each shard. Served through Cloudflare with `access-control-allow-origin: *`.
- Every read endpoint fameboy and the companion use that we tried answered 200 in the same shape our own node gives: `castsByFid`, `signersByFid`, `userNameProofByName`, `storageLimitsByFid`, `linksByFid`, `onChainEventsByFid`, `onChainIdRegistryEventByAddress` and `events`. `onChainIdRegistryEventByAddress` took about 13 seconds, like on our node (ADR 006's rate limit exists for this reason).
- `POST /v1/validateMessage` and `POST /v1/submitMessage` exist and validate input: an empty submit came back `400 fid cannot be 0`. We haven't yet submitted a real message, so we don't know if casts sent there show up in other Farcaster clients.
- It also serves a Neynar-style `/v2/farcaster/*` API (for example `/v2/farcaster/user?fid=3`). fameboy doesn't need it.
- Shards 1 and 2 report `mempoolSize: 4294967295`, the largest 32-bit number. That's probably a placeholder, not a real queue, but it's unexplained.

On Hetzner (`hcloud`, nbg1):

- The server's IPv4, `91.99.76.223`, is a primary IP (`156361417`) with **auto delete on**. Deleting the server as `provision/hetzner-delete.sh` does today would release it.
- A primary IP can outlive its server and be attached to a new server in the same location (`hcloud server create --location nbg1 --primary-ipv4 156361417`). Kept but unattached, it costs $0.66 a month gross.
- cx23 (2 shared vCPU, 4 GB RAM, 40 GB disk): $6.49 a month net, $7.14 gross.

### Options

1. **Keep the Hetzner server.** Everything keeps working. $105 a month with no one paying it.
2. **Move the node, companion and hosted fameboy to a cheaper server.** Any full node needs the ~1000 GB volume. Still about $100 a month.
3. **Keep a small server for the companion and hosted fameboy only, and read from Hypersnap.** About $7.80 a month (cx23 plus its IPv4). Keeps the demo, phone sign-in through @fameboyclear, image hosting, invites and presence. Still a server to run, and @fameboyclear's custody key stays on a server.
4. **Read and write through Hypersnap's public node, run nothing ourselves, and delete the server.** $0. fameboy on people's own computers keeps working. The hosted demo, phone sign-in through @fameboyclear, image hosting and presence go away.

## Decision

**Option 3. The demo runs on a cx23 with no Snapchain node. Its companion and hosted fameboy read from and write to `https://haatz.quilibrium.com`. The big server and its volume are deleted now; the IPv4 is kept and moves to the small server.**

- **Keep `91.99.76.223`.** Turn its auto delete off before deleting the server (`hetzner-delete.sh --keep-ip`), and create the small server with it. Everything that names that address keeps working once the small server is up: demo.createfc.org's A record, `fameboyclear.91-99-76-223.sslip.io`, the image links in existing casts, and the README's "use our node" command.
- **Delete the big server now, before the small one is built.** The bill drops to $0.66 a month at once. The demo is down for the gap, and demo.createfc.org redirects to the maintenance page meanwhile.
- **Copy the companion's state off first:** images, the image ledger, invite codes and limits, to the owner's computer, then onto the small server. Not the custody key: the owner re-runs `fc-node app-account` on the small server instead, in their own SSH session.
- **A node-less setup mode.** `node/setup.sh` learns to install only the companion, Caddy and the hosted fameboy, pointed at a remote node (`NODE=https://haatz.quilibrium.com`). `provision/hetzner.sh` learns to make a small server with no volume, on a kept primary IP. `fc-node status` reports the remote node's sync state.
- **Port 3381 stays open, as a proxy.** Caddy on the small server forwards `:3381` to Hypersnap. Installs already pointed at `http://91.99.76.223:3381` keep working, and they still find the companion at `:3390`. It also gives us one place to switch to another node if haatz.quilibrium.com goes away. 3383 (gRPC) and the gossip port close.
- **Running your own node stays in the kit.** Commands 0 and 1 still build a full node for anyone who wants one. Whether command 1 should install Hypersnap's node build instead of Farcaster's Snapchain is left for a later ADR.

## Consequences

- **About $7.80 a month instead of $105**, and $0.66 a month until the small server exists.
- **The demo is down until the small server is built and set up.** demo.createfc.org, its QR codes and the README link land on the maintenance page meanwhile.
- **We depend on one public node we don't run.** If haatz.quilibrium.com goes down, changes its API, or adds limits, the demo breaks. Changing the proxy's upstream fixes it for everyone pointed at our IP; a list of fallback nodes is a follow-up.
- **Writes are unverified.** We haven't confirmed that a message submitted to Hypersnap reaches the same Farcaster that other clients read. The plan checks this with a test account before the small server goes live. If it doesn't propagate, this ADR gets revisited.
- **Reads go through a third party.** Hypersnap's operator sees every account the demo looks up, where before only we did. The hosted page and the docs need to say so.
- **@fameboyclear's custody key moves by being set up again.** It's deleted with the big server, so the owner must hold the account's seed phrase before then.
- **Uploaded images survive only if copied off before deletion.** They keep the same URLs once restored, because the IP and the sslip name don't change.
- **Presence and "node uptime" change meaning.** The companion can't see Hypersnap's container, so `/v1/companion` reports no start time. fameboy already handles a null.
- **The small server's 40 GB disk holds the images.** The companion's 10 GB node-wide image cap fits; check it before raising the cap.
- **`scripts/dns-createfc.sh` no longer manages the demo record**, and `scripts/demo-maintenance-dns.sh --undo` plus a DNS-only `demo` A record put it back when the small server is ready. Docs that describe the demo's own node (README, `docs/guide/host-fameboy.md`, `docs/guide/images.md`, `docs/guide/share-your-node.md`, `docs/tutorial/server.md`) need updating.

## Provenance

| Date | Commit | Change |
| --- | --- | --- |
| 2026-10-28 | (uncommitted) | Created, status accepted, with option 4 |
| 2026-10-28 | (uncommitted) | Decision changed to option 3 after review: keep a small server for the companion and hosted fameboy, and keep the IP |
