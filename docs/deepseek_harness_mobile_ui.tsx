import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  GitBranch,
  Check,
  X,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Cpu,
  Clock,
  ShieldAlert,
  FileCode,
  Play,
  Square,
  Mic,
  Send,
  Layers,
  ListTree,
  Smartphone,
  Sun,
  Moon,
  Sparkles,
  CornerDownRight,
  Eye,
  RotateCcw,
  SlidersHorizontal,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowUpRight,
  FolderGit2,
  Command,
  Maximize2,
  Minimize2,
  Disc,
  FileText,
  Undo2,
  WrapText,
  Bookmark,
  ShieldCheck,
  Zap,
  Lock
} from 'lucide-react';

// --- Mock Data ---
const INITIAL_TASKS = [
  {
    id: 't-101',
    shortCode: '01',
    repo: 'deepseek-harness/core',
    branch: 'feat/mcp-stdio-pool',
    title: '重构 MCP 连接池并修复偶发超时',
    model: 'DeepSeek-R1',
    status: 'awaiting_approval', // awaiting_approval | running | completed
    elapsed: '1m 42s',
    tokens: '14.2k',
    contextPct: 22,
    checkpointId: 'cp-8f91a',
    cost: '$0.018',
    reasoningSummary: '定位到 stdio 管道在高并发工具调用下存在未释放的僵尸子进程，需引入优雅降级与 5s 强制回收锁。',
    reasoningFull: [
      '1. 检查 `src/mcp/pool.rs` 中的 `ChildProcess` 生命周期管理。',
      '2. 发现当远端 Tool 返回非标准 JSON-RPC 错误时，`rx.recv()` 挂起导致句柄泄漏。',
      '3. 对比两种修复方案：方案 A 在外层加 `tokio::time::timeout`；方案 B 在 Drop trait 中注入 `kill_on_drop(true)`。',
      '4. 决定同时采用两者，并先修改 `pool.rs` 写入补丁，随后运行单元测验验证。'
    ],
    finalAnswer: {
      headline: '已完成根因定位并生成连接池防泄漏补丁，待你批准写入。',
      summary: '在 `src/mcp/pool.rs` 中，当子进程异常挂起时原有的 `Stdio::piped()` 未绑定生命周期销毁钩子。我已准备好如下两处核心修改：',
      bullets: [
        '注入 `kill_on_drop(true)`：确保连接池实例被 Drop 或超时取消时，操作系统内核立即回收关联的 `ChildProcess` 句柄。',
        '新增 `timeout_dur` 兜底：默认读取服务配置的 `timeout_secs`（缺省 15s），防止单次慢调用拖垮整个并发工作池。'
      ],
      nextAction: '批准下方 `src/mcp/pool.rs` 补丁后，我将自动运行 `pool_lifecycle` 集成测试并汇报结果。'
    },
    steps: [
      { id: 's1', type: 'read', label: 'Read src/mcp/pool.rs (lines 1-140)', status: 'done', time: '0.4s' },
      { id: 's2', type: 'search', label: 'Grep "kill_on_drop" in src/', status: 'done', time: '0.2s' },
      { id: 's2b', type: 'read', label: 'Read tests/pool_lifecycle.rs', status: 'done', time: '0.3s' },
      {
        id: 's3',
        type: 'patch',
        label: 'Apply patch to src/mcp/pool.rs',
        status: 'pending',
        risk: 'medium', // low | medium | high
        scopeRule: 'allow: src/mcp/[*][*] · Rust Patch',
        file: 'src/mcp/pool.rs',
        additions: 14,
        deletions: 3,
        diff: [
          { id: 'd1', type: 'ctx', lineOld: 48, lineNew: 48, code: 'let mut cmd = Command::new(&server.bin);' },
          { id: 'd2', type: 'del', lineOld: 49, lineNew: null, code: 'cmd.stdin(Stdio::piped()).stdout(Stdio::piped());' },
          {
            id: 'd3',
            type: 'add',
            lineOld: null,
            lineNew: 49,
            code: 'cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).kill_on_drop(true);'
          },
          { id: 'd4', type: 'ctx', lineOld: 50, lineNew: 50, code: 'let child = cmd.spawn().map_err(Error::Spawn)?;' },
          {
            id: 'd5',
            type: 'add',
            lineOld: null,
            lineNew: 51,
            code: 'let timeout_dur = Duration::from_secs(server.timeout_secs.unwrap_or(15));'
          }
        ],
        commandPreview: 'cargo test --package deepseek-mcp --test pool_lifecycle'
      },
      { id: 's4', type: 'bash', label: 'Run cargo test --test pool_lifecycle', status: 'queued', time: '-' }
    ]
  },
  {
    id: 't-102',
    shortCode: '02',
    repo: 'deepseek-harness/mobile-ios',
    branch: 'fix/haptic-feedback',
    title: '优化底部审批抽屉阻尼与触觉反馈',
    model: 'DeepSeek-V3',
    status: 'running',
    elapsed: '0m 38s',
    tokens: '6.8k',
    contextPct: 11,
    checkpointId: 'cp-3c12e',
    cost: '$0.004',
    reasoningSummary: '正在扫描 GestureDetector 阈值参数，准备将触发审批的滑动距离统一为 72pt。',
    reasoningFull: [
      '1. 分析 `BottomDockView.swift` 中的 `DragGesture(minimumDistance: 12)`。',
      '2. 调整弹性动画阻尼系数 `response: 0.32, dampingFraction: 0.86`。'
    ],
    finalAnswer: {
      headline: '已完成手势阻尼曲线校准，全部触觉反馈点位均已对齐。',
      summary: '已将 `BottomDockView.swift` 的抽屉展开阈值统一锁定在 `72pt`，消除了快速上滑时的二次回弹抖动：',
      bullets: [
        '临界点触觉：跨越 72pt 阻尼线时触发一次轻柔的 `UIImpactFeedbackGenerator(.light)`。',
        '帧率表现：在 ProMotion 120Hz 下手势跟随延迟低于 4.2ms。'
      ],
      nextAction: '无需额外人工审批，你可随时在右侧切回主仓库继续工作。'
    },
    steps: [
      { id: 's21', type: 'read', label: 'Read UI/Components/BottomDockView.swift', status: 'done', time: '0.3s' },
      { id: 's22', type: 'search', label: 'Grep "UIImpactFeedbackGenerator" in UI/', status: 'done', time: '0.2s' },
      { id: 's23', type: 'think', label: 'Verify spring physics curve parameters', status: 'done', time: '0.6s' }
    ]
  },
  {
    id: 't-103',
    shortCode: '03',
    repo: 'deepseek-harness/cli',
    branch: 'main',
    title: '生成 v0.4.2 变更日志与二进制签名',
    model: 'DeepSeek-V3',
    status: 'completed',
    elapsed: '2m 10s',
    tokens: '19.4k',
    contextPct: 31,
    checkpointId: 'cp-9a40b',
    cost: '$0.009',
    reasoningSummary: '已完成全部 12 个 Commit 的归类并通过 SHA256 校验。',
    reasoningFull: [
      '1. 提取 v0.4.1..HEAD 之间的提交记录。',
      '2. 写入 CHANGELOG.md 并执行 cargo build --release。'
    ],
    finalAnswer: {
      headline: 'v0.4.2 变更日志与 Release 产物签名已全部就绪。',
      summary: '所有推理与连续 3 步工具调用已自动折叠归档，以下为本次发布的核心产出摘要：',
      bullets: [
        '版本亮点：涵盖 MCP 连接池重构、流式 `<think>` 解析器零拷贝优化等 12 项提交。',
        '构建校验：`target/release/ds-harness` 二进制体积 8.4MB，SHA256 校验签名已写入 `CHANGELOG.md`。'
      ],
      nextAction: '可直接在终端执行 `git push --follow-tags` 发布正式版。'
    },
    steps: [
      { id: 's31', type: 'bash', label: 'git log v0.4.1..HEAD --oneline', status: 'done', time: '0.2s' },
      { id: 's32', type: 'patch', label: 'Update CHANGELOG.md (+38, -0)', status: 'done', time: '0.5s' },
      { id: 's33', type: 'bash', label: 'sha256sum target/release/ds-harness', status: 'done', time: '0.4s' }
    ]
  },
  {
    id: 't-104',
    shortCode: '04',
    repo: 'deepseek-harness/router',
    branch: 'feat/r1-stream-parser',
    title: '流式 XML <think> 标签零拷贝解析器',
    model: 'DeepSeek-R1',
    status: 'awaiting_approval',
    elapsed: '0m 54s',
    tokens: '9.1k',
    contextPct: 15,
    checkpointId: 'cp-4d02f',
    cost: '$0.011',
    reasoningSummary: '使用状态机替代正则匹配，消除跨 Chunk 边界拆分 <think> 标签时的内存重分配。',
    reasoningFull: [
      '1. 审查 `src/parser/chunk_fsm.rs` 中的跨包缓冲逻辑。',
      '2. 将 String 拼接改为基于 `Bytes` 切片的零拷贝游标。',
      '3. 请求写入基准测试 `benches/stream_bench.rs` 验证吞吐提升。'
    ],
    finalAnswer: {
      headline: '已用零拷贝状态机重构 `<think>` 解析器，内存分配下降 82%。',
      summary: '移除了原先每次收到 SSE chunk 都执行 `String::from_utf8_lossy` 的高开销路径：',
      bullets: [
        '零拷贝游标：直接基于 `Bytes` 引用计数切片识别 `<think>` 与 `</think>` 边界。',
        '边界安全：完美处理标签被截断在两个 TCP 包之间的极端情况。'
      ],
      nextAction: '请审批下方 `chunk_fsm.rs` 补丁以运行吞吐量基准测试。'
    },
    steps: [
      { id: 's41', type: 'read', label: 'Read src/parser/chunk_fsm.rs', status: 'done', time: '0.2s' },
      { id: 's41b', type: 'search', label: 'Grep "from_utf8_lossy" in src/parser/', status: 'done', time: '0.1s' },
      {
        id: 's42',
        type: 'patch',
        label: 'Apply patch to src/parser/chunk_fsm.rs',
        status: 'pending',
        risk: 'low',
        scopeRule: 'allow: src/parser/[*][*] · Zero Side-Effect',
        file: 'src/parser/chunk_fsm.rs',
        additions: 22,
        deletions: 9,
        diff: [
          { id: 'd41', type: 'ctx', lineOld: 19, lineNew: 19, code: 'pub fn feed_chunk(&mut self, buf: &[u8]) -> ParseEvent {' },
          { id: 'd42', type: 'del', lineOld: 20, lineNew: null, code: '    let s = String::from_utf8_lossy(buf).into_owned();' },
          { id: 'd43', type: 'add', lineOld: null, lineNew: 20, code: '    let slice = Bytes::copy_from_slice(buf);' },
          { id: 'd44', type: 'add', lineOld: null, lineNew: 21, code: '    self.cursor.advance_zero_copy(slice)' }
        ],
        commandPreview: 'cargo bench --bench stream_bench'
      }
    ]
  },
  {
    id: 't-105',
    shortCode: '05',
    repo: 'deepseek-harness/sandbox',
    branch: 'sec/landlock-rules',
    title: '收紧 Linux Landlock 文件系统只读白名单',
    model: 'DeepSeek-R1',
    status: 'awaiting_approval',
    elapsed: '1m 15s',
    tokens: '11.6k',
    contextPct: 48,
    checkpointId: 'cp-77e1c',
    cost: '$0.014',
    reasoningSummary: '准备清理 `/tmp/ds-legacy-*` 旧沙盒残留并收紧 ABI v3 权限掩码，包含高风险递归删除指令。',
    reasoningFull: [
      '1. 读取 `src/sandbox/landlock.rs` 的规则集初始化函数。',
      '2. 移除对 `$HOME/.ssh` 与 `$HOME/.aws` 的隐式继承。',
      '3. 准备执行 `rm -rf /tmp/ds-legacy-*` 并跑隔离集成测试。'
    ],
    finalAnswer: {
      headline: 'Landlock ABI v3 沙盒白名单已就绪，含高危清理命令需长按确认。',
      summary: '已封堵工具子进程对宿主机敏感凭证目录的读取权限，同时请求清理旧版残留挂载点：',
      bullets: [
        '最小权限集：仅向 MCP 工具开放当前 Git 仓库工作区与独立挂载点。',
        '高风险保护：因包含 `rm -rf` 指令，底部拇指坞已自动切换为「长按充能防误触模式」。'
      ],
      nextAction: '请长按底部审批按钮 0.6s 放行，或左滑直接跳至下一项待办。'
    },
    steps: [
      { id: 's51', type: 'read', label: 'Read src/sandbox/landlock.rs', status: 'done', time: '0.3s' },
      {
        id: 's52',
        type: 'bash',
        label: 'rm -rf /tmp/ds-legacy-* && cargo test --test landlock',
        status: 'pending',
        risk: 'high',
        scopeRule: 'HIGH RISK: destructive shell (rm -rf)',
        file: 'scripts/cleanup_sandbox.sh',
        additions: 4,
        deletions: 1,
        diff: [
          { id: 'd51', type: 'del', lineOld: 12, lineNew: null, code: 'rm -f /tmp/ds-legacy.lock' },
          { id: 'd52', type: 'add', lineOld: null, lineNew: 12, code: 'rm -rf /tmp/ds-legacy-* && cargo test --test landlock' }
        ],
        commandPreview: 'rm -rf /tmp/ds-legacy-* && cargo test --test landlock'
      }
    ]
  }
];

export default function App() {
  // Scheme: 'A' (Main Stream + Micro-interactions) | 'B' (Triage Stack) | 'C' (Split HUD Matrix)
  const [scheme, setScheme] = useState('A');
  // Theme: 'paper' (Warm Stone Paper) | 'eink_slate' (Soft Warm E-Ink Slate)
  const [theme, setTheme] = useState('paper');
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [activeTaskId, setActiveTaskId] = useState('t-101');

  // --- Lifecycle & Auto-Collapse States ---
  const [streamPhase, setStreamPhase] = useState('settled');
  const [typedThinkChars, setTypedThinkChars] = useState(999);
  const [activeToolIdx, setActiveToolIdx] = useState(99);
  const [typedAnswerChars, setTypedAnswerChars] = useState(999);

  // Manual user toggles when inspecting collapsed sections
  const [expandedThink, setExpandedThink] = useState(false);
  const [expandedToolsGroup, setExpandedToolsGroup] = useState(false);
  const [expandedDiff, setExpandedDiff] = useState(true);

  // Expandable Thumb Dock into Scheme B Focus Card
  const [dockExpanded, setDockExpanded] = useState(false);
  // Right-edge Camera-Lens / Radial Arc Session Dial state
  const [arcDialOpen, setArcDialOpen] = useState(false);
  const [hoveredTaskId, setHoveredTaskId] = useState(null);
  const [isDraggingDial, setIsDraggingDial] = useState(false);
  const phoneRef = useRef(null);

  // --- NEW Refined UX Features from Industry Research ---
  // 1. Mobile Semantic Diff Word-Wrap & Inline Line-Tap Quote
  const [diffWordWrap, setDiffWordWrap] = useState(true);
  const [quotedDiffLine, setQuotedDiffLine] = useState(null);
  // 2. Scoped Trust Toggle ("Allow for this session / directory")
  const [scopedAutoApprove, setScopedAutoApprove] = useState(false);
  // 3. Risk-Graded Hold-to-Approve Progress (for High-Risk commands)
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = useRef(null);
  // 4. 4-Second Grace Undo & Checkpoint Rewind Banner
  const [undoBanner, setUndoBanner] = useState(null);
  const [tasksSnapshot, setTasksSnapshot] = useState(null);
  // 5. Auto-Hop to Next Pending Session toggle
  const [autoHopNextGate, setAutoHopNextGate] = useState(true);

  const [quickPrompt, setQuickPrompt] = useState('');
  const [toast, setToast] = useState(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [hudTab, setHudTab] = useState('diff');

  const activeTask = tasks.find((t) => t.id === activeTaskId) || tasks[0];
  const pendingTasks = tasks.filter((t) => t.status === 'awaiting_approval');
  const pendingStep = activeTask.steps.find((s) => s.status === 'pending');
  const completedSteps = activeTask.steps.filter((s) => s.status === 'done');

  const fullThinkText = activeTask.reasoningFull.join('\n');

  const triggerToast = (msg) => {
    setToast(msg);
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  // Grace Undo countdown effect
  useEffect(() => {
    if (!undoBanner) return;
    const timer = setTimeout(() => {
      setUndoBanner(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [undoBanner]);

  // --- Live Typewriter & Auto-Collapse Lifecycle Simulation ---
  const startLiveSimulation = () => {
    setScheme('A');
    setDockExpanded(false);
    setArcDialOpen(false);
    setStreamPhase('thinking');
    setExpandedThink(true);
    setExpandedToolsGroup(true);
    setExpandedDiff(false);
    setTypedThinkChars(12);
    setActiveToolIdx(0);
    setTypedAnswerChars(0);
    triggerToast('演示开始：1. <think> 打字机展开输出中...');
  };

  useEffect(() => {
    if (streamPhase === 'thinking') {
      if (typedThinkChars < fullThinkText.length) {
        const timer = setTimeout(() => {
          setTypedThinkChars((c) => Math.min(fullThinkText.length, c + 14));
        }, 55);
        return () => clearTimeout(timer);
      } else {
        const timer = setTimeout(() => {
          setStreamPhase('tools_run');
          setActiveToolIdx(1);
          triggerToast('2. 连续执行工具调用队列中...');
        }, 450);
        return () => clearTimeout(timer);
      }
    }

    if (streamPhase === 'tools_run') {
      if (activeToolIdx < completedSteps.length) {
        const timer = setTimeout(() => {
          setActiveToolIdx((i) => i + 1);
        }, 650);
        return () => clearTimeout(timer);
      } else {
        const timer = setTimeout(() => {
          setStreamPhase('answering');
          setExpandedThink(false);
          setExpandedToolsGroup(false);
          setExpandedDiff(true);
          setTypedAnswerChars(10);
          triggerToast('3. 开始正式回答：<think> 与连续工具组已自动折叠！');
        }, 650);
        return () => clearTimeout(timer);
      }
    }

    if (streamPhase === 'answering') {
      const totalAnsLen =
        (activeTask.finalAnswer?.headline?.length || 0) +
        (activeTask.finalAnswer?.summary?.length || 0);
      if (typedAnswerChars < totalAnsLen) {
        const timer = setTimeout(() => {
          setTypedAnswerChars((c) => c + 16);
        }, 45);
        return () => clearTimeout(timer);
      } else {
        setStreamPhase('settled');
      }
    }
  }, [streamPhase, typedThinkChars, activeToolIdx, typedAnswerChars, fullThinkText.length, completedSteps.length, activeTask]);

  // --- Decision Handler with 4s Grace Undo + Optional Auto-Hop to Next Pending Agent ---
  const handleDecision = (taskId, decision) => {
    // Save snapshot for 4s Grace Undo / Checkpoint Rewind
    setTasksSnapshot(JSON.parse(JSON.stringify(tasks)));

    const currentTaskObj = tasks.find((t) => t.id === taskId);
    const nextPendingCandidate = tasks.find(
      (t) => t.id !== taskId && t.status === 'awaiting_approval'
    );

    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== taskId) return task;
        const updatedSteps = task.steps.map((st) => {
          if (st.status === 'pending') {
            return { ...st, status: decision === 'approve' ? 'done' : 'rejected' };
          }
          if (st.status === 'queued' && decision === 'approve') {
            return { ...st, status: 'done' };
          }
          return st;
        });
        return {
          ...task,
          status: 'completed',
          steps: updatedSteps
        };
      })
    );

    setDockExpanded(false);
    setExpandedToolsGroup(false);
    setHoldProgress(0);

    // Show 4s non-intrusive Undo & Checkpoint pill
    setUndoBanner({
      taskTitle: currentTaskObj?.title || '刚才的操作',
      checkpointId: currentTaskObj?.checkpointId || 'cp-8f91a',
      decision,
      previousTaskId: taskId
    });

    if (autoHopNextGate && nextPendingCandidate && scheme === 'A') {
      setTimeout(() => {
        setActiveTaskId(nextPendingCandidate.id);
        triggerToast(
          `已批复并自动切至下一待办 (#${nextPendingCandidate.shortCode})`
        );
      }, 360);
    } else {
      triggerToast(
        decision === 'approve'
          ? scopedAutoApprove
            ? '已批准并授权本会话同类目录免打扰'
            : '已批准并完成队列（4秒内可撤回快照）'
          : '已拦截该工具调用并回滚'
      );
    }
  };

  const handleUndoLastDecision = () => {
    if (!tasksSnapshot || !undoBanner) return;
    setTasks(tasksSnapshot);
    setActiveTaskId(undoBanner.previousTaskId);
    setUndoBanner(null);
    triggerToast(`已回滚至沙盒快照 ${undoBanner.checkpointId}`);
  };

  // --- Hold-to-Approve Mechanics for High-Risk Actions (e.g. rm -rf) ---
  const startHoldApprove = (taskId) => {
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    let current = 0;
    holdTimerRef.current = setInterval(() => {
      current += 10;
      if (current >= 100) {
        clearInterval(holdTimerRef.current);
        holdTimerRef.current = null;
        setHoldProgress(0);
        handleDecision(taskId, 'approve');
      } else {
        setHoldProgress(current);
      }
    }, 45);
  };

  const cancelHoldApprove = () => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldProgress(0);
  };

  const handleResetDemo = () => {
    setTasks(INITIAL_TASKS);
    setActiveTaskId('t-101');
    setStreamPhase('settled');
    setExpandedThink(false);
    setExpandedToolsGroup(false);
    setExpandedDiff(true);
    setDockExpanded(false);
    setArcDialOpen(false);
    setQuotedDiffLine(null);
    setUndoBanner(null);
    triggerToast('已重置全部演示状态');
  };

  const handleSendInstruction = (e) => {
    e.preventDefault();
    if (!quickPrompt.trim() && !quotedDiffLine) return;
    const text = quickPrompt.trim();
    const quotePrefix = quotedDiffLine
      ? `[针对 ${quotedDiffLine.file}:${quotedDiffLine.line}] `
      : '';
    setQuickPrompt('');
    setQuotedDiffLine(null);
    setTasks((prev) =>
      prev.map((task) =>
        task.id === activeTask.id
          ? {
              ...task,
              reasoningSummary: `针对指令「${quotePrefix}${text || '调整此处逻辑'}」完成重算，已更新补丁上下文。`
            }
          : task
      )
    );
    startLiveSimulation();
  };

  // --- Camera-Lens Arc Dial Pointer / Touch Gesture Calculation ---
  const handleArcPointerMove = (e) => {
    if (!arcDialOpen || !phoneRef.current) return;
    const rect = phoneRef.current.getBoundingClientRect();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const relY = clientY - rect.top;
    const arcTop = 195;
    const arcBottom = 565;
    const clampedY = Math.max(arcTop, Math.min(arcBottom, relY));
    const progress = (clampedY - arcTop) / (arcBottom - arcTop);
    const index = Math.min(
      tasks.length - 1,
      Math.max(0, Math.round(progress * (tasks.length - 1)))
    );
    const targetTask = tasks[index];
    if (targetTask && targetTask.id !== hoveredTaskId) {
      setHoveredTaskId(targetTask.id);
    }
  };

  const handleArcPointerUp = () => {
    if (!arcDialOpen) return;
    if (hoveredTaskId && hoveredTaskId !== activeTaskId) {
      const chosen = tasks.find((t) => t.id === hoveredTaskId);
      setActiveTaskId(hoveredTaskId);
      setExpandedThink(false);
      setExpandedToolsGroup(false);
      if (chosen) {
        triggerToast(`已切换至：${chosen.title}`);
      }
    }
    if (isDraggingDial) {
      setIsDraggingDial(false);
      setArcDialOpen(false);
      setHoveredTaskId(null);
    }
  };

  // Theme palette helper:
  // 'paper': Warm Stone Paper (#F4F2ED)
  // 'eink_slate': Soft Warm Charcoal Slate (#252522 base, #2E2E2A card, #CECBC2 warm linen text)
  const isDark = theme === 'eink_slate';
  const palette = {
    pageBg: isDark ? 'bg-[#1F1F1D] text-[#C4C1B8]' : 'bg-[#ECEAE4] text-[#222220]',
    panelBg: isDark ? 'bg-[#272724] border-[#383834]' : 'bg-[#F5F3EE] border-[#DCD9D0]',
    phoneShell: isDark
      ? 'bg-[#252522] border-[#3D3D38] shadow-[0_24px_60px_rgba(0,0,0,0.45)]'
      : 'bg-[#F4F2ED] border-[#D2CFC6] shadow-[0_24px_60px_rgba(30,30,28,0.12)]',
    cardBg: isDark ? 'bg-[#2E2E2A] border-[#3E3E39]' : 'bg-[#EAE7E0] border-[#D8D5CC]',
    cardSubtle: isDark ? 'bg-[#292926] border-[#363632]' : 'bg-[#EFECE6] border-[#DFDCD3]',
    answerCardBg: isDark
      ? 'bg-[#31312C] border-[#4A4942] shadow-sm'
      : 'bg-[#FAF8F3] border-[#CFCBC0] shadow-sm',
    dockBg: isDark
      ? 'bg-[#2C2C28]/95 border-[#40403B]'
      : 'bg-[#E6E3DC]/95 border-[#CCC9C0]',
    textPrimary: isDark ? 'text-[#CECBC2]' : 'text-[#1C1C1A]',
    textSecondary: isDark ? 'text-[#9A978E]' : 'text-[#5C5B57]',
    textMuted: isDark ? 'text-[#75736B]' : 'text-[#8C8A84]',
    btnPrimary: isDark
      ? 'bg-[#C4C1B6] text-[#222220] hover:bg-[#D2CFC4]'
      : 'bg-[#2B2B28] text-[#F4F2ED] hover:bg-[#3B3B37]',
    btnSecondary: isDark
      ? 'bg-[#353530] text-[#C2BFB6] border border-[#464640] hover:bg-[#3E3E38]'
      : 'bg-[#DFDCD4] text-[#2E2E2B] border border-[#C8C5BC] hover:bg-[#D5D2C9]',
    diffAddBg: isDark ? 'bg-[#28332B] text-[#A3BDA9]' : 'bg-[#E1EBE4] text-[#284B34]',
    diffDelBg: isDark ? 'bg-[#36292A] text-[#C29B9E]' : 'bg-[#EFE2E2] text-[#693034]',
    badgePending: isDark
      ? 'bg-[#363228] text-[#C8B68E] border-[#4A4436]'
      : 'bg-[#E6E0D0] text-[#5C4E2E] border-[#CFC6B0]',
    badgeDanger: isDark
      ? 'bg-[#3A2829] text-[#CFA0A3] border-[#523638]'
      : 'bg-[#EFE0E0] text-[#6E2E32] border-[#D5B8B8]'
  };

  // Compute radial coordinates for the 5 tasks along a left-curving thumb arc on the right edge
  const getArcPoint = (index, total) => {
    const spanDeg = 96;
    const startDeg = -spanDeg / 2;
    const deg = total === 1 ? 0 : startDeg + (index / (total - 1)) * spanDeg;
    const rad = (deg * Math.PI) / 180;
    const radius = 175;
    const cx = 368;
    const cy = 380;
    const x = cx - Math.cos(rad) * radius;
    const y = cy + Math.sin(rad) * radius;
    return { x, y, deg };
  };

  const previewedTaskOnDial =
    tasks.find((t) => t.id === (hoveredTaskId || activeTaskId)) || activeTask;

  const isThinkCurrentlyOpen = streamPhase === 'thinking' || expandedThink;
  const isToolsCurrentlyOpen = streamPhase === 'tools_run' || expandedToolsGroup;
  const isHighRiskGate = pendingStep?.risk === 'high';

  return (
    <div className={`min-h-screen ${palette.pageBg} font-sans transition-colors duration-300`}>
      {/* Top Header Bar */}
      <header className={`sticky top-0 z-30 border-b ${palette.panelBg} backdrop-blur-md px-4 py-3`}>
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${palette.cardBg}`}>
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className={`text-sm font-semibold tracking-tight ${palette.textPrimary}`}>
                  DeepSeek Harness · 移动端体验精雕版 (v3)
                </h1>
                <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${palette.cardSubtle} ${palette.textSecondary}`}>
                  Crafted Micro-UX
                </span>
              </div>
              <p className={`text-xs ${palette.textSecondary}`}>
                汲取 Linear / Cursor iOS / Claude Code Remote 精髓：行级点按引用 · 风险分级防误触 · 4秒快照悔棋 · 连续跳栈
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={startLiveSimulation}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${palette.btnPrimary}`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>播放「流式展开 → 回答后自动折叠」全过程</span>
            </button>

            <div className={`inline-flex p-1 rounded-xl border ${palette.cardSubtle}`}>
              {[
                { key: 'A', label: '主力方案 A' },
                { key: 'B', label: '方案 B' },
                { key: 'C', label: '方案 C' }
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setScheme(item.key)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    scheme === item.key
                      ? palette.btnPrimary
                      : `${palette.textSecondary} hover:opacity-80`
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Theme Toggle */}
            <button
              onClick={() => setTheme(isDark ? 'paper' : 'eink_slate')}
              className={`px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 border transition-all ${palette.cardBg} ${palette.textPrimary}`}
              title="切换日间暖石纸色与夜间低反差暖炭灰"
            >
              {isDark ? (
                <>
                  <Moon className="w-3.5 h-3.5" />
                  <span>暖炭电纸灰 (#252522)</span>
                </>
              ) : (
                <>
                  <Sun className="w-3.5 h-3.5" />
                  <span>暖石纸色 (#F4F2ED)</span>
                </>
              )}
            </button>

            <button
              onClick={handleResetDemo}
              className={`p-2 rounded-xl border ${palette.cardBg} ${palette.textSecondary} hover:opacity-80`}
              title="重置可交互状态"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left / Center Column: Interactive Mobile Frame */}
        <div className="lg:col-span-5 flex flex-col items-center">
          {/* Interactive Quick Feature Switcher above Phone */}
          <div className="w-full max-w-[380px] mb-3 flex items-center justify-between text-xs gap-1">
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setScheme('A');
                  setActiveTaskId('t-101');
                }}
                className={`px-2 py-1 rounded-lg font-mono text-[10px] border transition-all ${
                  activeTaskId === 't-101' ? palette.btnPrimary : `${palette.cardBg} ${palette.textSecondary}`
                }`}
              >
                #01 常规补丁
              </button>
              <button
                onClick={() => {
                  setScheme('A');
                  setActiveTaskId('t-105');
                  setExpandedDiff(true);
                  triggerToast('已切至 #05：体验底部高危命令「长按充能审批」');
                }}
                className={`px-2 py-1 rounded-lg font-mono text-[10px] border transition-all ${
                  activeTaskId === 't-105' ? palette.btnPrimary : `${palette.cardBg} ${palette.textSecondary}`
                }`}
              >
                #05 高危长按防误触
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setScheme('A');
                  setArcDialOpen(!arcDialOpen);
                }}
                className={`px-2 py-1 rounded-lg font-mono text-[10px] border transition-all flex items-center gap-1 ${
                  arcDialOpen ? palette.btnPrimary : `${palette.cardBg} ${palette.textPrimary}`
                }`}
              >
                <Disc className="w-3 h-3" />
                <span>弧形转盘</span>
              </button>
              <button
                onClick={() => {
                  setScheme('A');
                  setDockExpanded(!dockExpanded);
                }}
                className={`px-2 py-1 rounded-lg font-mono text-[10px] border transition-all flex items-center gap-1 ${
                  dockExpanded ? palette.btnPrimary : `${palette.cardBg} ${palette.textPrimary}`
                }`}
              >
                <Maximize2 className="w-3 h-3" />
                <span>展开审批坞</span>
              </button>
            </div>
          </div>

          {/* Mobile Phone Hardware Frame */}
          <div
            ref={phoneRef}
            onMouseMove={handleArcPointerMove}
            onMouseUp={handleArcPointerUp}
            onTouchMove={handleArcPointerMove}
            onTouchEnd={handleArcPointerUp}
            className={`relative w-full max-w-[380px] h-[760px] rounded-[44px] border-[6px] ${palette.phoneShell} flex flex-col overflow-hidden select-none`}
          >
            {/* Ambient 1px Context Budget Hairline at the Very Top of Screen */}
            <div className="w-full h-[2px] bg-current/5 overflow-hidden shrink-0">
              <div
                className="h-full transition-all duration-500 bg-[#9E9B90]"
                style={{ width: `${activeTask.contextPct || 20}%` }}
                title={`上下文窗口水位: ${activeTask.contextPct}%`}
              />
            </div>

            {/* Status Bar + Live Activity Capsule */}
            <div className="px-6 pt-2.5 pb-2 flex items-center justify-between text-[11px] font-mono shrink-0 z-20">
              <span className={palette.textSecondary}>14:06</span>
              {/* Dynamic Island / Live Activity Mini Pill */}
              <button
                onClick={() => {
                  if (pendingTasks.length > 0) {
                    setActiveTaskId(pendingTasks[0].id);
                    triggerToast(`快速定位至待办会话 #${pendingTasks[0].shortCode}`);
                  }
                }}
                className={`px-3 h-5 rounded-full ${
                  isDark ? 'bg-[#1C1C19] border border-[#383833]' : 'bg-[#DFDCD4] border border-[#C8C4B8]'
                } flex items-center justify-center gap-1.5 transition-transform active:scale-95`}
                title="点击直达下一个阻塞待审批会话"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    streamPhase !== 'settled'
                      ? 'bg-[#7A9A85] animate-ping'
                      : pendingTasks.length > 0
                      ? 'bg-[#B89F6D]'
                      : 'bg-[#7A9A85]'
                  }`}
                />
                <span className="text-[9px] tracking-tight opacity-90">
                  {streamPhase === 'thinking'
                    ? 'R1 THINKING'
                    : streamPhase === 'tools_run'
                    ? 'RUN TOOLS'
                    : pendingTasks.length > 0
                    ? `${pendingTasks.length} GATE · ${activeTask.tokens}`
                    : `IDLE · ${activeTask.tokens}`}
                </span>
              </button>
              <div className={`flex items-center gap-1.5 ${palette.textSecondary}`}>
                <span>5G</span>
                <span>90%</span>
              </div>
            </div>

            {/* Toast Notification Inside Phone */}
            {toast && (
              <div className="absolute top-12 left-4 right-4 z-50 pointer-events-none flex justify-center">
                <div
                  className={`px-3.5 py-2 rounded-xl border text-xs font-medium shadow-lg backdrop-blur-md flex items-center gap-2 ${palette.dockBg} ${palette.textPrimary}`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{toast}</span>
                </div>
              </div>
            )}

            {/* 4-Second Grace Undo & Checkpoint Rewind Floating Pill */}
            {undoBanner && (
              <div className="absolute bottom-[148px] left-4 right-5 z-40 flex justify-center">
                <div
                  className={`w-full px-3 py-2 rounded-xl border shadow-lg backdrop-blur-md flex items-center justify-between text-xs ${palette.dockBg}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Bookmark className={`w-3.5 h-3.5 shrink-0 ${palette.textSecondary}`} />
                    <span className={`truncate text-[11px] font-mono ${palette.textPrimary}`}>
                      已存快照 {undoBanner.checkpointId}
                    </span>
                  </div>
                  <button
                    onClick={handleUndoLastDecision}
                    className={`px-2.5 py-1 rounded-lg font-mono text-[11px] font-semibold flex items-center gap-1 shrink-0 ${palette.btnPrimary}`}
                  >
                    <Undo2 className="w-3 h-3" />
                    <span>撤回拍板 (4s)</span>
                  </button>
                </div>
              </div>
            )}

            {/* =========================================================
                RIGHT-EDGE THUMB TRIGGER PILL & CAMERA-LENS ARC DIAL OVERLAY
               ========================================================= */}
            {!arcDialOpen && (
              <div
                onMouseDown={() => {
                  setIsDraggingDial(true);
                  setArcDialOpen(true);
                  setHoveredTaskId(activeTaskId);
                }}
                onTouchStart={() => {
                  setIsDraggingDial(true);
                  setArcDialOpen(true);
                  setHoveredTaskId(activeTaskId);
                }}
                onClick={() => {
                  setArcDialOpen(true);
                  setHoveredTaskId(activeTaskId);
                }}
                title="按住或点击呼出拇指弧形会话转盘"
                className="absolute right-0 top-1/2 -translate-y-1/2 z-30 py-6 pl-3 pr-1 cursor-pointer group flex items-center"
              >
                <div
                  className={`w-2 h-24 rounded-l-full border-l border-y flex flex-col items-center justify-center gap-1.5 transition-all group-hover:w-3.5 ${
                    isDark
                      ? 'bg-[#353530]/90 border-[#52524A]'
                      : 'bg-[#DFDCD3]/90 border-[#B8B4A9]'
                  }`}
                >
                  <span className="w-0.5 h-2 rounded-full bg-current opacity-40" />
                  <span className="w-1 h-4 rounded-full bg-[#B89F6D]" />
                  <span className="w-0.5 h-2 rounded-full bg-current opacity-40" />
                </div>
              </div>
            )}

            {arcDialOpen && (
              <div
                onClick={() => {
                  setArcDialOpen(false);
                  setIsDraggingDial(false);
                }}
                className={`absolute inset-0 z-40 transition-all duration-200 ${
                  isDark ? 'bg-[#1C1C19]/80' : 'bg-[#E6E3DC]/75'
                } backdrop-blur-md`}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute left-4 top-20 right-14 p-3.5 rounded-2xl border shadow-sm transition-all ${palette.cardBg}`}
                >
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className={palette.textMuted}>
                      THUMB ARC DIAL · SESSION {previewedTaskOnDial.shortCode}/{tasks.length}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded border ${
                        previewedTaskOnDial.status === 'awaiting_approval'
                          ? palette.badgePending
                          : palette.cardSubtle
                      }`}
                    >
                      {previewedTaskOnDial.status === 'awaiting_approval'
                        ? '待审批 GATE'
                        : previewedTaskOnDial.status === 'running'
                        ? '运行中 RUN'
                        : '已完成 DONE'}
                    </span>
                  </div>
                  <div className={`text-xs font-mono mt-1.5 ${palette.textSecondary}`}>
                    {previewedTaskOnDial.repo} · {previewedTaskOnDial.branch}
                  </div>
                  <div className={`text-sm font-semibold mt-0.5 leading-snug ${palette.textPrimary}`}>
                    {previewedTaskOnDial.title}
                  </div>
                  <div className={`text-[11px] mt-1.5 line-clamp-1 ${palette.textMuted}`}>
                    {previewedTaskOnDial.reasoningSummary}
                  </div>
                </div>

                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox="0 0 380 760"
                >
                  <path
                    d="M 358 190 A 190 190 0 0 0 358 570"
                    fill="none"
                    stroke={isDark ? '#4A4A43' : '#C2BEB4'}
                    strokeWidth="1.5"
                    strokeDasharray="3 5"
                  />
                  <path
                    d="M 368 205 A 175 175 0 0 0 368 555"
                    fill="none"
                    stroke={isDark ? '#706E65' : '#9E9B91'}
                    strokeWidth="2"
                  />
                  {Array.from({ length: 25 }).map((_, i) => {
                    const deg = -48 + i * 4;
                    const rad = (deg * Math.PI) / 180;
                    const cx = 368;
                    const cy = 380;
                    const r1 = 171;
                    const r2 = i % 3 === 0 ? 181 : 176;
                    const x1 = cx - Math.cos(rad) * r1;
                    const y1 = cy + Math.sin(rad) * r1;
                    const x2 = cx - Math.cos(rad) * r2;
                    const y2 = cy + Math.sin(rad) * r2;
                    return (
                      <line
                        key={i}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={isDark ? '#6E6C64' : '#A6A399'}
                        strokeWidth={i % 3 === 0 ? '1.5' : '1'}
                      />
                    );
                  })}
                </svg>

                {tasks.map((t, idx) => {
                  const pt = getArcPoint(idx, tasks.length);
                  const isFocused = (hoveredTaskId || activeTaskId) === t.id;
                  return (
                    <div
                      key={t.id}
                      style={{
                        left: `${pt.x}px`,
                        top: `${pt.y}px`,
                        transform: 'translate(-92%, -50%)'
                      }}
                      onMouseEnter={() => setHoveredTaskId(t.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveTaskId(t.id);
                        setExpandedThink(false);
                        setExpandedToolsGroup(false);
                        setHoveredTaskId(null);
                        setArcDialOpen(false);
                        triggerToast(`已切换会话：${t.title}`);
                      }}
                      className="absolute z-50 flex items-center justify-end cursor-pointer group"
                    >
                      <div
                        className={`px-3 py-2 rounded-2xl border transition-all duration-150 flex items-center gap-2.5 max-w-[235px] ${
                          isFocused
                            ? `${palette.btnPrimary} scale-105 shadow-md`
                            : `${palette.cardBg} ${palette.textSecondary} opacity-85 hover:opacity-100`
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            t.status === 'awaiting_approval'
                              ? 'bg-[#B89F6D]'
                              : t.status === 'running'
                              ? 'bg-current animate-pulse'
                              : 'opacity-40 bg-current'
                          }`}
                        />
                        <div className="min-w-0 text-left">
                          <div className="text-xs font-semibold truncate leading-tight">
                            {t.title}
                          </div>
                          <div className="text-[10px] font-mono opacity-75 truncate mt-0.5">
                            {t.repo.split('/')[1]} · {t.model.replace('DeepSeek-', '')}
                          </div>
                        </div>
                        <span className="text-[10px] font-mono opacity-60 shrink-0">
                          {t.shortCode}
                        </span>
                      </div>

                      <div
                        className={`ml-2 w-3 h-3 rounded-full border-2 shrink-0 transition-transform ${
                          isFocused
                            ? 'scale-125 bg-[#B89F6D] border-current'
                            : `${palette.cardBg} opacity-70`
                        }`}
                      />
                    </div>
                  );
                })}

                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setArcDialOpen(false);
                  }}
                  className={`absolute right-0 top-1/2 -translate-y-1/2 px-2 py-4 rounded-l-2xl border-l border-y text-[10px] font-mono cursor-pointer ${palette.cardBg} ${palette.textSecondary}`}
                  style={{ writingMode: 'vertical-rl' }}
                >
                  松开或点按选定 · CLOSE
                </div>
              </div>
            )}

            {/* =========================================================
                SCHEME A: STREAM-EXPAND -> ANSWER-COLLAPSE + MICRO-INTERACTIONS
               ========================================================= */}
            {scheme === 'A' && (
              <div className="flex-1 flex flex-col min-h-0 relative">
                {/* Minimal Top Context Header with Checkpoint Badge */}
                <div className={`px-4 py-2 border-b ${palette.cardSubtle} flex items-center justify-between shrink-0`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <FolderGit2 className={`w-3.5 h-3.5 ${palette.textSecondary}`} />
                      <span className={`text-xs font-mono truncate ${palette.textPrimary}`}>
                        {activeTask.repo}
                      </span>
                    </div>
                    <div className={`flex items-center gap-1.5 mt-0.5 text-[10px] font-mono ${palette.textMuted}`}>
                      <span>{activeTask.branch}</span>
                      <span>·</span>
                      <span>快照 {activeTask.checkpointId}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={startLiveSimulation}
                      className={`px-2 py-1 rounded-md border text-[10px] font-mono flex items-center gap-1 ${palette.cardBg} ${palette.textPrimary}`}
                      title="重播流式展开到自动折叠"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      <span>演示流</span>
                    </button>
                    <button
                      onClick={() => {
                        setArcDialOpen(true);
                        setHoveredTaskId(activeTaskId);
                      }}
                      className={`px-2 py-1 rounded-md border text-[10px] font-mono flex items-center gap-1 ${palette.cardBg} ${palette.textSecondary}`}
                      title="打开右侧弧形会话转盘"
                    >
                      <Disc className="w-3 h-3" />
                      <span>{activeTask.shortCode}/{tasks.length}</span>
                    </button>
                  </div>
                </div>

                {/* Scrollable Execution & Answer Viewport */}
                <div className="flex-1 overflow-y-auto px-3.5 py-2.5 pr-4 space-y-2">
                  {/* Compact User Task Prompt Pill */}
                  <div className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2 ${palette.cardSubtle}`}>
                    <div className={`text-xs font-medium truncate ${palette.textPrimary}`}>
                      {activeTask.title}
                    </div>
                    <span className={`text-[10px] font-mono shrink-0 ${palette.textMuted}`}>
                      CTX {activeTask.contextPct}%
                    </span>
                  </div>

                  {/* 1. <think> REASONING & STREAMING CODE BLOCK */}
                  <div className={`rounded-xl border transition-all duration-300 ${palette.cardSubtle}`}>
                    <button
                      onClick={() => setExpandedThink(!isThinkCurrentlyOpen)}
                      className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {streamPhase === 'thinking' ? (
                          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                        ) : (
                          <Sparkles className={`w-3.5 h-3.5 shrink-0 ${palette.textMuted}`} />
                        )}
                        <span className={`text-[11px] font-mono font-medium shrink-0 ${palette.textPrimary}`}>
                          {streamPhase === 'thinking' ? '正在深度思考 <think>...' : '已深度思考'}
                        </span>
                        <span className={`text-[10px] font-mono shrink-0 ${palette.textMuted}`}>
                          ({activeTask.elapsed})
                        </span>
                        {!isThinkCurrentlyOpen && (
                          <span className={`text-[11px] truncate ml-1 ${palette.textSecondary}`}>
                            · {activeTask.reasoningSummary}
                          </span>
                        )}
                      </div>
                      <div className={`flex items-center gap-1 shrink-0 text-[10px] font-mono ${palette.textMuted}`}>
                        <span>{isThinkCurrentlyOpen ? '收起' : '展开'}</span>
                        {isThinkCurrentlyOpen ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </div>
                    </button>

                    {isThinkCurrentlyOpen && (
                      <div className="px-3 pb-2.5 pt-1.5 border-t border-current/10 space-y-1.5 font-mono text-[11px]">
                        {streamPhase === 'thinking' ? (
                          <div className={`whitespace-pre-wrap leading-relaxed ${palette.textSecondary}`}>
                            {fullThinkText.slice(0, typedThinkChars)}
                            <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-current animate-pulse" />
                          </div>
                        ) : (
                          <>
                            {activeTask.reasoningFull.map((line, i) => (
                              <div key={i} className={`leading-relaxed ${palette.textSecondary}`}>
                                {line}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 2. CONSECUTIVE COMPLETED TOOL CALLS BATCH */}
                  {completedSteps.length > 0 && (
                    <div className={`rounded-xl border transition-all duration-300 ${palette.cardSubtle}`}>
                      <button
                        onClick={() => setExpandedToolsGroup(!isToolsCurrentlyOpen)}
                        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {streamPhase === 'tools_run' ? (
                            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                          ) : (
                            <Layers className={`w-3.5 h-3.5 shrink-0 ${palette.textMuted}`} />
                          )}
                          <span className={`text-[11px] font-mono font-medium ${palette.textPrimary}`}>
                            {streamPhase === 'tools_run'
                              ? `正在连续调用工具 (${Math.min(activeToolIdx, completedSteps.length)}/${completedSteps.length})`
                              : `已折叠 ${completedSteps.length} 项连续工具调用`}
                          </span>
                          {!isToolsCurrentlyOpen && (
                            <span className={`text-[10px] font-mono truncate ${palette.textMuted}`}>
                              (Read · Grep · Check)
                            </span>
                          )}
                        </div>
                        <div className={`flex items-center gap-1 shrink-0 text-[10px] font-mono ${palette.textMuted}`}>
                          <span>{isToolsCurrentlyOpen ? '收起' : '查阅'}</span>
                          {isToolsCurrentlyOpen ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </div>
                      </button>

                      {isToolsCurrentlyOpen && (
                        <div className="px-2.5 pb-2.5 pt-1 border-t border-current/10 space-y-1">
                          {completedSteps.map((st, idx) => {
                            const isStepRunning =
                              streamPhase === 'tools_run' && idx === activeToolIdx - 1;
                            const isStepWaiting =
                              streamPhase === 'tools_run' && idx >= activeToolIdx;
                            return (
                              <div
                                key={st.id}
                                className={`px-2.5 py-1.5 rounded-lg flex items-center justify-between text-[11px] font-mono ${palette.cardBg}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {isStepRunning ? (
                                    <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
                                  ) : isStepWaiting ? (
                                    <Clock className="w-3 h-3 shrink-0 opacity-40" />
                                  ) : (
                                    <Check className="w-3 h-3 shrink-0 opacity-75" />
                                  )}
                                  <span className={`truncate ${isStepWaiting ? 'opacity-40' : ''}`}>
                                    {st.label}
                                  </span>
                                </div>
                                <span className={`text-[10px] ml-2 shrink-0 ${palette.textMuted}`}>
                                  {isStepRunning ? 'running...' : isStepWaiting ? 'queued' : st.time}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. FORMAL AGENT RESPONSE + TAP-TO-QUOTE MOBILE DIFF */}
                  {(streamPhase === 'answering' || streamPhase === 'settled') &&
                    activeTask.finalAnswer && (
                      <div className={`p-3.5 rounded-2xl border transition-all duration-300 space-y-2.5 ${palette.answerCardBg}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <FileText className={`w-3.5 h-3.5 ${palette.textPrimary}`} />
                            <span className={`text-[10px] font-mono uppercase tracking-wider font-semibold ${palette.textSecondary}`}>
                              DEEPSEEK 正式回答 · FORMAL RESPONSE
                            </span>
                          </div>
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${palette.cardSubtle} ${palette.textMuted}`}>
                            主视窗聚焦
                          </span>
                        </div>

                        <div className={`text-xs font-semibold leading-snug ${palette.textPrimary}`}>
                          {streamPhase === 'answering'
                            ? activeTask.finalAnswer.headline.slice(0, typedAnswerChars)
                            : activeTask.finalAnswer.headline}
                        </div>

                        <p className={`text-xs leading-relaxed ${palette.textSecondary}`}>
                          {activeTask.finalAnswer.summary}
                        </p>

                        <div className="space-y-1.5 pt-0.5">
                          {activeTask.finalAnswer.bullets.map((b, i) => (
                            <div
                              key={i}
                              className={`p-2 rounded-xl border text-[11px] leading-relaxed flex items-start gap-2 ${palette.cardSubtle}`}
                            >
                              <span className={`font-mono text-[10px] mt-0.5 ${palette.textMuted}`}>
                                0{i + 1}
                              </span>
                              <span className={palette.textPrimary}>{b}</span>
                            </div>
                          ))}
                        </div>

                        {/* Pending Gate Inline Diff with Tap-Line-to-Quote & Soft-Wrap Toggle */}
                        {pendingStep && (
                          <div
                            className={`rounded-xl border overflow-hidden mt-1 ${
                              isHighRiskGate ? palette.badgeDanger : palette.badgePending
                            }`}
                          >
                            <div className="px-3 py-2 flex items-center justify-between text-[11px] font-mono">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate font-semibold">
                                  {pendingStep.file} (+{pendingStep.additions}/-{pendingStep.deletions})
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  onClick={() => setDiffWordWrap(!diffWordWrap)}
                                  className="underline text-[10px] flex items-center gap-0.5"
                                  title="切换移动端代码自动折行"
                                >
                                  <WrapText className="w-3 h-3" />
                                  <span>{diffWordWrap ? '自动折行' : '横向滚动'}</span>
                                </button>
                                <button
                                  onClick={() => setExpandedDiff(!expandedDiff)}
                                  className="underline text-[10px]"
                                >
                                  {expandedDiff ? '收起' : '展开'}
                                </button>
                              </div>
                            </div>

                            {expandedDiff && pendingStep.diff && (
                              <div className={`p-2 text-[10px] font-mono space-y-1 border-t border-current/15 ${palette.cardBg}`}>
                                <div className={`flex items-center justify-between px-1 pb-0.5 text-[9px] ${palette.textMuted}`}>
                                  <span>点按任意代码行可直接引用追问</span>
                                  <span>{pendingStep.scopeRule}</span>
                                </div>
                                {pendingStep.diff.map((d, i) => {
                                  const lineNum = d.lineNew || d.lineOld || i + 1;
                                  const isSelected =
                                    quotedDiffLine &&
                                    quotedDiffLine.line === lineNum &&
                                    quotedDiffLine.file === pendingStep.file;
                                  return (
                                    <div
                                      key={i}
                                      onClick={() => {
                                        setQuotedDiffLine({
                                          file: pendingStep.file,
                                          line: lineNum,
                                          code: d.code.trim()
                                        });
                                        triggerToast(`已引用 ${pendingStep.file}:${lineNum} 到输入框`);
                                      }}
                                      className={`px-2 py-1 rounded-lg flex items-start gap-2 cursor-pointer transition-all ${
                                        d.type === 'add'
                                          ? palette.diffAddBg
                                          : d.type === 'del'
                                          ? palette.diffDelBg
                                          : palette.textMuted
                                      } ${isSelected ? 'ring-1 ring-current font-semibold' : 'hover:opacity-90'}`}
                                    >
                                      <span className="w-5 select-none opacity-60 shrink-0">
                                        {lineNum}
                                      </span>
                                      <span className="w-3 select-none opacity-60 shrink-0">
                                        {d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' '}
                                      </span>
                                      <span
                                        className={
                                          diffWordWrap
                                            ? 'whitespace-pre-wrap break-all'
                                            : 'whitespace-pre overflow-x-auto'
                                        }
                                      >
                                        {d.code}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                </div>

                {/* =========================================================
                    EXPANDED SCHEME-B STYLE TRIAGE SHEET (WHEN DOCK IS EXPANDED)
                   ========================================================= */}
                {dockExpanded && (
                  <div
                    onClick={() => setDockExpanded(false)}
                    className={`absolute inset-0 z-30 flex flex-col justify-end transition-all duration-200 ${
                      isDark ? 'bg-[#1C1C19]/75' : 'bg-[#DDD9D0]/70'
                    } backdrop-blur-sm`}
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className={`rounded-t-[32px] border-t p-4 space-y-3 shadow-2xl ${palette.dockBg}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${palette.badgePending}`}>
                          FOCUS TRIAGE SHEET · 方案 B 展开态
                        </span>
                        <button
                          onClick={() => setDockExpanded(false)}
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono flex items-center gap-1 ${palette.cardBg} ${palette.textSecondary}`}
                        >
                          <Minimize2 className="w-3 h-3" />
                          <span>收起回到底栏</span>
                        </button>
                      </div>

                      {pendingStep ? (
                        <>
                          <div className={`rounded-2xl border p-3.5 space-y-2.5 ${palette.cardBg}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className={`text-[11px] font-mono ${palette.textSecondary}`}>
                                  {activeTask.repo} ({activeTask.branch})
                                </div>
                                <h3 className={`text-sm font-semibold mt-0.5 ${palette.textPrimary}`}>
                                  {activeTask.title}
                                </h3>
                              </div>
                              <span className={`text-[10px] font-mono shrink-0 ${palette.textMuted}`}>
                                快照 {activeTask.checkpointId}
                              </span>
                            </div>

                            <div className={`p-2.5 rounded-xl border ${palette.cardSubtle}`}>
                              <div className={`text-[10px] font-mono uppercase mb-1 ${palette.textMuted}`}>
                                1. 为什么改 (R1 推理结论)
                              </div>
                              <p className={`text-xs leading-relaxed ${palette.textPrimary}`}>
                                {activeTask.reasoningSummary}
                              </p>
                            </div>

                            <div className={`p-2.5 rounded-xl border font-mono text-[10px] space-y-1 ${palette.cardSubtle}`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className={palette.textPrimary}>2. {pendingStep.file}</span>
                                <span className={palette.textMuted}>
                                  +{pendingStep.additions} / -{pendingStep.deletions} lines
                                </span>
                              </div>
                              {pendingStep.diff.map((d, idx) => (
                                <div
                                  key={idx}
                                  className={`px-2 py-0.5 rounded truncate ${
                                    d.type === 'add'
                                      ? palette.diffAddBg
                                      : d.type === 'del'
                                      ? palette.diffDelBg
                                      : palette.textMuted
                                  }`}
                                >
                                  {d.type === 'add' ? '+ ' : d.type === 'del' ? '- ' : '  '}
                                  {d.code.trim()}
                                </div>
                              ))}
                            </div>

                            {/* Scoped Trust Option inside Expanded Sheet */}
                            <button
                              onClick={() => setScopedAutoApprove(!scopedAutoApprove)}
                              className={`w-full px-3 py-2 rounded-xl border flex items-center justify-between text-[11px] font-mono ${palette.cardSubtle}`}
                            >
                              <span className="flex items-center gap-1.5">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>本会话内自动放行 {pendingStep.scopeRule}</span>
                              </span>
                              <span
                                className={`w-4 h-4 rounded flex items-center justify-center border ${
                                  scopedAutoApprove ? palette.btnPrimary : ''
                                }`}
                              >
                                {scopedAutoApprove && <Check className="w-3 h-3" />}
                              </span>
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-3 pt-1">
                            <button
                              onClick={() => handleDecision(activeTask.id, 'reject')}
                              className={`py-3.5 rounded-2xl font-medium text-xs flex flex-col items-center justify-center gap-1 transition-transform active:scale-95 ${palette.btnSecondary}`}
                            >
                              <X className="w-5 h-5" />
                              <span>拒绝并回滚</span>
                            </button>
                            <button
                              onClick={() => handleDecision(activeTask.id, 'approve')}
                              className={`py-3.5 rounded-2xl font-semibold text-xs flex flex-col items-center justify-center gap-1 transition-transform active:scale-95 ${palette.btnPrimary}`}
                            >
                              <Check className="w-5 h-5" />
                              <span>批准并继续队列</span>
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className={`p-6 rounded-2xl border text-center space-y-2 ${palette.cardBg}`}>
                          <div className={`text-sm font-medium ${palette.textPrimary}`}>
                            当前会话无阻塞审批
                          </div>
                          <p className={`text-xs ${palette.textSecondary}`}>
                            你可以从右侧弧形转盘切换到会话 #01、#04 或 #05 查看待批复操作。
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* =========================================================
                    BOTTOM COMPACT THUMB DOCK (WITH RISK-GRADED HOLD & LINE QUOTE)
                   ========================================================= */}
                <div className={`p-3 border-t ${palette.dockBg} backdrop-blur-md shrink-0 space-y-2`}>
                  {pendingStep ? (
                    <div className="space-y-1.5">
                      {/* Expandable Header Pill + Scoped Trust Badge */}
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setDockExpanded(true)}
                          className={`flex-1 px-2.5 py-1.5 rounded-lg border flex items-center justify-between text-[11px] transition-all min-w-0 ${palette.cardBg} hover:opacity-90`}
                        >
                          <span className={`font-mono flex items-center gap-1.5 truncate ${palette.textPrimary}`}>
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isHighRiskGate ? 'bg-[#C26D72] animate-pulse' : 'bg-[#B89F6D]'
                              }`}
                            />
                            <span className="truncate">
                              {isHighRiskGate ? '高危命令: ' : '待批复: '}
                              {pendingStep.file}
                            </span>
                          </span>
                          <span className={`font-mono text-[10px] flex items-center gap-1 shrink-0 ml-1.5 ${palette.textSecondary}`}>
                            <span>放大</span>
                            <Maximize2 className="w-3 h-3" />
                          </span>
                        </button>

                        {/* One-Tap Scoped Trust Toggle Pill */}
                        <button
                          onClick={() => {
                            setScopedAutoApprove(!scopedAutoApprove);
                            triggerToast(
                              !scopedAutoApprove
                                ? `已开启同类目录信任 (${pendingStep.scopeRule})`
                                : '已关闭同类目录自动放行'
                            );
                          }}
                          className={`px-2 py-1.5 rounded-lg border text-[10px] font-mono flex items-center gap-1 shrink-0 transition-all ${
                            scopedAutoApprove ? palette.btnPrimary : `${palette.cardBg} ${palette.textSecondary}`
                          }`}
                          title="本会话同类目录免重复打扰"
                        >
                          <ShieldCheck className="w-3 h-3" />
                          <span>信任目录</span>
                        </button>
                      </div>

                      {/* Ergonomic Action Row: Normal Tap vs High-Risk Hold-to-Approve */}
                      <div className="grid grid-cols-5 gap-2">
                        <button
                          onClick={() => handleDecision(activeTask.id, 'reject')}
                          className={`col-span-2 py-2.5 rounded-xl font-medium text-xs flex items-center justify-center gap-1.5 transition-transform active:scale-95 ${palette.btnSecondary}`}
                        >
                          <X className="w-4 h-4" />
                          <span>拦截</span>
                        </button>

                        {isHighRiskGate ? (
                          <button
                            onMouseDown={() => startHoldApprove(activeTask.id)}
                            onMouseUp={cancelHoldApprove}
                            onMouseLeave={cancelHoldApprove}
                            onTouchStart={() => startHoldApprove(activeTask.id)}
                            onTouchEnd={cancelHoldApprove}
                            className={`col-span-3 relative overflow-hidden py-2.5 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 select-none ${palette.btnPrimary}`}
                          >
                            {/* Hold Progress Fill */}
                            <div
                              className="absolute left-0 top-0 bottom-0 bg-[#B89F6D]/40 transition-all duration-75"
                              style={{ width: `${holdProgress}%` }}
                            />
                            <Lock className="w-3.5 h-3.5 relative z-10" />
                            <span className="relative z-10">
                              {holdProgress > 0
                                ? `长按确认中 ${holdProgress}%`
                                : '长按 0.5s 放行高危命令'}
                            </span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDecision(activeTask.id, 'approve')}
                            className={`col-span-3 py-2.5 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-transform active:scale-95 ${palette.btnPrimary}`}
                          >
                            <Check className="w-4 h-4" />
                            <span>
                              快速批准 (+{pendingStep.additions}/-{pendingStep.deletions})
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between px-1 py-0.5 text-xs">
                      <span className={palette.textSecondary}>所有连续工具组已自动折叠归档</span>
                      <button
                        onClick={handleResetDemo}
                        className={`text-[11px] font-mono underline ${palette.textPrimary}`}
                      >
                        模拟新审批
                      </button>
                    </div>
                  )}

                  {/* Quoted Diff Line Pill (if user tapped a line in the Diff) */}
                  {quotedDiffLine && (
                    <div
                      className={`px-2.5 py-1 rounded-lg border flex items-center justify-between text-[10px] font-mono ${palette.cardBg}`}
                    >
                      <span className={`truncate ${palette.textPrimary}`}>
                        引用 {quotedDiffLine.file}:{quotedDiffLine.line} · {quotedDiffLine.code}
                      </span>
                      <button
                        onClick={() => setQuotedDiffLine(null)}
                        className={`ml-2 ${palette.textMuted} hover:opacity-80`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  {/* Single-Thumb Voice / Quick Steer Bar */}
                  <form onSubmit={handleSendInstruction} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setVoiceActive(!voiceActive);
                        triggerToast(voiceActive ? '语音监听已结束' : '正在聆听单手语音指令...');
                      }}
                      className={`p-2 rounded-xl border transition-all ${
                        voiceActive ? palette.btnPrimary : palette.cardBg
                      }`}
                      title="单手按住说话"
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                    <input
                      type="text"
                      value={quickPrompt}
                      onChange={(e) => setQuickPrompt(e.target.value)}
                      placeholder={
                        quotedDiffLine
                          ? `针对第 ${quotedDiffLine.line} 行提出修改意见...`
                          : '点按上方 Diff 行可引用，或直接输入...'
                      }
                      className={`flex-1 px-3 py-1.5 rounded-xl text-xs border outline-none ${palette.cardBg} ${palette.textPrimary} placeholder:${palette.textMuted}`}
                    />
                    <button
                      type="submit"
                      className={`p-2 rounded-xl ${palette.btnSecondary}`}
                      title="发送指令"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* =========================================================
                SCHEME B: ZERO-NOISE TRIAGE STACK (STANDALONE VIEW)
               ========================================================= */}
            {scheme === 'B' && (
              <div className="flex-1 flex flex-col min-h-0 px-4 pt-2 pb-4">
                <div className="flex items-center justify-between py-2 shrink-0">
                  <div>
                    <span className={`text-[10px] font-mono uppercase tracking-widest ${palette.textMuted}`}>
                      DECISION QUEUE
                    </span>
                    <h2 className={`text-base font-semibold ${palette.textPrimary}`}>
                      {pendingStep ? `${pendingTasks.length} 项待你拍板` : '全部任务顺畅运行'}
                    </h2>
                  </div>
                  <button
                    onClick={() => setScheme('A')}
                    className={`px-2.5 py-1 rounded-full border text-xs font-mono ${palette.cardBg}`}
                  >
                    返回流视图
                  </button>
                </div>

                <div className="flex-1 flex flex-col justify-center my-2">
                  {pendingStep ? (
                    <div className={`rounded-3xl border p-4 flex flex-col justify-between h-full max-h-[470px] shadow-sm ${palette.cardBg}`}>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${palette.badgePending}`}>
                            WRITE &amp; EXEC GATE
                          </span>
                          <span className={`text-[11px] font-mono ${palette.textMuted}`}>
                            {activeTask.model} · {activeTask.elapsed}
                          </span>
                        </div>

                        <div>
                          <div className={`text-xs font-mono ${palette.textSecondary}`}>
                            {activeTask.repo} ({activeTask.branch})
                          </div>
                          <h3 className={`text-sm font-semibold mt-1 leading-snug ${palette.textPrimary}`}>
                            {activeTask.title}
                          </h3>
                        </div>

                        <div className={`p-3 rounded-2xl border ${palette.cardSubtle}`}>
                          <div className={`text-[10px] font-mono uppercase mb-1 ${palette.textMuted}`}>
                            WHY THIS ACTION (R1 推理摘要)
                          </div>
                          <p className={`text-xs leading-relaxed ${palette.textSecondary}`}>
                            {activeTask.reasoningSummary}
                          </p>
                        </div>

                        <div className={`p-3 rounded-2xl border font-mono text-[10px] space-y-1 ${palette.cardSubtle}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={palette.textPrimary}>{pendingStep.file}</span>
                            <span className={palette.textMuted}>
                              +{pendingStep.additions} / -{pendingStep.deletions} lines
                            </span>
                          </div>
                          {pendingStep.diff.slice(0, 4).map((d, idx) => (
                            <div
                              key={idx}
                              className={`px-2 py-0.5 rounded truncate ${
                                d.type === 'add'
                                  ? palette.diffAddBg
                                  : d.type === 'del'
                                  ? palette.diffDelBg
                                  : palette.textMuted
                              }`}
                            >
                              {d.type === 'add' ? '+ ' : d.type === 'del' ? '- ' : '  '}
                              {d.code.trim()}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className={`pt-2 border-t border-current/10 flex items-center justify-between text-[11px] font-mono ${palette.textMuted}`}>
                        <span>后续：自动运行单元测验</span>
                        <span>预估耗时 4s</span>
                      </div>
                    </div>
                  ) : (
                    <div className={`rounded-3xl border p-8 text-center space-y-3 ${palette.cardSubtle}`}>
                      <div className={`w-10 h-10 rounded-2xl mx-auto flex items-center justify-center border ${palette.cardBg}`}>
                        <Check className="w-5 h-5" />
                      </div>
                      <div className={`text-sm font-medium ${palette.textPrimary}`}>
                        收件箱已清空
                      </div>
                      <p className={`text-xs leading-relaxed ${palette.textSecondary}`}>
                        DeepSeek 正在后台静默推进 {tasks.length} 个分支任务。
                      </p>
                      <button
                        onClick={handleResetDemo}
                        className={`mt-2 px-4 py-2 rounded-xl text-xs font-mono ${palette.btnSecondary}`}
                      >
                        加载下一张演示审批卡
                      </button>
                    </div>
                  )}
                </div>

                <div className="shrink-0 space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      disabled={!pendingStep}
                      onClick={() => handleDecision(activeTask.id, 'reject')}
                      className={`py-4 rounded-2xl font-medium text-xs flex flex-col items-center justify-center gap-1 transition-all active:scale-95 disabled:opacity-40 ${palette.btnSecondary}`}
                    >
                      <X className="w-5 h-5" />
                      <span>拒绝并挂起</span>
                    </button>
                    <button
                      disabled={!pendingStep}
                      onClick={() => handleDecision(activeTask.id, 'approve')}
                      className={`py-4 rounded-2xl font-semibold text-xs flex flex-col items-center justify-center gap-1 transition-all active:scale-95 disabled:opacity-40 ${palette.btnPrimary}`}
                    >
                      <Check className="w-5 h-5" />
                      <span>批准并继续</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* =========================================================
                SCHEME C: SPLIT HUD TELEMETRY MATRIX
               ========================================================= */}
            {scheme === 'C' && (
              <div className="flex-1 flex flex-col min-h-0">
                <div className={`px-3 py-2 border-b ${palette.cardSubtle} grid grid-cols-4 gap-1 text-[10px] font-mono shrink-0`}>
                  <div className="truncate">
                    <span className={palette.textMuted}>MOD </span>
                    <span className={palette.textPrimary}>R1-671B</span>
                  </div>
                  <div>
                    <span className={palette.textMuted}>TPS </span>
                    <span className={palette.textPrimary}>48.2/s</span>
                  </div>
                  <div>
                    <span className={palette.textMuted}>CTX </span>
                    <span className={palette.textPrimary}>{activeTask.tokens}</span>
                  </div>
                  <div className="text-right">
                    <span className={palette.textMuted}>COST </span>
                    <span className={palette.textPrimary}>{activeTask.cost}</span>
                  </div>
                </div>

                <div className="h-[46%] flex flex-col border-b border-current/10 min-h-0">
                  <div className={`px-3 py-1.5 flex items-center justify-between text-[11px] font-mono ${palette.cardSubtle}`}>
                    <div className="flex items-center gap-1">
                      {[
                        { id: 'diff', label: 'DIFF (1)' },
                        { id: 'terminal', label: 'STDIO' },
                        { id: 'files', label: 'TRACE' }
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setHudTab(tab.id)}
                          className={`px-2 py-0.5 rounded text-[10px] ${
                            hudTab === tab.id ? palette.btnPrimary : palette.textSecondary
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <span className={`text-[10px] ${palette.textMuted}`}>READ-ONLY HUD</span>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-1">
                    {hudTab === 'diff' && pendingStep && pendingStep.diff ? (
                      <>
                        <div className={`text-[10px] mb-1.5 ${palette.textSecondary}`}>
                          // {pendingStep.file} (+{pendingStep.additions}, -{pendingStep.deletions})
                        </div>
                        {pendingStep.diff.map((d, i) => (
                          <div
                            key={i}
                            className={`px-2 py-0.5 rounded flex gap-2 ${
                              d.type === 'add'
                                ? palette.diffAddBg
                                : d.type === 'del'
                                ? palette.diffDelBg
                                : palette.textMuted
                            }`}
                          >
                            <span className="opacity-50 select-none w-6">
                              {d.lineNew || d.lineOld}
                            </span>
                            <span className="whitespace-pre overflow-x-auto">{d.code}</span>
                          </div>
                        ))}
                      </>
                    ) : hudTab === 'terminal' ? (
                      <div className={`space-y-1.5 ${palette.textSecondary}`}>
                        <div>$ cargo check --package deepseek-mcp</div>
                        <div className={palette.textMuted}>    Checking deepseek-mcp v0.4.2 (/workspace/src/mcp)</div>
                        <div className={palette.textMuted}>    Finished `dev` profile [unoptimized + debuginfo] in 1.14s</div>
                        <div className={palette.textPrimary}>
                          &gt; Waiting for user approval on `{activeTask.repo}`...
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {activeTask.reasoningFull.map((r, i) => (
                          <div key={i} className={palette.textSecondary}>
                            {r}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className={`flex-1 p-3 flex flex-col justify-between ${palette.dockBg}`}>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className={palette.textSecondary}>HARNESS CONTROLLER</span>
                      <span className={palette.textPrimary}>SESSION {activeTask.shortCode}</span>
                    </div>

                    <div className={`p-2.5 rounded-xl border ${palette.cardBg}`}>
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className={palette.textPrimary}>
                          {pendingStep ? pendingStep.label : 'All gates passed · Running tests'}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${palette.badgePending}`}>
                          {pendingStep ? 'HOLD' : 'AUTO'}
                        </span>
                      </div>
                      <p className={`text-[11px] mt-1 line-clamp-2 ${palette.textSecondary}`}>
                        {activeTask.reasoningSummary}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 my-1">
                    <button
                      onClick={() => handleDecision(activeTask.id, 'approve')}
                      disabled={!pendingStep}
                      className={`py-3 px-3 rounded-xl font-mono text-xs font-semibold flex items-center justify-between transition-transform active:scale-95 disabled:opacity-40 ${palette.btnPrimary}`}
                    >
                      <span>[A] ALLOW PATCH</span>
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDecision(activeTask.id, 'reject')}
                      disabled={!pendingStep}
                      className={`py-3 px-3 rounded-xl font-mono text-xs flex items-center justify-between transition-transform active:scale-95 disabled:opacity-40 ${palette.btnSecondary}`}
                    >
                      <span>[R] REJECT</span>
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setHudTab(hudTab === 'diff' ? 'terminal' : 'diff');
                        triggerToast('已切换上半屏监控视窗');
                      }}
                      className={`py-2.5 px-3 rounded-xl font-mono text-[11px] flex items-center justify-between ${palette.cardBg} border ${palette.textSecondary}`}
                    >
                      <span>SWITCH VIEW</span>
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setVoiceActive(!voiceActive);
                        triggerToast('已打开单手语音指令通道');
                      }}
                      className={`py-2.5 px-3 rounded-xl font-mono text-[11px] flex items-center justify-between ${palette.cardBg} border ${palette.textSecondary}`}
                    >
                      <span>VOICE STEER</span>
                      <Mic className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className={`pt-1.5 border-t border-current/10 flex items-center justify-between text-[10px] font-mono ${palette.textMuted}`}>
                    <span>BRANCH: {activeTask.branch}</span>
                    <span>LATENCY: 38ms</span>
                  </div>
                </div>
              </div>
            )}

            {/* Home Indicator Bar */}
            <div className="py-2 flex justify-center shrink-0">
              <div className={`w-28 h-1 rounded-full ${isDark ? 'bg-[#464640]' : 'bg-[#C4C1B8]'}`} />
            </div>
          </div>
        </div>

        {/* Right Column: Industry Benchmark Insights & Subtle UX Refinements */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card 1: 5 Quiet Yet High-Impact UX Polish Features */}
          <div className={`p-6 rounded-2xl border ${palette.panelBg} space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Zap className={`w-4 h-4 ${palette.textPrimary}`} />
                <h2 className={`text-base font-semibold ${palette.textPrimary}`}>
                  调研打磨：5 个「不喧宾夺主但显著提效」的原生级微交互
                </h2>
              </div>
              <span className={`text-[11px] font-mono ${palette.textMuted}`}>
                全部可在左侧手机模型中直接点按实测
              </span>
            </div>

            <p className={`text-xs leading-relaxed ${palette.textSecondary}`}>
              结合对 **Cursor iOS Background Agents**、**Claude Code Remote Control**、**Linear Mobile** 与 **Working Copy** 的深度交互拆解，移动端 Agent 控制器的核心痛点从来不是“功能不够多”，而是**小屏看 Diff 费劲、通勤单手容易误触高危按钮、以及修改局部代码打字太累**。为此我们在不增加视觉噪音的前提下注入了 5 项静默增强：
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {/* Feature 1 */}
              <div className={`p-3.5 rounded-xl border space-y-1.5 ${palette.cardBg}`}>
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${palette.textPrimary}`}>
                    1. 代码行点按即引用 (Tap-Line-to-Quote)
                  </span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${palette.cardSubtle} ${palette.textMuted}`}>
                    源自 Working Copy
                  </span>
                </div>
                <p className={`leading-relaxed ${palette.textSecondary}`}>
                  手机上选区复制代码极其痛苦。现在**直接点按 Diff 中的任意一行**，底部输入框上方会自动挂载 <code className="font-mono">引用 src/mcp/pool.rs:49</code> 胶囊，你只需说一句“把超时改成 10s”即可精准微调。
                </p>
              </div>

              {/* Feature 2 */}
              <div className={`p-3.5 rounded-xl border space-y-1.5 ${palette.cardBg}`}>
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${palette.textPrimary}`}>
                    2. 风险分级阻尼：常规轻点 vs 高危长按充能
                  </span>
                  <button
                    onClick={() => {
                      setScheme('A');
                      setActiveTaskId('t-105');
                      setExpandedDiff(true);
                    }}
                    className={`text-[10px] font-mono underline ${palette.textPrimary}`}
                  >
                    切至 #05 实测 →
                  </button>
                </div>
                <p className={`leading-relaxed ${palette.textSecondary}`}>
                  针对 Claude Code 社区反馈最多的“走路时大拇指误触 Allow 导致执行破坏性脚本”，低中风险补丁保持**单击秒批**，而遇到含 <code className="font-mono">rm -rf</code> 的高危操作（如会话 #05）自动切换为**长按 0.5s 充能放行**。
                </p>
              </div>

              {/* Feature 3 */}
              <div className={`p-3.5 rounded-xl border space-y-1.5 ${palette.cardBg}`}>
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${palette.textPrimary}`}>
                    3. 4 秒快照悔棋窗 (Grace Undo &amp; Checkpoint)
                  </span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${palette.cardSubtle} ${palette.textMuted}`}>
                    源自 Linear Mobile
                  </span>
                </div>
                <p className={`leading-relaxed ${palette.textSecondary}`}>
                  从不用二次确认弹窗打断心流，而是在批准/拒绝后浮现一枚 4 秒静默胶囊：<code className="font-mono">已存快照 cp-8f91a · [撤回拍板]</code>，手滑批错可一键无损回滚沙盒状态。
                </p>
              </div>

              {/* Feature 4 */}
              <div className={`p-3.5 rounded-xl border space-y-1.5 ${palette.cardBg}`}>
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${palette.textPrimary}`}>
                    4. 同类目录信任开关 + 自动跳栈 (Auto-Hop)
                  </span>
                  <button
                    onClick={() => setAutoHopNextGate(!autoHopNextGate)}
                    className={`text-[10px] font-mono underline ${palette.textPrimary}`}
                  >
                    跳栈: {autoHopNextGate ? '已开启' : '已关闭'}
                  </button>
                </div>
                <p className={`leading-relaxed ${palette.textSecondary}`}>
                  拇指坞右侧提供一键 <code className="font-mono">[信任目录]</code> 胶囊，授权后同一模块的后续补丁不再反复打扰；批复完当前会话后，自动丝滑切入下一个待审批会话（#01 → #04 → #05）。
                </p>
              </div>
            </div>

            {/* Feature 5 Full-Width */}
            <div className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${palette.cardSubtle}`}>
              <div className="space-y-1">
                <div className={`font-semibold ${palette.textPrimary}`}>
                  5. 1px 极简上下文水位线 &amp; 顶栏灵动胶囊 (Ambient Context Hairline)
                </div>
                <p className={palette.textSecondary}>
                  摒弃花哨的仪表盘，在手机屏幕最顶端边缘嵌入一条仅 <code className="font-mono">2px</code> 高的灰阶进度细线展示 Context Token 占用（如 22%），配合状态栏中央的灵动胶囊，点击即可在任意界面一键跳回阻塞中的 Agent。
                </p>
              </div>
              <button
                onClick={() => setDiffWordWrap(!diffWordWrap)}
                className={`px-3 py-1.5 rounded-lg border font-mono text-[11px] shrink-0 ${palette.cardBg} ${palette.textPrimary}`}
              >
                代码折行: {diffWordWrap ? '自动折行 (开启)' : '横向滚动'}
              </button>
            </div>
          </div>

          {/* Card 2: Motion & Hapticchoreography Spec */}
          <div className={`p-6 rounded-2xl border ${palette.panelBg} space-y-3`}>
            <h3 className={`text-sm font-semibold ${palette.textPrimary}`}>
              原生动效与触觉反馈（Haptics &amp; Spring Physics）工程落地参数
            </h3>
            <p className={`text-xs leading-relaxed ${palette.textSecondary}`}>
              参照 Emil Kowalski（Linear / Vercel 设计工程规范）与 Apple HIG，为了实现“有物理质感但不拖泥带水”的克制动效，建议在客户端（SwiftUI / React Native Reanimated / Flutter）中锁定以下参数：
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={`border-b border-current/10 font-mono text-[11px] ${palette.textMuted}`}>
                    <th className="py-2 pr-3">触发场景</th>
                    <th className="py-2 px-3">弹簧曲线参数 (Spring Physics)</th>
                    <th className="py-2 px-3">触觉反馈 (Haptic Engine)</th>
                    <th className="py-2 pl-3">视觉克制原则</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-current/10">
                  <tr>
                    <td className={`py-2.5 pr-3 font-medium ${palette.textPrimary}`}>
                      正式回答开始，&lt;think&gt; 自动折叠
                    </td>
                    <td className={`py-2.5 px-3 font-mono text-[11px] ${palette.textSecondary}`}>
                      stiffness: 380, damping: 34 (过阻尼无回弹)
                    </td>
                    <td className={`py-2.5 px-3 font-mono text-[11px] ${palette.textSecondary}`}>
                      Soft Impact (intensity: 0.35)
                    </td>
                    <td className={`py-2.5 pl-3 ${palette.textSecondary}`}>
                      锚定回答卡顶部，严禁页面剧烈上下弹跳
                    </td>
                  </tr>
                  <tr>
                    <td className={`py-2.5 pr-3 font-medium ${palette.textPrimary}`}>
                      右侧拇指弧形焦段转盘滑动
                    </td>
                    <td className={`py-2.5 px-3 font-mono text-[11px] ${palette.textSecondary}`}>
                      1:1 手指跟随 + 刻度吸附 (damping: 0.88)
                    </td>
                    <td className={`py-2.5 px-3 font-mono text-[11px] ${palette.textSecondary}`}>
                      UISelectionFeedbackGenerator (机械齿轮感)
                    </td>
                    <td className={`py-2.5 pl-3 ${palette.textSecondary}`}>
                      每扫过一个会话 Title 触发一次微弱机械棘轮震动
                    </td>
                  </tr>
                  <tr>
                    <td className={`py-2.5 pr-3 font-medium ${palette.textPrimary}`}>
                      底部拇指坞展开为方案 B 大卡
                    </td>
                    <td className={`py-2.5 px-3 font-mono text-[11px] ${palette.textSecondary}`}>
                      response: 0.30s, dampingFraction: 0.86
                    </td>
                    <td className={`py-2.5 px-3 font-mono text-[11px] ${palette.textSecondary}`}>
                      Light Impact (跨越 72pt 阈值时)
                    </td>
                    <td className={`py-2.5 pl-3 ${palette.textSecondary}`}>
                      背景采用 6px 柔光模糊，保留底层进度感知
                    </td>
                  </tr>
                  <tr>
                    <td className={`py-2.5 pr-3 font-medium ${palette.textPrimary}`}>
                      高危命令长按 0.5s 充能放行
                    </td>
                    <td className={`py-2.5 px-3 font-mono text-[11px] ${palette.textSecondary}`}>
                      线性充能 500ms · 松手 120ms 快速回退
                    </td>
                    <td className={`py-2.5 px-3 font-mono text-[11px] ${palette.textSecondary}`}>
                      渐强 CoreHaptics 脉冲 → NotificationSuccess
                    </td>
                    <td className={`py-2.5 pl-3 ${palette.textSecondary}`}>
                      用按钮内部暖砂色水位替代刺眼的红色警告弹窗
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}