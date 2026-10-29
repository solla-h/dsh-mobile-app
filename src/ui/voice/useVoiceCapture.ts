import { requestRecordingPermissionsAsync, useAudioStream } from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback } from 'react';

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
  /** 结束录音并编码成 base64；没在录时返回 null */
  stop: () => Promise<VoiceClip | null>;
  /** 放弃这次录音（上滑取消、切页） */
  cancel: () => void;
}

export function useVoiceCapture(): VoiceCapture {
  const { stream } = useAudioStream({ sampleRate: 16000, channels: 1, encoding: 'int16' });

  const start = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) throw new Error('没有麦克风权限');
    await stream.start();
    // 必须在 start() 之后才能开文件录制。
    await stream.startFileRecordingAsync({ format: 'wav' });
  }, [stream]);

  const stop = useCallback(async () => {
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
    const base64 = await new File(result.uri).base64();
    return {
      base64,
      sampleRate: result.sampleRate,
      channels: result.channels,
      duration: result.duration,
    };
  }, [stream]);

  const cancel = useCallback(() => {
    try {
      stream.stop();
    } catch {
      // 已经停了就算了
    }
  }, [stream]);

  return { start, stop, cancel };
}
