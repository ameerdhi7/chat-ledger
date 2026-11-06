import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// parse.js is a plain browser script, so run it the way Chrome does and grab its global.
const ctx = vm.createContext({ navigator: { language: 'en-GB' } });
vm.runInContext(fs.readFileSync(new URL('../extension/parse.js', import.meta.url), 'utf8') + ';globalThis.TT = TT;', ctx);
const TT = ctx.TT;
const pre = '[10:23 PM, 15/09/2026] Bank: ';
const p = (text, provider = 'Bank') => TT.parse(text, pre, 'dmy', provider);

test('Tabadul template keeps merchant and city', () => {
  const t = p('Purchase of 603,600 IQD made on your wallet card, at (hasan jathir > >Baghdad). Remaining Balance: 8,752,412 IQD', 'Tabadul');
  assert.deepEqual([t.type, t.amount, t.balance, t.merchant, t.city, t.date, t.time], ['debit', 603600, 8752412, 'hasan jathir', 'Baghdad', '2026-09-15', '22:23']);
});
test('generic English debit and credit', () => {
  assert.deepEqual((({ type, amount, balance, merchant }) => [type, amount, balance, merchant])(p('Payment of 25,000 IQD to ZAIN IRAQ on 15/09. Available balance: 1,200,000 IQD')), ['debit', 25000, 1200000, 'ZAIN IRAQ']);
  assert.deepEqual((({ type, amount, merchant }) => [type, amount, merchant])(p('You received 50,000 IQD from Ali Hassan. Your balance is 75,000 IQD')), ['credit', 50000, 'Ali Hassan']);
  assert.equal(p('Your card was charged $12.99 at NETFLIX.COM. Balance $400.50').currency, 'USD');
});
test('generic Arabic with Arabic-Indic digits', () => {
  const t = p('تم شراء بمبلغ ١٥٬٠٠٠ د.ع لدى مطعم الريم. الرصيد المتبقي ٣٠٠٬٠٠٠ د.ع');
  assert.deepEqual([t.type, t.amount, t.balance, t.merchant], ['debit', 15000, 300000, 'مطعم الريم']);
  assert.equal(p('تم إيداع 200,000 دينار في حسابك. رصيدك 500,000 دينار').type, 'credit');
});
test('ignores OTPs and non-money messages', () => {
  assert.equal(p('Your OTP is 123456 for payment of 5,000 IQD'), null);
  assert.equal(p('عميلنا العزيز، تم تسجيل محاولة إدخال رقم سري (PIN) غير صحيح لبطاقتك.'), null);
});
test('keys are per provider', () => {
  const a = p('Purchase of 5,000 IQD at Cafe', 'A'), b = p('Purchase of 5,000 IQD at Cafe', 'B');
  assert.notEqual(TT.key(a), TT.key(b));
});
