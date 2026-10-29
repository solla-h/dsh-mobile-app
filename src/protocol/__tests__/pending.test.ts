import { applyPendingFrame, pendingItems, soleApproval } from '../pending';
import type { ServerFrame } from '../types';

const approval = (over: Record<string, unknown> = {}): ServerFrame =>
  ({
    kind: 'approval-requested',
    rpcId: 'rpc-1',
    sessionId: 's1',
    approvalId: 'ap-1',
    toolName: 'bash',
    ...over,
  }) as unknown as ServerFrame;

describe('applyPendingFrame - 审批', () => {
  it('approval-requested 要连 approvalId 一起存下来，否则根本批不了', () => {
    const map = applyPendingFrame({}, approval());
    expect(pendingItems(map!, 's1')).toEqual([
      expect.objectContaining({ rpcId: 'rpc-1', approvalId: 'ap-1', kind: 'approval', toolName: 'bash' }),
    ]);
  });

  it('displayReason 优先于 reason', () => {
    const map = applyPendingFrame({}, approval({ reason: '原始理由', displayReason: '给用户看的' }));
    expect(pendingItems(map!, 's1')[0].reason).toBe('给用户看的');
  });

  it('同一个 rpcId 重复下发不算变化', () => {
    const first = applyPendingFrame({}, approval());
    expect(applyPendingFrame(first!, approval())).toBeNull();
  });

  it('approval-resolved 只有 rpcId 时也能清掉', () => {
    const map = applyPendingFrame({}, approval());
    const next = applyPendingFrame(map!, { kind: 'approval-resolved', rpcId: 'rpc-1' } as ServerFrame);
    expect(next).toEqual({});
  });

  it('approval-resolved 只带 approvalId 时用 approvalId 兜底清理', () => {
    const map = applyPendingFrame({}, approval());
    const next = applyPendingFrame(map!, { kind: 'approval-resolved', approvalId: 'ap-1' } as ServerFrame);
    expect(next).toEqual({});
  });

  it('重复提交被拒收（accepted:false）时顺手清掉', () => {
    const map = applyPendingFrame({}, approval());
    const next = applyPendingFrame(map!, {
      kind: 'approval-response',
      rpcId: 'rpc-1',
      accepted: false,
    } as ServerFrame);
    expect(next).toEqual({});
  });
});

describe('soleApproval', () => {
  it('恰好一条审批时返回它，语音批审批只认这种情况', () => {
    const map = applyPendingFrame({}, approval());
    expect(soleApproval(map!, 's1')?.approvalId).toBe('ap-1');
  });

  it('两条待办就不猜', () => {
    const one = applyPendingFrame({}, approval())!;
    const two = applyPendingFrame(one, approval({ rpcId: 'rpc-2', approvalId: 'ap-2' }))!;
    expect(soleApproval(two, 's1')).toBeUndefined();
  });

  it('只有一条提问时不算审批', () => {
    const map = applyPendingFrame({}, {
      kind: 'question-requested',
      rpcId: 'q-1',
      sessionId: 's1',
    } as ServerFrame);
    expect(soleApproval(map!, 's1')).toBeUndefined();
  });

  it('没有待办时返回 undefined', () => {
    expect(soleApproval({}, 's1')).toBeUndefined();
  });
});
