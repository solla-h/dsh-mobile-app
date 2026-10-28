import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import type { SessionItem } from '../../protocol/types';
import { MOTION, TYPE } from '../../theme/tokens';
import { tapFeedback, tickFeedback } from '../haptics';
import { MONO, useTheme } from '../theme';

interface Props {
  sessions: SessionItem[];
  activeId?: string;
  /** 正在等待审批或回答的会话 ID 列表，用来在弧形节点上亮起暖琥珀色呼吸灯 */
  blockedIds?: string[];
  onSelect: (sessionId: string) => void;
}

const STRIP_H = 104;
const CARD_W = 190; // 缩小卡片宽度，防止超出屏幕左侧
const CARD_H = 52;
/** 圆弧半径：以「选中项」为弧顶，整串卡片绕着这个半径转。 */
const ARC_RADIUS = 320;
const MAX_ITEMS = 10;
/** 弧顶卡片左边缘距屏幕左侧的距离。 */
const ARC_LEFT = 12;
/** 最大展开角度：左右各 45°，总共 90° */
/** 相邻两格的夹角：由「卡片高度 ÷ 半径」定，保证弧顶处刚好一格一张卡。 */
const STEP_RAD = (9.5 * Math.PI) / 180;

/**
 * 右侧拇指弧形焦段转盘（§2.2 Camera-Lens Radial Session Dial）。
 * - 平时隐藏于右侧边缘 2pt 微刻槽感应条内（带 3 枚镜头刻度点）；
 * - 右手拇指按住滑动或轻点即呼出 R=175pt (-48°~+48°) 相机焦段圆弧；
 * - 拇指上下滑动时每扫过一个会话触发一次机械棘轮震动 (tickFeedback)，松手即刻切换；
 * - 同样支持轻点呼出后直接点按任意会话胶囊切换。
 */
export function ArcDial({ sessions, activeId, blockedIds = [], onSelect }: Props) {
  const t = useTheme();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const list = useMemo(() => sessions.slice(0, MAX_ITEMS), [sessions]);
  const initialIndex = Math.max(
    0,
    list.findIndex((item) => item.sessionId === activeId),
  );
  const [index, setIndex] = useState(initialIndex);
  const lastTickIndexRef = useRef(initialIndex);
  const dragStartMsRef = useRef(0);
  const dragStartYRef = useRef(0);
  const dragStartIndexRef = useRef(0);
  const focusIndexRef = useRef(initialIndex);
  const movedRef = useRef(false);
  const focus = useState(() => new Animated.Value(initialIndex))[0];

  const centerY = height * 0.48;

  /**
   * 手指位置 → 角度的映射，必须和卡片的视觉排布用同一套几何：
   * 卡片纵向位置是 R·sin(θ)，所以反解 asin(dy / R) 才能做到「手指走多远、列表转多远」。
   */
  const angleAt = useCallback(
    (pageY: number) => {
      const dy = clamp(pageY - centerY, -ARC_RADIUS + 1, ARC_RADIUS - 1);
      return Math.asin(dy / ARC_RADIUS);
    },
    [centerY],
  );

  const snapTo = useCallback(
    (target: number) => {
      Animated.spring(focus, {
        toValue: target,
        useNativeDriver: true,
        tension: MOTION.collapse.tension * 1.5,
        friction: 22,
      }).start();
    },
    [focus],
  );

  const handleGrant = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      if (list.length === 0) return;
      dragStartMsRef.current = Date.now();
      movedRef.current = false;
      tapFeedback();
      setOpen(true);
      // 按下时不跳格：从当前选中项开始，后续位移按角度增量换算。
      dragStartYRef.current = gesture.y0;
      dragStartIndexRef.current = focusIndexRef.current;
    },
    [list.length],
  );

  const handleMove = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      // 降低滑动阈值，提高灵敏度
      if (Math.abs(gesture.dy) > 3 || Math.abs(gesture.dx) > 3) movedRef.current = true;
      if (list.length < 2) return;
      // 手指位移换算成转角，再折算成格数：视觉和手势用同一套几何。
      const span = Math.max(1, list.length - 1);
      const turned = (angleAt(gesture.moveY) - angleAt(dragStartYRef.current)) / STEP_RAD;
      const next = clamp(dragStartIndexRef.current - turned, 0, span);
      focus.setValue(next);
      focusIndexRef.current = next;
      const rounded = Math.round(next);
      if (rounded !== lastTickIndexRef.current) {
        lastTickIndexRef.current = rounded;
        tickFeedback();
        setIndex(rounded);
      }
    },
    [angleAt, focus, list.length],
  );

  const handleRelease = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      const elapsed = Date.now() - dragStartMsRef.current;
      // 轻点一下不切换：保持展开，等用户直接点卡片。
      if (!movedRef.current && elapsed < 260) return;
      setOpen(false);
      const target = list.length > 1 ? Math.round(focusIndexRef.current) : 0;
      snapTo(target);
      focusIndexRef.current = target;
      const picked = list[target];
      if (picked && picked.sessionId !== activeId) {
        tapFeedback();
        onSelect(picked.sessionId);
      }
    },
    [activeId, list, onSelect, snapTo],
  );

  // 手势被系统打断（来电、系统手势）时保持展开，不要「闪退」。
  const handleTerminate = useCallback(() => undefined, []);

  // 展开后整块区域都能上下滑：只接管真正的拖动，轻点仍旧落到卡片或遮罩上。
  const dragResponder = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 6,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: handleGrant,
        onPanResponderMove: handleMove,
        onPanResponderRelease: handleRelease,
        onPanResponderTerminate: handleTerminate,
      }),
    [handleGrant, handleMove, handleRelease, handleTerminate],
  );

  // PanResponder.create 只是在渲染期注册回调，真正的 ref 读取都发生在触摸回调里；
  // React Compiler 的 refs 规则看不出这层，这一处单独豁免。
  const responder = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => list.length > 0,
        onMoveShouldSetPanResponder: () => list.length > 0,
        // 一旦接管就不许旁边的 FlatList 抢走手势：默认允许终止，
        // 于是按住右缘往上拖时列表会先滚一下再让转盘闪退。
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: handleGrant,
        onPanResponderMove: handleMove,
        onPanResponderRelease: handleRelease,
        onPanResponderTerminate: handleTerminate,
      }),
    [handleGrant, handleMove, handleRelease, handleTerminate, list.length],
  );

  if (list.length === 0) return null;

  const previewItem = list[index] ?? list[0];
  const previewBlocked = previewItem && blockedIds.includes(previewItem.sessionId);

  return (
    <>
      {/* 右侧边缘 2pt 微刻槽感应条：展开后仍然挂着（只是隐形），
          这样「按住边缘往上下拖」是一条连续手势，不会因为组件换掉而断掉。 */}
      <View
          style={[
            styles.stripWrap,
            {
              top: centerY - STRIP_H / 2,
              backgroundColor: t.bg.surface,
              borderColor: t.border.default,
              opacity: open ? 0 : 1,
            },
          ]}
          // 命中区比视觉条宽得多：手指落在右缘附近就开始接管，
          // 不然偶尔会被下面的 FlatList 先接住、转盘呼不出来。
          hitSlop={{ left: 32, right: 8, top: 56, bottom: 56 }}
          {...responder.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel="按住或轻点呼出拇指弧形会话转盘"
        >
          <View style={[styles.tickTiny, { backgroundColor: t.text.muted }]} />
          <View
            style={[
              styles.tickCenter,
              {
                backgroundColor:
                  blockedIds.length > 0 ? t.semantic.gateAmberText : t.text.primary,
              },
            ]}
          />
          <View style={[styles.tickTiny, { backgroundColor: t.text.muted }]} />
      </View>

      {open ? (
        <View style={styles.overlay} pointerEvents="box-none">
          {/* 点击背景遮罩收起转盘 */}
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />

          {/* 展开状态下的拖拽层：手指上下滑即可切会话 */}
          <View style={styles.dragLayer} {...dragResponder.panHandlers} />

          {/* 左上角焦段取景框 (Focal Preview HUD) */}
          <View
            pointerEvents="none"
            style={[
              styles.preview,
              { backgroundColor: t.bg.elevatedAnswer, borderColor: t.border.default },
            ]}
          >
            <View style={styles.previewHeader}>
              <Text style={[styles.previewKicker, { color: t.text.muted }]}>
                THUMB ARC DIAL · {codeOf(index)}/{String(list.length).padStart(2, '0')}
              </Text>
              <View
                style={[
                  styles.previewBadge,
                  {
                    backgroundColor: previewBlocked
                      ? t.semantic.gateAmberBg
                      : t.bg.subtle,
                    borderColor: previewBlocked
                      ? t.semantic.gateAmberText
                      : t.border.subtle,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.previewBadgeText,
                    {
                      color: previewBlocked
                        ? t.semantic.gateAmberText
                        : t.text.secondary,
                    },
                  ]}
                >
                  {previewBlocked
                    ? '待审批 GATE'
                    : previewItem?.running
                      ? '运行中 RUN'
                      : '已就绪 IDLE'}
                </Text>
              </View>
            </View>
            <Text style={[styles.previewRepo, { color: t.text.secondary }]} numberOfLines={1}>
              {repoOf(previewItem)}
            </Text>
            <Text style={[styles.previewTitle, { color: t.text.primary }]} numberOfLines={2}>
              {titleOf(previewItem)}
            </Text>
          </View>

          {/* 沿着 R=175pt 圆弧排布的会话胶囊节点 */}
          {list.map((item, i) => {
            const selected = i === index;
            const isCurrent = item.sessionId === activeId;
            const isBlocked = blockedIds.includes(item.sessionId);
            const span = Math.max(1, list.length - 1);
            const steps = range(-span, span);
            // 每格固定转角：会话再多也只是往外排，超出屏幕的自然滑出去。
            const stepRad = STEP_RAD;
            const delta = Animated.subtract(i, focus);
            const dyOf = (d: number) => Math.sin(d * stepRad) * ARC_RADIUS;
            // 越远的卡越往屏幕右侧收，整串像绕着镜头轴转。
            const dxOf = (d: number) => ARC_RADIUS * (1 - Math.cos(d * stepRad));
            const scaleOf = (d: number) => Math.max(0.62, 1 - 0.06 * Math.abs(d));
            // 排到屏幕外的远端淡出，压缩感更自然，也不会抢视线。
            const opacityOf = (d: number) => Math.max(0.35, 1 - 0.14 * Math.max(0, Math.abs(d) - 3));

            return (
              <Animated.View
                key={item.sessionId}
                style={[
                  styles.nodeWrap,
                  {
                    left: ARC_LEFT,
                    top: centerY - CARD_H / 2,
                    zIndex: selected ? 60 : 40 - Math.abs(i - index),
                    opacity: delta.interpolate({
                      inputRange: steps,
                      outputRange: steps.map(opacityOf),
                      extrapolate: 'clamp',
                    }),
                    transform: [
                      {
                        translateY: delta.interpolate({
                          inputRange: steps,
                          outputRange: steps.map(dyOf),
                          extrapolate: 'clamp',
                        }),
                      },
                      {
                        translateX: delta.interpolate({
                          inputRange: steps,
                          outputRange: steps.map(dxOf),
                          extrapolate: 'clamp',
                        }),
                      },
                      {
                        scale: delta.interpolate({
                          inputRange: steps,
                          outputRange: steps.map(scaleOf),
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Pressable
                  onPress={() => {
                    tapFeedback();
                    setOpen(false);
                    if (item.sessionId !== activeId) {
                      onSelect(item.sessionId);
                    }
                  }}
                  style={styles.nodeRow}
                >
                  <View
                    style={[
                      styles.card,
                      {
                        backgroundColor: selected ? t.action.primaryBg : t.bg.surface,
                        borderColor: selected
                          ? t.action.primaryBg
                          : isCurrent
                            ? t.text.primary
                            : t.border.default,
                        // 当前会话额外加粗描边，扫一眼就能认出「松手会切回哪」。
                        borderWidth: isCurrent && !selected ? 1.5 : StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.cardDot,
                        {
                          backgroundColor: isBlocked
                            ? t.semantic.gateAmberText
                            : item.running
                              ? selected
                                ? t.action.primaryText
                                : t.semantic.diffAddText
                              : selected
                                ? t.action.primaryText
                                : t.text.muted,
                        },
                      ]}
                    />
                    <View style={styles.cardBody}>
                      <View style={styles.cardTitleRow}>
                        <Text
                          style={[
                            styles.cardTitle,
                            { color: selected ? t.action.primaryText : t.text.primary },
                          ]}
                          numberOfLines={1}
                        >
                          {titleOf(item)}
                        </Text>
                        {isCurrent ? (
                          <View
                            style={[
                              styles.currentBadge,
                              {
                                borderColor: selected ? t.action.primaryText : t.text.primary,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.currentBadgeText,
                                { color: selected ? t.action.primaryText : t.text.primary },
                              ]}
                            >
                              当前
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text
                        style={[
                          styles.cardMeta,
                          { color: selected ? t.action.primaryText : t.text.muted },
                        ]}
                        numberOfLines={1}
                      >
                        {repoOf(item)}
                      </Text>
                    </View>
                  </View>

                  {/* 序号放在卡片外侧、贴着弧线 */}
                  <Text
                    style={[
                      styles.cardIndex,
                      { color: selected ? t.text.primary : t.text.muted },
                    ]}
                  >
                    {codeOf(i)}
                  </Text>

                  {/* 圆弧轨道上的锚点圆环 */}
                  <View
                    style={[
                      styles.arcAnchorDot,
                      {
                        backgroundColor: selected
                          ? t.semantic.gateAmberText
                          : t.bg.surface,
                        borderColor: selected ? t.text.primary : t.border.default,
                      },
                    ]}
                  />
                </Pressable>
              </Animated.View>
            );
          })}
          {/* 右侧边缘收起把手 */}
          <Pressable
            onPress={() => setOpen(false)}
            style={[
              styles.closeHandle,
              {
                top: centerY - 46,
                backgroundColor: t.bg.surface,
                borderColor: t.border.default,
              },
            ]}
          >
            <Text style={[styles.closeHandleText, { color: t.text.secondary }]}>收起</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
}

function codeOf(index: number): string {
  return String(index + 1).padStart(2, '0');
}

function titleOf(item: SessionItem | undefined): string {
  return item?.projections?.values.title?.trim() || '未命名会话';
}

function repoOf(item: SessionItem | undefined): string {
  const cwd = item?.cwd ?? '';
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/') || '默认工作区';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  stripWrap: {
    position: 'absolute',
    right: 0,
    width: 9,
    height: STRIP_H,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    zIndex: 25,
  },
  tickTiny: { width: 2, height: 8, borderRadius: 1, opacity: 0.45 },
  tickCenter: { width: 3.5, height: 18, borderRadius: 2 },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 40,
    // Android 上 zIndex 只管绘制顺序，触摸还是按 view 顺序；
    // 抬 elevation 保证展开后整层盖在会话列表之上。
    elevation: 40,
  },
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(20, 20, 18, 0.42)',
  },
  dragLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  preview: {
    position: 'absolute',
    left: 14,
    right: 54,
    top: 54,
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  previewKicker: { ...TYPE.mono, fontFamily: MONO, fontSize: 10 },
  previewBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewBadgeText: { ...TYPE.mono, fontFamily: MONO, fontSize: 9.5, fontWeight: '600' },
  previewRepo: { ...TYPE.mono, fontFamily: MONO, marginTop: 2 },
  previewTitle: { ...TYPE.title, fontWeight: '700' },
  nodeWrap: {
    position: 'absolute',
  },
  nodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  cardDot: { width: 7, height: 7, borderRadius: 3.5 },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: 12.5, fontWeight: '600', lineHeight: 16, flexShrink: 1 },
  currentBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  currentBadgeText: { fontSize: 9, fontWeight: '600', lineHeight: 12 },
  cardMeta: { ...TYPE.mono, fontFamily: MONO, fontSize: 10, opacity: 0.78, marginTop: 1 },
  cardIndex: {
    ...TYPE.mono,
    fontFamily: MONO,
    fontSize: 10,
    marginLeft: 8,
    marginRight: 6,
    opacity: 0.8,
  },
  arcAnchorDot: {
    marginLeft: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  closeHandle: {
    position: 'absolute',
    right: 0,
    paddingHorizontal: 6,
    paddingVertical: 14,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeHandleText: { ...TYPE.mono, fontFamily: MONO, fontSize: 10, width: 12, textAlign: 'center' },
});
