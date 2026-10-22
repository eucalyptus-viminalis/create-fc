// Suggest a username for an app account: @<color>cast, with a random color
// that's still free on the fname server. Shared by clearcast (on your computer)
// and fc-node app-account (on the server), so it has no dependencies.
//
// Every color is one lowercase word of at most 12 letters, so <color>cast fits
// the 16-character fname limit.

export const COLORS = [
  "red", "blue", "green", "yellow", "orange", "purple", "pink", "brown", "black", "white", "gray",
  "grey", "silver", "gold", "amber", "apricot", "aqua", "aquamarine", "ash", "auburn", "avocado",
  "azure", "beige", "berry", "bisque", "bistre", "blond", "blush", "bone", "bordeaux", "brass",
  "brick", "bronze", "buff", "burgundy", "butter", "cadet", "camel", "canary", "candy", "capri",
  "caramel", "cardinal", "carmine", "carnation", "carrot", "cedar", "celadon", "celeste", "cerise",
  "cerulean", "chalk", "champagne", "charcoal", "chartreuse", "cherry", "chestnut", "chili",
  "chocolate", "cinder", "cinnabar", "cinnamon", "citrine", "citron", "claret", "clay", "clover",
  "cobalt", "cocoa", "coffee", "copper", "coral", "cornflower", "cornsilk", "cotton", "cranberry",
  "cream", "crimson", "cyan", "daffodil", "dandelion", "denim", "desert", "dove", "dusk", "ebony",
  "ecru", "eggplant", "eggshell", "emerald", "fawn", "fern", "flame", "flax", "flamingo", "forest",
  "fuchsia", "garnet", "ginger", "glacier", "grape", "graphite", "grass", "gunmetal", "harvest",
  "hazel", "heather", "henna", "honey", "honeydew", "hunter", "ice", "indigo", "iris", "ivory",
  "jade", "jasmine", "jasper", "jet", "jonquil", "juniper", "kelly", "khaki", "kiwi", "lagoon",
  "lapis", "latte", "lava", "lavender", "lemon", "lilac", "lime", "linen", "lobster", "lotus",
  "magenta", "mahogany", "maize", "malachite", "mandarin", "mango", "maroon", "mauve", "meadow",
  "melon", "midnight", "mint", "mocha", "moss", "mulberry", "mustard", "navy", "nectarine", "neon",
  "nickel", "ocean", "ochre", "olive", "onyx", "opal", "orchid", "oyster", "papaya", "paprika",
  "parchment", "peach", "peacock", "pear", "pearl", "pebble", "peony", "pepper", "periwinkle",
  "persimmon", "pewter", "pine", "pistachio", "platinum", "plum", "poppy", "porcelain", "powder",
  "primrose", "prune", "puce", "pumpkin", "quartz", "raisin", "raspberry", "raven", "rose",
  "rosewood", "ruby", "russet", "rust", "saffron", "sage", "salmon", "sand", "sangria", "sapphire",
  "scarlet", "seafoam", "sepia", "shamrock", "shell", "sienna", "sky", "slate", "smoke", "snow",
  "spruce", "steel", "storm", "straw", "strawberry", "sunflower", "sunset", "tan", "tangerine",
  "taupe", "tawny", "teal", "terracotta", "thistle", "tiger", "timber", "titanium", "tomato",
  "topaz", "tulip", "turquoise", "tuscan", "ultramarine", "umber", "vanilla", "velvet",
  "verdigris", "vermilion", "violet", "viridian", "walnut", "watermelon", "wheat", "wine",
  "wisteria", "zinc", "almond", "alabaster", "amethyst", "anise", "aubergine", "banana", "basil",
  "beet", "biscuit", "blackberry", "blueberry", "bluebell", "bronzite", "bubblegum", "burlap",
  "butterscotch", "cactus", "cameo", "canvas", "cappuccino", "cardamom", "cashew", "celery",
  "cement", "cherrywood", "chiffon", "cider", "citrus", "cloud", "coal", "cobblestone", "coconut",
  "cola", "concrete", "cork", "cornmeal", "crocus", "cucumber", "cumin", "currant", "cypress",
  "daisy", "damson", "driftwood", "dune", "dusty", "eclipse", "elderberry", "elm", "espresso",
  "eucalyptus", "evergreen", "fig", "firebrick", "fir", "flint", "fog", "frost", "fudge",
  "gardenia", "geranium", "granite", "grapefruit", "gravel", "guava", "heliotrope", "hibiscus",
  "holly", "hyacinth", "iceberg", "inkwell", "jam", "kelp", "larch", "laurel", "leather", "leaf",
  "licorice", "lichen", "lily", "limestone", "lingonberry", "lychee", "magnolia", "mallow",
  "maple", "marigold", "marble", "marina", "marine", "marmalade", "matcha", "merlot", "mercury",
  "mist", "molasses", "moon", "moonstone", "mud", "mushroom", "myrtle", "nutmeg", "oak", "oat",
  "oatmeal", "obsidian", "olivine", "paper", "parsley", "pastel", "pecan", "peppermint", "petal",
  "petrol", "pigeon", "pinecone", "pinot", "plaster", "pollen", "pomegranate", "port", "pumice",
  "quince", "rain", "redwood", "reef", "rhubarb", "river", "rosemary", "rouge", "rum", "sable",
  "saddle", "sakura", "sandalwood", "sandstone", "satin", "seashell", "seaweed", "sesame",
  "shadow", "shale", "sherbet", "sherry", "shiitake", "smoky", "soot", "sorbet", "sorrel", "spice",
  "sprout", "squash", "stone", "sugar", "sulfur", "sumac", "sun", "sunrise", "syrup", "taffy",
  "tamarind", "tar", "tea", "thyme", "toast", "toffee", "truffle", "tundra", "turmeric",
  "twilight", "vine", "wasabi", "wax", "willow", "wintergreen", "wood", "yam", "yolk", "zucchini",
  "acorn", "agate", "algae", "alpine", "amaranth", "ambrosia", "arctic", "aurora", "autumn",
  "bamboo", "barley", "basalt", "beeswax", "begonia", "birch", "bramble", "brine", "buckwheat",
  "cabernet", "calypso", "camellia", "canyon", "carbon", "carob", "cashmere", "chai", "chamomile",
  "clementine", "coriander", "cosmos", "crystal", "custard", "dahlia", "dawn", "dew",
  "dragonfruit", "dust", "earth", "ember", "feather", "fennel", "fire", "fleece", "flora", "foam",
  "galaxy", "gem", "gingerbread", "goldenrod", "gooseberry", "gorse", "gourd", "harbor", "haze",
  "hemlock", "herb", "hickory", "horizon", "huckleberry", "ivy", "jelly", "jewel", "kumquat",
  "lemonade", "mangrove", "marsala", "mimosa", "nebula", "nougat", "pesto", "petunia", "rainbow",
  "rattan", "reed", "salt", "sapling", "sequoia", "spearmint", "sunshine", "tide", "velour",
  "wildflower", "yarrow", "ruddy", "lemongrass", "mistletoe",];

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
 * Pick random colors until @<color>cast is free (or already this fid's), and
 * say in `log` each time one is taken. Returns the name, or undefined if the
 * fname server can't be reached or every color it tried was taken.
 */
export async function pickColorcast({ fid, log = () => {}, tries = 40 } = {}) {
  const pool = [...COLORS];
  for (let i = 0; i < tries && pool.length; i++) {
    const color = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const name = `${color}cast`;
    let holder;
    try {
      holder = await nameHolder(name, fid);
    } catch (e) {
      log(`couldn't check @${name} on the fname server (${e.message}).`);
      return undefined;
    }
    if (holder !== "taken") return name;
    log(`@${name} is taken, picking another color...`);
  }
  return undefined;
}
