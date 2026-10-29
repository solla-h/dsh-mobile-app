import { matchDecision } from '../voice-decision';

describe('matchDecision', () => {
  it('整句命中肯定白名单就放行', () => {
    for (const word of ['可以', '行', '好', '好的', '好嘞', '同意', '批准', '允许', '确认', '继续', '执行', '放行']) {
      expect(matchDecision(word)).toBe('approve');
    }
  });

  it('整句命中否定白名单就拒绝', () => {
    for (const word of ['不行', '不可以', '不要', '别', '否', '拒绝', '取消', '停', '停下', '算了']) {
      expect(matchDecision(word)).toBe('reject');
    }
  });

  it('英文白名单不分大小写，前后空格无所谓', () => {
    for (const word of ['ok', 'OK', 'Okay', 'yes', 'Yes', 'yep', 'yeah', 'sure', 'go']) {
      expect(matchDecision(word)).toBe('approve');
    }
    for (const word of ['no', 'No', 'nope', 'reject', 'deny', 'cancel', 'stop', 'STOP']) {
      expect(matchDecision(word)).toBe('reject');
    }
  });

  it('" OK " 这种带空格的也认', () => {
    expect(matchDecision(' OK ')).toBe('approve');
    expect(matchDecision('  stop?  ')).toBe('reject');
  });

  it('全角字母和全角空格先折成半角', () => {
    expect(matchDecision('ｙｅｓ')).toBe('approve');
    expect(matchDecision('　OK　')).toBe('approve');
  });

  it('疑问句不给结论：可以吗 / 行吗 / 好的吗 / 可以么', () => {
    expect(matchDecision('可以吗')).toBeNull();
    expect(matchDecision('行吗')).toBeNull();
    expect(matchDecision('好的吗')).toBeNull();
    expect(matchDecision('可以么')).toBeNull();
  });

  it('否定优先于肯定词', () => {
    expect(matchDecision('不可以')).toBe('reject');
    expect(matchDecision('不要继续')).toBe('reject');
    expect(matchDecision('没有问题')).toBe('reject');
    expect(matchDecision('可以，但是不要')).toBe('reject');
  });

  it('否定优先于疑问语气（带否定就是拒绝）', () => {
    expect(matchDecision('不行吗')).toBe('reject');
  });

  it('句尾语气词剥掉之后才比白名单', () => {
    expect(matchDecision('好的呀')).toBe('approve');
    expect(matchDecision('继续吧')).toBe('approve');
    expect(matchDecision('可以啊')).toBe('approve');
    expect(matchDecision('好的呀。')).toBe('approve');
    expect(matchDecision('行呢')).toBe('approve');
  });

  it('两端标点剥掉，句中不动', () => {
    expect(matchDecision('可以。')).toBe('approve');
    expect(matchDecision('「继续」')).toBe('approve');
    expect(matchDecision('好！')).toBe('approve');
    expect(matchDecision('…算了…')).toBe('reject');
  });

  it('只认整句，多说了别的就说不清', () => {
    expect(matchDecision('好像可以')).toBeNull();
    expect(matchDecision('可以但是慢点')).toBeNull();
    expect(matchDecision('好 的')).toBeNull();
    expect(matchDecision('嗯')).toBeNull();
    expect(matchDecision('随便')).toBeNull();
  });

  it('空串和纯空白返回 null', () => {
    expect(matchDecision('')).toBeNull();
    expect(matchDecision('   ')).toBeNull();
    expect(matchDecision('　')).toBeNull();
  });

  it('运行时传进 null / undefined 也不炸', () => {
    expect(matchDecision(null as unknown as string)).toBeNull();
    expect(matchDecision(undefined as unknown as string)).toBeNull();
  });

  it('单个否定词也算拒绝，不要当没听见', () => {
    expect(matchDecision('不')).toBe('reject');
    expect(matchDecision('没')).toBe('reject');
    expect(matchDecision('禁止')).toBe('reject');
  });

  it('混合中英文交给调用方重问，不猜', () => {
    expect(matchDecision('OK 继续')).toBeNull();
    expect(matchDecision('No way')).toBeNull();
  });
});
