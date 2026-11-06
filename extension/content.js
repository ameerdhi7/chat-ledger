// Runs inside WhatsApp Web. It only opens and reads the chats you named in the dashboard, and it
// can't send anything anywhere: the extension has no network permission. Transactions go to
// chrome.storage.local, each tagged with the provider name you gave its chat.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const waitFor = async (fn, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) { const v = fn(); if (v) return v; }
    return null;
  };
  const getSources = async () => (await chrome.storage.local.get('sources')).sources || [];
  let busy = false, retries = 0;

  // Small status pill — shows counts only, never amounts.
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    .p{position:fixed;left:14px;bottom:14px;z-index:2147483647;display:flex;gap:8px;align-items:center;
       background:#111b21;color:#e9edef;border:1px solid #2a3942;border-radius:20px;padding:6px 8px 6px 12px;
       font:12px -apple-system,system-ui,sans-serif;box-shadow:0 4px 14px #0006}
    button{background:#25d366;color:#04210f;border:0;border-radius:14px;padding:4px 10px;font:600 12px inherit;cursor:pointer}
    button:disabled{opacity:.5;cursor:default}</style>
    <div class="p"><span id="s">Chat Ledger</span><button id="b">Sync</button></div>`;
  const status = shadow.getElementById('s'), btn = shadow.getElementById('b');
  const say = (t) => (status.textContent = t);
  btn.onclick = () => sync();

  // Chat names are compared without emoji, punctuation or direction marks.
  const norm = (s) => (s || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const like = (title, chat) => { const a = norm(title), b = norm(chat); return !!b && a.includes(b); };
  // The chat name is the header's first line (its span[title] is a "contact info" tooltip).
  const headerName = () => ($('#main header')?.innerText || '').split('\n')[0];
  const isOpen = (chat) => like(headerName(), chat);
  const findInList = (chat) => {
    const all = [...document.querySelectorAll('#pane-side span[title]')].filter((s) => like(s.title, chat));
    return all.find((s) => norm(s.title) === norm(chat)) || all[0];
  };
  // WhatsApp reacts to pointer events, so send the full sequence at the element's centre.
  const press = (el) => {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o)); el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
  };
  // The search box has been both a contenteditable and a plain <input>; handle either.
  const searchBox = () => $('#side input[type="text"], #side input:not([type]), #side [contenteditable="true"]');
  function typeSearch(text) {
    const box = searchBox();
    if (!box) return false;
    box.focus();
    if (box.tagName === 'INPUT') {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('selectAll');
      text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
    }
    return true;
  }

  async function openChat(chat) {
    if (isOpen(chat)) return true;
    // Right after logging in the chat list can still be empty — give it time to fill.
    await waitFor(() => document.querySelectorAll('#pane-side span[title]').length > 3, 30000);
    let el = findInList(chat);
    if (!el && typeSearch(chat)) el = await waitFor(() => findInList(chat), 15000);
    if (!el) return false;
    press(el);
    const ok = !!(await waitFor(() => isOpen(chat), 8000));
    typeSearch('');
    return ok;
  }

  // Incoming messages only — anything you type into the chat yourself is ignored.
  const readVisible = () => [...document.querySelectorAll('#main [data-pre-plain-text]')].filter((el) => !el.closest('.message-out')).map((el) => ({
    pre: el.getAttribute('data-pre-plain-text'),
    text: (el.querySelector('.selectable-text') || el).innerText,
  }));

  function scrollUp() {
    let el = $('#main [data-pre-plain-text]');
    while (el && !(el.scrollHeight > el.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    if (el) el.scrollTop = 0;
    const older = [...document.querySelectorAll('#main button, #main [role="button"]')].find((b) => /older messages/i.test(b.innerText));
    if (older) older.click();
  }

  const parseAll = (raw, src) => {
    const order = TT.dateOrder(raw.map((m) => m.pre));
    return raw.map((m) => TT.parse(m.text, m.pre, order, src.label, src.chat)).filter(Boolean);
  };

  // passive=true when picking up messages you're viewing yourself: that doesn't count as a sync.
  async function merge(found, passive = false) {
    const { tx = [] } = await chrome.storage.local.get('tx');
    const map = new Map(tx.map((t) => [TT.key(t), t]));
    for (const t of found) if (!map.has(TT.key(t))) map.set(TT.key(t), t);
    const all = TT.resolve(TT.sort([...map.values()]));
    await chrome.storage.local.set(passive ? { tx: all } : { tx: all, lastSync: Date.now() });
    return all.length - tx.length;
  }

  // Reads one chat. Until one sync has scrolled to its first message, always goes to the top;
  // after that it stops as soon as it reaches a transaction it already has.
  async function readChat(src, n, of) {
    await waitFor(() => $('#main [data-pre-plain-text]'), 15000);
    const { tx = [], history = {} } = await chrome.storage.local.get(['tx', 'history']);
    const known = new Set(tx.filter((t) => t.provider === src.label).map(TT.key));
    const raw = new Map();
    let reachedTop = false;
    for (let round = 1, stale = 0; stale < 8 && round < 500; round++) {
      const before = raw.size;
      for (const m of readVisible()) raw.set(m.pre + m.text, m);
      say(`${src.label} (${n}/${of}) · ${raw.size} messages`);
      if (history[src.label] && round > 1 && parseAll([...raw.values()], src).some((t) => known.has(TT.key(t)))) break;
      stale = raw.size === before ? stale + 1 : 0;
      if (stale >= 8) reachedTop = true;
      scrollUp();
      await sleep(1500);
    }
    const found = parseAll([...raw.values()], src);
    const added = await merge(found);
    if (reachedTop) await chrome.storage.local.set({ history: { ...history, [src.label]: true } });
    return { added, found: found.length };
  }

  async function sync() {
    if (busy) return;
    const sources = await getSources();
    if (!sources.length) { say('Chat Ledger · add a chat in the dashboard'); return beat('noSources'); }
    busy = true; btn.disabled = true;
    const hadChat = !!$('#main header');
    const missing = [], empty = [];
    let added = 0;
    try {
      for (const [i, src] of sources.entries()) {
        say(`Opening ${src.label}…`);
        if (!(await openChat(src.chat))) { missing.push(src.label); continue; }
        const r = await readChat(src, i + 1, sources.length);
        added += r.added;
        if (!r.found) empty.push(src.label);
      }
      const { tx = [] } = await chrome.storage.local.get('tx');
      say(missing.length ? `⚠ Not found: ${missing.join(', ')}` : `✓ ${added} new · ${tx.length} transactions`);
      beat(missing.length ? 'noChat' : 'ok', { missing, empty });
      // Chats may still be arriving right after linking WhatsApp — try the missing ones again.
      if (missing.length && ++retries < 6) setTimeout(sync, 2 * 60e3);
      if (!hadChat) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch (e) {
      say('Sync failed — try again');
      console.warn('[Chat Ledger]', e);
    } finally {
      busy = false; btn.disabled = false;
    }
  }

  // While you have one of your chats open yourself, new transactions are picked up live.
  let pending = null;
  new MutationObserver(() => {
    if (busy || pending || !$('#main header')) return;
    pending = setTimeout(async () => {
      pending = null;
      const src = (await getSources()).find((s) => isOpen(s.chat));
      if (!busy && src) await merge(parseAll(readVisible(), src), true);
    }, 2000);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Heartbeat so the dashboard can warn when WhatsApp Web is closed, logged out, or a chat is missing.
  let state = 'loading', detail = {};
  const beat = (s = state, d = detail) => { state = s; detail = d; return chrome.storage.local.set({ wa: { state, ...detail, at: Date.now() } }).catch(() => {}); };
  beat();
  setInterval(() => beat(), 30e3);

  // A chat added or renamed in the dashboard gets synced straight away.
  chrome.storage.onChanged.addListener((c) => { if (c.sources && $('#pane-side')) { retries = 0; sync(); } });

  // Automatic sync: once WhatsApp has loaded, then hourly while the tab sits in the background.
  (async () => {
    // Logged out only if the QR code is showing; otherwise WhatsApp is still loading chats (can take minutes after linking).
    const qr = () => $('canvas[aria-label*="scan" i], [data-ref] canvas, [data-ref]');
    const ready = await waitFor(() => {
      if ($('#pane-side')) return true;
      const s = qr() ? 'loggedOut' : 'loading';
      if (s !== state) beat(s);
      return false;
    }, 60 * 60e3);
    if (!ready) return;
    beat('ok');
    document.body.appendChild(host);
    const { autoSync = true, lastSync = 0 } = await chrome.storage.local.get(['autoSync', 'lastSync']);
    if (autoSync && Date.now() - lastSync > 10 * 60e3) { await sleep(3000); sync(); }
    else say('Chat Ledger · synced');
    setInterval(async () => {
      const { autoSync = true } = await chrome.storage.local.get('autoSync');
      if (autoSync && document.hidden) sync();
    }, 60 * 60e3);
  })();
})();
