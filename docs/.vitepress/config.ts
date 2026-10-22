import { defineConfig } from "vitepress";

// The create-fc docs. Published with the microsite by .github/workflows/pages.yml:
// built into site/docs/, served at https://eucalyptus-viminalis.github.io/create-fc/docs/.
// For protocol concepts, link to Farcaster's own docs rather than re-explaining them.
const REPO = "https://github.com/eucalyptus-viminalis/create-fc";

export default defineConfig({
  title: "create-fc docs",
  description: "Run your own Farcaster: a Snapchain node and the clearcast client, explained.",
  base: "/create-fc/docs/",
  outDir: "../site/docs",
  cleanUrls: true,
  // Developer notes live here too but aren't for readers.
  srcExclude: ["adr/**", "quality-attributes.md"],
  head: [["link", { rel: "icon", href: "/create-fc/docs/favicon.svg", type: "image/svg+xml" }]],
  themeConfig: {
    logo: { light: "/create-fc-mark.svg", dark: "/create-fc-mark-white.svg", alt: "" },
    nav: [
      { text: "Guides", link: "/guide/share-your-node" },
      { text: "Costs", link: "/Costs" },
      { text: "create-fc", link: "https://eucalyptus-viminalis.github.io/create-fc/" },
    ],
    sidebar: [
      { text: "Guides", items: [{ text: "Share your node with friends", link: "/guide/share-your-node" }, { text: "Images in your casts", link: "/guide/images" }] },
      { text: "Explainers", items: [{ text: "Your app key", link: "/guide/app-key" }] },
      { text: "Reference", items: [{ text: "Costs", link: "/Costs" }] },
      {
        text: "Farcaster's docs",
        items: [
          { text: "Accounts", link: "https://docs.farcaster.xyz/learn/what-is-farcaster/accounts" },
          { text: "Apps and app keys", link: "https://docs.farcaster.xyz/learn/what-is-farcaster/apps" },
          { text: "Signer requests", link: "https://docs.farcaster.xyz/reference/farcaster/signer-requests" },
          { text: "Snapchain", link: "https://snapchain.farcaster.xyz/" },
        ],
      },
    ],
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: REPO }],
    editLink: { pattern: `${REPO}/edit/main/docs/:path`, text: "Edit this page on GitHub" },
    outline: [2, 3],
  },
});
