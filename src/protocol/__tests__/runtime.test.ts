import {
  mapDefaults,
  mapHost,
  mapModelCatalog,
  mapPermissionCatalog,
  mapPermissionResult,
  mapProviders,
  mapSelectModel,
  mapSetDefault,
} from '../runtime';

describe('mapModelCatalog', () => {
  it('会话目录：current + routable + groups + efforts', () => {
    const catalog = mapModelCatalog({
      kind: 'models',
      current: { provider: 'deepseek', model: 'deepseek-chat' },
      routable: true,
      groups: [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          models: [
            {
              id: 'deepseek-chat',
              name: 'DeepSeek Chat',
              reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
            },
            { id: 'deepseek-reasoner' },
          ],
        },
      ],
      failures: ['anthropic: no key'],
    });
    expect(catalog!.current).toEqual({ provider: 'deepseek', model: 'deepseek-chat' });
    expect(catalog!.groups[0].models[0].efforts.map((e) => e.id)).toEqual(['low', 'high']);
    expect(catalog!.groups[0].models[1].name).toBe('deepseek-reasoner');
    expect(catalog!.failures).toHaveLength(1);
  });

  it('全局目录：没有 current 时为 null，routable 缺省 true', () => {
    const catalog = mapModelCatalog({ groups: [] });
    expect(catalog!.current).toBeNull();
    expect(catalog!.routable).toBe(true);
  });

  it('畸形帧返回 null', () => {
    expect(mapModelCatalog(null)).toBeNull();
    expect(mapModelCatalog('x')).toBeNull();
  });
});

describe('mapSelectModel', () => {
  it('解出 selected 含 reasoningEffort', () => {
    const selected = mapSelectModel({
      kind: 'select-model',
      selected: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
    });
    expect(selected).toEqual({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' });
  });
  it('缺字段返回 null', () => {
    expect(mapSelectModel({ selected: { provider: 'x' } })).toBeNull();
  });
});

describe('mapProviders', () => {
  it('provider 列表', () => {
    const list = mapProviders({
      providers: [{ provider: 'deepseek', displayName: 'DeepSeek', declared: true }, { id: 'openai' }],
    });
    expect(list).toHaveLength(2);
    expect(list[0].displayName).toBe('DeepSeek');
    expect(list[1].provider).toBe('openai');
  });
});

describe('mapPermissionCatalog', () => {
  it('options 支持字符串与对象两种形态', () => {
    const catalog = mapPermissionCatalog({
      options: ['ask', { value: 'workspace-write', name: 'Workspace Write', description: '可写工作区' }],
      defaultOptions: [{ value: 'ask', name: 'Ask' }],
      defaultPreset: 'ask',
      sessionPermissions: ['workspace-write'],
    });
    expect(catalog!.options[0]).toEqual({ value: 'ask', name: 'ask' });
    expect(catalog!.options[1].name).toBe('Workspace Write');
    expect(catalog!.defaultPreset).toBe('ask');
    expect(catalog!.sessionPermissions).toEqual(['workspace-write']);
  });
});

describe('mapPermissionResult', () => {
  it('success 视为成功', () => {
    const result = mapPermissionResult({
      kind: 'permission',
      set: 'workspace-write',
      result: { kind: 'success', text: 'ok' },
    });
    expect(result!.set).toBe('workspace-write');
    expect(result!.ok).toBe(true);
  });
  it('非 success 为失败', () => {
    const result = mapPermissionResult({ set: 'x', result: { kind: 'error' } });
    expect(result!.ok).toBe(false);
  });
});

describe('mapHost', () => {
  it('宿主信息', () => {
    const host = mapHost({
      kind: 'host',
      version: '0.2.1-rc.3',
      cwd: '/home/dsh',
      provider: 'deepseek',
      model: 'deepseek-chat',
      attachedSessions: 3,
      canOpenPath: true,
    });
    expect(host!.version).toBe('0.2.1-rc.3');
    expect(host!.attachedSessions).toBe(3);
  });
});

describe('mapDefaults', () => {
  it('默认配置与可选权限', () => {
    const defaults = mapDefaults({
      agentPresetDefault: 'standard',
      permissionDefault: 'ask',
      permissionDefaultOptions: [{ value: 'ask', name: 'Ask' }],
      modeSelectionEnabled: false,
    });
    expect(defaults!.agentPresetDefault).toBe('standard');
    expect(defaults!.permissionDefaultOptions).toHaveLength(1);
    expect(defaults!.modeSelectionEnabled).toBe(false);
  });
  it('modeSelectionEnabled 缺省为 true', () => {
    expect(mapDefaults({})!.modeSelectionEnabled).toBe(true);
  });
});

describe('mapSetDefault', () => {
  it('applied 透传', () => {
    expect(mapSetDefault({ target: 'agent-preset', value: 'minimal', applied: true })!.applied).toBe(true);
    expect(mapSetDefault({ applied: false })!.applied).toBe(false);
  });
});
