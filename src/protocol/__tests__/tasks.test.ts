import { goalRef, mapGoal, mapTodos } from '../tasks';

describe('mapTodos', () => {
  it('null / undefined 表示会话没写过任务列表，要整块隐藏', () => {
    expect(mapTodos(null)).toBeNull();
    expect(mapTodos(undefined)).toBeNull();
  });

  it('未知 status 退化成 pending，坏条目丢掉', () => {
    expect(
      mapTodos([
        { content: '写测试', status: 'completed' },
        { content: '跑测试', status: 'weird' },
        { content: '', status: 'pending' },
        { nope: 1 },
      ]),
    ).toEqual([
      { content: '写测试', status: 'completed' },
      { content: '跑测试', status: 'pending' },
    ]);
  });

  it('空数组是「有列表但为空」，不是 null', () => {
    expect(mapTodos([])).toEqual([]);
  });
});

describe('mapGoal', () => {
  it('读的是双层嵌套里的 goal', () => {
    const goal = mapGoal({
      goal: {
        id: 'g1',
        revision: 3,
        objective: '初始化项目',
        phase: 'active',
        maxGoalRounds: 12,
      },
      roundsStarted: 2,
      updatedAt: 1700000000000,
    });
    expect(goal).toEqual({
      id: 'g1',
      revision: 3,
      objective: '初始化项目',
      phase: 'active',
      maxGoalRounds: 12,
      roundsStarted: 2,
      updatedAt: 1700000000000,
    });
  });

  it('缺 id 或 revision 就当作没有目标', () => {
    expect(mapGoal(null)).toBeNull();
    expect(mapGoal({})).toBeNull();
    expect(mapGoal({ goal: { objective: 'x' } })).toBeNull();
    expect(mapGoal({ goal: { id: 'g1', objective: 'x' } })).toBeNull();
  });
});

describe('goalRef', () => {
  it('写操作只带 id 和 revision', () => {
    expect(goalRef({ id: 'g1', revision: 7, objective: 'x' })).toEqual({ id: 'g1', revision: 7 });
  });
});
