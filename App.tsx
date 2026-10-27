import { randomUUID } from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import type { HelloFrame, ServerFrame, SessionItem } from './src/protocol/types';
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
import { outbox } from './src/transport/outbox';
import { ActionSheet, type SheetAction } from './src/ui/ActionSheet';
import { ScanScreen } from './src/ui/ScanScreen';
import { SessionScreen } from './src/ui/SessionScreen';

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
  const [archived, setArchived] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [pending, setPending] = useState<PendingMap>({});
  /** 正在重命名的会话；非 null 时弹输入框。 */
  const [renaming, setRenaming] = useState<SessionItem | null>(null);
  const [menuSession, setMenuSession] = useState<SessionItem | null>(null);
  /** 默认不显示归档会话，避免列表越来越长 */
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [renameDraft, setRenameDraft] = useState('');
  /** 每个会话的待发送队列；agent 还在跑的时候新消息会排在这里。 */
  const [queues, setQueues] = useState<Record<string, QueuedMessage[]>>({});
  const deviceIdRef = useRef<string | null>(null);
  /** 待落盘的网关：配对握手成功、拿到 token 之后才写 SecureStore。 */
  const pendingGateway = useRef<SavedGateway | null>(null);
  const savedRef = useRef<SavedGateway | null>(null);
  /** 防止重复扫码/重复点击把同一个配对码连两次。 */
  const pairingRef = useRef(false);

  const connected = state === 'ready' && hello?.authenticated === true;

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

  // control 通道只关心审批/提问；hello 表示重连成功，先清空再让服务端回放，
  // 否则断线期间处理掉的待办会一直挂在列表上。
  useEffect(() => {
    const off = control.onFrame((frame) => {
      if (frame.kind === 'hello') {
        setPending({});
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
          if (helloFrame.authenticated) client.send({ type: 'sessions' });
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
          const failure = frame as { code?: string; message?: string };
          setCreating(false);
          setError(`${failure.code ?? 'error'}：${failure.message ?? ''}`);
          break;
        }
        default:
          break;
      }
    },
    [client, startControl],
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
  }, []);

  // 冷启动：有保存的 token 就直接重连，不再让用户手动点一次。
  useEffect(() => {
    let cancelled = false;
    void loadGateways().then((items) => {
      if (!cancelled) setGateways(items);
    });
    loadActiveGateway()
      .then((gateway) => {
        if (cancelled || !gateway) return;
        savedRef.current = gateway;
        setSaved(gateway);
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
    client.send({ type: 'session-create', requestId: randomUUID() } as never);
  }, [client, connected]);

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
      <StatusBar style="light" />
      {/* Android 走 edge-to-edge 时窗口不会自己缩，必须让 KAV 补键盘高度。
          这一层包住整屏，frame 底边正好是屏幕底边，算出来的重叠量最准。 */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
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

        {detail && !connected ? <Text style={styles.hint}>{detail}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {connected && active ? (
          <SessionScreen
            client={client}
            session={active}
            queued={queues[active.sessionId] ?? []}
            capabilities={hello?.capabilities ?? []}
            onBack={() => {
              setActive(null);
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
        ) : connected ? (
          <View style={styles.flex}>
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
                  placeholderTextColor="#5B6070"
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
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>会话 · {visibleSessions.length}</Text>
              <Pressable style={styles.newButton} onPress={handleCreate} disabled={creating}>
                {creating ? (
                  <ActivityIndicator size="small" color="#C9CDD6" />
                ) : (
                  <Text style={styles.newButtonText}>+ 新建</Text>
                )}
              </Pressable>
            </View>
            <FlatList
              data={visibleSessions}
              keyExtractor={(item) => item.sessionId}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {search ? '没有匹配的会话' : showArchived ? '还没有会话' : '还没有会话'}
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
              renderItem={({ item }) => {
                const waiting = pendingItems(pending, item.sessionId);
                return (
                  <Pressable
                    style={styles.card}
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
                      {item.cwd ?? ''}
                    </Text>
                    {waiting.length > 0 ? (
                      <View style={styles.pendingPill}>
                        <View style={styles.pendingDot} />
                        <Text style={styles.pendingText} numberOfLines={1}>
                          {describePending(waiting)}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              }}
            />
            <View style={styles.footerRow}>
              <Pressable style={styles.footerAction} onPress={() => setScanning(true)}>
                <Text style={styles.footerActionText}>扫码配对</Text>
              </Pressable>
              <Pressable style={styles.footerAction} onPress={handleForget}>
                <Text style={styles.footerActionText}>断开并清除</Text>
              </Pressable>
            </View>
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
              {busy ? <ActivityIndicator color="#0B0C0F" /> : <Text style={styles.primaryText}>扫码配对</Text>}
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
                  placeholderTextColor="#5B6070"
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

            {saved?.token ? (
              <Pressable style={styles.secondaryButton} onPress={handleReconnect}>
                <Text style={styles.secondaryText}>重新连接 {saved.label ?? saved.url}</Text>
              </Pressable>
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
              placeholderTextColor="#5B6070"
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
              placeholderTextColor="#5B6070"
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0C0F' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#14161B',
    borderRadius: 16,
    padding: 18,
    gap: 14,
  },
  modalTitle: { color: '#F5F6F8', fontSize: 16, fontWeight: '700' },
  modalInput: {
    backgroundColor: '#1B1E25',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#EDEFF3',
    fontSize: 15,
  },
  modalHint: { color: '#7A8091', fontSize: 12, lineHeight: 18, marginTop: -6 },
  modalInputTall: { minHeight: 76, textAlignVertical: 'top' },
  modalDisabled: { opacity: 0.4 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  modalAction: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  modalActionText: { color: '#8A90A0', fontSize: 14, fontWeight: '600' },
  modalPrimaryText: { color: '#3DDC97', fontSize: 14, fontWeight: '700' },
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
  title: { color: '#F5F6F8', fontSize: 28, fontWeight: '700', letterSpacing: 0.5 },
  titleCount: { color: '#4C5261', fontSize: 14, fontWeight: '600' },
  subtitle: { color: '#7A8091', fontSize: 13, marginTop: 2 },
  subtitleChevron: { color: '#4C5261' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#15171C',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  dotOn: { backgroundColor: '#3DDC97' },
  dotBusy: { backgroundColor: '#F5B84C' },
  dotOff: { backgroundColor: '#5B6070' },
  statusText: { color: '#C9CDD6', fontSize: 12 },
  hint: { color: '#8A90A0', fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 },
  error: { color: '#FF7A7A', fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  metaLabel: { color: '#5B6070', fontSize: 12 },
  metaValue: { color: '#C9CDD6', fontSize: 12, marginRight: 12 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: '#15171C',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, color: '#EDEFF3', fontSize: 14, paddingVertical: 9 },
  searchClear: { paddingHorizontal: 6, paddingVertical: 4 },
  searchClearText: { color: '#6E7585', fontSize: 18, lineHeight: 20 },
  archiveToggle: { alignItems: 'center', paddingVertical: 14 },
  archiveToggleText: { color: '#6E7585', fontSize: 12, fontWeight: '600' },
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
    backgroundColor: '#1B1E25',
    minWidth: 62,
    alignItems: 'center',
  },
  newButtonText: { color: '#C9CDD6', fontSize: 12 },
  sectionTitle: {
    color: '#7A8091',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  listContent: { paddingHorizontal: 20, paddingBottom: 12 },
  card: {
    backgroundColor: '#14161B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: '#EDEFF3', fontSize: 15, fontWeight: '600', flex: 1 },
  runningDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3DDC97', marginLeft: 8 },
  cardMeta: { color: '#5B6070', fontSize: 12, marginTop: 6 },
  pendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#3A2A12',
  },
  pendingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F5B84C', marginRight: 6 },
  pendingText: { flex: 1, color: '#F5B84C', fontSize: 11 },
  empty: { color: '#5B6070', fontSize: 13, paddingVertical: 20 },
  pairCard: { paddingTop: 8 },
  pairHint: { color: '#8A90A0', fontSize: 13, paddingHorizontal: 20, paddingBottom: 12 },
  input: {
    marginHorizontal: 20,
    minHeight: 96,
    borderRadius: 14,
    backgroundColor: '#14161B',
    color: '#EDEFF3',
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
    backgroundColor: '#14161B',
  },
  footerActionText: { color: '#7A8091', fontSize: 13 },
  linkButton: { alignItems: 'center', paddingVertical: 12 },
  linkText: { color: '#7A8091', fontSize: 13 },
  primaryButton: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: '#F5F6F8',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.35 },
  primaryText: { color: '#0B0C0F', fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    marginHorizontal: 20,
    marginTop: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryText: { color: '#8A90A0', fontSize: 13 },
});
