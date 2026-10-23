// Recorded sounds for the clipboard dock, used by every document that copies something.
// Sources and licences: sounds/CREDITS.md.
const at = f => new URL('../sounds/' + f, import.meta.url).href;
dock.use({
  fly: { src: at('paper-flight.wav'), volume: 0.9 },    // the copy rustling through the air
  clip: { src: at('clipboard-snap.wav'), volume: 1 },   // the clip clamping it onto the board
});
