import { readJson, writeJson } from './persisted-state';

/**
 * 按会话保存输入框草稿。
 * 退出会话、切到别的会话再回来，没发出去的内容还在。
 */
const STORAGE_KEY = 'drafts';
const MAX_DRAFTS = 30;

type DraftMap = Record<string, string>;

let cache: DraftMap | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function ensure(): Promise<DraftMap> {
  if (cache) return cache;
  const stored = await readJson<DraftMap>(STORAGE_KEY);
  cache = stored && typeof stored === 'object' ? stored : {};
  return cache;
}

export async function loadDraft(sessionId: string): Promise<string> {
  const drafts = await ensure();
  return drafts[sessionId] ?? '';
}

export function saveDraft(sessionId: string, text: string): void {
  if (!cache) cache = {};
  if (text) cache[sessionId] = text;
  else delete cache[sessionId];
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!cache) return;
    // 只留最近修改的若干条，避免文件无限长。
    const entries = Object.entries(cache).slice(-MAX_DRAFTS);
    cache = Object.fromEntries(entries);
    void writeJson(STORAGE_KEY, cache);
  }, 400);
}

export function clearDraft(sessionId: string): void {
  saveDraft(sessionId, '');
}
