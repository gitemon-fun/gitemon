/**
 * v14.1: every third-party file Gitemon ships, with its source and licence (shown on /credits).
 * Only CC0 files (and OFL fonts, which allow bundling with their licence) may live in this public repo;
 * anything else stays in the private art repo.
 */
export interface Credit {
  file: string;
  what: string;
  author: string;
  source: string;
  license: string;
}

const CC0 = 'CC0 1.0 (public domain)';
const OFL = 'SIL Open Font License 1.1';

export const CREDITS: Credit[] = [
  {
    file: 'env/sky-overcast-256.hdr',
    what: 'Kloofendal Overcast (Pure Sky) HDRI, made smaller: the light on the 3D pieces',
    author: 'Greg Zaal, Poly Haven',
    source: 'https://polyhaven.com/a/kloofendal_overcast_puresky',
    license: CC0,
  },
  {
    file: 'audio/waves.ogg',
    what: 'Ocean Waves (a 24-second loop)',
    author: 'Noted451, Freesound',
    source: 'https://freesound.org/s/531015/',
    license: CC0,
  },
  {
    file: 'audio/wind.ogg',
    what: 'Rocky Mountain Outdoors: wind and birds (a 24-second loop)',
    author: 'petebuchwald, Freesound',
    source: 'https://freesound.org/s/288899/',
    license: CC0,
  },
  {
    file: 'audio/birds.ogg',
    what: 'Early summer, Czech wood, early morning ambiance (a 24-second loop)',
    author: 'J.Zazvurek, Freesound',
    source: 'https://freesound.org/s/353311/',
    license: CC0,
  },
  {
    file: 'audio/jungle.ogg',
    what: 'Sound of Jungle (a 24-second loop)',
    author: 'kajoo, Freesound',
    source: 'https://freesound.org/s/628939/',
    license: CC0,
  },
  {
    file: 'audio/frogs.ogg',
    what: 'Frogs and Crickets, excerpt B (a 24-second loop)',
    author: 'greysound, Freesound',
    source: 'https://freesound.org/s/32655/',
    license: CC0,
  },
  {
    file: 'audio/catch.ogg',
    what: 'impactGeneric_light_002 (Impact Sounds) + confirmation_002 (Interface Sounds), mixed',
    author: 'Kenney',
    source: 'https://kenney.nl/assets/impact-sounds and https://kenney.nl/assets/interface-sounds',
    license: CC0,
  },
  {
    file: 'audio/paper.ogg',
    what: 'bookFlip2 (RPG Audio), quieter: the sound of a panel opening',
    author: 'Kenney',
    source: 'https://kenney.nl/assets/rpg-audio',
    license: CC0,
  },
  {
    file: 'fonts/pixelify-sans.woff2',
    what: 'Pixelify Sans, latin letters only: titles and buttons',
    author: 'The Pixelify Sans Project Authors (Stefie Justprince)',
    source: 'https://github.com/eifetx/Pixelify-Sans',
    license: OFL,
  },
  {
    file: 'fonts/nunito.woff2',
    what: 'Nunito, latin letters only: all reading text',
    author: 'The Nunito Project Authors (Vernon Adams, Cyreal, Jacques Le Bailly)',
    source: 'https://github.com/googlefonts/nunito',
    license: OFL,
  },
  {
    file: 'fonts/OFL-pixelify-sans.txt',
    what: 'The licence that ships with Pixelify Sans',
    author: 'SIL International',
    source: 'https://openfontlicense.org',
    license: OFL,
  },
  {
    file: 'fonts/OFL-nunito.txt',
    what: 'The licence that ships with Nunito',
    author: 'SIL International',
    source: 'https://openfontlicense.org',
    license: OFL,
  },
  {
    file: 'models/props.glb',
    what: 'Street props: barrels, crates, sacks, a bucket, a wheelbarrow, market tents, lumber and wooden fences',
    author: 'Kay Lousberg (KayKit Medieval Hexagon Pack 1.0)',
    source: 'https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0',
    license: CC0,
  },
];
