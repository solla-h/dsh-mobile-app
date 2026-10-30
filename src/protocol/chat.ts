/** 把历史事件与实时事件归一成 App 内部的消息模型。 */

import { presentedFilesOf, type PresentedFile } from './files';
import type { ImageAttachmentRef } from './types';

export interface QueuedMessage {
  id: string;
  text: string;
  /** queued=等这一轮结束；steering=已插进当前回合，下一步生效 */
  placement?: string;
}

/** 会话队列：agent 还在跑的时候，新消息会先排在这里，不是丢了。 */
export function mapQueue(items: unknown): QueuedMessage[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const raw = (item ?? {}) as { id?: unknown; placement?: unknown; message?: { content?: unknown } };
      const text = textOfBlocks(raw.message?.content);
      const hasImage = imagesOfBlocks(raw.message?.content).length > 0;
      return {
        id: typeof raw.id === 'string' ? raw.id : '',
        // 纯图片的排队消息也要显示出来，否则它会在队列里「消失」。
        text: text || (hasImage ? '［图片］' : ''),
        placement: typeof raw.placement === 'string' ? raw.placement : undefined,
      };
    })
    .filter((item) => item.id && item.text);
}

export type ChatMessage =
  | {
      id: string;
      kind: 'user';
      text: string;
      time: number;
      seq?: number;
      /** 图片块只带引用，字节要用 attachment 请求单独取。 */
      images?: ImageAttachmentRef[];
      turn?: number;
    }
  | {
      id: string;
      kind: 'queued';
      text: string;
      time: number;
      queueId: string;
      placement?: string;
      /** 本地乐观回显：还没被服务端确认 */
      pending?: boolean;
      /** 断线时写进发件箱、等重连后自动重发 */
      offline?: boolean;
      /** 服务端明确拒收了这条消息，本地回显要标出来，别一直转圈 */
      failed?: boolean;
      /** 本地回显用的图片 uri（还没上传，拿不到 attachmentId） */
      localUris?: string[];
    }
  | {
      id: string;
      kind: 'notice';
      text: string;
      time: number;
      seq?: number;
      /** 轨迹页据此上色：warn 走琥珀，其余走灰。 */
      tone?: 'info' | 'warn';
      /** llm/retry 的合并标记：同一步的重试只留一行，count 是重试次数。 */
      retry?: RetryMark;
      /** 展开后才看得到的正文：目前只有压缩摘要（history 里带全文）。 */
      detail?: string;
    }
  | {
      id: string;
      kind: 'assistant';
      text: string;
      reasoning?: string;
      time: number;
      seq?: number;
      streaming?: boolean;
      failure?: string;
      turn?: number;
      step?: number;
      usage?: TokenUsage;
    }
  | {
      id: string;
      kind: 'tool';
      name: string;
      callId?: string;
      args?: string;
      output?: string;
      /** 输出被网关从中间截断过（限长 16000），UI 要说明「中间省略」。 */
      outputTruncated?: boolean;
      isError?: boolean;
      errorCode?: string;
      time: number;
      seq?: number;
      turn?: number;
      step?: number;
      /** tool/call → tool/result 的耗时。 */
      durationMs?: number;
    }
  | {
      id: string;
      kind: 'files';
      /** 本轮交付的文件卡片；字节按需下载，不进消息模型 */
      files: PresentedFile[];
      turn?: number;
      time: number;
      seq?: number;
    }
  /**
   * 注入的上下文（skill 调用 / agent instructions / 会话引用等）。
   * 对话流里完全隐藏，轨迹页里默认折叠——它不是用户说的话，但「刚才是哪个 skill 在跑」要能查到。
   */
  | {
      id: string;
      kind: 'context';
      /** source.kind，如 skill-invocation / agent-instructions */
      tag: string;
      /** 一行摘要：skill 名 / 变更的文件路径 / 引用的会话（见 contextLabel） */
      text: string;
      /** 注入的正文，折叠时看不到；网关实时帧只把 source 拍成 kind 字符串，这时没有正文 */
      detail?: string;
      time: number;
      seq?: number;
      turn?: number;
    }
  /** 每轮结论：turn/end 的 reason，回答之外的「这轮是怎么结束的」。 */
  | {
      id: string;
      kind: 'outcome';
      turn?: number;
      /** 原始 reason，如 success / error / aborted */
      reason: string;
      text: string;
      failed: boolean;
      time: number;
      seq?: number;
    }
  /**
   * 审批记录。两个来源：网关 history 里的一对审计事件（`approval/asked` +
   * `approval/decided`，conversation 视图不裁，见 trimConversationEvent 的 default 分支），
   * 和本机拍板瞬间的回显（宿主的审计事件要等下一次重拉历史才到）。
   */
  | {
      id: string;
      kind: 'approval';
      /** 只有 approved/denied 是人的决定；canceled/unavailable 是撤回和无人应答。 */
      decision: ApprovalDecision;
      /** 被批准/拒绝的那个动作，取工具名 + 一行摘要 */
      target: string;
      /** 工具调用 id：把本机回显和后来拉到的历史审计记录对上，不然会画两遍 */
      callId?: string;
      /** 谁批的：本机手点 / 目录信任自动放行。历史审计记录不带这个，读不到就留空。 */
      via?: string;
      /** 回显属于哪个会话——SessionScreen 切会话时不会卸载，日志得自己按会话分。 */
      sessionId?: string;
      time: number;
      seq?: number;
      turn?: number;
    };

/**
 * 本机回显的那一条审批记录（seq 为空的那个）。
 * 历史里的审计记录走同一个类型，但由 mapHistory 直接产出，不经过这里。
 */
export type ApprovalRecord = Extract<ChatMessage, { kind: 'approval' }>;

export type ApprovalDecision = 'approved' | 'denied' | 'canceled' | 'unavailable';

/**
 * 宿主的 ApprovalOutcome（'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'）
 * → 轨迹页的四种状态。后两种不是人的决定：cancelled 是请求被撤回（回合中断），
 * unavailable 是应答链没人接，宿主按 fail-closed 处理。
 * 认不出的取值返回 undefined，宁可不画，也不要画成「你拒绝了」。
 */
export function approvalDecision(outcome: string): ApprovalDecision | undefined {
  if (outcome === 'allowed-once') return 'approved';
  if (outcome === 'rejected') return 'denied';
  if (outcome === 'cancelled') return 'canceled';
  if (outcome === 'unavailable') return 'unavailable';
  return undefined;
}

/** 一次模型重试的记号：同一步的连续重试靠它合并成一行。 */
interface RetryMark {
  turn?: number;
  step?: number;
  count: number;
  /** 上游给的原因摘要（见 failureBrief） */
  why?: string;
  max?: number;
}

/**
 * 上游失败信息常常是一整坨 JSON（一次 429 能带上千字符），
 * 手机上只留能认出来的一行：错误码 → HTTP 状态 → 压平截断的 message。
 */
function failureBrief(failure: Record<string, any> | null | undefined, max = 80): string | undefined {
  const code = nonEmpty(failure?.code);
  if (code) return code;
  if (typeof failure?.status === 'number') return `HTTP ${failure.status}`;
  const message = nonEmpty(failure?.message);
  if (!message) return undefined;
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function retryText(mark: RetryMark): string {
  const head = `模型请求失败${mark.why ? `（${mark.why}）` : ''}`;
  const tail = mark.max ? `（上限 ${mark.max} 次）` : '';
  return mark.count > 1 ? `${head}，已重试 ${mark.count} 次${tail}` : `${head}，正在重试${tail}`;
}

/**
 * 追加一条重试通知：同一步的连续重试并进上一行（只改次数，不新开行）。
 * 一次风控重试能连打五六发，摊成五行就把轨迹页占满了。就地改传进来的数组。
 */
function appendRetry(
  messages: ChatMessage[],
  row: { id: string; seq?: number; time: number },
  mark: RetryMark,
): void {
  const last = messages[messages.length - 1];
  if (
    last &&
    last.kind === 'notice' &&
    last.retry &&
    last.retry.turn === mark.turn &&
    last.retry.step === mark.step
  ) {
    const merged: RetryMark = { ...last.retry, ...mark, count: last.retry.count + 1 };
    messages[messages.length - 1] = { ...last, text: retryText(merged), retry: merged };
    return;
  }
  messages.push({
    id: row.id,
    kind: 'notice',
    text: retryText(mark),
    tone: 'warn',
    time: row.time,
    seq: row.seq,
    retry: mark,
  });
}

/** assistant/message 的 usage：网关原样转发宿主的上游用量，字段可能缺。 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  reasoningTokens?: number;
}

export interface HistoryEvent {
  type: string;
  seq: number;
  time: number;
  data?: Record<string, unknown>;
}

type Block = { type?: string; text?: string; thinking?: string; reasoning?: string };

/**
 * 拆分内嵌在正文中的 `<think>...</think>` 标签（DeepSeek-R1 流式或历史常见形态）。
 * 若还处于未闭合的 `<think>` 流式生成中，则拆为 reasoning + 空正文。
 */
export function splitThinkTags(rawText: string): { text: string; reasoning?: string } {
  if (!rawText.includes('<think>')) return { text: rawText };
  const thinkBlocks: string[] = [];
  let cleaned = rawText.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, inner: string) => {
    if (inner.trim()) thinkBlocks.push(inner.trim());
    return '';
  });
  // 检查是否还有未闭合的 <think>（流式输出 Stage 01 正在打字机展开阶段）
  const openIdx = cleaned.indexOf('<think>');
  if (openIdx >= 0) {
    const partial = cleaned.slice(openIdx + '<think>'.length).trim();
    if (partial) thinkBlocks.push(partial);
    cleaned = cleaned.slice(0, openIdx);
  }
  return {
    text: cleaned.trimStart(),
    reasoning: thinkBlocks.length > 0 ? thinkBlocks.join('\n\n') : undefined,
  };
}

function textOfBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((block) => {
      const typed = block as Block;
      if (typed?.type === 'text' && typeof typed.text === 'string') return typed.text;
      return '';
    })
    .filter(Boolean)
    .join('');
}

function reasoningOfBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((block) => {
      const typed = block as Block;
      if (
        (typed?.type === 'thinking' || typed?.type === 'reasoning') &&
        typeof (typed.thinking ?? typed.reasoning ?? typed.text) === 'string'
      ) {
        return (typed.thinking ?? typed.reasoning ?? typed.text) as string;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/** 用户消息里的图片块：{type:"image", attachment:{attachmentId,...}}。 */
function imagesOfBlocks(blocks: unknown): ImageAttachmentRef[] {
  if (!Array.isArray(blocks)) return [];
  const out: ImageAttachmentRef[] = [];
  for (const block of blocks) {
    const typed = block as { type?: string; attachment?: ImageAttachmentRef };
    if (typed?.type === 'image' && typed.attachment?.attachmentId) out.push(typed.attachment);
  }
  return out;
}

function stringifyArgs(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function asRecord(value: unknown): Record<string, any> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** usage 是宿主原样透传的，字段可能一个都没有——全空就当没有用量。 */
function usageOf(raw: unknown): TokenUsage | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const usage: TokenUsage = {
    inputTokens: positiveInt(record.inputTokens),
    outputTokens: positiveInt(record.outputTokens),
    cacheReadTokens: positiveInt(record.cacheReadTokens),
    reasoningTokens: positiveInt(record.reasoningTokens),
  };
  const kept = Object.entries(usage).filter(([, value]) => value !== undefined);
  return kept.length ? (Object.fromEntries(kept) as TokenUsage) : undefined;
}

/**
 * `turn/end.reason` 两种形状：history 里是宿主原对象 `{kind}`，
 * 实时投影里网关已经拍平成 kind 字符串。
 */
function reasonKind(reason: unknown): string | undefined {
  if (typeof reason === 'string') return reason || undefined;
  return nonEmpty(asRecord(reason)?.kind);
}

/** 终态原因 → 结论行的文案与是否算「不正常结束」（不正常才在对话流里露一行）。 */
export function outcomeOf(reason: string, detail?: string): { text: string; failed: boolean } {
  const suffix = detail ? `：${detail}` : '';
  switch (reason) {
    case 'success':
    case 'stop':
    case 'completed':
    case 'done':
      return { text: '本轮正常结束', failed: false };
    case 'aborted':
    case 'cancelled':
    case 'canceled':
      return { text: `本轮已取消${suffix}`, failed: true };
    case 'interrupted':
      return { text: `本轮被中断${suffix}`, failed: true };
    case 'error':
      return { text: `本轮出错${suffix}`, failed: true };
    default:
      // 未知 reason 保留原样，但不当成失败——没见过的值不该把界面染红。
      return { text: `本轮结束（${reason}）`, failed: false };
  }
}

/**
 * 注入上下文的单行摘要。规则照抄 Web 轨迹页的 contextProducer
 * （packages/client/ui-trajectory/src/client/trajectory-event-projection.ts:60），
 * 手机端少一两类也不要紧，认不出来就退回 kind 本身。
 */
export function contextLabel(source: Record<string, any>, fallbackText: string): string {
  const kind = nonEmpty(source.kind) ?? 'context';
  const join = (list: unknown, field: string): string | undefined => {
    if (!Array.isArray(list)) return undefined;
    const seen: string[] = [];
    for (const entry of list) {
      const value = nonEmpty(asRecord(entry)?.[field]);
      if (value && !seen.includes(value)) seen.push(value);
    }
    return seen.length ? seen.join('、') : undefined;
  };
  if (kind === 'session-reference') return join(source.references, 'label') ?? kind;
  if (kind === 'agent-instructions') return join(source.changes, 'path') ?? kind;
  if (kind === 'skill-invocation') return nonEmpty(source.name) ?? kind;
  // 认不出的 kind：用注入正文的首行兜底，空注入就只显示 kind。
  const fallback = fallbackText.split('\n')[0]?.trim();
  return (
    nonEmpty(source.label) ??
    nonEmpty(source.summary) ??
    nonEmpty(source.name) ??
    nonEmpty(fallback) ??
    kind
  );
}

/**
 * developer/message 的工具增删块 → 一行 `+bash -write`。
 * 认不出的块类型或空列表返回 undefined，让 contextLabel 走它自己的兜底链。
 */
function toolRegistryLabel(blocks: unknown): string | undefined {
  if (!Array.isArray(blocks)) return undefined;
  const marks: string[] = [];
  for (const block of blocks) {
    const typed = asRecord(block);
    const name = nonEmpty(typed?.toolName);
    if (!name) continue;
    marks.push(typed?.type === 'tool-removal' ? `-${name}` : `+${name}`);
  }
  return marks.length ? marks.join(' ') : undefined;
}

/**
 * turn/end 的终态细节：错误 message/code 最有诊断价值。
 * 两条路给的形状不一样——实时帧是网关算好的 `reasonDetails.error`，
 * history 给的是宿主原始 `reason`，错误挂在 `reason.error` / `reason.failure` 上。
 */
function outcomeDetail(data: Record<string, any>): string | undefined {
  const reason = asRecord(data.reason);
  const error =
    asRecord(asRecord(data.reasonDetails)?.error) ??
    asRecord(reason?.error) ??
    asRecord(reason?.failure);
  // 截到 48 字：这条要跟「第 N 轮 / 用时」挤在分隔线的两行里，
  // 上游那种上千字的 429 JSON 会把后面的用时整个挤掉。
  return failureBrief(error, 48) ?? nonEmpty(error?.reason);
}

/** 上下文行——history 与实时两条路都往这里收，实时拿不到 source 细节。 */
function contextMessage(event: { id: string; time: number; seq?: number }, source: Record<string, any>, content: string, turn?: number): ChatMessage {
  return {
    id: event.id,
    kind: 'context',
    tag: nonEmpty(source.kind) ?? 'context',
    text: contextLabel(source, content),
    ...(content ? { detail: content } : {}),
    time: event.time,
    ...(event.seq === undefined ? {} : { seq: event.seq }),
    ...(turn === undefined ? {} : { turn }),
  };
}

/** 历史接口返回的是原始 SessionEvent：{type, seq, time, data}。 */
export function mapHistory(events: HistoryEvent[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const toolIndex = new Map<string, number>();
  /** approval/asked 的信息要留着配 approval/decided——工具名和 callId 只在 asked 上。 */
  const askedApprovals = new Map<string, { toolName?: string; callId?: string; reason?: string }>();
  for (const event of events) {
    const data = (event.data ?? {}) as Record<string, any>;
    switch (event.type) {
      case 'user/message': {
        const source = asRecord(data.source) ?? {};
        const sourceKind = nonEmpty(source.kind);
        if (sourceKind && sourceKind !== 'user') {
          if (sourceKind === 'model-selection') {
            const summary = source.summary;
            out.push({
              id: `h${event.seq}`,
              kind: 'notice',
              text: summary ? `模型切换：${summary}` : '模型已切换',
              time: event.time,
              seq: event.seq,
            });
          } else {
            // Harness 注入的上下文（skill / agent instructions / 会话引用 / 运行时快照）：
            // 对话流里隐藏，轨迹页里默认折叠——「刚才是哪个 skill 在跑」要查得到。
            out.push(
              contextMessage(
                { id: `h${event.seq}`, time: event.time, seq: event.seq },
                source,
                textOfBlocks(data.content),
                positiveInt(data.turn),
              ),
            );
          }
          break;
        }
        const text = textOfBlocks(data.content);
        const images = imagesOfBlocks(data.content);
        if (text || images.length) {
          out.push({
            id: `h${event.seq}`,
            kind: 'user',
            text,
            time: event.time,
            seq: event.seq,
            images: images.length ? images : undefined,
            turn: positiveInt(data.turn),
          });
        }
        break;
      }
      // developer/message：模型可见面上的工具增删（source.kind = 'tool-registry'，
      // content 是 {type:'tool-addition'|'tool-removal', toolName}）。
      // Web 的轨迹页把它和 user/message 一视同仁地当上下文行，这里也一样。
      case 'developer/message': {
        const message = asRecord(data.message) ?? {};
        const source = asRecord(message.source) ?? {};
        const tools = toolRegistryLabel(message.content);
        out.push(
          contextMessage(
            { id: `h${event.seq}`, time: event.time, seq: event.seq },
            tools ? { ...source, summary: tools } : source,
            textOfBlocks(message.content),
            positiveInt(data.turn),
          ),
        );
        break;
      }
      case 'assistant/message': {
        const rawText = textOfBlocks(data.message?.content);
        const parsed = splitThinkTags(rawText);
        const blockReasoning = reasoningOfBlocks(data.message?.content);
        const directReasoning =
          (typeof data.reasoning === 'string' && data.reasoning) ||
          (typeof data.message?.reasoning === 'string' && data.message.reasoning) ||
          undefined;
        const reasoning =
          [directReasoning, blockReasoning, parsed.reasoning].filter(Boolean).join('\n\n') ||
          undefined;
        const text = parsed.text;
        const finishKind = (data.finish as { kind?: string } | undefined)?.kind;
        // interrupted 是宿主单独给的标记，不一定带 finish——两者都要认。
        const failure =
          finishKind === 'error' || finishKind === 'aborted'
            ? finishKind
            : data.interrupted === true
              ? 'interrupted'
              : undefined;
        if (text || reasoning || failure) {
          out.push({
            id: `h${event.seq}`,
            kind: 'assistant',
            text,
            ...(reasoning ? { reasoning } : {}),
            time: event.time,
            seq: event.seq,
            failure,
            turn: positiveInt(data.turn),
            step: positiveInt(data.step),
            usage: usageOf(data.usage),
          });
        }
        break;
      }
      case 'deliverables/presented': {
        const files = presentedFilesOf(data.files);
        if (files.length) {
          out.push({
            id: `h${event.seq}`,
            kind: 'files',
            files,
            turn: typeof data.turn === 'number' ? data.turn : undefined,
            time: event.time,
            seq: event.seq,
          });
        }
        break;
      }
      case 'tool/call': {
        if (typeof data.callId === 'string') toolIndex.set(data.callId, out.length);
        out.push({
          id: `h${event.seq}`,
          kind: 'tool',
          name: typeof data.name === 'string' ? data.name : 'tool',
          callId: typeof data.callId === 'string' ? data.callId : undefined,
          args: stringifyArgs(data.arguments),
          time: event.time,
          seq: event.seq,
          turn: positiveInt(data.turn),
          step: positiveInt(data.step),
        });
        break;
      }
      case 'tool/result': {
        const message = (data.message ?? {}) as Record<string, any>;
        const callId =
          (typeof data.callId === 'string' && data.callId) ||
          (typeof message.toolCallId === 'string' && message.toolCallId) ||
          (typeof message.source?.callId === 'string' && message.source.callId) ||
          undefined;
        const index = callId ? toolIndex.get(callId) : undefined;
        if (index !== undefined) {
          const previous = out[index];
          if (previous && previous.kind === 'tool') {
            const error = asRecord(data.error);
            // 历史里没有顶层 isError（那是实时帧的投影）：网关自己就是这么算的，
            // 三个位置任一为真即失败——message.isError、有 error、content 里的结果块标了错。
            const blockIsError = (Array.isArray(message.content) ? message.content : []).some(
              (block) => asRecord(block)?.type === 'tool-result' && asRecord(block)?.isError === true,
            );
            out[index] = {
              ...previous,
              output:
                (data.output as string) ??
                textOfBlocks(message.content) ??
                (data.preview as string) ??
                previous.output,
              outputTruncated: data.outputTruncated === true ? true : undefined,
              isError:
                blockIsError ||
                Boolean(data.isError ?? data.meta?.isError ?? message.isError ?? data.error),
              errorCode: nonEmpty(error?.code) ?? nonEmpty(data.error),
              // 耗时 = call → result 的时间差。审批等待也算在里面，
              // 轨迹上那条审批记录就挨着，看得出来时间花在哪。
              durationMs: event.time - previous.time,
            };
          }
        }
        break;
      }
      case 'turn/end': {
        const reason = reasonKind(data.reason);
        if (!reason) break;
        const { text, failed } = outcomeOf(reason, outcomeDetail(data));
        out.push({
          id: `h${event.seq}`,
          kind: 'outcome',
          turn: positiveInt(data.turn),
          reason,
          text,
          failed,
          time: event.time,
          seq: event.seq,
        });
        break;
      }
      case 'compaction/summary': {
        const items = positiveInt(data.shadowedItemCount) ?? (Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs.length : undefined);
        const tokens = positiveInt(data.shadowedTokenCount);
        const parts = [
          items ? `${items} 项` : undefined,
          tokens ? `${formatTokens(tokens)} token` : undefined,
        ].filter(Boolean);
        out.push({
          id: `h${event.seq}`,
          kind: 'notice',
          text: parts.length ? `上下文已压缩：折叠 ${parts.join(' / ')}` : '上下文已压缩',
          tone: 'warn',
          // 摘要正文 history 里是全文（conversation 视图不裁），折叠放展开区。
          ...(nonEmpty(data.summary) ? { detail: nonEmpty(data.summary)! } : {}),
          time: event.time,
          seq: event.seq,
        });
        break;
      }
      case 'compaction/end': {
        const error = nonEmpty(data.error);
        if (!error) break;
        out.push({
          id: `h${event.seq}`,
          kind: 'notice',
          text: `上下文压缩失败：${error}`,
          tone: 'warn',
          time: event.time,
          seq: event.seq,
        });
        break;
      }
      case 'llm/retry': {
        appendRetry(
          out,
          { id: `h${event.seq}`, seq: event.seq, time: event.time },
          {
            turn: positiveInt(data.turn),
            step: positiveInt(data.step),
            count: 1,
            why: failureBrief(asRecord(data.failure)),
            max: positiveInt(data.maxRetries),
          },
        );
        break;
      }
      // 审批的审计事件对：asked 先来（带工具名和 callId），decided 随后配对。
      // 宿主保证一次 asked 恰好跟一条 decided，所以这里不预设「等待中」的行。
      case 'approval/asked': {
        const id = nonEmpty(data.id);
        if (!id) break;
        askedApprovals.set(id, {
          toolName: nonEmpty(data.toolName),
          callId: nonEmpty(data.callId),
          reason: nonEmpty(data.reason),
        });
        break;
      }
      case 'approval/decided': {
        const id = nonEmpty(data.id);
        const outcome = nonEmpty(data.outcome);
        const decision = outcome && approvalDecision(outcome);
        if (!decision) break;
        const asked = id ? askedApprovals.get(id) : undefined;
        out.push({
          id: `h${event.seq}`,
          kind: 'approval',
          decision,
          // asked 里没有 displayReason，也没有工具参数，能显示的就这两样。
          target: [asked?.toolName, asked?.reason].filter(Boolean).join(' · ') || '工具调用',
          ...(asked?.callId ? { callId: asked.callId } : {}),
          // 时间取 decided：问句是什么时候问的不重要，拍板时刻才是账本上要对齐的那个。
          time: event.time,
          seq: event.seq,
        });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** 大数字压成 1.2k / 3.4M，轨迹页上不占宽度。 */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function seqOf(message: ChatMessage): number | undefined {
  return 'seq' in message && typeof message.seq === 'number' ? message.seq : undefined;
}

/**
 * 把更早一页历史并到列表前面。
 * 服务端分页是排他游标，理论上不会重叠，但重连/重试可能重发同一页，所以按 seq 去重。
 */
export function prependHistory(current: ChatMessage[], older: HistoryEvent[]): ChatMessage[] {
  if (older.length === 0) return current;
  const seen = new Set<number>();
  for (const message of current) {
    const seq = seqOf(message);
    if (seq !== undefined) seen.add(seq);
  }
  const fresh = mapHistory(older).filter((message) => {
    const seq = seqOf(message);
    return seq === undefined || !seen.has(seq);
  });
  if (fresh.length === 0) return current;
  return [...fresh, ...current];
}

/**
 * 订阅快照只是「最新一段」，replace 只对快照自己覆盖的区间 [oldest, newest] 成立：
 * - 比 oldest 更早的：是翻页翻出来的历史，必须保留；
 * - 比 newest 更新的：是快照生成之后才到的实时消息，也必须保留；
 * - 区间内：以快照为准。
 * 直接整体替换会两头都丢，所以按 seq 做区间合并。
 */
export function mergeSnapshot(current: ChatMessage[], snapshot: HistoryEvent[]): ChatMessage[] {
  if (snapshot.length === 0) return current;
  const mapped = mapHistory(snapshot);
  if (mapped.length === 0) return current;
  const seqValues = snapshot.map((event) => event.seq);
  const oldest = Math.min(...seqValues);
  const newest = Math.max(...seqValues);
  const before: ChatMessage[] = [];
  const after: ChatMessage[] = [];
  const unsequenced: ChatMessage[] = [];
  for (const message of current) {
    const seq = seqOf(message);
    if (seq === undefined) unsequenced.push(message);
    else if (seq < oldest) before.push(message);
    else if (seq > newest) after.push(message);
  }
  const existing = new Set<number>();
  for (const message of before) {
    const seq = seqOf(message);
    if (seq !== undefined) existing.add(seq);
  }
  const added = mapped.filter((message) => {
    const seq = seqOf(message);
    return seq === undefined || !existing.has(seq);
  });
  const next = [...before, ...added, ...after, ...unsequenced];
  const unchanged =
    next.length === current.length && next.every((message, index) => message === current[index]);
  return unchanged ? current : next;
}

/** 实时 event 帧用的是精简投影：assistant/message 直接带 text/reasoning。 */
export function applyRealtime(
  messages: ChatMessage[],
  event: Record<string, any>,
  seq: number,
  time: number,
): ChatMessage[] {
  if (messages.some((message) => 'seq' in message && message.seq === seq)) return messages;
  switch (event.type) {
    case 'user/message': {
      const source = event.source as string | { kind?: string } | undefined;
      const sourceKind = typeof source === 'string' ? source : source?.kind;
      if (sourceKind && sourceKind !== 'user') {
        if (sourceKind === 'model-selection') {
          const summary = (source as { summary?: string }).summary;
          return [
            ...messages,
            { id: `r${seq}`, kind: 'notice', text: summary ? `模型切换：${summary}` : '模型已切换', time, seq },
          ];
        }
        // 实时投影只把 source 拍成 kind 字符串，摘要拿不到细节，只能显示 kind；
        // 重拉历史后会补上 skill 名 / 文件路径。
        return [...messages, contextMessage({ id: `r${seq}`, time, seq }, { kind: sourceKind }, typeof event.text === 'string' ? event.text : '')];
      }
      const text = typeof event.text === 'string' ? event.text : '';
      const images = Array.isArray(event.images) ? (event.images as ImageAttachmentRef[]).filter((i) => i?.attachmentId) : [];
      if (!text && images.length === 0) return messages;
      return [
        ...messages,
        { id: `r${seq}`, kind: 'user', text, time, seq, images: images.length ? images : undefined, turn: positiveInt(event.turn) },
      ];
    }
    case 'assistant/message': {
      const rawText = typeof event.text === 'string' ? event.text : '';
      const parsed = splitThinkTags(rawText);
      const directReasoning =
        typeof event.reasoning === 'string' && event.reasoning ? event.reasoning : undefined;
      const reasoning = [directReasoning, parsed.reasoning].filter(Boolean).join('\n\n') || undefined;
      const text = parsed.text;
      const finishKind = (event.finish as { kind?: string } | undefined)?.kind;
      const failure =
        finishKind === 'error' || finishKind === 'aborted'
          ? finishKind
          : event.interrupted === true
            ? 'interrupted'
            : undefined;
      if (!text && !reasoning && !failure) return messages;
      return [
        ...messages,
        {
          id: `r${seq}`,
          kind: 'assistant',
          text,
          reasoning,
          time,
          seq,
          failure,
          turn: positiveInt(event.turn),
          step: positiveInt(event.step),
          usage: usageOf(event.usage),
        },
      ];
    }
    case 'deliverables/presented': {
      // 实时帧把 turn/callId/files 放在 event 顶层，历史放在 data 里，形状一致。
      const files = presentedFilesOf(event.files);
      if (!files.length) return messages;
      return [
        ...messages,
        {
          id: `r${seq}`,
          kind: 'files',
          files,
          turn: typeof event.turn === 'number' ? dataTurn(event.turn) : undefined,
          time,
          seq,
        },
      ];
    }
    case 'tool/call': {
      const callId = typeof event.callId === 'string' ? event.callId : undefined;
      return [
        ...messages,
        {
          id: `r${seq}`,
          kind: 'tool',
          name: typeof event.name === 'string' ? event.name : 'tool',
          callId,
          args: stringifyArgs(event.arguments),
          time,
          seq,
          turn: positiveInt(event.turn),
          step: positiveInt(event.step),
        },
      ];
    }
    case 'tool/result': {
      const callId = typeof event.callId === 'string' ? event.callId : undefined;
      const index = callId ? messages.findIndex((m) => m.kind === 'tool' && m.callId === callId) : -1;
      if (index < 0) return messages;
      const previous = messages[index];
      if (previous.kind !== 'tool') return messages;
      const error = asRecord(event.error);
      const next = [...messages];
      next[index] = {
        ...previous,
        output: (event.output as string) ?? (event.preview as string) ?? previous.output,
        outputTruncated: event.outputTruncated === true ? true : undefined,
        isError: Boolean(event.isError),
        errorCode: nonEmpty(error?.code) ?? nonEmpty(event.error),
        durationMs: time - previous.time,
      };
      return next;
    }
    case 'turn/end': {
      const reason = reasonKind(event.reason);
      if (!reason) return messages;
      const { text, failed } = outcomeOf(reason, outcomeDetail(event));
      return [
        ...messages,
        { id: `r${seq}`, kind: 'outcome', turn: positiveInt(event.turn), reason, text, failed, time, seq },
      ];
    }
    case 'compaction/summary': {
      const items = positiveInt(event.shadowedItemCount) ?? (Array.isArray(event.shadowedSeqs) ? event.shadowedSeqs.length : undefined);
      const tokens = positiveInt(event.shadowedTokenCount);
      const parts = [items ? `${items} 项` : undefined, tokens ? `${formatTokens(tokens)} token` : undefined].filter(Boolean);
      return [
        ...messages,
        {
          id: `r${seq}`,
          kind: 'notice',
          text: parts.length ? `上下文已压缩：折叠 ${parts.join(' / ')}` : '上下文已压缩',
          tone: 'warn',
          time,
          seq,
        },
      ];
    }
    case 'compaction/end': {
      const error = nonEmpty(event.error);
      if (!error) return messages;
      return [
        ...messages,
        { id: `r${seq}`, kind: 'notice', text: `上下文压缩失败：${error}`, tone: 'warn', time, seq },
      ];
    }
    case 'llm/retry': {
      const next = [...messages];
      appendRetry(
        next,
        { id: `r${seq}`, seq, time },
        {
          turn: positiveInt(event.turn),
          step: positiveInt(event.step),
          count: 1,
          why: failureBrief(asRecord(event.failure)),
          max: positiveInt(event.maxRetries),
        },
      );
      return next;
    }
    default:
      return messages;
  }
}

function dataTurn(turn: number): number {
  return turn;
}
