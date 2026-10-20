# Images in your casts

A cast can't carry an image. It carries a link, and every app loads the image from that link. So when you attach an image in clearcast, it uploads to **your own node**, and your cast links to it there. No image host, no account, no API key.

## How it works

1. You paste, drop or pick an image in **post**. Big photos are shrunk to 1600 px on the long side, on your computer, before they go anywhere. GIFs stay as they are, so they keep moving.
2. clearcast uploads it to your node's companion, signed with your [app key](./app-key). The companion checks that the file really is a PNG, JPEG, GIF or WebP image, and saves it under its fingerprint (a SHA-256 hash).
3. Your node serves it over HTTPS, at an address like `https://91-99-76-223.sslip.io/img/<fingerprint>.jpg`. [sslip.io](https://sslip.io) is a free service that turns that name into your server's address, which lets Caddy, the web server on your node, get a certificate without a domain of your own.
4. Your cast links to that address. Other Farcaster apps load the image from your node.

## The limits

| Limit | Default | Why |
| --- | --- | --- |
| Per image | 5 MB | Shrunk photos land well under this. |
| Per person | 500 MB | Keeps a shared node fair. About 1,000–2,500 shrunk photos. |
| The whole node | 10 GB | Leaves plenty of the server's main disk free. |

The post page shows how much of your 500 MB you've used, and how full the node is. If you remove an image before you cast, its space comes back. Uploading the same image twice only counts once.

Images live on the server's main disk, not the volume Snapchain uses, so they never compete with the node's database.

### Changing the limits

If you run the node, you can change them. Write them in megabytes to `/var/lib/fc-companion/limits.json` on the server:

```bash
ssh root@<ip> 'echo "{\"perPersonMB\": 1000, \"totalMB\": 20480, \"perFileMB\": 8}" > /var/lib/fc-companion/limits.json'
```

The companion reads the file on every upload, so there's nothing to restart. Leave a field out to keep its default. Lowering a limit doesn't delete anything; it only stops new uploads past it.

To see what's stored and who uploaded it, look at the ledger:

```bash
ssh root@<ip> 'cat /var/lib/fc-companion/ledger/images.json'
```

## Who can upload

Only people using your node: the companion accepts an upload only from someone whose clearcast has checked in during the last 10 minutes, signed with an app key that Farcaster says belongs to them. Each internet address also gets 120 uploads an hour.

Anyone with an image's link can see it. That's true of every image on Farcaster, because casts are public.

## Images live as long as your server

Your casts link to your node, so the images are only there while it runs.

- **Deleting the server breaks them.** The quickstart suggests deleting the server to stop billing. If you do, every image in your past casts stops loading, and a new server gets a new address.
- **A server that's down shows broken images** until it's back.
- **Removing a cast doesn't remove its images.** They stay on your node, and in your image space, until you delete them from the server.

If your images need to outlast the server, attach them through a public image host instead, and paste the link into your cast.

## Ports

Your node's firewall needs TCP 80 and 443 open. 443 serves the images; 80 is how Caddy gets and renews its certificate. Command 0 opens both for new servers. For a server made before images existed:

```bash
hcloud firewall add-rule fc-node-fw --direction in --protocol tcp --port 80 --source-ips 0.0.0.0/0 --source-ips ::/0 --description "tcp/80"
hcloud firewall add-rule fc-node-fw --direction in --protocol tcp --port 443 --source-ips 0.0.0.0/0 --source-ips ::/0 --description "tcp/443"
```

Then run command 1 again to install the image server.

## If images don't show

- **The post page says your node doesn't host images yet.** Run command 1 again on the server.
- **Uploads work, but the images don't load.** Check that ports 80 and 443 are open, then look at Caddy's log: `ssh root@<ip> docker logs fc-images`. A certificate problem shows up there.
