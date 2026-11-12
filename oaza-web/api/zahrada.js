// api/zahrada.js — odolný zápis rezervací Pobytu ve světle + jeho obsazenost
//
// Portálová zahrada tu od 10/2026 rezervace nemá: návštěva se domlouvá poptávkou
// přes společný formulář (/objednavka-sluzby.js → /api/objednavka?akce=sluzba, Brevo).
// Zavřené dny, zápis rezervací zahrady do Airtable ani správa se už nepoužívají;
// adresa /api/zahrada zůstává, protože ji volá stránka Pobytu ve světle.
//
// Environment Variables v projektu oaza-web:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY – sdílené přes _lib.js
//
// Operace:
//   GET ?ranges=pobyt                    → veřejné: obsazené termíny chatky (z cache v Supabase)
//   GET                                  → { closed: [] } (jen pro starší otevřené stránky zahrady)
//   POST {action:'pobyt', fields}        → veřejné: pobytová rezervace (cenu a termín ověřuje server)

const { supaRest } = require('./_lib');

// ── Pobyt ve světle ───────────────────────────────────────────────
// Rezervaci zapisuje jen server: databázová funkce pobyt_rezervace_vytvor si sama
// spočítá cenu podle ceníku, ověří termín (volno, aspoň 2 noci), hlídá limit pokusů
// a zapíše do Airtable (klíč je ve Vaultu Supabase). Když je Airtable na limitu,
// rezervace počká v bufferu a přehraje se sama. Potvrzení s QR platbou posílá server.
const crypto = require('crypto');
const { brevoSend, ADMIN_EMAIL } = require('./_lib');
const POBYT_IBAN = 'CZ1655000000008159854004';
const POBYT_UCET = '8159854004/5500';

function chceFakturu(pf) {
  return /^\s*ano/i.test(String((pf && pf.faktura) || ''));
}
// Faktura na přání hosta: VS jde do fronty (faktury_fronta) a hned se zkusí vystavit;
// co se nestihne, dožene cron faktury-pobyt do 10 minut.
async function zaradFakturu(pf) {
  await supaRest('faktury_fronta', {
    method: 'POST', prefer: 'return=minimal',
    body: [{ vs: String(pf.variabilni_symbol || ''), email: String(pf.email || '') }],
  });
}
async function vystavFakturuHned() {
  await Promise.race([
    supaRest('rpc/vystav_faktury_pobyt', { method: 'POST', body: {} }),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
}
function otiskAdresy(req) {
  const adresa = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || String(req.headers['x-real-ip'] || '');
  const klic = String(process.env.SUPABASE_SERVICE_KEY || '').slice(-16);
  return adresa ? crypto.createHash('sha256').update('pobyt:' + klic + adresa).digest('hex').slice(0, 24) : null;
}
const escH = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const datumCz = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `${d}. ${m}. ${y}`; };
const kc = (n) => Number(n || 0).toLocaleString('cs-CZ') + ' Kč';

async function posliPotvrzeni(f) {
  const spayd = `SPD*1.0*ACC:${POBYT_IBAN}*AM:${Number(f.cena_celkem).toFixed(2)}*CC:CZK*X-VS:${f.variabilni_symbol}*MSG:Pobyt ve svetle Oaza Adamanthea`;
  const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=0&data=' + encodeURIComponent(spayd);
  const radek = (k, v) => `<tr><td style="padding:5px 14px 5px 0;color:#6b7370">${k}</td><td style="padding:5px 0"><strong>${v}</strong></td></tr>`;
  const html = `<div style="background:#fbf7ef;padding:28px 16px;font-family:Georgia,serif;color:#2c342f">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e8e2d4">
<div style="background:#1f3129;padding:22px 28px"><div style="color:#c9a14a;letter-spacing:3px;font-size:13px">OÁZA ADAMANTHEA</div><div style="color:#fbf7ef;font-size:12px;margin-top:4px">Pobyt ve světle</div></div>
<div style="padding:26px 28px">
<p style="margin:0 0 14px">Dobrý den, ${escH(f.jmeno)},</p>
<p style="margin:0 0 16px">děkujeme za rezervaci Pobytu ve světle. Tady je její souhrn a údaje k platbě.</p>
<table style="border-collapse:collapse;font-size:15px;margin:0 0 18px">
${radek('Příjezd', datumCz(f.datum_prijezdu))}
${radek('Odjezd', datumCz(f.datum_odjezdu))}
${radek('Počet nocí', f.pocet_noci)}
${radek('Hosté', f.dospeli + (f.dospeli === 1 ? ' dospělý' : ' dospělí') + (f.deti ? ', ' + f.deti + ' dítě' : ''))}
${radek('Doplňkové služby', escH(f.sluzby))}
${radek('Cena celkem', kc(f.cena_celkem))}
</table>
<div style="margin:0 0 16px;padding:18px;background:#fbf7ef;border:1px solid #e8e2d4;border-radius:10px;text-align:center">
<div style="font-size:12px;letter-spacing:2px;color:#9a8060;text-transform:uppercase;margin-bottom:10px">Platební údaje</div>
<div style="font-size:15px;margin-bottom:4px">Účet: <strong>${POBYT_UCET}</strong> (Raiffeisenbank)</div>
<div style="font-size:15px;margin-bottom:4px">Variabilní symbol: <strong>${escH(f.variabilni_symbol)}</strong></div>
<div style="font-size:15px;margin-bottom:14px">Částka: <strong>${kc(f.cena_celkem)}</strong></div>
<img src="${qr}" width="200" height="200" alt="QR platba" style="display:block;margin:0 auto;border:6px solid #fff;border-radius:8px">
<div style="font-size:12px;color:#6b7370;margin-top:10px">Naskenujte QR kód v bankovní aplikaci — údaje se vyplní samy.</div>
</div>
<p style="margin:0 0 6px">Rezervaci potvrdíme po přijetí platby na náš účet. S čímkoli stačí odpovědět na tento e-mail.</p>
<p style="margin:0;color:#6b7370">Lukáš &amp; Martina<br>Oáza Adamanthea, Halenkovice</p>
</div></div></div>`;
  await brevoSend({
    to: f.email, toName: f.jmeno, bcc: ADMIN_EMAIL,
    subject: `Rezervace Pobytu ve světle ${datumCz(f.datum_prijezdu)} – ${datumCz(f.datum_odjezdu)}`,
    html,
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Pobyt – dostupnost (obsazené termíny) z cron-cache booked_ranges_v3,
      // ať funguje i když je Airtable/proxy na limitu. Tvar {start,end}→{from,to}.
      if (req.query && req.query.ranges === 'pobyt') {
        try {
          const rows = await supaRest('airtable_cache?cache_key=eq.booked_ranges_v3&select=payload&limit=1');
          const arr = (rows && rows[0] && Array.isArray(rows[0].payload)) ? rows[0].payload : [];
          const ranges = arr
            .map((r) => ({ from: r.from || r.start, to: r.to || r.end }))
            .filter((r) => r.from && r.to);
          res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
          return res.status(200).json({ ranges });
        } catch (e) {
          return res.status(200).json({ ranges: [] }); // ať stránka nespadne (použije localStorage)
        }
      }
      // starší otevřená stránka zahrady se ptá na zavřené dny → prázdný seznam
      return res.status(200).json({ closed: [] });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const action = body.action;

      // ── VEŘEJNÉ: pobytová rezervace ──
      if (action === 'pobyt') {
        const pf = (body.fields && typeof body.fields === 'object') ? body.fields : {};
        let v;
        try {
          v = await supaRest('rpc/pobyt_rezervace_vytvor', { method: 'POST', body: { p: pf, p_ip: otiskAdresy(req) } });
        } catch (e) {
          console.error('pobyt rezervace:', e && e.message);
          return res.status(502).json({ error: 'Rezervaci se teď nepodařilo uložit. Zkuste to prosím za chvíli znovu, nebo nám napište na oaza.adamanthea@gmail.com.' });
        }
        if (!v || !v.ok) {
          if (v && v.detail) console.error('pobyt rezervace:', v.detail);
          const kod = v && v.kod;
          const stav = kod === 'obsazeno' ? 409 : kod === 'limit' ? 429 : kod === 'vstup' ? 400 : 502;
          return res.status(stav).json({ error: (v && v.error) || 'Rezervaci se nepodařilo uložit. Zkuste to prosím znovu.' });
        }
        const f = v.fields;
        let email_odeslan = false;
        try { await posliPotvrzeni(f); email_odeslan = true; } catch (e) { console.error('pobyt potvrzení:', e && e.message); }
        if (chceFakturu(f)) {
          try { await zaradFakturu(f); if (!v.buffered) await vystavFakturuHned(); } catch (e) {}
        }
        return res.status(200).json({
          ok: true, buffered: !!v.buffered, email_odeslan,
          variabilni_symbol: f.variabilni_symbol, cena_celkem: f.cena_celkem, pocet_noci: f.pocet_noci,
          dospeli: f.dospeli, deti: f.deti, sluzby: f.sluzby,
        });
      }

      // starší otevřená stránka zahrady (rezervace přes Airtable) → ať si ji člověk obnoví
      if (action === 'reservation') {
        return res.status(410).json({ error: 'Formulář se změnil. Obnovte prosím stránku a odešlete poptávku znovu.' });
      }

      return res.status(400).json({ error: 'Neznámá akce' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Metoda nepovolena' });
  } catch (e) {
    console.error('zahrada:', e && e.message);
    return res.status(500).json({ error: 'Něco se nepovedlo. Zkuste to prosím znovu.' });
  }
};
