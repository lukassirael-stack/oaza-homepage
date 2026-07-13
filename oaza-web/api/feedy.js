// api/feedy.js — produktové XML feedy z jednoho zdroje (tabulka produkty v Supabase).
// GET /api/feedy?typ=google   → Google Merchant Center (RSS 2.0, ns g:)
// GET /api/feedy?typ=zbozi    → Zboží.cz (SHOP/SHOPITEM)
// GET /api/feedy?typ=heureka  → Heureka.cz (SHOP/SHOPITEM)
// Hezké adresy zajišťují rewrites ve vercel.json: /feed-google.xml, /feed-zbozi.xml, /feed-heureka.xml
// Zahrnuje jen fyzické produkty skladem, které nejsou momentálně rezervované.

const WEB = 'https://oaza-adamanthea.cz';
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export default async function handler(req, res) {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!URL || !KEY) return res.status(500).send('Chybí SUPABASE_URL / SUPABASE_SERVICE_KEY.');

  async function rest(path) {
    const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error('GET ' + r.status);
    return r.json();
  }

  const typ = (req.query && req.query.typ) || '';
  if (!['google', 'zbozi', 'heureka'].includes(typ)) {
    return res.status(400).send('Neznámý typ feedu. Použij ?typ=google | zbozi | heureka');
  }

  try {
    const [radky, kategorie] = await Promise.all([
      rest('produkty?stav=eq.skladem&select=id,slug,nazev,popis,cena,digitalni,kategorie,fotky,rezervovano_do&order=vytvoreno.desc&limit=1000'),
      rest('kategorie?select=slug,nazev'),
    ]);
    const katMapa = {};
    for (const k of kategorie) katMapa[k.slug] = k.nazev;

    const ted = new Date();
    const produkty = radky.filter(p =>
      !p.digitalni && !(p.rezervovano_do && new Date(p.rezervovano_do) > ted)
    );

    const polozka = p => ({
      id: p.id,
      nazev: p.nazev,
      popis: String(p.popis || '').replace(/\s+/g, ' ').trim()
        || `Ručně vybraný kus z Bali Shopu Oázy Adamanthea — ${p.nazev}.`,
      url: `${WEB}/produkt/${encodeURIComponent(p.slug)}`,
      foto: (p.fotky || [])[0] || '',
      dalsiFotky: (p.fotky || []).slice(1, 6),
      cena: Number(p.cena || 0),
      kategorie: katMapa[p.kategorie] || p.kategorie || 'Bali Shop',
    });

    let xml = '';

    if (typ === 'google') {
      const items = produkty.map(polozka).map(p => `  <item>
    <g:id>${p.id}</g:id>
    <g:title>${esc(p.nazev)}</g:title>
    <g:description>${esc(p.popis)}</g:description>
    <g:link>${esc(p.url)}</g:link>
    <g:image_link>${esc(p.foto)}</g:image_link>
${p.dalsiFotky.map(f => `    <g:additional_image_link>${esc(f)}</g:additional_image_link>`).join('\n')}
    <g:price>${p.cena}.00 CZK</g:price>
    <g:availability>in_stock</g:availability>
    <g:condition>new</g:condition>
    <g:identifier_exists>no</g:identifier_exists>
    <g:product_type>${esc(p.kategorie)}</g:product_type>
  </item>`).join('\n');

      xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>Bali Shop — Oáza Adamanthea</title>
  <link>${WEB}/bali-shop</link>
  <description>Krystaly, šaty, šperky, esence a poklady z Bali.</description>
${items}
</channel>
</rss>\n`;
    } else {
      // Zboží.cz i Heureka sdílejí strukturu SHOP/SHOPITEM, liší se jmenným prostorem.
      const ns = typ === 'zbozi'
        ? ' xmlns="http://www.zbozi.cz/ns/offer/1.0"'
        : ' xmlns="http://www.heureka.cz/ns/offer/1.0"';
      const items = produkty.map(polozka).map(p => `<SHOPITEM>
  <ITEM_ID>${p.id}</ITEM_ID>
  <PRODUCTNAME>${esc(p.nazev)}</PRODUCTNAME>
  <DESCRIPTION>${esc(p.popis)}</DESCRIPTION>
  <URL>${esc(p.url)}</URL>
  <IMGURL>${esc(p.foto)}</IMGURL>
${p.dalsiFotky.map(f => `  <IMGURL_ALTERNATIVE>${esc(f)}</IMGURL_ALTERNATIVE>`).join('\n')}
  <PRICE_VAT>${p.cena}</PRICE_VAT>
  <DELIVERY_DATE>0</DELIVERY_DATE>
  <CATEGORYTEXT>${esc(p.kategorie)}</CATEGORYTEXT>
</SHOPITEM>`).join('\n');

      xml = `<?xml version="1.0" encoding="utf-8"?>\n<SHOP${ns}>\n${items}\n</SHOP>\n`;
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=21600');
    return res.status(200).send(xml);
  } catch (e) {
    return res.status(500).send('Chyba feedu: ' + String(e.message || e).slice(0, 200));
  }
}
