# Host fameboy for others

Most people will never run their own client. With one command, your node can host fameboy for them: they open a web address, sign in with their phone or their seed phrase, and use Farcaster through your node. Nothing to install.

This page covers turning it on, the address it gets, who can sign in, and what the people using it trust you with.

## What you need

- A node from [commands 0 and 1](https://createfc.org/quickstart/), in sync, with its companion running, or a small server with no node ([below](#without-a-node-of-your-own)). `ssh root@<ip> fc-node status` should say `companion: running on port 3390`.
- An **app account** on the node, set up with `ssh -t root@<ip> fc-node app-account`. Its name is what people approve on their phone, and it becomes your copy's name. See [Share your node](./share-your-node#_1-choose-an-app-account) for choosing one.
- Ports 80 and 443 open. Command 0's firewall already opens them, for [images](./images).

## Turn it on

```bash
ssh root@<ip> fc-node client
```

It takes a minute. It downloads fameboy, runs it in a container on the server, and gives it an https address:

```
fameboy is hosted at https://fameboyteal.91-99-76-223.sslip.io
```

The first visit can take a few seconds while the server gets its certificate.

- `fc-node status` shows the address.
- Run `fc-node client` again to update fameboy. Running command 1 again updates it too.
- `fc-node client off` stops hosting it.

## Your copy's name and address

Every copy of fameboy is named after its app account. If the app account is `@fameboyteal`:

- People approve "@fameboyteal" on their phone, and their casts show "via @fameboyteal".
- The address is `https://fameboyteal.<your ip with dashes>.sslip.io`. sslip.io is a free service that points that name at your IP, so you don't need a domain.
- The pages take its colour: teal, in four shades, like a Game Boy Color screen. Any `@fameboy<color>` from fameboy's colour list works. Any other name keeps the default clear look.

### Your own domain

Point an A record for the domain at your server's IP with your DNS provider, wait a few minutes, then:

```bash
ssh root@<ip> fc-node client fameboy.example.com
```

It checks the domain points at your server before it switches. The A record must be **DNS only** (on Cloudflare, the grey cloud), or the server can't get its certificate. fameboy then answers at that domain only: the sslip.io address stops working. `fc-node client sslip` goes back to the sslip.io address.

## Without a node of your own

Hosting fameboy doesn't need a node on the same server. A small server can run fameboy, the companion and image hosting, and read from a public node, for about $7.80 a month instead of $105 ([Costs](../Costs#without-a-node)). demo.createfc.org runs this way, reading from Hypersnap's public node, which follows the same network as Farcaster's own.

Create the server. `NO_NODE=1` makes a cx23 with no volume, and opens only the ports this needs:

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner.sh | NO_NODE=1 bash
```

A minute after it boots, set it up against the public node. It takes a couple of minutes, with no snapshot or sync:

```bash
ssh root@<ip> 'curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/node/setup.sh | NODE=https://haatz.quilibrium.com bash'
```

The server remembers the node in `/etc/fc-node.conf`, so running command 1 again later needs no `NODE`. Then set up the app account and `fc-node client` as on a full node.

- **Port 3381 passes everything on.** Caddy answers `http://<ip>:3381` by passing each request to the public node. fameboy, the companion and `fc-node` keep using it as if the node were there, and so can fameboy installs on other computers.
- **`fc-node status` shows the public node:** its shards, whether it's behind, and whether port 3381 reaches it.
- **To change nodes,** run command 1 again with another `NODE`. Farcaster's own `https://crackle.farcaster.xyz:3381` has the same data.
- **That node's operator sees every read:** which accounts and casts the people using your copy look at. Your server is the only one that sees who they are.

### Moving to a new server and keeping the address

To move a copy between servers without changing its address, which is what demo.createfc.org did:

1. Copy the companion's state off, without the app account's custody key: `rsync -a --exclude app-account.json root@<ip>:/var/lib/fc-companion/ ~/fc-companion-backup/`
2. Delete the old server and keep its IP: `hetzner-delete.sh --keep-ip`.
3. Create the new one on that IP with `PRIMARY_IPV4=<its id>` on command 0, and run command 1.
4. Copy the state back with `rsync -a ~/fc-companion-backup/ root@<ip>:/var/lib/fc-companion/`, then run command 1 again so the companion owns the files.
5. Set up the app account again with `ssh -t root@<ip> fc-node app-account`, in your own terminal, then `fc-node client`.

Uploaded images, invite codes and DNS records keep working, because the address is the same.

## Who can sign in

Anyone, by default. People open the address and pick a way in:

- **Approve on your phone:** scan a code and approve in the Farcaster app. Needs the app account.
- **Use your seed phrase:** type it on the page. The page signs a new key in their browser, and the phrase never reaches your server ([ADR 006](https://github.com/eucalyptus-viminalis/create-fc/blob/main/docs/adr/006-hosted-seed-phrase-sign-in.md)). For people without the Farcaster app. It works without an app account too.

To limit it to people you invite:

```bash
ssh root@<ip> fc-node signin invite
```

Then make a code for each person with `fc-node invite <name>`, as in [Share your node](./share-your-node#_3-choose-who-can-sign-in). Both ways in need the code then. `fc-node signin open` lets anyone in again. People already signed in stay signed in either way.

To offer phone sign-in only:

```bash
ssh root@<ip> fc-node signin phrase off
```

`fc-node signin phrase on` brings seed phrase sign-in back.

Open sign-in can't cost you money or touch anyone's account. Its risk is your app's reputation: every cast made through a phone sign-in says "via" your app account, so a spammer signing in would put your app's name on their spam. If that happens, switch to invite-only. Casts from a seed phrase sign-in say "via" the person's own account instead.

## What people trust you with

fameboy is built so a hosted copy holds as little as possible ([ADR 003](https://github.com/eucalyptus-viminalis/create-fc/blob/main/docs/adr/003-hosted-clearcast.md)).

| | |
| --- | --- |
| **Their key** | Stays in their browser. Their browser makes it, and it can't be copied out, even by the page. Your server only ever sees the public half. Every cast, like and follow is signed in their browser. |
| **Their seed phrase** | Only if they choose seed phrase sign-in, or change their username on the **me** page. It stays in their browser: the page uses it to sign, then forgets it. Your server sees only their account's address and the signatures. |
| **Their cleared and saved casts, last visit** | Stay in their browser too. Your server keeps nothing about the people who use it. |
| **Who's online** | The companion sees each device's address and when it checks in, in memory only, forgotten 90 seconds after it leaves. |
| **Their reads** | Come from your node, or the public node your server passes them on to. If it's down or behind, so is their feed, and a public node's operator sees what they read. |
| **The page itself** | This is the real trust: they run the code your server sends. Someone who controls your server could change that code. That's true of every web app, the Farcaster app's website included. It matters most for seed phrase sign-in: changed code could steal the phrase, and with it the account. The page warns them before they type it. |

If your server is broken into, the intruder gets your app account (its custody key lives on the server) but no one's key. They could change the page for people who visit after that, so keep the server patched and the root login to your SSH key.

## What it's like for them

- **Signing in:** scan, approve, done. Their phone may ask them to pay a small onchain fee for the approval. Or type their seed phrase: no fee, and no Farcaster app needed. The account needs storage, as every account that has cast does.
- **One key per browser:** a laptop and a phone each sign in once, and each has its own key.
- **Signing out:** **sign out** deletes the key from that browser. The key stays valid on Farcaster until they remove it from their connected apps in the Farcaster app, or it goes unused for 30 days (seed phrase sign-in only).
- **Their cleared and saved casts are per browser.** Clearing a cast on a laptop doesn't clear it on a phone.
- **Browsers:** recent Chrome, Safari or Firefox. Older ones can't make the key and say so.

## If something's wrong

- **The address doesn't load:** check ports 80 and 443 are open (`hcloud firewall describe fc-node-fw`), then `docker logs fc-images` for certificate errors.
- **The address shows a 502 error:** fameboy itself isn't running. Check `docker logs fc-fameboy`, then run `fc-node client` to restart it.
- **"Phone sign-in is off":** set up an app account with `ssh -t root@<ip> fc-node app-account`.
- **The address still has the old name** after you changed the app account: run `fc-node client` again. The address is chosen when it runs.

## Learn more

- [Your app key](./app-key): what the key in each browser can and can't do.
- [Share your node](./share-your-node): app accounts, invite codes and what friends see of each other.
- [Signer requests](https://docs.farcaster.xyz/reference/farcaster/signer-requests): how an app asks a person to approve its key.
