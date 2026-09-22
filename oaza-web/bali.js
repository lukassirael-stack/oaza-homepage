/* bali.js — sdílené věci Bali Shopu: měření nákupní cesty, Meta pixel po souhlasu, Dopis z Bali Shopu.
   Načítá se na /bali-shop, /produkt a /pokladna (za kosik.js). */
(function () {
  const SB = 'https://myybuesoourgpbouwwst.supabase.co/rest/v1/rpc/';
  const KEY = 'sb_publishable_v9E-GhERgU5JCvE0D-l65A_QB2S2yux';
  const PIXEL = '2701237003568248';
  const rpc = (fn, body) => fetch(SB + fn, { method: 'POST', keepalive: true, headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});

  // ---- session (jen po dobu návštěvy, bez cookies) ----
  let ses = null;
  try { ses = sessionStorage.getItem('oaza_ses'); if (!ses) { ses = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); sessionStorage.setItem('oaza_ses', ses); } } catch (e) { ses = 'anon'; }
  const zarizeni = window.matchMedia && window.matchMedia('(max-width: 768px)').matches ? 'mobil' : 'desktop';

  // ---- Meta pixel: až po souhlasu (stejný klíč oaza_cookie jako zbytek webu) ----
  const souhlas = () => { try { return localStorage.getItem('oaza_cookie'); } catch (e) { return null; } };
  const fronta = [];
  function nactiPixel() {
    if (window._oazaPixelLoaded) return; window._oazaPixelLoaded = true;
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', PIXEL); fbq('track', 'PageView');
    while (fronta.length) { const u = fronta.shift(); fbq('track', u[0], u[1]); }
  }
  function meta(nazev, data) {
    if (window._oazaPixelLoaded && window.fbq) fbq('track', nazev, data || {});
    else if (souhlas() !== 'no') fronta.push([nazev, data || {}]);
  }
  function lista() {
    if (souhlas() === 'yes') { nactiPixel(); return; }
    if (souhlas() === 'no' || document.getElementById('oaza-cookie')) return;
    const st = document.createElement('style');
    st.textContent = `#oaza-cookie{position:fixed;left:50%;bottom:max(10px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:8990;max-width:460px;width:calc(100% - 20px);background:rgba(251,248,241,.96);color:#1B2A41;border:1px solid #E2D6BC;border-radius:12px;box-shadow:0 12px 28px -16px rgba(27,42,65,.3);padding:8px 12px;font-family:'EB Garamond',Georgia,serif;font-size:15px;line-height:1.35;display:flex;align-items:center;gap:8px;flex-wrap:wrap;backdrop-filter:blur(6px)}
#oaza-cookie p{margin:0;flex:1 1 130px}#oaza-cookie a{color:#B8924A}#oaza-cookie .row{display:flex;gap:6px;margin-left:auto}
#oaza-cookie button{font-family:'Cinzel',serif;font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;border-radius:999px;padding:.4rem .8rem;border:1px solid transparent;white-space:nowrap}
#oaza-cookie .ok{background:#1B2A41;color:#F6F1E7}#oaza-cookie .no{background:transparent;color:#7A715F;border-color:#E2D6BC}`;
    document.head.appendChild(st);
    const d = document.createElement('div'); d.id = 'oaza-cookie'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Souhlas s cookies');
    d.innerHTML = '<p>Cookies pro měření a marketing. <a href="/gdpr">Více</a></p><div class="row"><button class="no" type="button">Odmítnout</button><button class="ok" type="button">Přijmout</button></div>';
    d.querySelector('.ok').onclick = () => { try { localStorage.setItem('oaza_cookie', 'yes'); } catch (e) {} d.remove(); nactiPixel(); };
    d.querySelector('.no').onclick = () => { try { localStorage.setItem('oaza_cookie', 'no'); } catch (e) {} fronta.length = 0; d.remove(); };
    document.body.appendChild(d);
  }

  // ---- nákupní cesta: produkt → košík → pokladna → objednávka → zaplaceno ----
  const Bali = {
    udalost(udalost, o) {
      o = o || {};
      rpc('eshop_udalost', { p_session: ses, p_udalost: udalost, p_slug: o.slug || null, p_castka: o.castka != null ? Math.round(o.castka) : null, p_mena: o.mena || null, p_zarizeni: zarizeni });
      const m = (o.mena || 'CZK').toUpperCase();
      if (udalost === 'produkt') meta('ViewContent', { content_ids: [o.slug], content_type: 'product', value: o.castka, currency: m });
      if (udalost === 'kosik') meta('AddToCart', { content_ids: [o.slug], content_type: 'product', value: o.castka, currency: m });
      if (udalost === 'pokladna') meta('InitiateCheckout', { value: o.castka, currency: m, num_items: o.pocet || 1 });
      if (udalost === 'zaplaceno' || udalost === 'objednavka') meta('Purchase', { value: o.castka, currency: m, content_type: 'product' });
    },
    // obrázek ze Supabase úložiště: originál, prohlížeč ho zobrazí v potřebné velikosti
    // (transformace na straně Supabase mají měsíční kvótu, proto je necháváme stranou)
    img(url) { return url; },
  };
  window.Bali = Bali;

  // košík: přidání zaznamenat (obalíme Kosik.pridej)
  function obalKosik() {
    if (!window.Kosik || window.Kosik._mereno) return;
    const puv = window.Kosik.pridej;
    window.Kosik.pridej = function (item) { const r = puv.call(window.Kosik, item); if (r) Bali.udalost('kosik', { slug: item.slug, castka: item.cena, mena: 'CZK' }); return r; };
    window.Kosik._mereno = true;
  }

  // ---- Dopis z Bali Shopu ----
  function dopisHTML() {
    return `<div class="bali-dopis" id="bali-dopis"><div class="bali-dopis-in">
      <div class="bali-dopis-eb">✦ Dopis z Bali Shopu</div>
      <h3>Jednou za měsíc vybrané novinky a jedinečné kusy</h3>
      <p>Napíšeme ti, když dorazí něco výjimečného — krátce, s příběhem, jednou měsíčně.</p>
      <form class="bali-dopis-f"><input type="email" required placeholder="tvůj e-mail" autocomplete="email"><button type="submit">Chci dopis</button></form>
      <div class="bali-dopis-z"></div>
      <div class="bali-dopis-gdpr">Odběr odhlásíš kdykoli jedním klikem v každém dopisu · <a href="/gdpr">Ochrana osobních údajů</a></div>
    </div></div>`;
  }
  function dopisMount(host) {
    if (!host || document.getElementById('bali-dopis')) return;
    const st = document.createElement('style');
    st.textContent = `.bali-dopis{margin:56px auto 20px;max-width:640px;padding:0 16px}.bali-dopis-in{background:#FBF8F1;border:1px solid #E2D6BC;border-radius:16px;padding:30px 26px;text-align:center;color:#1B2A41;font-family:'EB Garamond',Georgia,serif}
.bali-dopis-eb{font-family:'Cinzel',serif;font-size:.7rem;letter-spacing:.3em;text-transform:uppercase;color:#B8924A}.bali-dopis h3{font-family:'Cormorant Garamond',serif;font-weight:500;font-size:1.55rem;margin:8px 0 6px}.bali-dopis p{margin:0 0 16px;color:#33486A;font-style:italic}
.bali-dopis-f{display:flex;gap:8px;max-width:420px;margin:0 auto}.bali-dopis-f input{flex:1;min-width:0;padding:11px 14px;border:1px solid #E2D6BC;border-radius:9px;background:#fff;font:inherit;font-size:1rem}.bali-dopis-f input:focus{outline:none;border-color:#B8924A}
.bali-dopis-f button{font-family:'Cinzel',serif;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;background:#1B2A41;color:#F6F1E7;border:none;border-radius:9px;padding:11px 16px;cursor:pointer;white-space:nowrap}.bali-dopis-z{margin-top:10px;font-style:italic;color:#7A715F;min-height:1.2em}.bali-dopis-gdpr{font-size:.82rem;color:#7A715F;margin-top:4px}.bali-dopis-gdpr a{color:#B8924A}
@media(max-width:480px){.bali-dopis-f{flex-direction:column}}`;
    document.head.appendChild(st);
    host.insertAdjacentHTML('beforeend', dopisHTML());
    const f = document.querySelector('#bali-dopis form'), z = document.querySelector('.bali-dopis-z');
    f.onsubmit = async (e) => {
      e.preventDefault(); const em = f.querySelector('input').value.trim(); const b = f.querySelector('button'); b.disabled = true;
      try { const r = await fetch('/api/objednavka', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ akce: 'dopis', email: em, zdroj: location.pathname.slice(1, 40) }) }); const ok = r.ok; z.textContent = ok ? 'Děkujeme — uvítání máš v e-mailu. ✦' : 'Zkontroluj prosím e-mail.'; if (ok) f.style.display = 'none'; }
      catch (err) { z.textContent = 'Zkus to prosím za chvíli.'; }
      b.disabled = false;
    };
  }
  Bali.dopis = dopisMount;

  const start = () => { obalKosik(); lista(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
