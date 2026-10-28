/**
 * 漫反射电纸书色板：日间暖石纸色 (paper) / 夜间暖炭电纸灰 (eink_slate)。
 *
 * 规范见 docs/dsh_mobile_app_product_ui_spec.md §4：
 * 不用纯黑纯白（OLED 上 21:1 的反差会晕光），对比度压在 6.5:1 ~ 8.2:1。
 */

export type Palette = {
  name: 'paper' | 'eink_slate';
  bg: {
    canvas: string;
    surface: string;
    subtle: string;
    elevatedAnswer: string;
    dockGlass: string;
  };
  border: { default: string; subtle: string; activeOrigin: string };
  text: { primary: string; secondary: string; muted: string };
  action: { primaryBg: string; primaryText: string; secondaryBg: string; secondaryText: string };
  semantic: {
    diffAddBg: string;
    diffAddText: string;
    diffDelBg: string;
    diffDelText: string;
    gateAmberBg: string;
    gateAmberText: string;
    dangerBg: string;
    dangerText: string;
  };
};

export const PAPER: Palette = {
  name: 'paper',
  bg: {
    canvas: '#F4F2ED',
    surface: '#EAE7E0',
    subtle: '#EFECE6',
    elevatedAnswer: '#FAF8F3',
    dockGlass: 'rgba(230, 227, 220, 0.95)',
  },
  border: { default: '#D8D5CC', subtle: '#DFDCD3', activeOrigin: '#5C5A52' },
  text: { primary: '#1C1C1A', secondary: '#5C5B57', muted: '#8C8A84' },
  action: {
    primaryBg: '#2B2B28',
    primaryText: '#F4F2ED',
    secondaryBg: '#EAE7E0',
    secondaryText: '#5C5B57',
  },
  semantic: {
    diffAddBg: '#E1EBE4',
    diffAddText: '#284B34',
    diffDelBg: '#EFE2E2',
    diffDelText: '#693034',
    gateAmberBg: '#E6E0D0',
    gateAmberText: '#5C4E2E',
    dangerBg: '#EFE2E2',
    dangerText: '#8A3B40',
  },
};

export const EINK_SLATE: Palette = {
  name: 'eink_slate',
  bg: {
    canvas: '#252522',
    surface: '#2E2E2A',
    subtle: '#292926',
    elevatedAnswer: '#31312C',
    dockGlass: 'rgba(44, 44, 40, 0.95)',
  },
  border: { default: '#3E3E39', subtle: '#363632', activeOrigin: '#8C887D' },
  text: { primary: '#CECBC2', secondary: '#9A978E', muted: '#75736B' },
  action: {
    primaryBg: '#C4C1B6',
    primaryText: '#222220',
    secondaryBg: '#2E2E2A',
    secondaryText: '#9A978E',
  },
  semantic: {
    diffAddBg: '#28332B',
    diffAddText: '#A3BDA9',
    diffDelBg: '#36292A',
    diffDelText: '#C29B9E',
    gateAmberBg: '#363228',
    gateAmberText: '#C8B68E',
    dangerBg: '#3A2C2C',
    dangerText: '#C08A8C',
  },
};

/** 等宽字体：代码、推理、遥测统一用它，数字开 tabular-nums 防跳动。 */
export const MONO_FONT = {
  android: 'monospace',
  ios: 'Menlo',
} as const;

/** 排版层级（§4.3）。 */
export const TYPE = {
  body: { fontSize: 14, lineHeight: 21.7 }, // 14 / 1.55
  caption: { fontSize: 12, lineHeight: 17 },
  mono: { fontSize: 11, lineHeight: 16 }, // 代码行 11 / 1.45
  pill: { fontSize: 11, lineHeight: 16 },
  title: { fontSize: 15, lineHeight: 21 },
} as const;

/** 动效曲线（§5）。RN 的 Animated 只认 tension/friction，这里给换算后的值。 */
export const MOTION = {
  /** 折叠：临界过阻尼，零回弹，约 220ms */
  collapse: { tension: 120, friction: 26 },
  /** 抽屉展开 */
  sheet: { tension: 90, friction: 24 },
  /** 长按充能时长 */
  holdMs: 500,
  /** 松手回退 */
  holdReleaseMs: 120,
  /** 悔棋窗 */
  undoMs: 4500,
  /** 自动跳栈延迟 */
  autoHopMs: 360,
} as const;

/** 折叠胶囊固定高度（§2.1 的 34pt）。 */
export const PILL_HEIGHT = 34;
