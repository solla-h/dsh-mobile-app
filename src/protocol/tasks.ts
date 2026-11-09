/**
 * 任务列表（todos）与当前目标（goal）两个 session projection。
 * 契约见 PROTOCOL.md「任务列表与目标」。
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export interface GoalInfo {
  id: string;
  revision: number;
  objective: string;
  phase?: string;
  maxGoalRounds?: number;
  roundsStarted?: number;
  updatedAt?: number;
}

export interface GoalRef {
  id: string;
  revision: number;
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

/** todos: null 表示这个会话还没写过任务列表，客户端应当整块隐藏。 */
export function mapTodos(value: unknown): TodoItem[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const items: TodoItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const content = str(raw.content);
    if (!content) continue;
    const status = raw.status;
    items.push({
      content,
      status:
        status === 'completed' || status === 'in_progress' || status === 'pending'
          ? status
          : 'pending',
    });
  }
  return items;
}

/** 服务端下发的是 { goal, roundsStarted, createdAt, updatedAt } 的包装。 */
export function mapGoal(value: unknown): GoalInfo | null {
  if (!value || typeof value !== 'object') return null;
  const wrapper = value as Record<string, unknown>;
  const inner = wrapper.goal;
  if (!inner || typeof inner !== 'object') return null;
  const raw = inner as Record<string, unknown>;
  const id = str(raw.id);
  const objective = str(raw.objective);
  // 写操作要用 ref.revision 做 CAS，非正整数会被网关直接 bad-request。
  // 读不到合法 revision 时宁可当作「没有目标」，也不要给 UI 一个点不动的按钮。
  const revision = raw.revision;
  if (!id || !objective) return null;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0) return null;
  return {
    id,
    revision,
    objective,
    phase: str(raw.phase),
    maxGoalRounds: typeof raw.maxGoalRounds === 'number' ? raw.maxGoalRounds : undefined,
    roundsStarted:
      typeof wrapper.roundsStarted === 'number' ? wrapper.roundsStarted : undefined,
    updatedAt: typeof wrapper.updatedAt === 'number' ? wrapper.updatedAt : undefined,
  };
}

export function goalRef(goal: GoalInfo): GoalRef {
  return { id: goal.id, revision: goal.revision };
}

export function describePhase(phase?: string): string {
  switch (phase) {
    case 'active':
      return '进行中';
    case 'paused':
      return '已暂停';
    case 'blocked':
      return '受阻';
    case 'done':
    case 'completed':
      return '已完成';
    default:
      return phase ?? '';
  }
}
