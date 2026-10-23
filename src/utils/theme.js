/**
 * Tema: converte `theme.overrides` (config/site.config.js) em CSS.
 *
 * O CSS é servido em /css/theme.css (e não inline) porque a CSP do site
 * proíbe `style` inline. Os valores já foram validados como #RRGGBB pelo
 * schema Zod em src/config/site.js, então é seguro interpolá-los aqui.
 */

const VAR_MAP = {
  accent: '--color-accent',
  accentStrong: '--color-accent-strong',
  background: '--color-bg',
  surface: '--color-surface',
  text: '--color-text',
  textMuted: '--color-text-muted',
};

const PRESET_THEME_COLOR = { noir: '#14100d', terra: '#120c09', creme: '#f6f0e6' };
const DARK_TEXT = '#0b0908';
const LIGHT_TEXT = '#f9f4ec';

export function hasThemeOverrides(theme = {}) {
  const o = theme.overrides ?? {};
  return Object.keys(VAR_MAP).some((key) => Boolean(o[key]));
}

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

const contrastRatio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Escolhe texto claro ou escuro, o que tiver mais contraste sobre a cor. */
export function readableOn(hex) {
  return contrastRatio(hex, DARK_TEXT) >= contrastRatio(hex, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
}

export function buildThemeCss(theme = {}) {
  if (!hasThemeOverrides(theme)) return '/* sem personalizações de tema */\n';

  const o = theme.overrides ?? {};
  const preset = theme.preset ?? 'noir';
  const isLight = preset === 'creme';
  const decl = [];

  for (const [key, cssVar] of Object.entries(VAR_MAP)) {
    if (o[key]) decl.push(`${cssVar}: ${o[key]};`);
  }

  if (o.accent) {
    decl.push(`--color-accent-Contrast: ${readableOn(o.accent)};`);
    if (!o.accentStrong) {
      decl.push(
        `--color-accent-strong: color-mix(in srgb, ${o.accent}, ${isLight ? 'black' : 'white'} 18%);`,
      );
    }
    if (!isLight) {
      decl.push(`--color-border: color-mix(in srgb, ${o.accent} 20%, transparent);`);
      decl.push(`--color-border-strong: color-mix(in srgb, ${o.accent} 45%, transparent);`);
    }
  }

  // html[data-theme='x'] vence a especificidade dos presets em tokens.css.
  // Vale só para o preset configurado: se alguém trocar de tema no modo
  // demonstração, a paleta do preset escolhido aparece normalmente.
  return `html[data-theme='${preset}'] {\n  ${decl.join('\n  ')}\n}\n`;
}

const PRESET_ACCENT = { noir: '#d4a26a', terra: '#d08152', creme: '#9a6836' };

/** Cor de destaque da marca (manifesto do app instalado na tela inicial). */
export function accentColor(theme = {}) {
  return theme.overrides?.accent ?? PRESET_ACCENT[theme.preset ?? 'noir'];
}

/** Cor da barra do navegador no celular (<meta name="theme-color">). */
export function themeColor(theme = {}) {
  return theme.overrides?.background ?? PRESET_THEME_COLOR[theme.preset ?? 'noir'];
}
