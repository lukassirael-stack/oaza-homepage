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

  // kurz EUR (Kč za 1 €) z nastavení, fallback 25
  async function kurzEur() {
    try {
      const n = await rest("nastaveni?klic=eq.kurz_eur&select=hodnota&limit=1");
      const v = n && n[0] && parseFloat(n[0].hodnota);
      return v && v > 0 ? v : 25;
    } catch { return 25; }
  }
  const eur = (czk, override, kurz) =>
    (override != null) ? override : Math.round(czk / kurz);

  try {
    const slug = req.query && req.query.slug;
    const kurz = await kurzEur();

    if (slug) {
      const rows = await rest(`produkty?slug=eq.${encodeURIComponent(slug)}&stav=neq.skryto&limit=1`);
      if (!rows.length) return res.status(404).json({ error: 'Produkt nenalezen.' });
      const p = rows[0];
      const rezervovano = !!(p.rezervovano_do && new Date(p.rezervovano_do) > new Date());
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
      return res.status(200).json({ kurz, produkt: {
        id: p.id, slug: p.slug, nazev: p.nazev, popis: p.popis, cena: p.cena,
        cena_eur: eur(p.cena, p.cena_eur, kurz), digitalni: !!p.digitalni,
        kategorie: p.kategorie, barva: p.barva, velikost: p.velikost,
        ucel: (p.vlastnosti && p.vlastnosti.ucel) || [],
        fotky: p.fotky || [], videa: p.videa || [], stav: p.stav, stitek: p.stitek,
        rezervovano,
      }});
    }

    // seznam – jen dostupné, bez popisů (lehké)
    const [produkty, kategorie] = await Promise.all([
      rest('produkty?stav=eq.skladem&select=id,slug,nazev,cena,cena_eur,digitalni,kategorie,fotky,doporucujeme,stitek,barva,velikost,vlastnosti,vytvoreno,rezervovano_do&order=doporucujeme.desc,poradi.asc,vytvoreno.desc'),
      rest('kategorie?select=slug,nazev,poradi&order=poradi.asc'),
    ]);

    const ted = new Date();
    const dostupne = produkty.filter(p => !(p.rezervovano_do && new Date(p.rezervovano_do) > ted));

    const lehke = dostupne.map(p => ({
      slug: p.slug, nazev: p.nazev, cena: p.cena, cena_eur: eur(p.cena, p.cena_eur, kurz),
      digitalni: !!p.digitalni, kategorie: p.kategorie,
      fotky: (p.fotky || []).slice(0, 2), doporucujeme: p.doporucujeme, stitek: p.stitek,
      barva: p.barva || [], velikost: p.velikost || [],
      ucel: (p.vlastnosti && p.vlastnosti.ucel) || [],
      vytvoreno: p.vytvoreno,
    }));

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ kurz, produkty: lehke, kategorie });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
