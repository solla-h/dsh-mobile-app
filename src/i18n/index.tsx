import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { readAppSettings, writeAppSettings, type AppLanguage } from '../storage/app-settings';
import { en } from './en';
import type { Key } from './keys';

/**
 * 界面语言。字典形状沿用官方 ui-approval 的 locales.ts：
 * 中文是 key 全集的真源，英文用 satisfies 约束，漏一条即编译错误。
 * 这里把中文原文直接当 key，中文模式原样回退，不需要第二份中文字典。
 *
 * 文案函数放在模块级而不是 hook 里：src/protocol 与 src/transport 的纯函数
 * 也要产出给界面看的句子，它们拿不到 context。语言切换由 useLanguageVersion()
 * 通知（useThemedStyles 已统一订阅），组件重渲染时重新调用 tr() 即可刷新。
 */
export type Language = AppLanguage;

let activeLanguage: Language = 'zh';
let languageVersion = 0;
const listeners = new Set<() => void>();

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLanguageVersion(): number {
  return languageVersion;
}

export function currentLanguage(): Language {
  return activeLanguage;
}

function activate(next: Language): void {
  if (next === activeLanguage) return;
  activeLanguage = next;
  languageVersion += 1;
  for (const listener of listeners) listener();
}

/** 无显式偏好时跟随系统：zh* 用中文，其余（含 en-US 与未知）回退英文。 */
export function systemLanguage(): Language {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
    return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

export type TParams = Record<string, unknown> | readonly unknown[];

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = Array.isArray(params)
      ? params[Number(name)]
      : (params as Record<string, unknown>)[name];
    return value === undefined || value === null ? whole : String(value);
  });
}

const dictionary: Record<Key, string> = en;

/** 文案出口。params 支持编号 {0} 与命名 {name} 两种占位符。 */
export function tr(key: Key, params?: TParams): string {
  return interpolate(activeLanguage === 'en' ? dictionary[key] : key, params);
}

interface LanguageValue {
  language: Language;
  setLanguage: (next: Language) => void;
}

const Ctx = createContext<LanguageValue>({
  language: 'zh',
  setLanguage: () => undefined,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('zh');

  useEffect(() => {
    let alive = true;
    void readAppSettings().then((saved) => {
      if (!alive) return;
      const next: Language =
        saved?.language === 'zh' || saved?.language === 'en' ? saved.language : systemLanguage();
      activate(next);
      setLanguageState(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    activate(next);
    void writeAppSettings({ language: next });
  }, []);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLanguage(): LanguageValue {
  return useContext(Ctx);
}

/** 给不走 useThemedStyles 的组件订阅语言变化。 */
export function useLanguageVersion(): number {
  return useSyncExternalStore(subscribeLanguage, getLanguageVersion, getLanguageVersion);
}

export interface LanguageOption {
  id: Language;
  label: string;
  hint: string;
}

/** 函数而不是模块级常量：语言切换后重新取值，选项名才会跟着变。 */
export function languageOptions(): LanguageOption[] {
  return [
    { id: 'zh', label: tr('中文'), hint: tr('简体中文') },
    { id: 'en', label: 'English', hint: 'English' },
  ];
}
