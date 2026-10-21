// api/feedy.js — produktové XML feedy z jednoho zdroje (tabulka produkty v Supabase).
// GET /api/feedy?typ=google   → Google Merchant Center (RSS 2.0, ns g:)
// GET /api/feedy?typ=zbozi    → Zboží.cz (SHOP/SHOPITEM)
// GET /api/feedy?typ=heureka  → Heureka.cz (SHOP/SHOPITEM)
// Hezké adresy zajišťují rewrites ve vercel.json: /feed-google.xml, /feed-zbozi.xml, /feed-heureka.xml
// Zahrnuje jen fyzické produkty skladem, které nejsou momentálně rezervované a dají se poslat Zásilkovnou.
// Každý srovnávač má vlastní strom kategorií — kus se zařadí podle druhu (náušnice, krystal, sprej…)
// odvozeného z názvu a kategorie e-shopu. Názvy ve feedu jsou očištěné od marketingových dovětků
// a v rámci feedu jedinečné (srovnávače to vyžadují).

const WEB = 'https://oaza-adamanthea.cz';
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const ZNACKA = 'Bali Shop';
// označení zdroje v odkazech → vlastní analytika (bez cookies) pozná návštěvy ze srovnávačů
const UTM = {
  google: 'utm_source=google&utm_medium=nakupy',
  heureka: 'utm_source=heureka&utm_medium=srovnavac',
  zbozi: 'utm_source=zbozi&utm_medium=srovnavac',
};
const ODESLANI_DNU = 3; // web slibuje odeslání do 3 pracovních dnů
// Doprava podle obchodních podmínek (bez dobírky — platí se předem kartou / QR).
const DOPRAVA = [
  { id: 'ZASILKOVNA', cena: 89, google: 'Zásilkovna – výdejní místo' },
  { id: 'ZASILKOVNA_NA_ADRESU', cena: 129, google: 'Zásilkovna – doručení na adresu' },
];
// Kusy jen k osobnímu vyzvednutí (velké krystaly) do srovnávačů nepatří.
const JEN_OSOBNE = /vyzvednut[ií] v našem centru|osobní (?:odběr|převzetí)|individuáln[ií] doprav/i;

// ---------- Druh kusu ----------
const JE_OBLECENI = /(overal|komplet|šaty|tílko|tričko|pončo|poncho|ponchetto|svetr|sukn|kalhoty|\btop\b)/i;

// Velikost z popisu („Vel. M“, „Velikost univerzální S-L“, „Sedí na velikost S-L“, „Vel. Xl-Xxl“)
function velikostZPopisu(popis) {
  const m = String(popis || '').match(/\b(?:vel\.?|velikost)\s*(?:je\s*)?(?:univerzální\s*)?([SMLX]{1,3}(?:\s*[-–/]\s*[SMLX]{1,3})?|univerzální|uni)\b/i);
  if (!m) return '';
  const v = m[1].replace(/\s*[-–/]\s*/, '-');
  return /^uni/i.test(v) ? 'univerzální' : v.toUpperCase();
}

function druhKusu(nazev, slug) {
  const n = String(nazev || '').toLowerCase();
  if (/náušnic/.test(n)) return 'nausnice';
  if (/náramek|náramk/.test(n)) return 'naramek';
  if (/prsten/.test(n)) return 'prsten';
  if (/náhrdelník/.test(n)) return 'nahrdelnik';
  if (/přívěsek|amulet/.test(n)) return 'privesek';
  if (/kabelk/.test(n)) return 'kabelka';
  if (/šátek|sarong|\bšál/.test(n)) return 'satek';
  if (/pásek|pásky|opasek/.test(n)) return 'pasek';
  if (/lapač snů/.test(n)) return 'lapac';
  if (/obraz|malovan/.test(n)) return 'obraz';
  if (/maska/.test(n)) return 'maska';
  if (/sigil|flow disc/.test(n)) return 'artefakt';
  if (/strom života|květ života|\bohm\b|hamsa|vyřezáva|dřevo|ozdoba/.test(n)) return 'drevo';
  if (/křišťál|krystal|ametyst|apofylit|drúza|koule/.test(n) || slug === 'krystaly') return 'krystal';
  if (/sprej/.test(n)) return 'sprej';
  if (slug === 'esence') return 'olej';
  if (/balíček/.test(n) || slug === 'darkove-sety') return 'set';
  if (slug === 'sperky') return 'privesek';
  return 'dekorace';
}

// Oblečení — sekce podle druhu kusu v každém stromu zvlášť.
function modniSekce(typ, nazev) {
  const n = String(nazev || '').toLowerCase();
  const pansky = /^pánsk/.test(n);
  const tilko = /tílko/.test(n);
  let d = 'saty';
  if (pansky) d = tilko ? 'pan_tilko' : 'pan_tricko';
  else if (/overal/.test(n)) d = 'overal';
  else if (/komplet/.test(n)) d = 'komplet';
  else if (/kalhoty/.test(n)) d = 'kalhoty';
  else if (/sukn/.test(n)) d = 'sukne';
  else if (/(tílko|\btop\b|tričko)/.test(n)) d = 'tricko';
  else if (/(svetř|svetr|pončo|poncho|ponchetto)/.test(n)) d = 'svetr';

  if (typ === 'zbozi') {
    const D = 'Oblečení a móda | Dámská móda | Dámské oblečení';
    const P = 'Oblečení a móda | Pánská móda | Pánské oblečení | Pánská trička, tílka a košile';
    return {
      pan_tricko: `${P} | Pánská trička`, pan_tilko: `${P} | Pánská tílka`,
      overal: `${D} | Dámské overaly`, komplet: `${D} | Dámské komplety`,
      kalhoty: `${D} | Dámské kalhoty a kraťasy | Dámské kalhoty`, sukne: `${D} | Dámské sukně`,
      tricko: `${D} | Dámská trička, tílka a košile | Dámská tílka a topy`,
      svetr: `${D} | Dámské svetry`, saty: `${D} | Dámské šaty`,
    }[d];
  }
  if (typ === 'google') {
    const C = 'Apparel & Accessories > Clothing';
    return {
      pan_tricko: `${C} > Shirts & Tops`, pan_tilko: `${C} > Shirts & Tops`,
      overal: `${C} > One-Pieces > Jumpsuits & Rompers`, komplet: `${C} > Outfit Sets`,
      kalhoty: `${C} > Pants`, sukne: `${C} > Skirts`, tricko: `${C} > Shirts & Tops`,
      svetr: `${C} > Shirts & Tops`, saty: `${C} > Dresses`,
    }[d];
  }
  // Heureka
  const M = 'Oblečení, obuv a doplňky';
  return {
    pan_tricko: `${M} | Pánské oblečení | Pánská trička a tílka`, pan_tilko: `${M} | Pánské oblečení | Pánská trička a tílka`,
    overal: `${M} | Dámské oblečení | Dámské overaly`, komplet: `${M} | Dámské oblečení | Dámské komplety`,
    kalhoty: `${M} | Dámské oblečení | Dámské kalhoty`, sukne: `${M} | Dámské oblečení | Dámské sukně`,
    tricko: `${M} | Dámské oblečení | Dámská trička a tílka`, svetr: `${M} | Dámské oblečení | Dámské mikiny a svetry`,
    saty: `${M} | Dámské oblečení | Dámské šaty`,
  }[d];
}

// Ostatní druhy — strom Zboží.cz (ověřené cesty z categories.csv), Heureka a Google taxonomie.
const SEKCE = (() => {
  const zS = 'Oblečení a móda | Módní doplňky | Šperky';
  const zDek = 'Dům, byt a zahrada | Bydlení a doplňky | Bytový textil, doplňky a dekorace | Bytové dekorace';
  const hS = 'Hodinky a šperky | Šperky';
  const hDek = 'Bydlení a doplňky | Bytové dekorace';
  const gJ = 'Apparel & Accessories > Jewelry';
  const gDek = 'Home & Garden > Decor';
  return {
    zbozi: {
      nausnice: `${zS} | Náušnice`, naramek: `${zS} | Náramky`, prsten: `${zS} | Prsteny`,
      nahrdelnik: `${zS} | Náhrdelníky`, privesek: `${zS} | Přívěsky`,
      kabelka: 'Oblečení a móda | Módní doplňky | Tašky a zavazadla | Kabelky',
      satek: 'Oblečení a móda | Módní doplňky | Šátky a šály | Šátky',
      pasek: 'Oblečení a móda | Módní doplňky | Opasky',
      lapac: zDek, drevo: zDek, dekorace: zDek, artefakt: zDek, maska: zDek, krystal: zDek,
      obraz: `${zDek} | Obrazy`,
      sprej: 'Kosmetika a drogerie | Drogerie | Vůně do bytu',
      olej: 'Kosmetika a drogerie | Kosmetika | Aromaterapie | Esenciální oleje',
      set: 'Kultura a zábava | Volný čas | Oslavy a dárky | Dárkové sady',
    },
    heureka: {
      nausnice: `${hS} | Náušnice`, naramek: `${hS} | Náramky`, prsten: `${hS} | Prsteny`,
      nahrdelnik: `${hS} | Náhrdelníky`, privesek: `${hS} | Přívěsky`,
      kabelka: 'Oblečení, obuv a doplňky | Kabelky a tašky | Kabelky',
      satek: 'Oblečení, obuv a doplňky | Módní doplňky | Šátky a šály',
      pasek: 'Oblečení, obuv a doplňky | Módní doplňky | Pásky',
      lapac: hDek, drevo: hDek, dekorace: hDek, artefakt: hDek, maska: hDek, krystal: hDek,
      obraz: `${hDek} | Obrazy`,
      sprej: `${hDek} | Vůně do bytu a svíčky`,
      olej: 'Kosmetika a zdraví | Aromaterapie | Esenciální oleje',
      set: 'Dárkové sety | Balíčky s krystaly',
    },
    google: {
      nausnice: `${gJ} > Earrings`, naramek: `${gJ} > Bracelets`, prsten: `${gJ} > Rings`,
      nahrdelnik: `${gJ} > Necklaces`, privesek: `${gJ} > Charms & Pendants`,
      kabelka: 'Apparel & Accessories > Handbags, Wallets & Cases > Handbags',
      satek: 'Apparel & Accessories > Clothing Accessories > Scarves & Shawls',
      pasek: 'Apparel & Accessories > Clothing Accessories > Belts',
      lapac: `${gDek} > Dreamcatchers`, drevo: `${gDek} > Figurines`, dekorace: gDek,
      artefakt: gDek, maska: `${gDek} > Artwork > Sculptures & Statues`,
      krystal: 'Arts & Entertainment > Hobbies & Creative Arts > Collectibles > Rocks & Fossils',
      obraz: `${gDek} > Artwork > Posters, Prints, & Visual Artwork`,
      sprej: `${gDek} > Home Fragrances`,
      olej: 'Health & Beauty > Personal Care > Cosmetics > Perfume & Cologne',
      set: gDek,
    },
  };
})();

// ---------- Názvy ----------
// Marketingové dovětky do názvu nepatří (pravidla pojmenování Zboží.cz i Heureky).
function cistyNazev(n) {
  return String(n || '')
    .replace(/\s*[-–]?\s*nyní k dispozici\s*(?:pouze\s*)?/i, ' ')
    .replace(/\b(?:TOP\s+)?novinka\b/gi, ' ')
    .replace(/\bNOVÉ barvy\b/gi, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}

const MOTIVY = [
  [/čakr/i, 'čakry'], [/květ\w* života/i, 'Květ života'], [/strom\w* života/i, 'Strom života'],
  [/lotos/i, 'lotos'], [/mandal/i, 'mandala'], [/hamsa/i, 'Hamsa'], [/buddh/i, 'Buddha'],
];
// Stejný název u více kusů → doplnit motiv z popisu, velikost nebo barvu; jinak pořadové číslo.
function odlisNazvy(items) {
  const pocty = {};
  for (const it of items) pocty[it.titul] = (pocty[it.titul] || 0) + 1;
  const videno = {};
  for (const it of items) {
    if (pocty[it.titul] < 2) continue;
    const detaily = [];
    const motiv = MOTIVY.find(([re]) => re.test(it.popis));
    if (motiv && !new RegExp(motiv[1], 'i').test(it.titul)) detaily.push(motiv[1]);
    if (it.velikost && !it.titul.includes(it.velikost)) detaily.push(/^univerz/i.test(it.velikost) ? it.velikost : `vel. ${it.velikost}`);
    else if (it.barva && !it.titul.includes(it.barva)) detaily.push(it.barva);
    let novy = [it.titul, ...detaily].join(' ');
    videno[novy] = (videno[novy] || 0) + 1;
    if (videno[novy] > 1) novy += ` (${videno[novy]})`;
    it.titul = novy;
  }
  return items;
}

const param = (jmeno, hodnota) => `  <PARAM>
    <PARAM_NAME>${esc(jmeno)}</PARAM_NAME>
    <VAL>${esc(hodnota)}</VAL>
  </PARAM>`;

const dopravaXml = () => DOPRAVA.map(d => `  <DELIVERY>
    <DELIVERY_ID>${d.id}</DELIVERY_ID>
    <DELIVERY_PRICE>${d.cena}</DELIVERY_PRICE>
  </DELIVERY>`).join('\n');

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
      rest('produkty?stav=eq.skladem&select=id,slug,nazev,popis,cena,digitalni,kategorie,fotky,rezervovano_do,velikost,barva,material&order=vytvoreno.desc&limit=1000'),
      rest('kategorie?select=slug,nazev'),
    ]);
    const katMapa = {};
    for (const k of kategorie) katMapa[k.slug] = k.nazev;

    const ted = new Date();
    const produkty = radky.filter(p =>
      !p.digitalni
      && !(p.rezervovano_do && new Date(p.rezervovano_do) > ted)
      && !JEN_OSOBNE.test(String(p.popis || ''))
    );

    const polozka = p => {
      const popis = String(p.popis || '').replace(/\s+/g, ' ').trim()
        || `Ručně vybraný kus z Bali Shopu Oázy Adamanthea — ${p.nazev}.`;
      const nazev = cistyNazev(p.nazev);
      // Oblečení = kategorie Šaty, nebo kus poznaný podle názvu (overal, komplet, pánské tričko…).
      const obleceni = p.kategorie === 'saty' || JE_OBLECENI.test(nazev);
      // Velikost z adminu, jinak z popisu; kusy z Bali bez údaje jsou univerzální (doplň v adminu, kde to neplatí).
      const velikost = (p.velikost || []).filter(Boolean)[0] || velikostZPopisu(popis)
        || (obleceni && p.kategorie !== 'saty' ? 'univerzální' : '');
      return {
        id: p.id,
        nazev,
        popis,
        url: `${WEB}/produkt/${encodeURIComponent(p.slug)}?${UTM[typ]}`,
        foto: (p.fotky || [])[0] || '',
        dalsiFotky: (p.fotky || []).slice(1, 6),
        cena: Number(p.cena || 0),
        kategorie: katMapa[p.kategorie] || p.kategorie || 'Bali Shop',
        obleceni,
        druh: druhKusu(nazev, p.kategorie),
        velikost,
        barva: (p.barva || []).filter(Boolean).join(', '),
        material: (p.material || []).filter(m => m && !/velikost/i.test(m)).join(', '),
      };
    };

    let xml = '';

    if (typ === 'google') {
      const items = odlisNazvy(produkty.map(polozka).map(p => ({ ...p, titul: p.nazev })));
      const xmlItems = items.map(p => {
        const gKat = p.obleceni ? modniSekce('google', p.nazev) : SEKCE.google[p.druh];
        return `  <item>
    <g:id>${p.id}</g:id>
    <g:title>${esc(p.titul)}</g:title>
    <g:description>${esc(p.popis)}</g:description>
    <g:link>${esc(p.url)}</g:link>
    <g:image_link>${esc(p.foto)}</g:image_link>
${p.dalsiFotky.map(f => `    <g:additional_image_link>${esc(f)}</g:additional_image_link>`).join('\n')}
    <g:price>${p.cena}.00 CZK</g:price>
    <g:availability>in_stock</g:availability>
    <g:condition>new</g:condition>
    <g:identifier_exists>no</g:identifier_exists>
${p.obleceni ? `    <g:brand>${esc(ZNACKA)}</g:brand>\n` : ''}${gKat ? `    <g:google_product_category>${esc(gKat)}</g:google_product_category>\n` : ''}    <g:product_type>${esc(p.kategorie)}</g:product_type>
    <g:shipping>
      <g:country>CZ</g:country>
      <g:service>${esc(DOPRAVA[0].google)}</g:service>
      <g:price>${DOPRAVA[0].cena}.00 CZK</g:price>
    </g:shipping>
  </item>`;
      }).join('\n');

      xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>Bali Shop — Oáza Adamanthea</title>
  <link>${WEB}/bali-shop</link>
  <description>Krystaly, šaty, šperky, esence a poklady z Bali.</description>
${xmlItems}
</channel>
</rss>\n`;
    } else {
      // Zboží.cz i Heureka sdílejí strukturu SHOP/SHOPITEM, liší se jmenným prostorem a stromem kategorií.
      const ns = typ === 'zbozi'
        ? ' xmlns="http://www.zbozi.cz/ns/offer/1.0"'
        : ' xmlns="http://www.heureka.cz/ns/offer/1.0"';
      // Oblečení jde do srovnávačů jen s vyplněnou velikostí (povinný PARAM); název = značka + kus + velikost
      // (velikost se připojí jen tehdy, když ji název ještě neobsahuje).
      const maVelikost = (nazev, vel) => new RegExp(`(^|[\\s.])${vel.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?=$|[\\s,.)])`, 'i').test(nazev);
      const items = odlisNazvy(
        produkty.map(polozka)
          .filter(p => !p.obleceni || p.velikost)
          .map(p => ({ ...p, titul: p.obleceni && !maVelikost(p.nazev, p.velikost) ? `${ZNACKA} ${p.nazev} ${p.velikost}` : (p.obleceni ? `${ZNACKA} ${p.nazev}` : p.nazev) }))
      );
      const xmlItems = items.map(p => {
        const sekce = p.obleceni ? modniSekce(typ, p.nazev) : SEKCE[typ][p.druh];
        const parametry = p.obleceni ? [
          param('Velikost', p.velikost),
          p.barva ? param('Barva', p.barva) : '',
          p.material ? param('Materiál', p.material) : '',
        ].filter(Boolean).join('\n') : '';
        return `<SHOPITEM>
  <ITEM_ID>${p.id}</ITEM_ID>
  <PRODUCTNAME>${esc(p.titul)}</PRODUCTNAME>
  <DESCRIPTION>${esc(p.popis)}</DESCRIPTION>
  <URL>${esc(p.url)}</URL>
  <IMGURL>${esc(p.foto)}</IMGURL>
${p.dalsiFotky.map(f => `  <IMGURL_ALTERNATIVE>${esc(f)}</IMGURL_ALTERNATIVE>`).join('\n')}
  <PRICE_VAT>${p.cena}</PRICE_VAT>
${p.obleceni ? `  <MANUFACTURER>${esc(ZNACKA)}</MANUFACTURER>\n` : ''}  <DELIVERY_DATE>${ODESLANI_DNU}</DELIVERY_DATE>
${dopravaXml()}
  <CATEGORYTEXT>${esc(sekce)}</CATEGORYTEXT>
${parametry ? parametry + '\n' : ''}</SHOPITEM>`;
      }).join('\n');

      xml = `<?xml version="1.0" encoding="utf-8"?>\n<SHOP${ns}>\n${xmlItems}\n</SHOP>\n`;
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=21600');
    return res.status(200).send(xml);
  } catch (e) {
    return res.status(500).send('Chyba feedu: ' + String(e.message || e).slice(0, 200));
  }
}
