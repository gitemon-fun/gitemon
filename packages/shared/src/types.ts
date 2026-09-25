/** Public GitHub data for one developer, as fetched. Never contains private-repo data. */
export interface Snapshot {
  v: 1;
  userId: number;
  login: string;
  name: string | null;
  createdAt: string;
  isBot: boolean;
  followers: number;
  /** Public repos the developer owns, top 100 by stars. */
  repos: { name: string; stars: number; lang: string | null; fork: boolean }[];
  /** Last 12 months, from contributionsCollection. */
  contrib: {
    commits: number;
    prs: number;
    reviews: number;
    issues: number;
    /** GitHub's anonymous private-contribution count; 0 unless the developer turned it on. */
    restricted: number;
    /** Weeks (of the last 52) with at least one contribution. */
    activeWeeks: number;
  };
  /** Lifetime PRs merged into repos the developer does not own. */
  mergedToOthers: { count: number; langs: Record<string, number>; owners: string[] };
  fetchedAt: string;
  /** Free-text public GitHub location, as written. */
  location?: string | null;
  /**
   * Hometown parsed from `location` by the trusted fetcher (V2-D6). Absent when the snapshot was
   * made somewhere without the lookup (the stored hometown is then kept as it is).
   */
  home?: { cc: string; city: string | null } | null;
}

export const TYPES = [
  'forge',
  'iron',
  'serpent',
  'spark',
  'prism',
  'tide',
  'frost',
  'garnet',
  'moss',
  'wing',
  'rune',
  'shade',
  'bloom',
  'coral',
  'quill',
  'stone',
  'wild',
  'machine',
] as const;
export type TypeId = (typeof TYPES)[number];

export const SHAPES = ['builder', 'reviewer', 'maintainer', 'steady', 'polyglot'] as const;
export type Shape = (typeof SHAPES)[number];

export interface Stats {
  might: number;
  insight: number;
  renown: number;
  grit: number;
  range: number;
}

/** Output of the scorer. Pure function of (snapshot, scorer version). */
export interface Score {
  scorerVersion: number;
  stats: Stats;
  level: number;
  type1: TypeId;
  type2: TypeId | null;
  shape: Shape;
  form: 1 | 2 | 3;
  shiny: boolean;
  machine: boolean;
  /** Higher = more likely to stay visible when zoomed out. */
  notable: number;
}

/** What the map needs to draw one Gitemon. Also enough to compose its sprite. */
export interface MapGitemon {
  id: number;
  login: string;
  x: number;
  y: number;
  t1: TypeId;
  t2: TypeId | null;
  sh: Shape;
  f: 1 | 2 | 3;
  s: 0 | 1;
  lv: number;
  /** 'w' wild, 'c' claimed */
  st: 'w' | 'c';
  /** 1 when a friendship buff is active */
  a: 0 | 1;
}

export interface TypeInfo {
  id: TypeId;
  name: string;
  biome: string;
  langs: string[];
  /** ground colour for the biome, and the creature palette seed colours */
  ground: string;
  colors: [string, string, string];
}

export const TYPE_INFO: Record<TypeId, TypeInfo> = {
  forge: {
    id: 'forge',
    name: 'Forge',
    biome: 'Magma Fields',
    langs: ['Rust', 'Zig'],
    ground: '#3a2622',
    colors: ['#e0612f', '#f2a541', '#7a2b1c'],
  },
  iron: {
    id: 'iron',
    name: 'Iron',
    biome: 'Iron Foundry',
    langs: ['C', 'C++', 'Assembly', 'Cuda', 'Objective-C++'],
    ground: '#34383d',
    colors: ['#8d99a6', '#c9d1d9', '#4a525b'],
  },
  serpent: {
    id: 'serpent',
    name: 'Serpent',
    biome: 'Viper Jungle',
    langs: ['Python', 'Jupyter Notebook', 'Cython'],
    ground: '#1f3324',
    colors: ['#3f9b5a', '#f2d24b', '#1e5130'],
  },
  spark: {
    id: 'spark',
    name: 'Spark',
    biome: 'Storm Plains',
    langs: ['JavaScript', 'CoffeeScript'],
    ground: '#3a3620',
    colors: ['#f2d024', '#fff3a8', '#8a6d10'],
  },
  prism: {
    id: 'prism',
    name: 'Prism',
    biome: 'Crystal Highlands',
    langs: ['TypeScript'],
    ground: '#1f2b3d',
    colors: ['#3b7de0', '#9cc3ff', '#1d3f78'],
  },
  tide: {
    id: 'tide',
    name: 'Tide',
    biome: 'Gopher Bay',
    langs: ['Go'],
    ground: '#17323a',
    colors: ['#2fb3c9', '#a8ecf5', '#146170'],
  },
  frost: {
    id: 'frost',
    name: 'Frost',
    biome: 'Frost Tundra',
    langs: ['Java', 'Kotlin', 'Scala', 'Groovy', 'Clojure'],
    ground: '#2c3440',
    colors: ['#bfe3f2', '#ffffff', '#5b89a6'],
  },
  garnet: {
    id: 'garnet',
    name: 'Garnet',
    biome: 'Ruby Canyon',
    langs: ['Ruby', 'Elixir', 'Crystal', 'Erlang'],
    ground: '#3a1f28',
    colors: ['#c93a5a', '#f28aa0', '#6e1a2f'],
  },
  moss: {
    id: 'moss',
    name: 'Moss',
    biome: 'Miasma Marsh',
    langs: ['PHP', 'Hack', 'Blade'],
    ground: '#2a2f3d',
    colors: ['#7a86c9', '#c3c9ef', '#3b4378'],
  },
  wing: {
    id: 'wing',
    name: 'Wing',
    biome: 'Swift Cliffs',
    langs: ['Swift', 'Objective-C', 'Dart'],
    ground: '#3a2c20',
    colors: ['#f08a3c', '#ffd2a8', '#8a4412'],
  },
  rune: {
    id: 'rune',
    name: 'Rune',
    biome: 'Arcane Peaks',
    langs: [
      'Haskell',
      'OCaml',
      'F#',
      'Elm',
      'Common Lisp',
      'Scheme',
      'Racket',
      'PureScript',
      'Idris',
      'Agda',
      'Lean',
      'Coq',
    ],
    ground: '#2a2138',
    colors: ['#9b5de5', '#d6b8ff', '#4b2a7a'],
  },
  shade: {
    id: 'shade',
    name: 'Shade',
    biome: 'Shadow Caves',
    langs: [
      'Shell',
      'PowerShell',
      'Nix',
      'Dockerfile',
      'Makefile',
      'HCL',
      'Vim Script',
      'Emacs Lisp',
      'Lua',
    ],
    ground: '#1c1f24',
    colors: ['#5c6470', '#9aa3ad', '#23272e'],
  },
  bloom: {
    id: 'bloom',
    name: 'Bloom',
    biome: 'Blossom Gardens',
    langs: ['HTML', 'CSS', 'SCSS', 'Vue', 'Svelte', 'Astro', 'Less'],
    ground: '#33223a',
    colors: ['#e55ea8', '#ffc2e2', '#7a2358'],
  },
  coral: {
    id: 'coral',
    name: 'Coral',
    biome: 'Sharp Reef',
    langs: ['C#', 'Visual Basic .NET', 'F*'],
    ground: '#1f3530',
    colors: ['#3fc9a0', '#b3f5e0', '#16705a'],
  },
  quill: {
    id: 'quill',
    name: 'Quill',
    biome: 'Scroll Archive',
    langs: ['Markdown', 'TeX', 'MDX', 'reStructuredText'],
    ground: '#35301f',
    colors: ['#d9c38a', '#fff4d1', '#7a6530'],
  },
  stone: {
    id: 'stone',
    name: 'Stone',
    biome: 'Data Quarry',
    langs: ['SQL', 'R', 'Julia', 'MATLAB', 'PLpgSQL', 'TSQL', 'Fortran'],
    ground: '#302a24',
    colors: ['#a67c52', '#e0c3a0', '#5a3f24'],
  },
  wild: {
    id: 'wild',
    name: 'Wild',
    biome: 'Common Meadow',
    langs: [],
    ground: '#26331f',
    colors: ['#8fbf5a', '#d8f0b0', '#46662a'],
  },
  machine: {
    id: 'machine',
    name: 'Machine',
    biome: 'Machine Wastes',
    langs: [],
    ground: '#202226',
    colors: ['#6e7680', '#b8f24b', '#2f343a'],
  },
};

const LANG_TO_TYPE = new Map<string, TypeId>();
for (const t of TYPES) for (const l of TYPE_INFO[t].langs) LANG_TO_TYPE.set(l.toLowerCase(), t);

export function typeForLanguage(lang: string | null | undefined): TypeId {
  if (!lang) return 'wild';
  return LANG_TO_TYPE.get(lang.toLowerCase()) ?? 'wild';
}

export const SHAPE_NAME: Record<Shape, string> = {
  builder: 'Builder',
  reviewer: 'Reviewer',
  maintainer: 'Maintainer',
  steady: 'Steady',
  polyglot: 'Polyglot',
};

export const STAT_MEANING: Record<keyof Stats, string> = {
  might: 'Pull requests merged into other people’s repos',
  insight: 'Code reviews given in the last year',
  renown: 'Stars other people gave to their repos',
  grit: 'Weeks with any activity in the last year',
  range: 'Languages with confirmed work',
};
