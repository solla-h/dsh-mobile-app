/**
 * 色板对比度回归（WCAG 2.1）：正文/次要/弱化文字对每种纸面都要 ≥ 4.5:1。
 *
 * 纯函数测试，不挂 React。曾经的回归点：
 * - PAPER text.muted #8C8A84 on surface = 2.80
 * - EINK text.muted #75736B on surface = 2.87
 * - EINK text.secondary #9A978E on elevatedAnswer = 4.48
 */
import {
  EINK_SLATE,
  LIVE_CAMERA_FG,
  LIVE_CAMERA_SCRIM,
  PAPER,
  type Palette,
} from '../tokens';

type Rgb = [number, number, number];

interface ParsedColor {
  rgb: Rgb;
  alpha: number;
}

function parseColor(value: string): ParsedColor {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1];
    return {
      rgb: [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16) / 255) as Rgb,
      alpha: 1,
    };
  }
  const rgba = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((part) => Number.parseFloat(part.trim()));
    return {
      rgb: [parts[0] / 255, parts[1] / 255, parts[2] / 255],
      alpha: parts[3] ?? 1,
    };
  }
  throw new Error(`无法解析颜色: ${value}`);
}

/** 把可能带透明度的前景叠到实底背景上，得到实际观感色。 */
function composite(foreground: string, background: string): Rgb {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  return fg.rgb.map((channel, index) => channel * fg.alpha + bg.rgb[index] * (1 - fg.alpha)) as Rgb;
}

function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgb): number {
  const [r, g, b] = color.map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const high = Math.max(luminance(a), luminance(b));
  const low = Math.min(luminance(a), luminance(b));
  return (high + 0.05) / (low + 0.05);
}

/** 文字色本身不透明；背景可能是半透明玻璃，先叠到它实际覆盖的纸面上。 */
function contrastOf(foreground: string, background: string | Rgb): number {
  const resolved = Array.isArray(background) ? background : composite(background, '#FFFFFF');
  return contrast(parseColor(foreground).rgb, resolved);
}

function paperSurfaces(palette: Palette): [string, Rgb][] {
  return [
    ['canvas', parseColor(palette.bg.canvas).rgb],
    ['surface', parseColor(palette.bg.surface).rgb],
    ['subtle', parseColor(palette.bg.subtle).rgb],
    ['elevatedAnswer', parseColor(palette.bg.elevatedAnswer).rgb],
    // dock 是 95% 不透明玻璃，实际观感 = 玻璃叠在 canvas 上。
    ['dockGlass over canvas', composite(palette.bg.dockGlass, palette.bg.canvas)],
  ];
}

for (const palette of [PAPER, EINK_SLATE]) {
  describe(`${palette.name} 色板对比度`, () => {
    const surfaces = paperSurfaces(palette);

    it.each(surfaces)('text.primary 在 %s 上 ≥ 4.5:1', (_name, background) => {
      expect(contrastOf(palette.text.primary, background)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(surfaces)('text.secondary 在 %s 上 ≥ 4.5:1', (_name, background) => {
      expect(contrastOf(palette.text.secondary, background)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(surfaces)('text.muted 在 %s 上 ≥ 4.5:1', (_name, background) => {
      expect(contrastOf(palette.text.muted, background)).toBeGreaterThanOrEqual(4.5);
    });

    it('语义文字与底色 ≥ 4.5:1', () => {
      expect(
        contrastOf(palette.semantic.diffAddText, palette.semantic.diffAddBg),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastOf(palette.semantic.diffDelText, palette.semantic.diffDelBg),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastOf(palette.semantic.gateAmberText, palette.semantic.gateAmberBg),
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrastOf(palette.semantic.dangerText, palette.semantic.dangerBg)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastOf(palette.action.primaryText, palette.action.primaryBg)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrastOf(palette.action.secondaryText, palette.action.secondaryBg),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it('轨迹角色色在 canvas 上 ≥ 4.5:1', () => {
      for (const color of Object.values(palette.role)) {
        expect(contrastOf(color, palette.bg.canvas)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('状态点（非文字）在 surface 上 ≥ 3:1', () => {
      expect(contrastOf(palette.semantic.live, palette.bg.surface)).toBeGreaterThanOrEqual(3);
    });
  });
}

describe('实时相机遮罩', () => {
  it.each(['#FFFFFF', '#000000'])('固定前景在 %s 画面上 ≥ 4.5:1', (backdrop) => {
    const scrim = composite(LIVE_CAMERA_SCRIM, backdrop);
    expect(contrast(parseColor(LIVE_CAMERA_FG).rgb, scrim)).toBeGreaterThanOrEqual(4.5);
  });
});
