/* eslint-disable react-hooks/refs, react-hooks/purity -- PanResponder 只能创建一次，
   它的回调在触摸时才执行；回调里读写 ref、调 Date.now() 都是这套写法的前提，
   渲染期真正读到的只有不可变的 panHandlers。 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';

/**
 * 首页底部的宠物舞台。
 *
 * 形象来自 dsh-pet 的「大肥鱼」（社区二创的鲸鱼娘，CC BY-NC-SA 4.0）。
 * 素材是从原项目 640×360 的 alpha 视频里抽帧、裁到人物、压成动画 WebP 的，
 * 所以这里不再用 SVG 画角色——画不像，也没有必要。
 *
 * 行为参考 dsh-pet 的桌宠：自播（过一会儿自己走两步）+ 点击回应 + 按住说话。
 * 区别是它只在首页这块舞台上活动，不会像桌面端那样满屏爬。
 */

type Sprite = 'idle' | 'listen' | 'think' | 'happy' | 'startle';

// Metro 需要静态 require，不能拼字符串。
const FISH: Record<Sprite, number> = {
  idle: require('../../../assets/pet/fish-idle.webp'),
  listen: require('../../../assets/pet/fish-listen.webp'),
  think: require('../../../assets/pet/fish-think.webp'),
  happy: require('../../../assets/pet/fish-happy.webp'),
  startle: require('../../../assets/pet/fish-startle.webp'),
};

/** 按住多久才真正开麦。轻点/双击都在这之前结束。 */
const HOLD_MS = 220;
/** 两次轻点间隔小于这个值算双击。 */
const DOUBLE_TAP_MS = 320;
/** 上滑多少 dp 算取消。 */
const CANCEL_DY = -60;

/** 点一下时的回应文案，按 dsh-pet 的语气，不带 emoji。 */
const TAP_LINES = ['别戳啦，按住和我说~', '在呢在呢', '摸鱼中，别戳', '叫我干嘛'];
const LAUNCH_LINES = ['收到！', '这就去', '好嘞'];

interface Props {
  /** 服务器语音是否就绪；没就绪时只播动画、不开麦 */
  voiceReady: boolean;
  recording: boolean;
  transcribing: boolean;
  onVoiceStart: () => void;
  onVoiceLaunch: () => void;
  onVoiceCancel: () => void;
  /** 双击：新建文本会话 */
  onCreate: () => void;
}

export function PetStage({
  voiceReady,
  recording,
  transcribing,
  onVoiceStart,
  onVoiceLaunch,
  onVoiceCancel,
  onCreate,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  // 跟屏幕宽度走，不写死：小屏不至于顶到卡片，大屏也不会显得空。
  const fishW = Math.min(168, Math.max(124, Math.round(width * 0.34)));
  const fishH = Math.round((fishW * 296) / 264);

  const [breath] = useState(() => new Animated.Value(0));
  const [ripple] = useState(() => new Animated.Value(0));
  const [swim] = useState(() => new Animated.Value(0));
  const [tilt] = useState(() => new Animated.Value(0));
  const [bubbleAnim] = useState(() => new Animated.Value(0));

  /** 一次性的表情动作，播完自动回到 idle */
  const [react, setReact] = useState<'happy' | 'startle' | null>(null);
  /** 朝向：往右走时镜像 */
  const [facing, setFacing] = useState(1);
  const [bubble, setBubble] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedRef = useRef(false);
  const startAtRef = useRef(0);
  const lastTapRef = useRef(0);
  const pickRef = useRef(0);

  const busy = recording || transcribing || react !== null;

  const sprite: Sprite = transcribing
    ? 'think'
    : recording
      ? 'listen'
      : react === 'startle'
        ? 'startle'
        : react === 'happy'
          ? 'happy'
          : 'idle';

  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      // 触发了就从表里摘掉，否则长时间停留在首页会越积越多。
      timersRef.current = timersRef.current.filter((item) => item !== id);
      fn();
    }, ms);
    timersRef.current.push(id);
    return id;
  };

  // 呼吸：地平线的明暗 + 站立时的轻微上下浮动
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath]);

  // 录音时脚下持续荡开；不录音时收干净，否则会挂一个淡淡的椭圆
  useEffect(() => {
    if (!recording) {
      ripple.stopAnimation();
      ripple.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(ripple, { toValue: 1, duration: 1400, useNativeDriver: true }),
    );
    ripple.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [recording, ripple]);

  // 自播：没人理它的时候，过几秒自己往一边游两步，停一会儿再游回来。
  // dsh-pet 是整只桌宠在桌面上走，我们这里舞台有限，所以位移只在 ±40dp 内。
  useEffect(() => {
    if (busy) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const push = (id: ReturnType<typeof setTimeout>) => {
      timers.push(id);
      timersRef.current.push(id);
    };

    const wander = () => {
      if (cancelled) return;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const distance = (22 + Math.random() * 18) * dir;
      setFacing(dir > 0 ? 1 : -1);
      Animated.parallel([
        Animated.timing(swim, {
          toValue: distance,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(tilt, {
          toValue: dir * 2.5,
          duration: 700,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(() => {
        if (cancelled) return;
        push(
          setTimeout(() => {
            if (cancelled) return;
            Animated.parallel([
              Animated.timing(swim, {
                toValue: 0,
                duration: 2000,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.timing(tilt, { toValue: 0, duration: 900, useNativeDriver: true }),
            ]).start();
            push(setTimeout(wander, 3200 + Math.random() * 2600));
          }, 900 + Math.random() * 1000),
        );
      });
    };

    push(setTimeout(wander, 3500 + Math.random() * 2500));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      timersRef.current = timersRef.current.filter((id) => !timers.includes(id));
    };
  }, [busy, swim, tilt]);

  // 开始录音 / 被点击时先游回中间，别在偏移状态下做表情。
  useEffect(() => {
    if (!busy) return;
    Animated.timing(swim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    Animated.timing(tilt, { toValue: 0, duration: 180, useNativeDriver: true }).start();
  }, [busy, swim, tilt]);

  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    },
    [],
  );

  const showBubble = (text: string, ms = 1800) => {
    setBubble(text);
    bubbleAnim.setValue(0);
    Animated.timing(bubbleAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    later(() => {
      Animated.timing(bubbleAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() =>
        setBubble(null),
      );
    }, ms);
  };

  const flash = (text: string, ms = 1600) => {
    setHint(text);
    later(() => setHint(null), ms);
  };

  const reactWith = (kind: 'happy' | 'startle', ms: number) => {
    setReact(kind);
    later(() => setReact(null), ms);
  };

  const cancelHold = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    armedRef.current = false;
  };

  // 回调走 ref：PanResponder 只创建一次，直接闭包会拿到首次渲染的旧 props。
  const apiRef = useRef({
    voiceReady,
    onVoiceStart,
    onVoiceLaunch,
    onVoiceCancel,
    onCreate,
    reactWith,
    showBubble,
    flash,
  });
  useEffect(() => {
    apiRef.current = {
      voiceReady,
      onVoiceStart,
      onVoiceLaunch,
      onVoiceCancel,
      onCreate,
      reactWith,
      showBubble,
      flash,
    };
  });

  const panRef = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // 从 FlatList / ScrollView 手里抢过来，不然手指一动就被列表接管。
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: () => {
        const api = apiRef.current;
        startAtRef.current = Date.now();
        armedRef.current = false;
        if (!api.voiceReady) {
          api.showBubble('语音还没就绪');
          return;
        }
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;
          armedRef.current = true;
          api.onVoiceStart();
        }, HOLD_MS);
      },

      onPanResponderMove: (_event, gesture) => {
        if (gesture.dy >= CANCEL_DY) return;
        const api = apiRef.current;
        if (holdTimerRef.current) {
          cancelHold();
          api.flash('不说啦？', 1200);
          return;
        }
        if (armedRef.current) {
          cancelHold();
          api.onVoiceCancel();
          api.showBubble('不说啦？', 1400);
          api.reactWith('startle', 1200);
        }
      },

      onPanResponderRelease: () => {
        const api = apiRef.current;
        const elapsed = Date.now() - startAtRef.current;
        const wasArmed = armedRef.current;
        cancelHold();

        if ((wasArmed || elapsed >= HOLD_MS) && api.voiceReady) {
          api.onVoiceLaunch();
          api.showBubble(LAUNCH_LINES[Math.floor(Math.random() * LAUNCH_LINES.length)], 1200);
          api.reactWith('happy', 1500);
          return;
        }

        const now = Date.now();
        if (now - lastTapRef.current < DOUBLE_TAP_MS) {
          lastTapRef.current = 0;
          api.onCreate();
          return;
        }
        lastTapRef.current = now;
        if (!api.voiceReady) {
          api.showBubble('语音还没就绪，双击新建会话');
          return;
        }
        pickRef.current = (pickRef.current + 1) % TAP_LINES.length;
        api.showBubble(TAP_LINES[pickRef.current]);
        api.reactWith('happy', 1400);
      },

      onPanResponderTerminate: () => {
        const wasArmed = armedRef.current;
        cancelHold();
        if (wasArmed) apiRef.current.onVoiceCancel();
      },
    }),
  );

  const groundOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const bob = breath.interpolate({ inputRange: [0, 1], outputRange: [1.5, -1.5] });
  const rotate = tilt.interpolate({ inputRange: [-3, 3], outputRange: ['-3deg', '3deg'] });
  const rippleScale = ripple.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const rippleOpacity = ripple.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: [0, 0.4, 0],
  });
  const bubbleStyle = {
    opacity: bubbleAnim,
    transform: [
      { translateY: bubbleAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
    ],
  };

  const caption = hint
    ? hint
    : transcribing
      ? '服务端识别中…'
      : recording
        ? '我在听… 松手发送'
        : voiceReady
          ? '按住和我说 · 双击新建会话'
          : '双击新建会话 · 语音未启用';

  return (
    <View
      style={styles.stage}
      {...panRef.current.panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityHint="按住说话，松手发送；上滑取消；双击新建会话"
    >
      <View style={{ width: fishW, height: fishH }}>
        {bubble ? (
          <Animated.View style={[styles.bubble, bubbleStyle]} pointerEvents="none">
            <Text style={styles.bubbleText} maxFontSizeMultiplier={1.3}>
              {bubble}
            </Text>
            <View style={styles.bubbleTail} />
          </Animated.View>
        ) : null}

        {/* 录音时从脚下荡开的一圈 */}
        <Animated.View
          style={[
            styles.ripple,
            {
              width: fishW * 0.62,
              height: fishW * 0.14,
              marginLeft: fishW * 0.19,
              opacity: rippleOpacity,
              transform: [{ scale: rippleScale }],
            },
            recording && styles.rippleLive,
          ]}
        />

        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateX: swim }, { translateY: bob }, { rotate }, { scaleX: facing }] },
          ]}
        >
          <Image source={FISH[sprite]} style={styles.fish} contentFit="contain" transition={140} />
        </Animated.View>

        {/* 地平线：一根发丝线，跟着宠物横向走（只跟 X，不跟上下浮动），
            兼作「呼吸」的载体——明暗随呼吸起伏 */}
        <Animated.View
          style={[
            styles.ground,
            {
              width: fishW * 0.62,
              marginLeft: fishW * 0.19,
              opacity: groundOpacity,
              transform: [{ translateX: swim }],
            },
            recording && styles.groundLive,
          ]}
        />
      </View>
      <Text style={styles.caption} maxFontSizeMultiplier={1.3} numberOfLines={1}>
        {caption}
      </Text>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    stage: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', gap: 10 },
    // 录音涟漪：一圈 hairline 椭圆，扩开即淡出。
    ripple: {
      position: 'absolute',
      bottom: -2,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.border.activeOrigin,
    },
    rippleLive: { borderColor: t.semantic.gateAmberText },
    fish: { width: '100%', height: '100%' },
    ground: {
      position: 'absolute',
      bottom: 8,
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.border.activeOrigin,
    },
    groundLive: { backgroundColor: t.semantic.gateAmberText },
    // 对话气泡：纸面填充 + 发丝边，和卡片同一种语言，不做阴影。
    bubble: {
      position: 'absolute',
      top: -6,
      left: '38%',
      maxWidth: 160,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
      backgroundColor: t.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
      zIndex: 2,
    },
    bubbleText: { color: t.text.primary, fontSize: 11, lineHeight: 15 },
    bubbleTail: {
      position: 'absolute',
      left: 12,
      bottom: -4,
      width: 7,
      height: 7,
      backgroundColor: t.bg.surface,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
      transform: [{ rotate: '45deg' }],
    },
    caption: {
      alignSelf: 'stretch',
      color: t.text.muted,
      fontSize: 11,
      lineHeight: 16,
      letterSpacing: 0.3,
      textAlign: 'center',
    },
  });
