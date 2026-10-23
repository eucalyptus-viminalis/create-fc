# ADR 002: Rented server only, no bring-your-own-hardware path

## Status

**implemented** (2026-10-20). The site, README, Costs and ADR 001 no longer offer running the node on your own machine.

## Context

Command 0 rents a Hetzner server (ADR 001). Until now the site, README and `docs/Costs.md` also offered a second route: skip command 0 and run command 1 on "a Linux box with 16 GB of RAM and ~700 GB free" you already own. Costs.md went further and said a Mac works too.

On review, that route doesn't hold up:

- **It was never tested.** Command 1 has only ever run on Hetzner servers.
- **The Mac claim was wrong.** `node/setup.sh` needs Linux: systemd, `apt`, `/proc/meminfo`, `mountpoint`. The upstream `snapchain.sh` runs on macOS; our wrapper doesn't.
- **Few people have the hardware spare.** The database is 556 GB and growing, so the machine needs ~700 GB free plus 16 GB of RAM it can give up for hours. A tester is better served by a $4 server they delete the same day.
- **Home networks get in the way.** Other nodes can't reach UDP 3382 behind a router without port forwarding. That's fiddly for most people, and how well a read node works without it is unverified.
- **Every extra path costs support.** Two paths mean two sets of errors to document, test and help with, and the bounty is won by people getting through, not by options.

## Decision

The tutorial covers one route: **rent a server with command 0, set it up with command 1.**

- All mentions of running the node on your own machine are removed from the site, README and `docs/Costs.md`, including the Mac claim. ADR 001 points here.
- `node/setup.sh` says it's meant for the server command 0 creates. Its code doesn't block other Linux machines, but nothing documents or supports that.
- The client (command 2) still runs on the person's own computer, macOS or Linux. This decision is only about where the node runs.

## Consequences

- One path to document, test and troubleshoot. The fresh-box test covers all of it.
- People who'd rather not pay Hetzner have no documented alternative. That's acceptable: a full test costs about $4, and the [demo node](https://createfc.org/#try) lets anyone try the client for free.
- If someone asks for their own hardware later, write a new ADR. It needs a tested Linux path, a decision on macOS, and a measured answer to whether a node behind NAT syncs and relays well enough.

## Provenance

| Date | Commit | Change |
| --- | --- | --- |
| 2026-10-20 | (this commit) | Created, status implemented; own-hardware mentions removed |
