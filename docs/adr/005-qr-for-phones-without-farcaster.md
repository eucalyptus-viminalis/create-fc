# ADR 005: Sign-in QR codes work on phones without the Farcaster app

## Status

**accepted** (2026-10-25).

## Context

Phone sign-in shows a QR code. It held Farcaster's own link, `farcaster://signed-key-request?token=…`. Only the Farcaster app can open a `farcaster://` link. On a phone without the app, the camera has nothing to open it with: the iPhone camera just says "No usable data found". People trying the hosted demo hit this and had no idea what to do next.

Hosted fameboy is meant for people who don't run anything themselves (ADR 003). Many of them won't have the Farcaster app yet.

## Decision

Account for people who don't have the Farcaster app installed.

On a hosted fameboy, the QR code opens a web page on that copy: `https://<copy>/approve#<token>`. The page has an **open Farcaster** button with the `farcaster://` link, plus App Store and Google Play links for anyone without the app.

- The token goes in the `#fragment`, so it never reaches a server log.
- The page only accepts a token and builds the `farcaster://` link itself, so the page can't be used to send people to some other address.
- The page doesn't open the app on its own. On iPhone, Safari shows an "address is invalid" error when the app is missing.

`fameboy ui` on your own computer keeps the `farcaster://` QR code. A phone can't reach a page on 127.0.0.1.

## Consequences

- With the app installed, it takes one more tap than before: scan, then tap open Farcaster.
- Without the app, people get a next step instead of a dead end.
- The local QR code still dead-ends without the app. A page on createfc.org could serve both, at the cost of every copy depending on createfc.org.

## Provenance

| Date | Commit | Change |
| --- | --- | --- |
| 2026-10-25 | | Created, status accepted |
