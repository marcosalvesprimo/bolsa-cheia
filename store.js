// Dados do app: guarda no aparelho, mescla com o arquivo do Google Drive e faz as contas do mês.
import * as drive from './drive.js';

const DATA_KEY = 'bolsacheia:data';
const META_KEY = 'bolsacheia:meta';
// rules: classificação que a pessoa escolheu na importação, por descrição (o app aprende com ela).
const COLLECTIONS = ['tx', 'debts', 'boxes', 'cats', 'rules'];
const REQUIRED = ['tx', 'debts', 'boxes', 'cats']; // arquivos antigos não têm "rules"

// IDs fixos: quando os dois aparelhos se juntam, as categorias padrão não duplicam.
const DEFAULT_CATS = [
  ['cat-moradia', 'Moradia', 'necessidade'],
  ['cat-mercado', 'Mercado', 'necessidade'],
  ['cat-contas', 'Contas da casa', 'necessidade'],
  ['cat-transporte', 'Transporte', 'necessidade'],
  ['cat-saude', 'Saúde', 'necessidade'],
  ['cat-educacao', 'Educação', 'necessidade'],
  ['cat-restaurantes', 'Restaurantes e delivery', 'desejo'],
  ['cat-lazer', 'Lazer e viagens', 'desejo'],
  ['cat-compras', 'Compras e roupas', 'desejo'],
  ['cat-assinaturas', 'Assinaturas', 'desejo'],
  ['cat-outros', 'Outros', 'desejo'],
];

export const PURPOSES = {
  reserva: 'Reserva de emergência',
  casa: 'Casa própria',
  futuro: 'Renda futura / aposentadoria',
  outro: 'Outro objetivo',
};
export const RISKS = { baixo: 'Risco baixo', medio: 'Risco médio', alto: 'Risco alto' };

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function emptyData() {
  const cats = {};
  for (const [id, name, kind] of DEFAULT_CATS) cats[id] = { id, name, kind, budget: 0, updatedAt: 0 };
  return {
    v: 1,
    settings: { members: [], savePct: 10, dabasir: { living: 70, debt: 20, save: 10 }, dabasirAuto: true, updatedAt: 0 },
    tx: {},
    debts: {},
    boxes: {
      'box-reserva': { id: 'box-reserva', name: 'Reserva de emergência', purpose: 'reserva', where: '', risk: 'baixo', target: 0, rate: 0, yield: 0, updatedAt: 0 },
    },
    cats,
    rules: {},
  };
}

function readJSON(storage, key) {
  try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
}
function writeJSON(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch {}
}

// Registro com updatedAt mais recente vence. Exclusões são registros com deleted: true.
export function merge(a, b) {
  if (!b) return a;
  const out = {
    v: 1,
    settings: (b.settings?.updatedAt || 0) > (a.settings?.updatedAt || 0) ? b.settings : a.settings,
  };
  for (const c of COLLECTIONS) {
    out[c] = { ...(a[c] || {}) };
    for (const [id, rec] of Object.entries(b[c] || {})) {
      const cur = out[c][id];
      if (!cur || (rec.updatedAt || 0) > (cur.updatedAt || 0)) out[c][id] = rec;
    }
  }
  return out;
}

function sameData(x, y) {
  if ((x.settings?.updatedAt || 0) !== (y.settings?.updatedAt || 0)) return false;
  for (const c of COLLECTIONS) {
    const xs = x[c] || {};
    const ys = y[c] || {};
    if (Object.keys(xs).length !== Object.keys(ys).length) return false;
    for (const id in xs) if (!ys[id] || (ys[id].updatedAt || 0) !== (xs[id].updatedAt || 0)) return false;
  }
  return true;
}

function isValidData(d) {
  return d && typeof d === 'object' && d.v === 1 && d.settings && REQUIRED.every((c) => d[c] && typeof d[c] === 'object');
}

let data = merge(emptyData(), readJSON(localStorage, DATA_KEY));
let meta = { fileId: null, fileName: null, lastSync: 0, dirty: false, me: null, theme: 'auto', ...(readJSON(localStorage, META_KEY) || {}) };
let rev = 0;
const listeners = new Set();

export const sync = { status: meta.fileId ? 'idle' : 'off', error: '' };

function emit() { for (const fn of listeners) fn(); }
function saveLocal() { writeJSON(localStorage, DATA_KEY, data); }
function saveMeta() { writeJSON(localStorage, META_KEY, meta); }

function setStatus(status, error = '') {
  sync.status = status;
  sync.error = error;
  emit();
}

function commit() {
  rev++;
  saveLocal();
  meta.dirty = true;
  saveMeta();
  emit();
  scheduleSync();
}

export const store = {
  get data() { return data; },
  get meta() { return meta; },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  list(coll) { return Object.values(data[coll]).filter((r) => !r.deleted); },
  get(coll, id) { const r = data[coll][id]; return r && !r.deleted ? r : null; },
  put(coll, rec) {
    data[coll][rec.id] = { ...rec, updatedAt: Date.now() };
    commit();
    return data[coll][rec.id];
  },
  putMany(coll, recs) {
    const now = Date.now();
    for (const rec of recs) data[coll][rec.id] = { ...rec, updatedAt: now };
    commit();
  },
  remove(coll, id) {
    const r = data[coll][id];
    if (!r) return;
    data[coll][id] = { ...r, deleted: true, updatedAt: Date.now() };
    commit();
  },
  setSettings(patch) {
    data.settings = { ...data.settings, ...patch, updatedAt: Date.now() };
    commit();
  },
  setMeta(patch) {
    meta = { ...meta, ...patch };
    saveMeta();
    emit();
  },
  importData(incoming) {
    if (!isValidData(incoming)) throw new Error('Este arquivo não é um backup do Bolsa Cheia.');
    data = merge(data, incoming);
    commit();
  },
  exportData() { return JSON.parse(JSON.stringify(data)); },
  resetDevice() {
    try { localStorage.removeItem(DATA_KEY); localStorage.removeItem(META_KEY); } catch {}
    drive.forgetToken();
  },
};

// ---------- Google Drive ----------

let syncTimer = null;
let running = null;
let again = false;

export function scheduleSync(delay = 1500) {
  if (!meta.fileId) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow().catch(() => {}), delay);
}

// interactive: pode abrir a janela de login do Google (só a partir de um toque).
export function syncNow({ interactive = false } = {}) {
  if (!meta.fileId) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      if (!drive.hasToken()) {
        if (!interactive) return setStatus('login');
        await drive.authorize();
      }
      setStatus('syncing');
      const remote = await drive.readFile(meta.fileId);
      if (remote && !isValidData(remote)) throw new Error('O arquivo do Drive não parece ser do Bolsa Cheia.');
      data = merge(data, remote);
      saveLocal();
      const startRev = rev;
      if (meta.dirty || !remote || !sameData(remote, data)) await drive.writeFile(meta.fileId, data);
      meta.lastSync = Date.now();
      if (rev === startRev) meta.dirty = false;
      else again = true;
      saveMeta();
      setStatus('ok');
    } catch (e) {
      if (e instanceof drive.AuthError) setStatus('login', e.message);
      else setStatus('error', e.message || String(e));
      throw e;
    } finally {
      running = null;
      if (again) { again = false; scheduleSync(500); }
    }
  })();
  return running;
}

export async function createDriveFile() {
  if (!drive.hasToken()) await drive.authorize();
  const file = await drive.createFile(data);
  store.setMeta({ fileId: file.id, fileName: file.name, dirty: false, lastSync: Date.now() });
  setStatus('ok');
}

export async function openDriveFile() {
  if (!drive.hasToken()) await drive.authorize();
  const doc = await drive.pickFile();
  if (!doc) return false;
  const remote = await drive.readFile(doc.id);
  if (!isValidData(remote)) throw new Error('Esse arquivo não é do Bolsa Cheia. Escolha o bolsa-cheia-familia.json.');
  store.setMeta({ fileId: doc.id, fileName: doc.name });
  data = merge(data, remote);
  saveLocal();
  await syncNow();
  return true;
}

export function disconnectDrive() {
  clearTimeout(syncTimer);
  store.setMeta({ fileId: null, fileName: null, lastSync: 0 });
  setStatus('off');
}

// ---------- Contas ----------

export const monthOf = (date) => date.slice(0, 7);

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function txOfMonth(month) {
  return store.list('tx').filter((t) => monthOf(t.date) === month);
}

export function debtBalance(debt) {
  const paid = store.list('tx').filter((t) => t.type === 'divida' && t.debtId === debt.id).reduce((s, t) => s + t.amount, 0);
  return { paid, balance: Math.max(0, debt.original - paid) };
}

export function activeDebts() {
  return store.list('debts').map((d) => ({ ...d, ...debtBalance(d) })).filter((d) => d.balance > 0);
}

export function boxBalance(box) {
  let net = 0;
  for (const t of store.list('tx')) {
    if (t.boxId !== box.id) continue;
    if (t.type === 'guardar') net += t.amount;
    else if (t.type === 'resgate') net -= t.amount;
  }
  return { net, balance: net + (box.yield || 0) };
}

export function boxesWithBalance() {
  return store.list('boxes').map((b) => ({ ...b, ...boxBalance(b) }));
}

export function incomeOf(month) {
  return txOfMonth(month).filter((t) => t.type === 'receita').reduce((s, t) => s + t.amount, 0);
}

// Média de renda dos n meses anteriores que tiveram renda.
export function avgIncomeBefore(month, n = 3) {
  const vals = [];
  for (let i = 1; i <= n; i++) {
    const v = incomeOf(addMonths(month, -i));
    if (v > 0) vals.push(v);
  }
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

export function dabasirActive() {
  return data.settings.dabasirAuto && activeDebts().length > 0;
}

export function summary(month) {
  const s = data.settings;
  const txs = txOfMonth(month);
  const out = { income: 0, spent: 0, saved: 0, debtPaid: 0, byCat: {}, byWho: {} };
  for (const t of txs) {
    if (t.type === 'receita') {
      out.income += t.amount;
      out.byWho[t.who || '—'] = (out.byWho[t.who || '—'] || 0) + t.amount;
    } else if (t.type === 'despesa') {
      out.spent += t.amount;
      out.byCat[t.catId] = (out.byCat[t.catId] || 0) + t.amount;
    } else if (t.type === 'guardar') out.saved += t.amount;
    else if (t.type === 'resgate') out.saved -= t.amount;
    else if (t.type === 'divida') out.debtPaid += t.amount;
  }
  out.dabasir = dabasirActive();
  if (out.dabasir) {
    out.savePct = s.dabasir.save;
    out.debtPct = s.dabasir.debt;
    out.livingPct = s.dabasir.living;
  } else {
    out.savePct = s.savePct;
    out.debtPct = 0;
    out.livingPct = 100 - s.savePct;
  }
  out.saveGoal = Math.round((out.income * out.savePct) / 100);
  out.debtGoal = Math.round((out.income * out.debtPct) / 100);
  out.livingLimit = out.income - out.saveGoal - out.debtGoal;
  return out;
}

// Divide `amount` entre os credores na proporção do saldo, sem passar do saldo de cada um.
export function splitDabasir(amount, debts) {
  const total = debts.reduce((s, d) => s + d.balance, 0);
  if (!total || amount <= 0) return debts.map((d) => ({ debt: d, share: 0 }));
  if (amount >= total) return debts.map((d) => ({ debt: d, share: d.balance }));
  const parts = debts.map((d) => {
    const exact = (amount * d.balance) / total;
    return { debt: d, share: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let rest = amount - parts.reduce((s, p) => s + p.share, 0);
  for (const p of [...parts].sort((a, b) => b.frac - a.frac)) {
    if (rest <= 0) break;
    p.share++;
    rest--;
  }
  return parts.map(({ debt, share }) => ({ debt, share }));
}

// Valor futuro com aporte no fim de cada mês; taxa anual convertida em mensal equivalente.
export function compound({ initial, monthly, ratePct, years }) {
  const n = Math.round(years * 12);
  const r = Math.pow(1 + ratePct / 100, 1 / 12) - 1;
  const rows = [];
  let value = initial;
  for (let i = 1; i <= n; i++) {
    value = value * (1 + r) + monthly;
    if (i % 12 === 0 || i === n) rows.push({ month: i, value: Math.round(value), invested: initial + monthly * i });
  }
  const invested = initial + monthly * n;
  return { final: Math.round(n ? value : initial), invested, interest: Math.round((n ? value : initial) - invested), rows };
}
