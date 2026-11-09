import { mapScheduleDelete, mapScheduleHistory, mapScheduleUpdate } from '../schedules';

describe('mapScheduleUpdate', () => {
  it('updated:true 带回新记录', () => {
    const result = mapScheduleUpdate({
      kind: 'schedule-update',
      updated: true,
      record: { id: 's1', title: '新标题' },
    });
    expect(result!.updated).toBe(true);
    expect(result!.record!.title).toBe('新标题');
  });
  it('updated:false 带 code（并发冲突/已结束/未找到）', () => {
    const result = mapScheduleUpdate({ updated: false, code: 'conflict' });
    expect(result!.updated).toBe(false);
    expect(result!.code).toBe('conflict');
  });
});

describe('mapScheduleDelete', () => {
  it('deleted 透传', () => {
    expect(mapScheduleDelete({ deleted: true })!.deleted).toBe(true);
    expect(mapScheduleDelete({ deleted: false, code: 'not-found' })!.code).toBe('not-found');
  });
});

describe('mapScheduleHistory', () => {
  it('records 宽松映射 at/status/summary', () => {
    const result = mapScheduleHistory({
      kind: 'schedule-history',
      records: [
        { at: 1700000000000, status: 'delivered', text: '已投递' },
        { time: 1700000001000, kind: 'error', message: '失败原因' },
        { something: 'unknown' },
      ],
      nextBefore: 'cursor-1',
    });
    expect(result!.records).toHaveLength(3);
    expect(result!.records[0].status).toBe('delivered');
    expect(result!.records[1].at).toBe(1700000001000);
    expect(result!.records[1].summary).toBe('失败原因');
    expect(result!.nextBefore).toBe('cursor-1');
  });
  it('畸形帧返回 null', () => {
    expect(mapScheduleHistory(null)).toBeNull();
  });
});
