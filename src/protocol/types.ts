/**
 * dsh-mobile-v1 协议的帧定义。
 * 只描述我们当前用到/将要用的部分，字段名严格对齐 PROTOCOL.md。
 */

export interface PairingPayload {
  version: number;
  publicUrl: string;
  pairingCode: string;
  expiresAt: number;
  gatewayId?: string;
  gatewayName?: string;
  endpoints?: string[];
}

export interface DeviceInfo {
  id: string;
  name: string;
  createdAt?: number;
}

export interface HelloFrame {
  kind: 'hello';
  protocol: number;
  capabilities: string[];
  authenticated: boolean;
  device?: DeviceInfo;
  port?: number;
  clients?: number;
  gatewayId?: string;
  gatewayName?: string;
}

export interface PairedFrame {
  kind: 'paired';
  token: string;
  device: DeviceInfo;
}

export interface ErrorFrame {
  kind: 'error';
  code: string;
  message?: string;
  requestType?: string;
  sessionId?: string;
}

export interface SessionItem {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  cwd?: string;
  agentPreset?: string;
  parentSessionId?: string;
  origin?: string;
  projections?: {
    asOfSeq: number;
    values: { title?: string | null };
  };
}

export interface SessionsFrame {
  kind: 'sessions';
  items: SessionItem[];
}

export interface EventFrame {
  kind: 'event';
  sessionId: string;
  seq: number;
  time: number;
  event: { type: string; [key: string]: unknown };
}

/**
 * 历史事件格式版本。不带游标的基线请求可以省略，但一旦带上 beforeSeq 往回翻页，
 * 服务端会强制校验（缺失就回 history-format-mismatch）。
 */
export const HISTORY_FORMAT_VERSION = 4;

/** 历史事件：history / session-snapshot 共用同一种事件形状。 */
export interface HistoryEventFrame {
  type: string;
  seq: number;
  time: number;
  data?: Record<string, unknown>;
}

/**
 * 历史分页帧。
 * - `beforeSeq` 是排他上界（只返回 seq < beforeSeq 的事件）；
 * - `nextBeforeSeq` 是往回翻页要用的游标，缺省表示没有更早的了；
 * - `cursor` 是最新 seq，不是分页游标，别拿它当 beforeSeq。
 */
export interface HistoryFrame {
  kind: 'history';
  sessionId: string;
  events: HistoryEventFrame[];
  cursor?: number;
  hasMore?: boolean;
  nextBeforeSeq?: number;
  historyFormatVersion?: number;
  view?: 'conversation' | 'raw';
  bytes?: number;
}

/** 订阅时下发的开场快照：只是最新一段（replace 语义），比它更早的内容要靠 history 翻页拿。 */
export interface SessionSnapshotFrame {
  kind: 'session-snapshot';
  sessionId?: string;
  events: HistoryEventFrame[];
  hasMore?: boolean;
  replace?: boolean;
}

/** 历史/实时消息里的图片引用；字节要另外用 attachment 请求取。 */
export interface ImageAttachmentRef {
  attachmentId: string;
  mediaType: string;
  bytes?: number;
  width?: number;
  height?: number;
  name?: string;
}

/** 发送图片时客户端上传的形态：标准 Base64，不带 data: 前缀。 */
export interface OutgoingImage {
  mediaType: string;
  data: string;
  name?: string;
}

export interface AttachmentFrame {
  kind: 'attachment';
  sessionId: string;
  attachment: ImageAttachmentRef;
  /** 标准 Base64 图片字节 */
  data: string;
}

/** 宿主对图片的硬性限制，从 history.projections.values.imageLimits 读。 */
export interface ImageLimits {
  maxImageBytes?: number;
  maxImagesPerMessage?: number;
  maxMessageImageBytes?: number;
  maxImagePixels?: number;
  maxImageDimension?: number;
  mediaTypes?: string[];
}

/** / 菜单目录；groups 的结构见 protocol/commands.ts 的 mapCommandGroups。 */
export interface CommandsFrame {
  kind: 'commands';
  sessionId?: string;
  locale?: string;
  groups?: unknown;
}

export interface CommandExecutedFrame {
  kind: 'command-executed';
  sessionId?: string;
  line: string;
  commandId?: string;
  result?: { kind?: string; text?: string };
}

export interface CommandOptionsFrame {
  kind: 'command-options';
  sessionId?: string;
  command: string;
  options?: unknown;
}

export interface CommandSelectedFrame {
  kind: 'command-selected';
  sessionId?: string;
  command: string;
  selected?: { id: string; label: string; detail?: string; selected?: boolean };
}

/** 输入框统计条。 */
export interface SessionStatsFrame {
  kind: 'session-stats';
  sessionId?: string;
  asOfSeq?: number;
  sessionStats?: {
    turns?: number;
    steps?: number;
    llmMs?: number;
    toolMs?: number;
    ttftMs?: number;
    ttftSteps?: number;
    decodeMs?: number;
    decodeTokens?: number;
    lastTurn?: number | null;
    openStep?: unknown;
  };
  tokenUsage?: {
    totals?: {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      reasoningTokens?: number;
    };
  };
  contextPressure?: { contextWindow?: number; pressureTokens?: number; surfaceTokens?: number };
}

export interface FileResolvedFrame {
  kind: 'file-resolved';
  requestId: string;
  sessionId?: string;
  path: string;
  name?: string;
  mediaType?: string;
  size?: number;
  modifiedAt?: number;
}

export interface FileDownloadOpenedFrame {
  kind: 'file-download-opened';
  requestId: string;
  transferId: string;
  sessionId?: string;
  path: string;
  name?: string;
  mediaType?: string;
  size?: number;
  chunkBytes?: number;
}

export interface FileDownloadChunkFrame {
  kind: 'file-download-chunk';
  transferId: string;
  offset: number;
  /** 标准 Base64 */
  data: string;
  eof?: boolean;
  sha256?: string;
}

/** 任务列表 / 当前目标；todos、goal 的结构见 protocol/tasks.ts。 */
export interface TasksFrame {
  kind: 'tasks' | 'tasks-updated';
  sessionId?: string;
  asOfSeq?: number;
  todos?: unknown;
}

export interface GoalFrame {
  kind: 'goal' | 'goal-updated';
  sessionId?: string;
  asOfSeq?: number;
  goal?: unknown;
}

/** fork 成功，返回新会话的 id。 */
export interface ForkFrame {
  kind: 'fork';
  sessionId: string;
}

/** 网关支持的全部 agent 预设。 */
export interface AgentPresetsFrame {
  kind: 'agent-presets';
  presets?: unknown;
  modeSelectionEnabled?: boolean;
}

/**
 * 当前会话用的预设。locked 一旦变 true 就不会再变回来：
 * 会话只要跑过任何一轮，预设就固定了。
 */
export interface SessionAgentPresetFrame {
  kind: 'session-agent-preset';
  sessionId: string;
  agentPreset?: string | null;
  locked?: boolean;
  requestId?: string;
}

/** 切换成功。注意：响应里故意没有 locked 字段。 */
export interface SelectAgentPresetFrame {
  kind: 'select-agent-preset';
  sessionId: string;
  agentPreset: string;
  requestId?: string;
}

/** 预设变化推送：只带变化的那个字段，按字段合并。 */
export interface SessionAgentPresetUpdatedFrame {
  kind: 'session-agent-preset-updated';
  sessionId: string;
  agentPreset?: string;
  locked?: boolean;
  seq?: number;
  time?: number;
}

export interface SessionCreatedFrame {
  kind: 'session-created';
  requestId: string;
  sessionId: string;
}

export interface PongFrame {
  kind: 'pong';
  at: number;
}

/** 服务端帧的并集；未知类型保留为宽松对象，便于渐进实现。 */
export type ServerFrame =
  | HelloFrame
  | PairedFrame
  | ErrorFrame
  | SessionsFrame
  | SessionCreatedFrame
  | EventFrame
  | HistoryFrame
  | SessionSnapshotFrame
  | AttachmentFrame
  | CommandsFrame
  | CommandExecutedFrame
  | CommandOptionsFrame
  | CommandSelectedFrame
  | SessionStatsFrame
  | TasksFrame
  | GoalFrame
  | ForkFrame
  | AgentPresetsFrame
  | SessionAgentPresetFrame
  | SelectAgentPresetFrame
  | SessionAgentPresetUpdatedFrame
  | FileResolvedFrame
  | FileDownloadOpenedFrame
  | FileDownloadChunkFrame
  | PongFrame
  | { kind: string; [key: string]: unknown };

export type ClientFrame =
  | { type: 'ping' }
  | { type: 'sessions' }
  | { type: 'session-create'; requestId: string; workspaceId?: string; cwd?: string }
  | { type: 'subscribe'; sessionId: string; assistantStream?: boolean }
  | { type: 'unsubscribe' }
  | {
      type: 'history';
      sessionId: string;
      beforeSeq?: number;
      historyFormatVersion?: number;
      view?: 'conversation' | 'raw';
      maxMessages?: number;
      maxBytes?: number;
    }
  | {
      type: 'approval-response';
      rpcId: string;
      sessionId: string;
      approvalId: string;
      outcome: 'allowed-once' | 'rejected';
    }
  | {
      type: 'question-answer';
      rpcId: string;
      sessionId: string;
      answers: { id: string; selected: string[]; custom?: string }[];
    }
  | { type: 'question-cancel'; rpcId: string; sessionId: string }
  | { type: 'session-cancel'; sessionId: string; requestId?: string }
  | { type: 'commands'; sessionId: string; locale?: string }
  | {
      type: 'command-execute';
      sessionId: string;
      /** 必须以 / 开头，参数跟在命令后面 */
      line: string;
      images?: OutgoingImage[];
    }
  | { type: 'command-options'; sessionId: string; command: string }
  | { type: 'command-select'; sessionId: string; command: string; optionId: string }
  | { type: 'session-stats'; sessionId: string }
  | { type: 'fork'; sessionId: string; atSeq?: number; historyFormatVersion?: number }
  | { type: 'agent-presets' }
  | { type: 'session-agent-preset'; sessionId: string; requestId?: string }
  | { type: 'select-agent-preset'; sessionId: string; agentPreset: string; requestId?: string }
  | { type: 'tasks'; sessionId: string }
  | { type: 'goal'; sessionId: string }
  | {
      type: 'goal-edit';
      sessionId: string;
      ref: { id: string; revision: number };
      objective?: string;
      maxGoalRounds?: number;
    }
  | { type: 'goal-pause'; sessionId: string; ref: { id: string; revision: number } }
  | { type: 'goal-resume'; sessionId: string; ref: { id: string; revision: number } }
  | { type: 'goal-clear'; sessionId: string; ref: { id: string; revision: number } }
  | { type: 'file-resolve'; requestId: string; sessionId: string; path: string }
  | { type: 'file-list'; requestId: string; sessionId: string; path?: string }
  | { type: 'file-download-open'; requestId: string; sessionId: string; path: string }
  | { type: 'file-download-read'; transferId: string; offset: number }
  | { type: 'file-download-cancel'; transferId: string }
  | {
      type: 'file-upload-open';
      requestId: string;
      sessionId: string;
      name: string;
      size: number;
      sha256: string;
    }
  | { type: 'file-upload-chunk'; requestId: string; uploadId: string; offset: number; data: string }
  | { type: 'file-upload-finish'; requestId: string; uploadId: string }
  | { type: 'file-upload-cancel'; requestId: string; uploadId: string }
  | { type: 'session-archive'; sessionId: string; archived?: boolean; requestId?: string }
  | { type: 'session-rename'; sessionId: string; title: string }
  | { type: 'attachment'; sessionId: string; attachmentId: string }
  | {
      type: 'queue-update';
      sessionId: string;
      itemId: string;
      action: 'edit' | 'remove' | 'steer';
      text?: string;
    }
  | {
      type: 'message';
      /** 带文件的消息必须带 requestId（1..128 字符），网关用它做幂等。 */
      requestId?: string;
      sessionId?: string;
      text: string;
      mode?: 'queue' | 'steer';
      clientTimeZone?: string;
      /** 纯图片消息允许 text 为空，但 text 和 images 至少要有一项。 */
      images?: OutgoingImage[];
      /** 已上传文件的收据，来自 file-upload-completed.receiptId */
      files?: { receiptId: string }[];
    };
