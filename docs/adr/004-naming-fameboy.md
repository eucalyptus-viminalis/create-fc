# ADR 004: Names: create-fc, fc-node, fameboy, and a name for each copy

## Status

**accepted** (2026-10-23).

## Context

The project grew three names on day one, and a fourth came later:

- **create-fc**: the repo, the site and the three commands.
- **fc-node**: the tool on the server (`fc-node status`, `invite`, `client`, …), plus the `fc-` names of what runs there (`fc-companion`, `fc-images`).
- **clearcast**: the client. First called `fc`, then `fcli` because `fc` is a shell builtin.
- **@\<color\>cast**: the username suggested for an app account. People approving a sign-in see this name, and casts show "via" it.

ADR 003 makes the client something anyone can host for other people. So each hosted copy needs a name of its own: it's what people approve on their phone, what their casts show "via", and the address they visit. The app account's username already is that name, so the client's own name should be the family name every copy shares.

`@colorcast` and `@fameboy` are taken on Farcaster. `@fameboyclear` and `@fameboy<color>` are free.

## Decision

| What | Name |
| --- | --- |
| The kit: repo, site, the three commands | **create-fc** |
| The server, and its tool | **fc-node** (server, firewall, `fc-node …`), with `fc-companion`, `fc-images`, `fc-fameboy` running on it |
| The client software | **fameboy**: Farcaster plus Game Boy. The `fameboy` CLI, `~/.fameboy`, the `fameboy` package |
| Each copy someone runs or hosts | its app account's username. Setup suggests **@fameboy\<color\>** with a random free colour, e.g. `@fameboyteal` |
| The project's own hosted copy | **@fameboyclear** |

**Each copy's look follows its name.** If the app account's username is `fameboy<color>` with a colour from the list, that copy takes the colour: the logo, the accent colour, the favicon, and the name in the page title and header. Any other name keeps the default **clear** theme. So a copy off the shelf looks a little different from every other one, with no design work.

- The colour list (`node/fameboy-name.mjs`) gives each colour a hex value. Only colours whose `fameboy<color>` fits the 16-character fname limit are offered.
- A hosted copy's default address is `<name>.<ip with dashes>.sslip.io`, e.g. `fameboyteal.91-99-76-223.sslip.io`.
- Strings the companion checks inside signatures (`clearcast-presence:v1`, `clearcast-image:v1`, …) and the `x-clearcast-client` header keep their names. Nobody sees them, and renaming them would break presence and images between a new client and an older node.

## Consequences

- One name per copy, everywhere a person meets it: the phone approval, "via" on casts, the address, the page title.
- Searching `@fameboy` on Farcaster finds an unrelated, dormant account. Copies are found by their own names, so this matters little.
- "fameboy" nods at Nintendo's Game Boy. Keep the look a nod (pixel type, a handheld feel) rather than a copy of Game Boy artwork or logos.
- Nobody has installed the client yet, so there's no `clearcast` alias and no migration of `~/.fc-client`.
- ADR 003 still says "clearcast"; read it as fameboy.

## Provenance

| Date | Commit | Change |
| --- | --- | --- |
| 2026-10-23 | (this commit) | Created, status accepted |
