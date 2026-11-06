// Dashboard lock: a PIN (always, as the fallback) plus an optional passkey (Touch ID / Windows Hello / phone).
// Nothing is rendered until it's unlocked; it locks again when idle or when the tab is left in the background.
const Lock = (() => {
  const enc = new TextEncoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

  const get = async () => (await chrome.storage.local.get('lock')).lock || null;
  const put = (lock) => chrome.storage.local.set({ lock });

  async function hash(pin, salt) {
    const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: 250000 }, key, 256));
  }
  async function setPin(pin) {
    const lock = (await get()) || {};
    lock.salt = b64(rand(16));
    lock.pinHash = await hash(pin, lock.salt);
    lock.off = false;
    lock.autoLockMin ??= 5;
    await put(lock);
  }
  const checkPin = async (pin) => { const l = await get(); return !!l?.pinHash && (await hash(pin, l.salt)) === l.pinHash; };

  const passkeySupported = () => !!window.PublicKeyCredential;
  async function addPasskey() {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: rand(32),
      rp: { name: 'Chat Ledger' },
      user: { id: rand(16), name: 'Chat Ledger', displayName: 'Chat Ledger' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    } });
    const lock = await get();
    lock.credId = b64(cred.rawId);
    await put(lock);
  }
  async function checkPasskey() {
    const l = await get();
    await navigator.credentials.get({ publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: 'public-key', id: unb64(l.credId) }],
      userVerification: 'required',
      timeout: 60000,
    } });
    return true;
  }
  async function removePasskey() { const l = await get(); delete l.credId; await put(l); }

  // ---- screens ----
  const el = document.getElementById('lock');
  let onUnlock = () => {}, onLock = () => {};
  let fails = 0, blockedUntil = 0;

  function show(html) { el.innerHTML = `<div class="lockbox">${html}</div>`; el.hidden = false; }
  const msg = (t, bad = true) => { const m = el.querySelector('.msg'); if (m) { m.textContent = t; m.className = 'msg' + (bad ? ' bad' : ''); } };

  function setupScreen(firstTime) {
    show(`<div class="lockicon">🔒</div><h1>${firstTime ? 'Keep your spending private' : 'Change PIN'}</h1>
      <p class="mute">Choose a PIN or password (4+ characters) to lock this dashboard. ${firstTime ? 'You can add Touch ID or a passkey next.' : ''}</p>
      <input id="p1" type="password" autocomplete="new-password" placeholder="PIN or password">
      <input id="p2" type="password" autocomplete="new-password" placeholder="Repeat it">
      <label class="mute" style="display:flex;gap:6px;justify-content:center;cursor:pointer"><input id="showpw" type="checkbox" style="width:auto"> Show</label>
      <div class="msg"></div>
      <button id="save" disabled>Save PIN</button>
      ${firstTime ? '<button id="skip" class="ghost">Not now</button>' : '<button id="cancel" class="ghost">Cancel</button>'}`);
    const p1 = el.querySelector('#p1'), p2 = el.querySelector('#p2'), save = el.querySelector('#save');
    p1.focus();
    // Live feedback while typing, so it's clear why Save isn't ready yet.
    const check = () => {
      const a = p1.value, b = p2.value;
      const problem = a.length < 4 ? (a ? 'At least 4 characters.' : '') : !b ? 'Now repeat it below.' : a !== b ? "Doesn't match yet." : '';
      save.disabled = !!problem || !a;
      msg(problem || (a ? '✓ Matches' : ''), !!problem && b.length >= a.length);
      return !save.disabled;
    };
    p1.oninput = p2.oninput = check;
    el.querySelector('#showpw').onchange = (e) => { p1.type = p2.type = e.target.checked ? 'text' : 'password'; };
    save.onclick = async () => {
      if (!check()) return;
      save.disabled = true; save.textContent = 'Saving…';
      await setPin(p1.value);
      passkeySupported() ? passkeyOffer() : done();
    };
    p1.onkeydown = (e) => { if (e.key === 'Enter') p2.focus(); }; // braces: returning false would block typing
    p2.onkeydown = (e) => { if (e.key === 'Enter') save.click(); }; // braces: returning false would block typing
    el.querySelector('#skip')?.addEventListener('click', async () => { await put({ off: true }); done(); });
    el.querySelector('#cancel')?.addEventListener('click', done);
  }

  function passkeyOffer() {
    show(`<div class="lockicon">👆</div><h1>Unlock faster?</h1>
      <p class="mute">Use Touch ID, Windows Hello or your phone instead of typing the PIN. The PIN still works as a backup.</p>
      <div class="msg"></div>
      <button id="add">Add passkey</button><button id="no" class="ghost">Just the PIN</button>`);
    el.querySelector('#add').onclick = async () => {
      try { await addPasskey(); done(); } catch (e) { msg("Couldn't add a passkey on this device. The PIN is set."); }
    };
    el.querySelector('#no').onclick = done;
  }

  async function lockedScreen() {
    const l = await get();
    show(`<div class="lockicon">🔒</div><h1>Chat Ledger is locked</h1>
      ${l.credId ? '<button id="pk">Unlock with passkey</button><div class="or">or</div>' : ''}
      <input id="pin" type="password" autocomplete="current-password" placeholder="PIN or password">
      <div class="msg"></div>
      <button id="go" class="${l.credId ? 'ghost' : ''}">Unlock</button>
      <button id="forgot" class="link">Forgot PIN?</button>`);
    const pin = el.querySelector('#pin');
    if (!l.credId) pin.focus();
    el.querySelector('#pk')?.addEventListener('click', async () => {
      try { await checkPasskey(); done(); } catch { msg('Passkey cancelled — use your PIN.'); }
    });
    const tryPin = async () => {
      // Failed tries are kept in storage, so reloading the page doesn't reset the wait.
      ({ fails = 0, blockedUntil = 0 } = (await chrome.storage.local.get('pinGuard')).pinGuard || {});
      if (Date.now() < blockedUntil) return msg(`Too many tries. Wait ${Math.ceil((blockedUntil - Date.now()) / 1000)}s.`);
      const ok = await checkPin(pin.value);
      pin.value = '';
      if (ok) { await chrome.storage.local.remove('pinGuard'); return done(); }
      if (++fails >= 5) blockedUntil = Date.now() + 30000 * 2 ** Math.min(fails - 5, 6);
      await chrome.storage.local.set({ pinGuard: { fails, blockedUntil } });
      msg(fails >= 5 ? `Too many tries. Wait ${Math.ceil((blockedUntil - Date.now()) / 1000)}s.` : 'Wrong PIN.');
    };
    el.querySelector('#go').onclick = tryPin;
    pin.onkeydown = (e) => { if (e.key === 'Enter') tryPin(); }; // braces: returning false would block typing
    el.querySelector('#forgot').onclick = () => {
      show(`<h1>Reset everything?</h1>
        <p class="mute">This erases your saved purchases and the lock on this computer. Your WhatsApp messages aren't touched — open WhatsApp Web and they're read again.</p>
        <button id="erase" class="danger">Erase and reset</button><button id="back" class="ghost">Back</button>`);
      el.querySelector('#erase').onclick = async () => { await chrome.storage.local.clear(); location.reload(); };
      el.querySelector('#back').onclick = lockedScreen;
    };
  }

  function done() { el.hidden = true; el.innerHTML = ''; armIdle(); onUnlock(); }

  async function lockNow() {
    const l = await get();
    if (!l || l.off) return;
    onLock();
    lockedScreen();
  }

  // ---- auto-lock ----
  let idleTimer, hiddenTimer;
  async function armIdle() {
    clearTimeout(idleTimer);
    const l = await get();
    if (!l || l.off || !el.hidden) return;
    idleTimer = setTimeout(lockNow, (l.autoLockMin || 5) * 60e3);
  }
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((e) => addEventListener(e, () => el.hidden && armIdle(), { passive: true }));
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenTimer);
    if (document.hidden) hiddenTimer = setTimeout(lockNow, 60e3);
  });

  async function init(unlocked, locked) {
    onUnlock = unlocked; onLock = locked;
    const l = await get();
    if (!l) setupScreen(true);
    else if (l.off) done();
    else lockedScreen();
  }

  return { init, lockNow, get, put, setupScreen, passkeyOffer, removePasskey, passkeySupported };
})();
