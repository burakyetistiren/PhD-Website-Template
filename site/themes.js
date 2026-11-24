/**
 * Site themes. Each theme is a set of colors, typefaces, corner shapes and one or two
 * signature details, defined in site/assets/themes.css under :root[data-style="<id>"].
 * Every theme has a light and a dark palette, so the light/dark setting keeps working.
 *
 * To add a theme: add an entry here (it appears in Site settings automatically) and a
 * matching block in themes.css. Preview any theme on any page with ?theme=<id>.
 */
export const THEMES = {
  paper: {
    label: 'Paper',
    description: 'Cool paper, ultramarine links, serif text',
    fonts: 'family=Familjen+Grotesk:wght@400..700&family=Fragment+Mono&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..650;1,8..60,400..500',
    favicon: { bg: '#2346d8', fg: '#ffffff' },
  },
  blueprint: {
    label: 'Blueprint',
    description: 'Engineering-drawing blue, a faint grid, monospace headings',
    fonts: 'family=Azeret+Mono:wght@400..700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400',
    favicon: { bg: '#123b6b', fg: '#ffffff' },
  },
  swiss: {
    label: 'Swiss',
    description: 'Black, white and signal red, a bold grotesk, square corners',
    fonts: 'family=Archivo:wdth,wght@62..125,400..900&family=Fragment+Mono',
    favicon: { bg: '#e30613', fg: '#ffffff' },
  },
  riso: {
    label: 'Riso',
    description: 'Risograph print: blue ink, fluorescent pink, paper grain',
    fonts: 'family=Young+Serif&family=Instrument+Sans:wght@400..700&family=Fragment+Mono',
    favicon: { bg: '#213a8f', fg: '#ff9fd0' },
  },
  midnight: {
    label: 'Midnight',
    description: 'Deep navy, amber accents, elegant serifs, a faint starfield',
    fonts: 'family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Crimson+Pro:ital,wght@0,400..700;1,400..600&family=Fragment+Mono',
    favicon: { bg: '#0c1124', fg: '#f2b65e' },
  },
  garden: {
    label: 'Garden',
    description: 'Sage and leaf green, soft corners, bookish serifs',
    fonts: 'family=Gloock&family=Literata:ital,opsz,wght@0,7..72,400..600;1,7..72,400&family=Fragment+Mono',
    favicon: { bg: '#2f7a47', fg: '#ffffff' },
  },
};

export const DEFAULT_THEME = 'paper';

export const themeIds = () => Object.keys(THEMES);

/** The theme to render: a valid preview (?theme=) wins, then the saved setting, then Paper. */
export function resolveTheme(saved, preview) {
  if (preview && THEMES[preview]) return preview;
  if (saved && THEMES[saved]) return saved;
  return DEFAULT_THEME;
}

export const themeFontsUrl = (id) => `https://fonts.googleapis.com/css2?${THEMES[id].fonts}&display=swap`;
