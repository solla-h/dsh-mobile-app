import { useMemo } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { EINK_SLATE, MONO_FONT, PAPER, type Palette } from '../theme/tokens';
import { useFontScale } from './fontScale';

/**
 * 跟随系统深浅色。App 是「日间暖石纸 / 夜间暖炭灰」两套低反差色板，
 * 不用纯黑纯白，OLED 上不刺眼。
 */
export function useTheme(): Palette {
  const scheme = useColorScheme();
  return scheme === 'light' ? PAPER : EINK_SLATE;
}

/**
 * 按色板生成样式表：makeStyles 写成模块级函数（引用稳定），
 * 组件里 const styles = useThemedStyles(makeStyles) 即可跟随系统切换。
 */
export function useThemedStyles<T>(makeStyles: (t: Palette) => T): T {
  const t = useTheme();
  const { scale } = useFontScale();
  return useMemo(() => {
    const styles = makeStyles(t);
    // 全局字号只缩放文字相关数值，间距/控件尺寸不受影响。
    return scale === 1 ? styles : scaleFontSizes(styles, scale);
  }, [makeStyles, t, scale]);
}

/** 深度遍历样式对象，把 fontSize / lineHeight 乘上倍率（返回新对象，不改原样式表）。 */
function scaleFontSizes<T>(value: T, factor: number): T {
  if (Array.isArray(value)) {
    return value.map((item) => scaleFontSizes(item, factor)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      if ((key === 'fontSize' || key === 'lineHeight') && typeof item === 'number') {
        out[key] = Math.round(item * factor * 10) / 10;
      } else if (item !== null && typeof item === 'object') {
        out[key] = scaleFontSizes(item, factor);
      } else {
        out[key] = item;
      }
    }
    return out as T;
  }
  return value;
}

/** 代码 / 推理 / 遥测用的等宽字体。 */
export const MONO = Platform.select({ ios: MONO_FONT.ios, default: MONO_FONT.android });

/** 带 #RRGGBB 透明度后缀；dock 和遮罩都用得上。 */
export function withAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return hex + value;
}
