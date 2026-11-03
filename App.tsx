import * as Clipboard from 'expo-clipboard';
import { randomUUID } from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { parsePairingPayload } from './src/protocol/pairing';
import { mapQueue, type QueuedMessage } from './src/protocol/chat';
import {
  applyPendingFrame,
  describePending,
  pendingItems,
  type PendingMap,
} from './src/protocol/pending';
import type { HelloFrame, ServerFrame, SessionItem, WorkspacesFrame } from './src/protocol/types';
import { applyOutlineFrame, type OutlineMap } from './src/protocol/outline-cache';
import { selectFocusSessions } from './src/protocol/focus';
import {
  hasReadyProvider,
  mapSpeechCatalog,
  type SpeechCatalog,
} from './src/protocol/speech';
import { useVoiceInput, type VoiceStopReason } from './src/ui/voice/useVoiceInput';
import { BottomTabBar } from './src/ui/home/BottomTabBar';
import { PluginsView } from './src/ui/plugins/PluginsView';
import { SchedulesView, mapSchedules } from './src/ui/home/SchedulesView';
import { HostInfoSheet } from './src/ui/home/HostInfoSheet';
import { FontScaleProvider } from './src/ui/fontScale';
import { FocusHome, type FocusItem } from './src/ui/home/FocusHome';
import { buildHomeRows } from './src/ui/home/rows';
import {
  activateGateway,
  clearGateway,
  getDeviceId,
  getDeviceName,
  loadActiveGateway,
  loadGateways,
  removeGateway,
  upsertGateway,
  type SavedGateway,
} from './src/storage/gateway-store';
import { GatewayClient, type ConnectionState } from './src/transport/gateway-client';
import { draftSessionIds } from './src/storage/drafts';
import { readJson, removeJson, writeJson } from './src/storage/persisted-state';
import { outbox } from './src/transport/outbox';
import { dropCachedGateway } from './src/transport/history-cache';
import { mapDirectories, type DirectoryListing } from './src/protocol/directories';
import { ActionSheet, type SheetAction } from './src/ui/ActionSheet';
import { DirectoryPicker } from './src/ui/DirectoryPicker';
import { ScanScreen } from './src/ui/ScanScreen';
import { SessionScreen } from './src/ui/SessionScreen';
import { useTheme, useThemedStyles } from './src/ui/theme';
import type { Palette } from './src/theme/tokens';

/** 会话列表按网关分开缓存，切换网关时不会串味。 */
const sessionsCacheKey = (gatewayId: string) => `sessions-${gatewayId}`;

/** session-create / 语音新会话的兜底：15s 没回包就撤悬挂状态（12–30s 区间取中）。 */
const CREATE_TIMEOUT_MS = 15000;

/** 列表上的相对时间：比绝对时间戳好读，也不用为「耗时」去拉 session-stats。 */
function ago(at: number): string {
  if (!at) return '';
  const diff = Date.now() - at;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前';
  return Math.floor(diff / 86_400_000) + ' 天前';
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const STATE_LABEL: Record<ConnectionState, string> = {
  idle: '未连接',
  connecting: '连接中',
  ready: '已连接',
  closed: '已断开',
  error: '连接异常',
};

export default function App() {
  return (
    <SafeAreaProvider>
      {/* 必须包在 AppBody 外面：AppBody 自己就调用 useThemedStyles(makeStyles)，
          放进它的 return 里的话，顶栏、设备条、搜索框、重命名弹窗这些样式读到的
          永远是默认倍率，字号调大后和子页面不一致。 */}
      <FontScaleProvider>
        <AppBody />
      </FontScaleProvider>
    </SafeAreaProvider>
  );
}

function AppBody() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const client = useMemo(() => new GatewayClient(), []);
  /**
   * 第二条连接，只跑 control 通道：它不订阅任何会话，
   * 因此能收到全部会话的审批/提问，用来在列表上提示「agent 卡住了」。
   */
  const control = useMemo(() => new GatewayClient(), []);
  const [state, setState] = useState<ConnectionState>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [hello, setHello] = useState<HelloFrame | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [pairingText, setPairingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedGateway | null>(null);
  /** 配对过的全部网关，可以在顶部切换 */
  const [gateways, setGateways] = useState<SavedGateway[]>([]);
  const [gatewaySheet, setGatewaySheet] = useState(false);
  const [addGateway, setAddGateway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<SessionItem | null>(null);
  const [creating, setCreating] = useState(false);
  /** 新建会话：先问「默认目录」还是「挑一个目录」 */
  const [createSheet, setCreateSheet] = useState(false);
  const [dirPicker, setDirPicker] = useState(false);
  const [dirListing, setDirListing] = useState<DirectoryListing | null>(null);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [archived, setArchived] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [pending, setPending] = useState<PendingMap>({});
  /** 每个会话最近几轮的大纲；首页卡片拿它显示「最后一句回复」，不用逐会话拉历史。 */
  const [outlines, setOutlines] = useState<OutlineMap>({});
  /** 服务器语音目录：provider、语言、音频上限都在这里 */
  const [speechCatalog, setSpeechCatalog] = useState<SpeechCatalog | null>(null);
  /** 这一次语音球说给谁听；转写回来时按它决定发给哪个会话 */
  const voiceTargetRef = useRef<{ kind: 'new' } | { kind: 'session'; sessionId: string } | null>(null);
  /** 到上限自动停、要新建会话的那句话：按 session-create 的 requestId 认领，失败/断线退剪贴板 */
  const voiceDraftRef = useRef<{ requestId: string; text: string } | null>(null);
  /** 到上限的那句话投递给已有会话的会话页；会话页合并进草稿后回调清掉 */
  const [voiceDelivery, setVoiceDelivery] = useState<{
    key: string;
    sessionId: string;
    text: string;
  } | null>(null);
  /** 会话页消费完投递后清场；只清自己那份（键对不上说明是更新的投递） */
  const clearVoiceDelivery = useCallback((key: string) => {
    setVoiceDelivery((current) => (current && current.key === key ? null : current));
  }, []);
  /** handleFrame 里要读最新的待办，但不想因为待办变化重建回调 */
  const pendingRef = useRef<PendingMap>({});
  /** 刚用语音发了一条「新会话」消息，等 sent 回来就跳进去 */
  const voiceCreateRequestRef = useRef<string | null>(null);
  /** 首页语音发给已有会话的消息，等 sent/error 按 requestId 归位 */
  const voiceMessagePendingRef = useRef<string | null>(null);
  /** 在途 session-create（列表页/目录新建）：超时按 requestId 判断该不该撤 creating。 */
  const creatingRequestRef = useRef<string | null>(null);
  /** session-create / 语音新会话的兜底定时器，按 requestId 挂；回包、error 或超时都会清掉。 */
  const createTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const armRequestTimeout = useCallback((requestId: string, onTimeout: () => void) => {
    const timers = createTimersRef.current;
    const existing = timers.get(requestId);
    if (existing) clearTimeout(existing);
    timers.set(
      requestId,
      setTimeout(() => {
        timers.delete(requestId);
        onTimeout();
      }, CREATE_TIMEOUT_MS),
    );
  }, []);
  const settleRequestTimeout = useCallback((requestId?: string) => {
    if (requestId === undefined) return;
    const timers = createTimersRef.current;
    const timer = timers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(requestId);
    }
  }, []);
  /** 语音只打开审批卡，不代替用户拍板；rpcId 用来让 SessionScreen 定位到那一条 */
  const [approvalFocus, setApprovalFocus] = useState<string | null>(null);
  const approvalFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 会话列表的 ref：语音回调里要按 sessionId 找目标，不想把它放进 handleFrame 依赖 */
  const sessionsRef = useRef<SessionItem[]>([]);
  /** 已知会话 id：收到未知会话的状态推送时要补一次列表 */
  const knownSessionsRef = useRef<Set<string>>(new Set());
  /** 未读会话：比上次看到的 updatedAt 更新，且不是当前打开的 */
  const [unreadIds, setUnreadIds] = useState<ReadonlySet<string>>(() => new Set());
  /** 每个会话上次被看到时的 updatedAt；null 表示还没建立基线（首次拉取） */
  const seenAtRef = useRef<Map<string, number> | null>(null);
  /** handleFrame 里要知道当前打开的是哪个会话，但又不想为它重建回调 */
  const activeIdRef = useRef<string | null>(null);
  /** 宠物气泡的外部队列：识别失败、录音太短都从这里冒出来，不弹窗 */
  const [petNotice, setPetNotice] = useState<{ text: string; token: number } | null>(null);
  const notifyPet = useCallback((text: string) => {
    setPetNotice({ text, token: Date.now() });
  }, []);
  const voiceReady = hasReadyProvider(speechCatalog);
  /** 工作区快照：分组、置顶、归档都在这条帧里。null 表示还没拿到。 */
  const [workspaceFrame, setWorkspaceFrame] = useState<WorkspacesFrame | null>(null);
  /** 首页当前 Tab。只在首页四个页之间切，会话页不挂 Tab。 */
  const [tab, setTab] = useState<'focus' | 'all' | 'schedules' | 'plugins'>('focus');
  /** 定时任务目录；null 表示还没拿到（不是「没有任务」） */
  const [schedules, setSchedules] = useState<unknown[] | null>(null);
  /** 宿主信息与全局默认抽屉 */
  const [hostSheet, setHostSheet] = useState(false);
  /** 全部会话页里折叠起来的工作区分组 */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  /** 当前工作区：只影响「之后新建的会话」，不移动任何历史会话。 */
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [workspaceSheet, setWorkspaceSheet] = useState(false);
  /** 正在重命名的会话；非 null 时弹输入框。 */
  const [renaming, setRenaming] = useState<SessionItem | null>(null);
  const [menuSession, setMenuSession] = useState<SessionItem | null>(null);
  /** 默认不显示归档会话，避免列表越来越长 */
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  /** 有草稿/待发消息的会话，列表卡片上打标 */
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [outboxTick, setOutboxTick] = useState(0);
  const [renameDraft, setRenameDraft] = useState('');
  /** 每个会话的待发送队列；agent 还在跑的时候新消息会排在这里。 */
  const [queues, setQueues] = useState<Record<string, QueuedMessage[]>>({});
  const deviceIdRef = useRef<string | null>(null);
  /** 待落盘的网关：配对握手成功、拿到 token 之后才写 SecureStore。 */
  const pendingGateway = useRef<SavedGateway | null>(null);
  const savedRef = useRef<SavedGateway | null>(null);
  /** 防止重复扫码/重复点击把同一个配对码连两次。 */
  const pairingRef = useRef(false);
  /** 用户是否亲手选过工作区；选过之后就不再自动切到 mobile。 */
  const workspaceTouchedRef = useRef(false);
  /**
   * 正在创建 mobile 工作区的中间态：目录要先查 home、再建、再注册，三步不能省。
   * 为空表示没在创建。
   */
  const creatingWorkspaceRef = useRef<{ stage: 'probe' } | { stage: 'mkdir'; home: string } | null>(
    null,
  );

  const connected = state === 'ready' && hello?.authenticated === true;

  /** 聚焦网格的输入：只看待办 / 正在跑，最多 4 条，摘要来自大纲缓存。 */
  const focusItems = useMemo<FocusItem[]>(() => {
    const byId = new Map(sessions.map((item) => [item.sessionId, item]));
    return selectFocusSessions(sessions, {
      pending,
      archivedIds: archived,
      outlines,
    }).map((entry) => ({
      ...entry,
      cwd: byId.get(entry.sessionId)?.cwd ?? '',
      // 待发送徽标与「全部会话」tab 同口径；outboxTick 在依赖里，发件箱一变就重算。
      outboxCount: outbox.countFor(entry.sessionId),
    }));
  }, [archived, outlines, outboxTick, pending, sessions]);

  /** 搜索只过滤会话本身；分组在 buildHomeRows 里做，归档默认不进树。 */
  const searchedSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((item) => {
      const title = item.projections?.values.title ?? '';
      return title.toLowerCase().includes(query) || (item.cwd ?? '').toLowerCase().includes(query);
    });
  }, [search, sessions]);

  const rows = useMemo(
    () =>
      buildHomeRows(searchedSessions, workspaceFrame, {
        collapsed: collapsedGroups,
        showArchived,
        archivedIds: archived,
      }),
    [archived, collapsedGroups, searchedSessions, showArchived, workspaceFrame],
  );

  const pendingCount = useMemo(
    () => Object.values(pending).reduce((sum, items) => sum + items.length, 0),
    [pending],
  );

  /** 有任务在跑（排除归档）——宠物据此进入「工作」状态。 */
  const runningCount = useMemo(() => {
    const archivedSet = new Set(archived);
    return sessions.filter((item) => item.running === true && !archivedSet.has(item.sessionId)).length;
  }, [archived, sessions]);

  /** 宠物状态：先看有没有人等，再看有没有活干。 */
  const petMood: 'alert' | 'working' | 'idle' =
    pendingCount > 0 ? 'alert' : runningCount > 0 ? 'working' : 'idle';

  const visibleSessions = useMemo(() => {
    const hidden = new Set(archived);
    const query = search.trim().toLowerCase();
    return sessions.filter((item) => {
      if (!showArchived && hidden.has(item.sessionId)) return false;
      if (!query) return true;
      const title = item.projections?.values.title ?? '';
      return (
        title.toLowerCase().includes(query) || (item.cwd ?? '').toLowerCase().includes(query)
      );
    });
  }, [archived, search, sessions, showArchived]);

  /** 连上 control 通道；只有拿到长期 token 之后才可能成功。 */
  const startControl = useCallback(
    async (gateway: SavedGateway) => {
      if (!gateway.token) return;
      const deviceId = deviceIdRef.current ?? (await getDeviceId());
      deviceIdRef.current = deviceId;
      control.connect({
        url: gateway.url,
        token: gateway.token,
        deviceId,
        deviceName: getDeviceName(),
        channel: 'control',
      });
    },
    [control],
  );

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  /** 清空待办时同步清 ref：语音转写可能紧接着到达，不能等下一次渲染。 */
  const clearPending = useCallback(() => {
    pendingRef.current = {};
    setPending({});
  }, []);

  useEffect(() => {
    activeIdRef.current = active?.sessionId ?? null;
  }, [active?.sessionId]);

  useEffect(() => {
    knownSessionsRef.current = new Set(sessions.map((item) => item.sessionId));
    sessionsRef.current = sessions;
  }, [sessions]);

  // control 通道只关心审批/提问；hello 表示重连成功，先清空再让服务端回放，
  // 否则断线期间处理掉的待办会一直挂在列表上。
  useEffect(() => {
    const off = control.onFrame((frame) => {
      if (frame.kind === 'hello') {
        clearPending();
        // 定时任务目录只在 control 通道上给；连上就问一次。
        control.send({ type: 'schedule-catalog' });
        return;
      }
      if (frame.kind === 'schedule-catalog') {
        const items = (frame as unknown as { items?: unknown[] }).items;
        setSchedules(Array.isArray(items) ? items : []);
        return;
      }
      if (frame.kind === 'schedule-changed') {
        control.send({ type: 'schedule-catalog' });
        return;
      }
      // 同步更新 ref：语音转写回来时要立刻看到最新待办，不能等 effect。
      const next = applyPendingFrame(pendingRef.current, frame);
      if (next) {
        pendingRef.current = next;
        setPending(next);
      }
    });
    return off;
  }, [clearPending, control]);

  /** 标题是列表级元数据，WebUI 改了也要立刻反映到卡片和会话页。 */
  const applyTitle = useCallback((sessionId: string, title: string) => {
    const patch = (item: SessionItem): SessionItem =>
      item.sessionId === sessionId
        ? {
            ...item,
            projections: {
              asOfSeq: item.projections?.asOfSeq ?? 0,
              values: { ...(item.projections?.values ?? {}), title },
            },
          }
        : item;
    setSessions((current) => current.map(patch));
    setActive((current) => (current ? patch(current) : current));
  }, []);

  /** 打开一个会话：顺手清掉它的未读标记。 */
  const openSession = useCallback((session: SessionItem) => {
    setActive(session);
    setUnreadIds((current) => {
      if (!current.has(session.sessionId)) return current;
      const next = new Set(current);
      next.delete(session.sessionId);
      return next;
    });
  }, []);

  /** 按 sessionId 打开会话；语音回调只拿到 id，列表里可能已经没有这个对象。 */
  const openSessionById = useCallback(
    (sessionId: string) => {
      const target = sessionsRef.current.find((item) => item.sessionId === sessionId);
      if (target) {
        openSession(target);
        return;
      }
      setActive({ sessionId, updatedAt: Date.now(), running: false, blank: false });
      setUnreadIds((current) => {
        if (!current.has(sessionId)) return current;
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
    },
    [openSession],
  );

  const clearApprovalFocus = useCallback(() => {
    setApprovalFocus(null);
    if (approvalFocusTimerRef.current) {
      clearTimeout(approvalFocusTimerRef.current);
      approvalFocusTimerRef.current = null;
    }
  }, []);

  /** 认领挂在 voiceDraftRef 的语音草稿：requestId 给了就必须对上（老网关不带时才按先到先得）。 */
  const takeVoiceDraft = useCallback((requestId?: string) => {
    const held = voiceDraftRef.current;
    if (!held) return null;
    if (requestId !== undefined && held.requestId !== requestId) return null;
    voiceDraftRef.current = null;
    return held.text;
  }, []);

  /** 这段语音草稿没地方可送了（建会话失败、断线）：退到剪贴板，别让这句话凭空消失。 */
  const rescueVoiceDraft = useCallback(
    (notice: string) => {
      const lost = takeVoiceDraft();
      if (!lost) return;
      void Clipboard.setStringAsync(lost);
      notifyPet(notice);
    },
    [notifyPet, takeVoiceDraft],
  );

  /** 转写结果回来了：按「说给谁」分流。录音、上限、失败复位都在 useVoiceInput 里。 */
  const handleVoiceTranscript = useCallback(
    (text: string, reason: VoiceStopReason) => {
      const target = voiceTargetRef.current;
      voiceTargetRef.current = null;
      if (!target) return;
      // 到上限自动停：不代发，把文字放回输入框，改完再发。
      if (reason === 'cap') {
        if (target.kind === 'session') {
          // 投递给会话页合并进输入框：不管它已经在屏幕上还是马上挂载，
          // 走同一条路（往里写草稿再靠挂载时读取，页面已经开着就永远读不到）。
          setVoiceDelivery({ key: randomUUID(), sessionId: target.sessionId, text });
          openSessionById(target.sessionId);
          notifyPet('到上限了，文字已放进输入框');
          return;
        }
        // 新会话：先把文字挂起来，等 session-created 回来再投递。
        const requestId = randomUUID();
        voiceDraftRef.current = { requestId, text };
        const created = client.send({
          type: 'session-create',
          requestId,
          ...(currentWorkspaceId ? { workspaceId: currentWorkspaceId } : {}),
        });
        if (!created) {
          // 会话建不出来就退到剪贴板，别让这句话凭空消失。
          voiceDraftRef.current = null;
          void Clipboard.setStringAsync(text);
          notifyPet('连接已断开，文字已复制到剪贴板');
          return;
        }
        // 回包丢了不能挂死：超时按 rescueVoiceDraft 的语义退剪贴板。
        armRequestTimeout(requestId, () => {
          if (voiceDraftRef.current?.requestId !== requestId) return;
          voiceDraftRef.current = null;
          void Clipboard.setStringAsync(text);
          notifyPet('新建会话超时，文字已复制到剪贴板');
        });
        notifyPet('到上限了，正在新建会话');
        return;
      }
      if (target.kind === 'session') {
        // control 断线时首页的待办可能是旧的：这时连「有没有审批」都不知道，
        // 不能把一句「同意」当成普通消息发进去，先打开会话让用户看现场。
        if (control.state !== 'ready') {
          openSessionById(target.sessionId);
          notifyPet('待办状态还没同步，已打开会话');
          return;
        }
        // 会话里有任何待处理项（审批/提问）时，语音只负责把用户带到现场，
        // 不替用户拍板：首页拿不到工具的完整命令，盲批的代价不可逆。
        const items = pendingItems(pendingRef.current, target.sessionId);
        if (items.length > 0) {
          const only = items.length === 1 ? items[0] : undefined;
          const approval = only?.kind === 'approval' ? only : undefined;
          const heard = text.length > 18 ? text.slice(0, 18) + '…' : text;
          openSessionById(target.sessionId);
          if (approval) {
            setApprovalFocus(approval.rpcId);
            notifyPet(`听到「${heard}」，请在审批卡上确认`);
            if (approvalFocusTimerRef.current) clearTimeout(approvalFocusTimerRef.current);
            approvalFocusTimerRef.current = setTimeout(() => {
              setApprovalFocus((current) => (current === approval.rpcId ? null : current));
              approvalFocusTimerRef.current = null;
            }, 5000);
          } else {
            notifyPet(`听到「${heard}」，这个会话在等你处理`);
          }
          return;
        }
        const requestId = randomUUID();
        const sent = client.send({
          type: 'message',
          requestId,
          sessionId: target.sessionId,
          text,
        });
        if (!sent) {
          notifyPet('没发出去，检查网络后再试');
          return;
        }
        voiceMessagePendingRef.current = requestId;
        return;
      }
      // 新会话：一条 message 就够，网关会先建会话再发。
      const requestId = randomUUID();
      const sent = client.send({
        type: 'message',
        requestId,
        text,
        ...(currentWorkspaceId ? { workspaceId: currentWorkspaceId } : {}),
      });
      if (!sent) {
        notifyPet('没发出去，检查网络后再试');
        return;
      }
      voiceCreateRequestRef.current = requestId;
      // sent 丢了（断线/网关无回执）不能一直挂着等：超时就提示重说，不自动重发。
      armRequestTimeout(requestId, () => {
        if (voiceCreateRequestRef.current !== requestId) return;
        voiceCreateRequestRef.current = null;
        notifyPet('没收到网关回执，检查网络后再试');
      });
    },
    [armRequestTimeout, client, control, currentWorkspaceId, notifyPet, openSessionById],
  );

  const voiceInput = useVoiceInput({
    client,
    catalog: speechCatalog,
    onNotice: notifyPet,
    onTranscript: handleVoiceTranscript,
  });

  useEffect(
    () => () => {
      if (approvalFocusTimerRef.current) clearTimeout(approvalFocusTimerRef.current);
    },
    [],
  );

  // 帧处理器单独取出来：引用稳定，放进 handleFrame 的依赖不会让帧监听器反复重订阅
  // （整个 voiceInput 对象每 0.5s 录音计时换一次引用，直接依赖它会每次重挂监听）。
  const {
    handleTranscript: handleVoiceFrame,
    handleTranscribeFailure: handleVoiceFailure,
  } = voiceInput;

  const handleFrame = useCallback(
    (frame: ServerFrame) => {
      switch (frame.kind) {
        case 'hello': {
          const helloFrame = frame as HelloFrame;
          setHello(helloFrame);
          if (helloFrame.authenticated) {
            client.send({ type: 'sessions' });
            // 分组/置顶/归档一次拿全；这条不是廉价查询，只在这几个时机重发。
            client.send({ type: 'workspaces' });
            // 语音是可选能力：先问一次，服务器没启用就别在界面上画饼。
            client.send({ type: 'speech-catalog', requestId: randomUUID() });
          }
          // 网关自报的名字比 URL 好认，顺手补进本地记录里。
          const current = savedRef.current;
          if (helloFrame.gatewayName && current && current.gatewayName !== helloFrame.gatewayName) {
            const next = { ...current, gatewayName: helloFrame.gatewayName };
            savedRef.current = next;
            setSaved(next);
            upsertGateway(next)
              .then(() => loadGateways().then(setGateways))
              .catch(() => undefined);
          }
          break;
        }
        case 'paired': {
          const paired = frame as { token: string; device?: { id: string } };
          const base = pendingGateway.current ?? savedRef.current;
          if (!base) break;
          const next: SavedGateway = { ...base, token: paired.token };
          pendingGateway.current = null;
          savedRef.current = next;
          setSaved(next);
          upsertGateway(next)
            .then((entry) => {
              savedRef.current = entry;
              setSaved(entry);
              void loadGateways().then(setGateways);
            })
            .catch(() => undefined);
          // 拿到长期 token 之后 control 通道才能连；配对码是一次性的，不能复用。
          void startControl(next);
          break;
        }
        case 'sessions': {
          const list = (frame as { items?: SessionItem[] }).items ?? [];
          setSessions(list);
          // 未读：比上次看到的 updatedAt 更新、且不是当前打开的那个会话。
          // 第一次拿列表只建立基线——否则冷启动会把所有会话都标成未读。
          const seen = seenAtRef.current;
          if (!seen) {
            seenAtRef.current = new Map(list.map((item) => [item.sessionId, item.updatedAt ?? 0]));
          } else {
            const openId = activeIdRef.current;
            const fresh: string[] = [];
            for (const item of list) {
              const prev = seen.get(item.sessionId);
              const at = item.updatedAt ?? 0;
              if (prev !== undefined && at > prev && item.sessionId !== openId) {
                fresh.push(item.sessionId);
              }
              seen.set(item.sessionId, Math.max(prev ?? 0, at));
            }
            if (fresh.length > 0) {
              setUnreadIds((current) => {
                const next = new Set(current);
                fresh.forEach((id) => next.add(id));
                return next;
              });
            }
          }
          // 顺手存一份：断网冷启动时先摆出上次的列表，总比一张配对二维码有用。
          const gateway = savedRef.current;
          if (gateway) void writeJson(sessionsCacheKey(gateway.id), list.slice(0, 30));
          // 按 ID 打开会话（分叉→来源）时 active 里没有标题，列表刷新后补上，
          // 否则标题栏一直显示「未命名会话」。
          setActive((current) => {
            if (!current) return current;
            const match = list.find((item) => item.sessionId === current.sessionId);
            return match ? { ...current, ...match } : current;
          });
          break;
        }
        case 'directories': {
          const listing = mapDirectories(frame);
          if (!listing) break;
          setDirListing(listing);
          setDirLoading(false);
          setDirError(null);
          // 建 mobile 工作区的第一步：拿到 home 之后建子目录。
          const job = creatingWorkspaceRef.current;
          if (job && job.stage === 'probe' && listing.path) {
            creatingWorkspaceRef.current = { stage: 'mkdir', home: listing.path };
            client.send({ type: 'directory-create', path: listing.path, name: 'mobile' });
          }
          break;
        }
        case 'directory-create': {
          const job = creatingWorkspaceRef.current;
          if (!job || job.stage !== 'mkdir') break;
          const created = frame as unknown as { path?: string };
          const target = created.path ?? job.home + '/mobile';
          creatingWorkspaceRef.current = null;
          client.send({ type: 'workspace-create', path: target });
          break;
        }
        case 'workspace-create': {
          const created = frame as unknown as {
            workspace?: { workspaceId?: string; title?: string };
            created?: boolean;
          };
          const workspaceId = created.workspace?.workspaceId;
          if (workspaceId) {
            workspaceTouchedRef.current = true;
            setCurrentWorkspaceId(workspaceId);
            const gateway = savedRef.current;
            if (gateway) void writeJson('workspace-' + gateway.id, { workspaceId });
          }
          // 重新拉一次，让分组和选择器都看到新工作区。
          client.send({ type: 'workspaces' });
          break;
        }
        case 'session-queues': {
          const queuesFrame = frame as unknown as { queues?: Record<string, unknown> };
          const next: Record<string, QueuedMessage[]> = {};
          for (const [sessionId, items] of Object.entries(queuesFrame.queues ?? {})) {
            const parsed = mapQueue(items);
            if (parsed.length) next[sessionId] = parsed;
          }
          setQueues(next);
          break;
        }
        case 'session-queue': {
          const queueFrame = frame as unknown as { sessionId?: string; items?: unknown };
          if (!queueFrame.sessionId) break;
          const parsed = mapQueue(queueFrame.items);
          setQueues((current) => {
            const next = { ...current };
            if (parsed.length) next[queueFrame.sessionId as string] = parsed;
            else delete next[queueFrame.sessionId as string];
            return next;
          });
          break;
        }
        case 'session-archives': {
          setArchived((frame as { archivedSessionIds?: string[] }).archivedSessionIds ?? []);
          break;
        }
        case 'workspaces': {
          const snapshot = frame as unknown as WorkspacesFrame;
          if (!Array.isArray(snapshot.items)) break;
          setWorkspaceFrame(snapshot);
          // 选过的工作区被删了就退回「默认目录」，别让新建一直失败。
          setCurrentWorkspaceId((current) => {
            if (current) {
              return snapshot.items.some((item) => item.workspaceId === current) ? current : null;
            }
            // 用户还没挑过：有 mobile 就默认用它，这是设计上约定的「手机默认工作区」。
            if (workspaceTouchedRef.current) return current;
            const mobile = snapshot.items.find((item) => item.title.trim().toLowerCase() === 'mobile');
            return mobile ? mobile.workspaceId : current;
          });
          const nextArchived = Array.isArray(snapshot.archivedSessionIds)
            ? snapshot.archivedSessionIds
            : [];
          // 归档集合是整体替换语义；内容没变就别换引用，否则整列表白重绘一次。
          setArchived((current) =>
            current.length === nextArchived.length &&
            current.every((id, index) => id === nextArchived[index])
              ? current
              : nextArchived,
          );
          break;
        }
        case 'projection-baseline': {
          // 基线是所有已附着会话的快照，不能拿它判断未读。
          setOutlines((current) => applyOutlineFrame(current, frame) ?? current);
          break;
        }
        case 'turn-outline-updated': {
          setOutlines((current) => applyOutlineFrame(current, frame) ?? current);
          // 一轮结束才会推 outline；不是当前打开的会话，就算一条新消息。
          const updatedId = (frame as unknown as { sessionId?: string }).sessionId;
          if (updatedId && updatedId !== activeIdRef.current) {
            setUnreadIds((current) => {
              if (current.has(updatedId)) return current;
              const next = new Set(current);
              next.add(updatedId);
              return next;
            });
          }
          break;
        }
        case 'speech-catalog':
        case 'speech-state': {
          const catalog = mapSpeechCatalog(frame);
          if (catalog) setSpeechCatalog(catalog);
          break;
        }
        case 'speech-transcript': {
          // 转写结果的 requestId 匹配、状态复位、提示都在 useVoiceInput 里，
          // 这里只接收结果（发给谁由 handleVoiceTranscript 决定）。
          handleVoiceFrame(frame);
          break;
        }
        case 'sent': {
          // 只认自己这次语音请求的回执；不能用布尔值等「任意一条 sent」。
          const sent = frame as unknown as { requestId?: string; sessionId?: string };
          // 发件箱条目也按 requestId 认领：这声回执才算真正送到了网关。
          outbox.ack(sent.requestId);
          settleRequestTimeout(sent.requestId);
          if (voiceCreateRequestRef.current && sent.requestId === voiceCreateRequestRef.current) {
            voiceCreateRequestRef.current = null;
            if (sent.sessionId) {
              setActive({
                sessionId: sent.sessionId,
                updatedAt: Date.now(),
                running: false,
                blank: false,
              });
              client.send({ type: 'sessions' });
              notifyPet('已发出');
            } else {
              notifyPet('已发出，但没拿到会话 id');
            }
            break;
          }
          if (voiceMessagePendingRef.current && sent.requestId === voiceMessagePendingRef.current) {
            voiceMessagePendingRef.current = null;
            notifyPet('已发出');
          }
          break;
        }
        case 'session-status': {
          const status = frame as unknown as { sessionId?: string; running?: boolean };
          if (!status.sessionId) break;
          const running = status.running === true;
          // 列表里没有这个会话（别处新建的）就补拉一次，否则首页根本看不到它。
          if (!knownSessionsRef.current.has(status.sessionId)) {
            client.send({ type: 'sessions' });
          }
          setSessions((current) =>
            current.map((item) =>
              item.sessionId === status.sessionId && item.running !== running
                ? { ...item, running }
                : item,
            ),
          );
          setActive((current) =>
            current && current.sessionId === status.sessionId && current.running !== running
              ? { ...current, running }
              : current,
          );
          break;
        }
        case 'fork': {
          // 分叉出来的是新会话，直接切过去看。
          const forked = frame as { sessionId?: string };
          if (!forked.sessionId) break;
          setActive({
            sessionId: forked.sessionId,
            updatedAt: Date.now(),
            running: false,
            blank: true,
          });
          client.send({ type: 'sessions' });
          break;
        }
        case 'session-created': {
          const created = frame as { sessionId: string; requestId?: string };
          setCreating(false);
          creatingRequestRef.current = null;
          settleRequestTimeout(created.requestId);
          setActive({
            sessionId: created.sessionId,
            updatedAt: Date.now(),
            running: false,
            blank: true,
          });
          // 到上限自动停下来的那句话：只认自己那次 session-create 的响应，
          // 会话页挂载后由投递把它合并进输入框。
          const held = takeVoiceDraft(created.requestId);
          if (held) {
            setVoiceDelivery({ key: randomUUID(), sessionId: created.sessionId, text: held });
            notifyPet('到上限了，文字已放进输入框');
          }
          break;
        }
        case 'session-renamed': {
          const renamed = frame as { sessionId?: string; title?: string };
          if (renamed.sessionId && renamed.title) applyTitle(renamed.sessionId, renamed.title);
          break;
        }
        case 'session-title-changed': {
          const changed = frame as { sessionId?: string; title?: string | null };
          if (changed.sessionId && changed.title) applyTitle(changed.sessionId, changed.title);
          break;
        }
        case 'history':
        case 'session-snapshot': {
          // 会话数据能正常回来，说明链路是通的，别让上一条报错一直挂在顶上。
          setError(null);
          break;
        }
        case 'error': {
          const failure = frame as {
            code?: string;
            message?: string;
            requestType?: string;
            requestId?: string;
          };
          setCreating(false);
          creatingRequestRef.current = null;
          settleRequestTimeout(failure.requestId);
          const text = `${failure.code ?? 'error'}：${failure.message ?? ''}`;
          // 被整个拒收、连回执都等不到的待发消息：标失败，交给会话页给重试/移除。
          outbox.fail(failure.requestId, text);
          handleVoiceFailure(failure);
          if (voiceMessagePendingRef.current && failure.requestId === voiceMessagePendingRef.current) {
            voiceMessagePendingRef.current = null;
            notifyPet('没发出去，检查网络后再试');
          }
          if (voiceCreateRequestRef.current && failure.requestId === voiceCreateRequestRef.current) {
            voiceCreateRequestRef.current = null;
            notifyPet('没发出去，检查网络后再试');
          }
          // 到上限那句语音卡在「等新会话」上：建会话失败就退剪贴板，
          // 别让它挂在 ref 里、被之后随便哪次新建的会话消费掉。
          if (
            voiceDraftRef.current &&
            failure.requestType === 'session-create' &&
            (failure.requestId === undefined ||
              failure.requestId === voiceDraftRef.current.requestId)
          ) {
            rescueVoiceDraft('会话没建成，文字已复制到剪贴板');
          }
          // 目录读失败就留在选择器里显示，别把用户弹回列表页。
          if (failure.requestType === 'directories') {
            setDirLoading(false);
            setDirError(text);
            break;
          }
          // 建 mobile 工作区时目录已经存在不算失败，接着去注册就行。
          if (failure.requestType === 'directory-create' && failure.code === 'directory-exists') {
            const job = creatingWorkspaceRef.current;
            if (job && job.stage === 'mkdir') {
              creatingWorkspaceRef.current = null;
              client.send({ type: 'workspace-create', path: job.home + '/mobile' });
              break;
            }
          }
          setError(text);
          break;
        }
        default:
          break;
      }
    },
    [
      applyTitle,
      client,
      notifyPet,
      settleRequestTimeout,
      startControl,
      rescueVoiceDraft,
      takeVoiceDraft,
      // 帧处理器是稳定引用（见上面的解构注释），放进来不会让帧监听器重订阅。
      handleVoiceFailure,
      handleVoiceFrame,
    ],
  );

  useEffect(() => {
    const offState = client.onState((next, message) => {
      setState(next);
      setDetail(message ?? null);
      if (next === 'ready') {
        setError(null);
        // 断线期间写下的消息在重连后补发，顺序按写入先后；只发当前网关的，
        // 旧版本没记网关的条目按当前网关收养一次并说一声。
        const flushed = outbox.flush((frame) => client.send(frame), savedRef.current?.id);
        if (flushed.adopted > 0) {
          notifyPet(`${flushed.adopted} 条旧待发消息按当前网关继续发送`);
        }
      } else {
        // 等 session-created 的那句语音草稿等不到了：重连后网关也不会重放响应。
        rescueVoiceDraft('连接断了，文字已复制到剪贴板');
      }
    });
    const offFrame = client.onFrame(handleFrame);
    return () => {
      offState();
      offFrame();
    };
  }, [client, handleFrame, notifyPet, rescueVoiceDraft]);

  const connectWith = useCallback(
    async (gateway: SavedGateway, pairingCode?: string) => {
      setBusy(true);
      setError(null);
      try {
        const deviceId = await getDeviceId();
        deviceIdRef.current = deviceId;
        // 工作区偏好按网关各存一份，切网关不会串。
        workspaceTouchedRef.current = false;
        const storedWorkspace = await readJson<{ workspaceId?: string | null }>(
          'workspace-' + gateway.id,
        );
        setCurrentWorkspaceId(storedWorkspace?.workspaceId ?? null);
        if (storedWorkspace?.workspaceId) workspaceTouchedRef.current = true;
        client.connect({
          url: gateway.url,
          token: gateway.token,
          pairingCode,
          deviceId,
          deviceName: getDeviceName(),
        });
        if (gateway.token) void startControl(gateway);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : '连接失败');
      } finally {
        setBusy(false);
      }
    },
    [client, startControl],
  );

  const pairWithText = useCallback(
    async (text: string) => {
    if (pairingRef.current) return;
    pairingRef.current = true;
    setError(null);
    try {
      const payload = parsePairingPayload(text);
      // publicUrl 永远是网关自己的本机地址；公网/局域网入口在 endpoints 里。
      // 优先选 wss（手机走公网），没有则退回 publicUrl。
      const candidates = [payload.publicUrl, ...(payload.endpoints ?? [])];
      const url = candidates.find((item) => item.startsWith('wss://')) ?? candidates[0];
      const gateway: SavedGateway = {
        id: payload.gatewayId ? 'gw:' + payload.gatewayId : 'url:' + url,
        url,
        label: payload.gatewayName ?? new URL(url).host,
        gatewayId: payload.gatewayId,
        endpoints: candidates,
      };
      pendingGateway.current = gateway;
      setPairingText('');
      await connectWith(gateway, payload.pairingCode);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '配对失败');
    } finally {
      pairingRef.current = false;
    }
    },
    [connectWith],
  );

  const handlePair = useCallback(() => {
    void pairWithText(pairingText);
  }, [pairWithText, pairingText]);

  // 冷启动：先把离线发件箱读回来，再决定要不要自动重连。
  useEffect(() => {
    void outbox.load();
    return outbox.subscribe(() => setOutboxTick((value) => value + 1));
  }, []);

  // 从会话页回到列表时刷新草稿标记（草稿是在会话页里改的）。
  useEffect(() => {
    if (active) return;
    void draftSessionIds().then(setDraftIds);
  }, [active]);

  /** 会话页 → 列表：左上角「<」与 Android 系统返回键共用同一动作。 */
  const closeSession = useCallback(() => {
    setActive(null);
    client.send({ type: 'sessions' });
  }, [client]);

  // Android 系统返回键：会话页按返回回列表，不再直接退出 App（FLOW-4）。
  // 列表/配对页不拦截，交回系统（退出是根页面的正常语义）；各种面板都是 RN Modal
  // 且带 onRequestClose——Modal 开着时 RN 不会把返回键派发到这里。
  const hasActiveSession = active !== null;
  useEffect(() => {
    if (!hasActiveSession) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeSession();
      return true;
    });
    return () => sub.remove();
  }, [closeSession, hasActiveSession]);

  // 冷启动：有保存的 token 就直接重连，不再让用户手动点一次。
  useEffect(() => {
    let cancelled = false;
    void loadGateways().then((items) => {
      if (!cancelled) setGateways(items);
    });
    loadActiveGateway()
      .then(async (gateway) => {
        if (cancelled || !gateway) return;
        savedRef.current = gateway;
        setSaved(gateway);
        const cached = await readJson<SessionItem[]>(sessionsCacheKey(gateway.id));
        if (!cancelled && cached?.length) setSessions(cached);
        if (gateway.token) void connectWith(gateway);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connectWith]);

  const handleCreate = useCallback(() => {
    if (!connected) return;
    setCreating(true);
    setError(null);
    const requestId = randomUUID();
    creatingRequestRef.current = requestId;
    // 回包丢了（网关吞帧/半开连接）不能让「正在新建」永远挂着：超时撤掉并提示重试。
    armRequestTimeout(requestId, () => {
      if (creatingRequestRef.current !== requestId) return;
      creatingRequestRef.current = null;
      setCreating(false);
      setError('建会话超时了，再点一次「新建会话」');
      notifyPet('建会话超时，重试一下');
    });
    // 选中工作区就开在里面；没选就让宿主用默认目录，不去猜。
    const sent = client.send({
      type: 'session-create',
      requestId,
      ...(currentWorkspaceId ? { workspaceId: currentWorkspaceId } : {}),
    });
    if (!sent) {
      settleRequestTimeout(requestId);
      creatingRequestRef.current = null;
      setCreating(false);
      setError('连接已断开，重连后再试');
    }
  }, [armRequestTimeout, client, connected, currentWorkspaceId, notifyPet, settleRequestTimeout]);

  /** 按住语音球：录到谁、上限、提示、复位都在共享的 useVoiceInput 里。 */
  const holdVoiceOrb = useCallback(
    (target: { kind: 'new' } | { kind: 'session'; sessionId: string }) => {
      // 按住被拒（上一段还在收尾/转写）时不能改目标：转写回来会按新的目标分发，
      // 上一句话就发进别的会话了。
      if (!voiceInput.begin()) return;
      voiceTargetRef.current = target;
    },
    [voiceInput],
  );


  /** 换当前工作区：只影响之后新建的会话，历史会话一个都不动。 */
  const pickWorkspace = useCallback((id: string) => {
    setWorkspaceSheet(false);
    if (id === 'create-mobile') {
      // 先从 home 开始探路，拿到路径后由 directories 分支接着建。
      creatingWorkspaceRef.current = { stage: 'probe' };
      client.send({ type: 'directories' });
      return;
    }
    const next = id === 'default' ? null : id;
    workspaceTouchedRef.current = true;
    setCurrentWorkspaceId(next);
    const gateway = savedRef.current;
    if (gateway) void writeJson('workspace-' + gateway.id, { workspaceId: next });
  }, [client]);

  const workspaceActions = useMemo<SheetAction[]>(() => {
    const items = workspaceFrame?.items ?? [];
    return [
      ...items.map((item) => ({
        id: item.workspaceId,
        label: item.title,
        hint: item.path,
      })),
      { id: 'default', label: '默认目录', hint: '用网关自己的默认工作目录' },
      { id: 'create-mobile', label: '新建 mobile 工作区', hint: '在宿主 home 下建 mobile 目录并注册' },
    ];
  }, [workspaceFrame]);

  const workspaceLabel = useMemo(() => {
    if (!currentWorkspaceId) return '默认目录';
    const found = workspaceFrame?.items.find((item) => item.workspaceId === currentWorkspaceId);
    return found?.title ?? '默认目录';
  }, [currentWorkspaceId, workspaceFrame]);

  /** 拉一层目录；不带 path 就是宿主 home。 */
  const openDirectory = useCallback(
    (path?: string) => {
      setDirError(null);
      setDirLoading(true);
      if (!client.send({ type: 'directories', path })) {
        setDirLoading(false);
        setDirError('连接已断开，无法读取目录');
      }
    },
    [client],
  );

  /** 在选中的目录里开新会话：session-create 支持直接带 cwd。 */
  const createInDirectory = useCallback(() => {
    const cwd = dirListing?.path;
    if (!cwd) return;
    if (!connected) {
      setDirError('连接已断开，重连后再试');
      return;
    }
    setDirPicker(false);
    setCreating(true);
    setError(null);
    const requestId = randomUUID();
    creatingRequestRef.current = requestId;
    armRequestTimeout(requestId, () => {
      if (creatingRequestRef.current !== requestId) return;
      creatingRequestRef.current = null;
      setCreating(false);
      setError('建会话超时了，再点一次「新建会话」');
      notifyPet('建会话超时，重试一下');
    });
    if (!client.send({ type: 'session-create', requestId, cwd })) {
      settleRequestTimeout(requestId);
      creatingRequestRef.current = null;
      setCreating(false);
      setError('连接已断开，重连后再试');
    }
  }, [armRequestTimeout, client, connected, dirListing, notifyPet, settleRequestTimeout]);

  const createActions = useMemo<SheetAction[]>(
    () => [
      { id: 'default', label: '新建会话', hint: '用网关的默认工作目录' },
      { id: 'pick', label: '选择目录…', hint: '指定一个项目目录再开始' },
    ],
    [],
  );

  const runCreateAction = useCallback(
    (id: string) => {
      setCreateSheet(false);
      if (id === 'pick') {
        // 每次都从宿主 home 重新开始，别把上次浏览到的目录闪出来。
        setDirListing(null);
        setDirPicker(true);
        openDirectory();
        return;
      }
      handleCreate();
    },
    [handleCreate, openDirectory],
  );

  /** 顶部网关菜单：切换、添加、移除。 */
  const gatewayActions = useMemo<SheetAction[]>(() => {
    const list: SheetAction[] = gateways.map((item) => {
      const name = item.gatewayName ?? item.label ?? hostOf(item.url);
      const current = item.id === saved?.id;
      const hint = [current ? (connected ? '当前 · 已连接' : '当前') : null, hostOf(item.url)]
        .filter(Boolean)
        .join(' · ');
      return { id: 'gw:' + item.id, label: (current ? '✓ ' : '') + name, hint };
    });
    list.push({ id: 'add', label: '＋ 添加网关', hint: '扫码或粘贴配对串' });
    if (saved) {
      list.push({
        id: 'forget',
        label: '移除当前网关',
        hint: '只删本地记录，服务器上的设备授权需要另行撤销',
        destructive: true,
      });
    }
    return list;
  }, [connected, gateways, saved]);

  const handleReconnect = useCallback(() => {
    if (saved) connectWith(saved);
  }, [connectWith, saved]);

  /**
   * 把某个网关的会话缓存摆出来（切网关时用）：
   * 「连接断开」空态只应出现在真的没有任何缓存时，别把刚切过去的网关画成空列表。
   * 读盘期间用户又切走了就丢弃——缓存不能盖到别的网关头上。
   */
  const revealCachedSessions = useCallback(async (gatewayId: string) => {
    const cached = await readJson<SessionItem[]>(sessionsCacheKey(gatewayId));
    if (!cached?.length || savedRef.current?.id !== gatewayId) return;
    // 实时列表已经到了就让它赢：缓存只在当前还空着时垫场。
    setSessions((current) => (current.length === 0 ? cached : current));
  }, []);

  /** 切到另一台网关：上一个网关的会话/队列都不属于新网关，先清干净再连。 */
  const switchGateway = useCallback(
    async (gateway: SavedGateway) => {
      setGatewaySheet(false);
      if (gateway.id === savedRef.current?.id && connected) return;
      clearApprovalFocus();
      client.disconnect();
      control.disconnect();
      setSessions([]);
      setQueues({});
      setActive(null);
      clearPending();
      setHello(null);
      setError(null);
      setArchived([]);
      savedRef.current = gateway;
      setSaved(gateway);
      void revealCachedSessions(gateway.id);
      await activateGateway(gateway.id).catch(() => undefined);
      await connectWith(gateway);
    },
    [clearApprovalFocus, clearPending, client, connected, connectWith, control, revealCachedSessions],
  );

  const forgetGateway = useCallback(
    (gateway: SavedGateway) => {
      const name = gateway.gatewayName ?? gateway.label ?? new URL(gateway.url).host;
      Alert.alert('移除网关', `不再连接 ${name}？本地记录会被删除。`, [
        { text: '取消', style: 'cancel' },
        {
          text: '移除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const rest = await removeGateway(gateway.id);
              setGateways(rest);
              void removeJson(sessionsCacheKey(gateway.id));
              dropCachedGateway(gateway.id);
              if (gateway.id !== savedRef.current?.id) return;
              // 删掉的正好是当前网关：断开并退回到列表/扫码页。
              clearApprovalFocus();
              client.disconnect();
              control.disconnect();
              savedRef.current = null;
              setSaved(null);
              setHello(null);
              setSessions([]);
              setActive(null);
              const next = rest[0];
              if (next) {
                savedRef.current = next;
                setSaved(next);
                void revealCachedSessions(next.id);
                await activateGateway(next.id).catch(() => undefined);
                await connectWith(next);
              }
            })();
          },
        },
      ]);
    },
    [clearApprovalFocus, clearPending, client, connectWith, control, revealCachedSessions],
  );

  const submitRename = useCallback(() => {
    const target = renaming;
    const title = renameDraft.trim();
    if (!target) return;
    if (!title) {
      Alert.alert('名称不能为空');
      return;
    }
    client.send({ type: 'session-rename', sessionId: target.sessionId, title });
    setRenaming(null);
  }, [client, renameDraft, renaming]);

  const openSessionMenu = useCallback((item: SessionItem) => setMenuSession(item), []);

  const sessionActions = useMemo<SheetAction[]>(() => {
    const item = menuSession;
    if (!item) return [];
    const isArchived = archived.includes(item.sessionId);
    return [
      {
        id: 'rename',
        label: '重命名',
        hint: item.projections?.values.title ?? '未命名会话',
      },
      {
        id: 'fork',
        label: '从最近一轮分叉',
        hint: '复制出一个新会话，原会话不动',
      },
      isArchived
        ? { id: 'unarchive', label: '取消归档' }
        : { id: 'archive', label: '归档', hint: '从列表里收起来，随时可以再显示' },
    ];
  }, [archived, menuSession]);

  const runSessionAction = useCallback(
    (id: string) => {
      const item = menuSession;
      setMenuSession(null);
      if (!item) return;
      if (id === 'rename') {
        setRenameDraft(item.projections?.values.title ?? '');
        setRenaming(item);
        return;
      }
      if (id === 'fork') {
        client.send({ type: 'fork', sessionId: item.sessionId });
        return;
      }
      if (id === 'archive') {
        client.send({ type: 'session-archive', sessionId: item.sessionId, archived: true });
        return;
      }
      if (id === 'unarchive') {
        client.send({ type: 'session-archive', sessionId: item.sessionId, archived: false });
      }
    },
    [client, menuSession],
  );

  const handleForget = useCallback(async () => {
    Alert.alert(
      '清除配对？',
      '清除后本机保存的设备凭证会被删除，再连接需要在服务器上重新运行 dsh-pair 生成新的配对码（旧码不能复用）。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              client.disconnect();
              control.disconnect();
              await clearGateway();
              savedRef.current = null;
              pendingGateway.current = null;
              setSaved(null);
              setHello(null);
              setSessions([]);
              setActive(null);
              setError(null);
              clearPending();
              setGateways([]);
              setQueues({});
            })();
          },
        },
      ],
    );
  }, [client, control]);

  if (scanning) {
    return (
      <ScanScreen
        onScanned={(payload) => {
          setScanning(false);
          setAddGateway(false);
          void pairWithText(payload);
        }}
        onCancel={() => setScanning(false)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={t.name === 'paper' ? 'dark' : 'light'} />
      {/* Android 走 edge-to-edge 时窗口不会自己缩，必须让 KAV 补键盘高度。
          这一层包住整屏，frame 底边正好是屏幕底边，算出来的重叠量最准。 */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {/* 会话页自己有一层带返回和状态胶囊的头，全局头再顶一遍会白吃 90dp。 */}
        {active ? null : (
        <View style={styles.header}>
          <Pressable
            style={styles.headerTitleBlock}
            onPress={() => setGatewaySheet(true)}
            hitSlop={8}
          >
            <Text style={styles.title}>
              DSH{gateways.length > 1 ? <Text style={styles.titleCount}> {gateways.length}</Text> : null}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {hello?.gatewayName ?? saved?.gatewayName ?? saved?.label ?? '未配置网关'}
              <Text style={styles.subtitleChevron}> ›</Text>
            </Text>
          </Pressable>
          <View style={styles.statusPill}>
            <View
              style={[
                styles.statusDot,
                connected ? styles.dotOn : state === 'connecting' ? styles.dotBusy : styles.dotOff,
              ]}
            />
            <Text style={styles.statusText}>{STATE_LABEL[state]}</Text>
          </View>
        </View>
        )}

        {detail && !connected ? (
          <Pressable
            onPress={saved && !detail.includes('重新配对') ? handleReconnect : undefined}
            hitSlop={6}
          >
            <Text style={styles.hint}>
              {detail}
              {detail.includes('重新配对')
                ? ' · 点顶部网关名'
                : saved
                  ? ' · 点这里重连'
                  : ''}
            </Text>
          </Pressable>
        ) : null}
        {error ? (
          <Pressable onPress={() => setError(null)} hitSlop={6}>
            <Text style={styles.error}>{error} · 点击关闭</Text>
          </Pressable>
        ) : null}

        {/* 断线时不卸载（保留历史/草稿/附件）；只有切换 sessionId 才重挂载，
            让引用、目录信任、待发回显、语音请求和滚动锚点跟着上一会话一起结束。 */}
        {active ? (
          <SessionScreen
            key={active.sessionId}
            client={client}
            session={active}
            queued={queues[active.sessionId] ?? []}
            capabilities={hello?.capabilities ?? []}
            // 会话页的语音上限/就绪判断要和首页同一份目录，不能各猜各的
            speechCatalog={speechCatalog}
            // 离线待发消息按网关归属，切网关后不会把上一个网关的待发消息甩过去
            gatewayId={saved?.id}
            // 首页语音到上限的文字：由会话页合并进输入框（挂载中/刚挂载都算）
            voiceDelivery={voiceDelivery}
            onVoiceDeliveryTaken={clearVoiceDelivery}
            running={Boolean(active.running)}
            sessions={visibleSessions}
            blockedSessionIds={sessions
              .filter((item) => pendingItems(pending, item.sessionId).length > 0)
              .map((item) => item.sessionId)}
            onRunningChange={(next) => {
              // 运行状态放这里存：重连后 sessions 帧会把它刷成服务端的真实值，
              // 会话页只负责读，不会再各存一份各跑各的。
              setActive((current) =>
                current && current.running !== next ? { ...current, running: next } : current,
              );
            }}
            onBack={closeSession}
            onOpenSession={(sessionId) => {
              openSession({ sessionId, updatedAt: Date.now(), running: false, blank: false });
              // 新 active 只有 id，标题/目录要等列表回来补。
              client.send({ type: 'sessions' });
            }}
            onForked={(sessionId) => {
              // 分叉出来的是个全新会话，列表里还没有它，先塞个占位再让网关补全。
              setActive({
                sessionId,
                updatedAt: Date.now(),
                running: false,
                blank: true,
                parentSessionId: active.sessionId,
              });
              client.send({ type: 'sessions' });
            }}
            focusApprovalRpcId={approvalFocus}
            onApprovalFocusHandled={clearApprovalFocus}
          />
        ) : connected || saved ? (
          // 已经配过网关就别再退回「扫码配对」：断线时保留列表，顶部提示重连，
          // 只有一台网关都没配过时才需要配对页。
          <View style={styles.flex}>
            {(() => {
              const blocked = sessions.filter((item) => pendingItems(pending, item.sessionId).length > 0);
              if (blocked.length === 0) return null;
              return (
                <Pressable
                  style={styles.gatePill}
                  onPress={() => openSession(blocked[0])}
                  accessibilityHint="跳到第一个等待审批或回答的会话"
                >
                  <View style={styles.pendingDot} />
                  <Text style={styles.gatePillText}>
                    {blocked.length === 1
                      ? `${blocked[0].projections?.values.title ?? '一个会话'} 在等你`
                      : `${blocked.length} 个会话在等你`}
                  </Text>
                  <Text style={styles.gatePillGo}>打开</Text>
                </Pressable>
              );
            })()}
            {tab === 'focus' ? (
              <FocusHome
                items={focusItems}
                connected={connected}
                pendingTotal={pendingCount}
                voiceReady={voiceReady}
                mood={petMood}
                unreadIds={unreadIds}
                notice={petNotice}
                workspaceLabel={workspaceLabel}
                onPickWorkspace={() => setWorkspaceSheet(true)}
                onOpen={(sessionId) => {
                  const target = sessions.find((item) => item.sessionId === sessionId);
                  if (target) openSession(target);
                }}
                onCreate={handleCreate}
                onHoldOrb={() => holdVoiceOrb({ kind: 'new' })}
                onHoldCard={(sessionId) => holdVoiceOrb({ kind: 'session', sessionId })}
                onRelease={() => voiceInput.end()}
                onCancelVoice={() => voiceInput.cancel()}
                recording={voiceInput.recording}
                transcribing={voiceInput.transcribing}
                voiceElapsed={voiceInput.elapsed}
                voiceLimit={voiceInput.limit}
                voiceAlmostUp={voiceInput.almostUp}
              />
            ) : tab === 'schedules' ? (
              <SchedulesView
                rows={mapSchedules(schedules)}
                catalogReady={schedules !== null}
                control={control}
                rawItems={schedules}
                onChanged={() => control.send({ type: 'schedule-catalog' })}
              />
            ) : tab === 'plugins' ? (
              <PluginsView
                control={control}
                capabilities={hello?.capabilities ?? []}
                gatewayName={hello?.gatewayName}
                protocol={hello?.protocol}
                deviceName={hello?.device?.name}
                speechReady={voiceReady}
              />
            ) : (
            <>
            <Pressable style={styles.metaRow} onPress={() => setHostSheet(true)}>
              <Text style={styles.metaLabel}>设备</Text>
              <Text style={styles.metaValue}>{hello?.device?.name ?? '未知'}</Text>
              <Text style={styles.metaLabel}>协议</Text>
              <Text style={styles.metaValue}>v{hello?.protocol ?? '?'}</Text>
              <Text style={styles.metaAction}>宿主 ›</Text>
            </Pressable>
            {sessions.length > 3 ? (
              <View style={styles.searchWrap}>
                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="搜索标题或目录"
                  placeholderTextColor={t.text.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {search ? (
                  <Pressable hitSlop={10} onPress={() => setSearch('')} style={styles.searchClear}>
                    <Text style={styles.searchClearText}>×</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <View style={styles.dirHead}>
              <Text style={styles.dirTitle} maxFontSizeMultiplier={1.3}>
                全部工作区与会话目录
              </Text>
              <Text style={styles.dirCount}>{visibleSessions.length} 个</Text>
              <Pressable
                style={[styles.newButton, !connected && styles.newButtonOff]}
                onPress={() => setCreateSheet(true)}
                disabled={creating || !connected}
              >
                {creating ? (
                  <ActivityIndicator size="small" color={t.text.secondary} />
                ) : (
                  <Text style={[styles.newButtonText, !connected && styles.newButtonTextOff]}>+ 新建</Text>
                )}
              </Pressable>
            </View>
            <Text style={styles.dirSub} maxFontSizeMultiplier={1.3}>
              按工作区分组 · 无框排版 · 长按一行有更多操作
            </Text>
            <FlatList
              data={rows}
              keyExtractor={(row) => (row.kind === 'group' ? 'g:' + row.id : row.item.sessionId)}
              // 草稿/待发标记不在 item 里，得靠 extraData 才会重绘。
              extraData={`${outboxTick}:${draftIds.join(',')}`}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {!connected
                    ? '连接断开，正在重连…'
                    : search
                      ? '没有匹配的会话'
                      : showArchived
                        ? '还没有会话'
                        : '还没有会话'}
                </Text>
              }
              ListFooterComponent={
                archived.length > 0 ? (
                  <Pressable style={styles.archiveToggle} onPress={() => setShowArchived((v) => !v)}>
                    <Text style={styles.archiveToggleText}>
                      {showArchived ? '隐藏已归档' : `已归档 ${archived.length} 个 · 显示`}
                    </Text>
                  </Pressable>
                ) : undefined
              }
              renderItem={({ item: row }) => {
                if (row.kind === 'group') {
                  return (
                    <Pressable
                      style={styles.groupHead}
                      onPress={() =>
                        setCollapsedGroups((current) => ({
                          ...current,
                          [row.id]: !current[row.id],
                        }))
                      }
                    >
                      <Text style={styles.groupCaret}>{row.collapsed ? '▸' : '▾'}</Text>
                      <Text style={styles.groupTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                        {row.title}
                      </Text>
                      <Text style={styles.groupCount}>{row.count}</Text>
                    </Pressable>
                  );
                }
                const item = row.item;
                const waiting = pendingItems(pending, item.sessionId);
                return (
                  <Pressable
                    style={[styles.card, row.indent && styles.cardIndent]}
                    onPress={() => openSession(item)}
                    onLongPress={() => openSessionMenu(item)}
                    delayLongPress={320}
                  >
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTitle} numberOfLines={1}>
                        {item.projections?.values.title ?? '未命名会话'}
                      </Text>
                      {item.running ? <View style={styles.runningDot} /> : null}
                    </View>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {`${ago(item.updatedAt)} · ${item.cwd ?? ''}`}
                    </Text>
                    {waiting.length > 0 ? (
                      <View style={styles.pendingPill}>
                        <View style={styles.pendingDot} />
                        <Text style={styles.pendingText} numberOfLines={1}>
                          {describePending(waiting)}
                        </Text>
                      </View>
                    ) : null}
                    {(() => {
                      const pendingCount = outbox.countFor(item.sessionId);
                      const hasDraft = draftIds.includes(item.sessionId);
                      if (!pendingCount && !hasDraft) return null;
                      return (
                        <View style={styles.tagRow}>
                          {pendingCount > 0 ? (
                            <Text style={styles.tagWarn}>待发送 {pendingCount}</Text>
                          ) : null}
                          {hasDraft ? <Text style={styles.tag}>草稿</Text> : null}
                        </View>
                      );
                    })()}
                  </Pressable>
                );
              }}
            />
            </>
            )}
            <BottomTabBar
              tabs={[
                { key: 'focus', label: '聚焦', badge: pendingCount },
                { key: 'all', label: '全部会话' },
                { key: 'schedules', label: '定时任务' },
                { key: 'plugins', label: '插件' },
              ]}
              active={tab}
              onChange={(key) =>
                setTab(
                  key === 'all' || key === 'schedules' || key === 'plugins' ? key : 'focus',
                )
              }
            />
          </View>
        ) : (
          <View style={styles.pairCard}>
            <Text style={styles.sectionTitle}>配对</Text>
            <Text style={styles.pairHint}>
              在服务器上运行 dsh-pair，扫描它打印的二维码。配对码 5 分钟内有效。
            </Text>
            <Pressable
              style={[styles.primaryButton, busy && styles.buttonDisabled]}
              disabled={busy}
              onPress={() => setScanning(true)}
            >
              {busy ? <ActivityIndicator color={t.bg.canvas} /> : <Text style={styles.primaryText}>扫码配对</Text>}
            </Pressable>

            <Pressable style={styles.linkButton} onPress={() => setManual((current) => !current)}>
              <Text style={styles.linkText}>{manual ? '收起手动输入' : '手动粘贴配对串'}</Text>
            </Pressable>

            {manual ? (
              <View>
                <TextInput
                  style={styles.input}
                  multiline
                  placeholder="粘贴配对内容（Base64URL）"
                  placeholderTextColor={t.text.muted}
                  value={pairingText}
                  onChangeText={setPairingText}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  style={[styles.primaryButton, !pairingText.trim() && styles.buttonDisabled]}
                  disabled={!pairingText.trim() || busy}
                  onPress={handlePair}
                >
                  <Text style={styles.primaryText}>配对并连接</Text>
                </Pressable>
              </View>
            ) : null}

          </View>
        )}
      </KeyboardAvoidingView>

      <ActionSheet
        visible={menuSession !== null}
        title={menuSession?.projections?.values.title ?? '未命名会话'}
        actions={sessionActions}
        onPick={runSessionAction}
        onClose={() => setMenuSession(null)}
      />

      <ActionSheet
        visible={workspaceSheet}
        title="当前工作区"
        subtitle="只影响之后新建的会话，已有的会话不会移动"
        actions={workspaceActions}
        onPick={pickWorkspace}
        onClose={() => setWorkspaceSheet(false)}
      />

      <ActionSheet
        visible={createSheet}
        title="新建会话"
        subtitle="会话跑起来之后目录就固定了，选错了只能重新建"
        actions={createActions}
        onPick={runCreateAction}
        onClose={() => setCreateSheet(false)}
      />

      {hostSheet ? <HostInfoSheet control={control} onClose={() => setHostSheet(false)} /> : null}
      <ActionSheet
        visible={gatewaySheet}
        title="网关"
        subtitle="同一台设备可以记住多台网关，切换时会重新拉取会话列表"
        actions={gatewayActions}
        onPick={(id) => {
          if (id === 'add') {
            setGatewaySheet(false);
            setAddGateway(true);
            return;
          }
          if (id === 'forget') {
            setGatewaySheet(false);
            if (saved) forgetGateway(saved);
            return;
          }
          const target = gateways.find((item) => 'gw:' + item.id === id);
          if (target) void switchGateway(target);
        }}
        onClose={() => setGatewaySheet(false)}
      />

      <Modal
        visible={addGateway}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setAddGateway(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setAddGateway(false)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>添加网关</Text>
            <Text style={styles.modalHint}>在服务器上运行 dsh-pair，扫码或粘贴它输出的配对串。</Text>
            <TextInput
              style={[styles.modalInput, styles.modalInputTall]}
              multiline
              placeholder="粘贴配对内容（Base64URL）"
              placeholderTextColor={t.text.muted}
              value={pairingText}
              onChangeText={setPairingText}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalAction}
                onPress={() => {
                  setAddGateway(false);
                  setScanning(true);
                }}
              >
                <Text style={styles.modalActionText}>扫码</Text>
              </Pressable>
              <Pressable
                style={styles.modalAction}
                disabled={!pairingText.trim() || busy}
                onPress={() => {
                  setAddGateway(false);
                  handlePair();
                }}
              >
                <Text
                  style={[styles.modalPrimaryText, !pairingText.trim() || busy ? styles.modalDisabled : null]}
                >
                  配对并连接
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={renaming !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setRenaming(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setRenaming(null)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>重命名会话</Text>
            <TextInput
              style={styles.modalInput}
              value={renameDraft}
              onChangeText={setRenameDraft}
              placeholder="会话名称"
              placeholderTextColor={t.text.muted}
              autoFocus
              maxLength={80}
              onSubmitEditing={submitRename}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalAction} onPress={() => setRenaming(null)}>
                <Text style={styles.modalActionText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalAction} onPress={submitRename}>
                <Text style={styles.modalPrimaryText}>保存</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <DirectoryPicker
        visible={dirPicker}
        listing={dirListing}
        loading={dirLoading}
        error={dirError}
        onOpen={openDirectory}
        onRetry={() => openDirectory(dirListing?.path)}
        onConfirm={createInDirectory}
        onClose={() => setDirPicker(false)}
      />
    </SafeAreaView>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg.canvas },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    width: '100%',
    backgroundColor: t.bg.canvas,
    borderRadius: 16,
    padding: 18,
    gap: 14,
  },
  modalTitle: { color: t.text.primary, fontSize: 16, fontWeight: '700' },
  modalInput: {
    backgroundColor: t.bg.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: t.text.primary,
    fontSize: 15,
  },
  modalHint: { color: t.text.muted, fontSize: 12, lineHeight: 18, marginTop: -6 },
  modalInputTall: { minHeight: 76, textAlignVertical: 'top' },
  modalDisabled: { opacity: 0.4 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  modalAction: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  modalActionText: { color: t.text.muted, fontSize: 14, fontWeight: '600' },
  modalPrimaryText: { color: t.semantic.diffAddText, fontSize: 14, fontWeight: '700' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerTitleBlock: { flex: 1, paddingRight: 12 },
  title: { color: t.text.primary, fontSize: 28, fontWeight: '700', letterSpacing: 0.5 },
  titleCount: { color: t.text.muted, fontSize: 14, fontWeight: '600' },
  subtitle: { color: t.text.muted, fontSize: 13, marginTop: 2 },
  subtitleChevron: { color: t.text.muted },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.bg.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  dotOn: { backgroundColor: t.semantic.diffAddText },
  dotBusy: { backgroundColor: t.semantic.gateAmberText },
  dotOff: { backgroundColor: t.text.muted },
  statusText: { color: t.text.secondary, fontSize: 12 },
  hint: { color: t.text.muted, fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 },
  error: { color: t.semantic.dangerText, fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  metaLabel: { color: t.text.muted, fontSize: 12 },
  metaValue: { color: t.text.secondary, fontSize: 12, marginRight: 12 },
  metaAction: { flex: 1, textAlign: 'right', color: t.text.muted, fontSize: 11 },
  gatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: t.semantic.gateAmberBg,
  },
  gatePillText: { flex: 1, color: t.semantic.gateAmberText, fontSize: 13, fontWeight: '600' },
  gatePillGo: { color: t.semantic.gateAmberText, fontSize: 12, fontWeight: '700' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: t.bg.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, color: t.text.primary, fontSize: 14, paddingVertical: 9 },
  searchClear: { paddingHorizontal: 6, paddingVertical: 4 },
  searchClearText: { color: t.text.muted, fontSize: 18, lineHeight: 20 },
  tagRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  tag: {
    color: t.text.primary,
    fontSize: 10,
    fontWeight: '600',
    backgroundColor: t.bg.surface,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  tagWarn: {
    color: t.semantic.gateAmberText,
    fontSize: 10,
    fontWeight: '600',
    backgroundColor: t.semantic.gateAmberBg,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  archiveToggle: { alignItems: 'center', paddingVertical: 14 },
  archiveToggleText: { color: t.text.muted, fontSize: 12, fontWeight: '600' },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 20,
  },
  newButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: t.bg.surface,
    minWidth: 62,
    alignItems: 'center',
  },
  newButtonOff: {
    opacity: 0.45,
  },
  newButtonTextOff: {
    color: t.text.muted,
  },
  newButtonText: { color: t.text.secondary, fontSize: 12 },
  sectionTitle: {
    color: t.text.muted,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  // 底部 Tab 栏是兄弟节点，列表自己留出 72 的内边距，最后一行才不会被压住
  listContent: { paddingHorizontal: 20, paddingBottom: 72 },
  // 无框行：不要背景、圆角和阴影，只留一条底部分割线。
  card: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.border.subtle,
  },
  // 缩进 + 左侧导轨线，层级靠这一条竖线表达
  cardIndent: {
    marginLeft: 14,
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: t.border.default,
  },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    gap: 8,
    marginTop: 4,
  },
  dirHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 2,
  },
  dirTitle: { flex: 1, color: t.text.primary, fontSize: 20, fontWeight: '700' },
  dirCount: { color: t.text.muted, fontSize: 11 },
  dirSub: { color: t.text.muted, fontSize: 11, paddingHorizontal: 20, paddingBottom: 6 },
  groupCaret: { color: t.text.muted, fontSize: 11, width: 12 },
  groupTitle: { flex: 1, color: t.text.primary, fontSize: 14, fontWeight: '700' },
  groupCount: { color: t.text.muted, fontSize: 11 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: t.text.primary, fontSize: 15, fontWeight: '600', flex: 1 },
  runningDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.semantic.diffAddText, marginLeft: 8 },
  cardMeta: { color: t.text.muted, fontSize: 12, marginTop: 6 },
  pendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: t.border.default,
  },
  pendingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.semantic.gateAmberText, marginRight: 6 },
  pendingText: { flex: 1, color: t.semantic.gateAmberText, fontSize: 11 },
  empty: { color: t.text.muted, fontSize: 13, paddingVertical: 20 },
  pairCard: { paddingTop: 8 },
  pairHint: { color: t.text.muted, fontSize: 13, paddingHorizontal: 20, paddingBottom: 12 },
  input: {
    marginHorizontal: 20,
    minHeight: 96,
    borderRadius: 14,
    backgroundColor: t.bg.canvas,
    color: t.text.primary,
    padding: 14,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  footerRow: { flexDirection: 'row', gap: 10, paddingTop: 4 },
  footerAction: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: t.bg.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border.subtle,
  },
  footerActionText: { color: t.text.muted, fontSize: 13 },
  linkButton: { alignItems: 'center', paddingVertical: 12 },
  linkText: { color: t.text.muted, fontSize: 13 },
  primaryButton: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: t.action.primaryBg,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.35 },
  primaryText: { color: t.bg.canvas, fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    marginHorizontal: 20,
    marginTop: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryText: { color: t.text.muted, fontSize: 13 },
});
