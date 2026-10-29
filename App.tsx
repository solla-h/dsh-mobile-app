import { randomUUID } from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
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
  maxRecordSeconds,
  transcriptText,
  type SpeechCatalog,
} from './src/protocol/speech';
import { soleApproval } from './src/protocol/pending';
import { matchDecision } from './src/protocol/voice-decision';
import { useVoiceCapture } from './src/ui/voice/useVoiceCapture';
import { BottomTabBar } from './src/ui/home/BottomTabBar';
import { CapabilitiesView } from './src/ui/home/CapabilitiesView';
import { SchedulesView, mapSchedules } from './src/ui/home/SchedulesView';
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
import { mapDirectories, type DirectoryListing } from './src/protocol/directories';
import { ActionSheet, type SheetAction } from './src/ui/ActionSheet';
import { DirectoryPicker } from './src/ui/DirectoryPicker';
import { ScanScreen } from './src/ui/ScanScreen';
import { SessionScreen } from './src/ui/SessionScreen';
import { useTheme, useThemedStyles } from './src/ui/theme';
import type { Palette } from './src/theme/tokens';

/** 会话列表按网关分开缓存，切换网关时不会串味。 */
const sessionsCacheKey = (gatewayId: string) => `sessions-${gatewayId}`;

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
      <AppBody />
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
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const voice = useVoiceCapture();
  /** 正在等哪条转写结果，以及结果要发给谁；迟到的结果按 requestId 丢掉 */
  const voiceJobRef = useRef<{
    requestId: string;
    target: { kind: 'new' } | { kind: 'session'; sessionId: string };
  } | null>(null);
  /** handleFrame 里要读最新的待办，但不想因为待办变化重建回调 */
  const pendingRef = useRef<PendingMap>({});
  /** 刚用语音发了一条「新会话」消息，等 sent 回来就跳进去 */
  const voiceCreatePendingRef = useRef(false);
  /** 已知会话 id：收到未知会话的状态推送时要补一次列表 */
  const knownSessionsRef = useRef<Set<string>>(new Set());
  const voiceReady = hasReadyProvider(speechCatalog);
  /** 工作区快照：分组、置顶、归档都在这条帧里。null 表示还没拿到。 */
  const [workspaceFrame, setWorkspaceFrame] = useState<WorkspacesFrame | null>(null);
  /** 首页当前 Tab。只在首页四个页之间切，会话页不挂 Tab。 */
  const [tab, setTab] = useState<'focus' | 'all' | 'schedules' | 'plugins'>('focus');
  /** 定时任务目录；null 表示还没拿到（不是「没有任务」） */
  const [schedules, setSchedules] = useState<unknown[] | null>(null);
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
    }).map((entry) => ({ ...entry, cwd: byId.get(entry.sessionId)?.cwd ?? '' }));
  }, [archived, outlines, pending, sessions]);

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

  useEffect(() => {
    knownSessionsRef.current = new Set(sessions.map((item) => item.sessionId));
  }, [sessions]);

  // control 通道只关心审批/提问；hello 表示重连成功，先清空再让服务端回放，
  // 否则断线期间处理掉的待办会一直挂在列表上。
  useEffect(() => {
    const off = control.onFrame((frame) => {
      if (frame.kind === 'hello') {
        setPending({});
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
      setPending((current) => applyPendingFrame(current, frame) ?? current);
    });
    return off;
  }, [control]);

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
        case 'projection-baseline':
        case 'turn-outline-updated': {
          setOutlines((current) => applyOutlineFrame(current, frame) ?? current);
          break;
        }
        case 'speech-catalog':
        case 'speech-state': {
          const catalog = mapSpeechCatalog(frame);
          if (catalog) setSpeechCatalog(catalog);
          break;
        }
        case 'speech-transcript': {
          const job = voiceJobRef.current;
          const received = frame as unknown as { requestId?: string };
          // 只认当前这条请求；切页/重录之后的迟到结果一律丢。
          if (!job || job.requestId !== received.requestId) break;
          voiceJobRef.current = null;
          setTranscribing(false);
          const text = transcriptText(frame) ?? '';
          if (!text) {
            Alert.alert('没听清', '再说一次试试');
            break;
          }
          if (job.target.kind === 'session') {
            const approval = soleApproval(pendingRef.current, job.target.sessionId);
            if (approval) {
              const decision = matchDecision(text);
              if (!decision) {
                Alert.alert('没听清', `听到的是「${text}」，没有匹配到同意或拒绝`);
                break;
              }
              if (!approval.approvalId) {
                Alert.alert('无法语音审批', '这条审批没有带 approvalId，请进会话处理');
                break;
              }
              client.send({
                type: 'approval-response',
                rpcId: approval.rpcId,
                sessionId: job.target.sessionId,
                approvalId: approval.approvalId,
                outcome: decision === 'approve' ? 'allowed-once' : 'rejected',
              });
              break;
            }
            client.send({ type: 'message', sessionId: job.target.sessionId, text });
            break;
          }
          // 新会话：一条 message 就够，网关会先建会话再发。
          voiceCreatePendingRef.current = true;
          client.send({
            type: 'message',
            text,
            ...(currentWorkspaceId ? { workspaceId: currentWorkspaceId } : {}),
          });
          break;
        }
        case 'sent': {
          // 语音新建的会话：网关会先建再发，sent 里带着新 sessionId。
          // 不跳过去的话，用户说完话看不到任何反应。
          if (!voiceCreatePendingRef.current) break;
          voiceCreatePendingRef.current = false;
          const sent = frame as unknown as { sessionId?: string };
          if (sent.sessionId) {
            setActive({ sessionId: sent.sessionId, updatedAt: Date.now(), running: false, blank: false });
            client.send({ type: 'sessions' });
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
          const created = frame as { sessionId: string };
          setCreating(false);
          setActive({
            sessionId: created.sessionId,
            updatedAt: Date.now(),
            running: false,
            blank: true,
          });
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
          const failure = frame as { code?: string; message?: string; requestType?: string };
          setCreating(false);
          const text = `${failure.code ?? 'error'}：${failure.message ?? ''}`;
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
    [applyTitle, client, currentWorkspaceId, startControl],
  );

  useEffect(() => {
    const offState = client.onState((next, message) => {
      setState(next);
      setDetail(message ?? null);
      if (next === 'ready') {
        setError(null);
        // 断线期间写下的消息在重连后补发，顺序按写入先后。
        outbox.flush((frame) => client.send(frame));
      }
    });
    const offFrame = client.onFrame(handleFrame);
    return () => {
      offState();
      offFrame();
    };
  }, [client, handleFrame]);

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
    // 选中工作区就开在里面；没选就让宿主用默认目录，不去猜。
    client.send({
      type: 'session-create',
      requestId: randomUUID(),
      ...(currentWorkspaceId ? { workspaceId: currentWorkspaceId } : {}),
    });
  }, [client, connected, currentWorkspaceId]);

  /** 按住开始录音；target 决定转写结果发给谁。 */
  const beginVoice = useCallback(
    async (target: { kind: 'new' } | { kind: 'session'; sessionId: string }) => {
      if (!voiceReady) {
        Alert.alert('语音还没就绪', '服务器语音模型还在准备，稍后再试。');
        return;
      }
      if (recording || transcribing) return;
      try {
        await voice.start();
        voiceJobRef.current = target === null ? null : { requestId: '', target };
        setRecording(true);
      } catch (failure) {
        Alert.alert('录音失败', failure instanceof Error ? failure.message : '无法开始录音');
      }
    },
    [recording, transcribing, voice, voiceReady],
  );

  /** 松手：结束录音并发起转写。 */
  const finishVoice = useCallback(async () => {
    if (!recording) return;
    const job = voiceJobRef.current;
    setRecording(false);
    voiceJobRef.current = null;
    if (!job) {
      voice.cancel();
      return;
    }
    try {
      const clip = await voice.stop();
      if (!clip) return;
      // 太短的多半是误触，别浪费一次往返。
      if (clip.duration < 0.4) return;
      const requestId = randomUUID();
      voiceJobRef.current = { requestId, target: job.target };
      setTranscribing(true);
      client.send({
        type: 'speech-transcribe',
        requestId,
        providerId: speechCatalog?.providerId,
        language: speechCatalog?.language,
        audioBase64: clip.base64,
      });
    } catch (failure) {
      setTranscribing(false);
      Alert.alert('录音失败', failure instanceof Error ? failure.message : '无法读取录音');
    }
  }, [client, recording, speechCatalog, voice]);

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
    client.send({ type: 'session-create', requestId: randomUUID(), cwd });
  }, [client, connected, dirListing]);

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

  // 从后台回来时 socket 往往已经被系统掐掉了：立刻重连，别等心跳超时。
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || state === 'ready') return;
      const gateway = savedRef.current;
      if (gateway?.token) connectWith(gateway);
    });
    return () => sub.remove();
  }, [connectWith, state]);

  /** 切到另一台网关：上一个网关的会话/队列都不属于新网关，先清干净再连。 */
  const switchGateway = useCallback(
    async (gateway: SavedGateway) => {
      setGatewaySheet(false);
      if (gateway.id === savedRef.current?.id && connected) return;
      client.disconnect();
      control.disconnect();
      setSessions([]);
      setQueues({});
      setActive(null);
      setPending({});
      setHello(null);
      setError(null);
      setArchived([]);
      savedRef.current = gateway;
      setSaved(gateway);
      await activateGateway(gateway.id).catch(() => undefined);
      await connectWith(gateway);
    },
    [client, connected, connectWith, control],
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
              if (gateway.id !== savedRef.current?.id) return;
              // 删掉的正好是当前网关：断开并退回到列表/扫码页。
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
                await activateGateway(next.id).catch(() => undefined);
                await connectWith(next);
              }
            })();
          },
        },
      ]);
    },
    [client, connectWith, control],
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
              setPending({});
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
          <Pressable onPress={saved ? handleReconnect : undefined} hitSlop={6}>
            <Text style={styles.hint}>
              {detail}
              {saved ? ' · 点这里重连' : ''}
            </Text>
          </Pressable>
        ) : null}
        {error ? (
          <Pressable onPress={() => setError(null)} hitSlop={6}>
            <Text style={styles.error}>{error} · 点击关闭</Text>
          </Pressable>
        ) : null}

        {/* 会话页只要选中了就别卸载：断线时保留历史和草稿，只让顶部提示 + 输入框变灰。
            卸载会让本地状态（附件、草稿、滚动位置）全丢，还会掉回「配对」页。 */}
        {active ? (
          <SessionScreen
            client={client}
            session={active}
            queued={queues[active.sessionId] ?? []}
            capabilities={hello?.capabilities ?? []}
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
            onBack={() => {
              setActive(null);
              client.send({ type: 'sessions' });
            }}
            onOpenSession={(sessionId) => {
              setActive({ sessionId, updatedAt: Date.now(), running: false, blank: false });
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
                  onPress={() => setActive(blocked[0])}
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
                workspaceLabel={workspaceLabel}
                onPickWorkspace={() => setWorkspaceSheet(true)}
                onOpen={(sessionId) => {
                  const target = sessions.find((item) => item.sessionId === sessionId);
                  if (target) setActive(target);
                }}
                onCreate={handleCreate}
                onHoldOrb={() => void beginVoice({ kind: 'new' })}
                onHoldCard={(sessionId) => void beginVoice({ kind: 'session', sessionId })}
                onRelease={() => void finishVoice()}
                onCancelVoice={() => {
                  voice.cancel();
                  voiceJobRef.current = null;
                  setRecording(false);
                }}
                recording={recording}
                transcribing={transcribing}
              />
            ) : tab === 'schedules' ? (
              <SchedulesView rows={mapSchedules(schedules)} catalogReady={schedules !== null} />
            ) : tab === 'plugins' ? (
              <CapabilitiesView
                capabilities={hello?.capabilities ?? []}
                gatewayName={hello?.gatewayName}
                protocol={hello?.protocol}
                deviceName={hello?.device?.name}
                speechReady={voiceReady}
              />
            ) : (
            <>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>设备</Text>
              <Text style={styles.metaValue}>{hello?.device?.name ?? '未知'}</Text>
              <Text style={styles.metaLabel}>协议</Text>
              <Text style={styles.metaValue}>v{hello?.protocol ?? '?'}</Text>
            </View>
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
                    onPress={() => setActive(item)}
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
