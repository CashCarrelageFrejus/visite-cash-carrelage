/**
 * Catalogue 3D — schémas de pose multi-formats
 *
 * Un opus n'est pas une trame. La pose ordinaire répète un seul carreau sur
 * une grille ; un opus répète un *module* — un pavé de plusieurs formats
 * assemblés — dont le raccord d'un module à l'autre doit être invisible.
 *
 * Chaque schéma décrit donc un module et le découpage exact qui le remplit.
 * Les coordonnées sont en centimètres, l'origine au coin bas-gauche du
 * module, x vers la droite et y vers le haut.
 *
 * ─── Deux invariants, et pourquoi ils comptent ────────────────────────────
 *
 * 1. Les tuiles pavent le module exactement : ni trou, ni recouvrement. Un
 *    trou laisserait voir le fond de joint en plein champ, un recouvrement
 *    ferait vibrer deux carreaux superposés. `verifier` les mesure.
 *
 * 2. Aucune tuile ne dépasse le format de référence du matériau. C'est lui
 *    qui donne l'échelle des UV : une tuile plus grande irait chercher sa
 *    texture au-delà de sa case d'atlas, et emprunterait le dessin du
 *    tampon voisin.
 *
 * Module IIFE, sans dépendance : le même fichier sert au navigateur et à
 * Node, comme plan.js ou murs-plan.js.
 */
(function (global) {
  "use strict";

  /* Opus romain quatre formats, module de 120 × 120 cm.
   *
   * Le classique des travertins : deux grands 40 × 60, trois 40 × 40, quatre
   * 20 × 40 et quatre 20 × 20. Les 20 × 40 se posent dans les deux sens —
   * c'est ce qui casse les alignements et donne à l'opus son irrégularité
   * réglée.
   *
   * Le module se lit comme une grille de 6 × 6 cases de 20 cm :
   *
   *     y=120 ┌─────┬───────────┬─────┬─────┐
   *           │ 40  │           │ 20  │ 20  │
   *     y=100 │ ×20 │   40×60   ├─────┴─────┤
   *           ├─────┤           │   20×40   │
   *           │     │           │    ×2     │
   *      y=60 │40×40├───────────┼─────┬─────┤
   *           │     │ 20  │ 20  │           │
   *      y=40 ├─────┼─────┴─────┤   40×40   │
   *           │     │           │           │
   *           │40×60│   40×40   ├───────────┤
   *       y=0 └─────┴───────────┴───────────┘
   *          x=0   40          80         120
   */
  var SCHEMAS = {
    opus_romain_4: {
      nom: "Opus romain 4 formats",
      module: { l: 120, h: 120 },

      /* Le format de référence : celui auquel les UV sont rapportées, et le
         plus grand du lot. Il doit correspondre au `format_recommande` de la
         fiche matériau. */
      reference: { largeur: 40, hauteur: 60 },

      tuiles: [
        // Bande basse, y de 0 à 60.
        { x: 0,   y: 0,   largeur: 40, hauteur: 60 },
        { x: 40,  y: 0,   largeur: 40, hauteur: 40 },
        { x: 80,  y: 0,   largeur: 40, hauteur: 40 },
        { x: 40,  y: 40,  largeur: 20, hauteur: 20 },
        { x: 60,  y: 40,  largeur: 20, hauteur: 20 },
        { x: 80,  y: 40,  largeur: 40, hauteur: 20 },

        // Bande haute, y de 60 à 120.
        { x: 0,   y: 60,  largeur: 40, hauteur: 40 },
        { x: 40,  y: 60,  largeur: 40, hauteur: 60 },
        { x: 80,  y: 60,  largeur: 20, hauteur: 40 },
        { x: 100, y: 60,  largeur: 20, hauteur: 40 },
        { x: 0,   y: 100, largeur: 40, hauteur: 20 },
        { x: 80,  y: 100, largeur: 20, hauteur: 20 },
        { x: 100, y: 100, largeur: 20, hauteur: 20 }
      ]
    }
  };

  /**
   * Vérifie qu'un schéma pave son module sans trou ni recouvrement.
   *
   * La mesure se fait sur une grille au pas du plus petit côté rencontré :
   * chaque case doit être couverte une fois et une seule. C'est plus sûr
   * qu'une somme d'aires, qui laisserait passer un trou compensé par un
   * recouvrement de même surface.
   *
   * @returns {{ok, motif, aire, tuiles}} `motif` dit ce qui cloche.
   */
  function verifier(schema) {
    if (!schema || !schema.module || !Array.isArray(schema.tuiles)) {
      return { ok: false, motif: "schéma incomplet" };
    }

    var pas = 0;
    schema.tuiles.forEach(function (t) {
      [t.largeur, t.hauteur, t.x, t.y].forEach(function (v) {
        if (v > 0) pas = pas ? pgcd(pas, v) : v;
      });
    });
    if (!(pas > 0)) return { ok: false, motif: "aucune tuile mesurable" };

    var colonnes = schema.module.l / pas;
    var rangees = schema.module.h / pas;

    if (colonnes !== Math.round(colonnes) || rangees !== Math.round(rangees)) {
      return { ok: false, motif: "le module ne tombe pas juste sur les tuiles" };
    }

    var grille = new Array(colonnes * rangees).fill(0);
    var aire = 0;

    for (var i = 0; i < schema.tuiles.length; i++) {
      var t = schema.tuiles[i];
      aire += t.largeur * t.hauteur;

      if (t.x < 0 || t.y < 0 ||
          t.x + t.largeur > schema.module.l ||
          t.y + t.hauteur > schema.module.h) {
        return { ok: false, motif: "tuile " + i + " déborde du module" };
      }

      for (var cy = t.y / pas; cy < (t.y + t.hauteur) / pas; cy++) {
        for (var cx = t.x / pas; cx < (t.x + t.largeur) / pas; cx++) {
          grille[cy * colonnes + cx]++;
        }
      }
    }

    for (var c = 0; c < grille.length; c++) {
      if (grille[c] === 0) return { ok: false, motif: "trou dans le module" };
      if (grille[c] > 1) return { ok: false, motif: "tuiles superposées" };
    }

    // Aucune tuile ne doit dépasser le format de référence : voir l'en-tête.
    if (schema.reference) {
      for (var j = 0; j < schema.tuiles.length; j++) {
        var u = schema.tuiles[j];
        if (u.largeur > schema.reference.largeur ||
            u.hauteur > schema.reference.hauteur) {
          return { ok: false, motif: "tuile " + j + " dépasse le format de référence" };
        }
      }
    }

    return { ok: true, motif: "", aire: aire, tuiles: schema.tuiles.length };
  }

  function pgcd(a, b) {
    while (b) { var t = b; b = a % b; a = t; }
    return a;
  }

  /** Le schéma portant ce nom, ou null. */
  function schema(nom) {
    return (nom && SCHEMAS[nom]) ? SCHEMAS[nom] : null;
  }

  var API = {
    SCHEMAS: SCHEMAS,
    schema: schema,
    verifier: verifier
  };

  global.OpusSchemas = API;

  if (typeof module !== "undefined" && module.exports) module.exports = API;

})(typeof window !== "undefined" ? window : globalThis);
