import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import {
  applyRealtime,
  mergeSnapshot,
  prependHistory,
  type ChatMessage,
  type QueuedMessage,
} from '../protocol/chat';
import { hrefToPath, isLocalFileHref } from '../protocol/files';
import {
  filterCommands,
  insertTextOf,
  mapCommandGroups,
  mapCommandOptions,
  type CommandGroup,
  type CommandItem,
  type CommandOption,
} from '../protocol/commands';
import type {
  PendingApproval,
  PendingQuestion,
  QuestionAnswer,
} from '../protocol/interactions';
import {
  HISTORY_FORMAT_VERSION,
  type AttachmentFrame,
  type CommandsFrame,
  type CommandExecutedFrame,
  type CommandOptionsFrame,
  type CommandSelectedFrame,
  type HistoryFrame,
  type ImageLimits,
  type ServerFrame,
  type SessionItem,
  type SessionSnapshotFrame,
  type SessionStatsFrame,
} from '../protocol/types';
import {
  mapImageLimits,
  mapTurnOutline,
  readProjectionValues,
  type TurnOutlineItem,
} from '../protocol/outline';
import { FileDownloader } from '../transport/file-download';
import type { GatewayClient } from '../transport/gateway-client';
import { CommandOptionsSheet, CommandPalette } from './CommandPalette';
import { FileCards, type FileUiState } from './FileCards';
import { InteractionSheet } from './InteractionSheet';
import { MarkdownView } from './Markdown';
import { MessageImages } from './MessageImages';
import { OutlineSheet } from './OutlineSheet';

interface Props {
  client: GatewayClient;
  session: SessionItem;
  queued: QueuedMessage[];
  /** hello.capabilities：老网关可能没开文件下载，别把卡片画成一个点了没反应的按钮 */
  capabilities: string[];
  onBack: () => void;
}

interface StreamingDraft {
  attemptId: string;
  text: string;
  reasoning: string;
}

/** 已经选好、还没发出去的图片。 */
interface PickedImage {
  id: string;
  uri: string;
  mediaType: string;
  /** 标准 Base64，不含 data: 前缀 */
  data: string;
  name?: string;
  bytes: number;
}

/** 纯图片消息在气泡里显示成这个，也当作本地回显的去重键。 */
const IMAGE_ONLY_TEXT = '［图片］';

const DEFAULT_IMAGE_LIMITS: ImageLimits = {
  maxImageBytes: 20 * 1024 * 1024,
  maxImagesPerMessage: 20,
  maxMessageImageBytes: 200 * 1024 * 1024,
};

/** Base64 的实际字节数。 */
function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

const TIME_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  } catch {
    return 'Asia/Shanghai';
  }
})();

export function SessionScreen({ client, session, queued, capabilities, onBack }: Props) {
  const canDownloadFiles = capabilities.includes('file-downloads');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState<StreamingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(Boolean(session.running));
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [question, setQuestion] = useState<PendingQuestion | null>(null);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /** 本地乐观回显：点发送立刻出现，等服务端确认后再撤掉。 */
  const [pendingSends, setPendingSends] = useState<
    { id: string; text: string; localUris: string[] }[]
  >([]);
  const [sendMode, setSendMode] = useState<'queue' | 'steer'>('queue');
  /** 待发送图片 */
  const [picked, setPicked] = useState<PickedImage[]>([]);
  const [picking, setPicking] = useState(false);
  /** attachmentId → Base64 字节，历史图片按需拉取后缓存在这里 */
  const [attachmentCache, setAttachmentCache] = useState<Record<string, string>>({});
  const attachmentAskedRef = useRef<Set<string>>(new Set());
  const imageLimitsRef = useRef<ImageLimits>(DEFAULT_IMAGE_LIMITS);
  const [outline, setOutline] = useState<TurnOutlineItem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  /** / 菜单目录：首次输入 / 时拉一次，模式变化后失效。 */
  const [commandGroups, setCommandGroups] = useState<CommandGroup[]>([]);
  const commandRequestedRef = useRef(false);
  /** select 类命令的二级菜单；loading 表示选项还没回来。 */
  const [optionSheet, setOptionSheet] = useState<{
    command: string;
    options: CommandOption[];
    loading: boolean;
  } | null>(null);
  /** 最近一次选择的结果（模型/权限），显示在输入框上方。 */
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [stats, setStats] = useState<SessionStatsFrame | null>(null);
  /** 交付文件的下载状态，键是卡片上的原始路径。 */
  const [fileStates, setFileStates] = useState<Record<string, FileUiState>>({});
  const downloaderRef = useRef<FileDownloader | null>(null);
  /** 点了大纲里的某一轮：要先把历史翻到那个 seq，再滚过去。 */
  const jumpTargetRef = useRef<number | null>(null);
  const oldestSeqRef = useRef<number>(Number.POSITIVE_INFINITY);
  const [jumpTick, setJumpTick] = useState(0);
  /** 用户点了「稍后」：面板收起，但请求仍然挂在服务端，可以随时再打开。 */
  const [sheetHidden, setSheetHidden] = useState(false);
  const settledRef = useRef<Set<string>>(new Set());
  const listRef = useRef<FlatList<ChatMessage>>(null);
  /** 用户往上翻看历史时不要再把他拽回底部。 */
  const atBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  /** 历史分页：hasOlder 表示服务端还有更早的事件，nextBeforeRef 是往回翻的游标。 */
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const nextBeforeRef = useRef<number | undefined>(undefined);
  /** 已经翻到会话最早一条，重连后不要又显示「加载更早」。 */
  const reachedStartRef = useRef(false);
  /** 列表当前的内容高度/滚动位置，用来在往前插历史时手动补偿偏移。 */
  const metricsRef = useRef({ height: 0, offset: 0 });
  /** 非 null 表示「这一帧内容是往前插的」，布局完成后要把视口挪回原处。 */
  const prependAnchorRef = useRef<{ height: number; offset: number } | null>(null);
  /** 非 null 表示「这次 history 请求是翻页」，回来的那一帧要并到前面而不是整体替换。 */
  const olderRequestRef = useRef<number | null>(null);

  const handleFrame = useCallback(
    (frame: ServerFrame) => {
      // 文件传输的帧先交给下载器，它按 requestId / transferId 自己认领。
      if (downloaderRef.current?.handleFrame(frame)) return;
      const kind = frame.kind;
      if (kind === 'history') {
        const history = frame as unknown as HistoryFrame;
        if (history.sessionId && history.sessionId !== session.sessionId) return;
        const events = history.events ?? [];
        // 服务端不回显 beforeSeq，只能靠本地记「这次请求是不是翻页」。
        const paging = olderRequestRef.current !== null;
        olderRequestRef.current = null;
        const next = typeof history.nextBeforeSeq === 'number' ? history.nextBeforeSeq : undefined;
        if (history.hasMore === false) reachedStartRef.current = true;
        const values = readProjectionValues(frame);
        if (values) {
          const nextOutline = mapTurnOutline(values.turnOutline);
          if (nextOutline) setOutline(nextOutline);
          const limits = mapImageLimits(values.imageLimits);
          if (limits) imageLimitsRef.current = { ...DEFAULT_IMAGE_LIMITS, ...limits };
        }
        if (events.length) {
          const pageMin = Math.min(...events.map((event) => event.seq));
          if (pageMin < oldestSeqRef.current) oldestSeqRef.current = pageMin;
        }
        if (paging) {
          // 记下插入前的视口位置，等布局完再补回来（RN 的 maintainVisibleContentPosition
          // 在 Android 上会把位置钉死，导致列表根本划不动）。
          const anchor = { ...metricsRef.current };
          prependAnchorRef.current = anchor;
          // 万一这一页全是重复内容（没引起内容高度变化），别让锚点留到下一帧去误补偿。
          setTimeout(() => {
            if (prependAnchorRef.current === anchor) prependAnchorRef.current = null;
          }, 800);
          setMessages((current) => prependHistory(current, events));
          nextBeforeRef.current = next;
        } else {
          // 重连补的是「最新一页」，已经翻出来的更早历史要留着，不能整体替换。
          setMessages((current) => mergeSnapshot(current, events));
          const prev = nextBeforeRef.current;
          nextBeforeRef.current = typeof prev === 'number' && typeof next === 'number' ? Math.min(prev, next) : (next ?? prev);
        }
        setHasOlder(!reachedStartRef.current && typeof nextBeforeRef.current === 'number');
        setLoadingOlder(false);
        setLoading(false);
        // 历史能正常拉回来，说明之前的报错（比如格式版本不对）已经不影响这次请求了。
        setError(null);
        return;
      }
      if (kind === 'session-snapshot') {
        const snapshot = frame as unknown as SessionSnapshotFrame;
        // 订阅快照不带 sessionId，只属于当前订阅。
        if (snapshot.sessionId && snapshot.sessionId !== session.sessionId) return;
        // 快照只是最新一段（replace 语义只覆盖它自己的区间），不能整体替换掉已翻出来的历史。
        setMessages((current) => mergeSnapshot(current, snapshot.events ?? []));
        const values = readProjectionValues(frame);
        if (values) {
          const nextOutline = mapTurnOutline(values.turnOutline);
          if (nextOutline) setOutline(nextOutline);
          const limits = mapImageLimits(values.imageLimits);
          if (limits) imageLimitsRef.current = { ...DEFAULT_IMAGE_LIMITS, ...limits };
        }
        const snapshotEvents = snapshot.events ?? [];
        if (snapshotEvents.length) {
          const pageMin = Math.min(...snapshotEvents.map((event) => event.seq));
          if (pageMin < oldestSeqRef.current) oldestSeqRef.current = pageMin;
        }
        setLoading(false);
        return;
      }
      if (kind === 'attachment') {
        const attachment = frame as unknown as AttachmentFrame;
        if (attachment.sessionId && attachment.sessionId !== session.sessionId) return;
        if (!attachment.attachment?.attachmentId || typeof attachment.data !== 'string') return;
        setAttachmentCache((current) => ({ ...current, [attachment.attachment.attachmentId]: attachment.data }));
        return;
      }
      if (kind === 'event') {
        const eventFrame = frame as unknown as {
          sessionId?: string;
          seq: number;
          time: number;
          event?: Record<string, any>;
        };
        if (eventFrame.sessionId !== session.sessionId || !eventFrame.event) return;
        const type = eventFrame.event.type;
        if (type === 'turn/start') {
          setRunning(true);
          setCancelling(false);
        }
        // 正式消息已落地，撤掉流式草稿，避免同一段文字出现两份。
        if (type === 'assistant/message') setStreaming(null);
        if (type === 'turn/end') {
          setRunning(false);
          setCancelling(false);
          setStreaming(null);
          const payload = eventFrame.event as Record<string, any>;
          const failure = payload.reasonDetails?.error?.message;
          if (payload.reason === 'aborted') {
            setMessages((current) => [
              ...current,
              { id: 'abort-' + eventFrame.seq, kind: 'notice', text: '已停止本轮', time: eventFrame.time },
            ]);
          }
          if (payload.reason === 'error' && failure) {
            setMessages((current) => [
              ...current,
              {
                id: `err-${eventFrame.seq}`,
                kind: 'assistant',
                text: '',
                failure: String(failure).slice(0, 400),
                time: eventFrame.time,
              },
            ]);
          }
        }
        setMessages((current) => applyRealtime(current, eventFrame.event as Record<string, any>, eventFrame.seq, eventFrame.time));
        return;
      }
      if (kind === 'assistant-stream') {
        const streamFrame = frame as unknown as {
          sessionId?: string;
          frame?: Record<string, any>;
        };
        if (streamFrame.sessionId !== session.sessionId || !streamFrame.frame) return;
        const inner = streamFrame.frame;
        if (inner.type === 'start') {
          setRunning(true);
          setStreaming({ attemptId: String(inner.attemptId ?? ''), text: '', reasoning: '' });
          return;
        }
        if (inner.type === 'chunk') {
          const chunk = (inner.chunk ?? {}) as Record<string, any>;
          setStreaming((current) => {
            if (!current) return current;
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
              return { ...current, text: current.text + chunk.text };
            }
            if ((chunk.type === 'thinking-delta' || chunk.type === 'reasoning-delta') && typeof chunk.text === 'string') {
              return { ...current, reasoning: current.reasoning + chunk.text };
            }
            return current;
          });
          return;
        }
        if (inner.type === 'end') {
          setStreaming(null);
          if (inner.outcome?.kind !== 'committed') setRunning(false);
          return;
        }
        return;
      }
      if (kind === 'approval-requested') {
        const request = frame as unknown as PendingApproval;
        if (request.sessionId !== session.sessionId) return;
        if (settledRef.current.has(request.rpcId)) return;
        setInteractionError(null);
        setApproval(request);
        return;
      }
      if (kind === 'approval-resolved') {
        const resolved = frame as unknown as { rpcId: string; outcome?: string };
        settledRef.current.add(resolved.rpcId);
        setApproval((current) => (current && current.rpcId === resolved.rpcId ? null : current));
        return;
      }
      if (kind === 'approval-response') {
        const receipt = frame as unknown as { rpcId: string; accepted?: boolean; reason?: string };
        if (receipt.accepted === false) {
          setInteractionError(
            receipt.reason === 'not-pending' ? '这次审批已经失效（可能已在别的端处理）' : '审批提交被拒绝，请重试',
          );
        }
        return;
      }
      if (kind === 'question-requested') {
        const request = frame as unknown as PendingQuestion;
        if (request.sessionId !== session.sessionId) return;
        if (settledRef.current.has(request.rpcId)) return;
        setInteractionError(null);
        setQuestion(request);
        return;
      }
      if (kind === 'question-resolved') {
        const resolved = frame as unknown as { rpcId: string; outcome?: string };
        settledRef.current.add(resolved.rpcId);
        setQuestion((current) => (current && current.rpcId === resolved.rpcId ? null : current));
        return;
      }
      if (kind === 'question-response') {
        const receipt = frame as unknown as { accepted?: boolean; reason?: string };
        if (receipt.accepted === false) {
          setInteractionError(
            receipt.reason === 'not-pending' ? '这个问题已经失效（可能已在别的端回答）' : '答案被拒绝，请检查后再提交',
          );
        }
        return;
      }
      if (kind === 'commands') {
        const catalog = frame as unknown as CommandsFrame;
        if (catalog.sessionId && catalog.sessionId !== session.sessionId) return;
        commandRequestedRef.current = true;
        setCommandGroups(mapCommandGroups(catalog.groups));
        return;
      }
      if (kind === 'command-executed') {
        const done = frame as unknown as CommandExecutedFrame;
        if (done.sessionId && done.sessionId !== session.sessionId) return;
        const result = done.result?.text;
        setMessages((current) => [
          ...current,
          {
            id: 'cmd-' + Date.now(),
            kind: 'notice',
            text: result ? done.line + ' · ' + result : done.line + ' 已执行',
            time: Date.now(),
          },
        ]);
        setDraft('');
        setPicked([]);
        return;
      }
      if (kind === 'command-options') {
        const options = frame as unknown as CommandOptionsFrame;
        if (options.sessionId && options.sessionId !== session.sessionId) return;
        setOptionSheet({
          command: options.command,
          options: mapCommandOptions(options.options),
          loading: false,
        });
        return;
      }
      if (kind === 'command-selected') {
        const selected = frame as unknown as CommandSelectedFrame;
        if (selected.sessionId && selected.sessionId !== session.sessionId) return;
        if (selected.selected?.label) setStatusLabel(selected.selected.label);
        setOptionSheet(null);
        setDraft('');
        return;
      }
      if (kind === 'session-stats') {
        const statsFrame = frame as unknown as SessionStatsFrame;
        if (statsFrame.sessionId && statsFrame.sessionId !== session.sessionId) return;
        setStats(statsFrame);
        return;
      }
      if (kind === 'session-cancelled') {
        const result = frame as unknown as { sessionId?: string; accepted?: boolean };
        if (result.sessionId && result.sessionId !== session.sessionId) return;
        if (result.accepted === false) {
          setCancelling(false);
          setError('这一轮已经结束了，没有可停止的任务');
        }
        return;
      }
      if (kind === 'session-stream-reset') {
        setStreaming(null);
        return;
      }
      if (kind === 'error') {
        const failure = frame as unknown as {
          code?: string;
          message?: string;
          requestType?: string;
          requestId?: string;
        };
        // 目录没拉到就允许下次再试，别让一次失败把 / 菜单永久关掉。
        if (failure.requestType === 'commands') commandRequestedRef.current = false;
        setError(`${failure.code ?? 'error'}：${failure.message ?? ''}`);
      }
    },
    [session.sessionId],
  );

  useEffect(() => {
    const off = client.onFrame(handleFrame);
    setLoading(true);
    setMessages([]);
    setStreaming(null);
    setError(null);
    setApproval(null);
    setQuestion(null);
    setInteractionError(null);
    settledRef.current.clear();
    olderRequestRef.current = null;
    nextBeforeRef.current = undefined;
    reachedStartRef.current = false;
    oldestSeqRef.current = Number.POSITIVE_INFINITY;
    jumpTargetRef.current = null;
    attachmentAskedRef.current.clear();
    setHasOlder(false);
    setLoadingOlder(false);
    setOutline([]);
    setAttachmentCache({});
    setPicked([]);
    setCommandGroups([]);
    commandRequestedRef.current = false;
    setOptionSheet(null);
    setStatusLabel(null);
    setStats(null);
    setFileStates({});
    const downloader = new FileDownloader(
      session.sessionId,
      (frame) => client.send(frame),
      (path, state) => setFileStates((current) => ({ ...current, [path]: state })),
    );
    downloaderRef.current = downloader;
    client.send({ type: 'subscribe', sessionId: session.sessionId, assistantStream: true });
    client.send({
      type: 'history',
      sessionId: session.sessionId,
      view: 'conversation',
      historyFormatVersion: HISTORY_FORMAT_VERSION,
    });
    client.send({ type: 'session-stats', sessionId: session.sessionId });
    return () => {
      off();
      downloader.dispose();
      if (downloaderRef.current === downloader) downloaderRef.current = null;
      client.send({ type: 'unsubscribe' });
    };
  }, [client, handleFrame, session.sessionId]);

  // 断线重连后服务端不再记得我们的订阅，必须重新订阅并补一次历史，
  // 否则回到前台会一直看着断线前的旧内容。
  useEffect(() => {
    const off = client.onState((state) => {
      if (state !== 'ready') return;
      // 重连补的是「最新一页」，不能和还挂着的翻页请求混在一起。
      olderRequestRef.current = null;
      setLoadingOlder(false);
      client.send({ type: 'subscribe', sessionId: session.sessionId, assistantStream: true });
      client.send({
        type: 'history',
        sessionId: session.sessionId,
        view: 'conversation',
        historyFormatVersion: HISTORY_FORMAT_VERSION,
      });
      client.send({ type: 'session-stats', sessionId: session.sessionId });
    });
    return off;
  }, [client, session.sessionId]);

  /** 往回翻一页。服务端用排他游标，拿到 nextBeforeSeq 就再要 seq < nextBeforeSeq 的那一段。 */
  const loadOlder = useCallback(() => {
    // 用 ref 而不是 state 做在途判断：连续两帧的 onScroll 都会在 setState 生效前进来，
    // 发两次同样的请求会让第二帧被当成「整体替换」，历史直接被冲掉。
    if (olderRequestRef.current !== null) return;
    const before = nextBeforeRef.current;
    if (typeof before !== 'number') return;
    olderRequestRef.current = before;
    setLoadingOlder(true);
    const sent = client.send({
      type: 'history',
      sessionId: session.sessionId,
      view: 'conversation',
      beforeSeq: before,
      // 带游标的请求必须声明格式版本，否则服务端回 history-format-mismatch。
      historyFormatVersion: HISTORY_FORMAT_VERSION,
    });
    if (!sent) {
      olderRequestRef.current = null;
      setLoadingOlder(false);
      return;
    }
    // 万一这一帧丢了，别让顶部一直转圈。
    setTimeout(() => {
      if (olderRequestRef.current === before) {
        olderRequestRef.current = null;
        setLoadingOlder(false);
      }
    }, 12000);
  }, [client, session.sessionId]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      metricsRef.current = { height: contentSize.height, offset: contentOffset.y };
      const distance = contentSize.height - contentOffset.y - layoutMeasurement.height;
      const near = distance < 80;
      atBottomRef.current = near;
      setShowJump(!near);
      // 快滑到顶就自动补一页，不用用户去点；内容比一屏还短时不自动翻，避免连锁拉全量。
      if (contentOffset.y < 120 && hasOlder && contentSize.height > layoutMeasurement.height + 200) {
        loadOlder();
      }
    },
    [hasOlder, loadOlder],
  );

  const jumpToBottom = useCallback(() => {
    atBottomRef.current = true;
    setShowJump(false);
    // 不用动画：长会话里动画要滚很久，中途还会触发一堆 onScroll 把翻页逻辑带起来。
    listRef.current?.scrollToEnd({ animated: false });
  }, []);

  // 键盘弹出会把列表可视区压小，滚到最底才能看见自己刚打的字。
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    });
    return () => sub.remove();
  }, []);

  // 新请求进来就重新展开面板；同一个请求被收起后不会再自动弹。
  const requestKey = approval?.rpcId ?? question?.rpcId ?? '';
  useEffect(() => {
    if (requestKey) setSheetHidden(false);
  }, [requestKey]);

  const respondApproval = useCallback(
    (outcome: 'allowed-once' | 'rejected') => {
      if (!approval) return;
      client.send({
        type: 'approval-response',
        rpcId: approval.rpcId,
        sessionId: approval.sessionId,
        approvalId: approval.approvalId,
        outcome,
      });
      setInteractionError(null);
    },
    [approval, client],
  );

  const answerQuestion = useCallback(
    (answers: QuestionAnswer[]) => {
      if (!question) return;
      client.send({
        type: 'question-answer',
        rpcId: question.rpcId,
        sessionId: question.sessionId,
        answers,
      });
      setInteractionError(null);
    },
    [client, question],
  );

  const cancelQuestion = useCallback(() => {
    if (!question) return;
    client.send({ type: 'question-cancel', rpcId: question.rpcId, sessionId: question.sessionId });
    setInteractionError(null);
  }, [client, question]);

  const requestAttachment = useCallback(
    (attachmentId: string) => {
      if (attachmentAskedRef.current.has(attachmentId)) return;
      attachmentAskedRef.current.add(attachmentId);
      client.send({ type: 'attachment', sessionId: session.sessionId, attachmentId });
    },
    [client, session.sessionId],
  );

  const addPicked = useCallback((items: PickedImage[]) => {
    const limits = imageLimitsRef.current;
    const maxBytes = limits.maxImageBytes ?? DEFAULT_IMAGE_LIMITS.maxImageBytes ?? 0;
    const maxCount = limits.maxImagesPerMessage ?? DEFAULT_IMAGE_LIMITS.maxImagesPerMessage ?? 0;
    const maxTotal = limits.maxMessageImageBytes ?? DEFAULT_IMAGE_LIMITS.maxMessageImageBytes ?? 0;
    setPicked((current) => {
      const next = [...current];
      for (const item of items) {
        if (item.bytes > maxBytes) {
          Alert.alert('图片太大', `${item.name ?? '这张图'} 有 ${formatBytes(item.bytes)}，单张上限是 ${formatBytes(maxBytes)}。`);
          continue;
        }
        if (next.length >= maxCount) {
          Alert.alert('图片太多', `一条消息最多 ${maxCount} 张。`);
          break;
        }
        const total = next.reduce((sum, entry) => sum + entry.bytes, 0);
        if (total + item.bytes > maxTotal) {
          Alert.alert('总大小超限', `一条消息的图片总计不能超过 ${formatBytes(maxTotal)}。`);
          break;
        }
        next.push(item);
      }
      return next;
    });
  }, []);

  const pickImage = useCallback(
    (source: 'library' | 'camera') => {
      void (async () => {
        try {
          setPicking(true);
          if (source === 'camera') {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
              Alert.alert('没有相机权限', '请在系统设置里允许 DSH 使用相机。');
              return;
            }
          }
          const options: ImagePicker.ImagePickerOptions = {
            mediaTypes: ['images'],
            base64: true,
            quality: 0.8,
            allowsMultipleSelection: source === 'library',
            selectionLimit: 9,
          };
          const result =
            source === 'camera'
              ? await ImagePicker.launchCameraAsync(options)
              : await ImagePicker.launchImageLibraryAsync(options);
          if (result.canceled) return;
          const items: PickedImage[] = [];
          for (const asset of result.assets) {
            if (!asset.base64) continue;
            items.push({
              id: asset.assetId ?? asset.uri + ':' + Date.now() + ':' + items.length,
              uri: asset.uri,
              mediaType: asset.mimeType ?? 'image/jpeg',
              data: asset.base64,
              name: asset.fileName ?? undefined,
              bytes: base64Bytes(asset.base64),
            });
          }
          addPicked(items);
        } catch (failure) {
          Alert.alert('选择图片失败', failure instanceof Error ? failure.message : String(failure));
        } finally {
          setPicking(false);
        }
      })();
    },
    [addPicked],
  );

  const askImageSource = useCallback(() => {
    Alert.alert('添加图片', undefined, [
      { text: '拍照', onPress: () => pickImage('camera') },
      { text: '从相册选择', onPress: () => pickImage('library') },
      { text: '取消', style: 'cancel' },
    ]);
  }, [pickImage]);

  /** 点文件卡片：没下过就下，下过就直接打开。 */
  const openFile = useCallback((path: string) => {
    downloaderRef.current?.open(path);
  }, []);

  const removePicked = useCallback((id: string) => {
    setPicked((current) => current.filter((item) => item.id !== id));
  }, []);

  // 一轮跑完 token/上下文都会变，重新拉一次统计条；挂载时也顺便做一次基线。
  useEffect(() => {
    if (running) return;
    client.send({ type: 'session-stats', sessionId: session.sessionId });
  }, [client, running, session.sessionId]);

  // 输入 / 之后才拉目录：服务端按会话的 agent preset 和工作目录裁剪，缓存不能跨会话复用。
  useEffect(() => {
    if (!draft.startsWith('/')) return;
    if (commandRequestedRef.current) return;
    commandRequestedRef.current = true;
    client.send({ type: 'commands', sessionId: session.sessionId, locale: 'zh-CN' });
  }, [client, draft, session.sessionId]);

  const pickCommand = useCallback(
    (item: CommandItem) => {
      const ui = item.ui;
      if (!ui) {
        setDraft(insertTextOf(item));
        return;
      }
      if (ui.kind === 'immediate') {
        const line = ui.submitText ?? '/' + item.name;
        const images =
          ui.images && picked.length
            ? picked.map((image) => ({
                mediaType: image.mediaType,
                data: image.data,
                name: image.name,
              }))
            : undefined;
        const sent = client.send({
          type: 'command-execute',
          sessionId: session.sessionId,
          line,
          images,
        });
        if (!sent) {
          setError('连接已断开，命令未发送');
          return;
        }
        setDraft('');
        setPicked([]);
        Keyboard.dismiss();
        return;
      }
      if (ui.kind === 'select') {
        setDraft(insertTextOf(item));
        setOptionSheet({ command: item.name, options: [], loading: true });
        const sent = client.send({
          type: (ui.optionsRequest ?? 'command-options') as 'command-options',
          sessionId: session.sessionId,
          command: item.name,
        });
        if (!sent) {
          setOptionSheet(null);
          setError('连接已断开，无法加载选项');
        }
        return;
      }
      // input：只把 insertText 写进草稿，发送时仍然走 message。
      setDraft(insertTextOf(item));
    },
    [client, picked, session.sessionId],
  );

  const chooseOption = useCallback(
    (option: CommandOption) => {
      const sheet = optionSheet;
      if (!sheet) return;
      client.send({
        type: 'command-select',
        sessionId: session.sessionId,
        command: sheet.command,
        optionId: option.id,
      });
      setOptionSheet(null);
    },
    [client, optionSheet, session.sessionId],
  );

  const cancelTurn = useCallback(() => {
    if (!running || cancelling) return;
    setCancelling(true);
    setError(null);
    const sent = client.send({ type: 'session-cancel', sessionId: session.sessionId });
    if (!sent) {
      setCancelling(false);
      setError('连接已断开，无法停止');
      return;
    }
    // 万一 turn/end 没回来（比如这一轮刚好自己结束了），别让按钮一直卡在「停止中」。
    setTimeout(() => setCancelling(false), 10000);
  }, [cancelling, client, running, session.sessionId]);

  const send = useCallback(() => {
    const text = draft.trim();
    const images = picked;
    if (!text && images.length === 0) return;
    const sent = client.send({
      type: 'message',
      sessionId: session.sessionId,
      text,
      clientTimeZone: TIME_ZONE,
      mode: running ? sendMode : 'queue',
      images: images.length
        ? images.map((item) => ({ mediaType: item.mediaType, data: item.data, name: item.name }))
        : undefined,
    });
    if (sent) {
      setDraft('');
      setPicked([]);
      setPendingSends((current) => [
        ...current,
        {
          id: String(Date.now()),
          // 纯图片消息没有文本，用一个占位串当去重键，否则回显永远撤不掉。
          text: text || IMAGE_ONLY_TEXT,
          localUris: images.map((item) => item.uri),
        },
      ]);
      setRunning(true);
      // 自己发消息一定是要看最新进展的。
      atBottomRef.current = true;
      setShowJump(false);
      listRef.current?.scrollToEnd({ animated: true });
    } else {
      setError('连接已断开，消息未发送');
    }
  }, [client, draft, picked, running, sendMode, session.sessionId]);

  const removeQueued = useCallback(
    (queueId: string) => {
      client.send({ type: 'queue-update', sessionId: session.sessionId, itemId: queueId, action: 'remove' });
    },
    [client, session.sessionId],
  );

  const steerQueued = useCallback(
    (queueId: string) => {
      client.send({ type: 'queue-update', sessionId: session.sessionId, itemId: queueId, action: 'steer' });
    },
    [client, session.sessionId],
  );

  // 服务端确认之后（队列里出现 / 正式消息落地）就撤掉本地回显。
  useEffect(() => {
    if (pendingSends.length === 0) return;
    const seen = new Set<string>();
    for (const item of queued) if (item.text) seen.add(item.text);
    for (const message of messages) {
      if (message.kind !== 'user') continue;
      const key = message.text || (message.images?.length ? IMAGE_ONLY_TEXT : '');
      if (key) seen.add(key);
    }
    setPendingSends((current) => {
      const next = current.filter((item) => !seen.has(item.text));
      return next.length === current.length ? current : next;
    });
  }, [messages, pendingSends.length, queued]);

  const baseRows: ChatMessage[] = useMemo(() => (streaming
    ? [
        ...messages,
        {
          id: `stream-${streaming.attemptId}`,
          kind: 'assistant',
          text: streaming.text,
          reasoning: streaming.reasoning || undefined,
          time: Date.now(),
          streaming: true,
        },
      ]
    : messages), [messages, streaming]);

  const rows: ChatMessage[] = useMemo(
    () => [
      ...baseRows,
      ...queued.map((item) => ({
        id: `queue-${item.id}`,
        kind: 'queued' as const,
        text: item.text,
        time: 0,
        queueId: item.id,
        placement: item.placement,
      })),
      ...pendingSends.map((item) => ({
        id: `pending-${item.id}`,
        kind: 'queued' as const,
        text: item.text,
        time: 0,
        queueId: '',
        pending: true,
        localUris: item.localUris,
      })),
    ],
    [baseRows, pendingSends, queued],
  );

  const canSend = Boolean(draft.trim() || picked.length);

  // / 之后还没打空格时才弹目录；打了空格说明在写参数，别挡着输入框。
  const slashQuery = draft.startsWith('/') ? draft.slice(1) : null;
  const paletteGroups = useMemo(() => {
    if (slashQuery === null || /\s/.test(slashQuery)) return [];
    return filterCommands(commandGroups, slashQuery);
  }, [commandGroups, slashQuery]);
  const statsLine = useMemo(() => describeStats(stats), [stats]);

  /**
   * 跳到某一轮：rows 里找到第一条 seq >= 目标的事件就滚过去。
   * 还没加载到那一段就先往回翻页，翻到之后这个 effect 会因为 rows 变化再跑一次。
   */
  useEffect(() => {
    const target = jumpTargetRef.current;
    if (target === null) return;
    const index = rows.findIndex((row) => {
      const seq = (row as { seq?: number }).seq;
      return typeof seq === 'number' && seq >= target;
    });
    if (index >= 0) {
      jumpTargetRef.current = null;
      atBottomRef.current = false;
      setTimeout(() => listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 }), 60);
      return;
    }
    if (hasOlder) loadOlder();
  }, [hasOlder, jumpTick, loadOlder, rows]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {session.projections?.values.title ?? '未命名会话'}
        </Text>
        {outline.length > 0 ? (
          <Pressable style={styles.outlineButton} onPress={() => setOutlineOpen(true)}>
            <Text style={styles.outlineText}>轮次</Text>
          </Pressable>
        ) : null}
        {running ? (
          <View style={styles.headerActions}>
            <ActivityIndicator size="small" color="#3DDC97" />
            <Pressable
              style={[styles.stopButton, cancelling ? styles.stopDisabled : null]}
              onPress={cancelTurn}
              disabled={cancelling}
            >
              <Text style={styles.stopText}>{cancelling ? '停止中' : '停止'}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={8}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#8A90A0" />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(item) => item.id}
            // 下载进度只改 fileStates，不刷新 data；不给 extraData 卡片状态根本不会重绘。
            extraData={fileStates}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onScrollToIndexFailed={(info) => {
              // 目标行还没渲染出来时 FlatList 会失败，先按平均行高估个位置再重试。
              listRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: false,
              });
              setTimeout(
                () => listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 }),
                160,
              );
            }}
            onContentSizeChange={(_width, height) => {
              const anchor = prependAnchorRef.current;
              if (anchor) {
                prependAnchorRef.current = null;
                const added = height - anchor.height;
                if (added > 0) {
                  // 前面插进来多少，就把视口往下推多少，用户看到的那一行原地不动。
                  const offset = anchor.offset + added;
                  metricsRef.current = { height, offset };
                  listRef.current?.scrollToOffset({ offset, animated: false });
                  return;
                }
              }
              metricsRef.current = { height, offset: metricsRef.current.offset };
              if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: true });
            }}
            ListHeaderComponent={
              <View style={styles.olderWrap}>
                {loadingOlder ? (
                  <ActivityIndicator size="small" color="#8A90A0" />
                ) : hasOlder ? (
                  <Pressable onPress={loadOlder} hitSlop={10}>
                    <Text style={styles.olderAction}>加载更早的消息</Text>
                  </Pressable>
                ) : messages.length > 0 ? (
                  <Text style={styles.olderEnd}>已经是最早的消息</Text>
                ) : null}
              </View>
            }
            ListEmptyComponent={<Text style={styles.empty}>还没有消息</Text>}
            renderItem={({ item }) => (
              <MessageRow
                message={item}
                attachmentCache={attachmentCache}
                onNeedAttachment={requestAttachment}
                onRemoveQueued={removeQueued}
                onSteerQueued={steerQueued}
                fileStates={fileStates}
                onOpenFile={openFile}
                canDownloadFiles={canDownloadFiles}
              />
            )}
          />
        )}

        <InteractionSheet
          approval={approval}
          question={question}
          error={interactionError}
          hidden={sheetHidden}
          onDismiss={() => setSheetHidden(true)}
          onApproval={respondApproval}
          onAnswer={answerQuestion}
          onCancelQuestion={cancelQuestion}
        />

        {sheetHidden && (approval || question) ? (
          <Pressable style={styles.pendingBar} onPress={() => setSheetHidden(false)}>
            <View style={styles.pendingBarDot} />
            <Text style={styles.pendingBarText} numberOfLines={1}>
              {approval
                ? approval.toolName
                  ? '待审批 · ' + approval.toolName
                  : '待审批'
                : '待回答 · ' + (question?.questions.length ?? 1) + ' 个问题'}
            </Text>
            <Text style={styles.pendingBarAction}>打开</Text>
          </Pressable>
        ) : null}

        <CommandOptionsSheet
          state={optionSheet}
          onClose={() => setOptionSheet(null)}
          onPick={chooseOption}
        />

        <OutlineSheet
          visible={outlineOpen}
          items={outline}
          onClose={() => setOutlineOpen(false)}
          onPick={(item) => {
            jumpTargetRef.current = item.seq;
            // 跳转期间别再让「回到底部」的自动跟随生效。
            atBottomRef.current = false;
            setOutlineOpen(false);
            setJumpTick((value) => value + 1);
          }}
        />

        <View>
          {picked.length > 0 ? (
            <View style={styles.pickedRow}>
              {picked.map((item) => (
                <View key={item.id} style={styles.pickedItem}>
                  <Image source={{ uri: item.uri }} style={styles.pickedImage} resizeMode="cover" />
                  <Pressable style={styles.pickedRemove} onPress={() => removePicked(item.id)} hitSlop={6}>
                    <Text style={styles.pickedRemoveText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {showJump ? (
            <View pointerEvents="box-none" style={styles.jumpWrap}>
              <Pressable style={styles.jump} onPress={jumpToBottom}>
                <Text style={styles.jumpText}>回到底部</Text>
              </Pressable>
            </View>
          ) : null}
          {running ? (
            <View style={styles.modeRow}>
              <Text style={styles.modeLabel}>发送方式</Text>
              <Pressable
                style={[styles.modeChip, sendMode === 'queue' ? styles.modeChipOn : null]}
                onPress={() => setSendMode('queue')}
              >
                <Text style={[styles.modeText, sendMode === 'queue' ? styles.modeTextOn : null]}>排队</Text>
              </Pressable>
              <Pressable
                style={[styles.modeChip, sendMode === 'steer' ? styles.modeChipOn : null]}
                onPress={() => setSendMode('steer')}
              >
                <Text style={[styles.modeText, sendMode === 'steer' ? styles.modeTextOn : null]}>插话</Text>
              </Pressable>
              <Text style={styles.modeHint}>
                {sendMode === 'steer' ? '立即插入当前回合' : '这一轮结束后发送'}
              </Text>
            </View>
          ) : null}
          {statusLabel || statsLine ? (
            <View style={styles.statusBar}>
              {statusLabel ? <Text style={styles.statusChip}>{statusLabel}</Text> : null}
              {statsLine ? (
                <Text style={styles.statusMeta} numberOfLines={1}>
                  {statsLine}
                </Text>
              ) : null}
            </View>
          ) : null}
          <CommandPalette groups={paletteGroups} onPick={pickCommand} />
          <View style={styles.composer}>
            <Pressable
              style={[styles.attach, picking ? styles.attachDisabled : null]}
              onPress={askImageSource}
              disabled={picking}
            >
              {picking ? (
                <ActivityIndicator size="small" color="#8A90A0" />
              ) : (
                <Text style={styles.attachText}>＋</Text>
              )}
            </Pressable>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="发消息…"
              placeholderTextColor="#5B6070"
              multiline
            />
            <Pressable
              style={[styles.send, !canSend && styles.sendDisabled]}
              disabled={!canSend}
              onPress={send}
            >
              <Text style={styles.sendText}>发送</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** 128000 → 128k，1500 → 1.5k，方便塞进一行统计条。 */
function compactTokens(value: number): string {
  if (value >= 100000) return Math.round(value / 1000) + 'k';
  if (value >= 1000) return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(value);
}

/** 缓存命中率：命中读占「计费输入 + 缓存读 + 缓存写」的比例。 */
function cacheHitPercent(totals?: {
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number | null {
  if (!totals) return null;
  const read = totals.cacheReadTokens ?? 0;
  const total = (totals.inputTokens ?? 0) + read + (totals.cacheWriteTokens ?? 0);
  if (total <= 0) return null;
  return Math.round((read / total) * 100);
}

function describeStats(stats: SessionStatsFrame | null): string | null {
  if (!stats) return null;
  const parts: string[] = [];
  const sessionStats = stats.sessionStats;
  if (typeof sessionStats?.turns === 'number') parts.push('轮次 ' + sessionStats.turns);
  if (typeof sessionStats?.steps === 'number') parts.push('步骤 ' + sessionStats.steps);
  const pressure = stats.contextPressure;
  if (typeof pressure?.pressureTokens === 'number' && typeof pressure?.contextWindow === 'number') {
    parts.push('上下文 ' + compactTokens(pressure.pressureTokens) + '/' + compactTokens(pressure.contextWindow));
  }
  const cache = cacheHitPercent(stats.tokenUsage?.totals);
  if (cache !== null) parts.push('缓存 ' + cache + '%');
  return parts.length ? parts.join(' · ') : null;
}

function parseArgs(args?: string): Record<string, any> | null {
  if (!args) return null;
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** 把工具参数压成一行人类可读的摘要。 */
function describeTool(name: string, args?: string): string {
  const parsed = parseArgs(args);
  if (!parsed) return (args ?? '').replace(/\s+/g, ' ').slice(0, 160);
  const pick = (key: string) => (typeof parsed[key] === 'string' ? (parsed[key] as string) : undefined);
  switch (name) {
    case 'bash':
    case 'shell':
      return pick('description') ?? pick('command')?.split('\n')[0] ?? '';
    case 'read':
    case 'write':
    case 'edit':
      return pick('file_path') ?? pick('path') ?? '';
    case 'grep':
      return `/${pick('pattern') ?? ''}/ ${pick('path') ?? ''}`.trim();
    case 'glob':
      return pick('pattern') ?? '';
    default: {
      const first = Object.values(parsed).find((value) => typeof value === 'string');
      return typeof first === 'string' ? first.slice(0, 120) : '';
    }
  }
}

function toolCommand(name: string, args?: string): string | undefined {
  if (name !== 'bash' && name !== 'shell') return undefined;
  const parsed = parseArgs(args);
  const command = parsed?.command;
  return typeof command === 'string' ? command.trim() : undefined;
}

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 120;
  return (
    <Pressable onPress={long ? () => setOpen((value) => !value) : undefined} disabled={!long}>
      <Text style={styles.reasoning} numberOfLines={open ? undefined : 3}>
        <Text style={styles.reasoningTag}>思考 </Text>
        {text}
      </Text>
      {long ? <Text style={styles.reasoningToggle}>{open ? '收起' : '展开'}</Text> : null}
    </Pressable>
  );
}

function MessageRow({
  message,
  attachmentCache,
  onNeedAttachment,
  onRemoveQueued,
  onSteerQueued,
  fileStates,
  onOpenFile,
  canDownloadFiles,
}: {
  message: ChatMessage;
  attachmentCache: Record<string, string>;
  onNeedAttachment: (attachmentId: string) => void;
  onRemoveQueued: (queueId: string) => void;
  onSteerQueued: (queueId: string) => void;
  fileStates: Record<string, FileUiState>;
  onOpenFile: (path: string) => void;
  canDownloadFiles: boolean;
}) {
  const [toolOpen, setToolOpen] = useState(false);
  if (message.kind === 'files') {
    // 网关没开文件下载能力时，卡片只会是个点不动的按钮，直接不画。
    if (!canDownloadFiles) return null;
    return (
      <View style={styles.filesRow}>
        <FileCards files={message.files} states={fileStates} onOpen={onOpenFile} />
      </View>
    );
  }
  if (message.kind === 'queued') {
    const steering = message.placement === 'steering';
    return (
      <View style={[styles.bubbleRow, styles.rowRight]}>
        <View style={[styles.bubble, styles.bubbleUser, styles.bubbleQueued]}>
          {message.localUris?.length ? (
            <View style={styles.localImages}>
              {message.localUris.map((uri) => (
                <Image key={uri} source={{ uri }} style={styles.localImage} resizeMode="cover" />
              ))}
            </View>
          ) : null}
          {message.text ? <Text style={styles.bubbleText}>{message.text}</Text> : null}
          <View style={styles.queuedFooter}>
            <Text style={styles.queuedTag}>
              {message.pending ? '发送中…' : steering ? '插话中 · 下一步生效' : '排队中'}
            </Text>
            {message.pending ? null : (
              <View style={styles.queuedActions}>
                {steering ? null : (
                  <Pressable hitSlop={8} onPress={() => onSteerQueued(message.queueId)}>
                    <Text style={styles.queuedAction}>插话发送</Text>
                  </Pressable>
                )}
                <Pressable hitSlop={8} onPress={() => onRemoveQueued(message.queueId)}>
                  <Text style={styles.queuedAction}>撤回</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  }
  if (message.kind === 'notice') {
    return (
      <View style={styles.noticeRow}>
        <Text style={styles.noticeText}>{message.text}</Text>
      </View>
    );
  }
  if (message.kind === 'tool') {
    const command = toolCommand(message.name, message.args);
    const summary = describeTool(message.name, message.args);
    const output = message.output?.trim();
    // Host 的 isError 不反映 shell 退出码，输出末尾的 [exit code: N] 才是。
    const exitCode = output ? /\[exit code: (-?\d+)\]\s*$/.exec(output) : null;
    const failed = Boolean(message.isError) || Boolean(exitCode && exitCode[1] !== '0');
    const expandable = Boolean(command || output);
    return (
      <Pressable
        style={[styles.toolCard, failed ? styles.toolCardError : null]}
        onPress={expandable ? () => setToolOpen((value) => !value) : undefined}
        disabled={!expandable}
      >
        <View style={styles.toolHeader}>
          <Text style={styles.toolName}>{message.name}</Text>
          <Text style={styles.toolSummary} numberOfLines={1}>
            {summary}
          </Text>
          {failed ? (
            <Text style={styles.toolError}>{exitCode ? '退出码 ' + exitCode[1] : '失败'}</Text>
          ) : null}
        </View>
        {command && (toolOpen || command !== summary) ? (
          <Text style={styles.toolCommand} numberOfLines={toolOpen ? undefined : 2}>
            {command}
          </Text>
        ) : null}
        {output ? (
          <Text style={styles.toolBody} numberOfLines={toolOpen ? undefined : 5}>
            {output}
          </Text>
        ) : (
          <Text style={styles.toolPending}>运行中…</Text>
        )}
        {expandable ? <Text style={styles.toolMore}>{toolOpen ? '收起' : '展开全部'}</Text> : null}
      </Pressable>
    );
  }
  const isUser = message.kind === 'user';
  return (
    <View style={[styles.bubbleRow, isUser ? styles.rowRight : styles.rowLeft]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {message.kind === 'assistant' && message.reasoning ? (
          <Reasoning text={message.reasoning} />
        ) : null}
        {isUser ? (
          <>
            {message.images?.length ? (
              <MessageImages
                refs={message.images}
                cache={attachmentCache}
                onNeed={onNeedAttachment}
              />
            ) : null}
            {message.text ? <Text style={styles.bubbleText}>{message.text}</Text> : null}
          </>
        ) : message.text ? (
          <MarkdownView text={message.text} onFileLink={canDownloadFiles ? onOpenFile : undefined} />
        ) : (
          <Text style={styles.bubbleText}>{message.streaming ? '…' : ''}</Text>
        )}
        {message.kind === 'assistant' && message.failure ? (
          <Text style={styles.failure}>{message.failure}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0C0F' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  back: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  backText: { color: '#EDEFF3', fontSize: 28, lineHeight: 30 },
  title: { flex: 1, color: '#EDEFF3', fontSize: 16, fontWeight: '600' },
  placeholder: { width: 20 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#2A1A1C',
  },
  stopDisabled: { opacity: 0.5 },
  stopText: { color: '#FF7A7A', fontSize: 12, fontWeight: '600' },
  error: { color: '#FF7A7A', fontSize: 12, paddingHorizontal: 16, paddingBottom: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 14, paddingBottom: 12 },
  empty: { color: '#5B6070', textAlign: 'center', marginTop: 40 },
  olderWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, minHeight: 44 },
  olderAction: { color: '#7E8698', fontSize: 13, fontWeight: '600' },
  olderEnd: { color: '#4A4F5C', fontSize: 12 },
  bubbleRow: { flexDirection: 'row', marginBottom: 10 },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '86%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: '#2B6BFF' },
  bubbleQueued: { backgroundColor: '#1E3A66' },
  queuedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 4,
  },
  queuedTag: { color: '#7E9CC9', fontSize: 10 },
  queuedActions: { flexDirection: 'row', gap: 12 },
  queuedAction: { color: '#8FB6FF', fontSize: 10, fontWeight: '600' },
  // 助手消息可能带表格/代码块，撑满整行才能算出可滚动的宽度。
  bubbleAssistant: { backgroundColor: '#15171C', flexGrow: 1, maxWidth: '100%' },
  bubbleText: { color: '#EDEFF3', fontSize: 15, lineHeight: 21 },
  reasoning: { color: '#6E7585', fontSize: 12, lineHeight: 17, marginBottom: 6, fontStyle: 'italic' },
  reasoningTag: { color: '#4C5261', fontStyle: 'normal' },
  reasoningToggle: { color: '#4C5261', fontSize: 11, marginTop: 2, marginBottom: 6 },
  failure: { color: '#FF7A7A', fontSize: 12, marginTop: 6 },
  toolCard: {
    backgroundColor: '#101216',
    borderWidth: 1,
    borderColor: '#1E2128',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  toolCardError: { borderColor: '#4A2326' },
  toolHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolName: {
    color: '#8FB6FF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  toolSummary: { flex: 1, color: '#C9CDD6', fontSize: 13 },
  toolError: { color: '#FF7A7A', fontSize: 11 },
  toolCommand: {
    color: '#6E7585',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  toolBody: {
    color: '#9AA1B0',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1E2128',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  toolPending: { color: '#5B6070', fontSize: 11, marginTop: 6 },
  toolMore: { color: '#4C5261', fontSize: 10, marginTop: 6 },
  filesRow: { paddingHorizontal: 2, marginBottom: 10 },
  noticeRow: { alignItems: 'center', marginVertical: 8 },
  noticeText: {
    color: '#5B6070',
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 24,
    lineHeight: 16,
  },
  pendingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#241D12',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3A2A12',
  },
  pendingBarDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F5B84C' },
  pendingBarText: { flex: 1, color: '#F5B84C', fontSize: 13 },
  pendingBarAction: { color: '#F5B84C', fontSize: 13, fontWeight: '700' },
  jumpWrap: {
    position: 'absolute',
    top: -44,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  jump: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#1B1E25',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2B303B',
  },
  jumpText: { color: '#C9CDD6', fontSize: 12 },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  modeLabel: { color: '#5B6070', fontSize: 11, marginRight: 2 },
  modeChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#15171C' },
  modeChipOn: { backgroundColor: '#22304A' },
  modeText: { color: '#7A8091', fontSize: 11 },
  modeTextOn: { color: '#8FB6FF', fontWeight: '600' },
  modeHint: { color: '#4C5261', fontSize: 11, marginLeft: 4 },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  statusChip: {
    color: '#8FB6FF',
    fontSize: 10.5,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#1A2233',
  },
  statusMeta: { flex: 1, color: '#4C5261', fontSize: 10.5 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1E2128',
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    backgroundColor: '#15171C',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    color: '#EDEFF3',
    fontSize: 15,
  },
  send: {
    marginLeft: 8,
    backgroundColor: '#F5F6F8',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendDisabled: { opacity: 0.3 },
  sendText: { color: '#0B0C0F', fontSize: 14, fontWeight: '600' },
  localImages: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  localImage: { width: 120, height: 90, borderRadius: 8, backgroundColor: '#1B1E25' },
  attach: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: '#15171C',
  },
  attachDisabled: { opacity: 0.4 },
  attachText: { color: '#8A90A0', fontSize: 20, lineHeight: 22 },
  pickedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  pickedItem: { position: 'relative' },
  pickedImage: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#1B1E25' },
  pickedRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2A2E37',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickedRemoveText: { color: '#C9CDD6', fontSize: 12, lineHeight: 14, fontWeight: '700' },
  outlineButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#1B1E25',
  },
  outlineText: { color: '#C9CDD6', fontSize: 12, fontWeight: '600' },
});
