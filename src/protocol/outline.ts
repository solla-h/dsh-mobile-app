/** 轮次大纲与图片限额：都来自 history / session-snapshot 的 projections.values。 */

import type { ImageLimits } from './types';

export interface TurnOutlineItem {
  turn: number;
  seq: number;
  /** 宿主已截断到 50 个 UTF-16 code unit */
  prompt: string;
  /** 宿主已截断到 120 个 UTF-16 code unit */
  response: string;
}

/**
 * null 表示大纲投影失效（控制流重建后旧缓存不可用），要退回到已加载的轮次；
 * 数组（含空数组）才是有效大纲。
 */
export function mapTurnOutline(value: unknown): TurnOutlineItem[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return [];
  const out: TurnOutlineItem[] = [];
  for (const entry of value) {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const turn = typeof raw.turn === 'number' ? raw.turn : Number(raw.turn);
    const seq = typeof raw.seq === 'number' ? raw.seq : Number(raw.seq);
    if (!Number.isFinite(turn) || !Number.isFinite(seq)) continue;
    out.push({
      turn,
      seq,
      prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
      response: typeof raw.response === 'string' ? raw.response : '',
    });
  }
  // seq 指向 turn/start，按 seq 升序就是时间顺序。
  return out.sort((a, b) => a.seq - b.seq);
}

export function mapImageLimits(value: unknown): ImageLimits | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const num = (key: string) => (typeof raw[key] === 'number' ? (raw[key] as number) : undefined);
  return {
    maxImageBytes: num('maxImageBytes'),
    maxImagesPerMessage: num('maxImagesPerMessage'),
    maxMessageImageBytes: num('maxMessageImageBytes'),
    maxImagePixels: num('maxImagePixels'),
    maxImageDimension: num('maxImageDimension'),
    mediaTypes: Array.isArray(raw.mediaTypes) ? (raw.mediaTypes as string[]) : undefined,
  };
}

/** 从 history / session-snapshot 帧里取 projections.values。 */
export function readProjectionValues(frame: unknown): Record<string, unknown> | null {
  const projections = (frame as { projections?: { values?: unknown } } | null)?.projections;
  const values = projections?.values;
  return values && typeof values === 'object' ? (values as Record<string, unknown>) : null;
}
