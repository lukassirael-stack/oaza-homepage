/* =====================================================================
   Oáza Adamanthea — měření návštěvnosti (cookieless)
   Umístění v repu:  oaza-web/navstevnost.js

   Na KAŽDOU stránku, kterou chceš měřit, přidej těsně před </body>:
       <script defer src="/navstevnost.js"></script>

   Co dělá:
   • vytvoří anonymní ID relace (jen v sessionStorage, zmizí po zavření karty)
   • počítá AKTIVNÍ dobu na stránce (když je karta vidět)
   • při odchodu pošle jeden záznam přes sendBeacon na /api/analytika
   Žádné cookies, žádná osobní data, žádná IP. GDPR-friendly.
   ===================================================================== */
(function () {
  "use strict";
  try {
    var KLIC = "oaza_relace";
    var sid = sessionStorage.getItem(KLIC);
    if (!sid) {
      sid =
        (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : "r" + Date.now().toString(36) + Math.random().toString(36).slice(2);
      sessionStorage.setItem(KLIC, sid);
    }

    var aktivniMs = 0;          // nasčítaná viditelná doba
    var posledni = Date.now();
    var odeslano = false;

    function tik() {
      var ted = Date.now();
      if (document.visibilityState === "visible") {
        aktivniMs += ted - posledni;
      }
      posledni = ted;
    }

    function odesli() {
      tik();
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
        // text/plain → žádný CORS preflight, sendBeacon přežije i zavření karty
        var blob = new Blob([telo], { type: "text/plain" });
        if (navigator.sendBeacon && navigator.sendBeacon("/api/analytika", blob)) {
          return;
        }
      } catch (e) {}
      // záloha
      try {
        fetch("/api/analytika", {
          method: "POST",
          body: telo,
          keepalive: true,
          headers: { "Content-Type": "text/plain" },
        }).catch(function () {});
      } catch (e) {}
    }

    document.addEventListener("visibilitychange", function () {
      tik();
      if (document.visibilityState === "hidden") odesli();
    });
    window.addEventListener("pagehide", odesli);
    window.addEventListener("beforeunload", odesli);
  } catch (e) {
    /* tiše ignoruj — měření nikdy nesmí rozbít web */
  }
})();
