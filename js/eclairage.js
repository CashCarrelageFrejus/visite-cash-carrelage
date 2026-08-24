/**
 * Catalogue 3D — logique d'éclairage
 *
 * Conversion d'une température de couleur en teinte, et résolution d'un preset
 * d'ambiance en paramètres de lumières.
 *
 * Module pur : aucune dépendance à Babylon. Les presets eux-mêmes vivent dans
 * CONFIG.eclairage, en tête de scene.js ; ce module ne fait que les consommer.
 */
(function (global) {
  "use strict";

  /* Référence : au-delà, on tire vers le bleu, en deçà vers l'orangé. */
  var TEMPERATURE_NEUTRE = 6500;

  /**
   * Température de couleur (K) vers teinte RVB.
   *
   * Approximation de Tanner Helland, puis normalisation sur le canal le plus
   * fort. Aucune composante ne dépasse donc 1 : une lumière chaude paraît plus
   * sombre, ce qui est le comportement attendu — c'est à l'intensité du preset
   * de compenser si on ne le souhaite pas.
   */
  function kelvinVersRvb(kelvin) {
    var t = Math.min(40000, Math.max(1000, kelvin)) / 100;
    var r, v, b;

    if (t <= 66) {
      r = 255;
      v = 99.4708025861 * Math.log(t) - 161.1195681661;
    } else {
      r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
      v = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    }

    if (t >= 66) b = 255;
    else if (t <= 19) b = 0;
    else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

    var serrer = function (x) { return Math.min(255, Math.max(0, x)); };
    var canaux = [serrer(r), serrer(v), serrer(b)];

    var maximum = Math.max(canaux[0], canaux[1], canaux[2]) || 1;
    return canaux.map(function (c) { return c / maximum; });
  }

  /** Produit terme à terme de deux triplets. */
  function teinter(couleur, teinte) {
    return [
      couleur[0] * teinte[0],
      couleur[1] * teinte[1],
      couleur[2] * teinte[2]
    ];
  }

  /**
   * Développe un preset en paramètres directement applicables aux lumières.
   *
   * La température teinte les couleurs déclarées par le preset : celles-ci
   * portent l'équilibre relatif (ciel contre sol, par exemple), la température
   * porte l'ambiance chromatique.
   */
  function resoudrePreset(preset) {
    if (!preset) return null;

    var teinte = kelvinVersRvb(preset.temperature || TEMPERATURE_NEUTRE);

    return {
      cle: preset.cle,
      nom: preset.nom,
      temperature: preset.temperature || TEMPERATURE_NEUTRE,
      teinte: teinte,

      ambiance: {
        intensite: preset.ambiance.intensite,
        ciel: teinter(preset.ambiance.ciel, teinte),
        sol: teinter(preset.ambiance.sol, teinte)
      },

      soleil: {
        intensite: preset.soleil.intensite,
        couleur: teinter(preset.soleil.couleur, teinte),
        direction: preset.soleil.direction
      },

      appoint: {
        intensite: preset.appoint.intensite,
        couleur: teinter(preset.appoint.couleur, teinte),
        direction: preset.appoint.direction
      },

      environnement: preset.environnement,
      facteurFenetre: preset.facteurFenetre === undefined ? 1 : preset.facteurFenetre,

      // Hauteur du soleil dans le ciel. 0,48 par défaut : lumière rasante.
      inclinaison: preset.inclinaison === undefined ? 0.48 : preset.inclinaison,
      couleurFenetre: preset.couleurFenetre ? preset.couleurFenetre.slice() : null
    };
  }

  // --- Position du soleil ----------------------------------------------------

  /**
   * Hauteur du soleil au-dessus de l'horizon, en radians, depuis l'inclinaison
   * du preset.
   *
   * Convention retenue : 0,5 place le soleil sur l'horizon, et chaque
   * centième en deçà le monte de 4°. On obtient ainsi 40° à 0,40 (plein midi),
   * 8° à 0,48 (lumière rasante dorée) et le ras de l'horizon à 0,52, sans
   * jamais passer dessous — un soleil couché noircirait tout le ciel.
   */
  function elevationDepuisInclinaison(inclinaison) {
    var degres = (0.5 - inclinaison) * 400;
    return Math.max(2, Math.min(88, degres)) * Math.PI / 180;
  }

  /** Azimut d'une direction de lumière, c'est-à-dire son cap horizontal. */
  function azimutDepuisDirection(direction) {
    // La lumière descend du soleil : on remonte vers lui.
    return Math.atan2(-direction[2], -direction[0]);
  }

  /**
   * Position du soleil dans la scène.
   *
   * Elle sert à la fois au ciel et, si on le souhaite, à orienter la lumière
   * directionnelle — c'est ce qui garantit que l'astre visible et le sens des
   * ombres racontent la même histoire.
   */
  function positionSoleil(inclinaison, azimut, distance) {
    var elevation = elevationDepuisInclinaison(inclinaison);
    var rayon = distance || 1;

    var horizontal = Math.cos(elevation) * rayon;

    return [
      Math.cos(azimut) * horizontal,
      Math.sin(elevation) * rayon,
      Math.sin(azimut) * horizontal
    ];
  }

  /**
   * Couleur de la lumière entrant par une baie.
   *
   * Le ciel ne prend pas la teinte du luminaire intérieur : la couleur reste
   * celle du jour, sauf mention explicite du preset.
   */
  function couleurFenetre(preset, defaut) {
    if (preset && preset.couleurFenetre) return preset.couleurFenetre.slice();
    return (defaut || [0.92, 0.95, 1.0]).slice();
  }

  /**
   * Intensité de la lumière d'une fenêtre, proportionnelle à sa surface.
   *
   * `parMetreCarre` fixe l'échelle, `facteur` vient du preset — la lumière du
   * jour rend les fenêtres plus présentes.
   */
  function intensiteFenetre(surface, parMetreCarre, facteur) {
    if (!(surface > 0)) return 0;
    return surface * parMetreCarre * (facteur === undefined ? 1 : facteur);
  }

  global.Eclairage = {
    TEMPERATURE_NEUTRE: TEMPERATURE_NEUTRE,
    kelvinVersRvb: kelvinVersRvb,
    teinter: teinter,
    resoudrePreset: resoudrePreset,
    intensiteFenetre: intensiteFenetre,
    elevationDepuisInclinaison: elevationDepuisInclinaison,
    azimutDepuisDirection: azimutDepuisDirection,
    positionSoleil: positionSoleil,
    couleurFenetre: couleurFenetre
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.Eclairage;
  }
})(typeof window !== "undefined" ? window : globalThis);
