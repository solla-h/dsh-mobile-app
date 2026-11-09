import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { readJson, writeJson } from '../storage/persisted-state';

/**
 * 全局字号：只缩放文字（fontSize / lineHeight），不动间距和控件尺寸。
 * 通过 useThemedStyles 统一应用——项目里的样式全走那个入口。
 *
 * 取值是相对倍率而不是绝对 pt：不同组件的字号差异要保持（标题/正文/注释的比例不变）。
 */

export const FONT_SCALES = [
  { id: 'small', label: '小', scale: 0.9, hint: '信息密度更高' },
  { id: 'standard', label: '标准', scale: 1, hint: '默认' },
  { id: 'large', label: '大', scale: 1.12, hint: '看得更轻松' },
  { id: 'xlarge', label: '特大', scale: 1.26, hint: '适老化' },
] as const;

export type FontScaleId = (typeof FONT_SCALES)[number]['id'];

const SETTINGS_KEY = 'app-settings';

interface FontScaleValue {
  id: FontScaleId;
  scale: number;
  setId: (id: FontScaleId) => void;
}

const Ctx = createContext<FontScaleValue>({
  id: 'standard',
  scale: 1,
  setId: () => undefined,
});

export function FontScaleProvider({ children }: { children: ReactNode }) {
  const [id, setIdState] = useState<FontScaleId>('standard');

  useEffect(() => {
    let alive = true;
    void readJson<{ fontScale?: FontScaleId }>(SETTINGS_KEY).then((saved) => {
      if (!alive) return;
      if (saved?.fontScale && FONT_SCALES.some((item) => item.id === saved.fontScale)) {
        setIdState(saved.fontScale);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const setId = useCallback((next: FontScaleId) => {
    setIdState(next);
    void writeJson(SETTINGS_KEY, { fontScale: next });
  }, []);

  const scale = FONT_SCALES.find((item) => item.id === id)?.scale ?? 1;
  const value = useMemo(() => ({ id, scale, setId }), [id, scale, setId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFontScale(): FontScaleValue {
  return useContext(Ctx);
}
