// Sincronização com o Google Drive.
// Usa o escopo drive.file: o app só enxerga arquivos que ele criou ou que a pessoa
// escolheu no seletor do Drive. O resto do Drive fica inacessível.
import CONFIG from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CFG_KEY = 'bolsacheia:drivecfg';
const TOKEN_KEY = 'bolsacheia:token';
export const FILE_NAME = 'bolsa-cheia-familia.json';

export class AuthError extends Error {}

let token = null;
let tokenExp = 0;
const scripts = {};

export function config() {
  let local = {};
  try { local = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch {}
  return {
    clientId: local.clientId || CONFIG.clientId,
    apiKey: local.apiKey || CONFIG.apiKey,
    appId: local.appId || CONFIG.appId,
  };
}

export function saveConfig(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {}
}

export function isConfigured() {
  const c = config();
  return Boolean(c.clientId && c.apiKey && c.appId);
}

export function hasToken() {
  if (!token) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
      if (saved) { token = saved.token; tokenExp = saved.exp; }
    } catch {}
  }
  return Boolean(token) && Date.now() < tokenExp - 60_000;
}

export function forgetToken() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null;
  tokenExp = 0;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

function loadScript(src) {
  scripts[src] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { delete scripts[src]; reject(new Error('Sem conexão com o Google.')); };
    document.head.appendChild(s);
  });
  return scripts[src];
}

// Precisa ser chamada a partir de um toque/clique, porque abre uma janela do Google.
export async function authorize() {
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: config().clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new AuthError(resp.error_description || resp.error));
        token = resp.access_token;
        tokenExp = Date.now() + Number(resp.expires_in || 3600) * 1000;
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: tokenExp })); } catch {}
        resolve(token);
      },
      error_callback: (err) => reject(new AuthError(err?.message || 'Login cancelado.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function api(url, opts = {}) {
  if (!hasToken()) throw new AuthError('Sessão do Google expirada.');
  const resp = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (resp.status === 401) { forgetToken(); throw new AuthError('Sessão do Google expirada.'); }
  if (resp.status === 404) throw new Error('Arquivo não encontrado no Drive (foi apagado ou o acesso foi removido).');
  if (!resp.ok) {
    let msg = `Erro ${resp.status} no Google Drive.`;
    try { msg = (await resp.json()).error?.message || msg; } catch {}
    throw new Error(msg);
  }
  return resp;
}

export async function createFile(data) {
  const boundary = 'bolsacheia' + Math.random().toString(36).slice(2);
  const meta = { name: FILE_NAME, mimeType: 'application/json', description: 'Dados do app Bolsa Cheia (finanças da família).' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;
  const resp = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return resp.json();
}

export async function readFile(id) {
  const resp = await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
  const text = await resp.text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}

export async function writeFile(id, data) {
  await api(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(data),
  });
}

export async function fileInfo(id) {
  const resp = await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,owners(displayName,emailAddress),modifiedTime`);
  return resp.json();
}

export async function shareFile(id, email) {
  await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/permissions?sendNotificationEmail=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
  });
}

// Abre o seletor do Drive para escolher o arquivo da família (ex.: o que o cônjuge compartilhou).
export async function pickFile() {
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve) => gapi.load('picker', resolve));
  const c = config();
  return new Promise((resolve) => {
    const shared = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes('application/json')
      .setOwnedByMe(false)
      .setMode(google.picker.DocsViewMode.LIST);
    const mine = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes('application/json')
      .setOwnedByMe(true)
      .setMode(google.picker.DocsViewMode.LIST);
    const picker = new google.picker.PickerBuilder()
      .setTitle(`Escolha o arquivo ${FILE_NAME}`)
      .setLocale('pt-BR')
      .addView(shared)
      .addView(mine)
      .setOAuthToken(token)
      .setDeveloperKey(c.apiKey)
      .setAppId(c.appId)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) resolve(data.docs[0]);
        else if (data.action === google.picker.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}
