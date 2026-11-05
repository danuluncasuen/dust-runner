// Every color the game draws is a name here with one value per time of day. Draw calls pass
// palette indices, and the shader blends between two keyframes, so a sunset recolors
// everything for free, with nothing re-rendered during play.

export const KEYFRAMES = ['NOON', 'SUNSET', 'DUSK', 'NIGHT', 'DAWN'] as const;

type Row = readonly [noon: string, sunset: string, dusk: string, night: string, dawn: string];
const same = (c: string): Row => [c, c, c, c, c];

// NOON is sampled from art-brainstorm/concept.jpg; DUSK is the blue Martian sunset. SUNSET sits
// between NOON and DUSK because a straight blend from tan to blue passes through grey.
const COLORS = {
  void: same('#05080F'), // letterbox and clear color; keep in sync with index.html
  skyTop: ['#28454B', '#2A2F4A', '#0E182C', '#05080F', '#1C2A40'],
  skyMid: ['#6F8F8A', '#9A6070', '#2C4A6C', '#0D1824', '#6E6C80'],
  skyHz: ['#F3DBAA', '#F8B67A', '#A8CCDC', '#22343C', '#F4CDA2'],
  sun: ['#FFF4DA', '#FFE2B0', '#EAF6FF', '#22343C', '#FFEACC'],
  star: same('#F2EEE6'),
  hill: ['#AF8A5E', '#A06A5A', '#5E6272', '#262C34', '#9C7C6C'],
  mesa: ['#B85407', '#963E12', '#4E2618', '#22120E', '#9E4A1E'],
  mesaSh: ['#9C4706', '#7A3010', '#3E1E14', '#1A0E0B', '#843C18'],
  plain: ['#EF9F60', '#E07E44', '#8E4E32', '#3A2018', '#E48E54'],
  plain2: ['#EC8A3E', '#CF6A34', '#7E422A', '#331C15', '#D27C44'],
  plain3: ['#E48238', '#C2602E', '#743C26', '#2E1913', '#C8723E'],
  shadow: ['#A57D54', '#7E4A3A', '#3A2A30', '#170C0A', '#8A5C4A'],
  rock: ['#D4743A', '#B85A2C', '#6E3A24', '#2E1A14', '#C26A38'],
  rockSh: ['#A8521C', '#8E4020', '#55301E', '#22120E', '#9A4E26'],
  craterIn: ['#D27838', '#B2582A', '#673622', '#2A1712', '#B8642F'],
  craterRim: ['#F6B57A', '#EE9A5C', '#A06044', '#4A2A20', '#F0A672'],
  sample: ['#3FA39A', '#4F98A4', '#6FB8CC', '#5FC8D0', '#4FA8A8'],
  sampleHi: ['#BFF2E8', '#D0F0F0', '#E0F8FF', '#E0FFFF', '#D0F4EC'],
  cell: ['#FFE07A', '#FFD07A', '#F0E8A0', '#FFE890', '#FFE08A'],
  cellHi: same('#FFFFFF'),
  rover: ['#F6F1EC', '#F6E2D4', '#C8CCD6', '#7E8492', '#F2E6DC'],
  roverSh: ['#CFC4BA', '#C0A090', '#8A8C9A', '#545866', '#BCA89A'],
  roverDk: ['#3A2E2A', '#3A2626', '#1E1A22', '#0E0C12', '#2E2428'],
  roverHi: ['#FFFFFF', '#FFF2E8', '#E0E6F0', '#9AA0AE', '#FFF6EE'],
  lamp: same('#FFF2C8'),
  hud: ['#FFF8EE', '#FFF2E6', '#E8F0F8', '#D8DEE8', '#FFF6EE'],
  danger: ['#C8301E', '#E0523A', '#F06A50', '#F06A50', '#D84830'],
} satisfies Record<string, Row>;

export type ColorName = keyof typeof COLORS;
const NAMES = Object.keys(COLORS) as ColorName[];

// Palette index of every named color: C.plain, C.skyTop, ...
export const C = Object.fromEntries(NAMES.map((n, i) => [n, i])) as Record<ColorName, number>;

export const PALETTE_SIZE = 256; // texture width; indices must stay below this
if (NAMES.length > PALETTE_SIZE) throw new Error('palette has more than 256 colors');

// RGBA rows, one per keyframe, for the palette texture.
export function paletteData(): Uint8Array {
  const data = new Uint8Array(PALETTE_SIZE * KEYFRAMES.length * 4);
  NAMES.forEach((name, i) => {
    COLORS[name].forEach((hex, row) => {
      const o = (row * PALETTE_SIZE + i) * 4;
      data[o] = parseInt(hex.slice(1, 3), 16);
      data[o + 1] = parseInt(hex.slice(3, 5), 16);
      data[o + 2] = parseInt(hex.slice(5, 7), 16);
      data[o + 3] = 255;
    });
  });
  return data;
}

// The letterbox clear color, as GL floats (it never changes with the time of day).
export function voidColor(): [number, number, number] {
  const hex = COLORS.void[0];
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}
