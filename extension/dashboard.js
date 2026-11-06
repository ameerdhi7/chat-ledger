// Dashboard: reads purchases from chrome.storage.local. No network access (blocked by the extension's CSP).
const CATEGORIES = [
  { name: 'Groceries',     words: ['happy home', 'mst', 'market', 'hyper', 'komper', 'mokabelat', 'jawharat'] },
  { name: 'Pharmacy',      words: ['pharmacy', 'saydlya', 'saydaliya', 'saydalia'] },
  { name: 'Cafe & Food',   words: ['cafe', 'coffee', 'restaurant', 'burger', 'pizza', 'bakery', 'twfaht'] },
  { name: 'Subscriptions', words: ['anthropic', 'claude', 'openai', 'google', 'apple', 'netflix', 'spotify', 'github'] },
  { name: 'Mobile',        words: ['mobile', 'zain', 'asiacell', 'korek'] },
  { name: 'Fuel & Travel', words: ['fuel', 'petrol', 'station', 'alryan', 'sharikat'] },
];

const app = document.getElementById('app'), modal = document.getElementById('modal'), tip = document.getElementById('tip');
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const A = (n) => `<span class="amt">${fmt(n)}</span>`;
let CUR = 'IQD';
const IQD = (n) => `<span class="amt">${fmt(n)} ${CUR}</span>`;
// Each provider gets a stable colour from its name.
const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const ptag = (p) => `<span class="ptag" style="--h:${hue(p)}">${esc(p)}</span>`;
const ymd = (d) => d.toLocaleDateString('en-CA');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sum = (a) => a.reduce((s, t) => s + (t.type === 'credit' ? 0 : t.amount), 0);
const monthName = (k, o = { month: 'long', year: 'numeric' }) => new Date(k + '-15').toLocaleDateString('en-US', o);
const catOf = (t) => {
  const n = `${t.merchant} ${t.raw}`.toLowerCase();
  return (CATEGORIES.find((c) => c.words.some((w) => n.includes(w))) || { name: 'Other' }).name;
};

let S = { tx: [], sources: [], budget: 0, private: false, autoSync: true, lastSync: 0, shield: true };
let month = null, query = '', prov = 'all', unlocked = false;

async function load() {
  S = { ...S, ...(await chrome.storage.local.get(['tx', 'sources', 'budget', 'private', 'autoSync', 'lastSync', 'shield'])) };
  S.sources ||= [];
  S.tx = (S.tx || []).map((t) => ({ type: 'debit', currency: 'IQD', provider: 'Other', ...t })).map((t) => ({ ...t, cat: catOf(t) }));
  document.body.classList.toggle('private', !!S.private);
}
const save = (o) => chrome.storage.local.set(o);

chrome.storage.onChanged.addListener(async (c) => {
  if (!unlocked) return;
  if (c.tx || c.lastSync || c.sources) { await load(); render(); }
  if (c.wa) banner();
});

// ---------------- WhatsApp status warning ----------------
// The WhatsApp tab reports in every 30s; no report for 3 minutes means it's closed.
const bannerEl = document.getElementById('wa');
async function banner() {
  if (!unlocked) return (bannerEl.innerHTML = '');
  const { wa } = await chrome.storage.local.get('wa');
  const open = wa && Date.now() - wa.at < 3 * 60e3;
  const W = {
    closed: ['', '<b>WhatsApp Web isn\'t open.</b> New purchases won\'t show up until you open it in this browser.', 'Open WhatsApp Web'],
    loading: ['', '<b>WhatsApp Web is still loading your chats.</b> Syncing starts as soon as it\'s ready.', ''],
    loggedOut: ['', '<b>WhatsApp Web is waiting for you to log in.</b> Scan the QR code with your phone (WhatsApp → Linked devices).', 'Go to WhatsApp Web'],
    noSources: ['', '<b>No chats added yet.</b> Add the WhatsApp chats your bank or wallet sends alerts to.', ''],
    noChat: ['bad', `<b>Chat not found:</b> ${esc((wa?.missing || []).join(', '))}. Check the name matches the chat in WhatsApp exactly (Settings → Chats).`, 'Check WhatsApp'],
  }[open ? wa.state : 'closed'];
  if (!W) return (bannerEl.innerHTML = '');
  bannerEl.innerHTML = `<div class="banner ${W[0]}"><span>${W[1]}</span>${W[2] ? `<button id="wago">${W[2]}</button>` : ''}</div>`;
  document.getElementById('wago')?.addEventListener('click', () => chrome.tabs.create({ url: 'https://web.whatsapp.com/' }));
}
setInterval(banner, 30e3);

// ---------------- main view ----------------
// ---------------- chats (sources) ----------------
// A source is a WhatsApp chat name plus the provider tag its transactions get on the dashboard.
function sourcesEditor(el) {
  el.innerHTML = `<div class="sources">${S.sources.map((s, i) => `<div class="row"><span>${ptag(s.label)} <span class="mute">chat “${esc(s.chat)}”</span></span>
      <button class="ghost" data-rm="${i}">Remove</button></div>`).join('') || '<div class="mute">No chats yet.</div>'}
    <form class="tools addsrc"><input name="chat" placeholder="Chat name in WhatsApp, e.g. Tabadul" required>
      <input name="label" placeholder="Tag (optional), e.g. Tabadul card"><button>Add chat</button></form>
    <div class="msg" id="srcmsg"></div></div>`;
  el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
    S.sources.splice(+b.dataset.rm, 1); await save({ sources: S.sources }); sourcesEditor(el);
  }));
  el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const chat = e.target.chat.value.trim(), label = e.target.label.value.trim() || chat;
    if (S.sources.some((s) => s.label.toLowerCase() === label.toLowerCase()))
      return (el.querySelector('#srcmsg').textContent = `There's already a chat tagged “${label}”.`);
    S.sources.push({ chat, label }); await save({ sources: S.sources }); sourcesEditor(el);
    el.querySelector('#srcmsg').textContent = 'Added — it syncs the next time WhatsApp Web is open.';
  };
}

function welcome() {
  app.innerHTML = `<div class="welcome">
    <h1>Welcome to Chat Ledger</h1>
    <p class="mute">Banks, cards and wallets send every transaction to WhatsApp. Name those chats and this turns their messages into one private dashboard, tagged by provider — no account, no server. Nothing leaves this computer.</p>
    <div class="steps">
      <div class="step"><b>1</b><div><strong>Add your chats</strong> — type each chat's name exactly as it appears in WhatsApp, and an optional tag.<div id="src" style="margin-top:10px"></div></div></div>
      <div class="step"><b>2</b><div><strong>Open WhatsApp Web</strong> in this browser. Chat Ledger opens each chat, scrolls back through it and saves the transactions. Look for the small pill in the bottom-left.</div></div>
      <div class="step"><b>3</b><div>Come back here — the dashboard fills in by itself.</div></div>
    </div>
    <button id="openwa">Open WhatsApp Web</button>
  </div>`;
  sourcesEditor(document.getElementById('src'));
  document.getElementById('openwa').onclick = () => chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
}

function render() {
  if (!unlocked) return;
  if (!S.tx.length) return welcome();
  const providers = [...new Set(S.tx.map((t) => t.provider))].sort();
  if (prov !== 'all' && !providers.includes(prov)) prov = 'all';
  const byProv = S.tx.filter((t) => prov === 'all' || t.provider === prov);
  // Totals only add up within one currency: pick the most used one unless the user chose.
  const curCount = byProv.reduce((o, t) => ((o[t.currency] = (o[t.currency] || 0) + 1), o), {});
  const currencies = Object.keys(curCount).sort((a, b) => curCount[b] - curCount[a]);
  if (!currencies.includes(CUR)) CUR = currencies[0];
  const ALL = byProv.filter((t) => t.currency === CUR);
  const TX = ALL.filter((t) => t.type !== 'credit');
  if (!TX.length) { prov = 'all'; if (byProv.length === S.tx.length) return welcome(); return render(); }

  const today = ymd(new Date());
  const months = [...new Set(TX.map((t) => t.date.slice(0, 7)))].sort().reverse();
  if (!months.includes(month)) month = months.includes(today.slice(0, 7)) ? today.slice(0, 7) : months[0];

  const inMonth = TX.filter((t) => t.date.startsWith(month));
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrent = month === today.slice(0, 7);
  const daysElapsed = isCurrent ? new Date().getDate() : daysInMonth;
  const prevKey = ymd(new Date(y, m - 2, 15)).slice(0, 7);
  const prevTotal = sum(TX.filter((t) => t.date.startsWith(prevKey) && +t.date.slice(8) <= daysElapsed));
  const monthTotal = sum(inMonth);
  const change = prevTotal ? ((monthTotal - prevTotal) / prevTotal) * 100 : null;

  const d0 = new Date(); d0.setDate(d0.getDate() - ((d0.getDay() + 1) % 7)); // week starts Saturday
  const weekStart = ymd(d0), yest = ymd(new Date(Date.now() - 864e5));
  const todayTx = TX.filter((t) => t.date === today);
  // Latest known balance per provider.
  const balances = providers.map((p) => [p, ALL.filter((t) => t.provider === p && t.balance != null).at(-1)]).filter(([, t]) => t);
  const balTotal = balances.reduce((s, [, t]) => s + t.balance, 0);

  const byDay = Array.from({ length: daysInMonth }, (_, i) => {
    const key = `${month}-${String(i + 1).padStart(2, '0')}`, items = inMonth.filter((t) => t.date === key);
    return { key, label: i + 1, total: sum(items), count: items.length };
  });
  const byMonth = [];
  for (let i = 11; i >= 0; i--) {
    const k = ymd(new Date(new Date().getFullYear(), new Date().getMonth() - i, 15)).slice(0, 7), items = TX.filter((t) => t.date.startsWith(k));
    byMonth.push({ key: k, label: monthName(k, { month: 'short' }), total: sum(items), count: items.length });
  }
  const wd = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((label) => ({ label, total: 0, count: 0 }));
  for (const t of inMonth) { const i = (new Date(t.date + 'T12:00').getDay() + 1) % 7; wd[i].total += t.amount; wd[i].count++; }

  const group = (key) => Object.values(inMonth.reduce((o, t) => {
    const k = t[key]; (o[k] ||= { name: k, total: 0, count: 0 }); o[k].total += t.amount; o[k].count++; return o;
  }, {})).sort((a, b) => b.total - a.total);
  const merchants = group('merchant').map((r) => ({ ...r, name: r.name || '(no name)' })), categories = group('cat'), byProvider = group('provider');
  const biggest = [...inMonth].sort((a, b) => b.amount - a.amount).slice(0, 5);

  // Money in: the credits each chat reported, plus top-ups worked out from the balance — a balance higher
  // than "previous balance − this payment" means money arrived in between without a message.
  const inflows = [];
  for (const p of providers) {
    const list = ALL.filter((t) => t.provider === p);
    for (let i = 0; i < list.length; i++) {
      const t = list[i], prev = list[i - 1];
      if (!t.date.startsWith(month)) continue;
      if (t.type === 'credit') inflows.push({ date: t.date, amount: t.amount, provider: p, what: t.merchant });
      else if (prev && prev.balance != null && t.balance != null) {
        const gap = t.balance - (prev.balance - t.amount);
        if (gap > 1) inflows.push({ date: t.date, amount: gap, provider: p, what: 'from balance' });
      }
    }
  }
  inflows.sort((a, b) => a.date.localeCompare(b.date));

  const q = query.toLowerCase();
  const rows = ALL.filter((t) => t.date.startsWith(month) && (!q || `${t.merchant} ${t.raw} ${t.cat} ${t.city} ${t.provider}`.toLowerCase().includes(q))).slice().reverse();

  const kpi = (label, v, s = '') => `<div class="card kpi"><div class="mute">${label}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const bars = (data, hl) => {
    const max = Math.max(1, ...data.map((d) => d.total));
    return `<div class="bars">${data.map((d) => `<div class="b ${d.total ? '' : 'zero'} ${hl(d) ? 'hl' : ''}" style="height:${(d.total / max) * 100}%"
      data-tip="${esc(d.key || d.label)} · ${fmt(d.total)} ${CUR} · ${d.count} payments"></div>`).join('')}</div>
      <div class="axis">${data.map((d, i) => `<span>${data.length > 20 && i % 2 ? '' : d.label}</span>`).join('')}</div>`;
  };
  const list = (items, total) => items.length ? items.slice(0, 8).map((r) => `<div class="row"><span class="n"><bdi>${esc(r.name)}</bdi> <span class="mute">· ${r.count}×</span></span>
    <span class="a">${A(r.total)}</span><div class="track"><i style="width:${(r.total / total) * 100}%"></i></div></div>`).join('') : '<div class="mute">Nothing this month.</div>';

  const budget = S.budget || 0, left = budget - monthTotal, pct = budget ? (monthTotal / budget) * 100 : 0;
  const synced = S.lastSync ? new Date(S.lastSync).toLocaleString() : '—';

  app.innerHTML = `
    <header>
      <div><h1>Chat Ledger</h1><div class="mute">${S.tx.length} transactions from ${providers.length} provider${providers.length > 1 ? 's' : ''} · synced ${synced}</div></div>
      <div class="tools">
        ${providers.length > 1 ? `<select id="prov"><option value="all">All providers</option>${providers.map((p) => `<option ${p === prov ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : ''}
        ${currencies.length > 1 ? `<select id="cur">${currencies.map((c) => `<option ${c === CUR ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
        <select id="month">${months.map((k) => `<option value="${k}" ${k === month ? 'selected' : ''}>${monthName(k)}</option>`).join('')}</select>
        <button class="icon" id="eye" title="Hide amounts">${S.private ? '🙈 Hidden' : '👁 Visible'}</button>
        <button class="icon" id="share">Share…</button>
        <button class="icon" id="settings" title="Settings">⚙︎</button>
        <button class="icon" id="lockbtn" title="Lock now">🔒</button>
      </div>
    </header>

    <div class="grid kpis">
      ${balances.length ? kpi(balances.length > 1 ? 'Balance (all)' : 'Balance', IQD(balTotal), balances.length > 1
        ? balances.map(([p, t]) => `${esc(p)} ${A(t.balance)}`).join(' · ')
        : `as of ${balances[0][1].date} ${balances[0][1].time}`) : kpi('Payments', String(TX.length), 'no balance in these messages')}
      ${kpi('Today', IQD(sum(todayTx)), `${todayTx.length} payment${todayTx.length === 1 ? "" : "s"} · yesterday ${A(sum(TX.filter((t) => t.date === yest)))}`)}
      ${kpi('This week', IQD(sum(TX.filter((t) => t.date >= weekStart))), 'since Saturday')}
      ${kpi(isCurrent ? 'This month' : 'Month total', IQD(monthTotal),
        change == null ? `${inMonth.length} payments` : `<span class="${change > 0 ? 'up' : 'down'}">${change > 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(0)}%</span> vs same days last month`)}
      ${kpi('Daily average', IQD(monthTotal / daysElapsed), `over ${daysElapsed} days`)}
      ${isCurrent ? kpi('Projected month', IQD((monthTotal / daysElapsed) * daysInMonth), 'at this pace') : kpi('Biggest day', IQD(Math.max(0, ...byDay.map((d) => d.total))))}
    </div>

    ${budget ? `<div class="card budget" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <span>Budget ${A(monthTotal)} / ${A(budget)} ${CUR}</span>
        <span class="${left < 0 ? 'up' : 'mute'}">${left < 0 ? `Over by ${A(-left)} ${CUR}` : `${A(left)} ${CUR} left${isCurrent ? ` · ${A(left / (daysInMonth - daysElapsed + 1))} ${CUR}/day` : ''}`}</span></div>
        <div class="track"><i style="width:${Math.min(100, pct)}%;background:${pct > 100 ? 'var(--bad)' : pct > 80 ? 'var(--warn)' : 'var(--accent)'}"></i></div></div>` : ''}

    <div class="grid two">
      <div class="card"><h2>Daily — ${monthName(month, { month: 'long' })}</h2>${bars(byDay, (d) => d.key === today)}</div>
      <div class="card"><h2>Monthly — last 12 months</h2>${bars(byMonth, (d) => d.key === month)}</div>
    </div>
    <div class="grid two">
      <div class="card"><h2>Top merchants</h2>${list(merchants, monthTotal)}</div>
      <div class="card"><h2>Categories</h2>${list(categories, monthTotal)}</div>
    </div>
    <div class="grid two">
      <div class="card"><h2>By weekday</h2>${bars(wd, () => false)}</div>
      <div class="card"><h2>Biggest payments</h2>
        ${biggest.map((t) => `<div class="row"><span class="n"><bdi>${esc(t.merchant || t.provider)}</bdi> <span class="mute">· ${t.date.slice(5)}</span></span><span class="a">${A(t.amount)}</span></div>`).join('') || '<div class="mute">—</div>'}
      </div>
    </div>
    <div class="grid two">
      <div class="card"><h2>By provider</h2>${list(byProvider, monthTotal)}</div>
      <div class="card"><h2>Money in</h2>
        ${inflows.length ? inflows.map((f) => `<div class="row"><span class="n">${f.date.slice(5)} ${ptag(f.provider)} <span class="mute"><bdi>${esc(f.what)}</bdi></span></span><span class="a in">+${A(f.amount)}</span></div>`).join('') : '<div class="mute">No money in this month.</div>'}
      </div>
    </div>

    <div class="card">
      <div class="tools" style="margin-bottom:10px"><h2 style="margin:0;flex:1">Transactions (${rows.length})</h2>
        <input id="q" placeholder="Search merchant, category, provider…" value="${esc(query)}"><button id="csv" class="ghost">Export CSV</button></div>
      <div class="tablewrap"><table>
        <thead><tr><th>Date</th><th>Time</th><th>Provider</th><th>Merchant</th><th>Category</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead>
        <tbody>${rows.map((t) => `<tr><td>${t.date}</td><td class="mute">${t.time}</td><td>${ptag(t.provider)}</td><td title="${esc(t.raw)}"><bdi>${esc(t.merchant)}</bdi> <span class="mute">${esc(t.city)}</span></td>
          <td>${t.type === 'credit' ? '<span class="tag in">Money in</span>' : `<span class="tag">${t.cat}</span>`}</td>
          <td class="num ${t.type === 'credit' ? 'in' : ''}">${t.type === 'credit' ? '+' : ''}${A(t.amount)}</td><td class="num mute">${t.balance == null ? '—' : A(t.balance)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  $('month').onchange = (e) => { month = e.target.value; render(); };
  $('prov')?.addEventListener('change', (e) => { prov = e.target.value; render(); });
  $('cur')?.addEventListener('change', (e) => { CUR = e.target.value; render(); });
  $('eye').onclick = () => { S.private = !S.private; save({ private: S.private }); document.body.classList.toggle('private', S.private); render(); };
  $('lockbtn').onclick = () => Lock.lockNow();
  $('settings').onclick = settings;
  $('share').onclick = () => share({ month, inMonth, monthTotal, daysElapsed, categories, merchants });
  $('q').oninput = (e) => { query = e.target.value; render(); const n = $('q'); n.focus(); n.setSelectionRange(query.length, query.length); };
  $('csv').onclick = () => downloadCsv(rows, `chatledger-${month}.csv`);
}

function downloadCsv(rows, name) {
  const lines = [['date', 'time', 'provider', 'type', 'merchant', 'city', 'category', 'amount', 'currency', 'balance', 'raw'],
    ...rows.map((t) => [t.date, t.time, t.provider, t.type, t.merchant, t.city, t.cat, t.amount, t.currency, t.balance ?? '', t.raw])]
    // Shop names come from outside: stop Excel/Sheets treating "=…", "+…", "@…" as formulas.
    .map((r) => r.map((v) => `"${(typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : String(v)).replace(/"/g, '""')}"`).join(','));
  download(new Blob([lines.join('\n')], { type: 'text/csv' }), name);
}
function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.addEventListener('mousemove', (e) => {
  const t = !S.private && e.target.closest?.('[data-tip]');
  tip.style.display = t ? 'block' : 'none';
  if (t) { tip.textContent = t.dataset.tip; tip.style.left = e.clientX + 12 + 'px'; tip.style.top = e.clientY + 12 + 'px'; }
});

// ---------------- share: you pick what leaves ----------------
function share(ctx) {
  const opt = { total: true, average: true, categories: true, merchants: false, percentOnly: false };
  modal.innerHTML = `<div class="panel"><h1>Share ${monthName(ctx.month)}</h1>
    <div class="share">
      <div>
        <p class="mute" style="margin-top:0">Choose what goes on the card. Nothing is shared until you download or copy it.</p>
        <label><input type="checkbox" data-k="total" checked> Total spent</label>
        <label><input type="checkbox" data-k="average" checked> Daily average</label>
        <label><input type="checkbox" data-k="categories" checked> Categories</label>
        <label><input type="checkbox" data-k="merchants"> Top shops (names)</label>
        <label><input type="checkbox" data-k="percentOnly"> Percentages only — hide amounts</label>
        <div class="tools" style="margin-top:16px">
          <button id="png">Download image</button><button id="txt" class="ghost">Copy text</button>
          <button id="close" class="ghost">Close</button>
        </div>
        <div class="msg" id="smsg"></div>
      </div>
      <canvas id="card" width="900" height="1100"></canvas>
    </div></div>`;
  modal.hidden = false;
  const draw = () => drawCard(document.getElementById('card'), ctx, opt);
  modal.querySelectorAll('[data-k]').forEach((c) => (c.onchange = () => { opt[c.dataset.k] = c.checked; draw(); }));
  document.getElementById('close').onclick = () => (modal.hidden = true);
  document.getElementById('png').onclick = () => document.getElementById('card').toBlob((b) => download(b, `spending-${ctx.month}.png`));
  document.getElementById('txt').onclick = async () => {
    await navigator.clipboard.writeText(shareText(ctx, opt));
    document.getElementById('smsg').textContent = 'Copied.';
  };
  draw();
}

function shareLines(ctx, opt) {
  const v = (n) => `${fmt(n)} ${CUR}`;
  const pc = (n) => `${Math.round((n / ctx.monthTotal) * 100)}%`;
  const out = { stats: [], cats: [], shops: [] };
  if (opt.total && !opt.percentOnly) out.stats.push(['Total spent', v(ctx.monthTotal)]);
  if (opt.average && !opt.percentOnly) out.stats.push(['Per day', v(ctx.monthTotal / ctx.daysElapsed)]);
  if (opt.categories) out.cats = ctx.categories.slice(0, 6).map((c) => [c.name, opt.percentOnly ? pc(c.total) : v(c.total), c.total / ctx.monthTotal]);
  if (opt.merchants) out.shops = ctx.merchants.slice(0, 5).map((c) => [c.name, opt.percentOnly ? pc(c.total) : v(c.total), c.total / ctx.monthTotal]);
  return out;
}

function shareText(ctx, opt) {
  const l = shareLines(ctx, opt);
  return [`My spending — ${monthName(ctx.month)}`, ...l.stats.map(([a, b]) => `${a}: ${b}`),
    l.cats.length ? '\nCategories' : '', ...l.cats.map(([a, b]) => `• ${a}: ${b}`),
    l.shops.length ? '\nTop shops' : '', ...l.shops.map(([a, b]) => `• ${a}: ${b}`)].filter(Boolean).join('\n');
}

function drawCard(cv, ctx, opt) {
  const W = cv.width, P = 60, l = shareLines(ctx, opt);
  const sec = (items) => (items.length ? 56 + items.length * 76 : 0);
  cv.height = Math.max(500, 210 + l.stats.length * 110 + sec(l.cats) + sec(l.shops) + 90); // resizing clears, so size first
  const g = cv.getContext('2d');
  g.fillStyle = '#0e1214'; g.fillRect(0, 0, W, cv.height);
  g.fillStyle = '#25d366'; g.fillRect(0, 0, W, 10);
  g.textBaseline = 'top';
  let y = 70;
  g.fillStyle = '#8a99a3'; g.font = '600 26px -apple-system, system-ui, sans-serif'; g.fillText('MY SPENDING', P, y);
  y += 40; g.fillStyle = '#e6ecef'; g.font = '700 54px -apple-system, system-ui, sans-serif'; g.fillText(monthName(ctx.month), P, y);
  y += 100;
  for (const [k, v] of l.stats) {
    g.fillStyle = '#8a99a3'; g.font = '26px -apple-system, system-ui, sans-serif'; g.fillText(k, P, y);
    g.fillStyle = '#e6ecef'; g.font = '700 46px -apple-system, system-ui, sans-serif'; g.fillText(v, P, y + 34); y += 110;
  }
  const section = (title, items) => {
    if (!items.length) return;
    y += 10; g.fillStyle = '#8a99a3'; g.font = '600 24px -apple-system, system-ui, sans-serif'; g.fillText(title.toUpperCase(), P, y); y += 46;
    for (const [name, val, frac] of items) {
      g.fillStyle = '#e6ecef'; g.font = '28px -apple-system, system-ui, sans-serif';
      let n = name; while (g.measureText(n).width > W - 2 * P - 220 && n.length > 4) n = n.slice(0, -2);
      g.fillText(n === name ? n : n + '…', P, y);
      g.textAlign = 'right'; g.fillText(val, W - P, y); g.textAlign = 'left';
      g.fillStyle = '#26313a'; g.fillRect(P, y + 42, W - 2 * P, 10);
      g.fillStyle = '#25d366'; g.fillRect(P, y + 42, (W - 2 * P) * Math.min(1, frac), 10);
      y += 76;
    }
  };
  section('Categories', l.cats);
  section('Top shops', l.shops);
  g.fillStyle = '#8a99a3'; g.font = '22px -apple-system, system-ui, sans-serif'; g.fillText('Chat Ledger', P, cv.height - 60);
}

// ---------------- settings ----------------
async function settings() {
  const lock = (await Lock.get()) || { off: true };
  const on = !lock.off && lock.pinHash;
  modal.innerHTML = `<div class="panel settings" style="max-width:520px"><h1>Settings</h1>
    <h2>Chats</h2>
    <div id="src"></div>
    <h2 style="margin-top:20px">General</h2>
    <div class="row"><span>Monthly budget (${CUR})</span><input id="budget" type="number" min="0" value="${S.budget || ''}" placeholder="none" style="width:150px"></div>
    <div class="row"><span>Blur the dashboard when I switch away or leave it idle for 5 minutes</span><input id="shieldsw" type="checkbox" ${S.shield !== false ? 'checked' : ''}></div>
    <div class="row"><span>Sync automatically when WhatsApp Web is open</span><input id="auto" type="checkbox" ${S.autoSync !== false ? 'checked' : ''}></div>
    <h2 style="margin-top:20px">Lock</h2>
    ${on ? `
      <div class="row"><span>Lock after idle (minutes)</span><input id="idle" type="number" min="1" max="120" value="${lock.autoLockMin || 5}" style="width:80px"></div>
      <div class="tools" style="margin-bottom:14px">
        <button class="ghost" id="pin">Change PIN</button>
        ${Lock.passkeySupported() ? (lock.credId ? '<button class="ghost" id="rmpk">Remove passkey</button>' : '<button class="ghost" id="addpk">Add passkey</button>') : ''}
        <button class="ghost" id="off">Turn lock off</button>
      </div>` : '<div class="tools" style="margin-bottom:14px"><button id="pin">Set up a PIN lock</button></div>'}
    <h2 style="margin-top:20px">Your data</h2>
    <p class="mute" style="margin-top:0">${S.tx.length} transactions, stored only in this browser. Only date, amount, shop, provider and balance are kept — never the message text.</p>
    <div class="tools"><button class="ghost" id="all">Export everything (CSV)</button><button class="danger" id="wipe">Delete all data</button></div>
    <div class="tools" style="margin-top:20px;justify-content:flex-end"><button id="close">Done</button></div>
  </div>`;
  modal.hidden = false;
  sourcesEditor(document.getElementById('src'));
  const $ = (id) => document.getElementById(id);
  $('budget').onchange = (e) => { S.budget = Number(e.target.value) || 0; save({ budget: S.budget }); render(); };
  $('shieldsw').onchange = (e) => { S.shield = e.target.checked; save({ shield: S.shield }); };
  $('auto').onchange = (e) => { S.autoSync = e.target.checked; save({ autoSync: S.autoSync }); };
  $('idle')?.addEventListener('change', async (e) => { const l = await Lock.get(); l.autoLockMin = Math.max(1, +e.target.value || 5); await Lock.put(l); });
  $('pin').onclick = () => { modal.hidden = true; Lock.setupScreen(false); };
  $('addpk')?.addEventListener('click', () => { modal.hidden = true; Lock.passkeyOffer(); });
  $('rmpk')?.addEventListener('click', async () => { await Lock.removePasskey(); settings(); });
  $('off')?.addEventListener('click', async () => { await Lock.put({ off: true }); settings(); });
  $('all').onclick = () => downloadCsv(S.tx.slice().reverse(), 'chatledger-all.csv');
  $('wipe').onclick = (e) => {
    if (e.target.dataset.sure) return chrome.storage.local.clear().then(() => location.reload());
    e.target.dataset.sure = 1; e.target.textContent = 'Click again to delete everything';
  };
  $('close').onclick = () => (modal.hidden = true);
}

modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

// ---------------- privacy shield ----------------
// Blurs the whole page the moment you switch tab/window, or after 5 minutes without activity.
// Click or press any key to show it again. Turn it off in Settings.
const shieldEl = document.getElementById('shield');
const SHIELD_IDLE = 5 * 60e3;
let shieldTimer;
const shieldOn = () => unlocked && S.shield !== false && document.getElementById('lock').hidden;
function raiseShield() { if (shieldOn()) shieldEl.hidden = false; }
function dropShield() { shieldEl.hidden = true; armShield(); }
function armShield() { clearTimeout(shieldTimer); if (shieldOn()) shieldTimer = setTimeout(raiseShield, SHIELD_IDLE); }
['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach((e) => addEventListener(e, () => shieldEl.hidden && armShield(), { passive: true }));
addEventListener('blur', raiseShield);
document.addEventListener('visibilitychange', () => document.hidden && raiseShield());
shieldEl.addEventListener('click', dropShield);
addEventListener('keydown', (e) => { if (!shieldEl.hidden) { e.preventDefault(); dropShield(); } });

Lock.init(
  async () => { unlocked = true; await load(); render(); banner(); shieldEl.hidden = true; armShield(); },
  () => { unlocked = false; shieldEl.hidden = true; clearTimeout(shieldTimer); app.innerHTML = ''; bannerEl.innerHTML = ''; modal.hidden = true; modal.innerHTML = ''; },
);
