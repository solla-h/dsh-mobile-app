import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  RECORD_MARGIN_SECONDS,
  recordLimitSeconds,
  speechBlockedNotice,
  transcribeFailureNotice,
  transcriptText,
  type SpeechCatalog,
} from '../../protocol/speech';
import type { GatewayClient } from '../../transport/gateway-client';
import { tickFeedback } from '../haptics';
import { useVoiceCapture, type VoiceClip } from './useVoiceCapture';

/**
 * 按住说话的整条状态机：首页语音球（App + PetStage）与会话页麦克风共用这一份，
 * 上限、提示、复位都只有一处实现。
 *
 * 这里要处理几件容易出错的事：
 * - **极快松手**：`start()` 是异步的，松手可能发生在它还没跑完的时候。按「意图 ref」
 *   判断，而不是等 `recording` 变真——否则松手时 `if (!recording) return` 直接返回，
 *   开麦完成后没人再收尾，录音状态永远为真，麦克风也不释放。
 * - **收尾窗口**：松手后 `stop()`（收 WAV + 编码）要跑几百毫秒，这期间
 *   pressed/recording/transcribing 全为假，不加锁会被下一次按住钻进来，
 *   出现「两段同时在途、两段都丢」。`finishingRef` 堵住这个窗口，
 *   取消则用 `utteranceRef` 令牌把正在收尾的这一段整段作废。
 * - **上限**：服务端同时给时长和体积两个上限，取换算后的较小值，还剩 1 秒就停
 *   （见 RECORD_MARGIN_SECONDS）。到点自动停等于用户松手，但转写结果不直接发出去。
 * - **复位**：`client.send()` 返回 false 表示 socket 没开，必须立刻把 transcribing
 *   复位并提示；否则语音入口直接死锁。连接掉线、转写失败、空结果同理。
 */

/** 这一段为什么结束：用户松手，还是到上限自动停。 */
export type VoiceStopReason = 'release' | 'cap';

/** 剩余这么多秒开始变色 + 震一下。 */
export const VOICE_ALMOST_UP_SECONDS = 10;

/** 短于这个时长多半是误触：本地拦掉，不浪费一次转写往返。 */
const MIN_CLIP_SECONDS = 0.4;

interface Options {
  client: GatewayClient;
  catalog: SpeechCatalog | null;
  /** 一句话提示：首页走宠物气泡，会话页走状态条 */
  onNotice: (text: string) => void;
  /** 转写结果；reason='cap' 表示这是到上限自动停下来的那一段 */
  onTranscript: (text: string, reason: VoiceStopReason) => void;
}

export interface VoiceInput {
  /**
   * 按住（已经过了轻点门槛）。异步开麦，失败/未启用会自己提示。
   * 返回 false 表示这次按住没被接受（上一段还在录/收尾/转写）：调用方
   * 不能把它当成一次新录音，尤其别拿它覆盖上一次录音的投递目标。
   */
  begin: () => boolean;
  /** 松手。开麦还没完成时调用也安全 */
  end: () => void;
  /** 放弃整段语音（上滑取消、离开页面）；notice 是给用户看的那句话 */
  cancel: (notice?: string) => void;
  /** 撤回已经发出去的转写 */
  cancelTranscription: () => void;
  /** 帧喂进来：不是本次转写的结果就丢掉 */
  handleTranscript: (frame: unknown) => void;
  handleTranscribeFailure: (failure: {
    code?: string;
    message?: string;
    requestId?: string;
    requestType?: string;
  }) => void;
  recording: boolean;
  transcribing: boolean;
  /** 已录秒数（0.5s 刷新，停录后保持） */
  elapsed: number;
  /** 有效上限（秒） */
  limit: number;
  /** 剩余不超过 VOICE_ALMOST_UP_SECONDS：UI 该变色了 */
  almostUp: boolean;
}

export function useVoiceInput({ client, catalog, onNotice, onTranscript }: Options): VoiceInput {
  const capture = useVoiceCapture();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const limit = recordLimitSeconds(catalog);

  /** 用户是否还按着。松手可能发生在开麦还没完成的空档里，只信这个 ref */
  const pressedRef = useRef(false);
  /** 是不是真的在录：finish 要看得见 begin 的异步结果，不能读 state */
  const recordingRef = useRef(false);
  /** 正在进行的开麦；松手时先等它结束，否则会漏掉刚开的麦克风 */
  const startingRef = useRef<Promise<void> | null>(null);
  /** 这一段是什么时候开始的（毫秒），计时与到点判定都看它 */
  const startedAtRef = useRef(0);
  /** 刚过去的这一段是松手还是到上限；转写回来时要据此决定发不发 */
  const stopReasonRef = useRef<VoiceStopReason>('release');
  /** 正在等的转写请求 id；迟到/别人的结果按它丢弃 */
  const requestIdRef = useRef<string | null>(null);
  const transcribingRef = useRef(false);
  /** 最后 10 秒的震动只来一次 */
  const warnedRef = useRef(false);
  /** 松手后的收尾（停录 + 编码）正在进行：这期间不接受新的按住 */
  const finishingRef = useRef(false);
  /** 第几段语音。取消时自增，让还在收尾/在途的那一段整段作废 */
  const utteranceRef = useRef(0);
  /** 开录那一刻的识别器与语言：录音期间目录被重连刷新也不能改用新的 */
  const selectionRef = useRef<{ providerId?: string; language?: string }>({});

  // 最新的输入放 ref：PanResponder 回调拿不到新闭包，回调也不能天天换引用。
  const apiRef = useRef({ client, catalog, onNotice, onTranscript });
  useEffect(() => {
    apiRef.current = { client, catalog, onNotice, onTranscript };
  });

  const settle = useCallback((notice?: string) => {
    requestIdRef.current = null;
    transcribingRef.current = false;
    setTranscribing(false);
    if (notice) apiRef.current.onNotice(notice);
  }, []);

  /** 松手与到点共用：先等开麦落地，再收录音、发转写。整段收尾互斥，只跑一次。 */
  const finish = useCallback(
    async (reason: VoiceStopReason) => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      const utterance = utteranceRef.current;
      try {
        pressedRef.current = false;
        const starting = startingRef.current;
        if (starting) await starting; // 开麦还没完成：等它（那条分支会自己收尾）
        if (!recordingRef.current) return; // 从没真正开录，或已经停过了
        recordingRef.current = false;
        stopReasonRef.current = reason;
        setRecording(false);

        let clip: VoiceClip | null;
        try {
          // 上限兜住时长与体积（服务端两个都校验）：正常早 1 秒停，
          // 真被卡顿拖过头时由 stop 就地截断，别让整段录音白丢。
          clip = await capture.stop(recordLimitSeconds(apiRef.current.catalog));
        } catch (failure) {
          apiRef.current.onNotice(failure instanceof Error ? failure.message : '读不到这段录音');
          return;
        }
        if (!clip) return;
        // 收尾这段窗口里被取消了（上滑、切页）：这一段整段作废。
        if (utterance !== utteranceRef.current) return;
        if (clip.duration < MIN_CLIP_SECONDS) {
          apiRef.current.onNotice('太短啦，按住多说一会儿');
          return;
        }

        const api = apiRef.current;
        const requestId = randomUUID();
        requestIdRef.current = requestId;
        transcribingRef.current = true;
        setTranscribing(true);
        const sent = api.client.send({
          type: 'speech-transcribe',
          requestId,
          providerId: selectionRef.current.providerId,
          language: selectionRef.current.language,
          audioBase64: clip.base64,
        });
        if (!sent) {
          settle('连接已断开，录音没发出去');
        }
      } finally {
        finishingRef.current = false;
      }
    },
    [capture, settle],
  );

  const begin = useCallback(() => {
    if (
      finishingRef.current ||
      pressedRef.current ||
      recordingRef.current ||
      transcribingRef.current
    ) {
      return false;
    }
    const blocked = speechBlockedNotice(apiRef.current.catalog);
    if (blocked) {
      apiRef.current.onNotice(blocked);
      return false;
    }
    utteranceRef.current += 1;
    selectionRef.current = {
      providerId: apiRef.current.catalog?.providerId,
      language: apiRef.current.catalog?.language,
    };
    pressedRef.current = true;
    const task = (async () => {
      try {
        await capture.start();
      } catch (failure) {
        pressedRef.current = false;
        apiRef.current.onNotice(failure instanceof Error ? failure.message : '没法开始录音');
        return;
      }
      if (!pressedRef.current) {
        // 开麦过程中就松手了：立刻收尾，别把麦克风丢在那儿。
        try {
          await capture.stop();
        } catch {
          // 收尾失败就当没录过
        }
        return;
      }
      startedAtRef.current = Date.now();
      warnedRef.current = false;
      recordingRef.current = true;
      setElapsed(0);
      setRecording(true);
    })();
    startingRef.current = task;
    void task.then(() => {
      if (startingRef.current === task) startingRef.current = null;
    });
    return true;
  }, [capture]);

  const end = useCallback(() => {
    void finish('release');
  }, [finish]);

  /**
   * 作废当前这一段：还没开录就丢掉这一按，录到一半就关麦，已经发出去在转写的
   * 就撤回。上滑取消、离开页面、转写中点 ✕ 都走这里。
   */
  const abortUtterance = useCallback(() => {
    utteranceRef.current += 1;
    pressedRef.current = false;
    if (recordingRef.current) {
      recordingRef.current = false;
      setRecording(false);
      capture.cancel();
    }
    // 开麦还在路上：begin 那条分支看到意图变了会自己收尾。
    const pending = requestIdRef.current;
    if (pending) {
      settle();
      // 撤回失败只说明连接没了，那边也留不下转写，复位就够了。
      client.send({ type: 'speech-cancel', requestId: randomUUID(), targetRequestId: pending });
    }
  }, [capture, client, settle]);

  const cancel = useCallback(
    (notice?: string) => {
      abortUtterance();
      if (notice) apiRef.current.onNotice(notice);
    },
    [abortUtterance],
  );

  const cancelTranscription = useCallback(() => {
    if (!requestIdRef.current) return;
    abortUtterance();
    apiRef.current.onNotice('已取消转写');
  }, [abortUtterance]);

  const handleTranscript = useCallback(
    (frame: unknown) => {
      const received = frame as { requestId?: string };
      if (!requestIdRef.current || received.requestId !== requestIdRef.current) return;
      const reason = stopReasonRef.current;
      settle();
      const text = transcriptText(frame) ?? '';
      if (!text) {
        apiRef.current.onNotice('没听清，再说一次试试');
        return;
      }
      apiRef.current.onTranscript(text, reason);
    },
    [settle],
  );

  const handleTranscribeFailure = useCallback(
    (failure: { code?: string; requestId?: string; requestType?: string }) => {
      const pending = requestIdRef.current;
      if (!pending) return;
      // 有 requestId 就按它判，只有老网关不带 requestId 时才退回 requestType。
      if (failure.requestId ? failure.requestId !== pending : failure.requestType !== 'speech-transcribe') {
        return;
      }
      settle(transcribeFailureNotice(failure.code));
    },
    [settle],
  );

  // 计时 + 到点自动停。0.5s 一跳和会话页原来的计时一致。
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const seconds = (Date.now() - startedAtRef.current) / 1000;
      setElapsed(seconds);
      if (!warnedRef.current && seconds >= limit - VOICE_ALMOST_UP_SECONDS) {
        warnedRef.current = true;
        tickFeedback();
      }
      if (seconds >= limit - RECORD_MARGIN_SECONDS) void finish('cap');
    }, 500);
    return () => clearInterval(timer);
  }, [finish, limit, recording]);

  // 转写期间断线：网关那边已经作废，本地不能把 transcribing 留在真。
  useEffect(
    () =>
      client.onState((state) => {
        if (state !== 'ready' && transcribingRef.current) {
          settle('连接断了，转写没完成，重连后再试');
        }
      }),
    [client, settle],
  );

  // 离开页面（会话页切走时）放弃未结束的这一段。在途转写也要撤回：
  // 结果回来时没有实例认领，留在网关侧只会占住转写槽位，下一句直接被 speech/busy 拒掉。
  useEffect(() => () => abortUtterance(), [abortUtterance]);

  const almostUp = recording && limit - elapsed <= VOICE_ALMOST_UP_SECONDS;
  return useMemo(
    () => ({
      begin,
      end,
      cancel,
      cancelTranscription,
      handleTranscript,
      handleTranscribeFailure,
      recording,
      transcribing,
      elapsed,
      limit,
      almostUp,
    }),
    [
      begin,
      cancel,
      cancelTranscription,
      elapsed,
      end,
      handleTranscribeFailure,
      handleTranscript,
      almostUp,
      limit,
      recording,
      transcribing,
    ],
  );
}
