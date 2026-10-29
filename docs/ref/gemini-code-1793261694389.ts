import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  Dimensions,
} from 'react-native';
import Svg, {
  G,
  Path,
  Circle,
  Ellipse,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  ClipPath,
} from 'react-native-svg';

// ==========================================
// 1. 类型与硬性舞台约束常量 (396dp × 234dp)
// ==========================================
export type TheaterTheme = 'PAPER' | 'EINK_SLATE';
export type TheaterState =
  | 'PATROL'       // State 01: 推球巡游
  | 'TURNAROUND'   // State 02: 边界换向 (含擦汗摸鱼彩蛋)
  | 'LISTENING'    // State 03: 按住急刹竖耳倾听
  | 'LAUNCH'       // State 04: 松手顶球发射
  | 'CANCEL';      // State 05: 上滑/移出取消 (豆豆眼问号)

interface WhaleOrbTheaterProps {
  theme?: TheaterTheme;
  /** 外部传入的实时麦克风音量 (0.0 ~ 1.0)，不传则内置模拟呼吸声波 */
  voiceVolume?: number;
  /** 语音录制完成并成功顶球发射的回调 */
  onVoiceLaunch?: (durationMs: number) => void;
  /** 取消录音回调 */
  onVoiceCancel?: () => void;
}

const STAGE_WIDTH = 396;
const STAGE_HEIGHT = 234;
const GROUND_Y = 190;
const ORB_RADIUS = 34; // 直径 68dp
const TRACK_LIMIT = 66; // 左右巡游行程 ±66dp，绝对不裁切出界
const PATROL_SPEED = 34; // 34dp/s 悠闲推球速度

const THEME_PALETTE = {
  PAPER: {
    bg: '#F4F2ED',
    subText: '#5C5B57',
    trackLine: '#D8D5CC',
    orbShadow: '#94A3B8',
    bubbleBg: '#FFFFFF',
    bubbleBorder: '#E2DFD7',
  },
  EINK_SLATE: {
    bg: '#252522',
    subText: '#9A978E',
    trackLine: '#3E3E39',
    orbShadow: '#0F172A',
    bubbleBg: '#32322E',
    bubbleBorder: '#4A4A44',
  },
};

// ==========================================
// 2. 主剧场组件：WhaleOrbTheater
// ==========================================
export const WhaleOrbTheater: React.FC<WhaleOrbTheaterProps> = ({
  theme = 'PAPER',
  voiceVolume,
  onVoiceLaunch,
  onVoiceCancel,
}) => {
  const palette = THEME_PALETTE[theme];

  // 核心状态机与渲染帧数据
  const [theaterState, setTheaterState] = useState<TheaterState>('PATROL');
  const [memeBubble, setMemeBubble] = useState<string | null>(null);

  // 高频物理引擎 Ref（避免闭包陈旧，60fps 丝滑驱动）
  const physicsRef = useRef({
    x: -20,                 // 球与角色组合中心点水平偏移 (-66 ~ +66)
    dir: 1 as 1 | -1,       // 1: 向右推, -1: 向左推
    orbAngle: 0,            // 球体滚动累積角度 (deg)
    fluidPhase: 0,          // 流光内部自转相位
    walkPhase: 0,           // 步伐正弦相位
    state: 'PATROL' as TheaterState,
    stateTimer: 0,          // 状态持续时间 (s)
    holdStartTime: 0,       // 按下时间戳
    orbJumpY: 0,            // 顶球发射时球的垂直位移
    whaleJumpY: 0,          // 角色跳跃垂直位移
    simVolume: 0.2,         // 模拟音量振幅
    pulseScale: 0,          // 发射脉冲光环扩散
  });

  // 用于触发 SVG 重绘的轻量帧计数器
  const [, setFrameTick] = useState(0);

  // 触发大肥鱼社区名梗小气泡
  const showMemeText = useCallback((text: string, duration = 1400) => {
    setMemeBubble(text);
    setTimeout(() => {
      setMemeBubble((prev) => (prev === text ? null : prev));
    }, duration);
  }, []);

  // ==========================================
  // 3. 60FPS 物理与程序化骨骼动画循环
  // ==========================================
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();

    const updatePhysics = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      const p = physicsRef.current;
      p.stateTimer += dt;
      p.fluidPhase += dt * 45;

      // 模拟或读取语音音量振幅
      if (p.state === 'LISTENING') {
        p.simVolume =
          voiceVolume !== undefined
            ? voiceVolume
            : 0.35 + 0.45 * Math.abs(Math.sin(now * 0.008)) * Math.cos(now * 0.003);
      } else {
        p.simVolume = 0;
      }

      switch (p.state) {
        case 'PATROL': {
          // 匀速推球巡游 + 真实角速度滚动 ω = v / R
          const dx = PATROL_SPEED * dt * p.dir;
          p.x += dx;
          p.orbAngle += (dx / ORB_RADIUS) * (180 / Math.PI);
          p.walkPhase += dt * 9.5; // 步频 1.5Hz
          p.orbJumpY = 0;
          p.whaleJumpY = -Math.abs(Math.sin(p.walkPhase)) * 3.8; // 迈步颠簸感

          // 到达左右轨道端点 -> 进入 State 02 边界换向
          if (p.x >= TRACK_LIMIT && p.dir === 1) {
            p.x = TRACK_LIMIT;
            p.state = 'TURNAROUND';
            p.stateTimer = 0;
            setTheaterState('TURNAROUND');
            if (Math.random() < 0.45) showMemeText('呼~ 推球好费 Token 呀💦', 900);
          } else if (p.x <= -TRACK_LIMIT && p.dir === -1) {
            p.x = -TRACK_LIMIT;
            p.state = 'TURNAROUND';
            p.stateTimer = 0;
            setTheaterState('TURNAROUND');
          }
          break;
        }

        case 'TURNAROUND': {
          // 0 ~ 0.35s 减速喘气，0.35 ~ 0.75s 原地小跳换向，0.75s 后反向继续推
          if (p.stateTimer < 0.35) {
            p.whaleJumpY = 0;
          } else if (p.stateTimer < 0.72) {
            const jumpProgress = (p.stateTimer - 0.35) / 0.37;
            p.whaleJumpY = -Math.sin(jumpProgress * Math.PI) * 14;
            // 在跳跃最高点翻转朝向
            if (jumpProgress > 0.48 && jumpProgress < 0.58) {
              // 翻转由外部渲染判断
            }
          } else {
            p.dir = (p.dir * -1) as 1 | -1;
            p.state = 'PATROL';
            p.stateTimer = 0;
            setTheaterState('PATROL');
          }
          break;
        }

        case 'LISTENING': {
          // 急刹停步，身体立正，球体微浮起呼吸
          p.whaleJumpY = 0;
          p.orbJumpY = -4 - Math.sin(now * 0.006) * 2.5;
          break;
        }

        case 'LAUNCH': {
          // State 04: 松手顶球发射 (0 ~ 0.9s)
          const t = p.stateTimer;
          if (t < 0.45) {
            const prog = t / 0.45;
            p.whaleJumpY = -Math.sin(prog * Math.PI) * 18; // 大肥鱼开心蹦起
            p.orbJumpY = -Math.sin(prog * Math.PI) * 32;   // 球被高高顶起
            p.pulseScale = prog * 2.4;                     // 发射流光脉冲
          } else if (t < 0.9) {
            const bounce = (t - 0.45) / 0.45;
            p.whaleJumpY = 0;
            p.orbJumpY = -Math.abs(Math.sin(bounce * Math.PI * 2)) * (1 - bounce) * 8;
            p.pulseScale = 0;
          } else {
            p.orbJumpY = 0;
            p.state = 'PATROL';
            p.stateTimer = 0;
            setTheaterState('PATROL');
          }
          break;
        }

        case 'CANCEL': {
          // State 05: 移出取消，歪头无辜 0.8s 后恢复推球
          p.orbJumpY = 0;
          p.whaleJumpY = 0;
          if (p.stateTimer > 0.85) {
            p.state = 'PATROL';
            p.stateTimer = 0;
            setTheaterState('PATROL');
          }
          break;
        }
      }

      setFrameTick((tick) => (tick + 1) % 10000);
      animationFrameId = requestAnimationFrame(updatePhysics);
    };

    animationFrameId = requestAnimationFrame(updatePhysics);
    return () => cancelAnimationFrame(animationFrameId);
  }, [voiceVolume, showMemeText]);

  // ==========================================
  // 4. 手势交互系统 (按住急刹 / 上滑取消 / 轻戳彩蛋)
  // ==========================================
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: () => {
        const p = physicsRef.current;
        p.holdStartTime = Date.now();
        p.state = 'LISTENING';
        p.stateTimer = 0;
        setTheaterState('LISTENING');
        showMemeText('竖起鱼鳍乖巧听你说~ 🎙️', 2500);
      },

      onPanResponderMove: (_, gestureState) => {
        const p = physicsRef.current;
        if (p.state === 'LISTENING') {
          // 手指上滑或移出超过 55dp 触发取消预备提示
          const dist = Math.hypot(gestureState.dx, gestureState.dy);
          if (gestureState.dy < -52 || dist > 85) {
            p.state = 'CANCEL';
            p.stateTimer = 0;
            setTheaterState('CANCEL');
            showMemeText('咦？不说了吗 (・_・?)', 1100);
            onVoiceCancel?.();
          }
        }
      },

      onPanResponderRelease: () => {
        const p = physicsRef.current;
        if (p.state !== 'LISTENING') return;

        const holdDuration = Date.now() - p.holdStartTime;
        if (holdDuration < 220) {
          // 轻点一下 (<220ms)：触发「摸鱼戳一戳」彩蛋，不发射语音
          p.state = 'LAUNCH';
          p.stateTimer = 0.15;
          setTheaterState('LAUNCH');
          showMemeText('别戳啦，按住流光球和我说话吧~ ✨', 1500);
        } else {
          // 正常松手：State 04 顶球发射新会话
          p.state = 'LAUNCH';
          p.stateTimer = 0;
          setTheaterState('LAUNCH');
          showMemeText('收到！顶球发射咯~ 🚀', 1200);
          onVoiceLaunch?.(holdDuration);
        }
      },

      onPanResponderTerminate: () => {
        const p = physicsRef.current;
        p.state = 'CANCEL';
        p.stateTimer = 0;
        setTheaterState('CANCEL');
      },
    })
  ).current;

  // ==========================================
  // 5. 计算角色与球体的实时骨骼变换参数
  // ==========================================
  const p = physicsRef.current;
  const centerX = STAGE_WIDTH / 2 + p.x;

  // 换向跳跃中途翻转朝向
  const effectiveDir =
    p.state === 'TURNAROUND' && p.stateTimer > 0.52
      ? ((p.dir * -1) as 1 | -1)
      : p.dir;

  // 球在前，大肥鱼在后推球（间距 44dp）
  const orbCenterX = centerX + effectiveDir * 28;
  const orbCenterY = GROUND_Y - ORB_RADIUS + p.orbJumpY;
  const whaleCenterX = centerX - effectiveDir * 26;
  const whaleBaseY = GROUND_Y + p.whaleJumpY;

  // 关节角度计算 (deg)
  const isListening = p.state === 'LISTENING';
  const isLaunch = p.state === 'LAUNCH';
  const isCancel = p.state === 'CANCEL';

  // 鱼鳍耳角度：倾听时“啪”地竖起 (+28°)，取消时耷拉 (-18°)，平时随步伐轻颤
  const finEarAngle = isListening
    ? -26
    : isCancel
    ? 18
    : Math.sin(p.walkPhase - 0.4) * 6;

  // 呆毛角度：滞后弹性摆动
  const ahogeAngle = isListening
    ? -12
    : Math.cos(p.walkPhase - 0.9) * 10;

  // 鲸鱼大尾巴摇摆角度
  const tailAngle = isListening
    ? Math.sin(p.fluidPhase * 0.15) * 5
    : isLaunch
    ? Math.sin(p.stateTimer * 28) * 22
    : Math.sin(p.walkPhase - 0.6) * 14;

  // 小短腿迈步角度
  const legStride =
    p.state === 'PATROL' ? Math.sin(p.walkPhase) * 20 : 0;

  // 身体前倾角：推球时前倾 11°，倾听时立正 0°，取消时歪头 -8°
  const bodyLean = isListening ? 0 : isCancel ? -7 : 10;

  // 球体缩放与声波半径
  const orbScale = isListening
    ? 1.14 + p.simVolume * 0.08
    : isLaunch && p.stateTimer < 0.2
    ? 1.08
    : 1.0;

  return (
    <View
      style={[
        styles.theaterContainer,
        { backgroundColor: palette.bg },
      ]}
      {...panResponder.panHandlers}
    >
      {/* 顶部微缩提示气泡（社区大肥鱼台词/状态反馈） */}
      <View style={styles.statusHeader}>
        {memeBubble ? (
          <View
            style={[
              styles.memeBubble,
              {
                backgroundColor: palette.bubbleBg,
                borderColor: palette.bubbleBorder,
              },
            ]}
          >
            <Text style={[styles.memeText, { color: palette.subText }]}>
              {memeBubble}
            </Text>
          </View>
        ) : (
          <Text style={[styles.hintText, { color: palette.subText }]}>
            {theaterState === 'LISTENING'
              ? '正在倾听 · 松手发送 / 上滑取消'
              : '按住大肥鱼或流光球 · 发起语音指令'}
          </Text>
        )}
      </View>

      {/* 核心 SVG 舞台画布 (396 × 234) */}
      <Svg
        width={STAGE_WIDTH}
        height={STAGE_HEIGHT}
        viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
      >
        <Defs>
          {/* 1. 大肥鱼渐变蓝长发 (深海蓝 -> 浅海青蓝) */}
          <LinearGradient id="whaleHairGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#2B4470" />
            <Stop offset="65%" stopColor="#436FA3" />
            <Stop offset="100%" stopColor="#7CC0E8" />
          </LinearGradient>

          {/* 2. 鲸鱼尾与胸鳍耳深海蓝渐变 */}
          <LinearGradient id="whaleFinGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#283B63" />
            <Stop offset="100%" stopColor="#527FB0" />
          </LinearGradient>

          {/* 3. 全息流光语音球基底渐变 */}
          <RadialGradient id="orbBaseGrad" cx="35%" cy="30%" r="70%">
            <Stop offset="0%" stopColor="#F0F9FF" stopOpacity="0.95" />
            <Stop offset="45%" stopColor="#7DD3FC" stopOpacity="0.82" />
            <Stop offset="80%" stopColor="#6366F1" stopOpacity="0.88" />
            <Stop offset="100%" stopColor="#312E81" stopOpacity="0.92" />
          </RadialGradient>

          {/* 4. 球内流光丝绸切片 A (青蓝极光) */}
          <LinearGradient id="fluidCyan" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#22D3EE" stopOpacity="0.85" />
            <Stop offset="100%" stopColor="#3B82F6" stopOpacity="0.2" />
          </LinearGradient>

          {/* 5. 球内流光丝绸切片 B (星云粉紫) */}
          <LinearGradient id="fluidPurple" x1="1" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#F472B6" stopOpacity="0.75" />
            <Stop offset="50%" stopColor="#A855F7" stopOpacity="0.65" />
            <Stop offset="100%" stopColor="#38BDF8" stopOpacity="0.15" />
          </LinearGradient>

          {/* 语音球圆形裁剪蒙版 */}
          <ClipPath id="orbClip">
            <Circle cx="0" cy="0" r={ORB_RADIUS} />
          </ClipPath>
        </Defs>

        {/* ================= 背景漫反射轨道基线 ================= */}
        <Path
          d={`M 44 ${GROUND_Y} L ${STAGE_WIDTH - 44} ${GROUND_Y}`}
          stroke={palette.trackLine}
          strokeWidth="1.5"
          strokeDasharray="5,5"
        />
        {/* 轨道两端精致止动锚点 */}
        <Circle cx={44} cy={GROUND_Y} r={2.5} fill={palette.trackLine} />
        <Circle cx={STAGE_WIDTH - 44} cy={GROUND_Y} r={2.5} fill={palette.trackLine} />

        {/* ================= 地面漫反射柔和阴影 ================= */}
        {/* 大肥鱼脚底阴影 */}
        <Ellipse
          cx={whaleCenterX}
          cy={GROUND_Y + 3}
          rx={26 * (1 - Math.abs(p.whaleJumpY) * 0.015)}
          ry={5.5}
          fill={palette.orbShadow}
          opacity={theme === 'PAPER' ? 0.22 : 0.45}
        />
        {/* 流光球透光彩影 */}
        <Ellipse
          cx={orbCenterX}
          cy={GROUND_Y + 3}
          rx={24 * orbScale * (1 - Math.abs(p.orbJumpY) * 0.012)}
          ry={6}
          fill={isListening ? '#38BDF8' : palette.orbShadow}
          opacity={isListening ? 0.38 : theme === 'PAPER' ? 0.28 : 0.55}
        />

        {/* ========================================================
            主体 A：蓝色大肥鱼（Q版鲸鱼小女仆 11层可动骨骼）
           ======================================================== */}
        <G
          transform={`translate(${whaleCenterX}, ${whaleBaseY}) scale(${effectiveDir}, 1) rotate(${bodyLean})`}
        >
          {/* L01: 肥嘟嘟鲸鱼大尾巴 (锚点在臀部后方，随步伐Q弹摇摆) */}
          <G transform={`translate(-18, -24) rotate(${tailAngle})`}>
            <Path
              d="M 4 0 C -18 -2, -36 -14, -44 -28 C -49 -36, -58 -38, -56 -29 C -53 -20, -45 -14, -45 -14 C -45 -14, -57 -12, -59 -4 C -61 4, -48 6, -38 -2 C -26 6, -8 10, 4 6 Z"
              fill="url(#whaleFinGrad)"
              stroke="#1E293B"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            {/* 尾巴腹部浅灰蓝高光肚皮 */}
            <Path
              d="M 0 3 C -14 6, -28 2, -36 -6"
              stroke="#93C5FD"
              strokeWidth="2.5"
              strokeLinecap="round"
              fill="none"
              opacity="0.55"
            />
          </G>

          {/* L02: 后脑勺渐变波浪长发底图 */}
          <Path
            d="M -26 -58 C -36 -40, -38 -15, -28 -8 C -20 -4, -22 -18, -14 -14 C -6 -10, 12 -12, 20 -18 C 28 -26, 26 -46, 18 -60 Z"
            fill="url(#whaleHairGrad)"
            stroke="#1E293B"
            strokeWidth="2.2"
          />

          {/* L03: 远端鲸鱼胸鳍耳 */}
          <G transform={`translate(16, -68) rotate(${-finEarAngle * 0.8})`}>
            <Path
              d="M 0 0 C 12 -6, 26 -2, 30 6 C 22 10, 10 10, 0 6 Z"
              fill="#334E7B"
              stroke="#1E293B"
              strokeWidth="2"
            />
          </G>

          {/* L04 & L05: 交替迈步的圆头小皮鞋与白袜小短腿 */}
          {/* 远端腿 */}
          <G transform={`translate(6, -14) rotate(${-legStride})`}>
            <Path
              d="M -4 0 L -4 10 C -4 14, 5 14, 5 10 L 5 0 Z"
              fill="#FFFFFF"
              stroke="#1E293B"
              strokeWidth="2"
            />
            <Ellipse cx="1" cy="11" rx="6.5" ry="4.2" fill="#1E293B" />
            <Ellipse cx="3" cy="10" rx="2" ry="1" fill="#FFFFFF" opacity="0.7" />
          </G>
          {/* 近端腿 */}
          <G transform={`translate(-8, -14) rotate(${legStride})`}>
            <Path
              d="M -5 0 L -5 10 C -5 14, 4 14, 4 10 L 4 0 Z"
              fill="#FFFFFF"
              stroke="#1E293B"
              strokeWidth="2"
            />
            <Ellipse cx="0" cy="11" rx="6.5" ry="4.2" fill="#1E293B" />
            <Ellipse cx="2" cy="10" rx="2" ry="1" fill="#FFFFFF" opacity="0.7" />
          </G>

          {/* L06: 深海藏青女仆蓬蓬裙 + 白色荷叶边围裙 (印有小鲸鱼徽标) */}
          <G transform="translate(0, -28)">
            {/* 裙摆 */}
            <Path
              d="M -16 -14 L 16 -14 C 24 -2, 28 10, 24 16 C 10 20, -12 20, -24 16 C -28 10, -22 -2, -16 -14 Z"
              fill="#1E2B48"
              stroke="#1E293B"
              strokeWidth="2.2"
            />
            {/* 裙底白色荷叶花边 */}
            <Path
              d="M -23 15 Q -16 20, -10 16 Q -3 21, 4 16 Q 11 21, 18 16 Q 22 19, 25 15"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            {/* 白色圆润女仆围裙 */}
            <Path
              d="M -10 -12 L 12 -12 C 16 -2, 16 11, 10 14 C 2 17, -6 16, -12 13 C -16 8, -14 -2, -10 -12 Z"
              fill="#FFFFFF"
              stroke="#1E293B"
              strokeWidth="1.8"
            />
            {/* 围裙右下角：标志性小鲸鱼 Logo (还原参考图2细节) */}
            <Circle cx="5" cy="8" r="3.2" fill="#283B63" />
            <Path d="M 1.5 8 L -1.5 6 L -1.5 10 Z" fill="#283B63" />
            {/* 胸前深蓝女仆蝴蝶结 */}
            <Path
              d="M 2 -13 L -4 -17 L -4 -9 Z M 2 -13 L 8 -17 L 8 -9 Z"
              fill="#2B4470"
              stroke="#1E293B"
              strokeWidth="1.5"
            />
            <Circle cx="2" cy="-13" r="2" fill="#93C5FD" />
          </G>

          {/* L07: Q版二头身圆润大脑袋 + 渐变刘海 + 白色荷叶边女仆发箍 */}
          <G transform="translate(0, -68)">
            {/* 头顶灵魂呆毛 (Ahoge) */}
            <G transform={`translate(-2, -28) rotate(${ahogeAngle})`}>
              <Path
                d="M 0 2 C -4 -12, 8 -20, 18 -14 C 10 -12, 4 -6, 2 2 Z"
                fill="#3B5998"
                stroke="#1E293B"
                strokeWidth="2"
              />
            </G>

            {/* 白色荷叶边女仆发箍 (Maid Headband) */}
            <Path
              d="M -24 -12 C -18 -28, 18 -28, 24 -12 C 18 -22, -18 -22, -24 -12 Z"
              fill="#FFFFFF"
              stroke="#1E293B"
              strokeWidth="2.5"
            />
            <Path
              d="M -22 -14 Q -15 -24, -8 -18 Q 0 -26, 8 -18 Q 15 -24, 22 -14"
              fill="#FFFFFF"
              stroke="#1E293B"
              strokeWidth="2"
            />

            {/* 后发髻与圆润脸庞 */}
            <Circle
              cx="0"
              cy="0"
              r="24"
              fill="#FFF5EE"
              stroke="#1E293B"
              strokeWidth="2.2"
            />

            {/* 粉扑扑腮红 */}
            <Ellipse cx="-11" cy="7" rx="4.8" ry="2.6" fill="#FDA4AF" opacity="0.65" />
            <Ellipse cx="15" cy="7" rx="4.2" ry="2.4" fill="#FDA4AF" opacity="0.65" />

            {/* ================= L08: 五态表情包切换层 ================= */}
            {isLaunch ? (
              // State 04: 顶球发射开心弯月笑眼 (> ▽ <)
              <G>
                <Path
                  d="M -12 0 Q -7 -5, -2 0"
                  stroke="#1E293B"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  fill="none"
                />
                <Path
                  d="M 8 0 Q 13 -5, 18 0"
                  stroke="#1E293B"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  fill="none"
                />
                {/* 开心张嘴笑 */}
                <Path
                  d="M 0 6 L 6 6 C 6 12, 0 12, 0 6 Z"
                  fill="#FB7185"
                  stroke="#1E293B"
                  strokeWidth="1.8"
                />
              </G>
            ) : isCancel ? (
              // State 05: 社区经典摸鱼呆滞豆豆眼 (・_・?)
              <G>
                <Circle cx="-7" cy="1" r="2.6" fill="#1E293B" />
                <Circle cx="13" cy="1" r="2.6" fill="#1E293B" />
                <Circle cx="3" cy="8" r="2" fill="#1E293B" />
                {/* 头顶小问号 */}
                <Text
                  x="18"
                  y="-28"
                  fill="#3B82F6"
                  fontSize="16"
                  fontWeight="bold"
                >
                  ?
                </Text>
              </G>
            ) : (
              // State 01/02/03: 深海蓝水汪汪大眼睛 (倾听时放大闪烁星星高光)
              <G>
                {/* 左眼 (近端) */}
                <Ellipse
                  cx="-7"
                  cy="1"
                  rx={isListening ? 5.8 : 5.2}
                  ry={isListening ? 6.8 : 6.0}
                  fill="#1E3A8A"
                />
                <Ellipse cx="-7" cy="2.5" rx="4" ry="3.5" fill="#60A5FA" />
                <Circle cx="-8.5" cy="-1.5" r={isListening ? 2.4 : 2.0} fill="#FFFFFF" />
                <Circle cx="-5" cy="3.5" r="1.1" fill="#FFFFFF" />

                {/* 右眼 (远端 3/4 透视略窄) */}
                <Ellipse
                  cx="13"
                  cy="1"
                  rx={isListening ? 5.0 : 4.5}
                  ry={isListening ? 6.6 : 5.8}
                  fill="#1E3A8A"
                />
                <Ellipse cx="13" cy="2.5" rx="3.4" ry="3.3" fill="#60A5FA" />
                <Circle cx="11.5" cy="-1.5" r={isListening ? 2.2 : 1.8} fill="#FFFFFF" />

                {/* 嘴巴：倾听时乖巧微张小圆嘴，推球时元气开心笑 */}
                {isListening ? (
                  <Circle
                    cx="3"
                    cy="8.5"
                    r="2.5"
                    fill="#FB7185"
                    stroke="#1E293B"
                    strokeWidth="1.6"
                  />
                ) : (
                  <Path
                    d="M -0.5 6.5 C -0.5 11.5, 6.5 11.5, 6.5 6.5 Z"
                    fill="#FB7185"
                    stroke="#1E293B"
                    strokeWidth="1.6"
                  />
                )}
              </G>
            )}

            {/* 前额渐变蓝刘海 */}
            <Path
              d="M -24 -6 C -22 -22, 22 -22, 24 -6 C 18 -14, 12 -4, 8 -10 C 4 -2, -4 -2, -8 -10 C -14 -2, -20 -12, -24 -6 Z"
              fill="url(#whaleHairGrad)"
              stroke="#1E293B"
              strokeWidth="2"
              strokeLinejoin="round"
            />

            {/* L09: 近端鲸鱼胸鳍耳 + 浅蓝色蝴蝶结 (核心情绪机关：按住立刻竖起！) */}
            <G transform={`translate(-18, -4) rotate(${finEarAngle})`}>
              {/* 鲸鱼鳍耳本体 */}
              <Path
                d="M 0 0 C -14 -6, -30 -2, -36 8 C -26 14, -12 12, 0 6 Z"
                fill="url(#whaleFinGrad)"
                stroke="#1E293B"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              {/* 鳍耳下沿白色波浪褶边 */}
              <Path
                d="M -32 8 Q -24 13, -16 9 Q -8 12, -2 6"
                fill="none"
                stroke="#E0F2FE"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              {/* 右耳标志性浅蓝色小蝴蝶结 (参考图2核心特征) */}
              <G transform="translate(-4, -3) rotate(-15)">
                <Path
                  d="M 0 0 L -7 -5 L -6 4 Z M 0 0 L 7 -4 L 5 5 Z"
                  fill="#7DD3FC"
                  stroke="#1E293B"
                  strokeWidth="1.6"
                />
                <Circle cx="0" cy="0" r="2.2" fill="#BAE6FD" stroke="#1E293B" strokeWidth="1.2" />
              </G>
            </G>

            {/* State 02 边界换向专属：摸鱼流汗水滴彩蛋 */}
            {p.state === 'TURNAROUND' && (
              <Path
                d="M -24 -16 C -26 -10, -20 -10, -22 -16 Z"
                fill="#38BDF8"
                stroke="#1E293B"
                strokeWidth="1.2"
              />
            )}
          </G>

          {/* L10: 推球圆润小手 (按住时收回胸前乖巧听讲，推球时向前抵住球面) */}
          <G
            transform={
              isListening
                ? 'translate(8, -36) rotate(-25)'
                : isLaunch
                ? 'translate(14, -52) rotate(-55)'
                : 'translate(16, -38) rotate(8)'
            }
          >
            <Path
              d="M -6 -4 L 8 -2 C 11 -2, 11 5, 8 5 L -6 4 Z"
              fill="#1E2B48"
              stroke="#1E293B"
              strokeWidth="2"
            />
            {/* 白色荷叶袖口与圆拳头 */}
            <Circle
              cx="9"
              cy="1.5"
              r="5"
              fill="#FFF5EE"
              stroke="#1E293B"
              strokeWidth="2"
            />
          </G>
        </G>

        {/* ========================================================
            主体 B：全息流光玻璃语音球 (Iridescent Voice Orb)
           ======================================================== */}
        <G
          transform={`translate(${orbCenterX}, ${orbCenterY}) scale(${orbScale})`}
        >
          {/* 1. 录音态外圈同心声波涟漪 (State 03 专属) */}
          {isListening && (
            <G>
              <Circle
                cx="0"
                cy="0"
                r={ORB_RADIUS + 8 + p.simVolume * 18}
                fill="none"
                stroke="#38BDF8"
                strokeWidth="1.8"
                opacity={0.45 - p.simVolume * 0.2}
              />
              <Circle
                cx="0"
                cy="0"
                r={ORB_RADIUS + 4 + p.simVolume * 9}
                fill="none"
                stroke="#A855F7"
                strokeWidth="1.2"
                opacity="0.35"
              />
            </G>
          )}

          {/* 2. 松手顶球发射脉冲光环 (State 04 专属) */}
          {p.pulseScale > 0 && (
            <Circle
              cx="0"
              cy="0"
              r={ORB_RADIUS * (1 + p.pulseScale * 0.5)}
              fill="none"
              stroke="#38BDF8"
              strokeWidth="2.5"
              opacity={Math.max(0, 1 - p.pulseScale * 0.45)}
            />
          )}

          {/* 3. 球体内部全息流光层 (受 ClipPath 裁剪，随前进位移真实旋转 ω = v/R) */}
          <G clipPath="url(#orbClip)">
            {/* 玻璃球柔光底色 */}
            <Circle cx="0" cy="0" r={ORB_RADIUS} fill="url(#orbBaseGrad)" />

            {/* 随球滚动的液态丝绸光瓣层 A */}
            <G transform={`rotate(${p.orbAngle + p.fluidPhase})`}>
              <Path
                d="M -34 -10 C -15 -38, 25 -25, 34 5 C 18 36, -22 28, -34 -10 Z"
                fill="url(#fluidCyan)"
              />
              <Ellipse
                cx="8"
                cy="-10"
                rx={24 + p.simVolume * 8}
                ry={16 + p.simVolume * 6}
                fill="url(#fluidPurple)"
              />
            </G>

            {/* 反向慢速交织的全息丝绸光瓣层 B (制造多层折射感) */}
            <G transform={`rotate(${-p.orbAngle * 0.7 - p.fluidPhase * 0.6})`}>
              <Path
                d="M -28 18 C -32 -18, 12 -34, 30 -8 C 36 22, -10 34, -28 18 Z"
                fill="url(#fluidPurple)"
                opacity="0.75"
              />
              <Circle
                cx="-10"
                cy="8"
                r={16 + p.simVolume * 10}
                fill="#E0F2FE"
                opacity="0.45"
              />
            </G>
          </G>

          {/* 4. 固定不转的菲涅尔玻璃高光环与清透反光点 (衬托内部流体滚动) */}
          <Circle
            cx="0"
            cy="0"
            r={ORB_RADIUS - 0.8}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="1.8"
            opacity={theme === 'PAPER' ? 0.85 : 0.6}
          />
          {/* 左上角 45° 弯月玻璃高光 */}
          <Path
            d="M -21 -14 A 26 26 0 0 1 8 -25 A 24 22 0 0 0 -18 -8 Z"
            fill="#FFFFFF"
            opacity="0.75"
          />
          <Circle cx="-20" cy="-6" r="2.2" fill="#FFFFFF" opacity="0.65" />
        </G>
      </Svg>
    </View>
  );
};

// ==========================================
// 6. 样式定义（严守 396dp × 234dp 容器边界）
// ==========================================
const styles = StyleSheet.create({
  theaterContainer: {
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    alignSelf: 'center',
    justifyContent: 'space-between',
    userSelect: 'none',
  },
  statusHeader: {
    position: 'absolute',
    top: 14,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  hintText: {
    fontSize: 12,
    letterSpacing: 0.6,
    opacity: 0.75,
    fontWeight: '500',
  },
  memeBubble: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  memeText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

export default WhaleOrbTheater;