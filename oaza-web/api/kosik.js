/* kosik.js — sdílený košík pro Bali Shop (Oáza Adamanthea)
   Stav v localStorage 'oaza_kosik'. Měna z 'oaza_mena' (czk/eur).
   Použití: na stránce přidej <script src="/kosik.js"></script>.
   Přidání položky: Kosik.pridej({slug,nazev,cena,cena_eur,fotka,digitalni}) */
(function () {
  const KLIC = 'oaza_kosik';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mena = () => (localStorage.getItem('oaza_mena') === 'eur' ? 'eur' : 'czk');
  const cenaFmt = p => mena() === 'eur'
    ? (p.cena_eur || 0).toLocaleString('cs-CZ') + ' €'
    : (p.cena || 0).toLocaleString('cs-CZ') + ' Kč';

  function nacti() { try { return JSON.parse(localStorage.getItem(KLIC) || '[]'); } catch (e) { return []; } }
  function uloz(p) { localStorage.setItem(KLIC, JSON.stringify(p)); render(); }

  const Kosik = {
    polozky: nacti,
    pocet: () => nacti().length,
    celkem(m) {
      const mn = m || mena();
      return nacti().reduce((s, x) => s + (mn === 'eur' ? (x.cena_eur || 0) : (x.cena || 0)), 0);
    },
    obsahuje: slug => nacti().some(x => x.slug === slug),
    pridej(item) {
      const p = nacti();
      if (p.some(x => x.slug === item.slug)) { otevri(); return false; } // unikát, jen jednou
      p.push({ slug: item.slug, nazev: item.nazev, cena: item.cena || 0, cena_eur: item.cena_eur || 0, fotka: item.fotka || '', digitalni: !!item.digitalni });
      uloz(p); otevri(); return true;
    },
    odeber(slug) { uloz(nacti().filter(x => x.slug !== slug)); },
    vyprazdni() { uloz([]); },
  };
  window.Kosik = Kosik;

  // ---------- UI ----------
  const css = `
  .kosik-btn{position:fixed;top:16px;right:16px;z-index:9000;width:46px;height:46px;border-radius:50%;
    background:#1B2A41;color:#F6F1E7;border:1px solid #B8924A;cursor:pointer;display:flex;align-items:center;
    justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.18)}
  .kosik-btn svg{width:20px;height:20px;stroke:#F0DAA6;fill:none;stroke-width:1.6}
  .kosik-pocet{position:absolute;top:-5px;right:-5px;min-width:20px;height:20px;border-radius:10px;background:#B8924A;
    color:#1B2A41;font:600 12px/20px 'IBM Plex Mono',monospace;text-align:center;padding:0 5px}
  .kosik-pocet.nula{display:none}
  .kosik-overlay{position:fixed;inset:0;background:rgba(27,42,65,.4);z-index:9001;opacity:0;visibility:hidden;transition:.25s}
  .kosik-overlay.open{opacity:1;visibility:visible}
  .kosik-panel{position:fixed;top:0;right:0;height:100%;width:380px;max-width:90vw;background:#F6F1E7;z-index:9002;
    transform:translateX(100%);transition:transform .28s ease;display:flex;flex-direction:column;
    box-shadow:-8px 0 30px rgba(0,0,0,.18);font-family:'EB Garamond',Georgia,serif;color:#1B2A41}
  .kosik-panel.open{transform:translateX(0)}
  .kosik-hlava{display:flex;align-items:center;justify-content:space-between;padding:20px;border-bottom:1px solid #E2D6BC}
  .kosik-hlava h3{font-family:'Cormorant Garamond',serif;font-weight:500;font-size:1.5rem;margin:0}
  .kosik-zavri{background:none;border:none;font-size:1.6rem;line-height:1;color:#7A715F;cursor:pointer}
  .kosik-telo{flex:1;overflow-y:auto;padding:12px 20px}
  .kosik-radek{display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid #ECE4D3}
  .kosik-radek img{width:54px;height:66px;object-fit:cover;border-radius:8px;border:1px solid #E2D6BC;background:#ECE4D3}
  .kosik-radek .n{flex:1;font-size:1.02rem;line-height:1.25}
  .kosik-radek .c{color:#33486A;font-size:.95rem;margin-top:2px}
  .kosik-x{background:none;border:none;color:#9C4A3C;cursor:pointer;font-size:1.1rem;font-style:italic}
  .kosik-prazdno{text-align:center;color:#7A715F;font-style:italic;padding:50px 10px}
  .kosik-pata{padding:18px 20px;border-top:1px solid #E2D6BC}
  .kosik-soucet{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;font-size:1.1rem}
  .kosik-soucet b{font-family:'Cormorant Garamond',serif;font-size:1.5rem}
  .kosik-k-pokladne{display:block;width:100%;text-align:center;background:#1B2A41;color:#F6F1E7;text-decoration:none;
    font-family:'Cinzel',serif;font-size:.82rem;letter-spacing:.12em;text-transform:uppercase;padding:14px;border-radius:6px;border:none;cursor:pointer}
  .kosik-k-pokladne:hover{background:#33486A}
  .kosik-pozn{text-align:center;font-style:italic;color:#7A715F;font-size:.82rem;margin-top:10px}
  @media(max-width:560px){.kosik-btn{top:12px;right:12px;width:42px;height:42px}}
  `;

  function mount() {
    if (document.getElementById('kosik-styl')) return;
    const st = document.createElement('style'); st.id = 'kosik-styl'; st.textContent = css; document.head.appendChild(st);

    const btn = document.createElement('button');
    btn.className = 'kosik-btn'; btn.setAttribute('aria-label', 'Košík');
    btn.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.5 12.5a1.5 1.5 0 0 0 1.5 1.2h8.2a1.5 1.5 0 0 0 1.5-1.2L22 7H6"/></svg>
      <span class="kosik-pocet nula" id="kosik-pocet">0</span>`;
    btn.onclick = otevri;
    document.body.appendChild(btn);

    const ov = document.createElement('div'); ov.className = 'kosik-overlay'; ov.id = 'kosik-overlay'; ov.onclick = zavri;
    const panel = document.createElement('div'); panel.className = 'kosik-panel'; panel.id = 'kosik-panel';
    panel.innerHTML = `
      <div class="kosik-hlava"><h3>Košík</h3><button class="kosik-zavri" aria-label="Zavřít">×</button></div>
      <div class="kosik-telo" id="kosik-telo"></div>
      <div class="kosik-pata" id="kosik-pata"></div>`;
    document.body.appendChild(ov); document.body.appendChild(panel);
    panel.querySelector('.kosik-zavri').onclick = zavri;
    render();
  }

  function render() {
    const badge = document.getElementById('kosik-pocet');
    if (badge) { const n = Kosik.pocet(); badge.textContent = n; badge.classList.toggle('nula', n === 0); }
    const telo = document.getElementById('kosik-telo'); const pata = document.getElementById('kosik-pata');
    if (!telo) return;
    const p = nacti();
    if (!p.length) {
      telo.innerHTML = '<div class="kosik-prazdno">Košík je zatím prázdný.</div>';
      pata.innerHTML = '';
      return;
    }
    telo.innerHTML = p.map(x => `<div class="kosik-radek">
      <img src="${esc(x.fotka)}" alt="" onerror="this.style.visibility='hidden'">
      <div class="n">${esc(x.nazev)}<div class="c">${cenaFmt(x)}${x.digitalni ? ' · digitální' : ''}</div></div>
      <button class="kosik-x" title="Odebrat" onclick="Kosik.odeber('${esc(x.slug)}')">odebrat</button>
    </div>`).join('');
    const m = mena();
    const soucet = m === 'eur' ? Kosik.celkem('eur').toLocaleString('cs-CZ') + ' €' : Kosik.celkem('czk').toLocaleString('cs-CZ') + ' Kč';
    pata.innerHTML = `<div class="kosik-soucet"><span>Mezisoučet</span><b>${soucet}</b></div>
      <a class="kosik-k-pokladne" href="/pokladna">K pokladně</a>
      <div class="kosik-pozn">Dopravu zvolíš v dalším kroku.</div>`;
  }

  function otevri() { document.getElementById('kosik-overlay').classList.add('open'); document.getElementById('kosik-panel').classList.add('open'); render(); }
  function zavri() { document.getElementById('kosik-overlay').classList.remove('open'); document.getElementById('kosik-panel').classList.remove('open'); }
  window.Kosik.otevri = otevri; window.Kosik.zavri = zavri;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
