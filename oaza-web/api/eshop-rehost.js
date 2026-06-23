// api/eshop-rehost.js — jednorázové přehostování fotek z Wixu do Supabase Storage
// Běží po dávkách, je resumovatelné (přeskakuje už přehostované). Chráněno ESHOP_HESLO.

export const maxDuration = 60; // sekund (Vercel)

const BUCKET = 'eshop';
const DAVKA_FOTEK = 5;         // menší dávka – šetrnější k Wixu
const PAUZA_MS = 1500;         // pauza mezi fotkami, ať nás Wix nebere jako bota
const spi = ms => new Promise(r => setTimeout(r, ms));

const jeWix = u => typeof u === 'string' && u.includes('static.wixstatic.com');

// vrátí seřazený seznam adres ke zkoušení (pokryje ~mv2.jpg i holé id i jiné přípony)
function kandidati(u) {
  const base = u.split('/v1/')[0];
  const T = '/v1/fit/w_1400,h_1400,al_c,q_80,enc_auto/file.jpg';
  if (/~mv2\.\w+$/i.test(base)) return [base + T, base];           // už má příponu
  return [                                                          // holé id – doplníme
    base + '~mv2.jpg' + T, base + T, base + '~mv2.png' + T,
    base + '~mv2.webp' + T, base + '~mv2.jpg', base,
  ];
}
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'Accept-Language': 'cs,en;q=0.8',
  'Referer': 'https://www.oaza-adamanthea.cz/',
};
async function stahni(u) {
  for (const url of kandidati(u)) {
    try {
      const r = await fetch(url, { headers: UA });
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.startsWith('image/')) return { r, ct };
    } catch (e) { /* zkus další tvar */ }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Použij POST.' });

  const spravne = process.env.ESHOP_HESLO;
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!spravne) return res.status(500).json({ error: 'ESHOP_HESLO není nastaveno.' });
  if (!URL || !KEY) return res.status(500).json({ error: 'Chybí SUPABASE_URL / SUPABASE_SERVICE_KEY.' });
  if ((req.headers['x-heslo'] || '') !== spravne) return res.status(401).json({ error: 'Neplatné heslo.' });

  async function restGET(path) {
    const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error('GET ' + r.status);
    return r.json();
  }
  async function restPATCH(path, body) {
    const r = await fetch(`${URL}/rest/v1/${path}`, {
      method: 'PATCH',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('PATCH ' + r.status + ' ' + (await r.text()).slice(0, 120));
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    // DIAGNOSTIKA: vrátí skutečné stavové kódy pro vzorek fotek
    if (body.action === 'diag') {
      const produkty = await restGET('produkty?select=id,fotky&order=id');
      const potreba = produkty.filter(p => (p.fotky || []).some(jeWix));
      const vzorek = [];
      for (const p of potreba.slice(0, 3)) {
        const url = (p.fotky || []).find(jeWix);
        const pokusy = [];
        for (const k of kandidati(url)) {
          try {
            const r = await fetch(k, { headers: UA });
            pokusy.push({ url: k.slice(0, 110), status: r.status, ct: (r.headers.get('content-type') || '').slice(0, 30) });
            if (r.ok) break;
          } catch (e) { pokusy.push({ url: k.slice(0, 110), chyba: String(e.message || e).slice(0, 60) }); }
        }
        vzorek.push({ puvodni: url.slice(0, 90), pokusy });
      }
      return res.status(200).json({ diag: vzorek, zbyva: potreba.length });
    }

    const produkty = await restGET('produkty?select=id,fotky&order=id');
    const potreba = produkty.filter(p => (p.fotky || []).some(jeWix));
    const celkemProduktu = potreba.length;

    let budget = DAVKA_FOTEK, zpracovano = 0, chyby = 0;

    for (const p of potreba) {
      if (budget <= 0) break;
      const nove = [...(p.fotky || [])];
      let zmena = false;
      for (let i = 0; i < nove.length && budget > 0; i++) {
        if (!jeWix(nove[i])) continue;
        await spi(PAUZA_MS); // šetrná pauza před každým stažením
        try {
          const got = await stahni(nove[i]);
          if (!got) throw new Error('nedostupné');
          const ct = got.ct;
          const ext = ct.includes('webp') ? 'webp' : ct.includes('png') ? 'png' : 'jpg';
          const buf = Buffer.from(await got.r.arrayBuffer());
          const path = `${p.id}/${i}.${ext}`;
          const up = await fetch(`${URL}/storage/v1/object/${BUCKET}/${path}`, {
            method: 'POST',
            headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': ct, 'x-upsert': 'true' },
            body: buf,
          });
          if (!up.ok) throw new Error('upload ' + up.status + ' ' + (await up.text()).slice(0, 80));
          nove[i] = `${URL}/storage/v1/object/public/${BUCKET}/${path}`;
          zmena = true; budget--; zpracovano++;
        } catch (e) {
          chyby++; budget--; // počítáme do budgetu, ať se nezasekneme na jedné vadné fotce
        }
      }
      if (zmena) {
        try { await restPATCH(`produkty?id=eq.${p.id}`, { fotky: nove }); }
        catch (e) { /* přeskoč, příště se zkusí znovu */ }
      }
    }

    // kolik produktů ještě zbývá po této dávce
    const po = await restGET('produkty?select=id,fotky&order=id');
    const zbyva = po.filter(p => (p.fotky || []).some(jeWix)).length;

    return res.status(200).json({ zpracovano, chyby, zbyva_produktu: zbyva, celkem_produktu: celkemProduktu });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
