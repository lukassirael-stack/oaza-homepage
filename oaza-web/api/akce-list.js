// akce-list.js — veřejné čtení akcí
// GET /api/akce-list            -> seznam publikovaných akcí (pro /akce)
// GET /api/akce-list?slug=xxx   -> detail jedné akce (pro detail stránku)

const { supaRest, cors } = require('./_lib');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Jen GET' });

  try {
    const slug = (req.query && req.query.slug) || null;

    // Bezpečný výběr sloupců (popis akce je veřejný)
    const cols = 'id,slug,nazev,popis,datum_text,datum_od,misto,obrazek_url,platba_typ,cena_czk,cena_eur,kapacita,stav,poradi,prihlaska_url';

    if (slug) {
      const rows = await supaRest(
        `akce?slug=eq.${encodeURIComponent(slug)}&aktivni=eq.true&select=${cols}`
      );
      if (!rows || !rows.length) return res.status(404).json({ error: 'Akce nenalezena' });
      const akce = rows[0];

      // počet přihlášených (kromě zrušených) — pro zobrazení volných míst
      const pr = await supaRest(
        `prihlasky_akce?akce_id=eq.${akce.id}&stav_platby=neq.zruseno&select=pocet_osob`
      );
      const obsazeno = (pr || []).reduce((s, r) => s + (r.pocet_osob || 1), 0);
      akce.obsazeno = obsazeno;
      akce.volno = akce.kapacita ? Math.max(0, akce.kapacita - obsazeno) : null;

      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      return res.status(200).json({ akce });
    }

    // seznam publikovaných akcí — jen ty, které ještě neproběhly
    // (datum_konec = koncové datum, jinak začátek; akce bez data se ponechá)
    const dnes = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Prague' }); // YYYY-MM-DD
    const rows = await supaRest(
      `akce?aktivni=eq.true&or=(datum_konec.gte.${dnes},datum_konec.is.null)&select=${cols}&order=poradi.asc,datum_od.asc`
    );
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ akce: rows || [] });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
