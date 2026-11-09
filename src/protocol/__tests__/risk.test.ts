import { approvalRisk, assessRisk } from '../risk';

describe('assessRisk', () => {
  it('普通补丁不算高危', () => {
    expect(assessRisk('应用补丁到 src/app.ts，修改超时时间').level).toBe('normal');
  });

  it('递归删除、强推、提权都算高危', () => {
    expect(assessRisk('bash: rm -rf /tmp/build').labels).toContain('递归删除');
    expect(assessRisk('git push --force origin main').level).toBe('high');
    expect(assessRisk('sudo systemctl restart nginx').level).toBe('high');
  });

  it('同一个特征只记一次', () => {
    const verdict = assessRisk('rm -rf a && rm -rf b');
    expect(verdict.labels.filter((label) => label === '递归删除')).toHaveLength(1);
  });

  it('空文本不炸', () => {
    expect(assessRisk('')).toEqual({ level: 'normal', labels: [] });
  });

  it('PowerShell 的递归删除、磁盘操作、关机也算高危', () => {
    expect(assessRisk('Remove-Item -Recurse -Force .\\build').labels).toContain('递归删除');
    expect(assessRisk('del /s /q C:\\temp').labels).toContain('递归删除');
    expect(assessRisk('Format-Volume -DriveLetter D').level).toBe('high');
    expect(assessRisk('Stop-Computer -Force').level).toBe('high');
  });

  it('审批风险会读取真实命令，而不是只看 reason', () => {
    const approval = {
      rpcId: 'r1',
      sessionId: 's1',
      approvalId: 'a1',
      toolName: 'bash',
      reason: '清理构建产物',
    };
    expect(approvalRisk(approval).level).toBe('normal');
    expect(approvalRisk(approval, 'rm -rf build').level).toBe('high');
    expect(approvalRisk(approval, 'rm -rf build').labels).toContain('递归删除');
  });
});
