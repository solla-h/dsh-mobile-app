// 测试用假网关：制造「不 hello」「半开」「正常」三种连接，并记录连接时间线。
// 用法: node .scratch/fake-gateway.mjs
// 页面: /pair?host=usb|lan  /mode?value=normal|no-hello|half-open  /log
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
let mode = 'normal';
const events = [];

function record(event, extra = {}) {
  events.push({ at: new Date().toISOString(), event, ...extra });
  if (events.length > 500) events.shift();
  console.log(JSON.stringify(events[events.length - 1]));
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
  if (url.pathname === '/pair') {
    const host = url.searchParams.get('host') === 'lan' ? LAN_HOST : '127.0.0.1';
    const publicUrl = 'ws://' + host + ':' + PORT + '/ws/mobile';
    const payload = {
      version: 2,
      publicUrl,
      pairingCode: 'fake-pair',
      expiresAt: Date.now() + 300000,
      gatewayId: 'fake-gateway',
      gatewayName: 'fake-gateway',
      endpoints: [publicUrl, 'ws://' + (host === '127.0.0.1' ? LAN_HOST : '127.0.0.1') + ':' + PORT + '/ws/mobile'],
    };
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
    if (msg.type === 'sessions') ws.send(JSON.stringify({ kind: 'sessions', items: [] }));
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

  ws.send(JSON.stringify({ kind: 'hello', gatewayId: 'fake-gateway', gatewayName: 'fake-gateway', protocol: 3, dshVersion: 'fake', historyFormatVersion: 4, authenticated: true, capabilities: [] }));
  if (mode === 'half-open') return;

});

server.listen(PORT, '0.0.0.0', () => console.log('fake gateway listening on', PORT, 'mode', mode));
