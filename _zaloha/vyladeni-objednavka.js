// api/vyladeni-objednavka.js — potvrzení objednávky Vyladění
// Vercel serverless (Node 18+), bez závislostí.
// ENV: SUPABASE_URL, SUPABASE_SERVICE_KEY, BREVO_API_KEY
//
// Volá se z landing page hned po vygenerování platebních údajů.
// Pošle zákazníkovi e-mail s částkou, variabilním symbolem a číslem účtu.
// Odešle se právě jednou — hlídá to sloupec potvrzeni_odeslano.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BREVO = process.env.BREVO_API_KEY;

const UCET = { cislo: '8159854004 / 5500', iban: 'CZ16 5500 0000 0081 5985 4004' };

function sb(path, opts = {}) {
  const { method = 'GET', body, prefer } = opts;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

async function sbJson(path, opts) {
  const r = await sb(path, opts);
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!r.ok) throw new Error((data && data.message) || 'Chyba databáze');
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ chyba: 'Jen POST.' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ chyba: 'Chybí konfigurace Supabase.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const vs = String(body.vs || '').trim();
    if (!/^\d{6,9}$/.test(vs)) return res.status(400).json({ chyba: 'Chybí variabilní symbol.' });

    const rows = await sbJson(`ladeni_objednavky?vs=eq.${encodeURIComponent(vs)}&limit=1`);
    const o = Array.isArray(rows) ? rows[0] : null;
    if (!o) return res.status(404).json({ chyba: 'Objednávka nenalezena.' });

    // Už jednou odešlo, nebo je zaplaceno — neposíláme znovu.
    if (o.potvrzeni_odeslano || o.stav !== 'ceka') {
      return res.status(200).json({ ok: true, odeslano: false, duvod: 'jiz-odeslano' });
    }
    if (!BREVO) return res.status(200).json({ ok: true, odeslano: false, duvod: 'chybi-brevo-klic' });

    const poslano = await posliPotvrzeni(o);
    if (poslano) {
      await sbJson(`ladeni_objednavky?id=eq.${o.id}`, {
        method: 'PATCH',
        body: { potvrzeni_odeslano: new Date().toISOString() },
        prefer: 'return=minimal',
      });
    }
    return res.status(200).json({ ok: true, odeslano: poslano });
  } catch (e) {
    // Potvrzení je doplněk — objednávka i tak vznikla, tak stránku nekazíme.
    return res.status(200).json({ ok: false, odeslano: false, chyba: String(e.message || e).slice(0, 200) });
  }
}

async function posliPotvrzeni(o) {
  const rocni = o.typ === 'rocni';
  const varianta = rocni ? 'na rok' : 'na půl roku';
  const eur = rocni ? 20 : 14;
  const spayd = `SPD*1.0*ACC:CZ1655000000008159854004*AM:${o.castka_czk}.00*CC:CZK*X-VS:${o.vs}*MSG:VYLADENI`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(spayd)}`;

  const html = `<!doctype html><html lang="cs"><meta charset="utf-8">
<div style="background:#f6f0e2;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;color:#1d3b30">
  <div style="max-width:520px;margin:0 auto;background:#fffdf7;border:1px solid rgba(168,129,58,.3);border-radius:18px;padding:32px 28px;text-align:center">
    <p style="font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:#a8813a;margin:0 0 10px">Oáza Adamanthea</p>
    <h1 style="font-size:28px;letter-spacing:.08em;font-weight:500;margin:0 0 6px">Vyladění</h1>
    <p style="font-style:italic;color:#6e8076;margin:0 0 24px">frekvence &middot; dech &middot; záměr</p>

    <p style="text-align:left;font-size:17px;line-height:1.6;margin:0 0 18px">Dobrý den,</p>
    <p style="text-align:left;font-size:17px;line-height:1.6;margin:0 0 24px">
      posíláme platební údaje k Vyladění ${varianta}, ať je máš po ruce.
      Jakmile platba dorazí, pošleme ti odemykací kód — obvykle během jednoho dne.
    </p>

    <div style="background:linear-gradient(120deg,rgba(240,217,164,.35),rgba(255,249,232,.7));border:1px solid rgba(201,161,74,.5);border-radius:14px;padding:20px;margin:0 0 20px">
      <p style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#8a6626;margin:0 0 8px">Tvůj variabilní symbol</p>
      <p style="font-family:'Courier New',monospace;font-size:30px;letter-spacing:.14em;color:#8a6626;margin:0 0 6px"><strong>${o.vs}</strong></p>
      <p style="font-size:14px;color:#6e8076;margin:0">Podle něj tvoji platbu poznáme.</p>
    </div>

    <img src="${qr}" alt="Platební QR kód" width="200" height="200" style="display:block;margin:0 auto 8px;border-radius:12px">
    <p style="font-size:13px;color:#6e8076;margin:0 0 22px">Načti bankovní aplikací</p>

    <table role="presentation" style="width:100%;border-collapse:collapse;text-align:left;font-size:16px;margin:0 0 22px">
      <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,161,74,.22);color:#6e8076;width:42%">částka</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,161,74,.22)"><strong>${o.castka_czk} Kč / ${eur} €</strong></td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,161,74,.22);color:#6e8076">účet</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,161,74,.22)">${UCET.cislo}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,161,74,.22);color:#6e8076">variabilní symbol</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,161,74,.22)"><strong>${o.vs}</strong></td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,161,74,.22);color:#6e8076">IBAN</td><td style="padding:8px 0;border-bottom:1px solid rgba(201,161,74,.22);font-size:14px">${UCET.iban}</td></tr>
      <tr><td style="padding:8px 0;color:#6e8076">zpráva</td><td style="padding:8px 0">VYLADĚNÍ</td></tr>
    </table>

    <p style="text-align:left;font-size:15px;line-height:1.7;color:#6e8076;margin:0">
      Platíš předem ${varianta}. Kartu si neukládáme a nic se samo nestrhne —
      čtrnáct dní před koncem ti dáme vědět, ať se můžeš rozhodnout.
      Kdyby cokoli nesedělo, stačí odpovědět na tenhle e-mail.
    </p>
  </div>
  <p style="text-align:center;font-size:12px;letter-spacing:.14em;color:#6e8076;margin:20px 0 0">
    Oáza Adamanthea &middot; Halenkovice &middot; oaza-adamanthea.cz
  </p>
</div></html>`;

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Oáza Adamanthea', email: 'info@oaza-adamanthea.cz' },
      to: [{ email: o.email }],
      replyTo: { email: 'oaza.adamanthea@gmail.com', name: 'Oáza Adamanthea' },
      bcc: [{ email: 'oaza.adamanthea@gmail.com' }],
      subject: `Vyladění ${varianta} — platební údaje (VS ${o.vs})`,
      htmlContent: html,
    }),
  });
  return r.ok;
}
