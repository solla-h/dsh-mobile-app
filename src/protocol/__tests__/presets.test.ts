import { mapPresetList, presetName } from '../presets';

describe('mapPresetList', () => {
  it('缺字段时给出安全默认值', () => {
    expect(mapPresetList(undefined)).toEqual({ presets: [], modeSelectionEnabled: true });
  });

  it('保留 broken / isDefault 标记，丢掉没有 id 的条目', () => {
    const list = mapPresetList({
      presets: [
        { id: 'standard', name: '标准模式', isDefault: true },
        { id: 'broken-one', broken: true },
        { name: '没有 id' },
      ],
      modeSelectionEnabled: false,
    });
    expect(list.modeSelectionEnabled).toBe(false);
    expect(list.presets).toEqual([
      { id: 'standard', name: '标准模式', description: undefined, isDefault: true, broken: false },
      { id: 'broken-one', name: undefined, description: undefined, isDefault: false, broken: true },
    ]);
  });
});

describe('presetName', () => {
  const presets = [{ id: 'standard', name: '标准模式', isDefault: true, broken: false }];

  it('优先用显示名，找不到就退回 id', () => {
    expect(presetName(presets, 'standard')).toBe('标准模式');
    expect(presetName(presets, 'other')).toBe('other');
  });

  it('没有预设时给一句人话', () => {
    expect(presetName(presets, null)).toBe('默认模式');
  });
});
