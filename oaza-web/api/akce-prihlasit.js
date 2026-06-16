// akce-prihlasit.js — přihlášení na akci + potvrzovací e-mail (+ QR u online platby)
// POST /api/akce-prihlasit  { slug, jmeno, email, telefon?, pocet_osob?, mena?, poznamka?, souhlas }

const QRCode = require('qrcode');
const {
  supaRest, supaUpload, spayd, brevoSend, asciiClean,
  BANKY, ADMIN_EMAIL, cors,
} = require('./_lib');

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Jen POST' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    let { slug, jmeno, email, telefon, pocet_osob, mena, poznamka, souhlas } = body;

    // --- validace ---
    if (!slug) return res.status(400).json({ error: 'Chybí akce.' });
    jmeno = (jmeno || '').trim();
    email = (email || '').trim().toLowerCase();
    if (jmeno.length < 2) return res.status(400).json({ error: 'Vyplňte prosím jméno.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Neplatný e-mail.' });
    if (!souhlas) return res.status(400).json({ error: 'Je potřeba souhlas se zpracováním údajů.' });
    pocet_osob = Math.max(1, parseInt(pocet_osob, 10) || 1);

    // --- načti akci ---
    const rows = await supaRest(`akce?slug=eq.${encodeURIComponent(slug)}&aktivni=eq.true&select=*`);
    if (!rows || !rows.length) return res.status(404).json({ error: 'Akce nenalezena.' });
    const akce = rows[0];

    if (akce.stav === 'zrusena') return res.status(409).json({ error: 'Tato akce byla zrušena.' });
    if (akce.stav === 'obsazena') return res.status(409).json({ error: 'Tato akce je obsazená.' });

    // --- kapacita ---
    if (akce.kapacita) {
      const pr = await supaRest(`prihlasky_akce?akce_id=eq.${akce.id}&stav_platby=neq.zruseno&select=pocet_osob`);
      const obsazeno = (pr || []).reduce((s, r) => s + (r.pocet_osob || 1), 0);
      if (obsazeno + pocet_osob > akce.kapacita) {
        const volno = Math.max(0, akce.kapacita - obsazeno);
        return res.status(409).json({ error: volno > 0
          ? `Zbývá už jen ${volno} volných míst.`
          : 'Akce je bohužel obsazená.' });
      }
    }

    // --- platba ---
    const platba = akce.platba_typ; // 'online' | 'na_miste' | 'zdarma'
    let castka = null;
    if (platba !== 'zdarma') {
      // výběr měny: pokud je zadaná a cena v ní existuje, jinak default CZK
      if (mena === 'eur' && akce.cena_eur != null) mena = 'eur';
      else if (akce.cena_czk != null) mena = 'czk';
      else if (akce.cena_eur != null) mena = 'eur';
      else mena = 'czk';
      const jednotka = mena === 'eur' ? akce.cena_eur : akce.cena_czk;
      castka = jednotka != null ? Number(jednotka) * pocet_osob : null;
    } else {
      mena = null;
    }

    // počáteční stav platby
    const stav_platby = platba === 'zdarma' ? 'zdarma'
      : platba === 'na_miste' ? 'na_miste'
      : 'ceka_na_platbu';

    // --- zápis přihlášky (VS přidělí sekvence automaticky) ---
    const inserted = await supaRest('prihlasky_akce', {
      method: 'POST',
      prefer: 'return=representation',
      body: [{
        akce_id: akce.id,
        akce_slug: akce.slug,
        akce_nazev: akce.nazev,
        jmeno, email,
        telefon: telefon || null,
        pocet_osob,
        mena,
        castka,
        platba_typ: platba,
        stav_platby,
        poznamka: poznamka || null,
      }],
    });
    const prihlaska = inserted[0];
    const vs = prihlaska.vs;

    // --- QR kód (jen u online platby) ---
    let qrUrl = null;
    let bankaInfo = null;
    if (platba === 'online' && castka != null) {
      const spaydStr = spayd({ mena, amount: castka, vs, msg: `Akce ${akce.nazev}` });
      const pngBuffer = await QRCode.toBuffer(spaydStr, { type: 'png', width: 520, margin: 2 });
      qrUrl = await supaUpload(`qr/akce-vs-${vs}.png`, pngBuffer, 'image/png');
      bankaInfo = BANKY[mena];
    }

    // --- potvrzovací e-mail zákazníkovi ---
    const html = buildEmail({ akce, prihlaska, castka, mena, platba, vs, qrUrl, bankaInfo });
    await brevoSend({
      to: email,
      toName: jmeno,
      subject: `Přihláška na akci: ${akce.nazev}`,
      html,
      bcc: ADMIN_EMAIL,
    });

    return res.status(200).json({
      ok: true,
      vs,
      platba_typ: platba,
      castka,
      mena,
      qrUrl,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};

// ------------------------------------------------------------------
function buildEmail({ akce, prihlaska, castka, mena, platba, vs, qrUrl, bankaInfo }) {
  const G = '#9a7628', GOLD = '#c9a14a', TXT = '#4a3b33', CREAM = '#fdfaf5';
  const symbol = mena === 'eur' ? '€' : 'Kč';
  const castkaStr = castka != null
    ? `${Number(castka).toLocaleString('cs-CZ')} ${symbol}`
    : '';

  let platebniSekce = '';
  if (platba === 'online') {
    platebniSekce = `
      <tr><td style="padding:24px 0 8px;font-family:Georgia,serif;font-size:18px;color:${G};">Platební údaje</td></tr>
      <tr><td style="font-family:Arial,sans-serif;font-size:15px;color:${TXT};line-height:1.7;">
        Částka: <b>${castkaStr}</b><br>
        Číslo účtu: <b>${bankaInfo.cislo}</b> (${bankaInfo.banka})<br>
        IBAN: <b>${bankaInfo.iban}</b><br>
        Variabilní symbol: <b>${vs}</b><br>
        Zpráva pro příjemce: <b>${esc(akce.nazev)}</b>
      </td></tr>
      ${qrUrl ? `<tr><td align="center" style="padding:20px 0;">
        <div style="font-family:Arial,sans-serif;font-size:13px;color:#8a7d72;margin-bottom:10px;">Naskenujte v mobilní bankovní aplikaci:</div>
        <img src="${qrUrl}" width="220" height="220" alt="QR platba" style="border:1px solid #eadcc4;border-radius:12px;">
      </td></tr>` : ''}
      <tr><td style="font-family:Arial,sans-serif;font-size:13px;color:#8a7d72;padding-top:6px;">
        Místo na akci vám rezervujeme po připsání platby. Pokud QR nejde naskenovat, zadejte údaje ručně.
      </td></tr>`;
  } else if (platba === 'na_miste') {
    platebniSekce = `
      <tr><td style="padding:24px 0 8px;font-family:Georgia,serif;font-size:18px;color:${G};">Platba</td></tr>
      <tr><td style="font-family:Arial,sans-serif;font-size:15px;color:${TXT};line-height:1.7;">
        ${castka != null ? `Částka <b>${castkaStr}</b> se hradí <b>na místě</b> při příchodu.` : 'Platba probíhá na místě.'}
      </td></tr>`;
  } else {
    platebniSekce = `
      <tr><td style="padding:24px 0 8px;font-family:Georgia,serif;font-size:18px;color:${G};">Účast zdarma</td></tr>
      <tr><td style="font-family:Arial,sans-serif;font-size:15px;color:${TXT};line-height:1.7;">
        Tato akce je zdarma. Těšíme se na vás.
      </td></tr>`;
  }

  return `<!doctype html><html lang="cs"><body style="margin:0;padding:0;background:${CREAM};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #eadcc4;border-radius:16px;overflow:hidden;">
        <tr><td style="height:6px;background:linear-gradient(90deg,${GOLD},${G});"></td></tr>
        <tr><td style="padding:32px 36px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-family:Georgia,serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:${GOLD};">Oáza Adamanthea</td></tr>
            <tr><td style="font-family:Georgia,serif;font-size:26px;color:${TXT};padding:6px 0 2px;">${esc(akce.nazev)}</td></tr>
            <tr><td style="font-family:Arial,sans-serif;font-size:15px;color:${TXT};line-height:1.7;padding-top:14px;">
              Milý/á <b>${esc(prihlaska.jmeno)}</b>,<br>
              děkujeme za přihlášku. Tady je shrnutí:
            </td></tr>
            <tr><td style="padding:16px 0 0;font-family:Arial,sans-serif;font-size:15px;color:${TXT};line-height:1.8;">
              ${akce.datum_text ? `📅 <b>${esc(akce.datum_text)}</b><br>` : ''}
              ${akce.misto ? `📍 ${esc(akce.misto)}<br>` : ''}
              👤 Počet osob: <b>${prihlaska.pocet_osob}</b>
            </td></tr>
            ${platebniSekce}
            <tr><td style="padding-top:28px;border-top:1px solid #f0e6d5;font-family:Arial,sans-serif;font-size:13px;color:#8a7d72;line-height:1.7;">
              V případě dotazů odpovězte na tento e-mail nebo volejte +420 737 869 752.<br>
              S láskou, tým Oázy Adamanthea 🌿
            </td></tr>
          </table>
        </td></tr>
      </table>
      <div style="font-family:Arial,sans-serif;font-size:11px;color:#b3a896;padding-top:16px;">Oáza Adamanthea · Halenkovice 400, 763 63 · IČO 76564410</div>
    </td></tr>
  </table></body></html>`;
}
