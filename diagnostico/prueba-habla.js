// Prueba para encontrar el indicador de "hablando" en Meet.
// Copiá TODO este archivo, pegalo en la Consola (F12) de la pestaña de Meet y presioná Enter.
(function () {
  var CLASES = ["gjg47c", "BlxGDf", "HX2H7", "sxlEM", "wEsLMd", "OgVli", "kssMZb", "MSqqjf", "FTMc0c"];
  var acc = {};
  var t0 = Date.now();
  var fase = 0;

  function nombre(tile) {
    var lineas = tile.innerText.split("\n");
    for (var i = 0; i < lineas.length; i++) {
      var s = lineas[i].trim();
      if (s && !/^[a-z_]+$/.test(s)) return s;
    }
    return "?";
  }

  function informe() {
    var out = {};
    for (var n in acc) {
      out[n] = {};
      for (var c in acc[n]) {
        out[n][c] = acc[n][c].map(function (r) {
          return r[1] ? Math.round((100 * r[0]) / r[1]) + "%" : "-";
        }).join(" / ");
      }
    }
    console.log(JSON.stringify(out, null, 1));
  }

  console.log("FASE 1 de 3: SILENCIO 10 segundos (no muevas el mouse sobre los videos)");

  var iv = setInterval(function () {
    var seg = (Date.now() - t0) / 1000;
    if (seg >= 30) {
      clearInterval(iv);
      informe();
      return;
    }
    var p = seg < 10 ? 0 : seg < 20 ? 1 : 2;
    if (p !== fase) {
      fase = p;
      console.log(p === 1 ? "FASE 2 de 3: HABLA sin parar 10 segundos" : "FASE 3 de 3: SILENCIO 10 segundos");
    }
    var tiles = document.querySelectorAll("[data-participant-id]");
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var n = nombre(t);
      if (!acc[n]) acc[n] = {};
      for (var j = 0; j < CLASES.length; j++) {
        var c = CLASES[j];
        if (!acc[n][c]) acc[n][c] = [[0, 0], [0, 0], [0, 0]];
        var presente = t.classList.contains(c) || t.querySelector("." + c) !== null;
        acc[n][c][p][0] += presente ? 1 : 0;
        acc[n][c][p][1] += 1;
      }
    }
  }, 200);
})();
