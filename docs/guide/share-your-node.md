# Share your node with friends

One node can serve more than you. Friends point clearcast at your node, sign in by approving on their phone, and show up under **on this node** on each other's home screens.

This page covers the one-time setup on your server, what it puts at risk, and what your friends do.

## What you need

- A node from [commands 0 and 1](https://eucalyptus-viminalis.github.io/create-fc/#quickstart), in sync.
- Its companion running. `ssh root@<ip> fc-node status` should end with `companion: running on port 3390`. If it doesn't, run command 1 again.
- A Farcaster account to be your node's **app account** (below). If you don't have a spare one, `clearcast new-account` registers one for about $0.20 of ETH on Optimism.

## 1. Choose an app account

When someone connects an app to their Farcaster account, the Farcaster app shows them which app is asking. That app is itself a Farcaster account, and it vouches for the request by signing it with its custody key. Farcaster's docs explain this in [Signer requests](https://docs.farcaster.xyz/reference/farcaster/signer-requests).

On your node, that account is the app account. Here's what it can and can't do:

| Can the app account… | |
| --- | --- |
| Ask people to approve a key for clearcast | Yes. They still approve on their own phone. |
| Post as anyone who signs in, or touch their account | No. Their key is made and kept on their own computer. |
| Survive your server being broken into | No. Its custody key lives on the server, so an intruder would control the app account itself: post as it, or transfer it away. |

So pick an account you'd be fine losing:

- **Good:** an account made for this, named so friends recognise it. For example `@yourname-clearcast`, with "clearcast" as its display name.
- **Not good:** your main account, or a brand account with followers you care about.

## 2. Save it on your server

In your own terminal:

```bash
ssh -t root@<ip> fc-node app-account
```

It asks for the account's seed phrase without showing it, finds the account on your node, and saves only the custody key. The phrase isn't written anywhere. The key goes to `/var/lib/fc-companion/app-account.json`, which only the companion can read.

- `fc-node app-account show` says which account is set up.
- `fc-node app-account remove` turns phone sign-in off.
- Running `fc-node app-account` again switches to another account.

Never paste a seed phrase into a chat, an issue, or an AI assistant. Type it only at this prompt.

## 3. Give each friend an invite code

```bash
ssh root@<ip> fc-node invite alice
```

That prints a code like `K7Q2-X9MP`. Send it to Alice. She types it once when she signs in, and clearcast remembers it.

- `fc-node invite list` shows every code, when you made it and the note.
- `fc-node invite revoke K7Q2-X9MP` stops a code working. Anyone who already signed in with it stays signed in.

### Why codes?

The companion listens on port 3390, which is open to the internet. Without codes, anyone who found it could start sign-ins in your app account's name. Here's what that would and wouldn't mean:

- **It can't cost you anything.** If approving costs a fee, each person pays their own.
- **It can't touch anyone's account.** Each person approves on their own phone, for their own account.
- **It doesn't open your node any further.** Port 3381 is already public, so anyone can read from your node either way.
- **But your app's name goes on their posts.** Every cast made with a key your app account vouched for is recorded as coming from your app. clearcast's "apps in your feed" shows it, and so can other clients. If a spammer signed in through your node, their spam would carry your app's name, and Farcaster could start treating your app account as spammy.

Codes keep that to people you chose. On top of that, each internet address gets 20 sign-in tries an hour, which also stops anyone guessing codes.

## 4. Your friend signs in

On their own computer:

1. Install clearcast pointed at your node:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/client/install.sh | bash -s -- http://<ip>:3381
   ```
2. Run `clearcast ui`. The sign-in page opens.
3. Choose **approve on your phone** and type the invite code.
4. Scan the code with their phone and approve in the Farcaster app. It may ask them to pay a small onchain fee.

Their new key is made on their computer. Only its public half goes to your server, so you never hold anything that can post as them.

## What friends see of each other

- **Who's online.** The home screen's **on this node** tile lists everyone using the node right now, and says if they're a mutual, follow you, or you follow them. Only people currently using the node can see that list. Anyone can press **O** to appear offline.
- **Everything else is public anyway.** Casts, likes and follows live on Farcaster, where any node can read them.

## What friends trust you with

Sharing your node means friends rely on it:

- **Their reads.** clearcast reads everything from your node. If it's down or behind, so is their feed.
- **When they're online.** The companion sees each device's internet address and when it checks in. It keeps that in memory only, and forgets a device 90 seconds after it leaves.
- **Not their account.** You can't post as them, and neither could anyone who broke into your server. Their key never leaves their computer.
- **Their images.** Images they attach to casts live on your node, up to 500 MB each. If you delete the server, those images stop loading in their casts too. See [Images in your casts](./images).

## Learn more

- [Accounts](https://docs.farcaster.xyz/learn/what-is-farcaster/accounts): fids, custody addresses and account keys.
- [Apps](https://docs.farcaster.xyz/learn/what-is-farcaster/apps): wallet apps that own an account, and connected apps that hold a key.
- [Signer requests](https://docs.farcaster.xyz/reference/farcaster/signer-requests): how an app asks a person to approve its key.
- [Snapchain](https://snapchain.farcaster.xyz/): the network your node is part of.
