/**
 * 官方语音输入的目录与转写帧。
 *
 * 网关这条链路是「整段录音 → 服务端识别」：客户端按住录音，松手把 16kHz 单声道
 * PCM16 WAV 整份 base64 发过去，等 speech-transcript 回来。没有实时增量文字。
 *
 * 两个容易踩的点：
 * - speech-preparing 只表示请求已提交，不代表模型就绪，要看 preparation.phase；
 * - 每条连接同时只能有一个转写，迟到的结果要按 requestId 丢弃。
 */

export type SpeechPhase = 'ready' | 'standby' | 'unprepared' | 'preparing' | 'preparing-failed' | 'unknown';

export interface SpeechProvider {
  id: string;
  name: string;
  languages: string[];
  phase: SpeechPhase;
}

export interface SpeechCatalog {
  available: boolean;
  providers: SpeechProvider[];
  /** 主机当前选中的识别器和语言 */
  providerId?: string;
  language?: string;
  maxAudioBytes: number;
  maxDurationSeconds: number;
}

const FALLBACK_MAX_BYTES = 4 * 1024 * 1024;
const FALLBACK_MAX_SECONDS = 120;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mapPhase(value: unknown): SpeechPhase {
  const prep = asRecord(value);
  const phase = prep?.phase;
  if (phase === 'ready' || phase === 'standby') return phase;
  if (phase === 'unprepared') return 'unprepared';
  if (typeof phase === 'string' && phase.startsWith('prepar')) return 'preparing';
  if (typeof phase === 'string' && phase.includes('fail')) return 'preparing-failed';
  return 'unknown';
}

function mapProvider(value: unknown): SpeechProvider | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  const languages = Array.isArray(raw.languages)
    ? raw.languages.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : raw.id,
    languages,
    phase: mapPhase(raw.preparation),
  };
}

/** speech-catalog / speech-state 的 providers 是同一形状。 */
export function mapSpeechCatalog(raw: unknown): SpeechCatalog | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  const list = Array.isArray(frame.providers) ? frame.providers : [];
  const providers = list
    .map(mapProvider)
    .filter((item): item is SpeechProvider => item !== null);
  const selection = asRecord(frame.selection);
  return {
    available: frame.available === true,
    providers,
    providerId:
      typeof selection?.providerId === 'string'
        ? selection.providerId
        : providers.find((item) => item.phase === 'ready' || item.phase === 'standby')?.id,
    language: typeof selection?.language === 'string' ? selection.language : undefined,
    maxAudioBytes:
      typeof frame.maxAudioBytes === 'number' && frame.maxAudioBytes > 0
        ? frame.maxAudioBytes
        : FALLBACK_MAX_BYTES,
    maxDurationSeconds:
      typeof frame.maxDurationSeconds === 'number' && frame.maxDurationSeconds > 0
        ? frame.maxDurationSeconds
        : FALLBACK_MAX_SECONDS,
  };
}

/** 只要有一家 provider 准备好，就能转写。 */
export function hasReadyProvider(catalog: SpeechCatalog | null): boolean {
  if (!catalog || !catalog.available) return false;
  return catalog.providers.some((item) => item.phase === 'ready' || item.phase === 'standby');
}

/** speech-transcript：text 允许为空（没识别到人声）。 */
export function transcriptText(raw: unknown): string | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  if (typeof frame.text !== 'string') return null;
  return frame.text.trim();
}

/** 16kHz 单声道 PCM16 每秒 32000 字节，加上 44 字节头。 */
export function maxRecordSeconds(maxAudioBytes: number): number {
  return Math.max(1, Math.floor((maxAudioBytes - 44) / 32000));
}
