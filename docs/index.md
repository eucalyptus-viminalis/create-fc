# create-fc docs

Run your own Farcaster node and the fameboy client, explained.

The three commands on [createfc.org](https://createfc.org/quickstart/) work without reading any of this: rent a server, sync a node, install the client. These pages are for when you want to know what's running, what you're signing, or what to do when something looks wrong.

## How it works

What each command does and why, with real outputs and timings from a run on 18–19 October 2026.

- [Before you start: Hetzner](./tutorial/hetzner): the account, the API token and the volume limit.
- [Command 0: the server](./tutorial/server): the server, volume and firewall, and what happens when a type is sold out.
- [Command 1: the read node](./tutorial/node): loading the snapshot, catching up, and what the warnings mean.
- [Command 2: the client](./tutorial/client): fameboy in your browser and terminal.

## Guides

- [Share your node with friends](./guide/share-your-node): one node can serve a few people. They sign in by approving on their phone and see who else is on.
- [Host fameboy for others](./guide/host-fameboy): put fameboy at a web address so people can use Farcaster through your node without installing anything, or on a small server with no node.
- [Images in your casts](./guide/images): where uploaded images live, and how much room each person gets.

## Explainers and reference

- [Your app key](./guide/app-key): what fameboy saves when you sign in, and how to remove it.
- [Costs](./Costs): what a node costs on Hetzner, by the hour and by the month, and what it costs without one.

For accounts, app keys and how the protocol works, these docs link to [Farcaster's own docs](https://docs.farcaster.xyz/learn/what-is-farcaster/accounts), which stay current.
