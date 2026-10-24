# Command 1: the read node

```bash
ssh -o StrictHostKeyChecking=accept-new root@<ip> 'curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/node/setup.sh | bash'
```

[Snapchain](https://snapchain.farcaster.xyz/) is the network that stores Farcaster's messages: every cast, like, follow and profile change. Its official installer, `snapchain.sh`, runs the node in Docker. [`node/setup.sh`](https://github.com/eucalyptus-viminalis/create-fc/blob/main/node/setup.sh) wraps it, starts it as a systemd job so you can disconnect, and changes one thing: how the database gets loaded.

The command returns in a few seconds. Check on it about every half hour:

```bash
ssh root@<ip> fc-node status
```

## Loading the snapshot

About 2 hours. A new node doesn't replay Farcaster from the beginning. It downloads a daily snapshot of each shard (about 397 GB compressed, in ~70 MB pieces), then fetches the blocks made since. The node's own loader keeps every downloaded piece and an uncompressed copy of each shard until all three are unpacked. We estimate that peaks around 1.5 TB, which is why the upstream docs ask for 2 TB.

`fc-load-snapshot` streams instead: download a piece, unzip it straight into the database, delete it, repeat. The node only downloads a snapshot when its database folder is empty, so afterwards it boots straight into catching up.

Measured on a cx43 with a 1000 GB volume:

| Shard | Pieces | Time | Disk used after |
| --- | --- | --- | --- |
| 0 (the block shard) | 370 | 10 min | 37 GB |
| 1 | 2,671 | 63 min | 297 GB |
| 2 | 2,648 | 63 min | 556 GB |

Disk use peaked at 556 GB, the size of the finished database. [Costs](../Costs#why-1000-gb-is-enough) has more on the disk.

## Catching up

About 4–5 hours. Our snapshot was 22 hours old by the time it finished loading. The node fetched the missing blocks at about 5 per second per shard and closed the gap by about 4 seconds every second, so it was in sync roughly 5½ hours later. On a second, timed run the snapshot was 19 hours old and the node caught up in 4 hours 25 minutes: 6 h 20 min from command 0 to in sync.

The CPU sat 94% idle. The limit is fetching blocks from peers one after another, not the server.

Reads already work while it catches up; only the newest casts are missing. You can [install the client](./client) now.

```
$ ssh root@<ip> fc-node status
measuring catch-up speed (10 s)...
  shard 0: 3s behind
  shard 1: 3.8 h behind, gaining 4.8 s per second (~48 min to go)
  shard 2: 2s behind
catching up: 3.8 h behind, ~48 min to go.

$ ssh root@<ip> fc-node status
  shard 0: 1s behind
  shard 1: 1s behind
  shard 2: 1s behind
in sync. Run command 2 on your own computer.
```

The first is our demo node with one shard still catching up; the second is a node in sync. While a node is behind, `fc-node status` takes two readings 10 seconds apart and works out the speed and time to go from them. During setup, `fc-node status` shows the snapshot's progress instead. On your own computer, `fameboy status` reports the same "behind" numbers.

If a shard's height doesn't change between the two readings, it says so:

```
  shard 1: 3.8 h behind and STUCK at block 49477354: no new blocks in 61 s
stuck: shard 1 stopped taking blocks. ...
```

Our demo node did this on snapchain 0.14.3: shard 1 panicked on one block (`merkle trie root hash mismatch`) and crashed again on every restart. Upgrading to 0.15.0 with `cd ~/snapchain && ./snapchain.sh upgrade` fixed it.

## Reading the numbers

"Behind" is `blockDelay` from `/v1/info`: how many seconds each shard's newest block trails the clock. A synced node stays in single digits.

In the same response, `mempoolSize: 4294967295` is normal on a read node. It means "not reported", not an overflow.

## Warnings you can ignore

Two things look alarming and aren't:

- `Failed to dial peer … HandshakeTimedOut` for a couple of the bootstrap addresses.
- A steady trickle of `InsufficientPeers ("read-node-peers")`.

Our node logged both all day and synced fine.

## Why not the official one-liner?

`snapchain-bootstrap.sh` reads its prompts from `/dev/tty`, which doesn't exist over `ssh host 'curl … | bash'` or in a systemd job. `setup.sh` answers both prompts in `.env` ahead of time and runs `snapchain.sh upgrade` directly.

## If setup stops

If `fc-node status` says the node `isn't answering and setup isn't running`, setup stopped partway. Run command 1 again: finished shards are skipped and a partial one is redone. Don't run it again while setup is still running.

Next: [Command 2: the client](./client)
