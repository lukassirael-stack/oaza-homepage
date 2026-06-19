/* =====================================================================
   Oáza Adamanthea — měření návštěvnosti (cookieless)
   Umístění v repu:  oaza-web/navstevnost.js
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

    var IDLE_MS = 30000;
    var aktivniMs = 0;
    var zacatek = null;
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
      idleTimer = setTimeout(zastav, IDLE_MS);
    }
    function akce() {
      if (odeslano || !viditelna()) return;
      start();
      resetIdle();
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

    if (viditelna()) {
      start();
      resetIdle();
    }

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
  } catch (e) {}
})();
