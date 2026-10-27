# What a read node costs on Hetzner

A Snapchain read node costs about **$105 a month** on the setup `provision/hetzner.sh` creates: a cx43 server plus a 1000 GB volume. If you sync it, try the client and delete everything within a day, you'll pay about **$4**. When cx43 is sold out, the script falls back to cpx41, which makes it about $127 a month, or $5 for the day (see [When cx43 is sold out](#when-cx43-is-sold-out)).

There are no protocol fees. A read node needs no API key, stake or registration, and it earns nothing. You pay Hetzner for a server and a disk, and that's all.

You don't need a node of your own to use fameboy. Pointed at a public node such as Hypersnap's, it costs nothing; a small server that hosts fameboy for others without a node costs about **$7.80 a month**. See [Without a node](#without-a-node).

All prices below came from the Hetzner API (`hcloud server-type describe` and `GET /v1/pricing`) on 2026-10-18, for the `fsn1` (Falkenstein) location. They are in USD. **Gross** includes 10% VAT, which is the rate on the account used for this write-up. Hetzner charges VAT by your billing country, so your gross figures may differ. Net prices are the same for everyone.

## The bill, line by line

| Item | What it's for | Net / month | Gross / month |
| --- | --- | --- | --- |
| cx43 server | 8 shared vCPU, 16 GB RAM, 160 GB boot disk | $18.49 | $20.34 |
| 1000 GB volume | The node's database (556 GB after the first sync) | $76.70 | $84.37 |
| Public IPv4 | So peers and your client can reach the node | $0.60 | $0.66 |
| Traffic | 20 TB/month included in EU locations | $0.00 | $0.00 |
| **Total** | | **$95.79** | **$105.37** |

The volume is 80% of the bill. Hetzner charges $0.0767 per GB per month net ($0.0844 gross), so storage, not compute, is what makes a node expensive.

## How Hetzner bills

- **Everything is billed by the hour, and capped at the monthly price.** A server you keep for a whole month never costs more than the monthly figure.
- **Powering off doesn't stop the meter.** A stopped server and a detached volume both keep billing until you *delete* them.
- **A volume can grow but never shrink.** If you outgrow it, `hcloud volume resize` grows it in place.
- **Hourly prices are a little higher than monthly ÷ 730.** The monthly cap kicks in before the end of the month. For cx43 the hourly rate is $0.0326 gross, and the cap of $20.34 is reached after about 625 hours. The API publishes only a monthly price for volumes. The hourly volume figure below assumes volumes are capped the same way, so treat it as approximate.

| Item | Gross / hour |
| --- | --- |
| cx43 server | $0.0326 |
| Public IPv4 | $0.0011 |
| 1000 GB volume | ~$0.12–0.14 |
| **Total** | **~$0.15–0.17** |

## What a tester actually pays

You don't need to keep a node for a month to follow the tutorial. Most of the time goes on the first sync. On 2026-10-18, our node took:

| Step | Time | How we know |
| --- | --- | --- |
| `hetzner.sh` creates the server, volume and firewall | 35 s | Measured |
| First boot installs Docker and starts the snapshot loader | ~1 min | Measured |
| Snapshot download and unpack (all three shards) | 2 h 17 min, then 1 h 53 min | Measured, two runs |
| Catching up on blocks since the snapshot | ~5½ h, then 4 h 25 min | First projected, second measured |
| **In sync and ready for the client** | **~8 h, then 6 h 20 min** | Second run: command 0 at 22:27:56Z, in sync at 04:48:02Z |

Catch-up time depends on how old the snapshot is when you start. Ours was about 22 hours old. Snapshots are refreshed daily.

These costs use the hourly total above:

| You keep it for | Cost (gross) |
| --- | --- |
| 1 day | ~$4 |
| 2 days | ~$7–8 |
| 1 week | ~$25–28 |
| 1 month | $105.37 (capped) |

When you're done, delete everything so billing stops. The script lists the server, volume, firewall and SSH key it found, asks you to type the server's name, then deletes them in the right order. It took 34 seconds for us, and running it again is harmless:

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner-delete.sh | bash
```

Add `--keep-ip` (`… | bash -s -- --keep-ip`) to keep the server's IPv4 address for $0.66 a month gross ($0.60 net), so a later server can take it over with `PRIMARY_IPV4=<its id>` on command 0. Anything that names the address, such as a DNS record or image links in casts, then keeps working.

The volume holds the node's database, so a new node re-syncs from scratch (6–8 hours). To do it by hand instead: `hcloud server delete fc-node`, then `hcloud volume delete fc-node-data`, `hcloud firewall delete fc-node-fw` and `hcloud ssh-key delete fc-node-key`. The volume can only be deleted once the server is gone.

## Without a node

The node is what costs money: the volume alone is 80% of the bill. Two ways to skip it:

- **Point fameboy at a public node.** `install.sh https://haatz.quilibrium.com` uses Hypersnap's public node, which follows the same network as Farcaster's own. Free, and nothing to run. Its operator can see which accounts you look up, and there's no companion, so no image uploads or who's online.
- **A small server with no node.** `NO_NODE=1` on command 0 makes a cx23 with no volume, and `NODE=https://haatz.quilibrium.com` on command 1 sets it up to read from that public node. It runs the companion, image hosting and hosted fameboy. This is how demo.createfc.org runs ([ADR 007](https://github.com/eucalyptus-viminalis/create-fc/blob/main/docs/adr/007-hypersnap-public-node.md)).

Prices from `hcloud server-type describe cx23` on 2026-10-28, the same in `fsn1` and `nbg1`:

| Item | What it's for | Net / month | Gross / month |
| --- | --- | --- | --- |
| cx23 server | 2 shared vCPU, 4 GB RAM, 40 GB disk | $6.49 | $7.14 |
| Public IPv4 | So people and Caddy's certificates can reach it | $0.60 | $0.66 |
| **Total** | | **$7.09** | **$7.80** |

The 40 GB disk holds the uploaded images; the companion's default 10 GB cap for the whole server fits. When cx23 is sold out, the script tries cax11 (2 Arm vCPU, 4 GB RAM), at $7.69 a month gross plus the IPv4.

## Why 1000 GB is enough

The upstream docs ask for 2 TB of disk, and the node's built-in snapshot loader needs it. That loader downloads every shard's snapshot, unzips each into a large archive, unpacks the archive into the database, and deletes the downloads and archives **only after all three shards are done**. Reading its source (`src/storage/db/snapshot.rs` in `farcasterxyz/snapchain`), we estimate it needs about 1.5 TB at its peak.

We don't use that loader. `node/load-snapshot.sh` streams each ~70 MB piece of the snapshot straight into the database and deletes it immediately. The node skips its own download when the database already exists, so it boots straight into catching up. Measured on our node:

| Shard | Pieces | Time | Disk used after |
| --- | --- | --- | --- |
| 0 | 370 | 10 min | 37 GB |
| 1 | 2,671 | 63 min | 297 GB |
| 2 | 2,648 | 63 min | 556 GB |

**Disk use peaked at 556 GB, the same as the final database size.** A 1000 GB volume leaves about 430 GB for the database to grow.

This also matters because **a new Hetzner account is capped at 1024 GB of volumes in total**, and it can't ask for more until it's older. With the upstream loader, a new account couldn't sync a node on Hetzner Cloud at all.

## Choosing a server type

Prices for 16 GB servers in `fsn1` (gross, per month):

| Type | vCPU | RAM | Monthly | Notes |
| --- | --- | --- | --- | --- |
| **cx43** | 8 shared | 16 GB | **$20.34** | First choice. EU locations only. |
| cpx41 | 8 shared | 16 GB | $41.79 | Fallback when cx43 is sold out. Also in US and Singapore, at higher prices there. |
| ccx23 | 4 dedicated | 16 GB | $111.64 | Guaranteed cores, steady performance. |

**Shared** vCPUs run on a host alongside other customers' servers, so speed can dip when the neighbours are busy. **Dedicated** vCPUs are reserved for you.

cx43 is enough. While catching up, our node's CPU was 94% idle and it used 1.7 GB of RAM, with the rest used as disk cache. The limit is how fast it can fetch blocks from peers, one after another, not the server. A dedicated-CPU server would cost five times as much and sync no faster.

If you ever need more, change the type in place. The server powers off briefly, and the volume and its data stay attached:

```bash
hcloud server change-type fc-node ccx23
```

Pick a type up front with `TYPE=ccx23`, for example `curl … | TYPE=ccx23 bash`. That also turns off the fallback below.

### When cx43 is sold out

Hetzner runs out of popular types in a location from time to time. When it does, creating the server fails with `error during placement (resource_unavailable)`, and nothing is created or billed. On 2026-10-18 we watched cx43 go unavailable in fsn1, nbg1 and hel1 within about a minute, and come back in nbg1 five minutes later.

So `hetzner.sh` tries, in order, and tells you which it got:

1. cx43 in fsn1, then nbg1, then hel1
2. cpx41 in fsn1, then nbg1, then hel1

It creates the server first and the volume second, in whatever location the server landed in. That order matters: a volume is tied to one location, and an earlier version that created the volume first left a billing volume behind on every failed attempt.

| | cx43 | cpx41 |
| --- | --- | --- |
| vCPU / RAM | 8 shared / 16 GB | 8 shared / 16 GB |
| Server, per hour | $0.033 | $0.067 |
| Server, per month | $20.34 | $41.79 |
| **All in, per hour** (with volume and IPv4) | **~$0.16** | **~$0.19–0.21** |
| **All in, per month** | **$105.37** | **$126.82** |
| 8-hour first sync | ~$1.30 | ~$1.60 |
| One-day test | ~$4 | ~$5 |

For a read node the two behave the same, since neither the CPU nor the RAM is the bottleneck. If you'd rather wait for cx43 than pay the difference, pin it with `TYPE=cx43` and re-run later.


## Extras you don't need

- **Backups** add 20% to the server price. The node's data lives on the volume, which server backups don't cover, and you can always re-sync. Leave them off.
- **Server snapshots** cost $0.0219 per GB per month gross. You don't need one.
- **Traffic over 20 TB** costs $1.32 per TB gross. The first sync downloads about 400 GB. We haven't measured steady-state traffic yet, but it should be far below the allowance.

## Ways to pay less

- **Delete the node when you're not using it.** A fresh sync takes 6–8 hours.
- **Start soon after the daily snapshot** to cut catch-up time.
- **For a node you'll run long-term, look at Hetzner's dedicated servers** with local NVMe. They are billed monthly, sometimes with a setup fee, and are often cheaper per TB than a cloud volume. `hcloud` doesn't manage them, so they're outside this tutorial's scripts.

## What doesn't cost anything

- **Running the node.** Snapchain doesn't charge read nodes, and the snapshot download is free.
- **Reading from a public node.** Hypersnap's needs no API key and, per its docs, has no built-in rate limit.
- **Writing messages.** Casts, follows and likes are free to submit to your own node.
- **Your client's app key.** It's registered with a gasless `KEY_ADD` message, with no Optimism transaction.

**Storage rent** is the one Farcaster cost, and it belongs to the *account*, not the node. Every account needs rented storage to post. The tutorial assumes you import an account that already has it.
