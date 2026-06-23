// api/eshop-rehost.js — jednorázové přehostování fotek z Wixu do Supabase Storage
// Běží po dávkách, je resumovatelné (přeskakuje už přehostované). Chráněno ESHOP_HESLO.

export const maxDuration = 60; // sekund (Vercel)

const BUCKET = 'eshop';
const DAVKA_FOTEK = 10;        // kolik fotek max za jedno volání

const jeWix = u => typeof u === 'string' && u.includes('static.wixstatic.com');

// z Wix originálu udělá zmenšenou variantu (max 1400 px, q80) – šetří úložiště
function zmensenaWixUrl(u) {
  const base = u.split('/v1/')[0]; // odřízne případnou existující transformaci
  return base + '/v1/fit/w_1400,h_1400,al_c,q_80,enc_auto/file.jpg';
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
        try {
          let r = await fetch(zmensenaWixUrl(nove[i]));
          if (!r.ok) r = await fetch(nove[i]); // fallback na originál
          if (!r.ok) throw new Error('stažení ' + r.status);
          const ct = r.headers.get('content-type') || 'image/jpeg';
          const ext = ct.includes('webp') ? 'webp' : ct.includes('png') ? 'png' : 'jpg';
          const buf = Buffer.from(await r.arrayBuffer());
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
      if (zmena) await restPATCH(`produkty?id=eq.${p.id}`, { fotky: nove });
    }

    // kolik produktů ještě zbývá po této dávce
    const po = await restGET('produkty?select=id,fotky&order=id');
    const zbyva = po.filter(p => (p.fotky || []).some(jeWix)).length;

    return res.status(200).json({ zpracovano, chyby, zbyva_produktu: zbyva, celkem_produktu: celkemProduktu });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
