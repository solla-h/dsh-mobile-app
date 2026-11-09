import {
  currentValue,
  describeApplication,
  entriesOfBundle,
  groupBundles,
  mapCatalog,
  mapChangeResult,
  mapInstallLog,
  mapInstallState,
  mapInspection,
  mapRegistries,
  mapSettings,
  mapSettingsChanged,
  pickLocalized,
  schemaFields,
  standaloneEntries,
} from '../plugins';

const sampleBundle = {
  name: 'dsh-plugin-mobile-gateway',
  version: '0.11.1',
  meta: {
    title: { en: 'Mobile Gateway', 'zh-CN': '移动网关' },
    description: '移动端接入',
    icon: 'data:image/png;base64,xxx',
  },
  enabled: true,
  installed: true,
  optional: false,
  removable: true,
  experimental: false,
};

describe('mapCatalog', () => {
  it('映射 bundle 并解出本地化 meta', () => {
    const catalog = mapCatalog({
      managementAvailable: true,
      settingsWritable: true,
      bundles: [sampleBundle],
      plugins: [{ id: 'entry-1', name: 'gateway', bundle: 'dsh-plugin-mobile-gateway', enabled: true }],
      officialItems: [{ id: 'shell', namespaces: ['bash-sandbox'] }],
    });
    expect(catalog).not.toBeNull();
    expect(catalog!.bundles[0].title).toBe('移动网关');
    expect(catalog!.bundles[0].icon).toBe('data:image/png;base64,xxx');
    expect(catalog!.plugins[0].entryId).toBe('entry-1');
    expect(catalog!.officialItems[0].id).toBe('shell');
  });

  it('拒绝非 data: 的 icon，防止注入', () => {
    const catalog = mapCatalog({
      bundles: [{ ...sampleBundle, meta: { icon: 'javascript:alert(1)' } }],
    });
    expect(catalog!.bundles[0].icon).toBeUndefined();
  });

  it('managementAvailable=false 仍返回空目录结构', () => {
    const catalog = mapCatalog({ managementAvailable: false, bundles: [], plugins: [], officialItems: [] });
    expect(catalog!.managementAvailable).toBe(false);
    expect(catalog!.bundles).toHaveLength(0);
  });

  it('畸形帧返回 null', () => {
    expect(mapCatalog(null)).toBeNull();
    expect(mapCatalog('nope')).toBeNull();
  });
});

describe('groupBundles', () => {
  it('排除内置包；optional 未安装进官方，其余进已安装', () => {
    const { installed, official } = groupBundles([
      { ...sampleBundle, name: '@deepseek-ai/dsh-base' },
      { ...sampleBundle, name: 'a-installed', installed: true, optional: true },
      { ...sampleBundle, name: 'b-not-installed', installed: false, optional: true },
      { ...sampleBundle, name: 'c-not-optional', installed: false, optional: false },
    ]);
    expect(installed.map((b) => b.name)).toEqual(['a-installed', 'c-not-optional']);
    expect(official.map((b) => b.name)).toEqual(['b-not-installed']);
  });
});

describe('entriesOfBundle / standaloneEntries', () => {
  const plugins = [
    { entryId: 'e1', bundle: 'pkg-a', enabled: true },
    { entryId: 'e2', enabled: false },
  ];
  const bundles = [{ ...sampleBundle, name: 'pkg-a' }];
  it('按 bundle 名过滤条目', () => {
    expect(entriesOfBundle(plugins, 'pkg-a').map((e) => e.entryId)).toEqual(['e1']);
    expect(entriesOfBundle(plugins, 'pkg-zz')).toHaveLength(0);
  });
  it('没有 bundle 或 bundle 未知的是独立条目', () => {
    expect(standaloneEntries(plugins, bundles).map((e) => e.entryId)).toEqual(['e2']);
  });
});

describe('pickLocalized', () => {
  it('文本直通；语言映射优先中文再英文', () => {
    expect(pickLocalized('标题')).toBe('标题');
    expect(pickLocalized({ en: 'Hello', 'zh-CN': '你好' })).toBe('你好');
    expect(pickLocalized({ en: 'Hello', fr: 'Bonjour' })).toBe('Hello');
    expect(pickLocalized({ fr: 'Bonjour', de: 'Hallo' })).toBe('Bonjour');
    expect(pickLocalized(undefined)).toBeUndefined();
  });
});

describe('mapChangeResult / describeApplication', () => {
  it('解出 pendingBuilds 与 application', () => {
    const result = mapChangeResult({
      result: {
        application: 'applied',
        changed: true,
        pendingBuilds: ['esbuild'],
        warnings: ['w1'],
      },
    });
    expect(result!.application).toBe('applied');
    expect(result!.pendingBuilds).toEqual(['esbuild']);
    expect(describeApplication(result!)).toBe('已生效');
  });

  it('restart-required 提示重启', () => {
    const result = mapChangeResult({ result: { application: 'restart-required' } });
    expect(describeApplication(result!)).toBe('已保存，重启 DSH Web 后生效');
  });
});

describe('mapInspection', () => {
  it('refused 是带内结果不是错误', () => {
    const inspection = mapInspection({ result: { status: 'refused', reason: 'registry mismatch' } });
    expect(inspection!.status).toBe('refused');
  });
  it('accepted 直通；缺 result 返回 null', () => {
    expect(mapInspection({ result: { status: 'accepted' } })!.status).toBe('accepted');
    expect(mapInspection({})).toBeNull();
  });
});

describe('mapSettings', () => {
  it('不带 ns 时解出全部 namespaces', () => {
    const result = mapSettings({
      writable: true,
      namespaces: [
        {
          ns: 'web-search-deepseek',
          schema: { type: 'object', properties: { provider: { type: 'string' } } },
          value: { provider: 'example' },
        },
      ],
    });
    expect(result!.namespaces[0].ns).toBe('web-search-deepseek');
  });

  it('带 ns 时返回单 namespace 视图与 revision', () => {
    const result = mapSettings(
      { writable: true, namespace: { ns: 'shell', revision: 3, value: {} } },
      'shell',
    );
    expect(result!.namespaces).toHaveLength(1);
    expect(result!.namespaces[0].revision).toBe(3);
  });
});

describe('schemaFields / currentValue', () => {
  const ns = {
    ns: 'web-search-deepseek',
    writable: true,
    revision: 4,
    schema: {
      type: 'object',
      required: ['provider'],
      properties: {
        provider: { type: 'string', title: '提供方', enum: ['a', 'b'] },
        verbose: { type: 'boolean', title: '详细输出' },
        limit: { type: 'number', default: 5 },
        nested: { type: 'object' },
        apiKey: { type: 'string' },
      },
    },
    value: { provider: 'b', verbose: true, nested: { deep: 1 } },
    user: { provider: 'a' },
    secrets: [{ path: ['apiKey'], set: true }],
  };
  const fields = schemaFields(ns as never);

  it('按 schema 产出字段：enum/boolean/number/object→json、required、secret', () => {
    const byKey = Object.fromEntries(fields.map((f) => [f.path[0], f]));
    expect(byKey.provider.type).toBe('enum');
    expect(byKey.provider.enumValues).toEqual(['a', 'b']);
    expect(byKey.provider.required).toBe(true);
    expect(byKey.provider.label).toBe('提供方');
    expect(byKey.verbose.type).toBe('boolean');
    expect(byKey.limit.type).toBe('number');
    expect(byKey.nested.type).toBe('json');
    expect(byKey.apiKey.secret).toBe(true);
  });

  it('currentValue 优先 user 层，再 value，再 default', () => {
    expect(currentValue(ns as never, ['provider'])).toBe('a');
    expect(currentValue(ns as never, ['verbose'])).toBe(true);
    expect(currentValue(ns as never, ['limit'])).toBe(5);
    expect(currentValue(ns as never, ['missing'])).toBeUndefined();
  });

  it('没有 schema 时整节当 JSON 兜底', () => {
    const bare = schemaFields({ ns: 'x', writable: true } as never);
    expect(bare).toEqual([{ path: [], label: 'x', type: 'json' }]);
  });
});

describe('推送帧映射', () => {
  it('mapInstallState 解出 phase 与 attempt', () => {
    const state = mapInstallState({
      requestId: 'install-1',
      phase: 'installing',
      attempt: { registry: null, index: 1, total: 2 },
    });
    expect(state!.requestId).toBe('install-1');
    expect(state!.attempt!.total).toBe(2);
  });

  it('mapInstallLog 解出 stream/text/exitCode', () => {
    const log = mapInstallLog({ requestId: 'install-1', jobId: 'j1', stream: 'stderr', text: 'warn', exitCode: 1 });
    expect(log!.stream).toBe('stderr');
    expect(log!.exitCode).toBe(1);
  });

  it('mapSettingsChanged 解出 ns/revision；缺 ns 返回 null', () => {
    expect(mapSettingsChanged({ ns: 'shell', revision: 7 })).toEqual({ ns: 'shell', revision: 7 });
    expect(mapSettingsChanged({ revision: 7 })).toBeNull();
  });

  it('mapRegistries 保留 null registry', () => {
    const registries = mapRegistries({ registry: null, fallbackRegistries: ['https://registry.npmjs.org'] });
    expect(registries!.registry).toBeNull();
    expect(registries!.fallbackRegistries).toHaveLength(1);
  });
});
