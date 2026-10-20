# ADR 001: Hetzner Cloud for command 0 (provision compute)

## Status

**implemented** (2026-10-18). `provision/hetzner.sh` created a cx43 server with a 1000 GB volume in fsn1 at 00:43Z. First boot loaded the snapshot by 03:02Z, and the node was catching up by 03:12Z. Full sync is not confirmed yet; it is projected for about 08:40Z.

## Context

The quickstart has three commands. Command 0 is "provision necessary compute via script". The prize post requires a script and nothing more specific: it doesn't name a cloud, Terraform, or a bring-your-own-box path.

A Snapchain read node needs a lot of machine. The official minimum is 16 GB RAM, 4 vCPU, 2 TB of disk and a public IP:

- The 2026-10-17 mainnet snapshot is about 397 GB compressed across three shards.
- The node's built-in snapshot loader keeps every shard's compressed chunks and uncompressed tar on disk until all shards are unpacked. Reading its source, we estimate the peak at about 1.5 TB. The settled database measured 556 GB.
- New Hetzner accounts are capped at **1024 GB of volumes in total**, and they can't ask for more until the account is older. We found this on our first launch.
- Gossip runs over UDP 3382, and the HTTP and gRPC APIs listen on TCP 3381 and 3383.

To qualify, at least one other person has to complete the tutorial and vouch for it publicly. Most testers won't have a spare machine with 16 GB+ RAM and 600 GB–2 TB free. The cheapest way to get a voucher through is a server they can create, use and delete in a day.

We considered:

- **Hetzner Cloud.** The `hcloud` CLI is a single binary, available through Homebrew. Hetzner bills by the hour and has block volumes up to 10 TB. It also offers a firewall API, so we can open UDP 3382 and keep Grafana's port 3000 closed. Setup needs one manual step: you create a project and an API token in the web console. There is no API for either.
- **AWS.** The upstream `running-a-node` guide uses m5.xlarge with 2 TB gp3 and quotes about $100/mo. The CLI setup (IAM, key pairs, security groups, VPC defaults) adds friction for a first-time tester.
- **DigitalOcean.** It is comparable to Hetzner in CLI simplicity. Its tokens are also console-only.
- **Local Mac or Linux box.** It's free if you already have the hardware. On macOS, Docker runs inside a VM that gets half the RAM by default. Docker on macOS also reaches your files through a slow file-sharing layer. Home NAT blocks inbound UDP 3382. Few testers have 2 TB free.
- **Terraform.** It is more declarative, but it adds a second tool to install. It doesn't remove the console step either, since Hetzner still needs a project and token from the console.

## Decision

Command 0 targets **Hetzner Cloud via the `hcloud` CLI**. The commands live in a plain bash script, `provision/hetzner.sh`.

The script creates:

- **Server:** `cx43` (8 shared vCPU, 16 GB RAM, $20.34/mo gross; see `docs/Costs.md`) running Ubuntu 24.04. It tries fsn1, nbg1 and hel1, then falls back to `cpx41` ($41.79/mo) in the same order when Hetzner answers `resource_unavailable`. `TYPE`, `LOCATION` and `IMAGE` pin a choice.
- **Volume:** 1000 GB, which fits the new-account cap. It is created *after* the server, in the server's location, and attached straight away; first boot waits up to 5 minutes for it. (It was created first originally, but a failed placement then left a location-bound volume billing; see Provenance.)
- **Firewall:** inbound TCP 22, 3381, 3383 and 3390 (fc-companion), plus UDP 3382. Everything else, including Grafana's 3000, stays closed.
- **SSH key:** from `~/.ssh/id_ed25519.pub`.

How first boot works:

- `provision/cloud-init.sh` runs first. It formats the volume, mounts it at `/srv/snapchain` and symlinks `/root/snapchain` to it.
- It pre-seeds `.env` with `AGREE_NO_REWARDS_FOR_ME=true` and `HUB_OPERATOR_FID`.
- It runs `node/load-snapshot.sh`, which `hetzner.sh` inlines into the user data. The script streams each ~70 MB snapshot chunk through `gunzip` into `tar -x` and deletes it once unpacked, so disk use never exceeds the database. The node only downloads a snapshot itself when `.rocks` is empty (`src/main.rs`), so it boots straight into catching up.
- It then runs the official `snapchain.sh upgrade` in the background, and stops following the logs once `snapchain-snapchain-1` is up.
- We bypass the upstream `snapchain-bootstrap.sh` on purpose. It reads from `/dev/tty`, which doesn't exist under cloud-init. Its final `logs -f` also never exits.

How re-runs work:

- The script is idempotent: each resource is looked up by name and reused if it exists.
- The one manual prerequisite is creating a Hetzner project and API token in the console, then running `hcloud context create`, or exporting `HCLOUD_TOKEN`. The tutorial documents this as step zero of command 0.

There is no bring-your-own-hardware path; see [ADR 002](002-rented-server-only.md).

## Consequences

- Testers need a Hetzner account. A new account may require ID or payment verification before it can create servers. The tutorial must say this up front, since it can take hours.
- **Volume I/O was not a problem.**
  - The streamed load averaged 31–48 chunks/min and finished in 2 h 17 min.
  - During catch-up, CPU was 94% idle with no I/O wait. The limit is sequential block sync from peers.
  - Measured disk peak: 556 GB.
- **We diverge from the upstream install path** by using our own snapshot loader. If upstream changes the snapshot format, for example by no longer splitting into independently gzipped tar slices, `load-snapshot.sh` breaks. It would fail loudly, since a bad chunk fails `gzip -t` or `tar` errors out. The fallback is to delete `.rocks` and let the node's own loader run on a 2 TB disk. A better long-term fix is an upstream PR that makes the built-in loader stream too.
- **Cost:** $105.37/mo gross, 80% of it the 1000 GB volume, or about $4 for a one-day test. See `docs/Costs.md`. The shared vCPUs were not a bottleneck. The tutorial will tell testers to `hcloud server delete` and `hcloud volume delete` when they're done.
- The upstream bootstrap's TTY problem is a candidate upstream PR to `farcasterxyz/snapchain`: fall back to stdin when there is no TTY, and add a way to skip following the logs.

## Provenance

| Date | Commit | Change |
| --- | --- | --- |
| 2026-10-18 | none (repo not yet under git) | Created, status accepted |
| 2026-10-18 | none (repo not yet under git) | 1000 GB volume + streaming loader after hitting the account cap; measured numbers; status implemented |
| 2026-10-19 | (this commit) | cx43 sold out in all EU locations during the fresh-box test: server-first creation, cx43 → cpx41 fallback; `hetzner-delete.sh` added |
