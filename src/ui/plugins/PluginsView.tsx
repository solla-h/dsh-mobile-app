import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { Palette } from '../../theme/tokens';
import { TYPE } from '../../theme/tokens';
import { tapFeedback } from '../haptics';
import { useThemedStyles } from '../theme';
import {
  entriesOfBundle,
  groupBundles,
  OFFICIAL_ITEM_LABELS,
  standaloneEntries,
  type OfficialItem,
  type PluginBundle,
  type PluginEntry,
} from '../../protocol/plugins';
import type { GatewayClient } from '../../transport/gateway-client';
import { InstallFlow } from './InstallFlow';
import { ExemptionsSheet } from './ExemptionsSheet';
import { SettingsEditor } from './SettingsEditor';
import { PluginCard, type CardItem } from './PluginCard';
import { usePluginManager } from './usePluginManager';

/**
 * 「插件」页：与 DSH Web 插件页对齐的管理界面。
 *
 * 三分组（已安装 / 官方可选 / 内置配置卡）+ 添加插件安装流 + 配置编辑 + 版本豁免。
 * 数据全部来自 control 连接的 plugin-management-v1；页面可用性以
 * plugin-catalog.managementAvailable 为准，false 时整体只读。
 */

interface Props {
  control: GatewayClient;
  gatewayName?: string;
  protocol?: number;
  deviceName?: string;
  capabilities: string[];
  speechReady: boolean;
}

const CAPABILITY_LABELS: Record<string, string> = {
  'split-channels': '双通道（control / conversation）',
  'assistant-stream-v1': '助手流式输出',
  'history-format-version': '历史格式版本号',
  'projection-baseline': '投影基线（任务/目标/大纲）',
  'turn-outline-v1': '轮次大纲',
  images: '图片收发',
  'session-create': '新建会话',
  'session-agent-preset': '会话模式切换',
  'agent-team-v1': '智能体团队',
  'subagent-conversations-v1': '子会话',
  commands: '命令与技能目录',
  tasks: '任务列表',
  goals: '目标',
  'schedule-management': '定时任务管理',
  'plugin-management-v1': '插件管理',
  'speech-input-v1': '语音输入',
  'file-upload-v1': '文件上传',
  'session-cancel': '停止当前回合',
  'queue-control': '队列控制',
  'session-archive': '会话归档',
  'session-rename': '会话改名',
  'file-downloads': '文件下载',
  'file-references-v1': '文件引用解析',
};

export function PluginsView({ control, gatewayName, protocol, deviceName, capabilities, speechReady }: Props) {
  const styles = useThemedStyles(makeStyles);
  // onState 不回放当前状态，control 可能早已 ready，所以初值直接读一次。
  const [ctrlReady, setCtrlReady] = useState(() => control.state === 'ready');
  const manager = usePluginManager(control, ctrlReady);

  /** 详情大卡片：null 关闭；数字=轮播索引。 */
  const [cardIndex, setCardIndex] = useState<number | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [exemptionsOpen, setExemptionsOpen] = useState(false);
  const [editNamespace, setEditNamespace] = useState<string | null>(null);
  const [capExpanded, setCapExpanded] = useState(false);
  /** Host 的 listPlugins 可能返回上百个条目（含内置包内的服务），默认折叠。 */
  const [extrasExpanded, setExtrasExpanded] = useState(false);

  useEffect(() => {
    const off = control.onState((state) => setCtrlReady(state === 'ready'));
    return off;
  }, [control]);

  const catalog = manager.catalog;
  const groups = useMemo(() => (catalog ? groupBundles(catalog.bundles) : null), [catalog]);
  const extras = useMemo(
    () => (catalog ? standaloneEntries(catalog.plugins, catalog.bundles) : []),
    [catalog],
  );
  /** 详情轮播的数据源：内置配置卡在最前，其后顺序与列表一致，行点击按下标打开。 */
  const cardItems = useMemo<CardItem[]>(() => {
    if (!catalog || !groups) return [];
    const officialCards: CardItem[] = catalog.officialItems.map((item) => ({
      kind: 'official',
      item,
    }));
    const bundleCards: CardItem[] = [...groups.installed, ...groups.official].map((bundle) => ({
      kind: 'bundle',
      bundle,
      entries: entriesOfBundle(catalog.plugins, bundle.name),
    }));
    const entryCards: CardItem[] = extras.map((entry) => ({ kind: 'entry', entry }));
    return [...officialCards, ...bundleCards, ...entryCards];
  }, [catalog, groups, extras]);
  const writable = (catalog?.managementAvailable ?? false) && (catalog?.settingsWritable ?? false);

  const onToggleBundle = useCallback(
    (bundle: PluginBundle, enabled: boolean) => {
      tapFeedback();
      void manager
        .toggleBundle(bundle.name, enabled)
        .then((result) => {
          // 不凭发送成功改 UI：等回执结论 + plugins-changed 推送刷新。
          if (result.application === 'restart-required' || result.application === 'failed') {
            manager.refresh();
          }
        })
        .catch(() => {
          // 回执失败（或超时）不猜结果：重查目录让服务端状态说话。
          void manager.refresh();
        });
    },
    [manager],
  );

  const installRunning =
    manager.installProgress !== null && manager.installProgress.finishedAt === undefined;

  const renderBundleRow = (bundle: PluginBundle, official: boolean) => {
    const switchable = writable && !bundle.readOnlyReason;
    const entryCount = catalog ? entriesOfBundle(catalog.plugins, bundle.name).length : 0;
    return (
      <View key={bundle.name} style={styles.rowCard}>
        <Pressable
          style={styles.rowMain}
          onPress={() => {
            const at = cardItems.findIndex(
              (c) => c.kind === 'bundle' && c.bundle.name === bundle.name,
            );
            if (at >= 0) setCardIndex(at);
          }}
        >
          {bundle.icon ? <Image source={{ uri: bundle.icon }} style={styles.rowIcon} /> : (
            <View style={[styles.rowIcon, styles.rowIconPlaceholder]}>
              <Text style={styles.rowIconText}>{bundle.title?.[0] ?? bundle.name[0]}</Text>
            </View>
          )}
          <View style={styles.rowBody}>
            <View style={styles.rowTitleLine}>
              <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {bundle.title ?? bundle.name}
              </Text>
              {bundle.experimental ? <Text style={styles.tagExperimental}>实验</Text> : null}
              {official ? <Text style={styles.tagOfficial}>官方</Text> : null}
              {!bundle.installed ? <Text style={styles.tagNotInstalled}>未安装</Text> : null}
            </View>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {bundle.version ?? ''}
              {bundle.version && entryCount > 0 ? ' · ' : ''}
              {entryCount > 0 ? entryCount + ' 个条目' : ''}
              {bundle.description && !bundle.version ? bundle.description : ''}
            </Text>
            {bundle.error ? (
              <Text style={styles.rowError} numberOfLines={2}>
                诊断：{bundle.error}
              </Text>
            ) : null}
            {bundle.readOnlyReason ? (
              <Text style={styles.rowMeta} numberOfLines={1}>
                只读：{bundle.readOnlyReason}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {bundle.installed ? (
          <Switch
            value={bundle.enabled}
            disabled={!switchable}
            onValueChange={(value) => onToggleBundle(bundle, value)}
            trackColor={{ false: styles.switchOff.backgroundColor, true: styles.switchOn.backgroundColor }}
            thumbColor={styles.switchThumb.backgroundColor}
            ios_backgroundColor={styles.switchOff.backgroundColor}
          />
        ) : (
          <Pressable
            style={styles.installPill}
            onPress={() => setInstallOpen(true)}
            hitSlop={6}
          >
            <Text style={styles.installPillText}>安装</Text>
          </Pressable>
        )}
      </View>
    );
  };

  const officialLabel = (item: OfficialItem) => OFFICIAL_ITEM_LABELS[item.id] ?? item.id;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={manager.loading} onRefresh={() => void manager.refresh()} />
      }
    >
      <Text style={styles.title} maxFontSizeMultiplier={1.3}>
        插件管理
      </Text>
      <Text style={styles.subtitle} maxFontSizeMultiplier={1.3}>
        {gatewayName ?? '网关'} · 协议 v{protocol ?? '?'} · {deviceName ?? '未知设备'}
      </Text>

      {manager.error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{manager.error}</Text>
          <Pressable hitSlop={8} onPress={() => void manager.refresh()}>
            <Text style={styles.errorAction}>重试</Text>
          </Pressable>
        </View>
      ) : null}

      {catalog && !catalog.managementAvailable ? (
        <View style={styles.readonlyCard}>
          <Text style={styles.readonlyText}>
            当前 DSH profile 不支持插件管理（managementAvailable=false），只能查看。
          </Text>
        </View>
      ) : null}

      {!catalog && !manager.error && manager.loading ? (
        <Text style={styles.loadingHint}>正在读取插件目录…</Text>
      ) : null}

      {installRunning && manager.installProgress ? (
        <Pressable style={styles.installBanner} onPress={() => setInstallOpen(true)}>
          <View style={styles.installDot} />
          <Text style={styles.installBannerText} numberOfLines={1}>
            正在安装（{manager.installProgress.phase}）· 点开查看进度
          </Text>
        </Pressable>
      ) : null}

      {/* 内置配置卡片 */}
      {catalog && catalog.officialItems.length > 0 ? (
        <>
          <SectionHeader title="内置配置" />
          <View style={styles.cardStack}>
            {catalog.officialItems.map((item) => (
              <Pressable
                key={item.id}
                style={styles.rowCard}
                onPress={() => {
                  const at = cardItems.findIndex(
                    (c) => c.kind === 'official' && c.item.id === item.id,
                  );
                  if (at >= 0) setCardIndex(at);
                }}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} maxFontSizeMultiplier={1.3}>
                    {officialLabel(item)}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {item.namespaces.join(' · ')}
                  </Text>
                </View>
                <Text style={styles.rowChevron}>{writable ? '配置' : ''}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {/* 已安装 */}
      {groups && groups.installed.length > 0 ? (
        <>
          <SectionHeader title={'已安装 · ' + groups.installed.length} />
          <View style={styles.cardStack}>{groups.installed.map((b) => renderBundleRow(b, false))}</View>
        </>
      ) : null}

      {/* 官方可选 */}
      {groups && groups.official.length > 0 ? (
        <>
          <SectionHeader title={'官方 · ' + groups.official.length} />
          <View style={styles.cardStack}>{groups.official.map((b) => renderBundleRow(b, true))}</View>
        </>
      ) : null}

      {/* 独立插件条目（不挂在已知 bundle 下）：数量可能上百，默认折叠 */}
      {extras.length > 0 ? (
        <>
          <Pressable style={styles.sectionRowPressable} onPress={() => setExtrasExpanded((v) => !v)}>
            <SectionHeader title={'独立条目 · ' + extras.length} />
            <Text style={styles.rowChevron}>{extrasExpanded ? '收起' : '展开'}</Text>
          </Pressable>
          {extrasExpanded ? (
          <View style={styles.cardStack}>
            {extras.map((entry: PluginEntry) => (
              <Pressable
                key={entry.entryId}
                style={styles.rowCard}
                onPress={() => {
                  const at = cardItems.findIndex(
                    (c) => c.kind === 'entry' && c.entry.entryId === entry.entryId,
                  );
                  if (at >= 0) setCardIndex(at);
                }}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                    {entry.title ?? entry.entryId}
                  </Text>
                  {entry.description ? (
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {entry.description}
                    </Text>
                  ) : null}
                </View>
                <Switch
                  value={entry.enabled === true}
                  disabled={!writable}
                  onValueChange={(value) => {
                    tapFeedback();
                    void manager
                      .toggleEntry(entry.entryId, value)
                      .catch(() => manager.refresh());
                  }}
                  trackColor={{ false: styles.switchOff.backgroundColor, true: styles.switchOn.backgroundColor }}
                  thumbColor={styles.switchThumb.backgroundColor}
                  ios_backgroundColor={styles.switchOff.backgroundColor}
                />
              </Pressable>
            ))}
          </View>
          ) : null}
        </>
      ) : null}

      {/* 操作入口 */}
      {writable ? (
        <View style={styles.actionsRow}>
          <Pressable style={styles.actionButton} onPress={() => setInstallOpen(true)}>
            <Text style={styles.actionButtonText}>添加插件</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={() => setExemptionsOpen(true)}>
            <Text style={styles.actionButtonText}>版本豁免</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 网关能力位：诊断信息，默认折叠 */}
      <Pressable style={styles.capToggle} onPress={() => setCapExpanded((v) => !v)}>
        <Text style={styles.capToggleText}>
          {capExpanded ? '收起网关能力位' : '网关能力位 · ' + (capabilities.length - 1)}
        </Text>
      </Pressable>
      {capExpanded
        ? capabilities
            .filter((id) => id !== 'speech-input-v1')
            .map((id) => (
              <View key={id} style={styles.capRow}>
                <View style={styles.capDot} />
                <Text style={styles.capText} numberOfLines={1}>
                  {CAPABILITY_LABELS[id] ?? id}
                </Text>
              </View>
            ))
        : null}
      <View style={styles.capRow}>
        <View style={[styles.capDot, speechReady ? styles.capDotOn : styles.capDotOff]} />
        <Text style={styles.capText}>语音输入（本地 SenseVoice）· {speechReady ? '就绪' : '未就绪'}</Text>
      </View>

      <Text style={styles.footnote} maxFontSizeMultiplier={1.3}>
        管理的是网关所连 DSH profile 的插件，不是手机本地。开关与卸载会实时影响桌面端；
        关闭 dsh-plugin-mobile-gateway 自身会断开手机连接，只能从 DSH Web 重新开启。
      </Text>

      {cardIndex !== null && cardItems.length > 0 ? (
        <PluginCard
          items={cardItems}
          index={cardIndex}
          writable={writable}
          manager={manager}
          onIndexChange={setCardIndex}
          onClose={() => setCardIndex(null)}
          onEditNamespace={(ns) => {
            setCardIndex(null);
            if (ns) setEditNamespace(ns);
          }}
        />
      ) : null}

      {installOpen ? (
        <InstallFlow manager={manager} writable={writable} onClose={() => setInstallOpen(false)} />
      ) : null}

      {exemptionsOpen ? (
        <ExemptionsSheet manager={manager} onClose={() => setExemptionsOpen(false)} />
      ) : null}

      {editNamespace ? (
        <SettingsEditor
          manager={manager}
          ns={editNamespace}
          onClose={() => setEditNamespace(null)}
        />
      ) : null}
    </ScrollView>
  );
}

function SectionHeader({ title }: { title: string }) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    scroll: { flex: 1 },
    content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32 },
    title: { color: t.text.primary, fontSize: 20, fontWeight: '700' },
    subtitle: { color: t.text.muted, fontSize: 12, marginTop: 4, marginBottom: 14 },
    loadingHint: { color: t.text.muted, fontSize: 12.5, marginTop: 8 },
    sectionTitle: {
      color: t.text.secondary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.4,
      marginTop: 16,
      marginBottom: 6,
    },
    errorCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: t.semantic.dangerBg,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
    },
    errorText: { flex: 1, color: t.semantic.dangerText, fontSize: 12, lineHeight: 17 },
    errorAction: { color: t.semantic.dangerText, fontSize: 12, fontWeight: '700' },
    readonlyCard: {
      backgroundColor: t.bg.subtle,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
    },
    readonlyText: { color: t.text.secondary, fontSize: 12, lineHeight: 17 },
    installBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.bg.elevatedAnswer,
      borderColor: t.border.default,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
    },
    installDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.semantic.live,
    },
    installBannerText: { flex: 1, color: t.text.primary, fontSize: 12 },
    cardStack: { gap: 8 },
    sectionRowPressable: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 16,
      marginBottom: 6,
    },
    rowCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: t.bg.surface,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.subtle,
    },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowIcon: { width: 34, height: 34, borderRadius: 9 },
    rowIconPlaceholder: {
      backgroundColor: t.bg.subtle,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
    },
    rowIconText: { color: t.text.secondary, fontSize: 14, fontWeight: '700' },
    rowBody: { flex: 1, minWidth: 0 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowTitle: { color: t.text.primary, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
    tagExperimental: {
      color: t.semantic.gateAmberText,
      backgroundColor: t.semantic.gateAmberBg,
      fontSize: 9.5,
      fontWeight: '700',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 5,
      overflow: 'hidden',
    },
    tagOfficial: {
      color: t.semantic.diffAddText,
      backgroundColor: t.semantic.diffAddBg,
      fontSize: 9.5,
      fontWeight: '700',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 5,
      overflow: 'hidden',
    },
    tagNotInstalled: {
      color: t.text.muted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
      fontSize: 9.5,
      fontWeight: '600',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 5,
      overflow: 'hidden',
    },
    rowMeta: { ...TYPE.mono, fontFamily: undefined, color: t.text.muted, fontSize: 10.5, marginTop: 2 },
    rowError: { color: t.semantic.dangerText, fontSize: 10.5, marginTop: 2 },
    rowChevron: { color: t.text.secondary, fontSize: 12, fontWeight: '600' },
    switchOff: { backgroundColor: t.border.default },
    switchOn: { backgroundColor: t.semantic.live },
    switchThumb: { backgroundColor: t.bg.elevatedAnswer },
    installPill: {
      backgroundColor: t.action.primaryBg,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 9,
    },
    installPillText: { color: t.action.primaryText, fontSize: 12, fontWeight: '700' },
    actionsRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
    actionButton: {
      flex: 1,
      backgroundColor: t.action.primaryBg,
      borderRadius: 12,
      paddingVertical: 11,
      alignItems: 'center',
    },
    actionButtonText: { color: t.action.primaryText, fontSize: 13, fontWeight: '700' },
    capToggle: { marginTop: 18, paddingVertical: 6 },
    capToggleText: { color: t.text.muted, fontSize: 11.5, fontWeight: '600' },
    capRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border.subtle,
    },
    capDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.text.secondary },
    capDotOn: { backgroundColor: t.semantic.live },
    capDotOff: { backgroundColor: t.border.default },
    capText: { flex: 1, color: t.text.primary, fontSize: 12.5 },
    footnote: { color: t.text.muted, fontSize: 11, lineHeight: 16, marginTop: 16 },
  });
