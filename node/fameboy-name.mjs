// Names for a copy of fameboy (ADR 004). Each copy is named after its app
// account, and setup suggests @fameboy<color> with a random colour that's
// still free on the fname server, e.g. @fameboyteal. A copy named that way
// takes its colour's look (themeFor); any other name keeps the clear theme.
//
// Shared by fameboy (on your computer), fc-node app-account and the hosted
// fameboy (on the server), so it has no dependencies.
//
// Every colour is one lowercase word of at most 9 letters, so fameboy<color>
// fits the 16-character fname limit. Each has the hex value its theme uses.

export const PALETTE = {
  red: "#d7263d", blue: "#2563eb", green: "#2e9e44", yellow: "#f2c200", orange: "#f57c1f",
  purple: "#7b3fe4", pink: "#ef5da8", brown: "#8b5a2b", black: "#1b1b1b", white: "#f7f7f2",
  gray: "#8a8a8a", silver: "#b8bcc2", gold: "#d4a017", amber: "#ffb000", apricot: "#fbb67a",
  aqua: "#00c4cc", ash: "#b2beb5", auburn: "#a52a2a", avocado: "#568203", azure: "#2f8fff",
  beige: "#e3d5b8", berry: "#990f4b", bisque: "#ffe4c4", blond: "#f0dc82", blush: "#de5d83",
  bone: "#e3dac9", bordeaux: "#5c0120", brass: "#b5a642", brick: "#b03a2e", bronze: "#cd7f32",
  buff: "#f0dc82", burgundy: "#800020", butter: "#fff1a8", cadet: "#5f9ea0", camel: "#c19a6b",
  canary: "#ffef00", candy: "#e4405f", capri: "#00bfff", caramel: "#c68e17", cardinal: "#c41e3a",
  carmine: "#960018", carnation: "#ffa6c9", carrot: "#ed9121", cedar: "#a0522d", celadon: "#ace1af",
  celeste: "#b2ffff", cerise: "#de3163", cerulean: "#007ba7", chalk: "#ede8d0", champagne: "#f7e7ce",
  charcoal: "#36454f", cherry: "#d2042d", chestnut: "#954535", chili: "#c21807", cinder: "#4a4a4a",
  cinnabar: "#e34234", cinnamon: "#d2691e", citrine: "#e4d00a", citron: "#9fa91f", claret: "#7f1734",
  clay: "#b66a50", clover: "#3eb489", cobalt: "#0047ab", cocoa: "#7b3f00", coffee: "#6f4e37",
  copper: "#b87333", coral: "#ff7f50", cornsilk: "#fff8dc", cotton: "#f5f5f0", cranberry: "#9f000f",
  cream: "#fffdd0", crimson: "#dc143c", cyan: "#00b7eb", daffodil: "#ffff31", dandelion: "#f0e130",
  denim: "#1560bd", desert: "#c19a6b", dove: "#6d6c6c", dusk: "#4e5180", ebony: "#555d50",
  ecru: "#c2b280", eggplant: "#614051", eggshell: "#f0ead6", emerald: "#50c878", fawn: "#e5aa70",
  fern: "#4f7942", flame: "#e25822", flax: "#eedc82", flamingo: "#fc8eac", forest: "#228b22",
  fuchsia: "#c72cc7", garnet: "#733635", ginger: "#b06500", glacier: "#78b1bf", grape: "#6f2da8",
  graphite: "#383838", grass: "#5fa83a", gunmetal: "#2a3439", harvest: "#da9100", hazel: "#8e7618",
  heather: "#a297a8", henna: "#a63d1f", honey: "#eba937", honeydew: "#c9f2c7", hunter: "#355e3b",
  ice: "#a5f2f3", indigo: "#4b0082", iris: "#5a4fcf", ivory: "#fffff0", jade: "#00a86b",
  jasmine: "#f8de7e", jasper: "#d05340", jet: "#343434", jonquil: "#f4ca16", juniper: "#3a6b5b",
  kelly: "#4cbb17", khaki: "#c3b091", kiwi: "#8ee53f", lagoon: "#3aa8b8", lapis: "#26619c",
  latte: "#c5a582", lava: "#cf1020", lavender: "#9f88d9", lemon: "#fff44f", lilac: "#c8a2c8",
  lime: "#7fdb1f", linen: "#faf0e6", lobster: "#e05a47", lotus: "#e0a3c4", magenta: "#e0218a",
  mahogany: "#c04000", maize: "#fbec5d", malachite: "#0bda51", mandarin: "#f37a48", mango: "#fdbe02",
  maroon: "#800000", mauve: "#b784a7", meadow: "#68b04c", melon: "#febaad", midnight: "#191970",
  mint: "#3eb489", mocha: "#967969", moss: "#8a9a5b", mulberry: "#c54b8c", mustard: "#e1ad01",
  navy: "#1f2f6b", nectarine: "#ff8656", neon: "#39ff14", nickel: "#727472", ocean: "#0077be",
  ochre: "#cc7722", olive: "#808000", onyx: "#353839", opal: "#a8c3bc", orchid: "#da70d6",
  oyster: "#dad4c8", papaya: "#ffa36b", paprika: "#c33b2b", parchment: "#f1e9d2", peach: "#ffb07c",
  peacock: "#33a1a1", pear: "#d1e231", pearl: "#eae0c8", pebble: "#a8a39d", peony: "#e56b9b",
  pepper: "#5b5b5b", persimmon: "#ec5800", pewter: "#8e9294", pine: "#01796f", pistachio: "#93c572",
  platinum: "#e5e4e2", plum: "#8e4585", poppy: "#e35335", porcelain: "#eef0ed", powder: "#b0e0e6",
  primrose: "#edea99", prune: "#701c1c", puce: "#cc8899", pumpkin: "#ff7518", quartz: "#d9d3e0",
  raisin: "#3c2a35", raspberry: "#e30b5c", raven: "#3b3b45", rose: "#ff4f79", rosewood: "#65000b",
  ruby: "#e0115f", russet: "#80461b", rust: "#b7410e", saffron: "#f4c430", sage: "#9caf88",
  salmon: "#fa8072", sand: "#c2b280", sangria: "#92000a", sapphire: "#0f52ba", scarlet: "#ff2400",
  seafoam: "#71eeb8", sepia: "#704214", shamrock: "#009e60", shell: "#fff5ee", sienna: "#a0522d",
  sky: "#5ab4f0", slate: "#6a7b8c", smoke: "#848884", snow: "#fffafa", spruce: "#2f5d50",
  steel: "#4682b4", storm: "#4f666a", straw: "#e4d96f", sunflower: "#ffc512", sunset: "#fa8c5a",
  tan: "#d2b48c", tangerine: "#f28500", taupe: "#8b8589", tawny: "#cd5700", teal: "#008080",
  thistle: "#d8bfd8", tiger: "#fc6c1c", timber: "#8b6d4f", titanium: "#878681", tomato: "#ff6347",
  topaz: "#ffc87c", tulip: "#ff878d", turquoise: "#30d5c8", tuscan: "#c09a6b", umber: "#635147",
  vanilla: "#f3e5ab", velvet: "#750851", verdigris: "#43b3ae", vermilion: "#e34234", violet: "#8f00ff",
  viridian: "#40826d", walnut: "#773f1a", wheat: "#f5deb3", wine: "#722f37", wisteria: "#c9a0dc",
  zinc: "#7d7f7d", almond: "#efdecd", amethyst: "#9966cc", aubergine: "#3d0734", banana: "#ffe135",
  basil: "#579229", beet: "#7d2248", biscuit: "#e3c08d", bluebell: "#a2a2d0", blueberry: "#4f86f7",
  bubblegum: "#ffc1cc", cactus: "#5b6f55", cameo: "#efbbcc", canvas: "#e8dcc4", cardamom: "#aaac6c",
  cashew: "#e4c590", celery: "#b4c424", cement: "#9a9a96", cider: "#b5651d", citrus: "#f3b61f",
  cloud: "#c7d3dc", coal: "#2b2b2b", coconut: "#965a3e", cola: "#3c2415", concrete: "#95a5a6",
  cork: "#a9805f", crocus: "#9b7fd8", cucumber: "#77ab56", cumin: "#924321", currant: "#5e0a26",
  cypress: "#4b6857", daisy: "#fed85d", damson: "#5c3a6b", driftwood: "#a67f5d", dune: "#d4b483",
  eclipse: "#3f3939", elm: "#297b76", espresso: "#4b3621", evergreen: "#05472a", fig: "#6b3f5c",
  fir: "#3a5f0b", flint: "#6f6a61", fog: "#d7d0c4", frost: "#e1f1f7", fudge: "#5c3317",
  gardenia: "#f5f2e3", geranium: "#da3d58", granite: "#676767", guava: "#e86b77", holly: "#2f6b3a",
  hyacinth: "#7c6ec5", iceberg: "#71a6d2", inkwell: "#31363b", jam: "#a01d47", kelp: "#4d5b2b",
  larch: "#82a35a", laurel: "#a9ba9d", leather: "#966a46", leaf: "#71aa34", licorice: "#1a1110",
  lichen: "#8fb38c", lily: "#c8a2c8", limestone: "#d8d2c2", lychee: "#ff8b8b", magnolia: "#f8f4ff",
  mallow: "#c890b8", maple: "#c35831", marigold: "#eaa221", marble: "#d6d4ce", marina: "#4f84c4",
  marine: "#042e60", marmalade: "#e2702e", matcha: "#88a454", merlot: "#73343a", mercury: "#ebebeb",
  mist: "#c4d2d8", molasses: "#3a2111", moon: "#e6e6cf", moonstone: "#3aa8c1", mud: "#70543e",
  mushroom: "#c3b5a3", myrtle: "#21421e", nutmeg: "#81422c", oak: "#b8864b", oat: "#dfc9a3",
  oatmeal: "#d6c7a9", obsidian: "#3c3b3d", olivine: "#9ab973", paper: "#f2efe6", parsley: "#305d02",
  pastel: "#aec6cf", pecan: "#8a4d33", petal: "#f5c3c2", petrol: "#005f6a", pigeon: "#8f9aa5",
  pinecone: "#6b4e3a", pinot: "#5d2b39", plaster: "#e8e2d5", pollen: "#e9d66b", port: "#68162d",
  pumice: "#c2cac4", quince: "#d6b85a", rain: "#7a8fa5", redwood: "#a45a52", reef: "#00a0a0",
  rhubarb: "#c3394f", river: "#3f7fbf", rosemary: "#405d4a", rouge: "#a94064", rum: "#795548",
  sable: "#6e403c", saddle: "#8b4513", sakura: "#ffb7c5", sandstone: "#c7a77b", satin: "#e4c8c8",
  seashell: "#fff5ee", seaweed: "#35553a", sesame: "#d9c5a0", shadow: "#8a795d", shale: "#4a5859",
  sherbet: "#f7a8a8", sherry: "#7e3a2d", shiitake: "#8b6b4a", smoky: "#605b56", soot: "#2e2b2a",
  sorbet: "#ff9b85", sorrel: "#9b5f3e", spice: "#a0522d", sprout: "#a2c579", squash: "#f2ab15",
  stone: "#928e85", sugar: "#f6f1ea", sulfur: "#e8e337", sumac: "#8f2d3c", sun: "#ffcc33",
  sunrise: "#ff9e5e", syrup: "#b85c19", taffy: "#f7a6c4", tamarind: "#5b3a29", tar: "#262626",
  tea: "#d0f0c0", thyme: "#7b8b6f", toast: "#c4925a", toffee: "#8e5b3a", truffle: "#5b4033",
  tundra: "#8a9a9a", turmeric: "#e3a21a", twilight: "#4e518b", vine: "#5a7d3a", wasabi: "#a8c256",
  wax: "#ede0b6", willow: "#9bb08a", wood: "#855e42", yam: "#d0743c", yolk: "#f6c324",
  zucchini: "#4a6b2f", acorn: "#9a6b3e", agate: "#7d8f9b", algae: "#54ac68", alpine: "#5e8c84",
  amaranth: "#e52b50", ambrosia: "#f5d6a8", arctic: "#82cfe6", aurora: "#45d6a3", autumn: "#c26a2d",
  bamboo: "#7ba05b", barley: "#d9c39a", basalt: "#4c4a48", beeswax: "#e9d7ab", begonia: "#fa6e79",
  birch: "#d8cbb0", bramble: "#5e3a5a", brine: "#2e6e7e", buckwheat: "#9b7d5a", cabernet: "#6a1b31",
  calypso: "#3d7188", camellia: "#f6745f", canyon: "#b5653a", carbon: "#333333", carob: "#5c4033",
  cashmere: "#d1b399", chai: "#c08a5b", chamomile: "#e8d28a", coriander: "#bdc29a", cosmos: "#f2aaaa",
  crystal: "#a7d8de", custard: "#fddc8a", dahlia: "#c94f7c", dawn: "#f7c59f", dew: "#c5e8d2",
  dust: "#b0a191", earth: "#8a6a4a", ember: "#e2552d", feather: "#d9d2c6", fennel: "#9db36c",
  fire: "#e8432d", fleece: "#efe8dc", flora: "#73c2a8", foam: "#d4f1e8", galaxy: "#2a2f6b",
  gem: "#2f8f83", goldenrod: "#daa520", gorse: "#f5d533", gourd: "#d0893a", harbor: "#3b6e8f",
  haze: "#c8c3d1", hemlock: "#5e7a5a", herb: "#5f8f3a", hickory: "#8b5e3c", horizon: "#5f8ea8",
  ivy: "#3e7d3e", jelly: "#d9418c", jewel: "#136843", kumquat: "#f39c33", lemonade: "#f8e88b",
  mangrove: "#4c6b4a", marsala: "#964f4c", mimosa: "#f0c05a", nebula: "#6d5fc0", nougat: "#b69477",
  pesto: "#7d8c2a", petunia: "#a63d9a", rainbow: "#e8467c", rattan: "#c8a46a", reed: "#a3a65a",
  salt: "#f3f1ec", sapling: "#7fb04a", sequoia: "#8c4a3c", spearmint: "#45b08c", sunshine: "#fff200",
  tide: "#3c8dad", velour: "#5b2a4a", yarrow: "#e6d38a", ruddy: "#ff0028", mistletoe: "#6f9d4b",
};

export const COLORS = Object.keys(PALETTE);
export const PREFIX = "fameboy";

/** The colour a name was given: "fameboyteal" -> { color: "teal", hex: "#008080" }, else undefined. */
export function colorOf(name) {
  const n = String(name ?? "").toLowerCase().replace(/^@/, "");
  if (!n.startsWith(PREFIX)) return undefined;
  const color = n.slice(PREFIX.length);
  return Object.hasOwn(PALETTE, color) ? { color, hex: PALETTE[color] } : undefined;
}

const FNAMES = "https://fnames.farcaster.xyz";
const FNAME = /^[a-z0-9][a-z0-9-]{0,15}$/;

/** Who holds `name` on the fname server: "free", "yours" (held by `fid`) or "taken". */
export async function nameHolder(name, fid) {
  if (!FNAME.test(name)) throw new Error(`"${name}" isn't a valid fname: 1-16 characters, lowercase letters, digits and hyphens, not starting with a hyphen`);
  const res = await fetch(`${FNAMES}/transfers/current?name=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return "free";
  if (!res.ok) throw new Error(`fname server: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { transfer } = await res.json();
  if (!transfer || transfer.to === 0) return "free";
  return transfer.to === fid ? "yours" : "taken";
}

/**
 * Pick random colours until @fameboy<color> is free (or already this fid's),
 * and say in `log` each time one is taken. Returns the name, or undefined if
 * the fname server can't be reached or every colour it tried was taken.
 */
export async function pickFameboyName({ fid, log = () => {}, tries = 40 } = {}) {
  const pool = [...COLORS];
  for (let i = 0; i < tries && pool.length; i++) {
    const color = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const name = `${PREFIX}${color}`;
    let holder;
    try {
      holder = await nameHolder(name, fid);
    } catch (e) {
      log(`couldn't check @${name} on the fname server (${e.message}).`);
      return undefined;
    }
    if (holder !== "taken") return name;
    log(`@${name} is taken, picking another colour...`);
  }
  return undefined;
}
