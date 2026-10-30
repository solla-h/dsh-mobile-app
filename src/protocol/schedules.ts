/**
 * 定时任务管理帧（PROTOCOL.md §17）：update / delete / history。
 *
 * 注意：
 * - update 的 expected 必须是编辑前从 schedule-list / schedule-catalog 取得的**完整记录**，
 *   id 必须匹配；网关会自己剥掉 sessionId/status/lastDelivery 等目录元数据。
 * - 更新与删除只对原会话绑定生效。
 * - 没有 schedule/create：新提醒只能由 Agent 的 schedule_create 工具创建。
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export interface ScheduleUpdateResult {
  updated: boolean;
  record?: Record<string, unknown>;
  code?: string;
}

export function mapScheduleUpdate(raw: unknown): ScheduleUpdateResult | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  return {
    updated: frame.updated === true,
    record: asRecord(frame.record) ?? undefined,
    code: str(frame.code),
  };
}

export interface ScheduleDeleteResult {
  deleted: boolean;
  code?: string;
}

export function mapScheduleDelete(raw: unknown): ScheduleDeleteResult | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  return {
    deleted: frame.deleted === true,
    code: str(frame.code),
  };
}

/** 历史记录字段没有在协议里写死，挑已知的展示，认不出就忽略。 */
export interface ScheduleHistoryItem {
  at?: number;
  status?: string;
  kind?: string;
  summary?: string;
  raw: Record<string, unknown>;
}

export interface ScheduleHistoryResult {
  records: ScheduleHistoryItem[];
  nextBefore?: string;
  code?: string;
}

function mapHistoryItem(value: unknown): ScheduleHistoryItem | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const at =
    typeof raw.at === 'number'
      ? raw.at
      : typeof raw.time === 'number'
        ? raw.time
        : typeof raw.createdAt === 'number'
          ? raw.createdAt
          : undefined;
  return {
    at,
    status: str(raw.status) ?? str(raw.state),
    kind: str(raw.kind) ?? str(raw.type),
    summary: str(raw.summary) ?? str(raw.text) ?? str(raw.message) ?? str(raw.error),
    raw,
  };
}

export function mapScheduleHistory(raw: unknown): ScheduleHistoryResult | null {
  const frame = asRecord(raw);
  if (!frame) return null;
  return {
    records: (Array.isArray(frame.records) ? frame.records : [])
      .map(mapHistoryItem)
      .filter((item): item is ScheduleHistoryItem => item !== null),
    nextBefore: str(frame.nextBefore),
    code: str(frame.code),
  };
}
