// Bolsa Cheia: telas e interação.
import { CURAS, LEIS, DABASIR, DICAS } from './lessons.js';
import * as drive from './drive.js';
import * as imp from './importar.js';
import {
  store, sync, syncNow, createDriveFile, openDriveFile, disconnectDrive,
  PURPOSES, RISKS, uid, todayISO, monthOf, addMonths, txOfMonth, summary, activeDebts,
  debtBalance, boxesWithBalance, avgIncomeBefore, dabasirActive, splitDabasir, compound,
} from './store.js';

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

const state = {
  month: todayISO().slice(0, 7),
  filter: 'todos',
  search: '',
  onboard: 'choose',
  sim: null,
  imp: emptyImp(),
};

// Importação em andamento: documentos lidos e itens sugeridos, antes de lançar. Só em memória.
function emptyImp() {
  return { files: [], items: [], running: false, who: null, paste: '', showPrompt: false };
}

// ---------- Utilidades ----------

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (c) => BRL.format((c || 0) / 100);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const moneyInput = (c) => (c ? (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const pct = (a, b) => (b > 0 ? Math.round((a * 100) / b) : 0);
const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0);

// Aceita "1.234,56", "1234,56", "1234.56" e "1.234".
function parseMoney(str) {
  let s = String(str || '').replace(/[R$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function monthLabel(m) {
  const [y, mm] = m.split('-').map(Number);
  const s = new Date(y, mm - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s[0].toUpperCase() + s.slice(1);
}
function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function timeAgo(ts) {
  if (!ts) return 'nunca';
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(ts).toLocaleDateString('pt-BR');
}

const settings = () => store.data.settings;
const members = () => settings().members || [];
const me = () => store.meta.me || members()[0] || '';

function catName(id) {
  const c = store.data.cats[id];
  if (!c) return 'Sem categoria';
  return c.deleted ? `${c.name} (removida)` : c.name;
}
function boxName(id) {
  const b = store.data.boxes[id];
  return b ? b.name : 'Caixinha removida';
}
function debtName(id) {
  const d = store.data.debts[id];
  return d ? d.creditor : 'Dívida removida';
}

function defaultDate() {
  const today = todayISO();
  return monthOf(today) === state.month ? today : `${state.month}-01`;
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), 3200);
}

// ---------- Ícones ----------

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  coins: '<ellipse cx="9" cy="6" rx="6" ry="2.5"/><path d="M3 6v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V6"/><path d="M3 10v4c0 1.4 2.7 2.5 6 2.5"/><ellipse cx="15" cy="14" rx="6" ry="2.5"/><path d="M9 14v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cloud: '<path d="M17.5 19H7a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 11 4 4 0 0 1 17.5 19z"/>',
  cloudoff: '<path d="m2 2 20 20"/><path d="M5.8 8.8A5 5 0 0 0 7 19h10.5c.6 0 1.1-.1 1.6-.3M21 15.3A4 4 0 0 0 19.5 11a6 6 0 0 0-8.9-4.6"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  bulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 3.5a4 4 0 0 1 0 9M22 21a7 7 0 0 0-4-6.3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#1f4e9a"/><path d="M24 13h16l-4 8h-8z" fill="#d9a63a"/><path d="M28 21c-9 4-15 12-15 21 0 7 6 10 19 10s19-3 19-10c0-9-6-17-15-21z" fill="#d9a63a"/><path d="M32 29v17M36.8 32.6c-1-1.5-2.7-2.1-4.7-2.1-2.6 0-4.2 1.3-4.2 3.1s1.7 2.6 4.2 3.1 4.2 1.4 4.2 3.3-1.8 3.3-4.4 3.3c-2.1 0-3.8-.7-4.8-2.3" stroke="#1f4e9a" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`;

// ---------- Estrutura ----------

const NAV = [
  ['inicio', 'Início', 'home'],
  ['extrato', 'Extrato', 'list'],
  ['importar', 'Importar', 'upload'],
  ['orcamento', 'Orçamento', 'pie'],
  ['dividas', 'Dívidas', 'link'],
  ['patrimonio', 'Patrimônio', 'coins'],
];
const NAV2 = [
  ['licoes', 'Lições', 'book'],
  ['ajustes', 'Ajustes', 'gear'],
];
const VIEWS = {
  inicio: viewInicio,
  extrato: viewExtrato,
  importar: viewImportar,
  orcamento: viewOrcamento,
  dividas: viewDividas,
  patrimonio: viewPatrimonio,
  licoes: viewLicoes,
  ajustes: viewAjustes,
};

function currentView() {
  const v = location.hash.slice(1);
  return VIEWS[v] ? v : 'inicio';
}

function syncChip() {
  const st = store.meta.fileId ? sync.status : 'off';
  const map = {
    off: ['cloudoff', 'Só no aparelho', 'goto-drive'],
    idle: ['cloud', 'Sincronizar', 'sync'],
    ok: ['check', 'Sincronizado', 'sync'],
    syncing: ['sync', 'Sincronizando', ''],
    login: ['cloud', 'Entrar no Google', 'sync'],
    error: ['alert', 'Erro na sincronia', 'sync'],
  };
  const [ic, label, action] = map[st] || map.idle;
  const title = st === 'error' ? sync.error : st === 'ok' ? `Última sincronia ${timeAgo(store.meta.lastSync)}` : label;
  return `<button class="syncchip ${st}" ${action ? `data-action="${action}"` : 'disabled'} title="${esc(title)}">${icon(ic)}<span>${label}</span></button>`;
}

function shell(v, content) {
  const cur = (k) => (k === v ? 'aria-current="page"' : '');
  const showFab = !['licoes', 'ajustes', 'importar'].includes(v);
  return `
  <header class="topbar">
    <a class="brand" href="#inicio">${LOGO}<span>Bolsa Cheia</span></a>
    ${syncChip()}
    <span class="navicons">
      ${NAV2.map(([k, l, ic]) => `<a class="iconbtn" href="#${k}" aria-label="${l}" ${cur(k)}>${icon(ic)}</a>`).join('')}
    </span>
  </header>
  <div class="layout">
    <nav class="side" aria-label="Menu">
      ${NAV.map(([k, l, ic]) => `<a href="#${k}" ${cur(k)}>${icon(ic)}${l}</a>`).join('')}
      <div class="sep"></div>
      ${NAV2.map(([k, l, ic]) => `<a href="#${k}" ${cur(k)}>${icon(ic)}${l}</a>`).join('')}
    </nav>
    <main class="view">${content}</main>
  </div>
  <nav class="bottomnav" aria-label="Menu">
    ${NAV.map(([k, l, ic]) => `<a class="navlink" href="#${k}" ${cur(k)}>${icon(ic)}<span>${l}</span></a>`).join('')}
  </nav>
  ${showFab ? `<button class="fab" data-action="new-tx">${icon('plus')}Lançar</button>` : ''}`;
}

function monthNav() {
  return `<div class="monthnav">
    <button class="iconbtn" data-action="month" data-delta="-1" aria-label="Mês anterior">${icon('left')}</button>
    <span>${monthLabel(state.month)}</span>
    <button class="iconbtn" data-action="month" data-delta="1" aria-label="Próximo mês">${icon('right')}</button>
  </div>`;
}

function pageHead(title, sub = '', withMonth = true) {
  return `<div class="pagehead"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${withMonth ? monthNav() : ''}</div>`;
}

let pendingRender = false;

function isTyping() {
  const el = document.activeElement;
  return el && $app.contains(el) && el.matches('input:not([type=checkbox]):not([type=radio]), select, textarea');
}

// Mudanças que chegam da sincronia esperam a pessoa terminar de digitar.
function render({ force = false } = {}) {
  if (!force && isTyping()) { pendingRender = true; return; }
  pendingRender = false;
  const active = document.activeElement;
  const focusId = active && $app.contains(active) ? active.id : null;
  const sel = focusId && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

  if (!members().length || !store.meta.me) {
    $app.innerHTML = viewOnboarding();
  } else {
    const v = currentView();
    $app.innerHTML = shell(v, VIEWS[v]());
    document.title = v === 'inicio' ? 'Bolsa Cheia' : `${[...NAV, ...NAV2].find(([k]) => k === v)[1]} · Bolsa Cheia`;
  }

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (sel) try { el.setSelectionRange(...sel); } catch {}
    }
  }
}

// ---------- Componentes ----------

function meter({ name, value, goal, fill = '', status }) {
  const w = goal > 0 ? Math.max(0, Math.min(100, (value / goal) * 100)) : 0;
  return `<div class="meter">
    <div class="top"><span class="name">${name}</span><span class="vals num">${money(value)} <span class="muted">de ${money(goal)}</span></span></div>
    <div class="track" role="progressbar" aria-label="${esc(name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(w)}"><div class="fill ${fill}" style="width:${w}%"></div></div>
    <div class="status ${status.cls || ''}">${status.icon ? icon(status.icon) : ''}<span>${status.text}</span></div>
  </div>`;
}

function meterSave(s) {
  let status;
  if (!s.income) status = { icon: 'circle', text: 'Lance a renda para calcular a meta' };
  else if (s.saved >= s.saveGoal) status = { cls: 'good', icon: 'check', text: 'Meta cumprida' };
  else status = { icon: 'clock', text: `Faltam ${money(s.saveGoal - s.saved)}` };
  return meter({ name: `Guardado (${s.savePct}%)`, value: s.saved, goal: s.saveGoal, fill: 'gold', status });
}

function meterSpend(s) {
  let status;
  let fill = '';
  if (!s.income) status = { icon: 'circle', text: s.spent ? `Gastou ${money(s.spent)} sem renda lançada` : 'Sem renda lançada no mês' };
  else if (s.spent > s.livingLimit) {
    fill = 'crit';
    status = { cls: 'crit', icon: 'alert', text: `Passou ${money(s.spent - s.livingLimit)} do limite` };
  } else if (s.spent >= s.livingLimit * 0.9) {
    fill = 'warn';
    status = { cls: 'warn', icon: 'alert', text: `Resta ${money(s.livingLimit - s.spent)}: perto do limite` };
  } else status = { icon: 'check', text: `Resta ${money(s.livingLimit - s.spent)} para gastar` };
  return meter({ name: `Gasto para viver (${s.livingPct}%)`, value: s.spent, goal: s.livingLimit, fill, status });
}

function meterDebt(s) {
  let status;
  if (!s.income) status = { icon: 'circle', text: 'Lance a renda para calcular a parte dos credores' };
  else if (s.debtPaid >= s.debtGoal) status = { cls: 'good', icon: 'check', text: 'Parte dos credores paga' };
  else status = { icon: 'clock', text: `Faltam ${money(s.debtGoal - s.debtPaid)}` };
  return meter({ name: `Pago aos credores (${s.debtPct}%)`, value: s.debtPaid, goal: s.debtGoal, status });
}

const TYPES = {
  receita: { label: 'Receita', icon: 'up' },
  despesa: { label: 'Despesa', icon: 'down' },
  guardar: { label: 'Guardar', icon: 'coins' },
  resgate: { label: 'Resgatar', icon: 'coins' },
  divida: { label: 'Pagar dívida', icon: 'link' },
};

function txTitle(t) {
  if (t.desc) return t.desc;
  if (t.type === 'receita') return 'Receita';
  if (t.type === 'despesa') return catName(t.catId);
  if (t.type === 'guardar') return `Guardado: ${boxName(t.boxId)}`;
  if (t.type === 'resgate') return `Resgate: ${boxName(t.boxId)}`;
  return `Pagamento: ${debtName(t.debtId)}`;
}

function txMeta(t, withDate) {
  const parts = [];
  if (withDate) parts.push(dayLabel(t.date).split(',').slice(1).join(',').trim());
  if (t.desc) {
    if (t.type === 'despesa') parts.push(catName(t.catId));
    else if (t.type === 'guardar') parts.push(`Guardado: ${boxName(t.boxId)}`);
    else if (t.type === 'resgate') parts.push(`Resgate: ${boxName(t.boxId)}`);
    else if (t.type === 'divida') parts.push(debtName(t.debtId));
    else parts.push('Receita');
  }
  if (t.who) parts.push(t.who);
  return parts.map(esc).join(' · ');
}

function txRow(t, withDate = false) {
  const estorno = t.type === 'despesa' && t.amount < 0;
  const sign = t.type === 'receita' || estorno ? '+' : t.type === 'guardar' || t.type === 'resgate' ? '' : '−';
  const cls = t.type === 'receita' || estorno ? 'good' : '';
  return `<button class="rowitem" data-action="edit-tx" data-id="${t.id}">
    <span class="txicon ${t.type}">${icon(TYPES[t.type].icon)}</span>
    <span class="main"><span class="title" style="display:block">${esc(txTitle(t))}</span><span class="meta" style="display:block">${txMeta(t, withDate)}</span></span>
    <span class="amt ${cls}">${sign}${money(Math.abs(t.amount))}</span>
  </button>`;
}

function empty(ic, text) {
  return `<div class="empty">${icon(ic)}<p>${text}</p></div>`;
}

function tipCard(d, actions = '') {
  return `<section class="card tip">
    <span class="ico">${icon('bulb')}</span>
    <div><h3>${esc(d.titulo)}</h3><p>${esc(d.texto)}</p>${actions ? `<div class="actions">${actions}</div>` : ''}</div>
  </section>`;
}

// ---------- Início ----------

function pickTip(s, boxes) {
  if (!s.income) return ['semRenda', `<button class="btn sm primary" data-action="new-tx" data-type="receita">Lançar receita</button>`];
  if (s.saved < s.saveGoal) return ['guardarPouco', `<button class="btn sm gold" data-action="new-tx" data-type="guardar" data-amount="${s.saveGoal - s.saved}">Guardar ${money(s.saveGoal - s.saved)}</button>`];
  if (s.spent > s.livingLimit) return ['gastoAlto', `<a class="btn sm" href="#orcamento">Ver orçamento</a>`];
  if (s.dabasir) return ['dividas', `<a class="btn sm" href="#dividas">Ver dívidas</a>`];
  if (sum(boxes.filter((b) => b.purpose === 'reserva'), (b) => b.balance) <= 0) return ['semReserva', `<a class="btn sm" href="#patrimonio">Ver caixinhas</a>`];
  if (boxes.some((b) => b.balance > 0 && !(b.rate > 0))) return ['multiplicar', `<a class="btn sm" href="#patrimonio">Ver caixinhas</a>`];
  return ['ok', ''];
}

function viewInicio() {
  const m = state.month;
  const s = summary(m);
  const boxes = boxesWithBalance();
  const patrimonio = sum(boxes, (b) => b.balance);
  const debtTotal = sum(activeDebts(), (d) => d.balance);
  const recent = txOfMonth(m).sort(byDateDesc).slice(0, 6);
  const avg = avgIncomeBefore(m);
  const [tipKey, tipActions] = pickTip(s, boxes);
  const tip = DICAS[tipKey];
  const left = s.livingLimit - s.spent;

  let capacidade = '';
  if (s.income && avg) {
    const diff = pct(s.income - avg, avg);
    capacidade = `<section class="card tight">
      <div class="cardhead" style="margin-bottom:4px"><h3>Capacidade de ganhar</h3><span class="badge ${diff >= 0 ? 'good' : 'warn'}">${icon(diff >= 0 ? 'up' : 'down')}${diff >= 0 ? '+' : ''}${diff}%</span></div>
      <p class="small ink2">Renda do mês comparada com a média dos meses anteriores (${money(avg)}). ${diff >= 0 ? 'A renda está crescendo.' : 'Cura 7: quanto mais habilidade, maior a renda.'}</p>
    </section>`;
  }

  return `${pageHead(`Olá, ${esc(me())}`, '', true)}
  <div class="stack">
    <section class="card hero">
      <div class="cardhead" style="margin-bottom:0"><span class="label">Renda do mês</span><span class="badge">${s.dabasir ? `Plano de Dabasir ${s.livingPct}/${s.debtPct}/${s.savePct}` : `Guardar ${s.savePct}%`}</span></div>
      <div class="big num">${money(s.income)}</div>
      <div class="who">${Object.entries(s.byWho).map(([w, v]) => `<span>${esc(w)}: ${money(v)}</span>`).join('') || '<span>Nenhuma receita lançada</span>'}</div>
    </section>

    <section class="card">
      ${meterSave(s)}
      ${meterSpend(s)}
      ${s.dabasir ? meterDebt(s) : ''}
    </section>

    <div class="tiles">
      <div class="tile"><div class="label">Ainda pode gastar</div><div class="value num ${left < 0 ? 'crit' : ''}">${money(Math.max(0, left))}</div><div class="sub">${left < 0 ? `passou ${money(-left)}` : 'dentro do limite para viver'}</div></div>
      <a class="tile" href="#patrimonio" style="text-decoration:none;color:inherit"><div class="label">Patrimônio</div><div class="value num">${money(patrimonio)}</div><div class="sub">${boxes.length} caixinha${boxes.length === 1 ? '' : 's'}</div></a>
      <a class="tile" href="#dividas" style="text-decoration:none;color:inherit"><div class="label">Dívidas</div><div class="value num">${money(debtTotal)}</div><div class="sub">${debtTotal ? 'falta pagar' : 'nenhuma em aberto'}</div></a>
    </div>

    ${tipCard(tip, tipActions + (tip.cura ? `<a class="btn sm ghost" href="#licoes">Ler a cura ${tip.cura}</a>` : ''))}
    ${capacidade}

    <section class="card">
      <div class="cardhead"><h2>Últimos lançamentos</h2><a class="btn sm ghost" href="#extrato">Ver extrato</a></div>
      ${recent.length ? `<div class="list">${recent.map((t) => txRow(t, true)).join('')}</div>` : empty('list', 'Nenhum lançamento neste mês. Toque em <strong>Lançar</strong> para começar.')}
    </section>
  </div>`;
}

// ---------- Extrato ----------

const FILTERS = [
  ['todos', 'Todos'],
  ['receita', 'Receitas'],
  ['despesa', 'Despesas'],
  ['caixinhas', 'Caixinhas'],
  ['divida', 'Dívidas'],
];

function viewExtrato() {
  const s = summary(state.month);
  const q = state.search.trim().toLowerCase();
  let txs = txOfMonth(state.month).sort(byDateDesc);
  if (state.filter === 'caixinhas') txs = txs.filter((t) => t.type === 'guardar' || t.type === 'resgate');
  else if (state.filter !== 'todos') txs = txs.filter((t) => t.type === state.filter);
  if (q) txs = txs.filter((t) => `${txTitle(t)} ${txMeta(t)}`.toLowerCase().includes(q));

  const days = new Map();
  for (const t of txs) {
    if (!days.has(t.date)) days.set(t.date, []);
    days.get(t.date).push(t);
  }

  return `${pageHead('Extrato')}
  <div class="stack">
    <div class="tiles">
      <div class="tile"><div class="label">Entradas</div><div class="value num good">${money(s.income)}</div></div>
      <div class="tile"><div class="label">Despesas</div><div class="value num">${money(s.spent)}</div></div>
      <div class="tile"><div class="label">Guardado</div><div class="value num gold">${money(s.saved)}</div></div>
      ${s.debtPaid ? `<div class="tile"><div class="label">Dívidas pagas</div><div class="value num">${money(s.debtPaid)}</div></div>` : ''}
    </div>
    <div class="chips" role="group" aria-label="Filtrar">
      ${FILTERS.map(([k, l]) => `<button class="chip" data-action="filter" data-filter="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join('')}
    </div>
    <label class="field"><span class="sr">Buscar</span><input id="search" class="input" type="search" placeholder="Buscar por descrição, categoria ou pessoa" value="${esc(state.search)}" data-input="search" autocomplete="off"></label>
    <section class="card tight">
      ${txs.length ? [...days].map(([d, list]) => `<div class="daygroup"><h4>${dayLabel(d)}</h4><div class="list">${list.map((t) => txRow(t)).join('')}</div></div>`).join('')
        : empty('list', q || state.filter !== 'todos' ? 'Nada encontrado com esse filtro.' : 'Nenhum lançamento neste mês.')}
    </section>
  </div>`;
}

// ---------- Importar ----------

const IMP_ACCEPT = '.ofx,.qfx,.csv,.txt,.xls,.xlsx,text/csv,application/x-ofx';
const IMP_NOTES = {
  pagamento_fatura: 'Pagamento de fatura: fica de fora para as compras não contarem duas vezes (elas entram pela fatura do cartão).',
  transferencia_propria: 'Transferência entre contas da família: não é receita nem despesa.',
  ignorar: 'Não parece ser uma movimentação.',
};
const DOC_TYPES = { extrato_conta: 'extrato', fatura_cartao: 'fatura de cartão', outro: 'documento' };

const shortDate = (iso) => iso.split('-').reverse().slice(0, 2).join('/');
const daysApart = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const choiceType = (choice) => choice.split(':')[0];

function fallbackCat() {
  return store.get('cats', 'cat-outros') ? 'cat-outros' : store.list('cats')[0]?.id || '';
}

function defaultChoice(l, boxId) {
  const cat = store.get('cats', l.categoria_id) ? l.categoria_id : fallbackCat();
  switch (l.classe) {
    case 'receita': return 'receita';
    case 'despesa':
    case 'estorno': return `despesa:${cat}`;
    case 'guardar': return boxId ? `guardar:${boxId}` : 'ignorar';
    case 'resgate': return boxId ? `resgate:${boxId}` : 'ignorar';
    case 'pagamento_divida': return store.get('debts', l.divida_id) ? `divida:${l.divida_id}` : `despesa:${cat}`;
    default: return 'ignorar';
  }
}

// A classificação lembrada ainda vale? (a categoria, caixinha ou dívida pode ter sido excluída)
function validChoice(choice) {
  const [type, ref] = choice.split(':');
  if (type === 'receita' || type === 'ignorar') return true;
  if (type === 'despesa') return !!store.get('cats', ref);
  if (type === 'guardar' || type === 'resgate') return !!store.get('boxes', ref);
  if (type === 'divida') return !!store.get('debts', ref);
  return false;
}

// Mesmo tipo, mesmo valor e data até 3 dias de diferença: provavelmente já foi lançado.
function findDuplicate(item) {
  const type = choiceType(item.choice);
  if (type === 'ignorar') return null;
  return store.list('tx').find((t) => t.type === type && Math.abs(t.amount) === Math.abs(item.amount) && daysApart(t.date, item.date) <= 3) || null;
}

function choiceOptions(selected) {
  const opt = (v, label) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${esc(label)}</option>`;
  const cats = store.list('cats').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const boxes = store.list('boxes');
  const debts = store.list('debts').map((d) => ({ ...d, ...debtBalance(d) })).filter((d) => d.balance > 0 || `divida:${d.id}` === selected);
  return opt('receita', 'Receita')
    + `<optgroup label="Despesa">${cats.map((c) => opt(`despesa:${c.id}`, `Despesa: ${c.name}`)).join('')}</optgroup>`
    + (boxes.length ? `<optgroup label="Guardar">${boxes.map((b) => opt(`guardar:${b.id}`, `Guardar: ${b.name}`)).join('')}</optgroup>` : '')
    + (boxes.length ? `<optgroup label="Resgate">${boxes.map((b) => opt(`resgate:${b.id}`, `Resgate: ${b.name}`)).join('')}</optgroup>` : '')
    + (debts.length ? `<optgroup label="Dívida">${debts.map((d) => opt(`divida:${d.id}`, `Pagar dívida: ${d.creditor}`)).join('')}</optgroup>` : '')
    + opt('ignorar', 'Não lançar');
}

function impItemRow(i, idx) {
  const typ = choiceType(i.choice);
  const estorno = typ === 'despesa' && i.amount < 0;
  const sign = typ === 'receita' || estorno ? '+' : typ === 'despesa' || typ === 'divida' ? '−' : '';
  const off = typ === 'ignorar' || !i.include;
  const note = typ === 'ignorar' ? IMP_NOTES[i.cls] || '' : i.motivo;
  return `<div class="impitem ${off ? 'off' : ''}">
    ${typ !== 'ignorar' ? `<input type="checkbox" class="impchk" data-imp-chk="${idx}" ${i.include ? 'checked' : ''} aria-label="Lançar este item">` : '<span class="impchk"></span>'}
    <div class="main">
      <div class="top"><span class="title">${esc(i.desc)}${i.parcela ? ` <span class="muted">(${esc(i.parcela)})</span>` : ''}</span><span class="amt num ${sign === '+' ? 'good' : ''}">${sign}${money(Math.abs(i.amount))}</span></div>
      <div class="meta">${shortDate(i.date)} · ${esc(i.bank)}${estorno ? ' · estorno' : ''}</div>
      ${i.dup ? `<div class="xs warnline">${icon('alert')}<span>Parece já lançado: ${esc(txTitle(i.dup))}, ${shortDate(i.dup.date)}</span></div>` : ''}
      ${note ? `<div class="xs muted">${esc(note)}</div>` : ''}
      <select class="input sm" data-imp-sel="${idx}" aria-label="Lançar como">${choiceOptions(i.choice)}</select>
    </div>
  </div>`;
}

function impFileStatus(f) {
  if (f.status === 'lendo') return 'Lendo…';
  if (f.status === 'erro') return esc(f.error);
  const m = f.meta;
  return `${esc(m.banco || 'Documento')} · ${DOC_TYPES[m.tipo_documento] || 'documento'}${m.periodo ? ` · ${esc(m.periodo)}` : ''} · ${f.count} lançamento${f.count === 1 ? '' : 's'}`;
}

function impContext() {
  return { members: members(), cats: store.list('cats'), debts: activeDebts() };
}

function viewImportar() {
  const I = state.imp;
  const toLaunch = I.items.map((it, idx) => [it, idx]).filter(([it]) => it.choice !== 'ignorar');
  const skipped = I.items.map((it, idx) => [it, idx]).filter(([it]) => it.choice === 'ignorar');
  const selected = toLaunch.filter(([it]) => it.include).map(([it]) => it);
  const totIn = sum(selected.filter((it) => choiceType(it.choice) === 'receita'), (it) => Math.abs(it.amount));
  const totOut = sum(selected.filter((it) => choiceType(it.choice) === 'despesa'), (it) => it.amount);
  const who = I.who || me();

  const files = I.files.map((f, i) => `<div class="impfile">
    <span class="txicon ${f.status === 'pronto' ? 'receita' : ''}">${icon(f.status === 'pronto' ? 'check' : f.status === 'erro' ? 'alert' : 'sync')}</span>
    <span class="main"><span class="title">${esc(f.name)}</span><span class="meta ${f.status === 'erro' ? 'crit' : ''}">${impFileStatus(f)}</span>
      ${f.status === 'pronto' && f.meta.observacoes ? `<span class="xs muted">${esc(f.meta.observacoes)}</span>` : ''}</span>
    ${I.running ? '' : `<button class="iconbtn" data-action="imp-remove" data-idx="${i}" aria-label="Remover">${icon('x')}</button>`}
  </div>`).join('');

  const local = `<section class="card">
    <div class="cardhead" style="margin-bottom:4px"><h2>Extrato em OFX, CSV ou planilha</h2><span class="badge good">grátis</span></div>
    <p class="small muted">O app lê na hora, aqui no aparelho. No internet banking, procure "exportar extrato" em OFX (ou CSV/Excel). Do Asaas, a planilha de extrato.</p>
    <label class="dropzone ${I.running ? 'disabled' : ''}">${icon('upload')}<span><strong>Escolher arquivos</strong><br><span class="xs muted">Sicoob, Inter, Banco do Brasil, Asaas e outros</span></span>
      <input type="file" multiple accept="${IMP_ACCEPT}" data-input="imp-files" hidden ${I.running ? 'disabled' : ''}></label>
  </section>`;

  const viaClaude = `<section class="card">
    <div class="cardhead" style="margin-bottom:4px"><h2>Fatura em PDF ou print</h2><span class="badge brand">Claude da assinatura</span></div>
    <ol class="steps">
      <li><button class="btn sm" data-action="imp-copy">${icon('list')}Copiar instruções</button></li>
      <li>No app do Claude, anexe o PDF ou o print, cole as instruções e envie. <a href="https://claude.ai/new" target="_blank" rel="noopener">Abrir o Claude</a></li>
      <li>Copie a resposta inteira do Claude e cole aqui:</li>
    </ol>
    ${I.showPrompt ? `<label class="field" style="margin-top:10px"><span>Instruções (selecione tudo e copie)</span><textarea class="input" rows="6" readonly>${esc(imp.claudePrompt(impContext()))}</textarea></label>` : ''}
    <textarea id="imp-paste" class="input" rows="4" data-input="imp-paste" placeholder="Cole aqui a resposta do Claude (o bloco com o JSON)" style="margin-top:10px">${esc(I.paste || '')}</textarea>
    <div class="actions" style="margin-top:10px"><button class="btn primary" data-action="imp-read-paste" ${I.paste && I.paste.trim() ? '' : 'disabled'}>Ler resposta</button></div>
    <p class="xs muted" style="margin-top:10px">Dica: crie um <strong>Projeto</strong> no Claude e cole as instruções nas instruções do projeto. Depois é só anexar a fatura e enviar. Se mudar categorias ou dívidas no app, copie as instruções de novo.</p>
  </section>`;

  const fileList = files ? `<section class="card tight"><div class="list">${files}</div></section>` : '';

  const review = I.items.length ? `<section class="card tight">
      <div class="cardhead" style="padding:4px 4px 0"><h2>Revise antes de lançar</h2><span class="small muted">${selected.length} de ${toLaunch.length} marcados</span></div>
      <div class="imptools">
        <label class="field"><span>Lançar em nome de</span><select class="input sm" data-imp-who>${members().map((n) => `<option ${n === who ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <div class="actions"><button class="btn sm" data-action="imp-all">Marcar todos</button><button class="btn sm" data-action="imp-none">Desmarcar todos</button></div>
      </div>
      <div class="list">${toLaunch.map(([it, idx]) => impItemRow(it, idx)).join('') || '<p class="small muted" style="padding:8px 4px">Nenhum item para lançar.</p>'}</div>
      ${skipped.length ? `<details class="impskip"><summary>Não serão lançados (${skipped.length})</summary><div class="list">${skipped.map(([it, idx]) => impItemRow(it, idx)).join('')}</div></details>` : ''}
    </section>
    <div class="impbar">
      <div class="small"><span class="good num">+${money(totIn)}</span> · <span class="num">−${money(totOut)}</span></div>
      <div class="actions"><button class="btn" data-action="imp-discard">Descartar</button><button class="btn primary" data-action="imp-commit" ${selected.length && !I.running ? '' : 'disabled'}>Lançar ${selected.length}</button></div>
    </div>` : '';

  return `${pageHead('Importar', 'Traga extratos e faturas; você revisa antes de lançar.', false)}
  <div class="stack">
    ${I.items.length ? `${fileList}${review}${local}${viaClaude}` : `${local}${viaClaude}${fileList}`}
    ${I.items.length ? '' : tipCard({ titulo: 'Extrato e fatura juntos', texto: 'Importe também a fatura do cartão. O pagamento da fatura que aparece no extrato fica de fora, para as compras não contarem duas vezes. Transferências entre contas de vocês também ficam de fora.' })}
  </div>`;
}

// Coloca na tela de revisão os lançamentos de um documento (lido no app ou vindo do Claude).
function addDoc(f, doc) {
  const I = state.imp;
  const boxId = (store.list('boxes').find((b) => b.purpose === 'reserva') || store.list('boxes')[0])?.id;
  let count = 0;
  for (const l of doc.lancamentos) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.data) || !(l.valor_centavos > 0)) continue;
    const suggested = defaultChoice(l, boxId);
    const learned = store.get('rules', imp.ruleKey(l.descricao));
    const useLearned = learned && validChoice(learned.choice);
    const item = {
      key: uid(), fileKey: f.key, hash: f.hash, bank: doc.banco || f.name,
      date: l.data, desc: l.descricao, amount: l.classe === 'estorno' ? -l.valor_centavos : l.valor_centavos,
      cls: l.classe, parcela: l.parcela,
      motivo: useLearned ? 'Classificado como você fez antes' : l.motivo,
      choice: useLearned ? learned.choice : suggested,
    };
    item.suggested = item.choice;
    item.dup = findDuplicate(item);
    item.include = item.choice !== 'ignorar' && !item.dup;
    I.items.push(item);
    count++;
  }
  f.meta = doc;
  f.count = count;
  f.status = 'pronto';
  I.items.sort((a, b) => a.date.localeCompare(b.date));
}

function alreadyImported(f) {
  const I = state.imp;
  if (I.files.some((o) => o !== f && o.hash === f.hash && o.status === 'pronto')) throw new Error('Este arquivo já está na lista.');
  if (store.list('tx').some((t) => t.importHash === f.hash) && !confirm(`"${f.name}" já foi importado antes. Ler de novo?`)) {
    throw new Error('Já importado antes.');
  }
}

async function processFiles(list) {
  const I = state.imp;
  const ctx = impContext();
  const fresh = [...list].map((file) => ({ key: uid(), file, name: file.name, status: 'lendo' }));
  I.files.push(...fresh);
  I.running = true;
  render({ force: true });
  for (const f of fresh) {
    try {
      const { hash, doc } = await imp.readLocalFile(f.file, ctx);
      f.hash = hash;
      alreadyImported(f);
      addDoc(f, doc);
    } catch (e) {
      f.status = 'erro';
      f.error = e.message || String(e);
    }
    delete f.file;
  }
  I.running = false;
  render({ force: true });
}

async function readPaste() {
  const I = state.imp;
  const f = { key: uid(), name: 'Resposta do Claude', status: 'lendo' };
  try {
    const doc = imp.parseClaudeAnswer(I.paste, impContext());
    f.hash = await imp.sha256(JSON.stringify(doc.lancamentos));
    f.name = `Resposta do Claude · ${doc.banco}`;
    alreadyImported(f);
    I.files.push(f);
    addDoc(f, doc);
    I.paste = '';
  } catch (e) {
    toast(e.message || String(e));
  }
  render({ force: true });
}

function commitImport() {
  const I = state.imp;
  const who = I.who || me();
  const recs = I.items.filter((i) => i.include && i.choice !== 'ignorar').map((i) => {
    const [type, ref] = i.choice.split(':');
    const rec = {
      id: uid(), type, amount: type === 'despesa' ? i.amount : Math.abs(i.amount), date: i.date,
      desc: i.parcela ? `${i.desc} (parcela ${i.parcela})` : i.desc, who, src: 'importacao', importHash: i.hash, bank: i.bank,
    };
    if (type === 'despesa') rec.catId = ref;
    if (type === 'guardar' || type === 'resgate') rec.boxId = ref;
    if (type === 'divida') rec.debtId = ref;
    return rec;
  });
  if (!recs.length) return toast('Nenhum lançamento marcado.');
  store.putMany('tx', recs);
  // Aprende com as correções: da próxima vez, a mesma descrição já vem classificada assim.
  const rules = new Map();
  for (const i of I.items) {
    const key = imp.ruleKey(i.desc);
    if (key && i.choice !== i.suggested) rules.set(key, { id: key, choice: i.choice });
  }
  if (rules.size) store.putMany('rules', [...rules.values()]);
  const perMonth = {};
  for (const r of recs) perMonth[monthOf(r.date)] = (perMonth[monthOf(r.date)] || 0) + 1;
  state.month = Object.entries(perMonth).sort((a, b) => b[1] - a[1])[0][0];
  state.imp = emptyImp();
  toast(`${recs.length} lançamento${recs.length === 1 ? '' : 's'} importado${recs.length === 1 ? '' : 's'}.`);
  location.hash = '#extrato';
}

// ---------- Orçamento ----------

function viewOrcamento() {
  const s = summary(state.month);
  const cats = store.list('cats').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const budgetTotal = sum(cats, (c) => c.budget || 0);
  const known = new Set(cats.map((c) => c.id));
  const orphan = sum(Object.entries(s.byCat).filter(([id]) => !known.has(id)), ([, v]) => v);

  const groups = [['necessidade', 'Necessidades'], ['desejo', 'Desejos']].map(([kind, label]) => {
    const list = cats.filter((c) => c.kind === kind);
    const spent = sum(list, (c) => s.byCat[c.id] || 0);
    const budget = sum(list, (c) => c.budget || 0);
    return { kind, label, list, spent, budget };
  });

  const alert = !budgetTotal
    ? `<div class="alert info">${icon('info')}<span>Toque numa categoria para definir o limite do mês.</span></div>`
    : s.income && budgetTotal > s.livingLimit
      ? `<div class="alert warn">${icon('alert')}<span>Os limites das categorias somam ${money(budgetTotal)}, ${money(budgetTotal - s.livingLimit)} a mais do que a renda permite para viver.</span></div>`
      : '';

  return `${pageHead('Orçamento')}
  <div class="stack">
    <section class="card">
      ${meterSpend(s)}
      <p class="small muted" style="margin-top:10px">Soma dos limites das categorias: <strong class="ink2">${money(budgetTotal)}</strong></p>
    </section>
    ${alert}
    <div class="tiles">
      ${groups.map((g) => `<div class="tile"><div class="label">${g.label}</div><div class="value num">${money(g.spent)}</div><div class="sub">${pct(g.spent, s.spent)}% do gasto do mês</div></div>`).join('')}
    </div>
    ${groups.map((g) => `<section class="card tight">
      <div class="cardhead" style="padding:0 4px"><h2>${g.label}</h2><span class="small muted num">${money(g.spent)}${g.budget ? ` de ${money(g.budget)}` : ''}</span></div>
      <div class="list">${g.list.map((c) => catRow(c, s.byCat[c.id] || 0)).join('') || '<p class="small muted" style="padding:8px 4px">Nenhuma categoria.</p>'}</div>
    </section>`).join('')}
    ${orphan ? `<p class="small muted">Gastos em categorias removidas: ${money(orphan)}</p>` : ''}
    <button class="btn" data-action="new-cat">${icon('plus')}Nova categoria</button>
    ${tipCard({ titulo: `Cura 2: ${CURAS[1].titulo}`, texto: CURAS[1].ideia })}
  </div>`;
}

function catRow(c, spent) {
  const budget = c.budget || 0;
  const w = budget ? Math.min(100, (spent / budget) * 100) : 0;
  const over = budget && spent > budget;
  const fill = over ? 'crit' : w >= 90 ? 'warn' : '';
  return `<button class="rowitem catrow" data-action="edit-cat" data-id="${c.id}">
    <span class="main">
      <span class="top" style="display:flex"><span class="title">${esc(c.name)}</span><span class="amt small">${money(spent)}${budget ? ` <span class="muted">de ${money(budget)}</span>` : ''}</span></span>
      ${budget
        ? `<span class="track thin" style="display:block"><span class="fill ${fill}" style="display:block;width:${w}%"></span></span>
           <span class="xs ${over ? 'crit' : 'muted'}" style="display:flex;align-items:center;gap:4px">${over ? `${icon('alert')}Passou ${money(spent - budget)}` : `Resta ${money(budget - spent)}`}</span>`
        : '<span class="xs muted" style="display:block">Sem limite definido</span>'}
    </span>
  </button>`;
}

// ---------- Dívidas ----------

function viewDividas() {
  const s = summary(state.month);
  const st = settings();
  const all = store.list('debts').map((d) => ({ ...d, ...debtBalance(d) }));
  const active = all.filter((d) => d.balance > 0).sort((a, b) => b.balance - a.balance);
  const done = all.filter((d) => d.balance <= 0);
  const total = sum(active, (d) => d.balance);
  const shares = new Map(splitDabasir(s.debtGoal, active).map(({ debt, share }) => [debt.id, share]));
  const monthTx = txOfMonth(state.month).filter((t) => t.type === 'divida');
  const paidMonth = (id) => sum(monthTx.filter((t) => t.debtId === id), (t) => t.amount);

  const baseIncome = s.income || avgIncomeBefore(state.month);
  const perMonth = Math.round((baseIncome * st.dabasir.debt) / 100);
  let forecast = 'Lance receitas para estimar';
  if (total && perMonth) {
    // O que ainda falta pagar da parte deste mês conta para este mês; o resto, dos próximos.
    const thisMonth = s.dabasir ? Math.max(0, s.debtGoal - s.debtPaid) : 0;
    const n = total <= thisMonth ? 0 : Math.ceil((total - thisMonth) / perMonth);
    forecast = n === 0 ? `Este mês (${monthLabel(state.month).toLowerCase()})` : `${n} ${n === 1 ? 'mês' : 'meses'} (${monthLabel(addMonths(state.month, n)).toLowerCase()})`;
  }

  const plan = `<section class="card">
    <h2>${DABASIR.titulo}</h2>
    <p class="ink2">${esc(DABASIR.ideia)}</p>
    <details style="margin-top:10px"><summary>Como seguir o plano</summary><ol class="steps">${DABASIR.passos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol></details>
  </section>`;

  if (!all.length) {
    return `${pageHead('Dívidas')}
    <div class="stack">
      <section class="card">${empty('link', 'Nenhuma dívida cadastrada. Sem dívidas, a família segue a regra de guardar a sua parte e viver com o resto.')}
        <div class="actions" style="justify-content:center"><button class="btn primary" data-action="new-debt">${icon('plus')}Cadastrar dívida</button></div>
      </section>
      ${plan}
    </div>`;
  }

  return `${pageHead('Dívidas')}
  <div class="stack">
    ${!st.dabasirAuto && active.length ? `<div class="alert info">${icon('info')}<span>O plano de Dabasir está desligado em Ajustes. A parte dos credores não entra no orçamento.</span></div>` : ''}
    <div class="tiles">
      <div class="tile"><div class="label">Falta pagar</div><div class="value num">${money(total)}</div><div class="sub">${active.length} dívida${active.length === 1 ? '' : 's'} em aberto</div></div>
      <div class="tile"><div class="label">Previsão de quitação</div><div class="value" style="font-size:1.05rem">${total ? forecast : 'Tudo quitado'}</div><div class="sub">com ${st.dabasir.debt}% da renda por mês</div></div>
    </div>
    ${active.length && s.dabasir ? `<section class="card">${meterDebt(s)}</section>` : ''}
    ${active.map((d) => {
      const share = shares.get(d.id) || 0;
      const pm = paidMonth(d.id);
      const w = pct(d.paid, d.original);
      return `<article class="card debtcard">
        <div class="top">
          <div><h3>${esc(d.creditor)}</h3>${d.note ? `<div class="small muted">${esc(d.note)}</div>` : ''}</div>
          <div><div class="bal num">${money(d.balance)}</div><div class="xs muted" style="text-align:right">falta de ${money(d.original)}</div></div>
        </div>
        <div class="track thin" style="margin-top:12px"><div class="fill good" style="width:${w}%"></div></div>
        <div class="small ink2">${w}% pago${s.dabasir ? ` · Parte deste mês: <strong>${money(share)}</strong>` : ''}${pm ? ` · Pago no mês: ${money(pm)}` : ''}</div>
        <div class="actions" style="margin-top:12px">
          <button class="btn sm primary" data-action="pay-debt" data-id="${d.id}" data-amount="${Math.max(0, share - pm)}">Pagar</button>
          <button class="btn sm" data-action="edit-debt" data-id="${d.id}">Editar</button>
        </div>
      </article>`;
    }).join('')}
    <button class="btn" data-action="new-debt">${icon('plus')}Cadastrar dívida</button>
    ${done.length ? `<p class="section-title">Quitadas</p>
      <section class="card tight"><div class="list">${done.map((d) => `<button class="rowitem" data-action="edit-debt" data-id="${d.id}">
        <span class="txicon receita">${icon('check')}</span>
        <span class="main"><span class="title" style="display:block">${esc(d.creditor)}</span><span class="meta" style="display:block">${money(d.original)} pagos</span></span>
        <span class="badge good">${icon('check')}Quitada</span></button>`).join('')}</div></section>` : ''}
    ${plan}
  </div>`;
}

// ---------- Patrimônio ----------

function viewPatrimonio() {
  const boxes = boxesWithBalance().sort((a, b) => b.balance - a.balance);
  const total = sum(boxes, (b) => Math.max(0, b.balance));
  const net = sum(boxes, (b) => b.net);
  const yields = sum(boxes, (b) => b.yield || 0);
  const risk = { baixo: 0, medio: 0, alto: 0 };
  for (const b of boxes) risk[b.risk || 'baixo'] += Math.max(0, b.balance);
  const riskColors = { baixo: 'var(--r1)', medio: 'var(--r2)', alto: 'var(--r3)' };

  if (!state.sim) {
    const s = summary(state.month);
    state.sim = { initial: total, monthly: s.saveGoal || 50000, rate: 10, years: 10 };
  }

  const riskCard = total
    ? `<section class="card">
      <h2>Onde está o risco</h2>
      <div class="stackbar" role="img" aria-label="Distribuição por risco">${Object.entries(risk).filter(([, v]) => v > 0).map(([k, v]) => `<span style="width:${(v / total) * 100}%;background:${riskColors[k]}" title="${RISKS[k]}: ${money(v)} (${pct(v, total)}%)"></span>`).join('')}</div>
      <div class="legend">${Object.entries(risk).map(([k, v]) => `<div class="row"><span class="dot" style="background:${riskColors[k]}"></span>${RISKS[k]}<span class="v num">${money(v)} · ${pct(v, total)}%</span></div>`).join('')}</div>
      ${risk.alto / total > 0.3 ? `<div class="alert crit" style="margin-top:12px">${icon('alert')}<span>Mais de 30% do patrimônio está em risco alto. Cura 4: antes de lucro, segurança.</span></div>` : ''}
    </section>`
    : '';

  return `${pageHead('Patrimônio', 'As caixinhas da família e onde o ouro está trabalhando.', false)}
  <div class="stack">
    <div class="tiles">
      <div class="tile"><div class="label">Total</div><div class="value num">${money(total)}</div></div>
      <div class="tile"><div class="label">Aportado</div><div class="value num">${money(net)}</div></div>
      <div class="tile"><div class="label">Rendimentos</div><div class="value num ${yields >= 0 ? 'good' : 'crit'}">${money(yields)}</div></div>
    </div>
    ${riskCard}
    ${boxes.map(boxCard).join('')}
    <button class="btn" data-action="new-box">${icon('plus')}Nova caixinha</button>
    <section class="card" id="sim">
      <h2>Simulador de juros compostos</h2>
      <p class="small muted">Cura 3: cada moeda aplicada gera outras, e essas também trabalham.</p>
      <div class="grid2" style="margin-top:12px">
        <label class="field"><span>Valor inicial</span><input id="sim-initial" class="input" inputmode="decimal" data-sim="initial" value="${moneyInput(state.sim.initial)}" placeholder="0,00"></label>
        <label class="field"><span>Aporte por mês</span><input id="sim-monthly" class="input" inputmode="decimal" data-sim="monthly" value="${moneyInput(state.sim.monthly)}" placeholder="0,00"></label>
        <label class="field"><span>Rendimento ao ano (%)</span><input id="sim-rate" class="input" inputmode="decimal" data-sim="rate" value="${String(state.sim.rate).replace('.', ',')}"></label>
        <label class="field"><span>Prazo (anos)</span><input id="sim-years" class="input" inputmode="numeric" data-sim="years" value="${state.sim.years}"></label>
      </div>
      <div id="sim-result" style="margin-top:16px">${simResult()}</div>
    </section>
  </div>`;
}

function boxCard(b) {
  const riskCls = { baixo: 'good', medio: 'warn', alto: 'crit' }[b.risk || 'baixo'];
  return `<article class="card boxcard">
    <div class="top">
      <div><h3>${esc(b.name)}</h3>${PURPOSES[b.purpose] && PURPOSES[b.purpose] !== b.name ? `<div class="small muted">${PURPOSES[b.purpose]}</div>` : ''}</div>
      <div class="bal num">${money(b.balance)}</div>
    </div>
    <div class="tags">
      ${b.where ? `<span class="badge">${esc(b.where)}</span>` : `<span class="badge warn">${icon('alert')}Onde está aplicado?</span>`}
      <span class="badge ${riskCls}">${RISKS[b.risk || 'baixo']}</span>
      ${b.rate ? `<span class="badge brand">~${String(b.rate).replace('.', ',')}% ao ano</span>` : ''}
    </div>
    ${b.target ? `<div class="track thin" style="margin-top:12px"><div class="fill gold" style="width:${Math.min(100, pct(b.balance, b.target))}%"></div></div><div class="xs muted">${pct(b.balance, b.target)}% da meta de ${money(b.target)}</div>` : ''}
    <div class="actions">
      <button class="btn sm gold" data-action="box-tx" data-type="guardar" data-id="${b.id}">Guardar</button>
      <button class="btn sm" data-action="box-tx" data-type="resgate" data-id="${b.id}">Resgatar</button>
      <button class="btn sm" data-action="edit-box" data-id="${b.id}">Editar</button>
    </div>
  </article>`;
}

function simResult() {
  const { initial, monthly, rate, years } = state.sim;
  if (!(years > 0) || years > 60 || !(rate >= 0) || rate > 100) return '<p class="small muted">Informe um prazo de 1 a 60 anos e uma taxa de 0 a 100%.</p>';
  const r = compound({ initial: initial || 0, monthly: monthly || 0, ratePct: rate, years });
  const marks = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 60].filter((y) => y < years).concat(years);
  const rows = r.rows.filter((row) => marks.includes(row.month / 12) || row.month === Math.round(years * 12));
  const inv = Math.max(0, r.invested);
  const int = Math.max(0, r.interest);
  const tot = inv + int || 1;
  return `<div class="label small muted">Em ${years} ano${years === 1 ? '' : 's'} a família teria</div>
    <div style="font-size:1.8rem;font-weight:750" class="num">${money(r.final)}</div>
    <div class="stackbar" role="img" aria-label="Aportado e juros">
      <span style="width:${(inv / tot) * 100}%;background:var(--s1)" title="Aportado: ${money(inv)}"></span>
      <span style="width:${(int / tot) * 100}%;background:var(--s2)" title="Juros: ${money(int)}"></span>
    </div>
    <div class="legend">
      <div class="row"><span class="dot" style="background:var(--s1)"></span>Dinheiro aportado<span class="v num">${money(r.invested)}</span></div>
      <div class="row"><span class="dot" style="background:var(--s2)"></span>Juros ganhos<span class="v num">${money(r.interest)} · ${pct(int, tot)}%</span></div>
    </div>
    <table class="simple" style="margin-top:14px">
      <thead><tr><th>Ano</th><th>Aportado</th><th>Total</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${row.month / 12}</td><td>${money(row.invested)}</td><td>${money(row.value)}</td></tr>`).join('')}</tbody>
    </table>`;
}

// ---------- Lições ----------

function avgSpent(month) {
  const vals = [0, 1, 2].map((i) => summary(addMonths(month, -i)).spent).filter((v) => v > 0);
  return vals.length ? sum(vals, (v) => v) / vals.length : 0;
}

function curaStatus(n, m) {
  const s = summary(m);
  const boxes = boxesWithBalance();
  const total = sum(boxes, (b) => Math.max(0, b.balance));
  const noIncome = { st: 'na', text: 'Sem renda lançada neste mês.' };
  switch (n) {
    case 1:
      if (!s.income) return noIncome;
      if (s.saved >= s.saveGoal) return { st: 'ok', text: `Guardou ${money(s.saved)}, meta de ${money(s.saveGoal)}.` };
      return { st: s.saved > 0 ? 'parcial' : 'nao', text: `Guardou ${money(Math.max(0, s.saved))} de ${money(s.saveGoal)}.` };
    case 2:
      if (!s.income) return noIncome;
      if (s.spent <= s.livingLimit) return { st: 'ok', text: `Gastou ${money(s.spent)} de ${money(s.livingLimit)} para viver.` };
      return { st: 'nao', text: `Passou ${money(s.spent - s.livingLimit)} do limite para viver.` };
    case 3: {
      if (!total) return { st: 'na', text: 'Ainda não há nada guardado nas caixinhas.' };
      const working = sum(boxes.filter((b) => b.balance > 0 && b.where && b.rate > 0), (b) => b.balance);
      const p = pct(working, total);
      if (p >= 80) return { st: 'ok', text: `${p}% do patrimônio está aplicado e rendendo.` };
      return { st: p > 0 ? 'parcial' : 'nao', text: `${p}% do patrimônio tem aplicação e rendimento informados. Complete as caixinhas.` };
    }
    case 4: {
      if (!total) return { st: 'na', text: 'Ainda não há nada guardado nas caixinhas.' };
      const alto = sum(boxes.filter((b) => b.risk === 'alto'), (b) => Math.max(0, b.balance));
      const p = pct(alto, total);
      if (!alto) return { st: 'ok', text: 'Nada está em risco alto.' };
      return p <= 30 ? { st: 'ok', text: `Só ${p}% está em risco alto.` } : { st: 'nao', text: `${p}% está em risco alto (o ideal é até 30%).` };
    }
    case 5: {
      if (settings().ownHome) return { st: 'ok', text: 'A família já tem casa própria.' };
      const casa = boxes.filter((b) => b.purpose === 'casa');
      const bal = sum(casa, (b) => b.balance);
      if (bal > 0) return { st: 'parcial', text: `${money(bal)} guardados para a casa própria.` };
      return { st: casa.length ? 'parcial' : 'nao', text: casa.length ? 'Caixinha da casa criada, ainda sem valor.' : 'Crie uma caixinha "Casa própria" ou marque em Ajustes que a casa já é de vocês.' };
    }
    case 6: {
      const reserva = sum(boxes.filter((b) => b.purpose === 'reserva'), (b) => b.balance);
      const futuro = sum(boxes.filter((b) => b.purpose === 'futuro'), (b) => b.balance);
      const gasto = avgSpent(m);
      const meses = gasto ? reserva / gasto : 0;
      const txt = `Reserva: ${money(reserva)}${gasto ? ` (${meses.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses de gastos)` : ''}. Renda futura: ${money(futuro)}.`;
      if (meses >= 6 && futuro > 0) return { st: 'ok', text: txt };
      return { st: reserva > 0 || futuro > 0 ? 'parcial' : 'nao', text: txt };
    }
    case 7: {
      const avg = avgIncomeBefore(m);
      if (!s.income || !avg) return { st: 'na', text: 'Precisa de renda neste mês e nos anteriores para comparar.' };
      const d = pct(s.income - avg, avg);
      return d >= 0 ? { st: 'ok', text: `Renda ${d}% acima da média dos meses anteriores.` } : { st: 'parcial', text: `Renda ${-d}% abaixo da média dos meses anteriores.` };
    }
  }
  return { st: 'na', text: '' };
}

const STATUS = {
  ok: ['good', 'check', 'Cumprida'],
  parcial: ['warn', 'clock', 'Em andamento'],
  nao: ['crit', 'alert', 'Ainda não'],
  na: ['', 'circle', 'Sem dados'],
};

function viewLicoes() {
  const res = CURAS.map((c) => ({ c, r: curaStatus(c.n, state.month) }));
  const okCount = res.filter((x) => x.r.st === 'ok').length;
  return `${pageHead('Lições', `${okCount} de 7 curas cumpridas neste mês.`)}
  <div class="stack">
    <p class="section-title">As sete curas para a bolsa vazia</p>
    ${res.map(({ c, r }) => {
      const [cls, ic, label] = STATUS[r.st];
      return `<article class="card cura">
        <span class="n">${c.n}</span>
        <div>
          <div class="head"><h3>${esc(c.titulo)}</h3><span class="badge ${cls}">${icon(ic)}${label}</span></div>
          <p class="ideia">${esc(c.ideia)}</p>
          <p class="why ${cls === 'crit' ? 'crit' : cls === 'good' ? 'good' : 'ink2'}">${esc(r.text)}</p>
          <p class="noapp"><strong>No app:</strong> ${esc(c.app)}</p>
          <div class="actions"><a class="btn sm ghost" href="#${c.view}">Abrir ${esc([...NAV, ...NAV2].find(([k]) => k === c.view)[1])}</a></div>
        </div>
      </article>`;
    }).join('')}
    <p class="section-title">As cinco leis do ouro</p>
    <section class="card stack">
      ${LEIS.map((l, i) => `<div class="lei"><span class="n">${i + 1}</span><p class="quote">${esc(l)}</p></div>`).join('')}
    </section>
    <section class="card">
      <h2>${DABASIR.titulo}</h2>
      <p class="ink2">${esc(DABASIR.ideia)}</p>
      <ol class="steps">${DABASIR.passos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
    </section>
    <p class="xs muted">Resumo com nossas palavras de <em>O Homem Mais Rico da Babilônia</em>, de George S. Clason.</p>
  </div>`;
}

// ---------- Ajustes ----------

function driveCfgForm() {
  const c = drive.config();
  return `<form class="form" data-form="drivecfg">
    <label class="field"><span>ID do cliente OAuth</span><input class="input" name="clientId" value="${esc(c.clientId)}" placeholder="…apps.googleusercontent.com" autocomplete="off"></label>
    <label class="field"><span>Chave de API</span><input class="input" name="apiKey" value="${esc(c.apiKey)}" autocomplete="off"></label>
    <label class="field"><span>Número do projeto</span><input class="input" name="appId" value="${esc(c.appId)}" inputmode="numeric" autocomplete="off"></label>
    <div class="actions"><button class="btn primary" type="submit">Salvar chaves</button></div>
  </form>`;
}

function driveSection() {
  const meta = store.meta;
  if (!drive.isConfigured()) {
    return `<p class="ink2">Para os dois celulares verem os mesmos dados, o app guarda um arquivo no Google Drive. Primeiro é preciso informar as chaves do projeto no Google Cloud (o passo a passo está no LEIAME).</p>
      <div style="margin-top:14px">${driveCfgForm()}</div>`;
  }
  if (!meta.fileId) {
    return `<p class="ink2">Um de vocês cria o arquivo da família e compartilha. O outro escolhe "Abrir arquivo compartilhado".</p>
      <div class="actions" style="margin-top:14px">
        <button class="btn primary" data-action="create-file">${icon('cloud')}Criar arquivo da família</button>
        <button class="btn" data-action="open-file">Abrir arquivo compartilhado</button>
      </div>
      <details style="margin-top:14px"><summary>Chaves do Google Cloud</summary>${driveCfgForm()}</details>`;
  }
  const st = sync.status;
  return `<div class="stack">
    <div class="alert ${st === 'error' ? 'crit' : st === 'login' ? 'warn' : 'good'}">${icon(st === 'error' ? 'alert' : st === 'login' ? 'cloud' : 'check')}
      <span>${st === 'error' ? esc(sync.error) : st === 'login' ? 'Entre com o Google para sincronizar (o acesso dura cerca de 1 hora).' : `Conectado a <strong>${esc(meta.fileName || 'bolsa-cheia-familia.json')}</strong>. Última sincronia ${timeAgo(meta.lastSync)}.`}</span></div>
    <div class="actions">
      <button class="btn primary" data-action="sync">${icon('sync')}Sincronizar agora</button>
      <button class="btn danger" data-action="disconnect">Desconectar deste aparelho</button>
    </div>
    <form class="form" data-form="share">
      <label class="field"><span>Compartilhar com o cônjuge</span><input class="input" type="email" name="email" placeholder="e-mail da conta Google" required autocomplete="off"></label>
      <span class="hint small muted">A pessoa recebe um e-mail do Google. Depois, no app dela, escolhe "Entrar na conta da família".</span>
      <div class="actions"><button class="btn" type="submit">${icon('share')}Compartilhar</button></div>
    </form>
    <details><summary>Chaves do Google Cloud</summary>${driveCfgForm()}</details>
  </div>`;
}

let installPrompt = null;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function installSection() {
  if (isInstalled()) return `<div class="alert good" style="margin-top:10px">${icon('check')}<span>O app já está instalado neste aparelho.</span></div>`;
  if (installPrompt) {
    return `<p class="small muted" style="margin-top:6px">Coloca o Bolsa Cheia na tela inicial, como um aplicativo, e funciona mesmo sem internet.</p>
      <div class="actions" style="margin-top:12px"><button class="btn primary" data-action="install">${icon('download')}Instalar app</button></div>`;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `<p class="small ink2" style="margin-top:6px">${ios
    ? 'No iPhone, abra o app no Safari, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.'
    : 'No Android, abra o app no Chrome, toque no menu <strong>⋮</strong> e depois em <strong>Instalar app</strong> (ou "Adicionar à tela inicial").'}</p>`;
}

function viewAjustes() {
  const st = settings();
  const names = [...members()];
  while (names.length < 2) names.push('');
  if (names.length < 4 && names[names.length - 1]) names.push('');
  const theme = store.meta.theme || 'auto';
  return `${pageHead('Ajustes', '', false)}
  <div class="stack">
    <section class="card">
      <h2>Família</h2>
      <form class="form" data-form="family" style="margin-top:12px">
        ${names.map((n, i) => `<label class="field"><span>Pessoa ${i + 1}</span><input id="member-${i}" class="input" name="member" value="${esc(n)}" maxlength="30" autocomplete="off" ${i === 0 ? 'required' : ''}></label>`).join('')}
        <label class="field"><span>Quem usa este aparelho</span><select class="input" name="me">${members().map((n) => `<option ${n === me() ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <span class="hint small muted">Mudar um nome não altera os lançamentos antigos.</span>
        <div class="actions"><button class="btn primary" type="submit">Salvar</button></div>
      </form>
    </section>

    <section class="card">
      <h2>Regras do livro</h2>
      <form class="form" data-form="rules" style="margin-top:12px">
        <label class="field"><span>Guardar de cada receita (%)</span><input id="savePct" class="input" name="savePct" inputmode="numeric" value="${st.savePct}"><span class="hint">O livro ensina a guardar pelo menos 1 de cada 10 moedas.</span></label>
        <label class="check"><input type="checkbox" name="dabasirAuto" ${st.dabasirAuto ? 'checked' : ''}><span>Usar o plano de Dabasir quando houver dívidas</span></label>
        <div class="grid3">
          <label class="field"><span>Viver (%)</span><input id="dab-living" class="input" name="living" inputmode="numeric" value="${st.dabasir.living}"></label>
          <label class="field"><span>Credores (%)</span><input id="dab-debt" class="input" name="debt" inputmode="numeric" value="${st.dabasir.debt}"></label>
          <label class="field"><span>Guardar (%)</span><input id="dab-save" class="input" name="save" inputmode="numeric" value="${st.dabasir.save}"></label>
        </div>
        <label class="check"><input type="checkbox" name="ownHome" ${st.ownHome ? 'checked' : ''}><span>A família já tem casa própria (cura 5)</span></label>
        <div class="actions"><button class="btn primary" type="submit">Salvar</button></div>
      </form>
    </section>

    <section class="card">
      <h2>Google Drive</h2>
      <div style="margin-top:10px">${driveSection()}</div>
    </section>

    <section class="card">
      <h2>Instalar no celular</h2>
      ${installSection()}
    </section>

    <section class="card">
      <h2>Aparência</h2>
      <div class="seg" role="group" aria-label="Tema" style="margin-top:12px">
        ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, l]) => `<button type="button" data-action="theme" data-theme="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}
      </div>
    </section>

    <section class="card">
      <h2>Cópia de segurança</h2>
      <p class="small muted">Um arquivo com todos os dados, para guardar ou levar para outro aparelho. Importar junta os dados, não apaga nada.</p>
      <div class="actions" style="margin-top:12px">
        <button class="btn" data-action="export">${icon('download')}Exportar</button>
        <label class="btn">${icon('upload')}Importar<input type="file" accept="application/json,.json" data-input="import" hidden></label>
      </div>
    </section>

    <section class="card">
      <h2>Apagar dados deste aparelho</h2>
      <p class="small muted">Remove os dados só deste aparelho. O arquivo no Google Drive continua lá.</p>
      <div class="actions" style="margin-top:12px"><button class="btn danger" data-action="reset">${icon('trash')}Apagar dados deste aparelho</button></div>
    </section>
  </div>`;
}

// ---------- Primeiro acesso ----------

function viewOnboarding() {
  if (members().length && !store.meta.me) {
    return `<div class="onboard stack">
      ${LOGO}
      <h1>Quem está usando este aparelho?</h1>
      <p class="lead">Cada lançamento registra quem fez.</p>
      ${members().map((n) => `<button class="choice" data-action="set-me" data-name="${esc(n)}"><span class="ico">${icon('user')}</span><div><h3>${esc(n)}</h3></div></button>`).join('')}
    </div>`;
  }
  if (state.onboard === 'new') {
    return `<div class="onboard stack">
      ${LOGO}
      <h1>Vamos começar</h1>
      <p class="lead">O dinheiro da família fica todo junto, e cada lançamento mostra quem fez.</p>
      <form class="form card" data-form="onb-new">
        <label class="field"><span>Seu nome</span><input id="onb-name" class="input" name="name" required maxlength="30" autocomplete="given-name"></label>
        <label class="field"><span>Nome do cônjuge <span class="muted">(opcional)</span></span><input id="onb-spouse" class="input" name="spouse" maxlength="30" autocomplete="off"></label>
        <label class="field"><span>Quanto guardar de cada receita (%)</span><input id="onb-pct" class="input" name="savePct" inputmode="numeric" value="10"><span class="hint">O livro ensina: de cada dez moedas, gaste no máximo nove.</span></label>
        <div class="sheetfoot"><button type="button" class="btn" data-action="onb" data-step="choose">Voltar</button><button class="btn primary" type="submit">Começar</button></div>
      </form>
    </div>`;
  }
  if (state.onboard === 'join') {
    return `<div class="onboard stack">
      ${LOGO}
      <h1>Entrar na conta da família</h1>
      <p class="lead">Seu cônjuge compartilhou o arquivo <strong>bolsa-cheia-familia.json</strong> com o seu e-mail. Entre com o Google e escolha esse arquivo.</p>
      ${drive.isConfigured()
        ? `<button class="btn primary block" data-action="open-file">${icon('cloud')}Entrar com o Google e escolher o arquivo</button>`
        : `<div class="card"><p class="small ink2" style="margin-bottom:12px">Antes, informe as chaves do Google Cloud (as mesmas do outro aparelho).</p>${driveCfgForm()}</div>`}
      <button class="btn" data-action="onb" data-step="choose">Voltar</button>
    </div>`;
  }
  return `<div class="onboard stack">
    ${LOGO}
    <h1>Bem-vindo ao Bolsa Cheia</h1>
    <p class="lead">As finanças da família com as lições de <em>O Homem Mais Rico da Babilônia</em>: pague-se primeiro, controle os gastos, saia das dívidas e ponha o ouro para trabalhar.</p>
    <button class="choice" data-action="onb" data-step="new"><span class="ico">${icon('user')}</span><div><h3>Começar agora</h3><p>Sou a primeira pessoa da família a usar o app.</p></div></button>
    <button class="choice" data-action="onb" data-step="join"><span class="ico">${icon('users')}</span><div><h3>Entrar na conta da família</h3><p>Meu cônjuge já usa e compartilhou o arquivo pelo Google Drive.</p></div></button>
    <p class="quote small" style="margin-top:8px">"${esc(LEIS[0])}"</p>
  </div>`;
}

// ---------- Janelas ----------

function openSheet(title, body) {
  $sheet.innerHTML = `<div class="sheethead"><h2 id="sheet-title">${esc(title)}</h2><button class="iconbtn" data-action="close-sheet" aria-label="Fechar">${icon('x')}</button></div><div class="sheetbody">${body}</div>`;
  if (!$sheet.open) $sheet.showModal();
  $sheet.querySelector('[autofocus]')?.focus();
}
function closeSheet() {
  if ($sheet.open) $sheet.close();
}

function sheetFoot(deleteAction, id) {
  return `<div class="sheetfoot">
    ${deleteAction ? `<button type="button" class="btn danger" data-action="${deleteAction}" data-id="${id}">${icon('trash')}Excluir</button>` : ''}
    <div class="right"><button type="button" class="btn" data-action="close-sheet">Cancelar</button><button class="btn primary" type="submit">Salvar</button></div>
  </div>`;
}

function catOptions(selected) {
  const cats = store.list('cats').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const cur = selected && !cats.find((c) => c.id === selected) && store.data.cats[selected] ? `<option value="${selected}" selected>${esc(catName(selected))}</option>` : '';
  return cur + [['necessidade', 'Necessidades'], ['desejo', 'Desejos']].map(([k, l]) => `<optgroup label="${l}">${cats.filter((c) => c.kind === k).map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
}

function openTxForm(tx, preset = {}) {
  const t = tx || { type: 'despesa', amount: 0, date: defaultDate(), desc: '', who: me(), ...preset };
  const boxes = store.list('boxes');
  const debts = store.list('debts').map((d) => ({ ...d, ...debtBalance(d) })).filter((d) => d.balance > 0 || d.id === t.debtId);
  const who = members().includes(t.who) || !t.who ? members() : [...members(), t.who];
  const show = (types) => (types.split(' ').includes(t.type) ? '' : 'hidden');
  openSheet(tx ? 'Editar lançamento' : 'Novo lançamento', `
  <form class="form" data-form="tx" data-id="${tx ? tx.id : ''}">
    <div class="seg" role="group" aria-label="Tipo">
      ${Object.entries(TYPES).map(([k, v]) => `<button type="button" data-action="tx-type" data-type="${k}" aria-pressed="${k === t.type}">${v.label}</button>`).join('')}
    </div>
    <input type="hidden" name="type" value="${t.type}">
    <label class="field"><span>Valor (R$)</span><input class="input money" name="amount" inputmode="decimal" placeholder="0,00" value="${moneyInput(t.amount)}" autocomplete="off" autofocus></label>
    <label class="field" data-show="despesa" ${show('despesa')}><span>Categoria</span><select class="input" name="catId">${catOptions(t.catId || 'cat-mercado')}</select></label>
    <label class="field" data-show="guardar resgate" ${show('guardar resgate')}><span>Caixinha</span>
      ${boxes.length ? `<select class="input" name="boxId">${boxes.map((b) => `<option value="${b.id}" ${b.id === t.boxId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : '<span class="hint">Crie uma caixinha em Patrimônio primeiro.</span>'}
    </label>
    <label class="field" data-show="divida" ${show('divida')}><span>Dívida</span>
      ${debts.length ? `<select class="input" name="debtId">${debts.map((d) => `<option value="${d.id}" ${d.id === t.debtId ? 'selected' : ''}>${esc(d.creditor)} (falta ${money(d.balance)})</option>`).join('')}</select>` : '<span class="hint">Cadastre a dívida na aba Dívidas primeiro.</span>'}
    </label>
    <div class="grid2">
      <label class="field"><span>Data</span><input class="input" type="date" name="date" value="${t.date}" required></label>
      <label class="field"><span>Quem</span><select class="input" name="who">${who.map((n) => `<option ${n === t.who ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Descrição <span class="muted">(opcional)</span></span><input class="input" name="desc" value="${esc(t.desc)}" maxlength="80" autocomplete="off"></label>
    ${sheetFoot(tx ? 'delete-tx' : '', tx?.id)}
  </form>`);
}

function openPayYourself(income) {
  const st = settings();
  const dab = dabasirActive();
  const savePct = dab ? st.dabasir.save : st.savePct;
  const saveAmt = Math.round((income.amount * savePct) / 100);
  const boxes = store.list('boxes');
  const debts = dab ? activeDebts() : [];
  const debtAmt = dab ? Math.round((income.amount * st.dabasir.debt) / 100) : 0;
  const split = splitDabasir(debtAmt, debts).filter((x) => x.share > 0);
  if (!saveAmt && !split.length) return;
  const preferred = boxes.find((b) => b.purpose === 'reserva') || boxes[0];
  openSheet('Pague-se primeiro', `
  <form class="form" data-form="payself" data-date="${income.date}" data-who="${esc(income.who)}">
    <p class="ink2">Receita de ${money(income.amount)} lançada. Antes de qualquer gasto, separe a parte da família.</p>
    ${saveAmt ? `<div class="card tight">
      ${boxes.length
        ? `<label class="check"><input type="checkbox" name="save" data-amount="${saveAmt}" checked><span>Guardar <strong>${money(saveAmt)}</strong> (${savePct}% da receita)</span></label>
           <select class="input" name="boxId" style="margin-top:10px" aria-label="Caixinha">${boxes.map((b) => `<option value="${b.id}" ${b.id === preferred.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>`
        : `<p class="small">Guarde ${money(saveAmt)}: crie uma caixinha em Patrimônio.</p>`}
    </div>` : ''}
    ${split.length ? `<div class="card tight">
      <h3>Plano de Dabasir: ${money(debtAmt)} para os credores</h3>
      <p class="small muted" style="margin:4px 0 10px">Dividido na proporção do que falta pagar a cada um.</p>
      <div class="stack" style="gap:10px">${split.map(({ debt, share }) => `<label class="check"><input type="checkbox" name="debt" value="${debt.id}" data-amount="${share}" checked><span>${esc(debt.creditor)}: <strong>${money(share)}</strong></span></label>`).join('')}</div>
    </div>` : ''}
    <div class="sheetfoot"><button type="button" class="btn" data-action="close-sheet">Agora não</button><button class="btn gold" type="submit">Registrar marcados</button></div>
  </form>`);
}

function openCatForm(cat) {
  const c = cat || { name: '', kind: 'desejo', budget: 0 };
  openSheet(cat ? 'Editar categoria' : 'Nova categoria', `
  <form class="form" data-form="cat" data-id="${cat ? cat.id : ''}">
    <label class="field"><span>Nome</span><input class="input" name="name" value="${esc(c.name)}" required maxlength="40" autocomplete="off" ${cat ? '' : 'autofocus'}></label>
    <label class="field"><span>Tipo</span><select class="input" name="kind">
      <option value="necessidade" ${c.kind === 'necessidade' ? 'selected' : ''}>Necessidade (não dá para cortar)</option>
      <option value="desejo" ${c.kind === 'desejo' ? 'selected' : ''}>Desejo (pode esperar)</option>
    </select></label>
    <label class="field"><span>Limite por mês (R$)</span><input class="input" name="budget" inputmode="decimal" value="${moneyInput(c.budget)}" placeholder="0,00" ${cat ? 'autofocus' : ''}><span class="hint">Deixe em branco para não ter limite.</span></label>
    ${sheetFoot(cat ? 'delete-cat' : '', cat?.id)}
  </form>`);
}

function openDebtForm(debt) {
  const d = debt || { creditor: '', original: 0, note: '' };
  openSheet(debt ? 'Editar dívida' : 'Nova dívida', `
  <form class="form" data-form="debt" data-id="${debt ? debt.id : ''}">
    <label class="field"><span>Credor</span><input class="input" name="creditor" value="${esc(d.creditor)}" required maxlength="50" placeholder="Ex.: Cartão do banco X" autocomplete="off" autofocus></label>
    <label class="field"><span>Valor da dívida (R$)</span><input class="input" name="original" inputmode="decimal" value="${moneyInput(d.original)}" placeholder="0,00" required><span class="hint">Se já pagou parte antes de usar o app, informe só o que falta hoje.</span></label>
    <label class="field"><span>Observação <span class="muted">(opcional)</span></span><input class="input" name="note" value="${esc(d.note)}" maxlength="80" placeholder="Juros, vencimento, contato" autocomplete="off"></label>
    ${sheetFoot(debt ? 'delete-debt' : '', debt?.id)}
  </form>`);
}

function openBoxForm(box) {
  const b = box ? { ...box, ...boxesWithBalance().find((x) => x.id === box.id) } : { name: '', purpose: 'outro', where: '', risk: 'baixo', target: 0, rate: 0 };
  openSheet(box ? 'Editar caixinha' : 'Nova caixinha', `
  <form class="form" data-form="box" data-id="${box ? box.id : ''}">
    <label class="field"><span>Nome</span><input class="input" name="name" value="${esc(b.name)}" required maxlength="40" autocomplete="off" ${box ? '' : 'autofocus'}></label>
    <label class="field"><span>Objetivo</span><select class="input" name="purpose">${Object.entries(PURPOSES).map(([k, l]) => `<option value="${k}" ${k === b.purpose ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field"><span>Onde está aplicado</span><input class="input" name="where" value="${esc(b.where)}" maxlength="60" placeholder="Ex.: Tesouro Selic, CDB do banco X" autocomplete="off"></label>
    <div class="grid2">
      <label class="field"><span>Risco</span><select class="input" name="risk">${Object.entries(RISKS).map(([k, l]) => `<option value="${k}" ${k === b.risk ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Rende ao ano (%)</span><input class="input" name="rate" inputmode="decimal" value="${b.rate ? String(b.rate).replace('.', ',') : ''}" placeholder="0"></label>
    </div>
    <label class="field"><span>Meta (R$) <span class="muted">(opcional)</span></span><input class="input" name="target" inputmode="decimal" value="${moneyInput(b.target)}" placeholder="0,00"></label>
    ${box ? `<label class="field"><span>Saldo atual (R$)</span><input class="input" name="balance" inputmode="decimal" value="${moneyInput(b.balance) || '0,00'}"><span class="hint">Atualize com o valor que o banco mostra. A diferença para o que foi guardado vira rendimento.</span></label>` : ''}
    ${sheetFoot(box ? 'delete-box' : '', box?.id)}
  </form>`);
}

// ---------- Formulários ----------

const intPct = (v) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

const FORMS = {
  tx(form) {
    const f = new FormData(form);
    const type = f.get('type');
    const amount = parseMoney(f.get('amount'));
    // Despesa aceita valor negativo: é um estorno, que abate do gasto.
    const valid = type === 'despesa' ? Number.isFinite(amount) && amount !== 0 : amount > 0;
    if (!valid) return toast(type === 'despesa' ? 'Informe o valor (negativo se for estorno).' : 'Informe um valor maior que zero.');
    const date = f.get('date');
    if (!date) return toast('Informe a data.');
    const old = form.dataset.id ? store.get('tx', form.dataset.id) : null;
    const origin = old && old.src ? { src: old.src, importHash: old.importHash, bank: old.bank } : {};
    const rec = { ...origin, id: form.dataset.id || uid(), type, amount, date, desc: String(f.get('desc') || '').trim(), who: f.get('who') };
    if (type === 'despesa') rec.catId = f.get('catId');
    if (type === 'guardar' || type === 'resgate') {
      rec.boxId = f.get('boxId');
      if (!rec.boxId) return toast('Crie uma caixinha em Patrimônio primeiro.');
    }
    if (type === 'divida') {
      rec.debtId = f.get('debtId');
      if (!rec.debtId) return toast('Cadastre a dívida na aba Dívidas primeiro.');
    }
    const isNew = !form.dataset.id;
    store.put('tx', rec);
    closeSheet();
    if (monthOf(date) !== state.month) state.month = monthOf(date);
    render({ force: true });
    toast('Lançamento salvo.');
    if (isNew && type === 'receita') openPayYourself(rec);
  },
  payself(form) {
    const f = new FormData(form);
    const base = { date: form.dataset.date, who: form.dataset.who };
    const recs = [];
    const save = form.querySelector('input[name=save]');
    if (save?.checked && f.get('boxId')) {
      recs.push({ ...base, id: uid(), type: 'guardar', amount: Number(save.dataset.amount), boxId: f.get('boxId'), desc: 'Pague-se primeiro' });
    }
    for (const el of form.querySelectorAll('input[name=debt]:checked')) {
      recs.push({ ...base, id: uid(), type: 'divida', amount: Number(el.dataset.amount), debtId: el.value, desc: 'Plano de Dabasir' });
    }
    if (recs.length) store.putMany('tx', recs);
    closeSheet();
    toast(recs.length ? 'Muito bem: a bolsa está engordando.' : 'Nada foi registrado.');
  },
  cat(form) {
    const f = new FormData(form);
    const budget = parseMoney(f.get('budget'));
    if (Number.isNaN(budget) || budget < 0) return toast('Limite inválido.');
    const old = form.dataset.id ? store.get('cats', form.dataset.id) : null;
    store.put('cats', { ...(old || {}), id: form.dataset.id || uid(), name: String(f.get('name')).trim(), kind: f.get('kind'), budget });
    closeSheet();
    toast('Categoria salva.');
  },
  debt(form) {
    const f = new FormData(form);
    const original = parseMoney(f.get('original'));
    if (!(original > 0)) return toast('Informe o valor da dívida.');
    const old = form.dataset.id ? store.get('debts', form.dataset.id) : null;
    store.put('debts', { ...(old || {}), id: form.dataset.id || uid(), creditor: String(f.get('creditor')).trim(), original, note: String(f.get('note') || '').trim() });
    closeSheet();
    toast('Dívida salva.');
  },
  box(form) {
    const f = new FormData(form);
    const target = parseMoney(f.get('target'));
    const rate = Number(String(f.get('rate') || '0').replace(',', '.'));
    if (Number.isNaN(target) || target < 0) return toast('Meta inválida.');
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return toast('Rendimento deve ficar entre 0 e 100%.');
    const id = form.dataset.id || uid();
    const old = form.dataset.id ? store.get('boxes', id) : null;
    const rec = { ...(old || { yield: 0 }), id, name: String(f.get('name')).trim(), purpose: f.get('purpose'), where: String(f.get('where') || '').trim(), risk: f.get('risk'), target, rate };
    if (old && f.has('balance')) {
      const bal = parseMoney(f.get('balance'));
      if (Number.isNaN(bal)) return toast('Saldo inválido.');
      const net = boxesWithBalance().find((b) => b.id === id)?.net || 0;
      rec.yield = bal - net;
    }
    store.put('boxes', rec);
    closeSheet();
    toast('Caixinha salva.');
  },
  family(form) {
    const f = new FormData(form);
    const names = f.getAll('member').map((n) => String(n).trim()).filter(Boolean);
    if (!names.length) return toast('Informe pelo menos um nome.');
    if (new Set(names).size !== names.length) return toast('Os nomes precisam ser diferentes.');
    const chosen = f.get('me');
    const idx = members().indexOf(chosen);
    store.setSettings({ members: names });
    store.setMeta({ me: names[idx] || names[0] });
    toast('Família salva.');
    render({ force: true });
  },
  rules(form) {
    const f = new FormData(form);
    const savePct = intPct(f.get('savePct'));
    const living = intPct(f.get('living'));
    const debt = intPct(f.get('debt'));
    const save = intPct(f.get('save'));
    if (!(savePct >= 0 && savePct <= 100)) return toast('O percentual de guardar deve ficar entre 0 e 100.');
    if ([living, debt, save].some((v) => !(v >= 0)) || living + debt + save !== 100) return toast('No plano de Dabasir, viver + credores + guardar precisa somar 100%.');
    store.setSettings({ savePct, dabasir: { living, debt, save }, dabasirAuto: f.has('dabasirAuto'), ownHome: f.has('ownHome') });
    toast('Regras salvas.');
    render({ force: true });
  },
  drivecfg(form) {
    const f = new FormData(form);
    drive.saveConfig({ clientId: String(f.get('clientId')).trim(), apiKey: String(f.get('apiKey')).trim(), appId: String(f.get('appId')).trim() });
    toast(drive.isConfigured() ? 'Chaves salvas.' : 'Preencha os três campos.');
    render({ force: true });
  },
  async share(form) {
    const email = String(new FormData(form).get('email')).trim();
    try {
      if (!drive.hasToken()) await drive.authorize();
      await drive.shareFile(store.meta.fileId, email);
      form.reset();
      toast(`Arquivo compartilhado com ${email}.`);
    } catch (e) {
      toast(e.message);
    }
  },
  'onb-new'(form) {
    const f = new FormData(form);
    const name = String(f.get('name')).trim();
    const spouse = String(f.get('spouse') || '').trim();
    const savePct = intPct(f.get('savePct'));
    if (!name) return toast('Informe seu nome.');
    if (!(savePct >= 0 && savePct <= 100)) return toast('O percentual deve ficar entre 0 e 100.');
    const names = spouse && spouse !== name ? [name, spouse] : [name];
    store.setSettings({ members: names, savePct });
    store.setMeta({ me: name });
    location.hash = '#inicio';
    render({ force: true });
    toast('Tudo pronto. Comece lançando a renda do mês.');
  },
};

// ---------- Ações ----------

async function withBusy(el, fn) {
  if (el) el.disabled = true;
  try {
    await fn();
  } catch (e) {
    toast(e.message || String(e));
  } finally {
    if (el && el.isConnected) el.disabled = false;
  }
}

const ACTIONS = {
  'close-sheet': closeSheet,
  month(el) {
    state.month = addMonths(state.month, Number(el.dataset.delta));
    render({ force: true });
  },
  filter(el) {
    state.filter = el.dataset.filter;
    render({ force: true });
  },
  'new-tx'(el) {
    const preset = {};
    if (el.dataset.type) preset.type = el.dataset.type;
    if (el.dataset.amount) preset.amount = Number(el.dataset.amount);
    if (preset.type === 'guardar') preset.boxId = (store.list('boxes').find((b) => b.purpose === 'reserva') || store.list('boxes')[0])?.id;
    openTxForm(null, preset);
  },
  'edit-tx'(el) {
    const t = store.get('tx', el.dataset.id);
    if (t) openTxForm(t);
  },
  'tx-type'(el) {
    const form = el.closest('form');
    const type = el.dataset.type;
    form.elements.type.value = type;
    for (const b of form.querySelectorAll('[data-action="tx-type"]')) b.setAttribute('aria-pressed', String(b === el));
    for (const g of form.querySelectorAll('[data-show]')) g.hidden = !g.dataset.show.split(' ').includes(type);
  },
  'delete-tx'(el) {
    if (!confirm('Excluir este lançamento?')) return;
    store.remove('tx', el.dataset.id);
    closeSheet();
    toast('Lançamento excluído.');
  },
  'new-cat': () => openCatForm(null),
  'edit-cat'(el) {
    const c = store.get('cats', el.dataset.id);
    if (c) openCatForm(c);
  },
  'delete-cat'(el) {
    if (!confirm('Excluir esta categoria? Os lançamentos antigos continuam no extrato.')) return;
    store.remove('cats', el.dataset.id);
    closeSheet();
  },
  'new-debt': () => openDebtForm(null),
  'edit-debt'(el) {
    const d = store.get('debts', el.dataset.id);
    if (d) openDebtForm(d);
  },
  'delete-debt'(el) {
    if (!confirm('Excluir esta dívida? Os pagamentos já lançados continuam no extrato.')) return;
    store.remove('debts', el.dataset.id);
    closeSheet();
  },
  'pay-debt'(el) {
    openTxForm(null, { type: 'divida', debtId: el.dataset.id, amount: Number(el.dataset.amount) || 0, desc: 'Plano de Dabasir' });
  },
  'new-box': () => openBoxForm(null),
  'edit-box'(el) {
    const b = store.get('boxes', el.dataset.id);
    if (b) openBoxForm(b);
  },
  'delete-box'(el) {
    const b = boxesWithBalance().find((x) => x.id === el.dataset.id);
    const warn = b && b.balance ? ` Ela ainda tem ${money(b.balance)}.` : '';
    if (!confirm(`Excluir esta caixinha?${warn} Os lançamentos continuam no extrato.`)) return;
    store.remove('boxes', el.dataset.id);
    closeSheet();
  },
  'box-tx'(el) {
    openTxForm(null, { type: el.dataset.type, boxId: el.dataset.id });
  },
  theme(el) {
    const t = el.dataset.theme;
    store.setMeta({ theme: t });
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  },
  async 'imp-copy'() {
    const text = imp.claudePrompt(impContext());
    try {
      await navigator.clipboard.writeText(text);
      toast('Instruções copiadas. Agora abra o Claude e cole.');
    } catch {
      state.imp.showPrompt = true; // sem acesso à área de transferência: mostra o texto para copiar à mão
      render({ force: true });
    }
  },
  'imp-read-paste'() {
    readPaste();
  },
  'imp-remove'(el) {
    const I = state.imp;
    const [f] = I.files.splice(Number(el.dataset.idx), 1);
    if (f) I.items = I.items.filter((i) => i.fileKey !== f.key);
    render({ force: true });
  },
  'imp-all'() {
    for (const i of state.imp.items) if (i.choice !== 'ignorar') i.include = true;
    render({ force: true });
  },
  'imp-none'() {
    for (const i of state.imp.items) i.include = false;
    render({ force: true });
  },
  'imp-commit'() {
    commitImport();
  },
  'imp-discard'() {
    if (!confirm('Descartar esta importação? Nada foi lançado ainda.')) return;
    state.imp = emptyImp();
    render({ force: true });
  },
  async install() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    if (outcome === 'accepted') toast('Bolsa Cheia instalado.');
    render({ force: true });
  },
  'goto-drive'() {
    location.hash = '#ajustes';
  },
  sync(el) {
    withBusy(el, () => syncNow({ interactive: true }));
  },
  'create-file'(el) {
    withBusy(el, async () => {
      await createDriveFile();
      toast('Arquivo criado no seu Drive. Agora compartilhe com o cônjuge.');
    });
  },
  'open-file'(el) {
    withBusy(el, async () => {
      if (await openDriveFile()) toast('Arquivo da família conectado.');
      render({ force: true });
    });
  },
  disconnect() {
    if (!confirm('Parar de sincronizar este aparelho? Os dados continuam aqui e no Drive.')) return;
    disconnectDrive();
  },
  export() {
    const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bolsa-cheia-backup-${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  reset() {
    if (!confirm('Apagar todos os dados deste aparelho? Se não houver cópia no Drive ou backup, eles se perdem.')) return;
    store.resetDevice();
    location.hash = '';
    location.reload();
  },
  onb(el) {
    state.onboard = el.dataset.step;
    render({ force: true });
  },
  'set-me'(el) {
    store.setMeta({ me: el.dataset.name });
    location.hash = '#inicio';
    render({ force: true });
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) {
    e.preventDefault();
    fn(el, e);
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  FORMS[form.dataset.form]?.(form);
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.input === 'search') {
    state.search = el.value;
    render({ force: true });
  } else if (el.dataset.input === 'imp-paste') {
    state.imp.paste = el.value;
    const btn = document.querySelector('[data-action="imp-read-paste"]');
    if (btn) btn.disabled = !el.value.trim();
  } else if (el.dataset.sim) {
    const k = el.dataset.sim;
    state.sim[k] = k === 'initial' || k === 'monthly' ? parseMoney(el.value) || 0 : Number(el.value.replace(',', '.'));
    const out = document.getElementById('sim-result');
    if (out) out.innerHTML = simResult();
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  const I = state.imp;
  if (el.dataset.input === 'imp-files') {
    const list = [...(el.files || [])];
    el.value = '';
    if (list.length) processFiles(list);
    return;
  }
  if (el.dataset.impSel !== undefined) {
    const item = I.items[Number(el.dataset.impSel)];
    item.choice = el.value;
    item.dup = findDuplicate(item);
    item.include = item.choice !== 'ignorar';
    render({ force: true });
    return;
  }
  if (el.dataset.impChk !== undefined) {
    I.items[Number(el.dataset.impChk)].include = el.checked;
    render({ force: true });
    return;
  }
  if (el.dataset.impWho !== undefined) {
    I.who = el.value;
    return;
  }
  if (el.dataset.input !== 'import' || !el.files?.[0]) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      store.importData(JSON.parse(reader.result));
      toast('Backup importado.');
    } catch (err) {
      toast(err.message || 'Arquivo inválido.');
    }
    el.value = '';
  };
  reader.readAsText(el.files[0]);
});

// Quem estava digitando pode ter segurado uma atualização: aplica quando sair do campo.
document.addEventListener('focusout', () => {
  setTimeout(() => { if (pendingRender && !isTyping()) render(); }, 0);
});

$sheet.addEventListener('click', (e) => { if (e.target === $sheet) closeSheet(); });

window.addEventListener('hashchange', () => {
  closeSheet();
  render({ force: true });
  window.scrollTo(0, 0);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.meta.fileId && drive.hasToken()) syncNow().catch(() => {});
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (currentView() === 'ajustes') render();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  render();
});

store.subscribe(() => render());
render({ force: true });
if (store.meta.fileId) syncNow().catch(() => {});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
