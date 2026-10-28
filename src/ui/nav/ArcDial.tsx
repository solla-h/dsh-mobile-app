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
const CARD_W = 240;
const CARD_H = 52;
/** 相邻会话的纵向节距：略大于卡片高，滑动时留一条缝。 */
const PITCH = 58;
/** 圆弧半径：以「选中项」为弧顶，整串卡片绕着这个半径转。 */
const ARC_RADIUS = 340;
const MAX_ITEMS = 6;

/**
 * 右侧拇指弧形焦段转盘（§2.2 Camera-Lens Radial Session Dial）。
 * - 平时隐藏于右侧边缘 2pt 微刻槽感应条内（带 3 枚镜头刻度点）；
 * - 右手拇指按住滑动或轻点即呼出 R=175pt (-48°~+48°) 相机焦段圆弧；
 * - 拇指上下滑动时每扫过一个会话触发一次机械棘轮震动 (tickFeedback)，松手即刻切换；
 * - 同样支持轻点呼出后直接点按任意会话胶囊切换。
 */
export function ArcDial({ sessions, activeId, blockedIds = [], onSelect }: Props) {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const list = useMemo(() => sessions.slice(0, MAX_ITEMS), [sessions]);
  const initialIndex = Math.max(
    0,
    list.findIndex((item) => item.sessionId === activeId),
  );
  const [index, setIndex] = useState(initialIndex);
  const lastTickIndexRef = useRef(initialIndex);
  const dragStartMsRef = useRef(0);
  const movedRef = useRef(false);
  const focus = useState(() => new Animated.Value(initialIndex))[0];

  const centerY = height * 0.48;
  // 圆心放在屏幕右外侧，卡片的右边缘贴着圆弧走。
  const pivotX = width + 160;

  /** 连续刻度：手指在哪，胶囊就滑到哪，不做四舍五入。 */
  const indexAtFloat = useCallback(
    (pageY: number) => {
      const span = Math.max(1, list.length - 1);
      const arcSpanY = 260;
      const topY = centerY - arcSpanY / 2;
      return clamp(((pageY - topY) / arcSpanY) * span, 0, span);
    },
    [centerY, list.length],
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
      const start = list.length > 1 ? indexAtFloat(gesture.y0) : 0;
      const rounded = Math.round(start);
      lastTickIndexRef.current = rounded;
      focus.stopAnimation();
      focus.setValue(start);
      setIndex(rounded);
    },
    [focus, indexAtFloat, list.length],
  );

  const handleMove = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      if (Math.abs(gesture.dy) > 8 || Math.abs(gesture.dx) > 8) movedRef.current = true;
      if (list.length < 2) return;
      const next = indexAtFloat(gesture.moveY);
      focus.setValue(next);
      const rounded = Math.round(next);
      if (rounded !== lastTickIndexRef.current) {
        lastTickIndexRef.current = rounded;
        tickFeedback();
        setIndex(rounded);
      }
    },
    [focus, indexAtFloat, list.length],
  );

  const handleRelease = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      const elapsed = Date.now() - dragStartMsRef.current;
      // 轻点一下不切换：保持展开，等用户直接点卡片。
      if (!movedRef.current && elapsed < 260) return;
      setOpen(false);
      const target = list.length > 1 ? Math.round(indexAtFloat(gesture.moveY || gesture.y0)) : 0;
      snapTo(target);
      const picked = list[target];
      if (picked && picked.sessionId !== activeId) {
        tapFeedback();
        onSelect(picked.sessionId);
      }
    },
    [activeId, indexAtFloat, list, onSelect, snapTo],
  );

  const handleTerminate = useCallback(() => setOpen(false), []);

  // PanResponder.create 只是在渲染期注册回调，真正的 ref 读取都发生在触摸回调里；
  // React Compiler 的 refs 规则看不出这层，这一处单独豁免。
  const responder = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => list.length > 0,
        onMoveShouldSetPanResponder: () => list.length > 0,
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
      {/* 静止态：右侧边缘 2pt 镜头微刻槽感应条 */}
      {!open ? (
        <View
          style={[
            styles.stripWrap,
            {
              top: centerY - STRIP_H / 2,
              backgroundColor: t.bg.surface,
              borderColor: t.border.default,
            },
          ]}
          hitSlop={{ left: 24, right: 4, top: 20, bottom: 20 }}
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
      ) : null}

      {open ? (
        <View style={styles.overlay} pointerEvents="box-none">
          {/* 点击背景遮罩收起转盘 */}
          <Pressable
            style={styles.backdrop}
            onPress={() => setOpen(false)}
          />

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
            // 以「选中项」为弧顶：离选中越远，越往屏幕右侧收，整串像绕着镜头轴转。
            const offsetOf = (d: number) => {
              const dyAbs = Math.min(Math.abs(d) * PITCH, ARC_RADIUS - 16);
              return ARC_RADIUS - Math.sqrt(Math.max(0, ARC_RADIUS * ARC_RADIUS - dyAbs * dyAbs));
            };
            const delta = Animated.subtract(i, focus);

            return (
              <Animated.View
                key={item.sessionId}
                style={[
                  styles.nodeWrap,
                  {
                    left: pivotX - ARC_RADIUS - CARD_W,
                    top: centerY - CARD_H / 2,
                    zIndex: selected ? 60 : 40 - Math.abs(i - index),
                    transform: [
                      {
                        translateX: delta.interpolate({
                          inputRange: steps,
                          outputRange: steps.map(offsetOf),
                          extrapolate: 'clamp',
                        }),
                      },
                      {
                        translateY: delta.interpolate({
                          inputRange: steps,
                          outputRange: steps.map((d) => d * PITCH),
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
                      transform: [{ scale: selected ? 1.04 : 0.96 }],
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
                    <Text
                      style={[
                        styles.cardTitle,
                        { color: selected ? t.action.primaryText : t.text.primary },
                      ]}
                      numberOfLines={1}
                    >
                      {titleOf(item)}
                    </Text>
                    <Text
                      style={[
                        styles.cardMeta,
                        { color: selected ? t.action.primaryText : t.text.muted },
                      ]}
                      numberOfLines={1}
                    >
                      {repoOf(item)}
                      {isCurrent ? ' · 当前' : ''}
                    </Text>
                  </View>
                </View>

                {/* 序号放在卡片外侧、贴着弧线，不占卡内空间 */}
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
  },
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(20, 20, 18, 0.42)',
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
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 12.5, fontWeight: '600', lineHeight: 16 },
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
