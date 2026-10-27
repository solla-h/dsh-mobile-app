import * as Clipboard from 'expo-clipboard';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
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
  type SelectAgentPresetFrame,
  type SessionAgentPresetFrame,
  type SessionAgentPresetUpdatedFrame,
  type SessionStatsFrame,
} from '../protocol/types';
import {
  mapImageLimits,
  mapTurnOutline,
  readProjectionValues,
  type TurnOutlineItem,
} from '../protocol/outline';
import { mapPresetList, presetName, type PresetList } from '../protocol/presets';
import { goalRef, mapGoal, mapTodos, type GoalInfo, type TodoItem } from '../protocol/tasks';
import { FileDownloader } from '../transport/file-download';
import { FileUploader, type UploadState } from '../transport/file-upload';
import { loadDraft, saveDraft } from '../storage/drafts';
import { outbox, type OutboxItem } from '../transport/outbox';
import type { GatewayClient } from '../transport/gateway-client';
import { ActionSheet, type SheetAction } from './ActionSheet';
import { CommandOptionsSheet, CommandPalette } from './CommandPalette';
import { FileCards, type FileUiState } from './FileCards';
import { tapFeedback } from './haptics';
import { InteractionSheet } from './InteractionSheet';
import { MarkdownView } from './Markdown';
import { ImageViewer, MessageImages } from './MessageImages';
import { OutlineSheet } from './OutlineSheet';
import { TasksSheet } from './TasksSheet';

interface Props {
  client: GatewayClient;
  session: SessionItem;
  queued: QueuedMessage[];
  /** hello.capabilities：老网关可能没开文件下载，别把卡片画成一个点了没反应的按钮 */
  capabilities: string[];
  onBack: () => void;
  /** fork 出来的新会话，交给上层切过去 */
  onForked: (sessionId: string) => void;
  /** 跳到另一个会话（比如分叉的来源） */
  onOpenSession: (sessionId: string) => void;
}

interface StreamingDraft {
  attemptId: string;
  text: string;
  reasoning: string;
  /** 这一轮流式输出的开始时间，渲染时不要用 Date.now()（纯函数要求） */
  startedAt: number;
}

/** 选好待上传的普通文件。 */
interface PickedFile {
  id: string;
  name: string;
  size: number;
  file: File;
  state: UploadState;
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

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 日期分隔条：只在跨天的地方显示，queued 消息 time=0 直接跳过。 */
function dayLabel(ms: number): string | null {
  if (!ms) return null;
  const day = startOfDay(ms);
  const diff = Math.round((startOfDay(Date.now()) - day) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return sameYear
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 引用代码块时拼进消息里的文本；太长就截断，别把一整屏代码塞进去。 */
function formatQuote(quote: { lang: string; code: string }): string {
  const lines = quote.code.split('\n');
  const shown = lines.slice(0, 12);
  const fence = '```' + (quote.lang || '');
  const tail = lines.length > shown.length ? [`…（共 ${lines.length} 行）`] : [];
  return [`> 引用代码${quote.lang ? `（${quote.lang}）` : ''}：`, fence, ...shown, ...tail, '```'].join('\n');
}

/** 长按菜单标题：只给一眼能认出是哪条消息的摘要。 */
function previewOf(text: string): string | undefined {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > 60 ? flat.slice(0, 60) + '…' : flat;
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

export function SessionScreen({
  client,
  session,
  queued,
  capabilities,
  onBack,
  onForked,
  onOpenSession,
}: Props) {
  const canDownloadFiles = capabilities.includes('file-downloads');
  const canPickPreset = capabilities.includes('session-agent-preset');
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
  /** 待发送文件（上传完成后才有 receiptId） */
  const [pickedFiles, setPickedFiles] = useState<PickedFile[]>([]);
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
  /** 离线发件箱里属于这个会话的消息。 */
  const [offlineItems, setOfflineItems] = useState<OutboxItem[]>(() => outbox.list(session.sessionId));
  /** 草稿是否已经从磁盘读回来了，读完之前不许写盘。 */
  const draftReadyRef = useRef(false);
  /** 任务列表与当前目标；asOfSeq 只允许变大，避免旧推送覆盖新查询。 */
  const [todos, setTodos] = useState<TodoItem[] | null>(null);
  const [goal, setGoal] = useState<GoalInfo | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  /** agent 预设（模式）：列表全局一份，会话级状态单独查。 */
  const [presetList, setPresetList] = useState<PresetList>({ presets: [], modeSelectionEnabled: true });
  const [presetId, setPresetId] = useState<string | null>(session.agentPreset ?? null);
  /** 会话跑过任何一轮就锁死；服务端没回话之前先按 blank 猜。 */
  const [presetLocked, setPresetLocked] = useState(!session.blank);
  const [presetSheet, setPresetSheet] = useState(false);
  /** 长按标题打开的会话信息菜单 */
  const [infoSheet, setInfoSheet] = useState(false);
  const todosSeqRef = useRef(-1);
  const goalSeqRef = useRef(-1);
  const downloaderRef = useRef<FileDownloader | null>(null);
  const uploaderRef = useRef<FileUploader | null>(null);
  /** 点了大纲里的某一轮：要先把历史翻到那个 seq，再滚过去。 */
  const jumpTargetRef = useRef<number | null>(null);
  const oldestSeqRef = useRef<number>(Number.POSITIVE_INFINITY);
  const [jumpTick, setJumpTick] = useState(0);
  /** 用户点了「稍后」：面板收起，但请求仍然挂在服务端，可以随时再打开。 */
  const [sheetHidden, setSheetHidden] = useState(false);
  /** 长按某条消息后弹出的操作表；null 表示没打开。 */
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  /** 连接状态：断线时输入框上方给一条提示，别让用户对着空气发消息。 */
  const [conn, setConn] = useState<string>('ready');
  /** 从代码块引用过来的内容，发送时自动拼在正文前面。 */
  const [quote, setQuote] = useState<{ lang: string; code: string } | null>(null);
  /** 正在编辑的排队消息 id；非 null 时「发送」变成「保存排队内容」。 */
  const [editingQueue, setEditingQueue] = useState<string | null>(null);
  /** 上下文占用百分比，0 表示还没拿到统计 */
  const contextPct = useMemo(() => {
    const pressure = stats?.contextPressure;
    if (!pressure?.contextWindow || typeof pressure.pressureTokens !== 'number') return 0;
    return Math.max(0, Math.min(100, Math.round((pressure.pressureTokens / pressure.contextWindow) * 100)));
  }, [stats]);
  /** 轻量提示（复制成功之类），2 秒后自己消失。 */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<ComponentRef<typeof TextInput>>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2000);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

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
      // 上传的帧按 requestId/uploadId 认领，认领了就别再进业务分支。
      if (uploaderRef.current?.handleFrame(frame as unknown as Record<string, unknown>)) return;
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
          setStreaming({
            attemptId: String(inner.attemptId ?? ''),
            text: '',
            reasoning: '',
            startedAt: Date.now(),
          });
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
      if (kind === 'tasks' || kind === 'tasks-updated') {
        const tasksFrame = frame as unknown as { sessionId?: string; asOfSeq?: number; todos?: unknown };
        if (tasksFrame.sessionId && tasksFrame.sessionId !== session.sessionId) return;
        const asOf = typeof tasksFrame.asOfSeq === 'number' ? tasksFrame.asOfSeq : 0;
        if (asOf < todosSeqRef.current) return;
        todosSeqRef.current = asOf;
        setTodos(mapTodos(tasksFrame.todos));
        return;
      }
      if (kind === 'goal' || kind === 'goal-updated') {
        const goalFrame = frame as unknown as { sessionId?: string; asOfSeq?: number; goal?: unknown };
        if (goalFrame.sessionId && goalFrame.sessionId !== session.sessionId) return;
        const asOf = typeof goalFrame.asOfSeq === 'number' ? goalFrame.asOfSeq : 0;
        if (asOf < goalSeqRef.current) return;
        goalSeqRef.current = asOf;
        setGoal(mapGoal(goalFrame.goal));
        return;
      }
      if (kind === 'agent-presets') {
        setPresetList(mapPresetList(frame));
        return;
      }
      if (kind === 'session-agent-preset') {
        const preset = frame as unknown as SessionAgentPresetFrame;
        if (preset.sessionId && preset.sessionId !== session.sessionId) return;
        if (typeof preset.agentPreset === 'string') setPresetId(preset.agentPreset);
        if (typeof preset.locked === 'boolean') setPresetLocked(preset.locked);
        return;
      }
      if (kind === 'select-agent-preset') {
        const selected = frame as unknown as SelectAgentPresetFrame;
        if (selected.sessionId && selected.sessionId !== session.sessionId) return;
        if (selected.agentPreset) setPresetId(selected.agentPreset);
        setPresetSheet(false);
        // 响应里没有 locked，切完再查一次才知道这个会话还能不能继续改。
        client.send({ type: 'session-agent-preset', sessionId: session.sessionId });
        return;
      }
      if (kind === 'session-agent-preset-updated') {
        const updated = frame as unknown as SessionAgentPresetUpdatedFrame;
        if (updated.sessionId && updated.sessionId !== session.sessionId) return;
        // 只带变化的那一个字段，按字段合并。
        if (typeof updated.agentPreset === 'string') setPresetId(updated.agentPreset);
        if (typeof updated.locked === 'boolean') setPresetLocked(updated.locked);
        return;
      }
      if (kind === 'fork') {
        const forked = frame as unknown as { sessionId?: string };
        if (forked.sessionId) onForked(forked.sessionId);
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
      if (kind === 'goal-edit' || kind === 'goal-pause' || kind === 'goal-resume' || kind === 'goal-clear') {
        // 这几个响应故意不带 sessionId/requestId，只回新的 ref。
        // 想继续操作必须拿到最新 revision，所以统一重查一次。
        client.send({ type: 'goal', sessionId: session.sessionId });
        return;
      }
      if (kind === 'queue-item-updated') {
        const result = frame as unknown as { accepted?: boolean; action?: string };
        if (result.accepted === false) setError('排队消息没有改成，可能已经开始执行了');
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
        if (failure.requestType === 'select-agent-preset') {
          // 乐观改过的本地状态要退回去：以服务端为准重查一次。
          client.send({ type: 'session-agent-preset', sessionId: session.sessionId });
          setError(
            failure.code === 'agent-preset/locked'
              ? '这个会话已经开始过了，模式不能再改'
              : `${failure.code ?? 'error'}：${failure.message ?? ''}`,
          );
          return;
        }
        setError(`${failure.code ?? 'error'}：${failure.message ?? ''}`);
      }
    },
    [client, onForked, session.sessionId],
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
    setTodos(null);
    setGoal(null);
    todosSeqRef.current = -1;
    goalSeqRef.current = -1;
    setFileStates({});
    setEditingQueue(null);
    setPickedFiles([]);
    const downloader = new FileDownloader(
      session.sessionId,
      (frame) => client.send(frame),
      (path, state) => setFileStates((current) => ({ ...current, [path]: state })),
    );
    downloaderRef.current = downloader;
    const uploader = new FileUploader(
      session.sessionId,
      (frame) => client.send(frame),
      (localId, state) => {
        setPickedFiles((current) =>
          current.map((item) => (item.id === localId ? { ...item, state } : item)),
        );
      },
    );
    uploaderRef.current = uploader;
    client.send({ type: 'subscribe', sessionId: session.sessionId, assistantStream: true });
    client.send({
      type: 'history',
      sessionId: session.sessionId,
      view: 'conversation',
      historyFormatVersion: HISTORY_FORMAT_VERSION,
    });
    client.send({ type: 'session-stats', sessionId: session.sessionId });
    client.send({ type: 'tasks', sessionId: session.sessionId });
    client.send({ type: 'goal', sessionId: session.sessionId });
    if (canPickPreset) {
      // 预设目录全局一份，会话级状态每次进来都要重查（推送没有回放）。
      client.send({ type: 'agent-presets' });
      client.send({ type: 'session-agent-preset', sessionId: session.sessionId });
    }
    return () => {
      off();
      downloader.dispose();
      if (downloaderRef.current === downloader) downloaderRef.current = null;
      uploader.dispose();
      if (uploaderRef.current === uploader) uploaderRef.current = null;
      client.send({ type: 'unsubscribe' });
    };
  }, [canPickPreset, client, handleFrame, session.sessionId]);

  // 断线重连后服务端不再记得我们的订阅，必须重新订阅并补一次历史，
  // 否则回到前台会一直看着断线前的旧内容。
  useEffect(() => client.onState((state) => setConn(state)), [client]);

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
      client.send({ type: 'tasks', sessionId: session.sessionId });
      client.send({ type: 'goal', sessionId: session.sessionId });
      if (canPickPreset) client.send({ type: 'session-agent-preset', sessionId: session.sessionId });
    });
    return off;
  }, [canPickPreset, client, session.sessionId]);

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

  /** 选一个普通文件，选中就开始传；传完才允许发送。 */
  const pickFiles = useCallback(() => {
    void (async () => {
      try {
        const result = await File.pickFileAsync();
        if (result.canceled || !result.result) return;
        const file = result.result;
        const id = randomUUID();
        setPickedFiles((current) => [
          ...current,
          {
            id,
            name: file.name || '文件',
            size: typeof file.size === 'number' ? file.size : 0,
            file,
            state: { status: 'hashing', progress: 0 },
          },
        ]);
        void uploaderRef.current?.upload(id, file);
      } catch (error) {
        setError(error instanceof Error ? error.message : '选择文件失败');
      }
    })();
  }, []);

  const removePickedFile = useCallback((id: string) => {
    uploaderRef.current?.cancel(id);
    setPickedFiles((current) => current.filter((item) => item.id !== id));
  }, []);

  const askImageSource = useCallback(() => {
    Alert.alert('添加附件', undefined, [
      { text: '拍照', onPress: () => pickImage('camera') },
      { text: '从相册选择', onPress: () => pickImage('library') },
      { text: '文件', onPress: pickFiles },
      { text: '取消', style: 'cancel' },
    ]);
  }, [pickFiles, pickImage]);

  /** 点文件卡片：没下过就下，下过就直接打开。 */
  const openFile = useCallback((path: string) => {
    downloaderRef.current?.open(path);
  }, []);

  /** 目标写操作必须带上刚读到的 {id, revision}，否则会被 CAS 拒绝。 */
  const goalAction = useCallback(
    (action: 'goal-pause' | 'goal-resume' | 'goal-clear') => {
      const current = goal;
      if (!current) return;
      client.send({ type: action, sessionId: session.sessionId, ref: goalRef(current) });
    },
    [client, goal, session.sessionId],
  );

  /** 切换模式：先乐观改本地，服务端拒绝时由 error 分支退回。 */
  const pickPreset = useCallback(
    (id: string) => {
      setPresetSheet(false);
      if (id === presetId) return;
      setPresetId(id);
      setPresetLocked(true);
      client.send({ type: 'select-agent-preset', sessionId: session.sessionId, agentPreset: id });
    },
    [client, presetId, session.sessionId],
  );

  const presetActions = useMemo<SheetAction[]>(
    () =>
      presetList.presets.map((preset) => ({
        id: preset.id,
        label: (preset.id === presetId ? '✓ ' : '') + (preset.name || preset.id),
        hint: [preset.description, preset.broken ? '当前不可用' : null].filter(Boolean).join(' · ') || undefined,
        disabled: preset.broken || presetLocked || !presetList.modeSelectionEnabled,
      })),
    [presetId, presetList, presetLocked],
  );

  const infoActions = useMemo<SheetAction[]>(() => {
    const list: SheetAction[] = [{ id: 'copy-id', label: '复制会话 ID', hint: session.sessionId }];
    if (session.cwd) list.push({ id: 'copy-cwd', label: '复制工作目录', hint: session.cwd });
    if (session.parentSessionId) {
      list.push({ id: 'parent', label: '打开来源会话', hint: session.parentSessionId });
    }
    list.push({ id: 'archive', label: '归档这个会话', destructive: true });
    return list;
  }, [session]);

  const runInfoAction = useCallback(
    (id: string) => {
      setInfoSheet(false);
      if (id === 'copy-id') {
        void Clipboard.setStringAsync(session.sessionId).then(() => showToast('已复制会话 ID'));
        return;
      }
      if (id === 'copy-cwd' && session.cwd) {
        void Clipboard.setStringAsync(session.cwd).then(() => showToast('已复制目录'));
        return;
      }
      if (id === 'parent' && session.parentSessionId) {
        onOpenSession(session.parentSessionId);
        return;
      }
      if (id === 'archive') {
        client.send({ type: 'session-archive', sessionId: session.sessionId, archived: true });
        onBack();
      }
    },
    [client, onBack, onOpenSession, session.cwd, session.parentSessionId, session.sessionId, showToast],
  );

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

  /** 只有传完拿到 receiptId 的文件才能挂到消息上 */
  const readyFiles = pickedFiles.filter(
    (item) => item.state.status === 'done' && item.state.receiptId,
  );
  const uploadingFiles = pickedFiles.some(
    (item) => item.state.status === 'hashing' || item.state.status === 'uploading',
  );
  const canSend = !uploadingFiles && Boolean(draft.trim() || picked.length || readyFiles.length);

  const send = useCallback(() => {
    // 编辑排队消息：走 queue-update 的 edit，不要新发一条。
    if (editingQueue) {
      const next = draft.trim();
      if (!next) return;
      client.send({
        type: 'queue-update',
        sessionId: session.sessionId,
        itemId: editingQueue,
        action: 'edit',
        text: next,
      });
      setEditingQueue(null);
      setDraft('');
      return;
    }
    const text = [quote ? formatQuote(quote) : '', draft.trim()].filter(Boolean).join('\n\n');
    const images = picked;
    const files = readyFiles;
    if (!text && images.length === 0 && files.length === 0) return;
    const sent = client.send({
      type: 'message',
      sessionId: session.sessionId,
      text,
      clientTimeZone: TIME_ZONE,
      mode: running ? sendMode : 'queue',
      images: images.length
        ? images.map((item) => ({ mediaType: item.mediaType, data: item.data, name: item.name }))
        : undefined,
      files: files.length
        ? files.map((item) => ({ receiptId: item.state.receiptId as string }))
        : undefined,
    });
    if (sent) {
      tapFeedback();
      setDraft('');
      setPicked([]);
      setPickedFiles([]);
      setQuote(null);
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
    } else if (files.length > 0) {
      // 收据绑在连接上，离线重发没有意义，直接告诉用户等联网再发。
      setError('文件需要在线发送，等连接恢复后再试');
    } else {
      // 断线了别把用户打的字扔掉：落进发件箱，重连后自动补发。
      outbox.add({
        sessionId: session.sessionId,
        text: text || IMAGE_ONLY_TEXT,
        images: images.length
          ? images.map((item) => ({ mediaType: item.mediaType, data: item.data, name: item.name }))
          : undefined,
        mode: running ? sendMode : 'queue',
      });
      setDraft('');
      setPicked([]);
      setQuote(null);
      setError(null);
    }
  }, [client, draft, editingQueue, picked, quote, readyFiles, running, sendMode, session.sessionId]);

  /** 离线待发的消息：直接删掉，不再重试。 */
  const discardOffline = useCallback((id: string) => {
    outbox.remove(id);
  }, []);

  /** 长按菜单里能做什么，取决于这条消息是什么类型。 */
  const messageActions = useMemo(() => {
    const message = actionMessage;
    if (!message) return [];
    const actions: SheetAction[] = [];
    const text = 'text' in message ? message.text : '';
    if (text) actions.push({ id: 'copy', label: '复制文本' });
    if ('seq' in message && typeof message.seq === 'number') {
      actions.push({
        id: 'fork',
        label: '从这里分叉',
        hint: '以这条消息为界复制一份新会话，原来的不动',
      });
    }
    if (message.kind === 'user' && text) {
      actions.push({ id: 'edit', label: '重新编辑', hint: '把内容放回输入框' });
    }
    return actions;
  }, [actionMessage]);

  const runMessageAction = useCallback(
    (id: string) => {
      const message = actionMessage;
      setActionMessage(null);
      if (!message) return;
      if (id === 'copy') {
        const text = 'text' in message ? message.text : '';
        if (!text) return;
        void Clipboard.setStringAsync(text).then(
          () => showToast('已复制'),
          () => showToast('复制失败'),
        );
        return;
      }
      if (id === 'fork') {
        if (!('seq' in message) || typeof message.seq !== 'number') return;
        client.send({
          type: 'fork',
          sessionId: session.sessionId,
          atSeq: message.seq,
          historyFormatVersion: HISTORY_FORMAT_VERSION,
        });
        showToast('正在分叉…');
        return;
      }
      if (id === 'edit') {
        if (!('text' in message)) return;
        setDraft(message.text);
        composerRef.current?.focus();
      }
    },
    [actionMessage, client, session.sessionId, showToast],
  );

  /** 把排队中的消息拉回输入框改；改完用 queue-update 的 edit 覆盖。 */
  const startEditQueued = useCallback((queueId: string, text: string) => {
    setEditingQueue(queueId);
    setDraft(text);
    setQuote(null);
    composerRef.current?.focus();
  }, []);

  const cancelEditQueued = useCallback(() => {
    setEditingQueue(null);
    setDraft('');
  }, []);

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
          time: streaming.startedAt,
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
      ...offlineItems.map((item) => ({
        id: `offline-${item.id}`,
        kind: 'queued' as const,
        text: item.text,
        time: 0,
        queueId: item.id,
        pending: true,
        offline: true,
      })),
    ],
    [baseRows, offlineItems, pendingSends, queued],
  );

  // 进会话先把上次没发完的草稿捞回来。切换会话时先清空，
  // 否则上一会话的文字会被当成这一会话的草稿写回去。
  useEffect(() => {
    draftReadyRef.current = false;
    setDraft('');
    let cancelled = false;
    void loadDraft(session.sessionId).then((text) => {
      if (cancelled) return;
      setDraft(text);
      draftReadyRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [session.sessionId]);

  // 草稿改动落盘（内部已做防抖）。没加载完之前不写，避免把空值覆盖掉磁盘上的草稿。
  useEffect(() => {
    if (!draftReadyRef.current) return;
    saveDraft(session.sessionId, draft);
  }, [draft, session.sessionId]);

  // 发件箱是模块级单例，订阅一次就能跟着增删重绘。
  useEffect(() => {
    const sync = () => setOfflineItems(outbox.list(session.sessionId));
    sync();
    return outbox.subscribe(sync);
  }, [session.sessionId]);


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
      {/* 2px 上下文水位线：不占排版高度，扫一眼就知道还剩多少上下文。 */}
      <View style={styles.waterline}>
        {contextPct > 0 ? (
          <View
            style={[
              styles.waterlineFill,
              {
                width: `${contextPct}%`,
                backgroundColor:
                  contextPct >= 85 ? '#8A3B33' : contextPct >= 60 ? '#6E5C33' : '#3A3F4B',
              },
            ]}
          />
        ) : null}
      </View>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Pressable style={styles.titleWrap} onLongPress={() => setInfoSheet(true)} delayLongPress={320}>
          <Text style={styles.title} numberOfLines={1}>
            {session.projections?.values.title ?? '未命名会话'}
          </Text>
        </Pressable>
        {todos && todos.length > 0 ? (
          <Pressable style={styles.outlineButton} onPress={() => setTasksOpen(true)}>
            <Text style={styles.outlineText}>
              任务 {todos.filter((item) => item.status === 'completed').length}/{todos.length}
            </Text>
          </Pressable>
        ) : goal ? (
          <Pressable style={styles.outlineButton} onPress={() => setTasksOpen(true)}>
            <Text style={styles.outlineText}>目标</Text>
          </Pressable>
        ) : null}
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
            renderItem={({ item, index }) => (
              <View>
                {dayLabel(item.time) && dayLabel(item.time) !== dayLabel(rows[index - 1]?.time ?? 0) ? (
                  <Text style={styles.dayDivider}>{dayLabel(item.time)}</Text>
                ) : null}
                <MessageRow
                message={item}
                attachmentCache={attachmentCache}
                onNeedAttachment={requestAttachment}
                onRemoveQueued={removeQueued}
                onEditQueued={startEditQueued}
                onSteerQueued={steerQueued}
                fileStates={fileStates}
                onOpenFile={openFile}
                canDownloadFiles={canDownloadFiles}
                  onDiscardOffline={discardOffline}
                onLongPress={setActionMessage}
                onQuoteCode={(lang, code) => setQuote({ lang, code })}
              />
              </View>
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

        <ActionSheet
          visible={infoSheet}
          title={session.projections?.values.title ?? '未命名会话'}
          subtitle={session.cwd ?? undefined}
          actions={infoActions}
          onPick={runInfoAction}
          onClose={() => setInfoSheet(false)}
        />

        <ActionSheet
          visible={presetSheet}
          title="模式"
          subtitle={
            presetLocked
              ? '会话已经开始过，模式已固定；想换模式请新建会话'
              : '只对还没开始过的会话生效'
          }
          actions={presetActions}
          onPick={pickPreset}
          onClose={() => setPresetSheet(false)}
        />

        <ActionSheet
          visible={actionMessage !== null}
          title={actionMessage && 'text' in actionMessage ? previewOf(actionMessage.text) : undefined}
          actions={messageActions}
          onPick={runMessageAction}
          onClose={() => setActionMessage(null)}
        />

        {toast ? (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        ) : null}

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

        <TasksSheet
          visible={tasksOpen}
          todos={todos}
          goal={goal}
          onClose={() => setTasksOpen(false)}
          onPause={() => goalAction('goal-pause')}
          onResume={() => goalAction('goal-resume')}
          onClear={() => goalAction('goal-clear')}
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
              {canPickPreset && presetList.presets.length > 0 ? (
                <Pressable
                  style={[styles.statusChipBox, presetLocked ? styles.statusChipBoxLocked : null]}
                  onPress={() => setPresetSheet(true)}
                >
                  <Text style={[styles.statusChipText, presetLocked ? styles.statusChipTextLocked : null]}>
                    {presetName(presetList.presets, presetId)}
                    {presetLocked ? ' · 锁定' : ''}
                  </Text>
                </Pressable>
              ) : null}
              {statusLabel ? <Text style={styles.statusChip}>{statusLabel}</Text> : null}
              {statsLine ? (
                <Text style={styles.statusMeta} numberOfLines={1}>
                  {statsLine}
                </Text>
              ) : null}
            </View>
          ) : null}
          {editingQueue ? (
            <View style={styles.editBar}>
              <Text style={styles.editBarText}>正在编辑排队消息</Text>
              <Pressable hitSlop={8} onPress={cancelEditQueued}>
                <Text style={styles.editBarAction}>取消</Text>
              </Pressable>
            </View>
          ) : null}
          {pickedFiles.length > 0 ? (
            <View style={styles.fileChipRow}>
              {pickedFiles.map((item) => {
                const state = item.state;
                const label =
                  state.status === 'hashing'
                    ? '校验中'
                    : state.status === 'uploading'
                      ? `${Math.round((state.progress ?? 0) * 100)}%`
                      : state.status === 'done'
                        ? formatBytes(item.size)
                        : state.message ?? '上传失败';
                return (
                  <View
                    key={item.id}
                    style={[styles.fileChip, state.status === 'error' ? styles.fileChipError : null]}
                  >
                    <Text style={styles.fileChipName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text
                      style={[
                        styles.fileChipState,
                        state.status === 'error' ? styles.fileChipStateError : null,
                      ]}
                    >
                      {label}
                    </Text>
                    <Pressable hitSlop={8} onPress={() => removePickedFile(item.id)}>
                      <Text style={styles.fileChipClose}>×</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}
          {quote ? (
            <View style={styles.quoteBar}>
              <Text style={styles.quoteTag}>引用{quote.lang ? ' · ' + quote.lang : ''}</Text>
              <Text style={styles.quoteText} numberOfLines={1}>
                {quote.code.split('\n')[0].trim()}
              </Text>
              <Pressable hitSlop={8} onPress={() => setQuote(null)}>
                <Text style={styles.quoteClose}>×</Text>
              </Pressable>
            </View>
          ) : null}
          {conn !== 'ready' ? (
            <View style={styles.connBar}>
              <View style={styles.connDot} />
              <Text style={styles.connText}>
                {conn === 'connecting' ? '正在连接网关…' : '连接已断开，正在自动重连'}
              </Text>
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
              ref={composerRef}
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
  onEditQueued,
  fileStates,
  onOpenFile,
  canDownloadFiles,
  onDiscardOffline,
  onLongPress,
  onQuoteCode,
}: {
  message: ChatMessage;
  attachmentCache: Record<string, string>;
  onNeedAttachment: (attachmentId: string) => void;
  onRemoveQueued: (queueId: string) => void;
  onSteerQueued: (queueId: string) => void;
  onEditQueued: (queueId: string, text: string) => void;
  fileStates: Record<string, FileUiState>;
  onOpenFile: (path: string) => void;
  canDownloadFiles: boolean;
  onDiscardOffline: (id: string) => void;
  onLongPress: (message: ChatMessage) => void;
  onQuoteCode: (lang: string, code: string) => void;
}) {
  const [toolOpen, setToolOpen] = useState(false);
  /** 本地回显图片的全屏预览；历史图片走 MessageImages 自己的查看器。 */
  const [preview, setPreview] = useState<string | null>(null);
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
            <>
              <View style={styles.localImages}>
                {message.localUris.map((uri) => (
                  <Pressable key={uri} onPress={() => setPreview(uri)}>
                    <Image source={{ uri }} style={styles.localImage} resizeMode="cover" />
                  </Pressable>
                ))}
              </View>
              <ImageViewer uri={preview} onClose={() => setPreview(null)} />
            </>
          ) : null}
          {message.text ? <Text style={styles.bubbleText}>{message.text}</Text> : null}
          <View style={styles.queuedFooter}>
            <Text style={styles.queuedTag}>
              {message.offline
                ? '待发送 · 联网后自动重发'
                : message.pending
                  ? '发送中…'
                  : steering
                    ? '插话中 · 下一步生效'
                    : '排队中'}
            </Text>
            {message.offline ? (
              <Pressable hitSlop={8} onPress={() => onDiscardOffline(message.queueId)}>
                <Text style={styles.queuedAction}>删除</Text>
              </Pressable>
            ) : message.pending ? null : (
              <View style={styles.queuedActions}>
                <Pressable hitSlop={8} onPress={() => onEditQueued(message.queueId, message.text)}>
                  <Text style={styles.queuedAction}>编辑</Text>
                </Pressable>
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
      <Pressable
        onLongPress={() => onLongPress(message)}
        delayLongPress={320}
        style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}
      >
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
          <MarkdownView
            text={message.text}
            onFileLink={canDownloadFiles ? onOpenFile : undefined}
            onQuoteCode={onQuoteCode}
          />
        ) : (
          <Text style={styles.bubbleText}>{message.streaming ? '…' : ''}</Text>
        )}
        {message.kind === 'assistant' && message.failure ? (
          <Text style={styles.failure}>{message.failure}</Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0C0F' },
  waterline: { height: 2, backgroundColor: '#12141A' },
  waterlineFill: { height: 2 },
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
  titleWrap: { flex: 1 },
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
  toast: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 96,
    alignItems: 'center',
  },
  toastText: {
    backgroundColor: 'rgba(30,33,40,0.95)',
    color: '#EDEFF3',
    fontSize: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    overflow: 'hidden',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 14, paddingBottom: 12 },
  empty: { color: '#5B6070', textAlign: 'center', marginTop: 40 },
  olderWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, minHeight: 44 },
  olderAction: { color: '#7E8698', fontSize: 13, fontWeight: '600' },
  olderEnd: { color: '#4A4F5C', fontSize: 12 },
  dayDivider: {
    color: '#4C5261',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 12,
  },
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
  statusChipBox: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#1A2233',
  },
  statusChipBoxLocked: { backgroundColor: '#1B1D22' },
  statusChipText: { color: '#8FB6FF', fontSize: 10.5, fontWeight: '600' },
  statusChipTextLocked: { color: '#6E7585' },
  statusMeta: { flex: 1, color: '#4C5261', fontSize: 10.5 },
  editBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 14,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1E1B2A',
  },
  editBarText: { color: '#C4A8FF', fontSize: 11.5 },
  editBarAction: { color: '#8FB6FF', fontSize: 11.5, fontWeight: '600' },
  fileChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 6,
  },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#151B26',
  },
  fileChipError: { backgroundColor: '#2A1A1C' },
  fileChipName: { maxWidth: 160, color: '#D6DAE3', fontSize: 11.5 },
  fileChipState: { color: '#6E7585', fontSize: 10.5 },
  fileChipStateError: { color: '#FF7A7A' },
  fileChipClose: { color: '#6E7585', fontSize: 15, lineHeight: 17 },
  quoteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#151B26',
    borderLeftWidth: 2,
    borderLeftColor: '#3A6BD6',
  },
  quoteTag: { color: '#8FB6FF', fontSize: 10.5, fontWeight: '700' },
  quoteText: { flex: 1, color: '#8A93A6', fontSize: 11 },
  quoteClose: { color: '#6E7585', fontSize: 16, lineHeight: 18 },
  connBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 14,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#2A2318',
  },
  connDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#E8B75C' },
  connText: { color: '#E8B75C', fontSize: 11 },
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
