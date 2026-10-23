# Command 0: the server

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner.sh | bash
```

[`provision/hetzner.sh`](https://github.com/eucalyptus-viminalis/create-fc/blob/main/provision/hetzner.sh) creates four things, each named so a re-run finds and reuses it: an SSH key, a firewall, the server and a volume. The volume is made in the server's location and attached straight away; command 1 mounts it at `/srv/snapchain`.

It takes about 30 seconds and ends with the server's address:

```
Server fc-node is up at 91.99.76.223 (cx43, 1000 GB volume, nbg1).
```

## The firewall

The firewall opens exactly what a read node needs:

| Port | Protocol | For |
| --- | --- | --- |
| 80, 443 | TCP | fc-images: the [images](../guide/images) people attach to casts, served over HTTPS (80 is how it gets its certificate). Also [hosted fameboy](../guide/host-fameboy). |
| 3381 | TCP | HTTP API. Your client talks to this. |
| 3382 | **UDP** | Gossip with other nodes (libp2p over QUIC). A TCP-only rule leaves the node unable to peer. |
| 3383 | TCP | gRPC API: the same data as 3381, for other tools. |
| 3390 | TCP | fc-companion: node uptime, who's online, and phone sign-in for friends [sharing your node](../guide/share-your-node). |
| 22 | TCP | SSH |
| 3000 | TCP | **Closed.** The node ships Grafana with the login admin / admin. |

## When a server type is sold out

When Hetzner has no cx43 free in a location, it answers `error during placement (resource_unavailable)` and creates nothing. We watched cx43 disappear from all three EU locations within a minute, then come back in Nuremberg five minutes later.

The script handles it: cx43 in fsn1, nbg1 and hel1, then cpx41 (the same 8 vCPU and 16 GB at about twice the server price) in the same order, and it says which it got. It creates the server first and the volume after, in the server's location, because a volume can't move between locations.

## Choosing the type, location and size

Pin your choice with environment variables after the pipe:

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner.sh | TYPE=cx43 LOCATION=hel1 bash
```

| Variable | Default | |
| --- | --- | --- |
| `TYPE` | cx43, then cpx41 | Any Hetzner Cloud server type (`hcloud server-type list`), or several to try in order. The defaults have 8 vCPU and 16 GB of RAM. |
| `LOCATION` | fsn1, nbg1, hel1 | Where to look, in order. |
| `VOLUME_GB` | 1000 | Must fit your account's volume cap. |

If the volume step fails with `volumes size limit exceeded (resource_limit_exceeded)`, your account's volume cap is lower than `VOLUME_GB`. Check **Limits** in the console. New accounts get 1024 GB ([why](./hetzner#new-accounts-get-1024-gb-of-volumes)).

Next: [Command 1: the read node](./node)
