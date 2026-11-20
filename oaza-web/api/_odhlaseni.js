// _odhlaseni.js — odhlášení účastníka z akce odkazem z e-mailu
// Volá se přes /api/akce-prihlasit?odhlaseni=1 (pomocný modul, vlastní slot funkce nezabírá).
//   GET  ?odhlaseni=1&p=<id přihlášky>   → shrnutí přihlášky pro stránku /odhlaseni
//   POST ?odhlaseni=1  { p }             → přihláška přejde do stavu „zruseno", Oáze i účastníkovi odejde e-mail
// Klíčem je id přihlášky (uuid) — zná ho jen příjemce e-mailu s potvrzením nebo s pokyny.

const { supaRest, brevoSend, ADMIN_EMAIL } = require('./_lib');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAV_TXT = { ceka_na_platbu: 'čekala na platbu', zaplaceno: 'zaplaceno', na_miste: 'platba na místě', zdarma: 'zdarma' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function dnesPraha() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Prague' }); }
function dnesCesky() { return new Date().toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric' }); }

async function nacti(id) {
  const rows = await supaRest(`prihlasky_akce?id=eq.${id}&select=id,vs,akce_id,akce_slug,akce_nazev,jmeno,email,telefon,pocet_osob,mena,castka,stav_platby,poznamka_admin`);
  if (!rows || !rows.length) return null;
  const p = rows[0];
  let akce = null;
  if (p.akce_id) {
    const a = await supaRest(`akce?id=eq.${p.akce_id}&select=nazev,slug,datum_text,datum_od,datum_do,datum_konec`);
    akce = (a && a[0]) || null;
  }
  return { p, akce };
}

// Odhlásit se dá do dne akce včetně (u vícedenní do posledního dne)
function probehla(akce) {
  if (!akce) return false;
  const konec = String(akce.datum_konec || akce.datum_do || akce.datum_od || '').slice(0, 10);
  return !!konec && konec < dnesPraha();
}

function shrnuti({ p, akce }) {
  return {
    jmeno: String(p.jmeno || '').includes('@') ? '' : String(p.jmeno || '').split(/\s+/)[0],
    akce: (akce && akce.nazev) || p.akce_nazev || '',
    termin: (akce && akce.datum_text) || '',
    slug: (akce && akce.slug) || p.akce_slug || '',
    pocet_osob: p.pocet_osob || 1,
    stav: p.stav_platby === 'zruseno' ? 'odhlaseno' : (probehla(akce) ? 'probehla' : 'aktivni'),
    zaplaceno: p.stav_platby === 'zaplaceno',
  };
}

function ramecek(nadpis, teloHtml) {
  const G = '#9a7628', GOLD = '#c9a14a', TXT = '#4a3b33', CREAM = '#fdfaf5';
  return `<!doctype html><html lang="cs"><body style="margin:0;padding:0;background:${CREAM};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:32px 0;"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #eadcc4;border-radius:16px;overflow:hidden;">
      <tr><td style="height:6px;background:linear-gradient(90deg,${GOLD},${G});"></td></tr>
      <tr><td style="padding:32px 36px;">
        <div style="font-family:Georgia,serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:${GOLD};">Oáza Adamanthea</div>
        <div style="font-family:Georgia,serif;font-size:24px;color:${TXT};padding:6px 0 14px;">${nadpis}</div>
        <div style="font-family:Arial,sans-serif;font-size:15px;color:${TXT};line-height:1.7;">${teloHtml}</div>
      </td></tr>
    </table>
    <div style="font-family:Arial,sans-serif;font-size:11px;color:#b3a896;padding-top:16px;">Oáza Adamanthea · Halenkovice 400, 763 63 · IČO 76564410</div>
  </td></tr></table></body></html>`;
}

module.exports = async (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = String((req.method === 'POST' ? body.p : req.query.p) || '').trim();
    if (!UUID.test(id)) return res.status(404).json({ error: 'Přihlášku se podle odkazu nepodařilo dohledat.' });

    const nalez = await nacti(id);
    if (!nalez) return res.status(404).json({ error: 'Přihlášku se podle odkazu nepodařilo dohledat.' });
    const info = shrnuti(nalez);

    if (req.method === 'GET') return res.status(200).json({ ok: true, ...info });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Jen GET a POST' });

    if (info.stav !== 'aktivni') return res.status(200).json({ ok: true, ...info });

    const { p, akce } = nalez;
    const puvodni = p.stav_platby;
    const zapis = `Odhlášeno účastníkem přes web ${dnesCesky()} (původní stav: ${STAV_TXT[puvodni] || puvodni})`;
    const zmeneno = await supaRest(`prihlasky_akce?id=eq.${id}&stav_platby=neq.zruseno`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: { stav_platby: 'zruseno', poznamka_admin: p.poznamka_admin ? `${p.poznamka_admin} · ${zapis}` : zapis },
    });
    if (!zmeneno || !zmeneno.length) return res.status(200).json({ ok: true, ...info, stav: 'odhlaseno' });

    const nazev = (akce && akce.nazev) || p.akce_nazev || 'akce';
    const termin = (akce && akce.datum_text) || '';
    const symbol = p.mena === 'eur' ? '€' : 'Kč';
    const castka = p.castka != null ? `${Number(p.castka).toLocaleString('cs-CZ')} ${symbol}` : '—';
    const zaplaceno = puvodni === 'zaplaceno';

    // e-maily jsou doplněk — odhlášení platí, i kdyby se některý zdržel
    const posli = [
      brevoSend({
        to: ADMIN_EMAIL,
        subject: `Odhlášení z akce: ${nazev} · ${p.jmeno} (${p.pocet_osob || 1} os.)`,
        replyTo: p.email,
        html: ramecek('Odhlášení z akce', `
          <b>${esc(p.jmeno)}</b> se odhlásil/a z akce <b>${esc(nazev)}</b>${termin ? ` (${esc(termin)})` : ''}.<br><br>
          👤 Počet uvolněných míst: <b>${p.pocet_osob || 1}</b><br>
          ✉️ ${esc(p.email)}${p.telefon ? ` · ${esc(p.telefon)}` : ''}<br>
          💳 Původní stav: <b>${esc(STAV_TXT[puvodni] || puvodni)}</b> · částka ${castka} · VS ${p.vs}<br>
          ${zaplaceno ? '<br><b>Platba je připsaná — domluv s účastníkem vrácení nebo převod na jiný termín.</b>' : ''}`),
      }),
      brevoSend({
        to: p.email,
        toName: p.jmeno,
        subject: `Odhlášení z akce: ${nazev}`,
        html: ramecek(esc(nazev), `
          Milý/á <b>${esc(p.jmeno)}</b>,<br>
          vaše místo na akci${termin ? ` <b>${esc(termin)}</b>` : ''} je uvolněné. Děkujeme, že jste nám dali vědět — díky tomu se může přidat někdo další.<br><br>
          ${zaplaceno ? 'Ohledně přijaté platby se vám ozveme e-mailem.<br><br>' : ''}
          Aktuální program najdete na <a href="https://oaza-adamanthea.cz/akce" style="color:#9a7628">oaza-adamanthea.cz/akce</a>. Těšíme se na vás příště.<br><br>
          <span style="font-size:13px;color:#8a7d72;">S láskou, tým Oázy Adamanthea 🌿</span>`),
      }),
    ];
    const vysledky = await Promise.allSettled(posli);
    vysledky.forEach(v => { if (v.status === 'rejected') console.error('odhlaseni e-mail', v.reason && v.reason.message); });

    return res.status(200).json({ ok: true, ...info, stav: 'odhlaseno', prave: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
