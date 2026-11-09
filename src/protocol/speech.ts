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

/** 服务端给的两个上限；目录还没到时按兜底值算。 */
export interface SpeechLimits {
  maxAudioBytes: number;
  maxDurationSeconds: number;
}

export interface SpeechCatalog extends SpeechLimits {
  available: boolean;
  providers: SpeechProvider[];
  /** 主机当前选中的识别器和语言 */
  providerId?: string;
  language?: string;
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
  // 请求会固定带 providerId，所以钉的必须是真能用的那家：selection 指向不存在
  // 或没就绪的 provider 时回退到第一个 ready 的——否则 hasReadyProvider 放行、
  // 请求却打给不可用的一家，每次录完整段都被服务端拒。
  const selected =
    typeof selection?.providerId === 'string'
      ? providers.find((item) => item.id === selection.providerId)
      : undefined;
  const chosen = selected && isReady(selected) ? selected : providers.find(isReady);
  return {
    available: frame.available === true,
    providers,
    providerId: chosen?.id,
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
const isReady = (provider: SpeechProvider): boolean =>
  provider.phase === 'ready' || provider.phase === 'standby';

export function hasReadyProvider(catalog: SpeechCatalog | null): boolean {
  if (!catalog || !catalog.available) return false;
  return catalog.providers.some(isReady);
}

/** speech-transcript：text 允许为空（没识别到人声）。 */
export function transcriptText(raw: unknown): string | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  if (typeof frame.text !== 'string') return null;
  return frame.text.trim();
}

/**
 * 开麦前的守卫。返回 null 表示可以开麦，否则是给用户看的一句话。
 * 目录还没到和「网关根本没开语音」是两回事，别都说成「没启用」。
 */
export function speechBlockedNotice(catalog: SpeechCatalog | null): string | null {
  if (hasReadyProvider(catalog)) return null;
  if (catalog && !catalog.available) return '网关没有可用的语音服务';
  return '语音还在准备，稍等一下';
}

/** 转写失败帧 → 用户能看懂的一句话。未知错误码不往用户脸上抛。 */
const TRANSCRIBE_NOTICES = new Map<string, string>([
  ['speech/unavailable', '网关没有可用的语音服务'],
  ['speech/invalid-audio', '这段录音太长或太大，短一点再试'],
  ['speech/busy', '网关语音忙不过来，等一下再试'],
  ['speech/timeout', '转写超时了，再试一次'],
]);

export function transcribeFailureNotice(code?: string): string {
  return (code ? TRANSCRIBE_NOTICES.get(code) : undefined) ?? '转写失败，再试一次';
}

/** 16kHz 单声道 PCM16 每秒 32000 字节，加上 44 字节头。 */
export function maxRecordSeconds(maxAudioBytes: number): number {
  return Math.max(1, Math.floor((maxAudioBytes - 44) / 32000));
}

/**
 * 停止比上限早这么多秒。计时是 0.5s 一跳、stop() 还有几十到几百毫秒延迟，
 * 掐着上限停，多出来的那零点几秒会让整段录音顶到服务端校验上被拒：
 * 官方 Remote 按 WAV 实际时长校验 maxDurationSeconds，网关再按解码后字节数校验。
 */
export const RECORD_MARGIN_SECONDS = 1;

/**
 * 有效录音上限（秒）：服务端时长上限与体积上限换算出的秒数取较小值
 * （16kHz/单声道/PCM16 = 32000 B/s）。目录还没到时按网关兜底值算。
 */
export function recordLimitSeconds(limits: SpeechLimits | null): number {
  const byDuration = Math.floor(limits?.maxDurationSeconds ?? FALLBACK_MAX_SECONDS);
  const byBytes = maxRecordSeconds(limits?.maxAudioBytes ?? FALLBACK_MAX_BYTES);
  return Math.max(1, Math.min(byDuration, byBytes));
}

/** 12 → "0:12"，125 → "2:05"。录音计时显示用。 */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 把整段 WAV 截到不超过 maxSeconds（16kHz 单声道 PCM16）：44 字节头保留，
 * 数据截到整数秒并回写两个长度字段。弹起停止的定时器被 JS 卡顿或壁钟回拨
 * 拖过头时用它兜底——服务端按 WAV 实际时长校验，超一点就整段拒收，
 * 而这段录音本地已经拿不回来了，截断比丢掉强（官方客户端也是这么截的）。
 * 不是 RIFF 头就原样返回，交给服务端按非法音频报错。
 */
export function clampWav(bytes: Uint8Array, maxSeconds: number): Uint8Array {
  const keep = 44 + Math.max(0, Math.floor(maxSeconds)) * 32000;
  if (bytes.byteLength <= keep) return bytes;
  if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) {
    return bytes;
  }
  const clamped = bytes.slice(0, keep);
  const view = new DataView(clamped.buffer, clamped.byteOffset, clamped.byteLength);
  view.setUint32(4, clamped.byteLength - 8, true); // RIFF chunk size
  view.setUint32(40, clamped.byteLength - 44, true); // data chunk size
  return clamped;
}
