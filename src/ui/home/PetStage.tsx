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
 * 素材是从原项目 640×360 的 alpha 视频里抽帧、裁到人物、压成动画 WebP 的。
 *
 * 行为参考 dsh-pet 的桌宠：自播（自己溜达、东张西望）、点击分部位回应、
 * 按住说话。区别是它只在首页这块舞台上活动，不会像桌面端那样满屏爬。
 */

type Sprite =
  | 'idle'
  | 'listen'
  | 'think'
  | 'happy'
  | 'startle'
  | 'work'
  | 'angry'
  | 'run'
  | 'drag'
  | 'look';

// Metro 需要静态 require，不能拼字符串。
const FISH: Record<Sprite, number> = {
  idle: require('../../../assets/pet/fish-idle.webp'),
  listen: require('../../../assets/pet/fish-listen.webp'),
  think: require('../../../assets/pet/fish-think.webp'),
  happy: require('../../../assets/pet/fish-happy.webp'),
  startle: require('../../../assets/pet/fish-startle.webp'),
  work: require('../../../assets/pet/fish-work.webp'),
  angry: require('../../../assets/pet/fish-angry.webp'),
  run: require('../../../assets/pet/fish-run.webp'),
  drag: require('../../../assets/pet/fish-drag.webp'),
  look: require('../../../assets/pet/fish-look.webp'),
};

/** 拍打的部位：头 / 身体 / 尾巴。 */
type Zone = 'head' | 'body' | 'tail';

/** 按住多久才真正开麦。轻点/双击都在这之前结束。 */
const HOLD_MS = 220;
/** 两次轻点间隔小于这个值算双击。人手的双击通常在 250~400ms，320 太紧。 */
const DOUBLE_TAP_MS = 460;
/** 第一次轻点后等这么久再给反应：给第二下留出窗口，双击就不会先冒一句「别戳啦」。 */
const TAP_DELAY_MS = 260;
/** 上滑多少 dp 算取消。 */
const CANCEL_DY = -60;
/** 横向甩多少 dp 算「踢」。 */
const KICK_DX = 46;

/** 不同部位被拍时的回应，按 dsh-pet 的语气，不带 emoji。 */
const HEAD_LINES = ['别摸头啦，头发会乱', '唔…在听呢', '帽子要掉了'];
const BODY_LINES = ['在呢在呢', '摸鱼中，别戳', '叫我干嘛'];
const TAIL_LINES = ['痒！别碰尾巴', '再戳就生气了', '尾巴不能摸'];
const LAUNCH_LINES = ['收到！', '这就去', '好嘞'];

interface Props {
  /** 服务器语音是否就绪；没就绪时只播动画、不开麦 */
  voiceReady: boolean;
  recording: boolean;
  transcribing: boolean;
  /** 首页整体的状态：有人等着 / 有任务在跑 / 都闲着 */
  mood: 'alert' | 'working' | 'idle';
  /** 外部提示（识别失败、录音太短…）：token 变了就冒一次气泡，不弹窗 */
  notice?: { text: string; token: number } | null;
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
  mood,
  notice,
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
  // 最远位移按「屏幕边」算，不是按舞台内边算：素材左右各有约 5% 透明边，
  // 这样她跑到头时，人物本体离屏幕边只剩几 dp，撞墙才有撞击感。
  const maxX = Math.max(24, Math.round(width / 2 - fishW * 0.4 - 4));

  const [breath] = useState(() => new Animated.Value(0));
  const [ripple] = useState(() => new Animated.Value(0));
  const [swim] = useState(() => new Animated.Value(0));
  const [tilt] = useState(() => new Animated.Value(0));
  /** 被踢飞时的整圈翻滚：-1 / 0 / 1 对应 -360° / 0° / 360° */
  const [spin] = useState(() => new Animated.Value(0));
  const [bubbleAnim] = useState(() => new Animated.Value(0));

  /** 一次性的表情动作，播完自动回到常态 */
  const [react, setReact] = useState<
    'happy' | 'startle' | 'shy' | 'angry' | 'look' | null
  >(null);
  /** 正在跑向某个位置：用奔跑的素材，而不是滑过去 */
  const [walking, setWalking] = useState(false);
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
  /** 按下时的 y（相对这张图），用来判断拍的是头 / 身体 / 尾巴 */
  const startYRef = useRef(0);
  /** 第一次轻点后延迟给反应的计时器 */
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 已经弹过的外部提示 token，避免重复弹 */
  const lastNoticeRef = useRef(0);
  /** 这一次手势已经变成「踢」了，松手时不要再当成点击 */
  const kickedRef = useRef(false);
  /** 她现在站在哪（swim 的当前值）：自播要据此决定往哪走，不能每次都假设在中间 */
  const posRef = useRef(0);

  const busy = recording || transcribing || react !== null;

  const sprite: Sprite = transcribing
    ? 'think'
    : recording
      ? 'listen'
      : react === 'startle'
        ? 'startle'
        : react === 'happy'
          ? 'happy'
          : react === 'angry'
            ? 'angry'
            : react === 'look'
              ? 'look'
              : react === 'shy'
                ? 'listen'
                : walking
                  ? 'run'
                  : mood === 'alert'
                    ? 'think'
                    : mood === 'working'
                      ? 'work'
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

  const reactWith = (kind: 'happy' | 'startle' | 'shy' | 'angry' | 'look', ms: number) => {
    setReact(kind);
    later(() => setReact(null), ms);
  };

  /** 尾巴被戳：不只是换表情，整只往两边抖一下。 */
  const shake = () => {
    Animated.sequence([
      Animated.timing(swim, { toValue: 7, duration: 60, useNativeDriver: true }),
      Animated.timing(swim, { toValue: -7, duration: 90, useNativeDriver: true }),
      Animated.timing(swim, { toValue: 4, duration: 80, useNativeDriver: true }),
      Animated.timing(swim, { toValue: 0, duration: 90, useNativeDriver: true }),
    ]).start(() => {
      posRef.current = 0;
    });
  };

  /** 拍的是哪一块：上半是头、中间是身体、下面连着尾巴。 */
  const zoneAt = (y: number): Zone => {
    if (y < fishH * 0.46) return 'head';
    if (y < fishH * 0.84) return 'body';
    return 'tail';
  };

  const tapReaction = (zone: Zone) => {
    pickRef.current += 1;
    if (!voiceReady) {
      showBubble('语音还没就绪，双击新建会话', 2400);
      return;
    }
    if (zone === 'head') {
      reactWith('shy', 1500);
      showBubble(HEAD_LINES[pickRef.current % HEAD_LINES.length], 2200);
      return;
    }
    if (zone === 'tail') {
      reactWith('angry', 1600);
      shake();
      showBubble(TAIL_LINES[pickRef.current % TAIL_LINES.length], 2200);
      return;
    }
    reactWith('happy', 1500);
    showBubble(BODY_LINES[pickRef.current % BODY_LINES.length], 2200);
  };

  /** 撞到屏幕边：表情一惊、回弹一下，再冒一句。 */
  const bumpEdge = (dir: number) => {
    setWalking(false);
    reactWith('startle', 1400);
    // 表情要过一会儿才换上去（换源 + 交叉淡入 + 素材本身的起手帧），
    // 气泡晚 260ms 再出，才像是「先被撞到、再哎哟」。
    later(() => showBubble(dir > 0 ? '哎哟，到头了' : '这边也到头了', 1500), 260);
    // 撞完只往回弹几 dp：她应该还是贴在屏幕边上，而不是退回老远
    Animated.sequence([
      Animated.timing(swim, { toValue: dir * (maxX - 8), duration: 100, useNativeDriver: true }),
      Animated.timing(swim, { toValue: dir * (maxX - 1), duration: 140, useNativeDriver: true }),
      Animated.timing(swim, { toValue: dir * (maxX - 5), duration: 120, useNativeDriver: true }),
    ]).start(() => {
      posRef.current = dir * (maxX - 5);
    });
  };

  /** 被手指从侧面踢一脚：飞向另一侧、翻滚、撞墙、晕一下。 */
  const kick = (dir: 1 | -1) => {
    kickedRef.current = true;
    setWalking(false);
    // 素材朝左：往右飞要镜像
    setFacing(dir > 0 ? -1 : 1);
    reactWith('startle', 1800);
    spin.setValue(0);
    Animated.parallel([
      Animated.timing(swim, {
        toValue: dir * maxX,
        duration: 420,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(spin, {
        toValue: dir,
        duration: 420,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      spin.setValue(0);
      // 同上：先让震惊脸出来，再冒「晕…」
      later(() => showBubble('晕…', 1800), 260);
      // 撞上去之后弹两下，不是硬停
      Animated.sequence([
        Animated.timing(swim, { toValue: dir * (maxX - 20), duration: 110, useNativeDriver: true }),
        Animated.timing(swim, { toValue: dir * (maxX - 4), duration: 150, useNativeDriver: true }),
        Animated.timing(swim, { toValue: dir * (maxX - 12), duration: 130, useNativeDriver: true }),
      ]).start(() => {
        posRef.current = dir * (maxX - 12);
      });
    });
  };

  // 回调走 ref：PanResponder 只创建一次，直接闭包会拿到首次渲染的旧 props；
  // 自播定时器也通过它拿最新的处理函数，避免把 effect 依赖拖成一串。
  const apiRef = useRef({
    voiceReady,
    onVoiceStart,
    onVoiceLaunch,
    onVoiceCancel,
    onCreate,
    reactWith,
    showBubble,
    flash,
    tapReaction,
    zoneAt,
    bumpEdge,
    kick,
    setWalking,
  });
  // 渲染期刷新同一个对象：不新增状态、也不会触发重渲染。
  apiRef.current = {
    voiceReady,
    onVoiceStart,
    onVoiceLaunch,
    onVoiceCancel,
    onCreate,
    reactWith,
    showBubble,
    flash,
    tapReaction,
    zoneAt,
    bumpEdge,
    kick,
    setWalking,
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

  // 自播：没人理它的时候，过几秒自己决定干点什么——
  // 一半几率走到屏幕边上（撞一下），其余时候在附近溜达或者东张西望。
  useEffect(() => {
    if (busy) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const push = (id: ReturnType<typeof setTimeout>) => {
      timers.push(id);
      timersRef.current.push(id);
    };

    // dir 是「往哪边走」，不是「目标在哪」——回程时目标虽然是 0，方向仍然是反的。
    // 奔跑素材本身朝左，所以往右要走镜像；倾斜角在镜像之后会自动跟着翻，
    // 两边的常数都用 -2.5 就等于「朝着行进方向前倾」。
    const walkTo = (target: number, dir: 1 | -1, onArrive: () => void) => {
      if (cancelled) return;
      const distance = Math.abs(target - posRef.current);
      setWalking(true);
      setFacing(dir > 0 ? -1 : 1);
      Animated.parallel([
        Animated.timing(swim, {
          toValue: target,
          duration: 350 + distance * 8.5,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(tilt, {
          toValue: -2.5,
          duration: 400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(() => {
        posRef.current = target;
        Animated.timing(tilt, { toValue: 0, duration: 260, useNativeDriver: true }).start();
        // 先让 onArrive 决定要切什么表情，再收奔跑：两个 setState 在同一拍里批处理，
        // 否则会先闪一帧待机、再切惊吓，看起来像掉了一帧。
        onArrive();
        setWalking(false);
      });
    };

    const wander = () => {
      if (cancelled) return;
      // 站在边上就先走回中间，否则每次抽到的目标都在身后，看起来像卡在墙边。
      const from = posRef.current;
      if (Math.abs(from) > maxX * 0.6) {
        walkTo(0, from > 0 ? -1 : 1, () => {
          push(setTimeout(wander, 1200 + Math.random() * 1200));
        });
        return;
      }
      const dir = Math.random() < 0.5 ? -1 : 1;
      const roll = Math.random();
      if (roll < 0.25) {
        // 东张西望：站在原地看一圈
        apiRef.current.reactWith('look', 2600);
        return;
      }
      // 大多数时候直接跑到屏幕边（会撞一下），偶尔只在附近溜达
      const far = roll > 0.25;
      // 跑到边上时多冲 6dp：素材两侧有透明边，视觉上刚好贴住屏幕边再被弹回来
      const target = dir * (far ? maxX + 10 : maxX * (0.2 + Math.random() * 0.35));
      walkTo(target, dir, () => {
        if (cancelled) return;
        if (far) {
          // 走到头了：撞一下，然后等下一次自播
          apiRef.current.bumpEdge(dir);
          return;
        }
        push(
          setTimeout(() => {
            if (cancelled) return;
            // 回程方向跟去程相反
            walkTo(0, dir > 0 ? -1 : 1, () => {
              push(setTimeout(wander, 3000 + Math.random() * 2600));
            });
          }, 900 + Math.random() * 900),
        );
      });
    };

    push(setTimeout(wander, 3000 + Math.random() * 2200));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      timersRef.current = timersRef.current.filter((id) => !timers.includes(id));
    };
  }, [busy, maxX, swim, tilt]);

  // 开始录音时先游回中间，别在偏移状态下开麦（被踢飞时不要拉回来，那是另一套动画）。
  useEffect(() => {
    if (!recording && !transcribing) return;
    posRef.current = 0;
    Animated.timing(swim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    Animated.timing(tilt, { toValue: 0, duration: 180, useNativeDriver: true }).start();
  }, [recording, swim, tilt, transcribing]);

  // 外部提示走气泡，不弹窗；token 变了才算一条新提示。
  const showBubbleRef = useRef(showBubble);
  showBubbleRef.current = showBubble;
  useEffect(() => {
    if (!notice || notice.token === lastNoticeRef.current) return;
    lastNoticeRef.current = notice.token;
    // 发送失败时不要把「开心」留在脸上，先收起表情再说话。
    setReact(null);
    showBubbleRef.current(notice.text, 3800);
  }, [notice]);

  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    },
    [],
  );

  const cancelHold = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    armedRef.current = false;
  };


  const panRef = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // 从 FlatList / ScrollView 手里抢过来，不然手指一动就被列表接管。
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (event) => {
        const api = apiRef.current;
        startAtRef.current = Date.now();
        // locationY 相对的就是这张图（手势挂在图上），直接拿来分区。
        startYRef.current = event.nativeEvent.locationY;
        armedRef.current = false;
        kickedRef.current = false;
        if (!api.voiceReady) return;
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;
          armedRef.current = true;
          // 开麦前把上一句话收掉，否则「别摸头啦」会挂在聆听态上面。
          setBubble(null);
          bubbleAnim.setValue(0);
          api.onVoiceStart();
        }, HOLD_MS);
      },

      onPanResponderMove: (_event, gesture) => {
        const api = apiRef.current;
        // 横向快速一甩 = 踢她一脚：往哪边甩就飞到哪边撞墙。
        if (
          !armedRef.current &&
          !kickedRef.current &&
          Math.abs(gesture.dx) > KICK_DX &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5 &&
          Math.abs(gesture.vx) > 0.25
        ) {
          cancelHold();
          api.kick(gesture.dx > 0 ? 1 : -1);
          return;
        }

        if (gesture.dy >= CANCEL_DY) return;
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
        if (kickedRef.current) {
          // 这一下是踢，不是点击
          kickedRef.current = false;
          return;
        }
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
          // 第二下：取消第一下排队的反应，直接新建会话。
          lastTapRef.current = 0;
          if (tapTimerRef.current) {
            clearTimeout(tapTimerRef.current);
            tapTimerRef.current = null;
          }
          api.onCreate();
          return;
        }
        lastTapRef.current = now;
        // 先别急着反应：等一个双击窗口，没等到第二下才按部位回应。
        const zone = apiRef.current.zoneAt(startYRef.current);
        if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
        tapTimerRef.current = setTimeout(() => {
          tapTimerRef.current = null;
          apiRef.current.tapReaction(zone);
        }, TAP_DELAY_MS);
      },

      onPanResponderTerminate: () => {
        const wasArmed = armedRef.current;
        cancelHold();
        kickedRef.current = false;
        if (wasArmed) apiRef.current.onVoiceCancel();
      },
    }),
  );

  const groundOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const bob = breath.interpolate({ inputRange: [0, 1], outputRange: [1.5, -1.5] });
  const rotate = tilt.interpolate({ inputRange: [-3, 3], outputRange: ['-3deg', '3deg'] });
  const spinRotate = spin.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-360deg', '0deg', '360deg'],
  });
  const rippleScale = ripple.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const rippleOpacity = ripple.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: [0, 0.4, 0],
  });
  // 气泡跟着她走；只有她贴到屏幕边、气泡会被切掉的那一段，才往回让，
  // 让的正是「超出的那几 dp」，中间段一格都不偏。
  const bubbleLimit = Math.max(24, width / 2 - 94);
  const bubbleDrift = swim.interpolate({
    inputRange: [-maxX, -bubbleLimit, bubbleLimit, maxX],
    outputRange: [maxX - bubbleLimit, 0, 0, bubbleLimit - maxX],
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
      accessible
      accessibilityRole="button"
      accessibilityHint="按住说话，松手发送；上滑取消；双击新建会话；横向滑动可以把她踢走"
    >
      {/* 手势挂在图上而不是舞台上：locationY 才会相对这张图，
          头/身/尾按 fishH 一算就准，不用去猜 stage 在窗口里的位置。 */}
      <View style={{ width: fishW, height: fishH }} {...panRef.current.panHandlers}>
        {/* 录音时从脚下荡开的一圈 */}
        <Animated.View
          pointerEvents="none"
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
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [
                { translateX: swim },
                { translateY: bob },
                { rotate: spinRotate },
                { rotate },
                { scaleX: facing },
              ],
            },
          ]}
        >
          <Image source={FISH[sprite]} style={styles.fish} contentFit="contain" transition={90} />
        </Animated.View>

        {/* 地平线：一根发丝线，跟着宠物横向走（只跟 X，不跟上下浮动），
            兼作「呼吸」的载体——明暗随呼吸起伏 */}
        <Animated.View
          pointerEvents="none"
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

        {/* 气泡跟着图走但自己居中：走到屏幕边上时也不会被切掉 */}
        {bubble ? (
          <Animated.View
            style={[
              styles.bubbleWrap,
              // 跟图同一位移（气泡不在图片那个 transform 里，因为它不能被镜像），
              // 再叠上贴边时的回让量。
              { transform: [{ translateX: Animated.add(swim, bubbleDrift) }] },
            ]}
            pointerEvents="none"
          >
            <Animated.View style={[styles.bubble, bubbleStyle]}>
              <Text style={styles.bubbleText} maxFontSizeMultiplier={1.3}>
                {bubble}
              </Text>
              <View style={styles.bubbleTail} />
            </Animated.View>
          </Animated.View>
        ) : null}
      </View>
      <Text
        style={styles.caption}
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        pointerEvents="none"
      >
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
    // 气泡：纸面填充 + 发丝边，和卡片同一种语言，不做阴影。
    bubbleWrap: { position: 'absolute', top: -44, left: 0, right: 0, alignItems: 'center' },
    bubble: {
      maxWidth: 172,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
      backgroundColor: t.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
    },
    bubbleText: { color: t.text.primary, fontSize: 11, lineHeight: 15 },
    bubbleTail: {
      position: 'absolute',
      left: '50%',
      marginLeft: -4,
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
