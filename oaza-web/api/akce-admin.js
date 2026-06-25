// akce-admin.js — správa akcí a přihlášek (chráněno heslem ADMIN_HESLO)
// POST /api/akce-admin  { heslo, action, ... }
//
// actions:
//   login         -> ověření hesla
//   list          -> všechny akce (i skryté)
//   save          -> vytvoř/uprav akci (akce: {...}, obrazek_base64?)
//   delete        -> smaž akci (id)
//   set_stav      -> změň stav akce (id, stav: otevrena|obsazena|zrusena)
//   set_aktivni   -> publikovat/skrýt (id, aktivni)
//   prihlasky     -> přihlášky (volitelně akce_id)
//   mark          -> změň stav platby přihlášky (id, stav_platby)

const { supaRest, supaUpload, asciiClean, cors } = require('./_lib');

function slugify(s) {
  return asciiClean(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Jen POST' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { heslo, action } = body;

    if (!process.env.ADMIN_HESLO) return res.status(500).json({ error: 'ADMIN_HESLO není nastavené.' });
    if (heslo !== process.env.ADMIN_HESLO) return res.status(401).json({ error: 'Špatné heslo.' });

    if (action === 'login') return res.status(200).json({ ok: true });

    if (action === 'list') {
      const rows = await supaRest('akce?select=*&order=poradi.asc,datum_od.asc');
      return res.status(200).json({ akce: rows || [] });
    }

    if (action === 'save') {
      const a = body.akce || {};

      const rec = {
        nazev: a.nazev,
        slug: a.slug || slugify(a.nazev || ''),
        popis: a.popis || null,
        prihlaska_url: a.prihlaska_url || null,
        datum_text: a.datum_text || null,
        datum_od: a.datum_od || null,
        datum_do: a.datum_do || null,
        misto: a.misto || null,
        platba_typ: a.platba_typ || 'online',
        cena_czk: a.cena_czk === '' || a.cena_czk == null ? null : Number(a.cena_czk),
        cena_eur: a.cena_eur === '' || a.cena_eur == null ? null : Number(a.cena_eur),
        kapacita: a.kapacita === '' || a.kapacita == null ? null : parseInt(a.kapacita, 10),
        stav: a.stav || 'otevrena',
        aktivni: a.aktivni !== false,
        poradi: a.poradi == null ? 0 : parseInt(a.poradi, 10) || 0,
      };
      if (!rec.nazev) return res.status(400).json({ error: 'Akce musí mít název.' });

      // Obrázek: nový soubor přepíše, jinak se zachová stávající.
      if (body.obrazek_base64) {
        const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(body.obrazek_base64);
        if (!m) return res.status(400).json({ error: 'Neplatný formát obrázku.' });
        const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'Obrázek je větší než 6 MB.' });
        const baseSlug = rec.slug || slugify(a.nazev || 'akce');
        rec.obrazek_url = await supaUpload(`letaky/${baseSlug}-${Date.now()}.${ext}`, buf, m[1]);
      } else if (a.obrazek_url !== undefined) {
        // editor poslal stávající URL → zachovej ji (prázdné = odebrat)
        rec.obrazek_url = a.obrazek_url || null;
      }
      // jinak obrazek_url do rec vůbec nedáváme → PATCH ho nezmění

      let saved;
      if (a.id) {
        saved = await supaRest(`akce?id=eq.${a.id}`, { method: 'PATCH', prefer: 'return=representation', body: rec });
      } else {
        saved = await supaRest('akce', { method: 'POST', prefer: 'return=representation', body: [rec] });
      }
      return res.status(200).json({ ok: true, akce: saved[0] });
    }

    if (action === 'delete') {
      if (!body.id) return res.status(400).json({ error: 'Chybí id.' });
      await supaRest(`akce?id=eq.${body.id}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_stav') {
      if (!body.id || !['otevrena', 'obsazena', 'zrusena'].includes(body.stav))
        return res.status(400).json({ error: 'Neplatný stav.' });
      await supaRest(`akce?id=eq.${body.id}`, { method: 'PATCH', body: { stav: body.stav } });
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_aktivni') {
      if (!body.id) return res.status(400).json({ error: 'Chybí id.' });
      await supaRest(`akce?id=eq.${body.id}`, { method: 'PATCH', body: { aktivni: !!body.aktivni } });
      return res.status(200).json({ ok: true });
    }

    if (action === 'prihlasky') {
      const filtr = body.akce_id ? `&akce_id=eq.${body.akce_id}` : '';
      const rows = await supaRest(`prihlasky_akce?select=*${filtr}&order=vytvoreno.desc`);
      return res.status(200).json({ prihlasky: rows || [] });
    }

    if (action === 'mark') {
      const stavy = ['ceka_na_platbu', 'zaplaceno', 'na_miste', 'zdarma', 'zruseno'];
      if (!body.id || !stavy.includes(body.stav_platby))
        return res.status(400).json({ error: 'Neplatný stav platby.' });
      await supaRest(`prihlasky_akce?id=eq.${body.id}`, { method: 'PATCH', body: { stav_platby: body.stav_platby } });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Neznámá akce.' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
