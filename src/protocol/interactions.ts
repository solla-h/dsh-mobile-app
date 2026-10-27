/** Human-in-the-loop：审批与提问的帧定义（对齐 PROTOCOL.md §3）。 */

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionIntent {
  kind: string;
  approve?: string;
}

export interface QuestionItem {
  id: string;
  header?: string;
  question: string;
  detail?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  intent?: QuestionIntent;
}

export interface PendingQuestion {
  rpcId: string;
  sessionId: string;
  questions: QuestionItem[];
  replay?: boolean;
}

export interface PendingApproval {
  rpcId: string;
  sessionId: string;
  approvalId: string;
  toolName?: string;
  callId?: string;
  reason?: string;
  displayReason?: Record<string, string>;
  replay?: boolean;
}

export interface QuestionAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

const LOCALE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'zh';
  } catch {
    return 'zh';
  }
})();

/** displayReason 的键在不同版本里是 zh / zh-CN / en，按当前语言挑一个。 */
export function pickDisplayReason(
  displayReason: Record<string, string> | undefined,
  fallback: string | undefined,
): string {
  if (displayReason) {
    const keys = Object.keys(displayReason);
    const wanted = LOCALE.toLowerCase().startsWith('zh') ? ['zh', 'zh-cn', 'zh-hans'] : ['en', 'en-us'];
    for (const candidate of wanted) {
      const hit = keys.find((key) => key.toLowerCase() === candidate);
      if (hit) return displayReason[hit];
    }
    if (keys.length) return displayReason[keys[0]];
  }
  return fallback ?? '';
}

export interface DraftAnswer {
  selected: string[];
  custom: string;
}

/** 按网关的严格校验规则判断这一批问题是否填完。 */
export function draftComplete(questions: QuestionItem[], drafts: Record<string, DraftAnswer>): boolean {
  return questions.every((question) => {
    const draft = drafts[question.id];
    if (!draft) return false;
    const custom = draft.custom.trim();
    if (question.multiSelect) return draft.selected.length > 0 || custom.length > 0;
    // 单选：selected 与 custom 互斥，且必须二选一。
    if (draft.selected.length > 1) return false;
    if (draft.selected.length === 1) return custom.length === 0;
    return custom.length > 0;
  });
}

/** answers 的数量、顺序、id 必须和 questions 完全一致。 */
export function buildAnswers(
  questions: QuestionItem[],
  drafts: Record<string, DraftAnswer>,
): QuestionAnswer[] {
  return questions.map((question) => {
    const draft = drafts[question.id] ?? { selected: [], custom: '' };
    const custom = draft.custom.trim();
    const answer: QuestionAnswer = { id: question.id, selected: draft.selected };
    if (custom) answer.custom = custom;
    return answer;
  });
}
