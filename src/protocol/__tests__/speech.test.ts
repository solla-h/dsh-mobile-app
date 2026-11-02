import {
  RECORD_MARGIN_SECONDS,
  clampWav,
  formatClock,
  hasReadyProvider,
  mapSpeechCatalog,
  maxRecordSeconds,
  recordLimitSeconds,
  speechBlockedNotice,
  transcribeFailureNotice,
  transcriptText,
} from '../speech';

const catalog = (overrides: Record<string, unknown> = {}) => ({
  kind: 'speech-catalog',
  available: true,
  providers: [{ id: 'sensevoice', name: 'SenseVoice', languages: ['zh'], preparation: { phase: 'ready' } }],
  selection: { providerId: 'sensevoice', language: 'zh' },
  maxAudioBytes: 4 * 1024 * 1024,
  maxDurationSeconds: 120,
  ...overrides,
});

describe('mapSpeechCatalog', () => {
  it('providers / selection / 上限都映射出来', () => {
    const mapped = mapSpeechCatalog(catalog());
    expect(mapped).not.toBeNull();
    expect(mapped?.available).toBe(true);
    expect(mapped?.providers[0]).toEqual({
      id: 'sensevoice',
      name: 'SenseVoice',
      languages: ['zh'],
      phase: 'ready',
    });
    expect(mapped?.providerId).toBe('sensevoice');
    expect(mapped?.language).toBe('zh');
    expect(mapped?.maxAudioBytes).toBe(4 * 1024 * 1024);
    expect(mapped?.maxDurationSeconds).toBe(120);
  });

  it('phase 在 preparation 底下；没有 selection 时回退到第一个 ready 的 provider', () => {
    const mapped = mapSpeechCatalog(catalog({ selection: undefined }));
    expect(mapped?.providerId).toBe('sensevoice');
  });

  it('上限缺失或非法时退回兜底值，别把 0 当成上限', () => {
    const mapped = mapSpeechCatalog(catalog({ maxAudioBytes: 0, maxDurationSeconds: -3 }));
    expect(mapped?.maxAudioBytes).toBe(4 * 1024 * 1024);
    expect(mapped?.maxDurationSeconds).toBe(120);
  });

  it('selection 指向没就绪/不存在的 provider 时回退到第一个 ready 的', () => {
    const mapped = mapSpeechCatalog(
      catalog({
        providers: [
          { id: 'sensevoice', name: 'SenseVoice', preparation: { phase: 'unprepared' } },
          { id: 'whisper', name: 'Whisper', preparation: { phase: 'standby' } },
        ],
        selection: { providerId: 'sensevoice' },
      }),
    );
    // 放行时（whisper 可用）请求必须打给 whisper：钉一个不可用的 id 等于录完整段白转
    expect(hasReadyProvider(mapped)).toBe(true);
    expect(mapped?.providerId).toBe('whisper');

    const absent = mapSpeechCatalog(
      catalog({
        providers: [{ id: 'whisper', preparation: { phase: 'ready' } }],
        selection: { providerId: 'ghost' },
      }),
    );
    expect(absent?.providerId).toBe('whisper');
  });
});

describe('hasReadyProvider / speechBlockedNotice', () => {
  it('ready 或 standby 都算能用', () => {
    expect(hasReadyProvider(mapSpeechCatalog(catalog()))).toBe(true);
    const standby = mapSpeechCatalog(
      catalog({ providers: [{ id: 'a', preparation: { phase: 'standby' } }] }),
    );
    expect(hasReadyProvider(standby)).toBe(true);
  });

  it('目录还没到和「网关没启用语音」是两种提示', () => {
    expect(speechBlockedNotice(null)).toBe('语音还在准备，稍等一下');
    expect(speechBlockedNotice(mapSpeechCatalog(catalog({ available: false })))).toBe(
      '网关没有可用的语音服务',
    );
    expect(
      speechBlockedNotice(
        mapSpeechCatalog(catalog({ providers: [{ id: 'a', preparation: { phase: 'preparing' } }] })),
      ),
    ).toBe('语音还在准备，稍等一下');
    expect(speechBlockedNotice(mapSpeechCatalog(catalog()))).toBeNull();
  });
});

describe('transcribeFailureNotice', () => {
  it('认识网关的错误码就给针对性的提示', () => {
    expect(transcribeFailureNotice('speech/unavailable')).toBe('网关没有可用的语音服务');
    expect(transcribeFailureNotice('speech/invalid-audio')).toContain('太长或太大');
    expect(transcribeFailureNotice('speech/busy')).toContain('忙');
    expect(transcribeFailureNotice('speech/timeout')).toContain('超时');
  });

  it('不认识的码不往用户脸上抛，也不被原型链上的键骗到', () => {
    expect(transcribeFailureNotice('speech/whatever')).toBe('转写失败，再试一次');
    expect(transcribeFailureNotice(undefined)).toBe('转写失败，再试一次');
    expect(transcribeFailureNotice('constructor')).toBe('转写失败，再试一次');
  });
});

describe('maxRecordSeconds / recordLimitSeconds', () => {
  it('按 16k 单声道 PCM16 的 32000 字节/秒换算，扣掉 44 字节头', () => {
    expect(maxRecordSeconds(44)).toBe(1); // 下限 1 秒
    expect(maxRecordSeconds(32044)).toBe(1);
    expect(maxRecordSeconds(64044)).toBe(2);
    expect(maxRecordSeconds(4 * 1024 * 1024)).toBe(131);
  });

  it('时长上限更小时听时长，体积上限更小时听体积', () => {
    expect(recordLimitSeconds({ maxAudioBytes: 4 * 1024 * 1024, maxDurationSeconds: 120 })).toBe(120);
    expect(recordLimitSeconds({ maxAudioBytes: 64044, maxDurationSeconds: 120 })).toBe(2);
    expect(recordLimitSeconds({ maxAudioBytes: 4 * 1024 * 1024, maxDurationSeconds: 30 })).toBe(30);
  });

  it('目录还没到时按网关兜底值算（120s）', () => {
    expect(recordLimitSeconds(null)).toBe(120);
  });

  it('停止点比上限早 RECORD_MARGIN_SECONDS，顶到校验线才不会被整段拒收', () => {
    const limit = recordLimitSeconds({ maxAudioBytes: 4 * 1024 * 1024, maxDurationSeconds: 120 });
    const stopAt = limit - RECORD_MARGIN_SECONDS;
    // 停录那一刻的字节数必须还在体积上限之内
    expect(44 + stopAt * 32000).toBeLessThan(4 * 1024 * 1024);
    expect(stopAt).toBeLessThan(120);
  });
});

describe('clampWav', () => {
  /** 造一段标准 44 字节头 + 若干秒 PCM16 数据的 WAV。 */
  const wav = (seconds: number) => {
    const bytes = new Uint8Array(44 + seconds * 32000);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    const view = new DataView(bytes.buffer);
    view.setUint32(4, bytes.byteLength - 8, true);
    view.setUint32(40, seconds * 32000, true);
    return bytes;
  };

  it('超上限就截到整数秒，两个长度字段跟着改对', () => {
    const clamped = clampWav(wav(150), 120);
    expect(clamped.byteLength).toBe(44 + 120 * 32000);
    const view = new DataView(clamped.buffer, clamped.byteOffset, clamped.byteLength);
    expect(view.getUint32(4, true)).toBe(clamped.byteLength - 8);
    expect(view.getUint32(40, true)).toBe(120 * 32000);
  });

  it('没超上限时原样返回', () => {
    const short = wav(3);
    expect(clampWav(short, 120)).toBe(short);
  });

  it('不是 RIFF 头就不动它，交给服务端按非法音频报错', () => {
    const junk = new Uint8Array(44 + 32000 * 5);
    expect(clampWav(junk, 1)).toBe(junk);
  });
});

describe('formatClock', () => {
  it('不足一分钟不带 0 分，超一分钟补零', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(12)).toBe('0:12');
    expect(formatClock(59.9)).toBe('0:59');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(125)).toBe('2:05');
  });

  it('负数/NaN 不产出怪字符串', () => {
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });
});

describe('transcriptText', () => {
  it('空文本返回空串（没识别到人声），不是 null', () => {
    expect(transcriptText({ kind: 'speech-transcript', text: '  你好  ' })).toBe('你好');
    expect(transcriptText({ kind: 'speech-transcript', text: '   ' })).toBe('');
  });

  it('没有 text 字段就返回 null', () => {
    expect(transcriptText({ kind: 'speech-transcript' })).toBeNull();
    expect(transcriptText(null)).toBeNull();
  });
});
