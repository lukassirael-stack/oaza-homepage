// api/pobyt-rezervace.js — odolný obal rezervační proxy Pobytu ve světle.
//
// Pobyt posílá rezervace na vlastní projekt rezervace-proxy.vercel.app. Tenhle
// endpoint stojí PŘED ním: normálně rezervaci jen přepošle do proxy (ta dělá svou
// práci — zápis do Airtable atd.). Když je proxy/Airtable nedostupná (typicky 429
// = překročený měsíční API limit), rezervaci odchytí do Supabase bufferu a
// zákazníkovi to vyjde jako úspěch (HTTP 200) — potvrzovací e-mail s VS odejde.
// Po obnově se buffer při příští úspěšné rezervaci sám přehraje do proxy.
//
// VS (variabilní symbol) generuje stránka a posílá ho ve fields, takže odložená
// i přehraná rezervace nese stejný VS jako e-mail zákazníka. Nic se neztratí.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (už nastavené, přes _lib.js).
//
//   POST {fields}  → přepošle do proxy; při výpadku buffer + 200

const { supaRest } = require('./_lib');

const PROXY_URL = 'https://rezervace-proxy.vercel.app/api/airtable';
const BUF = 'rezervace_pobyt_buffer';

// překryv dvou pobytů [in, out): a_in < b_out && b_in < a_out (data jako YYYY-MM-DD)
function overlaps(aIn, aOut, bIn, bOut) {
  if (!aIn || !aOut || !bIn || !bOut) return false;
  return aIn < bOut && bIn < aOut;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metoda nepovolena' });
  }

  // přehraje odložené rezervace do proxy (volá se až po úspěšném zápisu)
  async function flushBuffer() {
    let rows;
    try {
      rows = await supaRest(`${BUF}?synced=eq.false&order=created_at.asc&limit=25&select=id,payload`);
    } catch (e) { return; }
    if (!rows || !rows.length) return;
    for (const row of rows) {
      let r;
      try {
        r = await fetch(PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: row.payload }),
        });
      } catch (e) { return; }          // síťová chyba → zkus celé příště
      if (r.status === 429) return;     // limit zase aktivní → přeruš
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        await supaRest(`${BUF}?id=eq.${row.id}`, {
          method: 'PATCH', prefer: 'return=minimal',
          body: { last_error: 'HTTP ' + r.status + ' ' + txt.slice(0, 200) },
        }).catch(() => {});
        continue;                        // chyba u TÉTO rezervace → přeskoč
      }
      await supaRest(`${BUF}?id=eq.${row.id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { synced: true, synced_at: new Date().toISOString() },
      }).catch(() => {});
    }
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const fields = body.fields || {};

    if (!fields.jmeno || !fields.email || !fields.datum_prijezdu || !fields.datum_odjezdu) {
      return res.status(400).json({ error: 'Chybí povinná pole rezervace.' });
    }

    // 1) přepošli do proxy (ta zapíše do Airtable jako vždy)
    let pr = null;
    try {
      pr = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
    } catch (netErr) {
      pr = null; // síťová chyba → buffer níže
    }

    if (pr && pr.ok) {
      const j = await pr.json().catch(() => ({ ok: true }));
      try { await flushBuffer(); } catch (e) {} // proxy jede → dožeň odložené
      return res.status(200).json(j);
    }

    // 2) jiná 4xx chyba než limit (validace apod.) → vrať reálnou chybu proxy,
    //    ať se neodkládá vadná rezervace
    if (pr && pr.status >= 400 && pr.status < 500 && pr.status !== 429) {
      const j = await pr.json().catch(() => ({ error: 'Rezervace odmítnuta' }));
      return res.status(pr.status).json(j);
    }

    // 3) proxy/Airtable nedostupná (429 / 5xx / síť) → buffer, ať NEUTČE.
    //    Nejprve kontrola překryvu s jinou odloženou rezervací (proti dvojrezervaci
    //    během výpadku, kdy se kalendář ještě neaktualizuje).
    let pending = [];
    try {
      pending = await supaRest(`${BUF}?synced=eq.false&select=payload`);
    } catch (e) { pending = []; }
    const clash = (pending || []).some((p) =>
      overlaps(fields.datum_prijezdu, fields.datum_odjezdu,
               p.payload && p.payload.datum_prijezdu, p.payload && p.payload.datum_odjezdu));
    if (clash) {
      return res.status(409).json({ error: 'Tento termín byl právě rezervován. Zvolte prosím jiný.' });
    }

    try {
      await supaRest(BUF, { method: 'POST', prefer: 'return=minimal', body: [{ payload: fields }] });
      return res.status(200).json({ ok: true, buffered: true });
    } catch (bufErr) {
      return res.status(502).json({ error: 'Rezervaci se nepodařilo uložit', detail: String((bufErr && bufErr.message) || bufErr) });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Serverová chyba', detail: String((e && e.message) || e) });
  }
};
