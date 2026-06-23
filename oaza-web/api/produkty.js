// api/produkty.js — veřejné API katalogu (jen čtení). Klíč zůstává na serveru.
// GET /api/produkty         → seznam dostupných produktů (bez popisů) + kategorie
// GET /api/produkty?slug=X  → jeden produkt v plném detailu

export default async function handler(req, res) {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!URL || !KEY) return res.status(500).json({ error: 'Chybí SUPABASE_URL / SUPABASE_SERVICE_KEY.' });

  async function rest(path) {
    const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error('GET ' + r.status);
    return r.json();
  }

  try {
    const slug = req.query && req.query.slug;

    if (slug) {
      const rows = await rest(`produkty?slug=eq.${encodeURIComponent(slug)}&stav=neq.skryto&limit=1`);
      if (!rows.length) return res.status(404).json({ error: 'Produkt nenalezen.' });
      const p = rows[0];
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
      return res.status(200).json({ produkt: {
        id: p.id, slug: p.slug, nazev: p.nazev, popis: p.popis, cena: p.cena, mena: p.mena,
        kategorie: p.kategorie, barva: p.barva, velikost: p.velikost,
        ucel: (p.vlastnosti && p.vlastnosti.ucel) || [],
        fotky: p.fotky || [], videa: p.videa || [], stav: p.stav, stitek: p.stitek,
      }});
    }

    // seznam – jen dostupné, bez popisů (lehké)
    const [produkty, kategorie] = await Promise.all([
      rest('produkty?stav=eq.skladem&select=id,slug,nazev,cena,kategorie,fotky,doporucujeme,stitek,barva,velikost,vlastnosti,vytvoreno&order=doporucujeme.desc,poradi.asc,vytvoreno.desc'),
      rest('kategorie?select=slug,nazev,poradi&order=poradi.asc'),
    ]);

    const lehke = produkty.map(p => ({
      slug: p.slug, nazev: p.nazev, cena: p.cena, kategorie: p.kategorie,
      fotky: (p.fotky || []).slice(0, 2), doporucujeme: p.doporucujeme, stitek: p.stitek,
      barva: p.barva || [], velikost: p.velikost || [],
      ucel: (p.vlastnosti && p.vlastnosti.ucel) || [],
      vytvoreno: p.vytvoreno,
    }));

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ produkty: lehke, kategorie });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
