// How a resident is told apart: a hood colour and a cloak colour. One colour
// alone runs out at about a dozen residents; with eight colours and the hood
// never the same as the cloak there are 56 pairs, and a pair still reads on a
// figure a dozen pixels tall.

/** The eight cloak colours, picked to stay apart on cream paper and under lamplight. */
export const COLOURS = [
  0xc8442f, // brick red
  0x2f6fb0, // blue
  0xd79a1e, // ochre
  0x3f8f5a, // green
  0x7d4fa3, // purple
  0x3fb0b0, // teal, lighter than before so it stays apart from the blue
  0xd27f95, // rose: faces are drawn in the paper's cream, so no hood is cream
  0x6b4f33, // umber: a dark soot hood would vanish into the night paper
] as const;

/**
 * The same eight as hoods. Blue and ochre are a little greyer, so that a blue
 * hood on a red cloak or an ochre hood on a blue one sits quietly in the ink.
 */
export const HOODS = COLOURS.map((colour) =>
  colour === 0x2f6fb0 ? 0x3e70a2 : colour === 0xd79a1e ? 0xc49331 : colour,
);

/** How far round the eight the hood sits from the cloak, one offset per round of eight residents. */
const HOOD_OFFSETS = [1, 4, 7, 2, 5, 3, 6] as const;

export const PAIRS = COLOURS.length * HOOD_OFFSETS.length;

export interface Identity {
  readonly hood: string;
  readonly cloak: string;
}

const hex = (colour: number): string => `#${colour.toString(16).padStart(6, "0")}`;

/**
 * The colours of the resident with this id. The first six keep the cloaks
 * they have always had. No two of the first 56 share a pair.
 */
export function identity(id: number): Identity {
  const index = Math.max(0, Math.floor(id) - 1) % PAIRS;
  const cloak = index % COLOURS.length;
  const round = Math.floor(index / COLOURS.length);
  const hood = (cloak + (HOOD_OFFSETS[round] as number)) % COLOURS.length;
  return { hood: hex(HOODS[hood] as number), cloak: hex(COLOURS[cloak] as number) };
}
