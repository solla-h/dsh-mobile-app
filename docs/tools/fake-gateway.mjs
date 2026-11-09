// 测试用假网关：制造「不 hello」「半开」「正常」三种连接，并记录连接时间线。
// 另带一个假会话（sessions/history），message 有三种回执模式：
//   normal=回 sent 并回显 user/message 实时事件；no-ack=收下不回执（测「未确认/重试」）；
//   reject=回 error 帧（测「失败」）。
// REQ-1 用：session-create 会回 session-created（带 requestId 回显）；
//   no-history=吞掉 history 请求、no-create=吞掉 session-create（测首屏/建会话的 15s 超时）。
// normal 模式下 message 还会回一条 assistant/message，供 CI 旅程断言「发送 → 收到回复」；
//   normal 之外的回执模式（no-ack/reject）行为不变。
// 用法: node docs/tools/fake-gateway.mjs
// 页面: /pair?host=usb|lan  /pair.json?host=usb|lan（CI 用，不开浏览器/不写文件）
//       /mode?value=normal|no-hello|half-open|no-ack|reject|no-history|no-create  /log
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import wsPkg from 'ws';
const WebSocketServer = wsPkg.Server;
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// qrcode 只是用来画配对二维码；找不到就退化成「只打印 payload」，
// 不影响 no-hello / half-open / normal 三种模式的验证。
let QRCode = null;
for (const candidate of [
  'qrcode',
  'C:/Users/example/.dsh/profiles/web/node_modules/qrcode',
]) {
  try {
    QRCode = require(candidate);
    break;
  } catch {
    /* 继续试下一个 */
  }
}

const PORT = Number(process.env.PORT || 3999);
const LAN_HOST = process.env.LAN_HOST || '192.168.1.10';
// 地址簿：设置了 RENDEZVOUS_URL（https origin）和 RENDEZVOUS_KEY（43 字符）
// 才会出现在 hello capabilities 里并响应 rendezvous-config。
// Worker 本体用 dsh-mobile-rendezvous 或 quick tunnel 指向本地假 Worker。
const RENDEZVOUS_URL = process.env.RENDEZVOUS_URL || '';
const RENDEZVOUS_KEY = process.env.RENDEZVOUS_KEY || '';
const RENDEZVOUS_READY = /^https:\/\/[^\s]+$/.test(RENDEZVOUS_URL) && /^[A-Za-z0-9_-]{43}$/.test(RENDEZVOUS_KEY);
let mode = 'normal';
const events = [];

// 一个假会话：让 App 能进到会话页里发消息（发件箱边界复现用）。
// updatedAt 用固定值——每次启动都变会把会话标成「有更新」。
const FAKE_SESSION_ID = 'fake-session-1';
const FAKE_EVENTS = [
  { seq: 1, time: 1730000000001, type: 'user/message', data: { content: [{ type: 'text', text: '假网关会话，用来测发件箱边界。' }] } },
  { seq: 2, time: 1730000000002, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '在。' }] } } },
];
let echoSeq = 1000; // 实时回显的 seq 起点，避开历史里的 1/2
const createdSessions = []; // session-create 建出来的会话，让列表页看得到
let createdCount = 0;

function record(event, extra = {}) {
  events.push({ at: new Date().toISOString(), event, ...extra });
  if (events.length > 500) events.shift();
  console.log(JSON.stringify(events[events.length - 1]));
}

/** /pair 和 /pair.json 共用同一份载荷，避免两个入口的地址/配对码漂移。 */
function pairingPayload(host) {
  const publicUrl = 'ws://' + host + ':' + PORT + '/ws/mobile';
  return {
    version: 2,
    publicUrl,
    pairingCode: 'fake-pair',
    expiresAt: Date.now() + 300000,
    gatewayId: 'fake-gateway',
    gatewayName: 'fake-gateway',
    endpoints: [publicUrl, 'ws://' + (host === '127.0.0.1' ? LAN_HOST : '127.0.0.1') + ':' + PORT + '/ws/mobile'],
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/mode') {
    mode = url.searchParams.get('value') || 'normal';
    record('mode', { mode });
    res.setHeader('content-type', 'text/plain');
    res.end('mode=' + mode + '\n');
    return;
  }
  if (url.pathname === '/log') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ mode, events }, null, 2));
    return;
  }
  if (url.pathname === '/pair.json') {
    // CI 用：只交 JSON 配对串，不开浏览器、不写文件（.scratch 可能不存在）。
    const host = url.searchParams.get('host') === 'lan' ? LAN_HOST : '127.0.0.1';
    const payload = pairingPayload(host);
    const pairingString = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      format: 'base64url',
      pairingString,
      publicUrl: payload.publicUrl,
      gatewayId: payload.gatewayId,
      expiresAt: payload.expiresAt,
    }));
    return;
  }
  if (url.pathname === '/pair') {
    const host = url.searchParams.get('host') === 'lan' ? LAN_HOST : '127.0.0.1';
    const payload = pairingPayload(host);
    const publicUrl = payload.publicUrl;
    const qrPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    if (!QRCode) {
      res.setHeader('content-type', 'text/plain');
      res.end('qrcode module missing; paste this pairing payload manually:' + String.fromCharCode(10) + qrPayload);
      return;
    }
    const svg = await QRCode.toString(qrPayload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    const html = '<!doctype html><meta charset="utf-8"><title>fake gateway</title>' +
      '<style>body{margin:0;background:#111;color:#eee;font:15px/1.7 system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px}.card{background:#fff;padding:18px;border-radius:14px}svg{width:400px;height:400px;display:block}code{color:#9cdcfe}</style>' +
      '<div class="card">' + svg + '</div>' +
      '<div><b>fake-gateway</b> · mode=<code>' + mode + '</code></div>' +
      '<div class="muted">入口 <code>' + publicUrl + '</code></div>';
    fs.writeFileSync('.scratch/fake-pair.html', html);
    execFile('cmd', ['/c', 'start', '', path.resolve('.scratch/fake-pair.html')], () => {});
    res.setHeader('content-type', 'text/html');
    res.end(html);
    return;
  }
  res.end('fake gateway');
});

const wss = new WebSocketServer({ server, path: '/ws/mobile' });
wss.on('connection', (ws, req) => {
  const channel = String(req.headers['x-dsh-channel'] || 'legacy');
  const id = Math.random().toString(36).slice(2, 8);
  record('open', { id, channel, mode, auth: Boolean(req.headers.authorization) });
  ws.on('close', (code, reason) => record('close', { id, channel, code, reason: String(reason) }));
  ws.on('error', (error) => record('error', { id, channel, message: error.message }));
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'ping') record('ping', { id, channel });
    if (mode === 'half-open') return;
    if (msg.type === 'ping') ws.send(JSON.stringify({ kind: 'pong' }));
    if (msg.type === 'sessions') {
      record('sessions', { id, channel, mode });
      ws.send(JSON.stringify({ kind: 'sessions', items: [{
        sessionId: FAKE_SESSION_ID, updatedAt: 1730000000000, running: false, blank: false,
        cwd: 'C:/fake', projections: { asOfSeq: 2, values: { title: '假网关会话' } },
      }, ...createdSessions] }));
    }
    if (msg.type === 'history') {
      record('history', { id, channel, mode, sessionId: msg.sessionId, beforeSeq: msg.beforeSeq, requestId: msg.requestId });
      if (mode === 'no-history') return; // 吞掉不回：测 REQ-1 的首屏 15s 超时
      ws.send(JSON.stringify({
        kind: 'history', sessionId: msg.sessionId, view: msg.view ?? 'conversation',
        historyFormatVersion: msg.historyFormatVersion ?? 4,
        // 真网关会回显 requestId；假网关跟上，验证 App 的归位逻辑不靠「碰巧」
        ...(typeof msg.requestId === 'string' ? { requestId: msg.requestId } : {}),
        // 翻页请求（带 beforeSeq）没有更早的内容可给；session-create 出来的新会话也是空的
        events: msg.beforeSeq || msg.sessionId !== FAKE_SESSION_ID ? [] : FAKE_EVENTS,
        hasMore: false, cursor: echoSeq - 1,
      }));
    }
    if (msg.type === 'session-create') {
      record('session-create', { id, channel, mode, requestId: msg.requestId, cwd: msg.cwd });
      if (mode === 'no-create') return; // 吞掉不回：测 REQ-1 的建会话 15s 超时
      createdCount += 1;
      const sessionId = 'fake-created-' + createdCount;
      createdSessions.push({
        sessionId, updatedAt: 1730000000000 + createdCount, running: false, blank: true,
        cwd: msg.cwd ?? 'C:/fake', projections: { asOfSeq: 0, values: { title: '新建的假会话' } },
      });
      ws.send(JSON.stringify({
        kind: 'session-created', sessionId, requestId: msg.requestId,
        updatedAt: Date.now(), running: false, blank: true,
      }));
    }
    if (msg.type === 'message') {
      // 跨网关跳过验证靠这条记录：网关 B 的日志里不应该出现任何 message。
      record('message', { id, channel, mode, sessionId: msg.sessionId, text: msg.text, requestId: msg.requestId, files: msg.files });
      if (mode === 'no-ack') return; // 收下但不回执：App 20s 后标「未确认」，可手动重试
      if (mode === 'reject') {
        ws.send(JSON.stringify({ kind: 'error', code: 'session-not-found', message: 'fake reject', requestType: 'message', sessionId: msg.sessionId, requestId: msg.requestId }));
        return;
      }
      ws.send(JSON.stringify({ kind: 'sent', requestId: msg.requestId, sessionId: msg.sessionId }));
      // 回显实时 user/message，让 App 的本地回显被服务端版本替换（和真网关行为一致）。
      echoSeq += 1;
      ws.send(JSON.stringify({ kind: 'event', sessionId: msg.sessionId, seq: echoSeq, time: 1730000000000 + echoSeq, event: { type: 'user/message', source: 'user', text: String(msg.text ?? '') } }));
      // 再回一条助手消息：CI 旅程靠它断言「发送 → 收到回复」的接收链路。
      // 只断言用户文本不够——本地乐观回显会立刻上屏，无法证明服务端真的回包。
      echoSeq += 1;
      ws.send(JSON.stringify({ kind: 'event', sessionId: msg.sessionId, seq: echoSeq, time: 1730000000000 + echoSeq, event: { type: 'assistant/message', text: 'fake-gateway reply: ' + String(msg.text ?? '') } }));
    }
    if (msg.type === 'rendezvous-config') {
      record('rendezvous-config', { id, channel, requestId: msg.requestId });
      if (!RENDEZVOUS_READY) {
        ws.send(JSON.stringify({ kind: 'error', code: 'rendezvous/disabled', requestType: 'rendezvous-config', requestId: msg.requestId }));
      } else {
        ws.send(JSON.stringify({
          kind: 'rendezvous-config', requestId: msg.requestId,
          url: RENDEZVOUS_URL, key: RENDEZVOUS_KEY, gatewayId: 'fake-gateway',
        }));
      }
    }
    if (msg.type === 'workspaces') ws.send(JSON.stringify({ kind: 'workspaces', items: [], archivedSessionIds: [] }));
    if (msg.type === 'speech-catalog') ws.send(JSON.stringify({ kind: 'speech-catalog', available: false, providers: [] }));
  });

  // 只在「带配对码」的首连（或完全没有鉴权头的连接）发 paired。
  // 重连已经带 token，再发 paired 会让 App 的 paired 分支重启 control，制造假 churn。
  const protocols = String(req.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((item) => item.trim());
  const hasPairing = protocols.some((item) => item.startsWith('dsh-pair.'));
  if (hasPairing || !req.headers.authorization) {
    ws.send(JSON.stringify({ kind: 'paired', token: 'fake-token', device: { id: 'fake-device', name: 'fake' }, gatewayId: 'fake-gateway', gatewayName: 'fake-gateway' }));
  }
  if (mode === 'no-hello') return;

  ws.send(JSON.stringify({ kind: 'hello', gatewayId: 'fake-gateway', gatewayName: 'fake-gateway', protocol: 3, dshVersion: 'fake', historyFormatVersion: 4, authenticated: true, capabilities: RENDEZVOUS_READY ? ['rendezvous-v1'] : [] }));
  if (mode === 'half-open') return;

});

server.listen(PORT, '0.0.0.0', () => console.log('fake gateway listening on', PORT, 'mode', mode));
