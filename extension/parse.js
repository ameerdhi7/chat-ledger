// Turns a WhatsApp Web message into a transaction. Plain regex — no AI, no network.
// Known providers get an exact template (see PROVIDERS); every other chat goes through a
// generic reader that understands English and Arabic bank / wallet alerts.
const TT = (() => {
  const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
  const CUR = String.raw`IQD|USD|EUR|GBP|AED|SAR|KWD|QAR|BHD|OMR|JOD|LBP|SYP|TRY|EGP|IRR|Dinars?|Dollars?|\$|€|£|₺|د\.?\s?ع\.?|دينار(?: عراقي)?|دینار|دولار|يورو|ريال|ليرة|درهم`;
  const CODE = [['IQD', /IQD|dinar|د\.?\s?ع|دينار|دینار/i], ['USD', /USD|dollar|\$|دولار/i], ['EUR', /EUR|€|يورو/i], ['GBP', /GBP|£/i],
    ['TRY', /TRY|₺|ليرة/i], ['AED', /AED|درهم/i], ['SAR', /SAR|ريال/i]];
  const curOf = (s, fallback = 'IQD') => (s ? (CODE.find(([, r]) => r.test(s)) || [s.toUpperCase()])[0] : fallback);
  const num = (s) => Number(String(s).replace(/,/g, ''));
  const IQ = String.raw`(?:IQD|د\.?\s?ع|دينار|دینار|dinar)`;
  // Arabic-Indic and Persian digits → 0-9, Arabic thousands/decimal marks → , and .
  // Then every thousands style becomes "1,234,567.89": "15 000", "1.234.567", "1.234,56", "15.000 IQD".
  const western = (s) => String(s)
    .replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0)
    .replace(/٬/g, ',').replace(/٫/g, '.').replace(/[‎‏‪-‮]/g, '')
    .replace(/[^\S\n]+/g, ' ').replace(/ *\n[\s]*/g, '\n').trim()
    .replace(/\b(\d{1,3}(?:\.\d{3})+),(\d{1,2})\b/g, (_, a, b) => `${a.replace(/\./g, ',')}.${b}`)
    .replace(/\b\d{1,3}(?:\.\d{3}){2,}\b/g, (m) => m.replace(/\./g, ','))
    .replace(/\b\d{1,3}(?:[   ]\d{3})+\b/g, (m) => m.replace(/\D/g, ''))
    .replace(new RegExp(String.raw`\b(\d{1,3})\.(\d{3})(?=\s?${IQ})`, 'gi'), '$1,$2')
    .replace(new RegExp(String.raw`(${IQ}\s?)(\d{1,3})\.(\d{3})\b(?!\.\d)`, 'gi'), '$1$2,$3');

  // ---- exact templates for providers we have real samples of. PRs welcome: add yours here. ----
  const PROVIDERS = [
    {
      name: 'Tabadul',
      chat: /tabadul|تبادل/i,
      rules: [{
        type: 'debit',
        re: /Purchase of ([\d,]+(?:\.\d+)?) (IQD|USD) made on your wallet card, at \((.*)\)\.\s*Remaining Balance:\s*([\d,]+(?:\.\d+)?)/i,
        pick: (m) => ({ amount: m[1], currency: m[2], raw: m[3], balance: m[4] }),
      }],
    },
  ];

  // ---- generic reader ----
  const AMOUNT = new RegExp(String.raw`(?:(${CUR})\s?(${NUM})|(${NUM})\s?(${CUR}))`, 'gi');
  // An amount with no currency next to it still counts when a label says it's the amount.
  const LABELLED = new RegExp(String.raw`(?:\bamount|\bamt\.?|\bvalue|\btotal|\bsum|بمبلغ|بقيمة|المبلغ|مبلغ|قيمة|بڕی|بری)\s*[:：=]?\s*(?:(${CUR})\s?)?(${NUM})`, 'i');
  const BALANCE = new RegExp(String.raw`(?:balance|\bbal\.?|available|avail\.?|الرصيد|رصيدك|رصيد|باڵانس|ڕەسید|رەسید)[^\d\n]{0,30}?(?:(${CUR})\s?)?(${NUM})`, 'i');
  // English, Arabic and Kurdish (Sorani) words for money in / money out. The earliest one wins.
  const CREDIT = new RegExp([
    String.raw`\b(?:received|receive|credited|credit(?! card)|deposit(?:ed)?|top.?up|topped up|refund(?:ed)?|reversal|reversed|cash.?back|salary|incoming|added|loaded|cash.?in|transfer(?:red)? from|inward|Cr)\b`,
    'إيداع|ايداع|استلام|استلمت|تم استلام|وارد|واردة|إضافة|اضافة|أضيف|اضيف|استرجاع|استرداد|راتب|تعبئة|شحن|دائن',
    'وەرگیرا|وەرگرت|وەرگرتن|زیادکرا|زیاد کرا|خرایە سەر|دانرا',
  ].join('|'), 'i');
  const DEBIT = new RegExp([
    String.raw`\b(?:purchased?|paid|pay|payment|spent|debit(?:ed)?|withdraw(?:al|n)?|deducted|charged|sent|transfer(?:red)? to|bill|POS|ATM|cash.?out|bought|used|outward|Dr)\b`,
    'شراء|مشتريات|دفع|سحب|خصم|ارسال|إرسال|تحويل إلى|تحويل الى|تحويل صادر|حوالة صادرة|صادر|مدين|تسديد',
    'کڕین|کڕی|پارەدان|پارەدرا|ڕاکێشان|ڕاکێشرا|نارد|نێردرا|بڕدرا',
  ].join('|'), 'i');
  // Not money that moved: codes, and payments that failed.
  const NOISE = /\b(OTP|one.?time|verification code|passcode|login|declined|failed|unsuccessful|rejected|insufficient)\b|رمز التحقق|كلمة المرور|رمز الدخول|مرفوضة|مرفوض|فشل|لم تتم|غير ناجحة|رصيد غير كاف|کۆدی/i;
  const STOP = String.raw`(?=\s+(?:on|for|with|via|ref|balance|remaining|available|amount|date|card)\b|\s+\p{L}[\p{L} ]{0,20}\s*[:：]|[.,;](?:\s|$)|\n|$)`;
  const PARTY = [
    /\bat \(([^)]+)\)/i,
    new RegExp(String.raw`(?:merchant|store|shop|beneficiary|payee|recipient|sender|from|to|at|description|details|التاجر|المتجر|المستفيد|المرسل|المرسل إليه|الجهة|التفاصيل|بازرگان|نێرەر|وەرگر)\s*[:：-]\s*([^\n]+?)${STOP}`, 'iu'),
    new RegExp(String.raw`\b(?:at|to|from|@)\s+((?:(?!\b(?:at|to|from)\s)[^\n])+?)${STOP}`, 'iu'),
    /(?:لدى|في|إلى|الى|من|لـ)\s+([^\n]+?)(?=\s+(?:بمبلغ|بقيمة|الرصيد|رصيد|بتاريخ|المبلغ)|[.,،؛](?:\s|$)|\n|$)/,
    /(?:لە|بۆ)\s+([^\n]+?)(?=\s+(?:بڕی|باڵانس)|[.,،؛](?:\s|$)|\n|$)/,
  ];
  const NOT_PARTY = /^(your|you|card|account|wallet|the|a|حسابك|بطاقتك|حساب|بطاقة|محفظتك|تاريخ|هەژمارەکەت)(?:\s|$)|^[\d\s/:.-]+$/i;

  function generic(text) {
    if (NOISE.test(text)) return null;
    const bal = BALANCE.exec(text);
    const balAt = bal ? bal.index + bal[0].length - bal[2].length : -1;
    let amount, currency;
    for (const m of text.matchAll(AMOUNT)) {
      const at = m.index + m[0].indexOf(m[2] || m[3]);
      if (at !== balAt) { [amount, currency] = [m[2] || m[3], m[1] || m[4]]; break; }
    }
    if (!amount) {
      const l = LABELLED.exec(text);
      if (l && l.index + l[0].length - l[2].length !== balAt) [amount, currency] = [l[2], l[1] || bal?.[1]];
    }
    if (!amount) return null;
    // Direction: a +/− sign on the amount, else the earliest money-in / money-out word.
    // No word at all → type null; resolve() settles it from the balance or calls it a payment.
    const sign = new RegExp(String.raw`([+\-−])\s?(?:${CUR})?\s?${amount.replace(/[.$]/g, '\\$&')}`, 'i').exec(text)?.[1];
    const c = CREDIT.exec(text), d = DEBIT.exec(text);
    let type = sign ? (sign === '+' ? 'credit' : 'debit') : c && (!d || c.index < d.index) ? 'credit' : d ? 'debit' : null;
    // A message with no direction word and no balance is too likely to be an ad ("win 1,000,000 IQD!").
    if (!type && !bal) return null;
    let raw = '';
    const clean = text.replace(AMOUNT, ' ');
    // First pattern with a usable name wins; inside a pattern, skip hits like "to your account".
    find: for (const re of PARTY) {
      for (const p of clean.matchAll(new RegExp(re.source, re.flags + 'g'))) {
        const v = p[1].trim().replace(/^[(\[]|[)\]]$/g, '');
        if (/\p{L}/u.test(v) && !NOT_PARTY.test(v) && v.length <= 60) { raw = v; break find; }
      }
    }
    return { type, amount, currency, raw, balance: bal ? bal[2] : null };
  }

  // Settle transactions whose message had no direction word, using the provider's balance trail:
  // balance went down → payment, up → money in. Without a balance to compare, it's a payment.
  function resolve(list) {
    const last = {};
    for (const t of sort(list)) {
      if (!t.type) {
        const prev = last[t.provider];
        t.type = prev != null && t.balance != null && t.balance > prev ? 'credit' : 'debit';
      }
      if (t.balance != null) last[t.provider] = t.balance;
    }
    return list;
  }

  function splitMerchant(raw) {
    const parts = raw.split('>').map((s) => s.trim()).filter(Boolean);
    const merchant = (parts[0] || raw).replace(/\s+/g, ' ').trim();
    const c = parts.find((p, i) => i > 0 && /^[a-z .'-]+$/i.test(p) && !/^(IRQ|IR|IQ)$/i.test(p)) || '';
    return { merchant, city: c ? c[0].toUpperCase() + c.slice(1).toLowerCase() : '' };
  }

  // ---- WhatsApp's hidden label on every message: "[10:23 AM, 11/4/2026] Name: " ----
  const PRE = /^\[(\d{1,2}):(\d{2})(?::\d{2})?(?:[^\d,،\]]{0,4}?([AP]M|ص|م))?[,،]\s*(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\]/i;
  const pad = (n) => String(n).padStart(2, '0');

  // Is the date day/month or month/day? Decide from the whole batch, then the browser language.
  function dateOrder(pres) {
    let dmy = 0, mdy = 0;
    for (const p of pres) {
      const m = PRE.exec(western(p || ''));
      if (!m || m[4].length === 4) continue;
      if (+m[4] > 12) dmy++;
      if (+m[5] > 12) mdy++;
    }
    if (dmy !== mdy) return dmy > mdy ? 'dmy' : 'mdy';
    return /^en-US/i.test(navigator.language) ? 'mdy' : 'dmy';
  }

  function when(pre, order) {
    const m = PRE.exec(western(pre || ''));
    if (!m) return null;
    let [, h, min, ampm, a, b, c] = m;
    h = +h;
    if (ampm) h = (h % 12) + (/pm|م/i.test(ampm) ? 12 : 0);
    let y, mo, d;
    if (a.length === 4) [y, mo, d] = [a, b, c];
    else if (order === 'dmy') [d, mo, y] = [a, b, c];
    else [mo, d, y] = [a, b, c];
    if (y.length === 2) y = '20' + y;
    return { date: `${y}-${pad(mo)}-${pad(d)}`, time: `${pad(h)}:${min}` };
  }

  // Only the fields the dashboard needs are kept — never the message itself.
  // `provider` is the tag the user gave the chat; `chat` is the chat's name (picks a template).
  function parse(text, pre, order, provider = '', chat = provider) {
    const w = when(pre, order);
    if (!w) return null;
    const s = western(text);
    let hit = null;
    for (const p of PROVIDERS.filter((p) => p.chat.test(chat))) {
      for (const r of p.rules) { const m = r.re.exec(s); if (m) { hit = { type: r.type, ...r.pick(m) }; break; } }
      if (hit) break;
    }
    hit ||= generic(s);
    if (!hit) return null;
    const amount = num(hit.amount);
    if (!(amount > 0)) return null;
    const raw = (hit.raw || '').trim();
    return {
      ...w, provider, type: hit.type, amount, currency: curOf(hit.currency),
      balance: hit.balance == null ? null : num(hit.balance), raw, ...splitMerchant(raw),
    };
  }

  // No type in the key: a message whose direction was inferred must not count twice.
  const key = (t) => `${t.provider}|${t.date} ${t.time}|${t.amount}|${t.balance}`;
  const sort = (list) => list.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) || (b.balance ?? 0) - (a.balance ?? 0));

  return { parse, dateOrder, key, sort, resolve, PROVIDERS };
})();
