import { requestRecordingPermissionsAsync, useAudioStream } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { useCallback, useMemo } from 'react';

import { clampWav } from '../../protocol/speech';

/**
 * 按住说话用的录音器。
 *
 * 网关只收 **16kHz / 单声道 / PCM16 WAV（含 44 字节头）** 的整段 base64，
 * 所以：expo-audio 的 useAudioRecorder（Android 走 MediaRecorder，只有 aac/mp4）
 * 用不了，必须走 AudioStream 的文件录制，并且显式指定 int16。
 */

export interface VoiceClip {
  base64: string;
  sampleRate: number;
  channels: number;
  duration: number;
}

export interface VoiceCapture {
  start: () => Promise<void>;
  /**
   * 结束录音并编码成 base64；没在录时返回 null。
   * maxSeconds 给了就保证返回的片段不超过它（超了就地截断）。
   */
  stop: (maxSeconds?: number) => Promise<VoiceClip | null>;
  /** 放弃这次录音（上滑取消、切页） */
  cancel: () => void;
}

export function useVoiceCapture(): VoiceCapture {
  const { stream } = useAudioStream({ sampleRate: 16000, channels: 1, encoding: 'int16' });

  const start = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) throw new Error('没有麦克风权限');
    await stream.start();
    try {
      // 必须在 start() 之后才能开文件录制。
      await stream.startFileRecordingAsync({ format: 'wav' });
    } catch (failure) {
      // 文件录制没开起来（缓存目录不可写等）也要把流关掉：
      // 调用方的「停录」只看得到自己的状态，流开着没人会再来关，麦克风会一直亮。
      try {
        stream.stop();
      } catch {
        // 已经停了就算了
      }
      throw failure;
    }
  }, [stream]);

  const stop = useCallback(async (maxSeconds?: number) => {
    if (!stream.isStreaming) return null;
    const result = await stream.stopFileRecordingAsync();
    stream.stop();
    // 硬件可能给不出 16k：不校验的话会静默发一段 48k 的音频，
    // 服务端按 16k 解读就是三倍速，转写结果一定是乱的。
    if (result.sampleRate !== 16000 || result.channels !== 1 || result.encoding !== 'int16') {
      throw new Error(
        `录音格式不对：${result.sampleRate}Hz / ${result.channels} 声道 / ${result.encoding}`,
      );
    }
    let duration = result.duration;
    let base64: string;
    if (maxSeconds !== undefined && result.duration > maxSeconds) {
      // 到点的定时器被卡顿拖过头了：直接发会被服务端按时长整段拒收，
      // 截到上限再发，前面的内容还能用。
      const clamped = new File(Paths.cache, `voice-clamped-${randomUUID()}.wav`);
      clamped.create({ overwrite: true });
      await clamped.write(clampWav(await new File(result.uri).bytes(), maxSeconds));
      base64 = await clamped.base64();
      try {
        clamped.delete();
      } catch {
        // 缓存文件，删不掉也不碍事
      }
      duration = maxSeconds;
    } else {
      base64 = await new File(result.uri).base64();
    }
    return {
      base64,
      sampleRate: result.sampleRate,
      channels: result.channels,
      duration,
    };
  }, [stream]);

  const cancel = useCallback(() => {
    try {
      stream.stop();
    } catch {
      // 已经停了就算了
    }
  }, [stream]);

  // 必须 memo：调用方常把整个对象放进 effect 依赖（如「离开页面放弃录音」的
  // 清理函数），每次渲染换一个新对象会让清理函数每帧都跑一次，
  // 刚 start() 的录音会被立刻 cancel 掉。
  return useMemo(() => ({ start, stop, cancel }), [start, stop, cancel]);
}
