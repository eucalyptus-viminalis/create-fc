# What a read node costs on Hetzner

A Snapchain read node costs about **$105 a month** on the setup `provision/hetzner.sh` creates: a cx43 server plus a 1000 GB volume. If you sync it, try the client and delete everything within a day, you'll pay about **$4**.

There are no protocol fees. A read node needs no API key, stake or registration, and it earns nothing. You pay Hetzner for a server and a disk, and that's all.

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
| Snapshot download and unpack (all three shards) | 2 h 17 min | Measured |
| Catching up on blocks since the snapshot | ~5½ h | Projected from a 10-minute sample of the node's catch-up rate |
| **In sync and ready for the client** | **~8 h** | |

Catch-up time depends on how old the snapshot is when you start. Ours was about 22 hours old. Snapshots are refreshed daily.

These costs use the hourly total above:

| You keep it for | Cost (gross) |
| --- | --- |
| 1 day | ~$4 |
| 2 days | ~$7–8 |
| 1 week | ~$25–28 |
| 1 month | $105.37 (capped) |

When you're done, delete everything so billing stops:

```bash
hcloud server delete fc-node
hcloud volume delete fc-node-data
hcloud firewall delete fc-node-fw
```

The firewall and SSH key are free, but deleting them keeps the project tidy. The volume can only be deleted after the server is gone, or after `hcloud volume detach fc-node-data`.

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
| **cx43** | 8 shared | 16 GB | **$20.34** | Default. EU locations only. |
| cpx41 | 8 shared | 16 GB | $41.79 | Also available in US and Singapore, at higher prices there. |
| ccx23 | 4 dedicated | 16 GB | $111.64 | Guaranteed cores, steady performance. |

**Shared** vCPUs run on a host alongside other customers' servers, so speed can dip when the neighbours are busy. **Dedicated** vCPUs are reserved for you.

cx43 is enough. While catching up, our node's CPU was 94% idle and it used 1.7 GB of RAM, with the rest used as disk cache. The limit is how fast it can fetch blocks from peers, one after another, not the server. A dedicated-CPU server would cost five times as much and sync no faster.

If you ever need more, change the type in place. The server powers off briefly, and the volume and its data stay attached:

```bash
hcloud server change-type fc-node ccx23
```

Pick a different type up front with `TYPE=ccx23 ./provision/hetzner.sh`.

## Extras you don't need

- **Backups** add 20% to the server price. The node's data lives on the volume, which server backups don't cover, and you can always re-sync. Leave them off.
- **Server snapshots** cost $0.0219 per GB per month gross. You don't need one.
- **Traffic over 20 TB** costs $1.32 per TB gross. The first sync downloads about 400 GB. We haven't measured steady-state traffic yet, but it should be far below the allowance.

## Ways to pay less

- **Delete the node when you're not using it.** A fresh sync takes about 8 hours.
- **Start soon after the daily snapshot** to cut catch-up time.
- **Run it on hardware you already own.** The node needs 16 GB of RAM, 4+ cores and about 600 GB free if you use `node/load-snapshot.sh`. It works on a spare Linux box. A Mac also works if it has enough RAM and a fast external drive.
- **For a node you'll run long-term, look at Hetzner's dedicated servers** with local NVMe. They are billed monthly, sometimes with a setup fee, and are often cheaper per TB than a cloud volume. `hcloud` doesn't manage them, so they're outside this tutorial's scripts.

## What doesn't cost anything

- **Running the node.** Snapchain doesn't charge read nodes, and the snapshot download is free.
- **Writing messages.** Casts, follows and likes are free to submit to your own node.
- **Your client's app key.** It's registered with a gasless `KEY_ADD` message, with no Optimism transaction.

**Storage rent** is the one Farcaster cost, and it belongs to the *account*, not the node. Every account needs rented storage to post. The tutorial assumes you import an account that already has it.
