/* heureka.js — měření konverzí z Heureky (Oáza Adamanthea)
   Souhlas se ptá jen návštěvníků, kteří přišli z Heureky; volba v localStorage 'oaza_heureka' (ano/ne).
   Produkt: <script src="/heureka.js" data-stranka="produkt"></script>
   Pokladna: <script src="/heureka.js"></script> + HeurekaOaza.objednavka({cislo,celkem,mena,polozky:[{id,nazev,cena}]}) */
(function () {
  const KLIC = 'oaza_heureka';
  const API_KLIC = '386be81ea21383c13c435a6d43c810995abd';
  const SDK = '//www.heureka.cz/ocm/sdk.js?version=2&page=';
  const skript = document.currentScript;
  const stranka = skript && skript.dataset ? skript.dataset.stranka : '';

  const souhlas = () => { try { return localStorage.getItem(KLIC); } catch (e) { return null; } };
  const ulozSouhlas = v => { try { localStorage.setItem(KLIC, v); } catch (e) {} };

  function nactiSdk(page) {
    (function (t, r, a, c, k, i, n, g) {
      t['ROIDataObject'] = k;
      t[k] = t[k] || function () { (t[k].q = t[k].q || []).push(arguments); }, t[k].c = i; n = r.createElement(a),
      g = r.getElementsByTagName(a)[0]; n.async = 1; n.src = c; g.parentNode.insertBefore(n, g);
    })(window, document, 'script', SDK + page, 'heureka', 'cz');
  }

  function zProduktu() { if (stranka === 'produkt') nactiSdk('product_detail'); }

  const zHeureky = () => /(^|\.)heureka\.(cz|sk)/i.test((document.referrer || '').replace(/^https?:\/\//, '').split('/')[0])
    || /heureka/i.test(new URLSearchParams(location.search).get('utm_source') || '');

  function lista() {
    const css = `
    .hz-lista{position:fixed;left:16px;right:16px;bottom:16px;z-index:9500;max-width:520px;margin:0 auto;
      background:#1B2A41;color:#F6F1E7;border:1px solid #B8924A;border-radius:14px;padding:16px 18px;
      box-shadow:0 8px 28px rgba(27,42,65,.28);font:15px/1.5 inherit}
    .hz-lista p{margin:0 0 12px}
    .hz-lista a{color:#F0DAA6}
    .hz-tl{display:flex;gap:10px;flex-wrap:wrap}
    .hz-tl button{flex:1;min-width:140px;padding:10px 14px;border-radius:999px;cursor:pointer;font:inherit;
      border:1px solid #B8924A;background:transparent;color:#F6F1E7}
    .hz-tl button.hz-ano{background:#B8924A;color:#1B2A41;font-weight:600}
    .hz-tl button:focus-visible{outline:2px solid #F0DAA6;outline-offset:2px}`;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const el = document.createElement('div');
    el.className = 'hz-lista'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Měření návštěvy z Heureky');
    el.innerHTML = `<p>Vítej v Bali Shopu! Přicházíš k nám přes Heureku. Smíme to změřit pomocí jejích cookies? Pomůže nám to poznat, co tě u nás zaujalo. <a href="/gdpr">Víc o ochraně údajů</a></p>
      <div class="hz-tl"><button type="button" class="hz-ano">Povolit</button><button type="button" class="hz-ne">Nechat vypnuté</button></div>`;
    el.querySelector('.hz-ano').onclick = () => { ulozSouhlas('ano'); el.remove(); zProduktu(); };
    el.querySelector('.hz-ne').onclick = () => { ulozSouhlas('ne'); el.remove(); };
    document.body.appendChild(el);
  }

  window.HeurekaOaza = {
    objednavka(o) {
      if (souhlas() !== 'ano' || !o) return;
      nactiSdk('thank_you');
      const h = window.heureka;
      h('authenticate', API_KLIC);
      h('set_order_id', String(o.cislo || ''));
      (o.polozky || []).forEach(p => h('add_product', String(p.id), String(p.nazev || p.id), String(p.cena || 0), '1'));
      h('set_total_vat', String(o.celkem || 0));
      h('set_currency', o.mena === 'EUR' ? 'EUR' : 'CZK');
      h('send', 'Order');
    },
  };

  const start = () => {
    const s = souhlas();
    if (s === 'ano') zProduktu();
    else if (!s && zHeureky()) lista();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
