import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';

import {
  formatTokens,
  type ApprovalDecision,
  type ApprovalRecord,
  type ChatMessage,
  type TokenUsage,
} from '../../protocol/chat';
import { describeTool, toolCommand, toolFailed } from '../tool-format';
import { tapFeedback } from '../haptics';
import { MONO, useTheme, useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * 轨迹视图：按角色着色的账本。
 *
 * 与对话视图互补——对话流里正文优先（思考/工具收成胶囊），这里每一次上下文注入、每一步工具、
 * 每一轮的结局都留一行，按发生顺序摊开，用来回查「刚才到底发生了什么」。
 *
 * 取舍（手机屏幕小，信息必须分层）：
 * - 一行一件事。正文默认压到 4 行，点这一行展开完整内容（思考全文 / 完整输出 / token 用量）。
 * - 上下文注入和审批记录都露出来，但各自只占一行，不展开就没有额外成本。
 * - 不做甘特图、不做三泳道时间线：手机宽度放不下；「跳到某一轮」已经由顶栏的轮次大纲负责。
 * - 不做子工具行（PTC dispatch）和 TTFT：前者只在 history 里有，实时帧只给 `{type}`，
 *   而且一次 run_code 能摊出几十行，账本会被撑爆；后者依赖被裁掉的 `data.stream`。
 * - 审批记录有两个来源：网关的审计事件对（`approval/asked` + `decided`，conversation 视图不裁），
 *   和本机拍板瞬间的回显（审计记录要等下一次重拉历史才回来，不然刚批完的那一行是空的）。
 */

interface Props {
  messages: ChatMessage[];
  /** 本机拍过的板，按时间插回消息流。 */
  approvals?: ApprovalRecord[];
  /** 会话是否在跑——没在跑时，没有输出的工具是「没输出」而不是「运行中」。 */
  running?: boolean;
}

type Role = 'user' | 'assistant' | 'tool' | 'context' | 'system' | 'gate';

/** 一行到位：canceled/unavailable 不是人的决定，别写成「你拒绝了」。 */
const APPROVAL_LABELS: Record<ApprovalDecision, string> = {
  approved: '已批准',
  denied: '已拒绝',
  canceled: '请求已撤回',
  unavailable: '无人应答',
};

function formatClock(time: number): string {
  return new Date(time).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}分${rest}秒` : `${minutes}分`;
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
}

/** 取第一行非空内容——账本上一行就够，细节留给展开。 */
function firstLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function usageText(usage: TokenUsage | undefined): string | undefined {
  if (!usage) return undefined;
  const parts = [
    usage.inputTokens !== undefined ? `入 ${formatTokens(usage.inputTokens)}` : undefined,
    usage.outputTokens !== undefined ? `出 ${formatTokens(usage.outputTokens)}` : undefined,
    usage.cacheReadTokens ? `缓存命中 ${formatTokens(usage.cacheReadTokens)}` : undefined,
    usage.reasoningTokens ? `思考 ${formatTokens(usage.reasoningTokens)}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/** 每秒走一次表，喂给「运行中 · 已 N 秒」；不 active 时定时器根本不存在。 */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * 审批按时间插回消息流。不能整体排序：实时草稿行的 time 是**回合开始**的时间，
 * 一排序就把它甩到最前面去。这里保持 messages 原序，只把每条审批插到最后一个不晚于它的消息后面。
 */
function mergeApprovals(messages: ChatMessage[], approvals: ApprovalRecord[]): ChatMessage[] {
  if (!approvals.length) return messages;
  const out: ChatMessage[] = [];
  let index = 0;
  for (const approval of approvals) {
    while (index < messages.length && messages[index].time <= approval.time) {
      out.push(messages[index]);
      index += 1;
    }
    out.push(approval);
  }
  while (index < messages.length) {
    out.push(messages[index]);
    index += 1;
  }
  return out;
}

export function TrajectoryView({ messages, approvals, running }: Props) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const rows = useMemo(() => mergeApprovals(messages, approvals ?? []), [messages, approvals]);

  /** 每一轮最早的可见时间 → 结论行的「用时」。 */
  const turnStarts = useMemo(() => {
    const starts = new Map<number, number>();
    for (const message of rows) {
      const turn = 'turn' in message ? message.turn : undefined;
      if (turn === undefined) continue;
      const previous = starts.get(turn);
      if (previous === undefined || message.time < previous) starts.set(turn, message.time);
    }
    return starts;
  }, [rows]);

  const now = useTicker(
    Boolean(running) &&
      rows.some((message) => message.kind === 'tool' && message.output === undefined),
  );

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    tapFeedback();
    setOpen((current) => ({ ...current, [id]: !current[id] }));
  };

  const roleColor = (role: Role): string => {
    switch (role) {
      case 'user':
        return t.role.user;
      case 'assistant':
        return t.role.assistant;
      case 'tool':
        return t.role.tool;
      case 'context':
        return t.role.context;
      case 'gate':
        return t.semantic.gateAmberText;
      default:
        return t.border.activeOrigin;
    }
  };

  const renderItem = ({ item }: { item: ChatMessage }) => {
    // 每轮结论：整行一条分隔线，同时兼任轮次分界。
    if (item.kind === 'outcome') {
      const started = item.turn === undefined ? undefined : turnStarts.get(item.turn);
      const tone =
        item.reason === 'error'
          ? t.semantic.dangerText
          : item.failed
            ? t.semantic.gateAmberText
            : t.text.muted;
      return (
        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: t.border.subtle }]} />
          <Text style={[styles.dividerText, { color: tone }]} numberOfLines={2}>
            {[
              item.turn === undefined ? undefined : `第 ${item.turn} 轮`,
              item.text,
              started === undefined ? undefined : formatDuration(item.time - started),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={[styles.dividerLine, { backgroundColor: t.border.subtle }]} />
        </View>
      );
    }

    const expanded = Boolean(open[item.id]);
    let role: Role = 'system';
    let who = '';
    let meta: string | undefined;
    let body: string | undefined;
    /** 展开后才显示的完整内容 */
    let detail: string | undefined;
    /** 有完整内容、或者正文被截了行 —— 两种情况都得能点开。 */
    let expandable = false;
    let color: string | undefined;
    let notes: string[] = [];
    /** 自己的话不截断，别的都先压成 4 行。 */
    let clamp = 4;
    /** 工具的结果行单独用弱色显示，从摘要里分出来。 */
    let result: string | undefined;

    if (item.kind === 'user' || item.kind === 'queued') {
      role = 'user';
      who = '你';
      const images = item.kind === 'user' ? (item.images?.length ?? 0) : (item.localUris?.length ?? 0);
      meta =
        [
          images ? `图片 ×${images}` : undefined,
          item.kind === 'queued'
            ? item.placement === 'steering'
              ? '插话'
              : item.pending
                ? '发送中'
                : '排队中'
            : undefined,
        ]
          .filter(Boolean)
          .join(' · ') || undefined;
      body = item.text || undefined;
      clamp = 0;
    } else if (item.kind === 'assistant') {
      role = 'assistant';
      const answer = item.text.trim();
      who = answer ? '助手' : '思考';
      const reasoningLength = item.reasoning?.trim().length ?? 0;
      meta = reasoningLength ? `思考 ${reasoningLength} 字` : undefined;
      // 失败原因必须在收起状态就看得见：失败轮的 text 是空的，
      // 只放进展开区的话这一行就剩个标题，等于把错误藏了。
      const failureLine = item.failure
        ? item.failure === 'aborted'
          ? '这一步被取消'
          : item.failure === 'interrupted'
            ? '这一步被中断'
            : `这一步失败：${item.failure}`
        : undefined;
      if (failureLine) color = t.semantic.dangerText;
      body = [answer, failureLine].filter(Boolean).join('\n') || undefined;
      detail = item.reasoning?.trim() || undefined;
      // 没有思考的纯回答也要能点开：正文默认压到 4 行，否则长回答就被永久截断了。
      expandable = Boolean(detail) || Boolean(body);
      notes = [
        usageText(item.usage),
        item.turn === undefined
          ? undefined
          : `第 ${item.turn} 轮${item.step === undefined ? '' : ` 第 ${item.step} 步`}`,
      ].filter(Boolean) as string[];
    } else if (item.kind === 'tool') {
      role = 'tool';
      who = item.name || '工具';
      const summary = describeTool(item.name, item.args);
      const failed = toolFailed(item.name, item.output, item.isError);
      const state =
        item.output === undefined
          ? running
            ? `运行中 · 已 ${formatDuration(now - item.time)}`
            : '没有输出'
          : failed
            ? item.errorCode
              ? `失败 · ${item.errorCode}`
              : '失败'
            : item.durationMs === undefined
              ? undefined
              : `耗时 ${formatDuration(item.durationMs)}`;
      meta = state;
      body = firstLine(toolCommand(item.name, item.args)) ?? summary ?? undefined;
      // 展开才是完整账目：完整参数 + 完整输出，各带一行小标题。
      detail =
        [
          item.args?.trim() ? `参数\n${item.args.trim()}` : undefined,
          item.output?.trim() ? `输出\n${item.output.trim()}` : undefined,
        ]
          .filter(Boolean)
          .join('\n\n') || undefined;
      expandable = Boolean(detail);
      const outputLine = firstLine(item.output);
      result = outputLine ? `→ ${outputLine}` : undefined;
      if (failed) color = t.semantic.dangerText;
      notes = [
        item.durationMs === undefined ? undefined : `耗时 ${formatDuration(item.durationMs)}`,
        item.turn === undefined
          ? undefined
          : `第 ${item.turn} 轮${item.step === undefined ? '' : ` 第 ${item.step} 步`}`,
        item.outputTruncated ? '输出过长，网关从中间省略了一段（保留首尾各 8000 字）' : undefined,
      ].filter(Boolean) as string[];
    } else if (item.kind === 'context') {
      role = 'context';
      who = '上下文';
      meta = item.tag;
      body = item.text;
      detail = item.detail?.trim() || undefined;
      expandable = Boolean(detail);
      clamp = 2;
    } else if (item.kind === 'approval') {
      role = 'gate';
      who = APPROVAL_LABELS[item.decision];
      // 只有本机回显知道是谁批的（seq 为空 = 还没进过历史）；审计记录读不到批的人。
      meta = item.seq === undefined ? (item.via ?? '本机决定') : undefined;
      body = item.target;
      clamp = 2;
      // 审批的说明文字可以是一整句（沙箱升权就是），收起两行放不下；点开看全文 + 来源说明。
      expandable = Boolean(body);
    } else if (item.kind === 'notice') {
      role = 'system';
      who = '通知';
      body = item.text;
      color = item.tone === 'warn' ? t.semantic.gateAmberText : undefined;
      // 压缩摘要是全文，收起时只占一行「上下文已压缩：…」。
      detail = item.detail?.trim() || undefined;
      expandable = Boolean(detail);
      clamp = 1;
    } else if (item.kind === 'files') {
      role = 'system';
      who = '交付文件';
      meta = item.files.length > 1 ? `${item.files.length} 个` : undefined;
      body = item.files.map((file) => file.path).join('\n');
      clamp = 0;
    }

    return (
      <View style={[styles.row, { borderLeftColor: roleColor(role) }]}>
        <Pressable
          style={styles.hit}
          onPress={expandable ? () => toggle(item.id) : undefined}
          disabled={!expandable}
          accessibilityRole={expandable ? 'button' : undefined}
          accessibilityLabel={
            expandable ? (expanded ? '收起这一行的完整内容' : '展开这一行的完整内容') : undefined
          }
        >
          <View style={styles.head}>
            <Text style={[styles.who, { color: color ?? roleColor(role) }]} numberOfLines={1}>
              {who}
            </Text>
            {meta ? (
              <Text style={styles.meta} numberOfLines={1}>
                {meta}
              </Text>
            ) : null}
            <Text style={styles.time}>{formatClock(item.time)}</Text>
            {expandable ? <Text style={styles.chevron}>{expanded ? '⌃' : '⌄'}</Text> : null}
          </View>
          {body ? (
            <Text
              style={[styles.body, { color: t.text.secondary }]}
              numberOfLines={expanded || clamp === 0 ? undefined : clamp}
            >
              {body}
            </Text>
          ) : null}
          {result ? (
            <Text style={styles.result} numberOfLines={expanded ? undefined : 1}>
              {result}
            </Text>
          ) : null}
          {expanded && detail ? (
            <View style={styles.detailBox}>
              <Text style={styles.detailText}>{detail}</Text>
            </View>
          ) : null}
          {expanded && notes.length ? (
            <Text style={styles.detailNote}>{notes.join(' · ')}</Text>
          ) : null}
          {expanded && item.kind === 'approval' ? (
            <Text style={styles.detailNote}>
              {item.seq === undefined
                ? '本机回显：重拉历史后由网关的审计记录接替这一行。'
                : '审计记录只留工具名和说明文字，参数在对应的工具行上。'}
            </Text>
          ) : null}
        </Pressable>
      </View>
    );
  };

  const hasApprovals = rows.some((message) => message.kind === 'approval');

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      initialNumToRender={24}
      maxToRenderPerBatch={24}
      ListFooterComponent={
        hasApprovals ? (
          <Text style={styles.footer}>
            审批记录来自网关的审计事件（approval/asked + approval/decided）：
            本机刚拍完板的那一条会先以回显出现，拉到历史后由审计记录接替。
          </Text>
        ) : undefined
      }
    />
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    list: { paddingHorizontal: 12, paddingBottom: 16, gap: 8 },
    row: {
      borderLeftWidth: 2,
      borderLeftColor: t.border.subtle,
      paddingLeft: 10,
      paddingVertical: 3,
    },
    hit: { gap: 3 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    who: { fontSize: 12, fontWeight: '700', flexShrink: 0 },
    meta: { color: t.text.muted, fontSize: 10.5, flexShrink: 1, fontFamily: MONO },
    time: {
      color: t.text.muted,
      fontSize: 10,
      fontFamily: MONO,
      fontVariant: ['tabular-nums'],
      marginLeft: 'auto',
      paddingLeft: 6,
    },
    chevron: { color: t.text.muted, fontSize: 11, fontFamily: MONO },
    body: { fontSize: 11.5, lineHeight: 16.5, fontFamily: MONO },
    result: { color: t.text.muted, fontSize: 11, lineHeight: 15, fontFamily: MONO },
    detailBox: {
      marginTop: 3,
      paddingLeft: 8,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: t.border.default,
    },
    detailText: { color: t.text.secondary, fontSize: 11, lineHeight: 15.5, fontFamily: MONO },
    detailNote: { color: t.text.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
    dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6 },
    dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
    dividerText: { fontSize: 10.5, fontVariant: ['tabular-nums'] },
    footer: {
      color: t.text.muted,
      fontSize: 10,
      lineHeight: 14,
      marginTop: 14,
      paddingHorizontal: 2,
    },
  });
