/* =====================================================================
   Oáza Adamanthea — měření návštěvnosti (cookieless)
   Umístění v repu:  oaza-web/navstevnost.js

   Měří AKTIVNÍ dobu na stránce:
   • počítá jen když je karta vidět (na pozadí se pauzuje)
   • a zároveň jen když je návštěvník činný — po 30 s úplného klidu
     (žádný pohyb myši / scroll / klik / dotek) se měření pozastaví
     a naskočí znovu při první akci
   Bez cookies, bez osobních dat, bez IP. Odesílá se při odchodu.
   ===================================================================== */

/* =====================================================================
   Sjednocení písma navigace — Jost VERZÁLKY (jako na vesmírném kódu).
   Mění POUZE font, velikost a prostrkání; barvy menu na každé stránce
   zůstávají beze změny. Načte se na všech stránkách, kde běží tento skript.
   ===================================================================== */
(function () {
  try {
    // pojistka: na některých stránkách není Jost v Google Fonts – donačti
    if (!document.querySelector('link[href*="family=Jost"]')) {
      var lf = document.createElement("link");
      lf.rel = "stylesheet";
      lf.href = "https://fonts.googleapis.com/css2?family=Jost:wght@300;400&display=swap";
      document.head.appendChild(lf);
    }
    var st = document.createElement("style");
    st.textContent =
      "nav .menu,nav .menu a,nav>a:not(.home):not(.nav-home):not(.btn){font-family:'Jost',sans-serif !important}" +
      "nav .menu a,nav>a:not(.home):not(.nav-home):not(.btn){text-transform:uppercase !important;letter-spacing:.06em !important;font-size:.82rem !important}" +
      "nav .menu{text-transform:uppercase !important}" +
      // sjednocené efekty (jako Terapie hojnosti): hover prosvětlí do zlata, aktivní lehce tučně, bez podtržení
      "nav:not(.nav) .menu a:hover,nav:not(.nav)>a:not(.home):not(.nav-home):not(.btn):hover{color:#9c6a16 !important}" +
      "nav:not(.nav) .menu a.active,nav:not(.nav) .menu a.aktivni,nav:not(.nav)>a.active:not(.home):not(.nav-home):not(.btn){color:#9c6a16 !important;font-weight:500 !important;border-bottom:none !important}" +
      "nav:not(.nav) .menu a::after,nav:not(.nav) .menu a.active::after,nav:not(.nav) .menu a.aktivni::after{display:none !important}";
    document.head.appendChild(st);
  } catch (e) {}
})();

(function () {
  "use strict";
  try {
    // --- vyřazení vlastního zařízení z měření (opt-out) ---
    // Na zařízení, které nechceš počítat, otevři web jednou s adresou:
    //   https://oaza-adamanthea.cz/?nemerit=1   → vyřadí toto zařízení
    //   https://oaza-adamanthea.cz/?nemerit=0   → zase zařadí
    try {
      var q = location.search || "";
      if (/[?&]nemerit=1\b/.test(q)) {
        localStorage.setItem("oaza_nemerit", "1");
        alert("Toto zařízení je teď vyřazené z počítání návštěvnosti.");
      } else if (/[?&]nemerit=0\b/.test(q)) {
        localStorage.removeItem("oaza_nemerit");
        alert("Toto zařízení se zase počítá do návštěvnosti.");
      }
      if (localStorage.getItem("oaza_nemerit") === "1") return; // neměř a neodesílej
    } catch (e) {}

    var KLIC = "oaza_relace";
    var sid = sessionStorage.getItem(KLIC);
    if (!sid) {
      sid =
        (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : "r" + Date.now().toString(36) + Math.random().toString(36).slice(2);
      sessionStorage.setItem(KLIC, sid);
    }

    var IDLE_MS = 30000;        // po 30 s klidu se měření pozastaví
    var aktivniMs = 0;
    var zacatek = null;          // běží-li právě měřený úsek (jinak null)
    var idleTimer = null;
    var odeslano = false;

    function viditelna() {
      return document.visibilityState === "visible";
    }
    function start() {
      if (zacatek === null && viditelna() && !odeslano) zacatek = Date.now();
    }
    function zastav() {
      if (zacatek !== null) {
        aktivniMs += Date.now() - zacatek;
        zacatek = null;
      }
    }
    function resetIdle() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(zastav, IDLE_MS); // klid → pozastav měření
    }
    function akce() {
      if (odeslano || !viditelna()) return;
      start();       // byla-li pauza kvůli nečinnosti, znovu rozjeď
      resetIdle();   // a posuň okno nečinnosti
    }

    function odesli() {
      if (idleTimer) clearTimeout(idleTimer);
      zastav();
      if (odeslano) return;
      odeslano = true;

      var data = {
        session_id: sid,
        stranka: location.pathname || "/",
        titulek: (document.title || "").slice(0, 200),
        referrer: (document.referrer || "").slice(0, 300),
        zarizeni: window.innerWidth < 768 ? "mobil" : "desktop",
        doba_sekundy: Math.round(aktivniMs / 1000),
      };

      var telo = JSON.stringify(data);
      try {
        var blob = new Blob([telo], { type: "text/plain" });
        if (navigator.sendBeacon && navigator.sendBeacon("/api/analytika", blob)) {
          return;
        }
      } catch (e) {}
      try {
        fetch("/api/analytika", {
          method: "POST",
          body: telo,
          keepalive: true,
          headers: { "Content-Type": "text/plain" },
        }).catch(function () {});
      } catch (e) {}
    }

    // start, pokud je stránka při načtení vidět
    if (viditelna()) {
      start();
      resetIdle();
    }

    // činnost návštěvníka
    ["mousemove", "mousedown", "keydown", "scroll", "wheel", "touchstart", "pointerdown", "click"]
      .forEach(function (ev) {
        window.addEventListener(ev, akce, { passive: true });
      });

    document.addEventListener("visibilitychange", function () {
      if (viditelna()) {
        if (!odeslano) { start(); resetIdle(); }
      } else {
        if (idleTimer) clearTimeout(idleTimer);
        zastav();
        odesli();
      }
    });
    window.addEventListener("pagehide", odesli);
    window.addEventListener("beforeunload", odesli);
  } catch (e) {
    /* tiše ignoruj — měření nikdy nesmí rozbít web */
  }
})();
