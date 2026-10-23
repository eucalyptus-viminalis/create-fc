# Host fameboy for others

Most people will never run their own client. With one command, your node can host fameboy for them: they open a web address, approve on their phone, and use Farcaster through your node. Nothing to install.

This page covers turning it on, the address it gets, who can sign in, and what the people using it trust you with.

## What you need

- A node from [commands 0 and 1](https://createfc.org/quickstart/), in sync, with its companion running. `ssh root@<ip> fc-node status` should say `companion: running on port 3390`.
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
ssh root@<ip> fc-node client clearcast.example.com
```

It checks the domain points at your server before it switches. `fc-node client sslip` goes back to the sslip.io address.

## Who can sign in

Anyone, by default. People open the address, scan a code with their phone and approve in the Farcaster app. To limit it to people you invite:

```bash
ssh root@<ip> fc-node signin invite
```

Then make a code for each person with `fc-node invite <name>`, as in [Share your node](./share-your-node#_3-choose-who-can-sign-in). `fc-node signin open` lets anyone in again. People already signed in stay signed in either way.

Open sign-in can't cost you money or touch anyone's account. Its risk is your app's reputation: every cast made through your copy says "via" your app account, so a spammer signing in would put your app's name on their spam. If that happens, switch to invite-only.

## What people trust you with

fameboy is built so a hosted copy holds as little as possible ([ADR 003](https://github.com/eucalyptus-viminalis/create-fc/blob/main/docs/adr/003-hosted-clearcast.md)).

| | |
| --- | --- |
| **Their key** | Stays in their browser. Their browser makes it, and it can't be copied out, even by the page. Your server only ever sees the public half. Every cast, like and follow is signed in their browser. |
| **Their seed phrase** | Never asked for. A hosted copy has no seed phrase sign-in at all. |
| **Their cleared and saved casts, last visit** | Stay in their browser too. Your server keeps nothing about the people who use it. |
| **Who's online** | The companion sees each device's address and when it checks in, in memory only, forgotten 90 seconds after it leaves. |
| **Their reads** | Come from your node. If it's down or behind, so is their feed. |
| **The page itself** | This is the real trust: they run the code your server sends. Someone who controls your server could change that code. That's true of every web app, the Farcaster app's website included. |

If your server is broken into, the intruder gets your app account (its custody key lives on the server) but no one's key. They could change the page for people who visit after that, so keep the server patched and the root login to your SSH key.

## What it's like for them

- **Signing in:** scan, approve, done. Their phone may ask them to pay a small onchain fee for the approval.
- **One key per browser:** a laptop and a phone each sign in once, and each has its own key.
- **Signing out:** **sign out** deletes the key from that browser. A key approved on a phone stays valid on Farcaster until they remove it from their connected apps in the Farcaster app.
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
