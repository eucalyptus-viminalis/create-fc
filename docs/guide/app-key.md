# Your app key

When you sign in, fameboy saves an **app key** on your computer. It's what lets fameboy post, like and follow as you, without ever keeping your seed phrase.

## What it is

An app key is a key your Farcaster account has approved for one app. Every Farcaster app you use has its own, and your account can have many. Farcaster's docs call these [connected apps](https://docs.farcaster.xyz/learn/what-is-farcaster/apps).

Your **seed phrase** is different: it controls the account itself. fameboy only needs it for a moment, if you sign in with it, to approve a new app key. Then it forgets it.

## What it can and can't do

| Your app key can | Your app key can't |
| --- | --- |
| Post and delete casts | Move or transfer your account |
| Like and recast | Change who owns your account |
| Follow and unfollow | Approve other apps |
| Change your profile: name, picture, bio | Spend money |

Anything it does can be undone from the app that owns your account, such as the Farcaster app.

## It works with any node

The key is approved by Farcaster, not by your node. Your node only carries messages to and from the network. If you pointed fameboy at a different node, the same key would still post as you.

## Where it's kept

In `~/.fameboy/appkey.json` on your computer, readable only by your user account. It never goes to your node or anywhere else. Only the public half is shared, and that's public by design.

Anyone who copies that file can post as you until the key is removed. Treat it like a password.

## How long it lasts

- **Approved on your phone:** until you remove it.
- **Signed in with your seed phrase:** 30 days. After that, sign in again.

## Signing out, and removing it

There are two different things you might want:

- **Sign out of this computer:** **sign out** on the home screen, or `fameboy logout`. This deletes the file. The key itself still exists on Farcaster.
- **Remove the key from Farcaster:** so it can never post again, even from a copy.
  - Signed in with your seed phrase: run `fameboy revoke`. It removes the key, then signs you out.
  - Approved on your phone: remove fameboy from your connected apps in the Farcaster app's settings.

## Learn more

- [Apps](https://docs.farcaster.xyz/learn/what-is-farcaster/apps): wallet apps that own an account, and connected apps that hold a key.
- [Accounts](https://docs.farcaster.xyz/learn/what-is-farcaster/accounts): fids, custody addresses and account keys.
