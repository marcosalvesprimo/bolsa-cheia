// Importação de extratos e faturas, sem custo:
// A) OFX, CSV e planilhas são lidos aqui mesmo, no aparelho (nada sai dele).
// B) PDF e prints vão para o Claude da assinatura do usuário: o app gera as instruções,
//    a pessoa cola no Claude junto com o arquivo e traz a resposta de volta para o app.
// Os dois caminhos produzem a mesma lista de "lançamentos" para a tela de revisão.

export const CLASSES = {
  receita: 'Receita',
  despesa: 'Despesa',
  estorno: 'Estorno (abate de despesa)',
  guardar: 'Aplicação / guardar',
  resgate: 'Resgate de aplicação',
  pagamento_divida: 'Pagamento de dívida',
  pagamento_fatura: 'Pagamento de fatura de cartão',
  transferencia_propria: 'Transferência entre contas da família',
  ignorar: 'Não é lançamento',
};

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
const BANK_CODES = { '756': 'Sicoob', '077': 'Inter', '77': 'Inter', '001': 'Banco do Brasil', '1': 'Banco do Brasil', '461': 'Asaas', '260': 'Nubank', '341': 'Itaú', '237': 'Bradesco', '104': 'Caixa', '033': 'Santander' };
const BANK_NAMES = [['sicoob', 'Sicoob'], ['inter', 'Inter'], ['banco do brasil', 'Banco do Brasil'], ['asaas', 'Asaas'], ['bb', 'Banco do Brasil'], ['nubank', 'Nubank']];

// ---------- Utilidades ----------

export async function sha256(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {}
  return new TextDecoder('windows-1252').decode(buf); // arquivos de banco brasileiro costumam vir assim
}

// Maiúsculas, sem acentos, sem números nem pontuação: base para regras e comparações.
export function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Chave usada para lembrar a classificação escolhida pela pessoa (primeiras 5 palavras).
export function ruleKey(desc) {
  return normalize(desc).split(' ').filter((w) => w.length > 1).slice(0, 5).join(' ');
}

function titleCase(s) {
  const clean = String(s || '').replace(/\s+/g, ' ').trim();
  if (clean !== clean.toUpperCase()) return clean; // já tem maiúsculas e minúsculas
  return clean.toLowerCase().replace(/(^|[\s/(-])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase());
}

// "1.234,56", "-1.234,56", "1234.56", "(12,00)", "R$ -12,00", "12,00 D" -> centavos com sinal.
function parseAmount(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return NaN;
  let neg = /^\(.*\)$/.test(s) || /-/.test(s) || /\bD$/i.test(s);
  if (/\bC$/i.test(s)) neg = false;
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

// "31/12/2026", "31/12/26", "2026-12-31", "31-12-2026", "20261231" -> "2026-12-31".
function parseDate(raw) {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function bankFrom(text, fileName) {
  const hay = `${fileName} ${text}`.toLowerCase();
  for (const [needle, name] of BANK_NAMES) {
    if (needle === 'bb' ? /(^|[^a-z])bb([^a-z]|$)/.test(fileName.toLowerCase()) : hay.includes(needle)) return name;
  }
  return '';
}

// ---------- Classificação por regras (sem IA) ----------

const CAT_KEYWORDS = [
  ['cat-mercado', /SUPERMERC|MERCADO|ATACAD|ASSAI|CARREFOUR|PAO DE ACUCAR|HORTIFRUT|ACOUGUE|PADARIA|PANIFIC|SACOLAO|MERCEARIA|EMPORIO/],
  ['cat-restaurantes', /IFOOD|RESTAUR|LANCHONETE|LANCHES|PIZZ|BURGER|BURGUER|RAPPI|DELIVERY|CAFETERIA|SORVET|CHURRASC|SUSHI|MC ?DONALD|OUTBACK|BAR /],
  ['cat-transporte', /UBER|\b99 ?(POP|APP|TAXI)?\b|POSTO|COMBUST|SHELL|IPIRANGA|PETROBRAS|\bBR\b|ESTACIONA|PEDAGIO|SEM PARAR|CONECTCAR|VELOE|DETRAN|IPVA|OFICINA|AUTO PECAS|PNEU/],
  ['cat-saude', /FARMA|DROGA|HOSPITAL|CLINICA|LABORAT|UNIMED|ODONTO|DENTIST|RAIA|PANVEL|PAGUE MENOS|HAPVIDA|AMIL|BRADESCO SAUDE|SULAMERICA|MEDIC|EXAME|OTICA/],
  ['cat-contas', /ENERGIA|ENEL|CEMIG|COPEL|CELESC|LIGHT|NEOENERGIA|COELBA|CELPE|EQUATORIAL|ENERGISA|SANEAMENTO|SABESP|COPASA|CAGECE|EMBASA|AGUA|CLARO|VIVO|\bTIM\b|\bOI\b|INTERNET|TELEFON|\bNET\b|COMGAS|GAS /],
  ['cat-moradia', /ALUGUEL|CONDOMIN|IPTU|IMOBILI|FINANC HABIT/],
  ['cat-educacao', /ESCOLA|COLEGIO|FACULD|UNIVERS|CURSO|LIVRARIA|EDUCA|UDEMY|ALURA|MENSALIDADE ESC/],
  ['cat-assinaturas', /NETFLIX|SPOTIFY|PRIME VIDEO|AMAZON PRIME|DISNEY|HBO|\bMAX\b|YOUTUBE|APPLE COM|ICLOUD|GOOGLE ONE|GOOGLE STORAGE|DEEZER|GLOBOPLAY|PARAMOUNT|CLAUDE|OPENAI|CHATGPT|MICROSOFT|ADOBE|ASSINATURA/],
  ['cat-compras', /AMAZON|MERCADOLIVRE|MERCADO LIVRE|MERCADOPAGO|SHOPEE|MAGAZINE|MAGALU|RENNER|RIACHUELO|\bC ?A\b|SHEIN|ALIEXPRESS|CENTAURO|NETSHOES|AMERICANAS|CASAS BAHIA|KABUM|LOJA|CALCAD|MODA/],
  ['cat-lazer', /CINEMA|INGRESSO|HOTEL|POUSADA|AIRBNB|BOOKING|DECOLAR|LATAM|\bGOL\b|AZUL|VIAGE|TEATRO|SHOW|PARQUE|CLUBE/],
];

const RX = {
  fatura: /PAG(TO|AMENTO)? ?(DE )?FATURA|FATURA CART|PAGTO CART|PAG CARTAO|PAGAMENTO CARTAO|PAGAMENTO RECEBIDO|PAGAMENTO EFETUADO|PAGAMENTO DE FATURA|DEB AUT FATURA|DEBITO AUTOMATICO FATURA/,
  guardar: /APLIC|RDB|CDB|RDC|POUPAN|INVEST|\bLCI\b|\bLCA\b|TESOURO|COFRINHO|CAIXINHA|PORQUINHO|CAPITALIZ/,
  resgate: /RESGATE|\bRESG\b|RESG AUT/,
  estorno: /ESTORNO|CANCELAMENTO|CANCELAD|CASHBACK|DEVOLU|REEMBOLSO|CREDITO DE/,
  propria: /MESMA TITULARIDADE|ENTRE CONTAS|TRANSF(ERENCIA)? PROPRIA|CONTA PROPRIA|ASAAS/,
  divida: /EMPRESTIMO|EMPREST|FINANCIAMENTO|FINANC|CONSORCIO|PARCELA CRED|CREDITO PESSOAL|CONSIGNADO/,
};

function guessCategory(n, cats) {
  const ids = new Set(cats.map((c) => c.id));
  for (const [id, rx] of CAT_KEYWORDS) if (ids.has(id) && rx.test(` ${n} `)) return id;
  // Categorias criadas pela pessoa: o nome aparece na descrição.
  for (const c of cats) {
    const name = normalize(c.name);
    if (name.length >= 4 && n.includes(name)) return c.id;
  }
  return ids.has('cat-outros') ? 'cat-outros' : cats[0]?.id || '';
}

function parcelaOf(desc) {
  const m = String(desc).match(/(?:PARC(?:ELA)?\.?\s*)?(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})\s*$/i);
  if (!m) return '';
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a >= 1 && b >= 2 && a <= b ? `${a}/${b}` : '';
}

// amount: centavos com sinal (negativo = dinheiro saindo). card: fatura de cartão.
function classify({ desc, amount, card }, ctx) {
  const n = normalize(desc);
  const memberHit = ctx.members.some((m) => {
    const w = normalize(m);
    return w.length >= 3 && ` ${n} `.includes(` ${w} `);
  });
  const base = { categoria_id: '', divida_id: '', parcela: '', motivo: '' };
  if (RX.fatura.test(n)) return { ...base, classe: 'pagamento_fatura' };
  if (card) {
    if (amount > 0) return RX.fatura.test(n) || /PAGAMENTO/.test(n)
      ? { ...base, classe: 'pagamento_fatura' }
      : { ...base, classe: 'estorno', categoria_id: guessCategory(n, ctx.cats), motivo: 'Crédito na fatura' };
    return { ...base, classe: 'despesa', categoria_id: guessCategory(n, ctx.cats), parcela: parcelaOf(desc) };
  }
  if (amount > 0) {
    if (RX.resgate.test(n)) return { ...base, classe: 'resgate', motivo: 'Resgate de aplicação' };
    if (RX.estorno.test(n)) return { ...base, classe: 'estorno', categoria_id: guessCategory(n, ctx.cats) };
    if (memberHit || RX.propria.test(n)) {
      return { ...base, classe: 'transferencia_propria', motivo: /ASAAS/.test(n) ? 'Vindo do Asaas: se você não importa o extrato do Asaas, mude para Receita' : 'Parece vir de conta da própria família' };
    }
    return { ...base, classe: 'receita' };
  }
  if (ctx.bank === 'Asaas' && /TRANSFER|SAQUE|\bTED\b|\bPIX\b/.test(n) && !/TAXA|TARIFA/.test(n)) {
    return { ...base, classe: 'transferencia_propria', motivo: 'Saída do Asaas para a sua conta: não é despesa' };
  }
  if (RX.guardar.test(n)) return { ...base, classe: 'guardar', motivo: 'Aplicação' };
  if (memberHit || RX.propria.test(n)) return { ...base, classe: 'transferencia_propria', motivo: 'Parece ir para conta da própria família' };
  const debt = ctx.debts.find((d) => {
    const c = normalize(d.creditor);
    return c.length >= 4 && n.includes(c);
  });
  if (debt) return { ...base, classe: 'pagamento_divida', divida_id: debt.id, motivo: `Credor: ${debt.creditor}` };
  if (RX.divida.test(n)) return { ...base, classe: 'pagamento_divida', motivo: 'Parece parcela de empréstimo ou financiamento' };
  return { ...base, classe: 'despesa', categoria_id: guessCategory(n, ctx.cats), parcela: parcelaOf(desc) };
}

function periodOf(rows) {
  const ds = rows.map((r) => r.date).sort();
  const br = (iso) => iso.split('-').reverse().join('/');
  return ds.length ? `${br(ds[0])} a ${br(ds[ds.length - 1])}` : '';
}

function toLancamento(row, ctx) {
  const c = classify(row, ctx);
  return {
    data: row.date,
    descricao: titleCase(row.desc),
    valor_centavos: Math.abs(row.amount),
    ...c,
  };
}

// ---------- OFX ----------

function ofxTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
}

function parseOfx(text, fileName, ctx) {
  const card = /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(text);
  const bankId = ofxTag(text, 'BANKID').replace(/^0+(?=\d{3}$)/, '');
  const org = ofxTag(text, 'ORG');
  const bank = BANK_CODES[ofxTag(text, 'BANKID')] || BANK_CODES[bankId] || bankFrom(org, fileName) || org || 'Banco';
  const rows = [];
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const body = block.split(/<\/STMTTRN>/i)[0];
    const date = parseDate(ofxTag(body, 'DTPOSTED'));
    const amount = parseAmount(ofxTag(body, 'TRNAMT'));
    const memo = ofxTag(body, 'MEMO');
    const name = ofxTag(body, 'NAME');
    const desc = [name, memo].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' ').trim() || ofxTag(body, 'TRNTYPE');
    if (!date || !Number.isFinite(amount) || amount === 0) continue;
    rows.push({ date, desc, amount, card });
  }
  if (!rows.length) throw new Error('Não encontrei lançamentos neste OFX.');
  const ctxBank = { ...ctx, bank };
  return { banco: bank, tipo_documento: card ? 'fatura_cartao' : 'extrato_conta', periodo: periodOf(rows), observacoes: '', lancamentos: rows.map((r) => toLancamento(r, ctxBank)) };
}

// ---------- CSV / planilha ----------

function splitCsv(text, delim) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

function pickDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
  const count = (ch) => sample.split(ch).length - 1;
  return [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
}

function findColumns(header) {
  const h = header.map(normalize);
  const idx = (rx, not) => h.findIndex((x) => rx.test(x) && !(not && not.test(x)));
  const all = (rx, not) => h.map((x, i) => (rx.test(x) && !(not && not.test(x)) ? i : -1)).filter((i) => i >= 0);
  return {
    date: idx(/^DATA|^DT\b|^DATE/, /VENC/),
    desc: all(/DESCRI|HISTOR|LANCAMENTO|DETALHE|MEMO|ESTABELEC|TITULO|NOME|OBSERV/, /^DATA|TIPO LANC|VALOR/),
    value: idx(/^VALOR|^VLR|^AMOUNT|^QUANTIA/, /SALDO|ORIGINAL|DOLAR|US/),
    credit: idx(/CREDITO|ENTRADA/),
    debit: idx(/DEBITO|SAIDA/),
    kind: idx(/^TIPO|NATUREZA|^D C$|^C D$/),
  };
}

function parseTable(rows, fileName, ctx) {
  let headerAt = -1;
  let cols = null;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const c = findColumns(rows[i]);
    if (c.date >= 0 && (c.value >= 0 || c.credit >= 0 || c.debit >= 0)) { headerAt = i; cols = c; break; }
  }
  if (!cols) throw new Error('Não reconheci as colunas desta planilha (preciso de Data e Valor). Tente exportar em OFX.');
  const joined = rows.slice(0, headerAt + 1).map((r) => r.join(' ')).join(' ');
  const cardHint = /fatura|cart[aã]o|cartao/i.test(`${fileName} ${joined}`);
  const parsed = [];
  for (const r of rows.slice(headerAt + 1)) {
    const date = parseDate(r[cols.date]);
    if (!date) continue;
    const desc = (cols.desc.length ? cols.desc : []).map((i) => r[i]).filter(Boolean).join(' ').trim();
    if (/SALDO/.test(normalize(desc)) && !/PAGAMENTO/.test(normalize(desc))) continue;
    let amount = NaN;
    if (cols.value >= 0 && r[cols.value]) amount = parseAmount(r[cols.value]);
    else {
      const cr = cols.credit >= 0 ? parseAmount(r[cols.credit]) : NaN;
      const db = cols.debit >= 0 ? parseAmount(r[cols.debit]) : NaN;
      if (Number.isFinite(cr) && cr !== 0) amount = Math.abs(cr);
      else if (Number.isFinite(db) && db !== 0) amount = -Math.abs(db);
    }
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (cols.kind >= 0) {
      const k = normalize(r[cols.kind]);
      if (/^(D|DEBITO|SAIDA)/.test(k)) amount = -Math.abs(amount);
      else if (/^(C|CREDITO|ENTRADA)/.test(k)) amount = Math.abs(amount);
    }
    parsed.push({ date, desc: desc || 'Lançamento', amount });
  }
  if (!parsed.length) throw new Error('Não encontrei lançamentos nesta planilha.');
  // Fatura em planilha costuma trazer as compras com valor positivo: nesse caso inverte para "saída".
  const card = cardHint || !parsed.some((p) => p.amount < 0);
  const purchasesPositive = parsed.filter((p) => p.amount > 0).length >= parsed.length / 2;
  const rowsOut = parsed.map((p) => ({ ...p, card, amount: card && purchasesPositive ? -p.amount : p.amount }));
  const bank = bankFrom(joined, fileName) || 'Planilha';
  const ctxBank = { ...ctx, bank };
  return {
    banco: bank,
    tipo_documento: card ? 'fatura_cartao' : 'extrato_conta',
    periodo: periodOf(rowsOut),
    observacoes: card ? 'Tratei como fatura de cartão. Confira se as compras e o pagamento ficaram certos.' : '',
    lancamentos: rowsOut.map((r) => toLancamento(r, ctxBank)),
  };
}

let xlsxPromise = null;
function loadXlsx() {
  xlsxPromise ??= import(XLSX_URL).catch(() => {
    xlsxPromise = null;
    throw new Error('Sem internet para abrir planilhas do Excel. Salve como CSV ou tente de novo com internet.');
  });
  return xlsxPromise;
}

// Lê um arquivo local (OFX, CSV, TXT, XLS, XLSX) e devolve o documento no mesmo formato da resposta do Claude.
export async function readLocalFile(file, ctx) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  const hash = await sha256(buf);
  if (file.type === 'application/pdf' || name.endsWith('.pdf') || file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/.test(name)) {
    throw new Error('PDF e fotos: use o Claude, no quadro "Fatura em PDF ou print" logo abaixo.');
  }
  if (/\.(xlsx|xls)$/.test(name)) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }).map((r) => r.map((c) => String(c).trim())).filter((r) => r.some(Boolean));
    return { hash, doc: parseTable(rows, file.name, ctx) };
  }
  const text = decodeText(buf);
  if (/\.(ofx|qfx)$/.test(name) || /<OFX>|OFXHEADER/i.test(text.slice(0, 2000))) return { hash, doc: parseOfx(text, file.name, ctx) };
  if (/\.(csv|txt)$/.test(name) || file.type.startsWith('text/')) return { hash, doc: parseTable(splitCsv(text, pickDelimiter(text)), file.name, ctx) };
  throw new Error('Formato não suportado. Use OFX, CSV ou planilha (e o Claude para PDF e fotos).');
}

// ---------- Claude da assinatura (copiar e colar) ----------

export function claudePrompt({ members, cats, debts }) {
  const catLines = cats.map((c) => `- ${c.id}: ${c.name} (${c.kind})`).join('\n');
  const debtLines = debts.length ? debts.map((d) => `- ${d.id}: ${d.creditor}`).join('\n') : '(nenhuma)';
  return `Vou anexar extrato(s) bancário(s) ou fatura(s) de cartão de crédito. Extraia os lançamentos para o Bolsa Cheia, o app de controle financeiro da minha família. O app soma receitas e despesas do mês, controla o que a família guarda em aplicações e acompanha o pagamento de dívidas, então cada movimentação precisa entrar uma única vez e na classe certa.

Inclua todas as movimentações efetivadas, uma por item, sem resumir, mesmo que o documento seja longo. Não inclua saldos, totais, subtotais, limites, resumos, valores bloqueados nem lançamentos futuros. Não invente nada: se algo estiver ilegível, diga em "observacoes". Se eu anexar vários arquivos, junte tudo num único JSON.

Classes:
- receita: dinheiro que entra de fora da família (salário, honorários, cobranças recebidas, PIX/TED de terceiros, rendimentos creditados, reembolsos de terceiros).
- despesa: compras, boletos, contas, PIX/TED para terceiros, tarifas, IOF, juros, encargos, anuidade, taxas.
- estorno: crédito que desfaz uma despesa (estorno, cancelamento, cashback na fatura).
- guardar: dinheiro que vai para aplicação ou reserva da família (poupança, CDB, RDB, RDC, LCI/LCA, Tesouro, fundos, caixinhas do banco).
- resgate: dinheiro que volta de aplicação ou reserva para a conta.
- pagamento_divida: parcela de empréstimo, financiamento ou consórcio, ou pagamento a um credor da lista de dívidas (preencha divida_id se corresponder).
- pagamento_fatura: pagamento da fatura do cartão (na fatura: "pagamento recebido"; no extrato: "pagamento de fatura"). Não é lançado, porque as compras entram pela fatura.
- transferencia_propria: movimentação entre contas da própria família (contraparte é um membro da família ou o próprio titular; saque do Asaas para a conta do titular).
- ignorar: linha que não é movimentação real.

Fatura de cartão: cada compra é uma despesa na data da compra; em compras parceladas lance só a parcela desta fatura e preencha "parcela" (ex.: "3/10"); se a data não tiver ano, deduza pelo período da fatura.

Membros da família: ${members.join(', ') || '(não informado)'}.

Categorias de despesa (use o id):
${catLines}

Dívidas cadastradas:
${debtLines}

Responda SOMENTE com um bloco de código JSON, sem texto antes ou depois, neste formato:
\`\`\`json
{
  "bolsa_cheia": 1,
  "banco": "nome do banco",
  "tipo_documento": "extrato_conta | fatura_cartao | outro",
  "periodo": "01/09/2026 a 30/09/2026",
  "observacoes": "",
  "lancamentos": [
    {"data": "AAAA-MM-DD", "descricao": "nome curto e legível", "valor_centavos": 12345, "classe": "despesa", "categoria_id": "cat-mercado", "divida_id": "", "parcela": "", "motivo": ""}
  ]
}
\`\`\`
Regras dos campos: valor_centavos é inteiro e positivo (R$ 1.234,56 = 123456); categoria_id só para despesa e estorno (senão ""); divida_id só para pagamento_divida com correspondência (senão ""); motivo é uma frase curta quando a classificação não for óbvia (senão "").`;
}

// Lê a resposta colada do Claude (com ou sem bloco de código) e valida os campos.
export function parseClaudeAnswer(text, ctx) {
  const s = String(text || '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1] : s;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a < 0) throw new Error('Não encontrei o JSON na resposta. Copie a resposta inteira do Claude.');
  if (b <= a) throw new Error('A resposta parece cortada. Peça ao Claude: "continue o JSON" ou divida o documento.');
  let data;
  try { data = JSON.parse(body.slice(a, b + 1)); } catch {
    throw new Error('A resposta parece cortada ou incompleta. Peça ao Claude: "continue o JSON" ou divida o documento.');
  }
  const list = Array.isArray(data.lancamentos) ? data.lancamentos : [];
  if (!list.length) throw new Error('A resposta não tem lançamentos.');
  const catIds = new Set(ctx.cats.map((c) => c.id));
  const debtIds = new Set(ctx.debts.map((d) => d.id));
  const lancamentos = [];
  for (const l of list) {
    const data_ = parseDate(l.data);
    let cents = Number.isInteger(l.valor_centavos) ? Math.abs(l.valor_centavos) : Math.abs(parseAmount(l.valor ?? l.valor_centavos));
    if (!data_ || !(cents > 0)) continue;
    const classe = CLASSES[l.classe] ? l.classe : 'despesa';
    lancamentos.push({
      data: data_,
      descricao: titleCase(l.descricao || 'Lançamento'),
      valor_centavos: cents,
      classe,
      categoria_id: catIds.has(l.categoria_id) ? l.categoria_id : '',
      divida_id: debtIds.has(l.divida_id) ? l.divida_id : '',
      parcela: typeof l.parcela === 'string' ? l.parcela : '',
      motivo: typeof l.motivo === 'string' ? l.motivo : '',
    });
  }
  if (!lancamentos.length) throw new Error('Nenhum lançamento válido na resposta (confira datas e valores).');
  return {
    banco: String(data.banco || 'Claude'),
    tipo_documento: ['extrato_conta', 'fatura_cartao', 'outro'].includes(data.tipo_documento) ? data.tipo_documento : 'outro',
    periodo: String(data.periodo || ''),
    observacoes: String(data.observacoes || ''),
    lancamentos,
  };
}
