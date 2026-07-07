#!/usr/bin/env node
/**
 * generuj-akce.mjs — Oáza Adamanthea
 * ----------------------------------
 * „Zapéká" aktuální akce přímo do oaza-web/akce.html, aby je viděly vyhledávače
 * i AI nástroje (ChatGPT, Claude, Perplexity, Gemini), které nespouští JavaScript.
 *
 * Je to JEDINÝ soubor, který je potřeba. Při prvním běhu si sám upraví akce.html
 * (vloží značky a přepne načítání na tichý fallback). Od té chvíle jen doplňuje
 * aktuální seznam akcí mezi značky.
 *
 * Běží automaticky každou noc přes GitHub Action (viz .github/workflows/generuj-akce.yml).
 *
 * Ruční spuštění:
 *   node generuj-akce.mjs
 *
 * Bezpečnost: když API selže, skript spadne s chybou a NIC nezapíše —
 * web zůstane v posledním funkčním stavu. JavaScript na stránce zůstává funkční:
 * po načtení dál stáhne živá data z API a obsah překreslí; při chybě ponechá
 * zapečený obsah, takže /akce nikdy nezůstane prázdné.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOREN   = dirname(fileURLToPath(import.meta.url));
// akce.html hledáme buď ve vlastní složce (když skript leží v oaza-web/),
// nebo v podsložce oaza-web/ (když skript leží v kořeni repa) — funguje v obou případech
const KANDIDATI = [
  join(KOREN, 'akce.html'),
  join(KOREN, 'oaza-web', 'akce.html')
];
const SOUBOR  = KANDIDATI.find(existsSync);
const API_URL = 'https://oaza-adamanthea.cz/api/akce-list';

if(!SOUBOR){
  console.error('Nenašel jsem akce.html (hledal jsem: ' + KANDIDATI.join(', ') + '). Generování zastaveno.');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/*  Načtení akcí z živého API                                          */
/* ------------------------------------------------------------------ */

async function nactiAkce(){
  // volitelně --vstup soubor.json pro lokální testování
  const arg = process.argv.indexOf('--vstup');
  if(arg !== -1){
    const data = JSON.parse(readFileSync(process.argv[arg + 1], 'utf8'));
    const a = Array.isArray(data) ? data : data.akce;
    if(!Array.isArray(a)) throw new Error('Vstupní soubor neobsahuje pole akcí.');
    return a;
  }
  const r = await fetch(API_URL, { headers: { accept: 'application/json' } });
  if(!r.ok) throw new Error(`API vrátilo stav ${r.status} — generování zastaveno, nic nebylo změněno.`);
  const data = await r.json();
  if(!data || !Array.isArray(data.akce)) throw new Error('API nevrátilo pole „akce" — generování zastaveno.');
  return data.akce;
}

/* ------------------------------------------------------------------ */
/*  Pomocné funkce (shodné s tím, co kreslí JavaScript na /akce)       */
/* ------------------------------------------------------------------ */

function esc(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(x){ return Number(x).toLocaleString('cs-CZ'); }
function zkrat(s, n = 140){
  if(!s) return '';
  const t = String(s).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}
function cenaText(a){
  if(a.platba_typ === 'zdarma') return 'Vstup zdarma';
  const c = [];
  if(a.cena_czk != null) c.push(fmt(a.cena_czk) + ' Kč');
  if(a.cena_eur != null) c.push(fmt(a.cena_eur) + ' €');
  let t = c.join(' / ');
  if(a.platba_typ === 'na_miste' && t) t += ' (na místě)';
  return t;
}

const STAVY = {
  otevrena: { cls:'',       txt:'' },
  obsazena: { cls:'full',   txt:'Obsazeno' },
  zrusena:  { cls:'cancel', txt:'Zrušeno' }
};

function kartaAkce(a){
  const st    = STAVY[a.stav] || STAVY.otevrena;
  const badge = st.txt ? `<span class="badge ${st.cls}">${st.txt}</span>` : '';
  const img   = a.obrazek_url
    ? `<img src="${esc(a.obrazek_url)}" alt="${esc((a.nazev||'').replace(/"/g,''))}" loading="lazy">`
    : `<div class="ph">Oáza Adamanthea</div>`;
  const cena  = cenaText(a);
  return `<a class="card ${a.stav==='zrusena'?'cancelled':''}" href="/akce/${encodeURIComponent(a.slug)}">
        <div class="thumb">${img}${badge}</div>
        <div class="body">
          <h3>${esc(a.nazev||'')}</h3>
          <div class="meta">
            ${a.datum_text?`<span>📅 ${esc(a.datum_text)}</span>`:''}
            ${a.misto?`<span>📍 ${esc(a.misto)}</span>`:''}
          </div>
          <div class="excerpt">${esc(zkrat(a.popis))}</div>
          ${cena?`<div class="price">${cena}</div>`:''}
          <span class="more">Více o akci</span>
        </div>
      </a>`;
}

/* ------------------------------------------------------------------ */
/*  Samoinstalace: při prvním běhu vloží značky do akce.html           */
/* ------------------------------------------------------------------ */

function pripravSoubor(html){
  if(html.includes('<!-- AKCE:START -->')) return html; // už upraveno dřív

  // 1) mřížka + odstranění „Načítám akce…"
  const puvodniMain = `<main class="wrap">
  <div id="grid" class="grid"></div>
  <div id="loading" class="loading">Načítám akce…</div>
</main>`;
  const novyMain = `<main class="wrap">
  <div id="grid" class="grid"><!-- AKCE:START --><!-- AKCE:END --></div>
</main>`;
  if(!html.includes(puvodniMain)){
    throw new Error('V akce.html nebyla nalezena očekávaná struktura <main>. Soubor se možná změnil — generování zastaveno.');
  }
  html = html.replace(puvodniMain, novyMain);

  // 2) JavaScript: při chybě/nedostupném API tiše ponechat zapečený obsah
  const puvodniLoad = `  try{
    const r = await fetch('/api/akce-list');
    const {akce} = await r.json();
    document.getElementById('loading').style.display='none';
    const grid = document.getElementById('grid');
    if(!akce || !akce.length){`;
  const novyLoad = `  try{
    const r = await fetch('/api/akce-list');
    if(!r.ok) return; // ponecháme předgenerovaný statický obsah
    const {akce} = await r.json();
    if(!Array.isArray(akce)) return;
    const grid = document.getElementById('grid');
    if(!akce.length){`;
  if(html.includes(puvodniLoad)) html = html.replace(puvodniLoad, novyLoad);

  const puvodniCatch = `  }catch(e){
    document.getElementById('loading').textContent='Akce se nepodařilo načíst. Zkuste obnovit stránku.';
  }`;
  const novyCatch = `  }catch(e){ /* ponecháme předgenerovaný statický obsah */ }`;
  if(html.includes(puvodniCatch)) html = html.replace(puvodniCatch, novyCatch);

  return html;
}

/* ------------------------------------------------------------------ */
/*  Hlavní běh                                                         */
/* ------------------------------------------------------------------ */

const akce = await nactiAkce();
console.log(`Načteno ${akce.length} akcí.`);

let html = readFileSync(SOUBOR, 'utf8');
html = pripravSoubor(html);

const grid = akce.length
  ? akce.map(kartaAkce).join('\n      ')
  : `<div class="empty">Zatím nejsou vypsané žádné akce. Sledujte nás na Facebooku a Instagramu. 🌿</div>`;

const start = '<!-- AKCE:START -->';
const konec = '<!-- AKCE:END -->';
const i = html.indexOf(start);
const j = html.indexOf(konec);
if(i === -1 || j === -1 || j < i){
  throw new Error('Značky v akce.html se nepodařilo najít — nic nebylo zapsáno.');
}
html = html.slice(0, i + start.length) + '\n' + grid + '\n' + html.slice(j);

writeFileSync(SOUBOR, html);
console.log(`✓ Zapečeno ${akce.length} akcí do oaza-web/akce.html. Hotovo.`);
