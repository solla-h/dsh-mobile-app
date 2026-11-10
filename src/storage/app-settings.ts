import { readJson, writeJson } from './persisted-state';

/**
 * app-settings 是多个设置共用的同一个对象（目前是字号 + 界面语言）。
 * 局部更新必须走这里：整对象 writeJson 会让两个设置互相清掉。
 */
export type AppLanguage = 'zh' | 'en';
export type AppFontScale = 'small' | 'standard' | 'large' | 'xlarge';

export interface AppSettings {
  fontScale?: AppFontScale;
  language?: AppLanguage;
}

const SETTINGS_KEY = 'app-settings';

export function readAppSettings(): Promise<AppSettings | null> {
  return readJson<AppSettings>(SETTINGS_KEY);
}

/** 读-合并-写。落盘失败由 writeJson 内部吞掉，不影响交互。 */
export async function writeAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const saved = (await readJson<AppSettings>(SETTINGS_KEY)) ?? {};
  await writeJson(SETTINGS_KEY, { ...saved, ...patch });
}
