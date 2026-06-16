// akce-denni-souhrn.js — denní souhrn přihlášek na akce (spouští Vercel Cron)
// GET /api/akce-denni-souhrn  (cron jej volá jednou denně)
// Pošle na ADMIN_EMAIL přehled přihlášek za posledních 24 hodin.

const { supaRest, brevoSend, ADMIN_EMAIL } = require('./_lib');

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}
const STAV = {
  ceka_na_platbu: 'čeká na platbu', zaplaceno: 'zaplaceno',
  na_miste: 'platí na místě', zdarma: 'zdarma', zruseno: 'zrušeno',
};

module.exports = async (req, res) => {
  // Ochrana: pokud je nastaven CRON_SECRET, vyžaduj ho (Vercel ho posílá v hlavičce)
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Neautorizováno' });
    }
  }

  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const rows = await supaRest(
      `prihlasky_akce?vytvoreno=gte.${since}&order=akce_nazev.asc,vytvoreno.asc` +
      `&select=jmeno,email,telefon,pocet_osob,castka,mena,stav_platby,akce_nazev,vytvoreno,vs`
    );

    const datum = new Date().toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
    let html, predmet;

    if (!rows || !rows.length) {
      predmet = `Oáza — denní souhrn: žádné nové přihlášky (${datum})`;
      html = bodyWrap(`<p style="font-family:Arial,sans-serif;font-size:15px;color:#4a3b33">
        Za posledních 24 hodin se na akce nikdo nově nepřihlásil. 🌿</p>`);
    } else {
      // seskupit podle akce
      const skupiny = {};
      for (const r of rows) {
        const k = r.akce_nazev || '(bez názvu)';
        (skupiny[k] = skupiny[k] || []).push(r);
      }
      let bloky = '';
      for (const [akce, lidi] of Object.entries(skupiny)) {
        const osob = lidi.reduce((s, r) => s + (r.pocet_osob || 1), 0);
        const radky = lidi.map(r => {
          const castka = r.castka != null ? `${Number(r.castka).toLocaleString('cs-CZ')} ${r.mena === 'eur' ? '€' : 'Kč'}` : '—';
          const cas = new Date(r.vytvoreno).toLocaleString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
          return `<tr>
            <td style="padding:7px 10px;border-bottom:1px solid #f0e6d5;font-size:14px">${esc(r.jmeno)}<br><span style="color:#8a7d72;font-size:12.5px">${esc(r.email)}${r.telefon ? ' · ' + esc(r.telefon) : ''}</span></td>
            <td style="padding:7px 10px;border-bottom:1px solid #f0e6d5;font-size:14px;text-align:center">${r.pocet_osob || 1}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f0e6d5;font-size:14px">${castka}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f0e6d5;font-size:14px">${STAV[r.stav_platby] || r.stav_platby}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f0e6d5;font-size:13px;color:#8a7d72">VS ${r.vs} · ${cas}</td>
          </tr>`;
        }).join('');
        bloky += `<div style="margin:22px 0 8px;font-family:Georgia,serif;font-size:18px;color:#9a7628">${esc(akce)}
            <span style="font-size:13px;color:#8a7d72;font-family:Arial,sans-serif">· ${lidi.length} přihláš${lidi.length === 1 ? 'ka' : (lidi.length < 5 ? 'ky' : 'ek')}, ${osob} os.</span></div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${radky}</table>`;
      }
      const celkem = rows.length;
      predmet = `Oáza — ${celkem} nov${celkem === 1 ? 'á přihláška' : (celkem < 5 ? 'é přihlášky' : 'ých přihlášek')} na akce (${datum})`;
      html = bodyWrap(`<p style="font-family:Arial,sans-serif;font-size:15px;color:#4a3b33">
        Souhrn přihlášek za posledních 24 hodin:</p>${bloky}`);
    }

    await brevoSend({ to: ADMIN_EMAIL, toName: 'Oáza Adamanthea', subject: predmet, html });
    return res.status(200).json({ ok: true, count: rows ? rows.length : 0 });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};

function bodyWrap(inner) {
  return `<!doctype html><html lang="cs"><body style="margin:0;padding:0;background:#fdfaf5">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf5;padding:28px 0"><tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #eadcc4;border-radius:16px;overflow:hidden">
        <tr><td style="height:6px;background:linear-gradient(90deg,#c9a14a,#9a7628)"></td></tr>
        <tr><td style="padding:28px 32px">
          <div style="font-family:Georgia,serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#c9a14a">Oáza Adamanthea</div>
          <div style="font-family:Georgia,serif;font-size:23px;color:#4a3b33;padding:4px 0 14px">Denní souhrn přihlášek</div>
          ${inner}
        </td></tr>
      </table>
    </td></tr></table></body></html>`;
}
