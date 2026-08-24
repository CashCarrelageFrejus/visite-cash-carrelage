/**
 * Catalogue 3D — environnement extérieur
 *
 * Implantation des arbres décoratifs et bruits procéduraux du sol et du
 * feuillage. Le rendu — maillages, textures, brume — reste dans scene.js ;
 * ici ne vit que ce qui se calcule, donc se vérifie hors du navigateur.
 *
 * Tout est déterministe : le décor ne doit pas se réagencer à chaque
 * reconstruction de la scène.
 */
(function (global) {
  "use strict";

  var DEFAUTS = {
    nombre: 10,        // entre 8 et 12 d'après le cahier des charges
    rayonMin: 15,      // m
    rayonMax: 30,      // m
    largeur: 4,        // m
    hauteur: 6,        // m
    variationTaille: 0.20,  // ±20 %
    variationTeinte: 0.15,  // ±15 %
    // Arc laissé ouvert côté caméra pour ne pas encercler la pièce.
    arcDebut: -0.62 * Math.PI,
    arcFin: 0.62 * Math.PI
  };

  /** Hachage entier, même famille que celui du générateur de textures. */
  function empreinte(x, y, graine) {
    var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^
            Math.imul(graine | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /**
   * Implante les arbres en arc autour de la pièce.
   *
   * `piece` : { longueur, largeur } — le rayon part du plus grand côté, pour
   * qu'un grand volume ne se retrouve pas avec des arbres dans les murs.
   */
  function arbres(piece, options) {
    var o = Object.assign({}, DEFAUTS, options || {});
    var graine = o.graine === undefined ? 4242 : o.graine;

    var nombre = Math.max(1, Math.round(o.nombre));
    var marge = Math.max(piece.longueur, piece.largeur) / 2;

    var liste = [];

    for (var i = 0; i < nombre; i++) {
      // Répartition régulière sur l'arc, décalée d'un bruit pour éviter
      // l'alignement mécanique.
      var part = nombre === 1 ? 0.5 : i / (nombre - 1);
      var gigue = (empreinte(i, 1, graine) - 0.5) * (0.7 / nombre) * Math.PI * 2;
      var angle = o.arcDebut + (o.arcFin - o.arcDebut) * part + gigue;

      var rayon = marge + o.rayonMin +
        empreinte(i, 2, graine) * (o.rayonMax - o.rayonMin);

      var echelle = 1 + (empreinte(i, 3, graine) - 0.5) * 2 * o.variationTaille;
      var teinte = 1 + (empreinte(i, 4, graine) - 0.5) * 2 * o.variationTeinte;

      liste.push({
        rang: i,
        x: Math.cos(angle) * rayon,
        z: Math.sin(angle) * rayon,
        angle: angle,
        distance: rayon,
        largeur: o.largeur * echelle,
        hauteur: o.hauteur * echelle,
        // Facteur multiplicatif sur le vert du feuillage.
        teinte: teinte,
        // Le billboard reste face caméra : on varie l'image, pas l'objet.
        miroir: empreinte(i, 5, graine) < 0.5,
        graine: Math.floor(empreinte(i, 6, graine) * 100000)
      });
    }

    return liste;
  }

  /**
   * Bruit de valeur périodique, dans [0,1].
   * Sert au sol herbeux comme au découpage du feuillage.
   */
  function bruit(x, y, periode, graine) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;

    var u = xf * xf * (3 - 2 * xf);
    var v = yf * yf * (3 - 2 * yf);

    var mod = function (a, b) { return ((a % b) + b) % b; };
    var h = function (dx, dy) {
      return empreinte(mod(xi + dx, periode), mod(yi + dy, periode), graine);
    };

    return (h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - v) +
           (h(0, 1) * (1 - u) + h(1, 1) * u) * v;
  }

  /** Somme d'octaves. x et y dans [0,1[. */
  function fbm(x, y, periode, octaves, graine, persistance) {
    var q = persistance === undefined ? 0.5 : persistance;
    var somme = 0, amplitude = 1, total = 0, p = periode;

    for (var o = 0; o < octaves; o++) {
      somme += amplitude * bruit(x * p, y * p, p, graine + o * 37);
      total += amplitude;
      amplitude *= q;
      p *= 2;
    }
    return somme / total;
  }

  /**
   * Silhouette du feuillage en un point de la texture d'arbre.
   *
   * `x` et `y` dans [0,1[, l'origine en haut à gauche. Retourne l'opacité :
   * une ellipse dont le bord est rongé par du bruit, pour éviter la boule
   * parfaite qui trahit le décor.
   */
  function feuillage(x, y, hauteurTronc, graine) {
    var hauteurFeuillage = 1 - hauteurTronc;

    /* Centre et demi-axes de l'ellipse. Les valeurs laissent une marge : le
       bruit de découpe ronge le contour jusqu'à environ 0,08, et une ellipse
       tangente aux bords sortirait de l'image, donnant une coupe franche. */
    var cx = 0.5;
    var cy = hauteurFeuillage * 0.55;

    var dx = (x - cx) / 0.40;
    var dy = (y - cy) / (hauteurFeuillage * 0.42);

    var rayon = Math.sqrt(dx * dx + dy * dy);
    var decoupe = (fbm(x, y, 5, 3, graine, 0.6) - 0.5) * 0.42;

    // Bord adouci : franc au cœur, dentelé sur les derniers pourcents.
    var bord = 1 - (rayon + decoupe);
    return Math.max(0, Math.min(1, bord * 6));
  }

  global.Exterieur = {
    DEFAUTS: DEFAUTS,
    empreinte: empreinte,
    arbres: arbres,
    bruit: bruit,
    fbm: fbm,
    feuillage: feuillage
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.Exterieur;
  }
})(typeof window !== "undefined" ? window : globalThis);
