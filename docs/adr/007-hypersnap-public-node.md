# ADR 007: The demo moves to a small server that reads from Hypersnap

## Status

**implemented** (2026-10-28). The big server and its volume are deleted. demo.createfc.org runs on a cx23 at the same IP, `91.99.76.223`, reading from and writing to `https://haatz.quilibrium.com`. Phone sign-in through @fameboyclear, seed phrase sign-in and the old cast images work. What we learned is under [Outcome](#outcome). Built in `provision/hetzner.sh` (`NO_NODE`, `PRIMARY_IPV4`), `provision/hetzner-delete.sh` (`--keep-ip`), `node/setup.sh` (`NODE`), `node/companion-install.sh` (the `:3381` passthrough), `node/fc-node` and `client/src/home.ts` (`companionUrl`). The maintenance page (`site/demo/`) stays at createfc.org/demo/ and says the demo is back.

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
- `POST /v1/validateMessage` and `POST /v1/submitMessage` exist and validate input: an empty submit came back `400 fid cannot be 0`. We hadn't yet submitted a real message, so we didn't know if casts sent there show up in other Farcaster clients. (They do: see [Outcome](#outcome).)
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

- **Keep `91.99.76.223`.** Turn its auto delete off before deleting the server (`hetzner-delete.sh --keep-ip`), and create the small server with it. Everything that names that address keeps working once the small server is up: demo.createfc.org's A record, the image links in existing casts, and the README's "use our node" command. (We also expected `fameboyclear.91-99-76-223.sslip.io` to; it doesn't. See [Outcome](#outcome).)
- **Delete the big server now, before the small one is built.** The bill drops to $0.66 a month at once. The demo is down for the gap, and demo.createfc.org redirects to the maintenance page meanwhile.
- **Copy the companion's state off first:** images, the image ledger, invite codes and limits, to the owner's computer, then onto the small server. Not the custody key: the owner re-runs `fc-node app-account` on the small server instead, in their own SSH session.
- **A node-less setup mode.** `node/setup.sh` learns to install only the companion, Caddy and the hosted fameboy, pointed at a remote node (`NODE=https://haatz.quilibrium.com`). `provision/hetzner.sh` learns to make a small server with no volume, on a kept primary IP. `fc-node status` reports the remote node's sync state.
- **Port 3381 stays open, as a proxy.** Caddy on the small server forwards `:3381` to Hypersnap. Installs already pointed at `http://91.99.76.223:3381` keep working, and they still find the companion at `:3390`. It also gives us one place to switch to another node if haatz.quilibrium.com goes away. 3383 (gRPC) and the gossip port close.
- **Running your own node stays in the kit.** Commands 0 and 1 still build a full node for anyone who wants one. Whether command 1 should install Hypersnap's node build instead of Farcaster's Snapchain is left for a later ADR.

## Consequences

- **About $7.80 a month instead of $105**, and $0.66 a month until the small server exists.
- **The demo is down until the small server is built and set up.** demo.createfc.org, its QR codes and the README link land on the maintenance page meanwhile.
- **We depend on one public node we don't run.** If haatz.quilibrium.com goes down, changes its API, or adds limits, the demo breaks. Changing the proxy's upstream fixes it for everyone pointed at our IP: re-run command 1 with another `NODE`. Farcaster's own `https://crackle.farcaster.xyz:3381` has the same data (see [Outcome](#outcome)), so it's the fallback.
- **Writes reach Farcaster.** A test cast submitted through Hypersnap showed up in the farcaster.xyz app (see [Outcome](#outcome)).
- **Reads go through a third party.** Hypersnap's operator sees every account the demo looks up, where before only we did. The hosted page and the docs need to say so.
- **@fameboyclear's custody key moves by being set up again.** It's deleted with the big server, so the owner must hold the account's seed phrase before then.
- **Uploaded images survive only if copied off before deletion.** They keep the same URLs once restored, because the IP and the sslip name don't change.
- **Presence and "node uptime" change meaning.** The companion can't see Hypersnap's container, so `/v1/companion` reports no start time. fameboy already handles a null.
- **The small server's 40 GB disk holds the images.** The companion's 10 GB node-wide image cap fits; check it before raising the cap.
- **`scripts/dns-createfc.sh` no longer manages the demo record.** `scripts/demo-maintenance-dns.sh --undo` and a DNS-only `demo` A record, added by hand in Cloudflare, put it back.
- **The docs describe both setups**: a full node (commands 0 and 1), and a small server with no node, or no server at all with fameboy pointed at a public node. README, AGENTS.md, `docs/Costs.md`, the client tutorial and the hosting, sharing and images guides say so.

## Outcome

Measured on 2026-10-28, after the move.

- **The move worked as planned.** `hetzner-delete.sh --keep-ip` kept `91.99.76.223` unassigned at $0.66 a month. `NO_NODE=1 PRIMARY_IPV4=156361417 hetzner.sh` put it on a cx23 in nbg1. `setup.sh` with `NODE=https://haatz.quilibrium.com` set it up in a couple of minutes, and Caddy's `:3381` passthrough worked first time: `fc-node status` said in sync, and `http://91.99.76.223:3381/v1/castsByFid` answered from outside in 0.8 s. The archive copied back with `rsync`, and old cast images load at their old links.
- **Writes reach Farcaster.** A test cast submitted through Hypersnap showed up in the farcaster.xyz app.
- **Hypersnap's node follows the same chain as Farcaster's own.** Compared with `https://crackle.farcaster.xyz:3381`, Farcaster's public Snapchain node, a minute apart: both 0.15.0, shards 0 and 1 at the same heights (49119268 and 49797400), shard 2 three blocks apart, and the same latest cast for fid 3. So a message sent to either lands in the same place, and as far as we can see Hypersnap's node follows the same validators as Farcaster's. Its operators run more copies of the network, which spreads out reading; they don't make the blocks. If those validators stopped, Hypersnap's node would stop with them. That's the same exposure every Farcaster client has, and less than relying on one node: there are now two public nodes with the same data.
- **`fameboyclear.91-99-76-223.sslip.io` doesn't answer any more.** `fc-node client <domain>` serves fameboy at that one domain only, so with `demo.createfc.org` set, the sslip.io name has no site. demo.createfc.org is the address people were given, so we've left it.
- **The client no longer waits on missing companions.** Pointed straight at Hypersnap, fameboy used to spend 5 seconds per call on `haatz.quilibrium.com:3390`, which never answers. It now only guesses a companion for nodes on port 3381, and says at once when there's none.

## Provenance

| Date | Commit | Change |
| --- | --- | --- |
| 2026-10-28 | 0f6b6f2 | Created, status accepted, with option 4, then changed to option 3 after review: keep a small server for the companion and hosted fameboy, and keep the IP (PR #40) |
| 2026-10-28 | 14440c4, 9a18cce | Built: servers with no node, a kept primary IP, the `:3381` passthrough, the client's companion check (PR #42) |
| 2026-10-28 | (this commit) | Implemented: the demo is back on the small server. Outcome added |
