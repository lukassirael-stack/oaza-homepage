/* zbozi.js — měření konverzí Zboží.cz / Seznam Nákupy (Oáza Adamanthea)
   Souhlas s cookies se ptá jen návštěvníků, kteří přišli ze Zboží.cz; volba v localStorage 'oaza_zbozi' (ano/ne).
   Konverze se podle pravidel Seznamu posílá u každé objednávky — bez souhlasu s consent 0 (Seznam pak nic neukládá
   ani nečte ze zařízení, data použije jen k modelování). Druhou polovinu (obsah košíku) posílá server z api/objednavka.js.
   Produkt (lišta se souhlasem): <script src="/zbozi.js"></script>
   Pokladna: <script src="/zbozi.js"></script> + ZboziOaza.objednavka({cislo,celkem,mena,email,telefon}) */
(function () {
  const KLIC = 'oaza_zbozi';
  const ID_PROVOZOVNY = 295248;      // Bali Shop – Oáza Adamanthea (Centrum prodejce Seznam)
  const SKLIK_KONVERZE_ID = 0;       // ID konverzního kódu Sklik (SEM) — doplnit, až bude; 0 = zatím neposílat
  const SKRIPT = 'https://c.seznam.cz/js/rc.js';

  const souhlas = () => { try { return localStorage.getItem(KLIC); } catch (e) { return null; } };
  const ulozSouhlas = v => { try { localStorage.setItem(KLIC, v); } catch (e) {} };

  const zeZbozi = () => /(^|\.)(zbozi|seznam)\.cz$/i.test((document.referrer || '').replace(/^https?:\/\//, '').split('/')[0])
    || /zbozi/i.test(new URLSearchParams(location.search).get('utm_source') || '');

  function nactiSkript(hotovo) {
    if (window.rc && window.rc.conversionHit) return hotovo();
    const s = document.createElement('script');
    s.src = SKRIPT; s.onload = hotovo; s.onerror = () => {};
    document.head.appendChild(s);
  }

  function lista() {
    const css = `
    .zb-lista{position:fixed;left:16px;right:16px;bottom:16px;z-index:9500;max-width:520px;margin:0 auto;
      background:#1B2A41;color:#F6F1E7;border:1px solid #B8924A;border-radius:14px;padding:16px 18px;
      box-shadow:0 8px 28px rgba(27,42,65,.28);font:15px/1.5 inherit}
    .zb-lista p{margin:0 0 12px}
    .zb-lista a{color:#F0DAA6}
    .zb-tl{display:flex;gap:10px;flex-wrap:wrap}
    .zb-tl button{flex:1;min-width:140px;padding:10px 14px;border-radius:999px;cursor:pointer;font:inherit;
      border:1px solid #B8924A;background:transparent;color:#F6F1E7}
    .zb-tl button.zb-ano{background:#B8924A;color:#1B2A41;font-weight:600}
    .zb-tl button:focus-visible{outline:2px solid #F0DAA6;outline-offset:2px}`;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const el = document.createElement('div');
    el.className = 'zb-lista'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Měření návštěvy ze Zboží.cz');
    el.innerHTML = `<p>Vítej v Bali Shopu! Přicházíš k nám přes Zboží.cz. Smíme to změřit pomocí jeho cookies? Pomůže nám to poznat, co tě u nás zaujalo. <a href="/gdpr">Víc o ochraně údajů</a></p>
      <div class="zb-tl"><button type="button" class="zb-ano">Povolit</button><button type="button" class="zb-ne">Nechat vypnuté</button></div>`;
    el.querySelector('.zb-ano').onclick = () => { ulozSouhlas('ano'); el.remove(); };
    el.querySelector('.zb-ne').onclick = () => { ulozSouhlas('ne'); el.remove(); };
    document.body.appendChild(el);
  }

  window.ZboziOaza = {
    objednavka(o) {
      if (!o || !o.cislo) return;
      const seSouhlasem = souhlas() === 'ano';
      nactiSkript(() => {
        try {
          // identita (e-mail, telefon) jen se souhlasem — slouží k doměření konverze
          if (seSouhlasem && window.sznIVA && window.sznIVA.IS && (o.email || o.telefon)) {
            const id = {};
            if (o.email) id.eid = String(o.email);
            if (o.telefon) id.tid = String(o.telefon);
            window.sznIVA.IS.updateIdentities(id);
          }
          const konverze = {
            zboziId: ID_PROVOZOVNY,
            orderId: String(o.cislo),
            zboziType: 'standard',
            consent: seSouhlasem ? 1 : 0,
          };
          if (SKLIK_KONVERZE_ID) {
            konverze.id = SKLIK_KONVERZE_ID;
            konverze.value = Math.round(Number(o.celkem || 0) * (o.mena === 'EUR' ? 25 : 1));
          }
          if (window.rc && window.rc.conversionHit) window.rc.conversionHit(konverze);
        } catch (e) {}
      });
    },
  };

  const start = () => { if (!souhlas() && zeZbozi()) lista(); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
