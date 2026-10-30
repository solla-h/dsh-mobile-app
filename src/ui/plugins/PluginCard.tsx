import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import type { OfficialItem, PluginBundle, PluginEntry } from '../../protocol/plugins';
import { tapFeedback } from '../haptics';
import { useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';
import type { PluginManager } from './usePluginManager';

/**
 * 插件详情大卡片：居中悬浮的竖版卡（塔罗牌的形状，不是塔罗牌的皮），
 * 左右滑动轮播切换插件，像抽卡一样一张张翻。
 *
 * 统一三种详情：bundle（含条目开关）、独立条目、内置配置卡。
 * 开关与列表行右侧的 Switch 同款——点一下变绿/变灰，不要宽条形按钮。
 */

const GATEWAY_PACKAGE = 'dsh-plugin-mobile-gateway';

/** tinder 跟手映射的近似卡宽（dp）：旋转/淡出/下层揭示都按它做插值。 */
const SWIPE_RANGE = 336;
/** 释放切卡的位移阈值。 */
const SWIPE_THRESHOLD = 72;
/** 飞出距离：略过半屏即可完全离屏；距离太远会让下层揭示在飞出前段就扫完，
    「瞬间放大到位再干等」，观感像刷新而不是被推上来。 */
const FLY_OUT = 460;

export type CardItem =
  | { kind: 'bundle'; bundle: PluginBundle; entries: PluginEntry[] }
  | { kind: 'entry'; entry: PluginEntry }
  | { kind: 'official'; item: OfficialItem };

interface Props {
  items: CardItem[];
  index: number;
  writable: boolean;
  manager: PluginManager;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onEditNamespace: (ns: string) => void;
}

export function PluginCard({ items, index, writable, manager, onIndexChange, onClose, onEditNamespace }: Props) {
  const styles = useThemedStyles(makeStyles);
  const safeIndex = Math.min(Math.max(index, 0), Math.max(items.length - 1, 0));
  const item = items[safeIndex];

  /** 横滑切卡：位移超阈值且横向明显大于纵向才算翻页。 */
  // Animated.Value 用 state 持有（同 ArcDial 的 focus）：它是可变对象不是渲染数据，
  // 但 useRef 的 .current 语义会被 React Compiler 的 refs 规则拦下。
  const [pan] = useState(() => new Animated.ValueXY());

  const indexRef = useRef(safeIndex);
  useEffect(() => {
    indexRef.current = safeIndex;
  }, [safeIndex]);
  /** 切卡后重置位移必须用 useLayoutEffect：它在渲染提交后、绘制前执行，
      把「index 换卡」和「pan 归零」压进同一帧——上一帧旧下层卡已全尺寸停在
      中心，这一帧新顶层卡同内容同尺寸，像素一致，闪动从机制上消除。
      （useEffect 在绘制后才跑，会露出一帧「新顶层卡在屏幕外、中心无卡」的空窗。） */
  useLayoutEffect(() => {
    pan.setValue({ x: 0, y: 0 });
  }, [safeIndex, pan]);
  /** 飞出动画进行中的标记与既定目标（被打断时据此立即提交）。 */
  const flyingRef = useRef(false);
  const pendingTargetRef = useRef<number | null>(null);
  /** 拖动方向：-1=下一张（左滑），1=上一张（右滑）。下层只渲染方向对应的一张，
      否则两张壳完全重叠、下面那张会被上面的盖住，左右观感不统一。 */
  const [underDir, setUnderDir] = useState<-1 | 1>(-1);
  const underDirRef = useRef<-1 | 1>(-1);
  // ---- tinder 跟手编排：一切动画都是 pan.x 的插值，飞出时只驱动 pan.x 一处 ----
  /** 顶层卡倾角：随 dx 线性倾斜，最多 ±10° */
  const topRotate = pan.x.interpolate({
    inputRange: [-SWIPE_RANGE, 0, SWIPE_RANGE],
    outputRange: ['-10deg', '0deg', '10deg'],
    extrapolate: 'clamp',
  });
  /** 顶层卡淡出：拖出约半屏后开始消失 */
  const topOpacity = pan.x.interpolate({
    inputRange: [-SWIPE_RANGE * 1.05, -SWIPE_RANGE * 0.7, 0, SWIPE_RANGE * 0.7, SWIPE_RANGE * 1.05],
    outputRange: [0, 1, 1, 1, 0],
    extrapolate: 'clamp',
  });
  /** 左滑（下一张）揭示进度：dx=-R 时为 1 */
  const nextProgress = pan.x.interpolate({
    inputRange: [-SWIPE_RANGE, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  /** 右滑（上一张）揭示进度：dx=+R 时为 1 */
  const prevProgress = pan.x.interpolate({
    inputRange: [0, SWIPE_RANGE],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  // PanResponder.create 只是在渲染期注册回调，真正的 ref 读取都发生在触摸回调里；
  // React Compiler 的 refs 规则看不出这层，这一处整块豁免（同 ArcDial）。
  /* eslint-disable react-hooks/refs */
  const responder = useMemo(
    () =>
      PanResponder.create({
        // down 的冒泡阶段即接管：协商从最深 target 冒泡上来，
        // 按钮（Pressable）和条目 ScrollView 更深、先拿到 → 它们正常工作；
        // 纯文本/空白区没人要 → 卡片拿到 → 横滑切卡。
        // capture 阶段不能抢：会连按钮的 down 一起吃掉（实测按钮失效）。
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (e, g) => {
          const want: -1 | 1 = g.dx < -6 ? -1 : g.dx > 6 ? 1 : underDirRef.current;
          if (want !== underDirRef.current) {
            underDirRef.current = want;
            setUnderDir(want);
          }
          Animated.event([null, { dx: pan.x }], { useNativeDriver: false })(e, g);
        },
        // 飞出动画被新触摸打断时，立即按既定方向完成切卡，避免停在半空。
        onPanResponderGrant: () => {
          if (flyingRef.current && pendingTargetRef.current !== null) {
            const target = pendingTargetRef.current;
            flyingRef.current = false;
            pendingTargetRef.current = null;
            pan.stopAnimation();
            tapFeedback();
            onIndexChange(target);
          }
        },
        onPanResponderRelease: (_e, g) => {
          const next = g.dx < -SWIPE_THRESHOLD ? 1 : g.dx > SWIPE_THRESHOLD ? -1 : 0;
          const target = Math.min(Math.max(indexRef.current + next, 0), items.length - 1);
          if (next !== 0 && target !== indexRef.current) {
            // 顶层卡顺着手势方向飞出（旋转/淡出/下层揭示全是 pan.x 的插值，跟着一起走）。
            flyingRef.current = true;
            pendingTargetRef.current = target;
            Animated.timing(pan.x, {
              toValue: next * -FLY_OUT,
              duration: 300,
              useNativeDriver: false,
            }).start(({ finished }) => {
              if (!finished) return;
              flyingRef.current = false;
              pendingTargetRef.current = null;
              tapFeedback();
              onIndexChange(target);
            });
            return;
          }
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
            tension: 200,
            friction: 24,
          }).start();
        },
      }),
    [items.length, onIndexChange, pan],
  );
  /* eslint-enable react-hooks/refs */

  if (!item) return null;
  /** 按当前拖动方向取牌堆：underDir=-1 是左滑（下一张），=1 是右滑（上一张）。 */
  const nearItem = items[safeIndex - underDir];
  const farItem = items[safeIndex - underDir * 2];
  const nearProgress = underDir === -1 ? nextProgress : prevProgress;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {/* 卡片区：横向轮播的当前一张，居中悬浮。
            panHandlers 有两个要求：
            1) 必须挂在命中视图本体（box-none 容器不参与命中测试，手势协商不会经过它）；
            2) 必须挂在普通 View 上——Fabric 下 Animated.View 丢 panHandlers，
               挂它上面手势协商从未发生（滑动完全无反应的根因）。 */}
        <View style={styles.stage} pointerEvents="box-none">
          {/* tinder 牌堆：按拖动方向只渲染「立即要上来的那张」+ 更深一层壳。
              两张 0.92 的壳完全重叠时，渲染顺序会让左滑方向压住右滑方向，观感不统一。 */}
          {farItem ? (
            <UnderCardView
              key={'far:' + cardKeyOf(farItem)}
              item={farItem}
              progress={nearProgress}
              restScale={0.76}
              restY={110}
              restOpacity={0.7}
              writable={writable}
              manager={manager}
            />
          ) : null}
          {nearItem ? (
            <UnderCardView
              key={'near:' + cardKeyOf(nearItem)}
              item={nearItem}
              progress={nearProgress}
              restScale={0.88}
              restY={56}
              restOpacity={0.85}
              writable={writable}
              manager={manager}
            />
          ) : null}
          <Animated.View
            style={[
              styles.card,
              styles.cardTop,
              {
                opacity: topOpacity,
                transform: [{ translateX: pan.x }, { rotate: topRotate }],
              },
            ]}
          >
            <View style={styles.cardInner} {...responder.panHandlers}>
              <CardBody
                item={item}
                writable={writable}
                manager={manager}
                onClose={onClose}
                onEditNamespace={onEditNamespace}
              />
            </View>
          </Animated.View>
        </View>

        {/* 底部页码 + 左右翻页 */}
        <View style={styles.pager} pointerEvents="box-none">
          <Pressable
            hitSlop={12}
            disabled={safeIndex === 0}
            onPress={() => onIndexChange(safeIndex - 1)}
            style={styles.pageArrow}
          >
            <Text style={[styles.pageArrowText, safeIndex === 0 && styles.pageArrowOff]}>‹</Text>
          </Pressable>
          <Text style={styles.pageText}>
            {safeIndex + 1} / {items.length}
          </Text>
          <Pressable
            hitSlop={12}
            disabled={safeIndex >= items.length - 1}
            onPress={() => onIndexChange(safeIndex + 1)}
            style={styles.pageArrow}
          >
            <Text style={[styles.pageArrowText, safeIndex >= items.length - 1 && styles.pageArrowOff]}>›</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/**
 * 牌堆下层的卡壳：静止时缩小下沉（露出下缘形成层叠），
 * 随揭示进度放大到 1 —— 视觉上就是「下面这张被顶上来」。
 */
function UnderCardView({
  item,
  progress,
  restScale,
  restY,
  restOpacity,
  writable,
  manager,
}: {
  item: CardItem;
  progress: Animated.AnimatedInterpolation<number>;
  restScale: number;
  restY: number;
  restOpacity: number;
  writable: boolean;
  manager: PluginManager;
}) {
  const styles = useThemedStyles(makeStyles);
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [restScale, 1] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [restY, 0] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [restOpacity, 1] });
  // 渲染和顶层卡完全一样的卡面：揭示时看到的就是下一张的真实样子，落位不跳变。
  // 外层 pointerEvents="none" 保证下层里的按钮/开关不抢触摸。
  return (
    <Animated.View
      style={[styles.card, styles.cardUnder, { opacity, transform: [{ translateY }, { scale }] }]}
      pointerEvents="none"
    >
      <CardBody
        item={item}
        writable={writable}
        manager={manager}
        onClose={() => undefined}
        onEditNamespace={() => undefined}
      />
    </Animated.View>
  );
}


/** 卡片唯一 key：index 切换后让下层卡整卡重挂，避免「原地缩回+变脸」的刷新感。 */
function cardKeyOf(item: CardItem): string {
  if (item.kind === 'bundle') return 'b:' + item.bundle.name;
  if (item.kind === 'entry') return 'e:' + item.entry.entryId;
  return 'o:' + item.item.id;
}

/** 卡面内容：顶层卡与牌堆下层共用同一套完整布局，保证滑动揭示与落位无缝衔接。 */
function CardBody({
  item,
  writable,
  manager,
  onClose,
  onEditNamespace,
}: {
  item: CardItem;
  writable: boolean;
  manager: PluginManager;
  onClose: () => void;
  onEditNamespace: (ns: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const title =
    item.kind === 'bundle'
      ? (item.bundle.title ?? item.bundle.name)
      : item.kind === 'entry'
        ? (item.entry.title ?? item.entry.entryId)
        : item.item.id;
  const subtitle =
    item.kind === 'bundle'
      ? item.bundle.name
      : item.kind === 'entry'
        ? item.entry.entryId
        : item.item.namespaces.join(' · ');
  const icon = item.kind === 'bundle' ? item.bundle.icon : undefined;
  const experimental = item.kind === 'bundle' ? item.bundle.experimental : false;
  const errorText =
    item.kind === 'bundle' ? item.bundle.error : item.kind === 'entry' ? item.entry.error : undefined;

  const bundleEnabled = item.kind === 'bundle' ? item.bundle.enabled : undefined;
  const entryEnabled = item.kind === 'entry' ? item.entry.enabled === true : undefined;
  const installed = item.kind === 'bundle' ? item.bundle.installed : true;
  const removable = item.kind === 'bundle' ? item.bundle.removable && writable : false;
  const readOnlyReason = item.kind === 'bundle' ? item.bundle.readOnlyReason : undefined;
  const switchable = writable && !readOnlyReason && item.kind !== 'official';
  const isSwitchOn = bundleEnabled ?? entryEnabled ?? false;

  const confirmRemove = () => {
    if (item.kind !== 'bundle') return;
    const self = item.bundle.name === GATEWAY_PACKAGE;
    Alert.alert(
      '卸载插件',
      self
        ? '这是移动网关自身，卸载后会立刻断开手机连接，只能从 DSH Web/CLI 恢复。确定继续？'
        : '卸载 ' + (item.bundle.title ?? item.bundle.name) + '？卸载后需要重新安装才能恢复。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '卸载',
          style: 'destructive',
          onPress: () => {
            void manager
              .removeBundle(item.bundle.name)
              .then(() => {
                onClose();
                if (self) {
                  Alert.alert('已提交卸载', '连接可能已中断，重连后请确认最终状态。');
                }
              })
              .catch((err: unknown) =>
                Alert.alert('卸载失败', err instanceof Error ? err.message : String(err)),
              );
          },
        },
      ],
      { cancelable: true },
    );
  };

  const statusLabel = (() => {
    if (item.kind === 'bundle') {
      if (!item.bundle.installed) return '未安装';
      return item.bundle.enabled ? '已启用' : '已停用';
    }
    if (item.kind === 'entry') return entryEnabled ? '已启用' : '已停用';
    return writable ? '可配置' : '只读';
  })();

  return (
    <>
            {/* 塔罗牌式内框线 */}
            <View style={styles.innerFrame} pointerEvents="none" />
            <View style={styles.cardContent}>
              <View style={styles.titleRow}>
                {icon ? (
                  <Image source={{ uri: icon }} style={styles.icon} fadeDuration={0} />
                ) : (
                  <View style={[styles.icon, styles.iconPlaceholder]}>
                    <Text style={styles.iconText}>{title[0] ?? '?'}</Text>
                  </View>
                )}
                <View style={styles.titleBody}>
                  <View style={styles.titleLine}>
                    <Text style={styles.title} maxFontSizeMultiplier={1.3}>
                      {title}
                    </Text>
                    {experimental ? <Text style={styles.tag}>实验</Text> : null}
                  </View>
                  <Text style={styles.subtitle} numberOfLines={2}>
                    {subtitle}
                  </Text>
                </View>
                <Pressable hitSlop={12} onPress={onClose}>
                  <Text style={styles.close}>×</Text>
                </Pressable>
              </View>

              {item.kind === 'bundle' && item.bundle.description ? (
                <Text style={styles.description} numberOfLines={6}>{item.bundle.description}</Text>
              ) : null}
              {item.kind === 'entry' && item.entry.description ? (
                <Text style={styles.description} numberOfLines={6}>{item.entry.description}</Text>
              ) : null}
              {item.kind === 'official' ? (
                <Text style={styles.description}>DSH 内置配置卡片，用下方「编辑配置」调整。</Text>
              ) : null}

              {/* 状态行 + 同款开关 */}
              <View style={styles.statusRow}>
                <View style={styles.statusBody}>
                  <Text style={styles.statusLabel}>{statusLabel}</Text>
                  {readOnlyReason ? (
                    <Text style={styles.statusMeta} numberOfLines={2}>
                      只读：{readOnlyReason}
                    </Text>
                  ) : null}
                  {item.kind === 'bundle' && item.bundle.version ? (
                    <Text style={styles.statusMeta}>版本 {item.bundle.version}</Text>
                  ) : null}
                  {errorText ? (
                    <Text style={styles.errorText} numberOfLines={3}>
                      诊断：{errorText}
                    </Text>
                  ) : null}
                </View>
                {item.kind !== 'official' ? (
                  installed ? (
                    <Switch
                      value={isSwitchOn}
                      disabled={!switchable}
                      onValueChange={(value) => {
                        tapFeedback();
                        if (item.kind === 'bundle') {
                          void manager.toggleBundle(item.bundle.name, value).catch(() => manager.refresh());
                        } else {
                          void manager.toggleEntry(item.entry.entryId, value).catch(() => manager.refresh());
                        }
                      }}
                      trackColor={{ false: styles.switchOff.backgroundColor, true: styles.switchOn.backgroundColor }}
                      thumbColor={styles.switchThumb.backgroundColor}
                      ios_backgroundColor={styles.switchOff.backgroundColor}
                    />
                  ) : (
                    <Pressable style={styles.installPill} onPress={onClose}>
                      <Text style={styles.installPillText}>去添加安装</Text>
                    </Pressable>
                  )
                ) : null}
              </View>

              {/* bundle 的包内条目开关 */}
              {item.kind === 'bundle' && item.entries.length > 0 ? (
                <>
                  <Text style={styles.section}>包内条目 · {item.entries.length}</Text>
                  <ScrollView style={styles.entryScroll} nestedScrollEnabled>
                  {item.entries.map((entry) => (
                    <View key={entry.entryId} style={styles.entryRow}>
                      <View style={styles.entryBody}>
                        <Text style={styles.entryTitle} numberOfLines={1}>
                          {entry.title ?? entry.entryId}
                        </Text>
                        {entry.error ? (
                          <Text style={styles.errorText} numberOfLines={1}>
                            {entry.error}
                          </Text>
                        ) : null}
                      </View>
                      <Switch
                        value={entry.enabled === true}
                        disabled={!switchable}
                        onValueChange={(value) => {
                          tapFeedback();
                          void manager.toggleEntry(entry.entryId, value).catch(() => manager.refresh());
                        }}
                        trackColor={{ false: styles.switchOff.backgroundColor, true: styles.switchOn.backgroundColor }}
                        thumbColor={styles.switchThumb.backgroundColor}
                        ios_backgroundColor={styles.switchOff.backgroundColor}
                      />
                    </View>
                  ))}
                  </ScrollView>
                </>
              ) : null}

              {/* 操作区：紧凑胶囊按钮 */}
              <View style={styles.actions}>
                {item.kind === 'official' ? (
                  <Pressable
                    style={[styles.actionPill, styles.actionPillPrimary]}
                    disabled={!writable}
                    onPress={() => onEditNamespace(item.item.namespaces[0] ?? '')}
                  >
                    <Text style={styles.actionPillPrimaryText}>编辑配置</Text>
                  </Pressable>
                ) : item.kind === 'bundle' ? (
                  <>
                    {item.bundle.installed ? (
                      <Pressable
                        style={styles.actionPill}
                        onPress={() => onEditNamespace(item.bundle.name)}
                      >
                        <Text style={styles.actionPillText}>查看配置节</Text>
                      </Pressable>
                    ) : null}
                    {removable ? (
                      <Pressable
                        style={[styles.actionPill, styles.actionPillDanger]}
                        onPress={confirmRemove}
                      >
                        <Text style={styles.actionPillDangerText}>卸载</Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : null}
              </View>
            </View>
    </>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(20, 20, 18, 0.68)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stage: {
      width: '88%',
      maxWidth: 336,
      height: '72%',
      maxHeight: 620,
      alignItems: 'center',
      justifyContent: 'center',
    },
    card: {
      width: '100%',
      height: '100%',
      backgroundColor: t.bg.elevatedAnswer,
      borderRadius: 26,
      borderWidth: 1.5,
      borderColor: t.border.activeOrigin,
      overflow: 'hidden',
    },
    cardTop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    cardUnder: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },

    innerFrame: {
      position: 'absolute',
      left: 8,
      right: 8,
      top: 8,
      bottom: 8,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.subtle,
    },
    cardInner: { flex: 1 },
    cardContent: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 24, flex: 1 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: { width: 46, height: 46, borderRadius: 13 },
    iconPlaceholder: {
      backgroundColor: t.bg.subtle,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
    },
    iconText: { color: t.text.secondary, fontSize: 18, fontWeight: '700' },
    titleBody: { flex: 1, minWidth: 0 },
    titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { color: t.text.primary, fontSize: 16.5, fontWeight: '700', flexShrink: 1 },
    tag: {
      color: t.semantic.gateAmberText,
      backgroundColor: t.semantic.gateAmberBg,
      fontSize: 9.5,
      fontWeight: '700',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 5,
      overflow: 'hidden',
    },
    subtitle: { color: t.text.muted, fontSize: 10.5, marginTop: 2 },
    close: { color: t.text.muted, fontSize: 24, paddingHorizontal: 4 },
    description: { color: t.text.secondary, fontSize: 12.5, lineHeight: 18, marginTop: 12 },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 14,
      backgroundColor: t.bg.subtle,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    statusBody: { flex: 1, minWidth: 0 },
    statusLabel: { color: t.text.primary, fontSize: 13, fontWeight: '700' },
    statusMeta: { color: t.text.muted, fontSize: 10.5, marginTop: 2 },
    errorText: { color: t.semantic.dangerText, fontSize: 10.5, marginTop: 2 },
    section: {
      color: t.text.secondary,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 16,
      marginBottom: 4,
    },
    entryScroll: { maxHeight: 240, flexGrow: 0 },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border.subtle,
    },
    entryBody: { flex: 1, minWidth: 0 },
    entryTitle: { color: t.text.primary, fontSize: 13 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
    actionPill: {
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
      backgroundColor: t.bg.subtle,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    actionPillPrimary: {
      backgroundColor: t.action.primaryBg,
      borderColor: t.action.primaryBg,
    },
    actionPillPrimaryText: { color: t.action.primaryText, fontSize: 12, fontWeight: '700' },
    actionPillText: { color: t.text.secondary, fontSize: 12, fontWeight: '600' },
    actionPillDanger: {
      backgroundColor: t.semantic.dangerBg,
      borderColor: t.semantic.dangerText,
    },
    actionPillDangerText: { color: t.semantic.dangerText, fontSize: 12, fontWeight: '700' },
    installPill: {
      backgroundColor: t.action.primaryBg,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 10,
    },
    installPillText: { color: t.action.primaryText, fontSize: 11.5, fontWeight: '700' },
    pager: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 18,
    },
    pageArrow: { paddingVertical: 4, paddingHorizontal: 10 },
    pageArrowText: { color: t.text.primary, fontSize: 22, fontWeight: '700' },
    pageArrowOff: { color: t.text.muted, opacity: 0.4 },
    pageText: { color: t.text.secondary, fontSize: 12, fontVariant: ['tabular-nums'] },
    switchOff: { backgroundColor: t.border.default },
    switchOn: { backgroundColor: t.semantic.live },
    switchThumb: { backgroundColor: t.bg.elevatedAnswer },
  });
