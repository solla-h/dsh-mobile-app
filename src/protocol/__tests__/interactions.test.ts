import { enqueueApproval, removeApproval, type PendingApproval } from '../interactions';

function approval(rpcId: string): PendingApproval {
  return {
    rpcId,
    sessionId: 's1',
    approvalId: 'a-' + rpcId,
    toolName: 'bash',
  };
}

describe('approval queue', () => {
  it('keeps the first request and appends later ones', () => {
    const first = approval('r1');
    const second = approval('r2');
    const queue = enqueueApproval(enqueueApproval([], first), second);
    expect(queue.map((item) => item.rpcId)).toEqual(['r1', 'r2']);
  });

  it('does not duplicate a replayed request and keeps the same array', () => {
    const first = approval('r1');
    const queue = [first];
    expect(enqueueApproval(queue, approval('r1'))).toBe(queue);
  });

  it('removes only the resolved request', () => {
    const queue = [approval('r1'), approval('r2')];
    expect(removeApproval(queue, 'r1').map((item) => item.rpcId)).toEqual(['r2']);
    expect(removeApproval(queue, 'missing')).toBe(queue);
  });
});
