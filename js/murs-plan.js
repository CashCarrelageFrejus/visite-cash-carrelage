/**
 * Catalogue 3D — murs déduits d'un plan analysé
 *
 * Transforme les polygones de pièces en murs constructibles : passage aux
 * mètres dans un repère commun, puis déduplication des cloisons mitoyennes.
 *
 * Le repère commun est le point clé. Chaque pièce, convertie isolément,
 * serait centrée sur son propre barycentre et les pièces se superposeraient
 * toutes à l'origine. Ici, un seul décalage — celui du contour d'ensemble —
 * s'applique à tout : sol, murs et ouvertures partagent le même
 * référentiel, et l'échelle calibrée les affecte à l'identique.
 *
 * Module IIFE pur : aucune dépendance à Babylon ni au DOM. Testable sous
 * Node. La géométrie sort sous forme de boîtes orientées, que scene.js
 * n'a plus qu'à instancier.
 *
 * Convention : [x, z] en mètres dans le plan horizontal, y = altitude.
 */
(function (global) {
  "use strict";

  var EPAISSEUR = 0.10;   // m, épaisseur d'un mur
  var TOLERANCE = 0.15;   // m, écart sous lequel deux murs n'en font qu'un
  var ANGLE_TOL = Math.PI / 60;  // 3°, au-delà deux murs ne sont plus parallèles
  var LONGUEUR_MIN = 0.10;       // m, en deçà un tronçon ne vaut pas d'être bâti

  // ---------------------------------------------------------------------------
  // Repère commun
  // ---------------------------------------------------------------------------

  /**
   * Établit le repère monde à partir du contour d'ensemble.
   *
   * L'origine est le barycentre des sommets du contour, converti en mètres :
   * exactement le décalage qu'applique Plan.sommetsVersMonde au sol. Sol et
   * murs ne peuvent donc pas dériver l'un par rapport à l'autre.
   *
   * @param {Array} contour   Contour d'ensemble, normalisé 0–1.
   * @param {Object} options  { largeur, hauteur } du canvas en px, { echelle } px/m.
   */
  function repere(contour, options) {
    var o = options || {};
    var largeur = o.largeur, hauteur = o.hauteur, echelle = o.echelle;

    if (!(echelle > 0) || !(largeur > 0) || !(hauteur > 0) ||
        !contour || !contour.length) {
      return null;
    }

    var ox = 0, oz = 0;
    contour.forEach(function (p) {
      ox += p[0] * largeur / echelle;
      oz += p[1] * hauteur / echelle;
    });

    return {
      largeur: largeur,
      hauteur: hauteur,
      echelle: echelle,
      origine: [ox / contour.length, oz / contour.length]
    };
  }

  /**
   * Polygone normalisé vers les mètres, dans le repère commun.
   *
   * ─── Pourquoi l'axe vertical change de signe ───────────────────────────
   *
   * Sur le plan, l'ordonnée descend : c'est la convention du canvas. Dans la
   * scène, Babylon travaille en repère main-gauche, et le Z monte vers le
   * haut de la feuille. Recopier l'ordonnée telle quelle inverserait la
   * chiralité de toute la maison.
   *
   * Le symptôme n'est visible qu'une fois dedans : un visiteur qui remonte
   * le plan a l'est à sa droite, alors que dans un repère main-gauche celui
   * qui regarde vers −Z a le +X à sa gauche. Tout se retrouve en miroir —
   * les longueurs et les surfaces sont justes, la gauche et la droite sont
   * échangées.
   *
   * Ce signe est donc le seul endroit qui accorde le plan et la scène. Il
   * doit rester identique dans `pointVersMonde`, dans `versNormalise` qui
   * défait la conversion, et dans `Plan.sommetsVersMonde` qui la refait pour
   * le sol carrelé.
   */
  function versMonde(polygone, rep) {
    if (!rep || !polygone) return [];
    return polygone.map(function (p) {
      return [
        p[0] * rep.largeur / rep.echelle - rep.origine[0],
        -(p[1] * rep.hauteur / rep.echelle - rep.origine[1])
      ];
    });
  }

  /**
   * Retour des mètres vers le normalisé 0–1 : l'inverse exact de versMonde.
   *
   * Sert à réafficher sur le plan un contour corrigé en 3D — une pièce
   * accrochée à ses murs doit se voir sur le canvas, pas seulement dans la
   * scène. Les coordonnées sont bornées : un contour qui déborderait du
   * cadre reste dessinable.
   */
  function versNormalise(polygone, rep) {
    if (!rep || !polygone) return [];

    return polygone.map(function (p) {
      return [
        Math.min(1, Math.max(0, (p[0] + rep.origine[0]) * rep.echelle / rep.largeur)),
        // Le Z remonte, l'ordonnée du plan descend : le signe se défait ici.
        Math.min(1, Math.max(0, (-p[1] + rep.origine[1]) * rep.echelle / rep.hauteur))
      ];
    });
  }

  /** Point normalisé isolé vers les mètres, dans le même repère. */
  function pointVersMonde(point, rep) {
    if (!rep || !point) return null;
    return [
      point[0] * rep.largeur / rep.echelle - rep.origine[0],
      -(point[1] * rep.hauteur / rep.echelle - rep.origine[1])
    ];
  }

  // ---------------------------------------------------------------------------
  // Regroupement des arêtes en droites porteuses
  // ---------------------------------------------------------------------------

  /** Abscisse d'un point le long de la droite d'un groupe. */
  function _projeter(p, groupe) {
    return (p[0] - groupe.p[0]) * groupe.d[0] +
           (p[1] - groupe.p[1]) * groupe.d[1];
  }

  /** Distance d'un point à la droite d'un groupe. */
  function _ecart(p, groupe) {
    return Math.abs(-groupe.d[1] * (p[0] - groupe.p[0]) +
                     groupe.d[0] * (p[1] - groupe.p[1]));
  }

  /**
   * Range une arête dans la droite qui la porte, ou en ouvre une nouvelle.
   *
   * Deux arêtes partagent une droite si elles sont parallèles à 3° près et
   * si leurs deux extrémités s'en écartent de moins que la tolérance. C'est
   * ce qui réunit la cloison vue depuis chacune des deux pièces qu'elle
   * sépare, alors que le modèle les a rarement tracées au même pixel.
   */
  function _ranger(groupes, a, b, direction, piece, tolerance) {
    for (var g = 0; g < groupes.length; g++) {
      var groupe = groupes[g];

      var croix = Math.abs(groupe.d[0] * direction[1] -
                           groupe.d[1] * direction[0]);
      if (croix > Math.sin(ANGLE_TOL)) continue;
      if (_ecart(a, groupe) > tolerance) continue;
      if (_ecart(b, groupe) > tolerance) continue;

      groupe.segments.push({
        t1: _projeter(a, groupe), t2: _projeter(b, groupe), piece: piece
      });
      return;
    }

    var nouveau = { p: [a[0], a[1]], d: direction, segments: [] };
    nouveau.segments.push({
      t1: 0, t2: _projeter(b, nouveau), piece: piece
    });
    groupes.push(nouveau);
  }

  // ---------------------------------------------------------------------------
  // Murs
  // ---------------------------------------------------------------------------

  /**
   * Déduit les murs d'un jeu de pièces déjà exprimées en mètres.
   *
   * Chaque arête de chaque pièce est projetée sur sa droite porteuse, puis
   * les droites sont découpées aux abscisses remarquables. Un tronçon
   * couvert par deux pièces est une cloison mitoyenne, bâtie une seule fois ;
   * couvert par une seule, c'est un mur de façade.
   *
   * @param {Array} pieces     [{ contour: [[x, z], …] }]
   * @param {Object} [options] { tolerance }
   * @returns {Array} [{ a, b, longueur, angle, mitoyen, pieces, trous }]
   */
  function murs(pieces, options) {
    var o = options || {};
    var tolerance = o.tolerance === undefined ? TOLERANCE : o.tolerance;
    if (!pieces || !pieces.length) return [];

    var groupes = [];

    pieces.forEach(function (piece, indice) {
      var contour = piece && piece.contour;
      if (!contour || contour.length < 3) return;

      for (var i = 0; i < contour.length; i++) {
        var a = contour[i];
        var b = contour[(i + 1) % contour.length];
        var dx = b[0] - a[0], dz = b[1] - a[1];
        var longueur = Math.sqrt(dx * dx + dz * dz);
        if (longueur < LONGUEUR_MIN) continue;

        _ranger(groupes, a, b, [dx / longueur, dz / longueur],
                indice, tolerance);
      }
    });

    var resultat = [];

    groupes.forEach(function (groupe) {
      var bornes = [];

      groupe.segments.forEach(function (s) {
        s.min = Math.min(s.t1, s.t2);
        s.max = Math.max(s.t1, s.t2);
        bornes.push(s.min, s.max);
      });

      bornes.sort(function (x, y) { return x - y; });

      // Rapprocher les bornes voisines : deux pièces mitoyennes ne finissent
      // pas leur cloison au même millimètre, et sans cela on fabriquerait
      // des tronçons résiduels de quelques centimètres.
      var nettes = [];
      bornes.forEach(function (t) {
        if (!nettes.length || t - nettes[nettes.length - 1] > tolerance) {
          nettes.push(t);
        }
      });

      var morceaux = [];

      for (var i = 0; i + 1 < nettes.length; i++) {
        var t1 = nettes[i], t2 = nettes[i + 1];
        if (t2 - t1 < LONGUEUR_MIN) continue;

        var milieu = (t1 + t2) / 2;
        var couvrant = [];

        groupe.segments.forEach(function (s) {
          if (milieu >= s.min && milieu <= s.max &&
              couvrant.indexOf(s.piece) < 0) {
            couvrant.push(s.piece);
          }
        });

        if (!couvrant.length) continue;  // trou entre deux pièces éloignées
        morceaux.push({ t1: t1, t2: t2, pieces: couvrant });
      }

      // Recoller les tronçons consécutifs de même nature : un long mur ne
      // doit pas être livré en tranches parce qu'une pièce s'y appuie.
      var fusion = [];

      morceaux.forEach(function (m) {
        var mitoyen = m.pieces.length >= 2;
        var dernier = fusion[fusion.length - 1];

        if (dernier && Math.abs(dernier.t2 - m.t1) < 1e-9 &&
            dernier.mitoyen === mitoyen) {
          dernier.t2 = m.t2;
          m.pieces.forEach(function (p) {
            if (dernier.pieces.indexOf(p) < 0) dernier.pieces.push(p);
          });
          return;
        }

        fusion.push({
          t1: m.t1, t2: m.t2, mitoyen: mitoyen, pieces: m.pieces.slice()
        });
      });

      fusion.forEach(function (m) {
        var a = [groupe.p[0] + groupe.d[0] * m.t1,
                 groupe.p[1] + groupe.d[1] * m.t1];
        var b = [groupe.p[0] + groupe.d[0] * m.t2,
                 groupe.p[1] + groupe.d[1] * m.t2];

        resultat.push({
          a: a,
          b: b,
          longueur: m.t2 - m.t1,
          // Babylon tourne autour de Y en repère gaucher : le +X local
          // devient (cos θ, 0, −sin θ). Pour aligner le mur sur sa
          // direction (dx, dz), il faut donc θ = atan2(−dz, dx).
          angle: Math.atan2(-groupe.d[1], groupe.d[0]),
          mitoyen: m.mitoyen,
          pieces: m.pieces,
          trous: []
        });
      });
    });

    return resultat;
  }

  // ---------------------------------------------------------------------------
  // Ouvertures
  // ---------------------------------------------------------------------------

  var DISTANCE_MAX = 0.60;  // m, au-delà l'ouverture ne désigne plus ce mur
  var MARGE = 0.05;         // m, retrait conservé aux angles
  // Largeur minimale d'un percement. Un vantail de porte fait 0,63 m et la
  // plus étroite des fenêtres 0,40 m : en deçà, ce n'est plus une ouverture
  // mais un mur grignoté, et le retenir laisserait des murets ajourés.
  var TROU_MIN = 0.40;

  /**
   * Distance d'un point au segment [a, b].
   *
   * Sert au percement — retrouver le mur qu'une ouverture traverse — comme
   * au pointage d'une ouverture sur le plan 2D. Les deux travaillent dans
   * des unités différentes, mètres et pixels, mais c'est le même calcul :
   * en tenir deux versions revenait à les laisser diverger.
   */
  function _distanceAuSegment(px, pz, a, b) {
    var dx = b[0] - a[0], dz = b[1] - a[1];
    var lg2 = dx * dx + dz * dz;

    if (lg2 < 1e-12) {
      return Math.sqrt(Math.pow(px - a[0], 2) + Math.pow(pz - a[1], 2));
    }

    var t = ((px - a[0]) * dx + (pz - a[1]) * dz) / lg2;
    t = Math.min(1, Math.max(0, t));

    return Math.sqrt(Math.pow(px - (a[0] + t * dx), 2) +
                     Math.pow(pz - (a[1] + t * dz), 2));
  }

  /**
   * Affecte chaque ouverture au mur qu'elle perce, puis y creuse le trou.
   *
   * Le modèle situe l'ouverture à quelques centimètres du mur qu'elle
   * traverse : on retient le mur le plus proche dont la projection contient
   * le milieu de l'ouverture. L'orientation départage les ex æquo — une
   * porte suit le mur qu'elle perce, pas celui d'en face.
   *
   * Une ouverture relevée au-delà du bout d'un mur y est ramenée, le débord
   * comptant comme un éloignement : une porte d'angle est courante, une
   * porte flottant à un mètre de toute maçonnerie n'existe pas. Passé la
   * tolérance, l'ouverture est écartée et `refusees` dit laquelle et pourquoi.
   *
   * Les murs sont modifiés sur place : leur champ `trous` se remplit.
   *
   * @param {Array} murs        Sortie de `murs()`.
   * @param {Array} ouvertures  [{ a: [x,z], b: [x,z], largeur, bas, haut,
   *                              type, vitre }] en mètres.
   * @returns {{posees, ignorees, refusees: Array}}
   */
  function percer(listeMurs, ouvertures, options) {
    var o = options || {};
    var distanceMax = o.distanceMax === undefined ? DISTANCE_MAX : o.distanceMax;
    var marge = o.marge === undefined ? MARGE : o.marge;

    var bilan = { posees: 0, ignorees: 0, refusees: [] };
    if (!listeMurs || !listeMurs.length || !ouvertures) return bilan;

    /** Écarte une ouverture en disant laquelle et pourquoi. */
    function refuser(rang, ouverture, motif, distance) {
      bilan.ignorees++;
      bilan.refusees.push({
        rang: rang,
        type: (ouverture && ouverture.type) || "?",
        motif: motif,
        distance: distance === undefined ? null : distance
      });
    }

    ouvertures.forEach(function (ouverture, rang) {
      if (!ouverture || !ouverture.a || !ouverture.b) {
        refuser(rang, ouverture, "relevé incomplet");
        return;
      }

      var mx = (ouverture.a[0] + ouverture.b[0]) / 2;
      var mz = (ouverture.a[1] + ouverture.b[1]) / 2;

      var odx = ouverture.b[0] - ouverture.a[0];
      var odz = ouverture.b[1] - ouverture.a[1];
      var olg = Math.sqrt(odx * odx + odz * odz);
      if (olg > 1e-9) { odx /= olg; odz /= olg; }

      var meilleur = null;
      // Suivi du mur le plus proche, retenu ou non : c'est ce qu'il faut
      // dire quand aucun ne convient.
      var plusProche = Infinity;

      listeMurs.forEach(function (mur) {
        var dx = mur.b[0] - mur.a[0], dz = mur.b[1] - mur.a[1];
        var lg = Math.sqrt(dx * dx + dz * dz);
        if (lg < LONGUEUR_MIN) return;

        var brut = _distanceAuSegment(mx, mz, mur.a, mur.b);
        if (brut < plusProche) plusProche = brut;

        var ux = dx / lg, uz = dz / lg;
        var t = (mx - mur.a[0]) * ux + (mz - mur.a[1]) * uz;

        /* Le milieu de l'ouverture est ramené sur le mur. Ce qui dépasse
           s'ajoute à l'éloignement : un mur qu'il faut prolonger pour
           accueillir la porte est un moins bon candidat qu'un mur qui la
           contient déjà. */
        var tSurMur = Math.min(Math.max(t, 0), lg);
        var debord = Math.abs(t - tSurMur);
        if (debord > distanceMax) return;

        var distance = Math.abs(-uz * (mx - mur.a[0]) + ux * (mz - mur.a[1]));
        if (distance > distanceMax) return;

        // Une ouverture perpendiculaire au mur candidat est suspecte : le
        // terme de parallélisme la fait perdre face à un mur mieux orienté.
        var croix = Math.abs(ux * odz - uz * odx);
        var score = distance + debord + croix * 0.5;

        if (!meilleur || score < meilleur.score) {
          meilleur = { mur: mur, t: tSurMur, longueur: lg, score: score };
        }
      });

      if (!meilleur) {
        refuser(rang, ouverture, "aucun mur à portée",
          isFinite(plusProche) ? plusProche : null);
        return;
      }

      var demi = ouverture.largeur / 2;
      var debut = Math.max(marge, meilleur.t - demi);
      var fin   = Math.min(meilleur.longueur - marge, meilleur.t + demi);

      // Un mur plus court que l'ouverture la rétrécit plutôt que de la
      // refuser : mieux vaut une baie un peu étroite qu'un mur aveugle.
      if (fin - debut < TROU_MIN) {
        refuser(rang, ouverture, "mur trop court pour la percer", plusProche);
        return;
      }

      var chevauche = meilleur.mur.trous.some(function (autre) {
        return debut < autre.fin && fin > autre.debut;
      });
      if (chevauche) {
        refuser(rang, ouverture, "percement déjà occupé", plusProche);
        return;
      }

      meilleur.mur.trous.push({
        debut: debut,
        fin: fin,
        bas: ouverture.bas,
        haut: ouverture.haut,
        type: ouverture.type,
        vitre: ouverture.vitre === true,
        // Marque portée jusqu'ici depuis le plan 2D : c'est elle qui vaudra
        // encadrement distinctif et point de départ de la visite.
        entree: ouverture.entree === true
      });
      bilan.posees++;
    });

    return bilan;
  }

  /**
   * Vitrages à poser dans les percements qui en réclament.
   *
   * Le panneau occupe tout le trou : c'est lui qui ferme la baie, le mur
   * n'étant plus là pour le faire.
   */
  function vitrages(listeMurs, options) {
    var o = options || {};
    var epaisseur = o.epaisseur > 0 ? o.epaisseur : 0.02;
    var blocs = [];

    (listeMurs || []).forEach(function (mur) {
      var dx = mur.b[0] - mur.a[0], dz = mur.b[1] - mur.a[1];
      var lg = Math.sqrt(dx * dx + dz * dz);
      if (lg < LONGUEUR_MIN) return;

      var ux = dx / lg, uz = dz / lg;

      (mur.trous || []).forEach(function (trou) {
        if (!trou.vitre) return;
        var tm = (trou.debut + trou.fin) / 2;

        blocs.push({
          centre: [mur.a[0] + ux * tm, (trou.bas + trou.haut) / 2,
                   mur.a[1] + uz * tm],
          taille: [trou.fin - trou.debut, trou.haut - trou.bas, epaisseur],
          angle: mur.angle,
          type: trou.type
        });
      });
    });

    return blocs;
  }

  /**
   * Zones de dégagement devant chaque ouverture, à laisser libres.
   *
   * Renvoie un cercle par percement : centre au milieu du trou, rayon
   * couvrant le battant et le passage. Ce qu'on pose au sol n'a rien à faire
   * là — une porte ne se condamne pas.
   *
   * Plus personne ne l'appelle depuis le retrait de l'ameublement
   * automatique : la fonction reste, elle décrit une propriété du bâtiment
   * et non un usage particulier.
   */
  function degagements(listeMurs, profondeur, options) {
    var o = options || {};
    var rayonBase = profondeur > 0 ? profondeur : 1.0;
    var zones = [];

    (listeMurs || []).forEach(function (mur) {
      var dx = mur.b[0] - mur.a[0], dz = mur.b[1] - mur.a[1];
      var lg = Math.sqrt(dx * dx + dz * dz);
      if (lg < LONGUEUR_MIN) return;

      var ux = dx / lg, uz = dz / lg;

      (mur.trous || []).forEach(function (trou) {
        /* Par défaut, seule une ouverture qui descend au sol condamne le
           sol devant elle : on passe sous une fenêtre haute, et l'on peut
           s'y adosser. L'option `fenetres` étend le dégagement à toutes les
           ouvertures, fenêtres comprises. */
        if (!o.fenetres && trou.bas > 0.3) return;
        var tm = (trou.debut + trou.fin) / 2;

        zones.push({
          centre: [mur.a[0] + ux * tm, mur.a[1] + uz * tm],
          rayon: rayonBase + (trou.fin - trou.debut) / 2
        });
      });
    });

    return zones;
  }

  // ---------------------------------------------------------------------------
  // Habillage : quel revêtement sur quel mur
  // ---------------------------------------------------------------------------

  var PREFIXE = "maison-mur";

  // Teintes de peinture proposées en un clic.
  var PEINTURES = [
    { nom: "Blanc pur",       couleur: "#FFFFFF" },
    { nom: "Beige clair",     couleur: "#F5EFE6" },
    { nom: "Gris clair",      couleur: "#E0E0E0" },
    { nom: "Marron noisette", couleur: "#8B6F47" }
  ];

  // Champs recopiés d'un réglage à l'autre. `id` en est exclu : c'est lui qui
  // distingue les matériaux, le dupliquer les confondrait.
  var CHAMPS = [
    "mode", "texture", "couleur", "motif",
    "largeurCarreau", "longueurCarreau", "joint", "rotationAleatoire"
  ];

  function _copierChamps(source, cible) {
    CHAMPS.forEach(function (champ) {
      if (source && source[champ] !== undefined) cible[champ] = source[champ];
    });
    return cible;
  }

  /**
   * Jeu de réglages, de la même forme qu'une surface du module Surfaces.
   *
   * `court` compris : c'est ce que le métré met en tête de ligne, et une
   * surface qui n'en porterait pas s'y afficherait « undefined ».
   */
  function _reglages(id, nom, modele, court) {
    var r = {
      id: id,
      nom: nom,
      court: court || nom,
      type: "mur",
      mode: "carrele",
      texture: "",
      couleur: "#e9e5dd",
      motif: "droite",
      largeurCarreau: 0.6,
      longueurCarreau: 0.6,
      joint: 0.003,
      rotationAleatoire: false
    };
    return _copierChamps(modele, r);
  }

  /**
   * Crée l'habillage d'une maison.
   *
   * `global` vaut pour tous les murs ; `parMur` ne porte que les exceptions,
   * créées à la sélection d'un mur. Un mur sans exception suit le global :
   * changer le revêtement d'ensemble n'a donc rien à propager.
   */
  function creerHabillage(modele) {
    return {
      global: _reglages(PREFIXE + "s", "Tous les murs", modele, "Murs"),
      parMur: {},
      selection: -1
    };
  }

  /** Réglages effectifs d'un mur donné. */
  function pour(habillage, index) {
    if (!habillage) return null;
    return habillage.parMur[index] || habillage.global;
  }

  /** Réglages que le panneau doit modifier. */
  function cible(habillage) {
    if (!habillage) return null;
    return habillage.selection >= 0
      ? (habillage.parMur[habillage.selection] || habillage.global)
      : habillage.global;
  }

  /**
   * Désigne le mur que le panneau pilote, ou revient au global avec -1.
   *
   * Sélectionner un mur lui crée son propre jeu de réglages, copié de
   * l'existant : les modifications qui suivent ne débordent plus sur ses
   * voisins.
   */
  function selectionner(habillage, index) {
    if (!habillage) return null;

    if (index === null || index === undefined || index < 0) {
      habillage.selection = -1;
      return habillage.global;
    }

    if (!habillage.parMur[index]) {
      habillage.parMur[index] = _reglages(
        PREFIXE + "-" + index, "Mur " + (index + 1), habillage.global
      );
    }

    habillage.selection = index;
    return habillage.parMur[index];
  }

  /**
   * Étend les réglages courants à tous les murs et désélectionne.
   *
   * Les exceptions sont effacées, pas seulement ignorées : sans cela, elles
   * ressurgiraient au prochain passage en mode global.
   */
  function toutAppliquer(habillage) {
    if (!habillage) return null;

    var courant = cible(habillage);
    _copierChamps(courant, habillage.global);

    habillage.parMur = {};
    habillage.selection = -1;

    return habillage.global;
  }

  /** Un identifiant de réglages désigne-t-il l'habillage des murs ? */
  function estHabillage(identifiant) {
    return typeof identifiant === "string" &&
           identifiant.indexOf(PREFIXE) === 0;
  }

  /**
   * Repère de calepinage d'une face de mur.
   *
   * Renvoie la même forme d'objet que Calepinage.murs() : le calepinage du
   * sol et celui d'un mur de maison empruntent donc exactement le même code.
   * `cote` vaut +1 ou −1 pour l'une ou l'autre face.
   *
   * L'axe u est retourné avec la normale, sans quoi le calepinage se lirait
   * en miroir depuis la seconde face.
   */
  function repereFace(mur, hauteur, cote, epaisseur) {
    var dx = mur.b[0] - mur.a[0], dz = mur.b[1] - mur.a[1];
    var lg = Math.sqrt(dx * dx + dz * dz);
    if (lg < LONGUEUR_MIN) return null;

    var ux = dx / lg, uz = dz / lg;
    var sens = cote < 0 ? -1 : 1;
    var demi = (epaisseur > 0 ? epaisseur : EPAISSEUR) / 2;

    var nx = -uz * sens, nz = ux * sens;

    return {
      nom: "face",
      centre: [
        (mur.a[0] + mur.b[0]) / 2 + nx * demi,
        hauteur / 2,
        (mur.a[1] + mur.b[1]) / 2 + nz * demi
      ],
      axeU: [ux * sens, 0, uz * sens],
      normale: [nx, 0, nz],
      largeur: lg
    };
  }

  // ---------------------------------------------------------------------------
  // Entrée principale
  // ---------------------------------------------------------------------------

  /**
   * Identifiant de l'ouverture tenue pour l'entrée principale, ou null.
   * Forme : « niveau:index », l'index désignant l'ouverture dans la liste
   * relevée sur ce plan.
   */
  function definirEntree(niveau, index) {
    if (niveau === null || niveau === undefined || index === null ||
        index === undefined || index < 0) {
      API.entreeId = null;
    } else {
      API.entreeId = niveau + ":" + index;
    }
    return API.entreeId;
  }

  function estEntree(niveau, index) {
    return API.entreeId === niveau + ":" + index;
  }

  /**
   * Ouverture désignée par un clic sur le plan 2D.
   *
   * Les segments sont normalisés 0–1 ; le point est en pixels du canvas.
   * La plus proche l'emporte, sous réserve de rester dans la tolérance —
   * cliquer au milieu d'une pièce ne doit désigner personne.
   *
   * @returns {number} indice de l'ouverture, ou -1.
   */
  function ouverturePointee(ouvertures, x, y, largeur, hauteur, tolerance) {
    if (!ouvertures || !ouvertures.length) return -1;

    var seuil = tolerance > 0 ? tolerance : 14;
    var meilleur = -1, plusProche = Infinity;

    for (var i = 0; i < ouvertures.length; i++) {
      var segment = ouvertures[i] && ouvertures[i].segment;
      if (!segment || segment.length < 2) continue;

      var d = _distanceAuSegment(
        x, y,
        [segment[0][0] * largeur, segment[0][1] * hauteur],
        [segment[1][0] * largeur, segment[1][1] * hauteur]
      );

      if (d < plusProche && d <= seuil) { plusProche = d; meilleur = i; }
    }

    return meilleur;
  }

  /**
   * Le percement tenu pour l'entrée, avec son mur et son repère.
   *
   * @returns {{mur, trou, centre: [x, z], normale: [nx, nz]}|null}
   */
  function entree(listeMurs) {
    if (!listeMurs) return null;

    for (var i = 0; i < listeMurs.length; i++) {
      var mur = listeMurs[i];
      var trous = mur.trous || [];

      for (var j = 0; j < trous.length; j++) {
        if (!trous[j].entree) continue;

        var dx = mur.b[0] - mur.a[0], dz = mur.b[1] - mur.a[1];
        var lg = Math.sqrt(dx * dx + dz * dz);
        if (lg < LONGUEUR_MIN) continue;

        var ux = dx / lg, uz = dz / lg;
        var tm = (trous[j].debut + trous[j].fin) / 2;

        return {
          mur: mur,
          trou: trous[j],
          centre: [mur.a[0] + ux * tm, mur.a[1] + uz * tm],
          // Perpendiculaire au mur ; c'est l'appelant qui décide du côté,
          // lui seul sait où sont les pièces.
          normale: [-uz, ux]
        };
      }
    }

    return null;
  }

  /**
   * Encadrement d'un percement : deux jambages et un linteau, posés en
   * saillie de part et d'autre du mur.
   *
   * Sert à distinguer l'entrée principale des autres portes sans toucher à
   * la géométrie du percement lui-même.
   */
  function encadrements(listeMurs, options) {
    var o = options || {};
    var section = o.section > 0 ? o.section : 0.08;
    var epaisseur = (o.epaisseur > 0 ? o.epaisseur : EPAISSEUR) + 0.04;
    var blocs = [];

    (listeMurs || []).forEach(function (mur) {
      var dx = mur.b[0] - mur.a[0], dz = mur.b[1] - mur.a[1];
      var lg = Math.sqrt(dx * dx + dz * dz);
      if (lg < LONGUEUR_MIN) return;

      var ux = dx / lg, uz = dz / lg;

      (mur.trous || []).forEach(function (trou) {
        if (!trou.entree) return;

        function bloc(t1, t2, y1, y2) {
          if (t2 - t1 < 0.01 || y2 - y1 < 0.01) return;
          var tm = (t1 + t2) / 2;
          blocs.push({
            centre: [mur.a[0] + ux * tm, (y1 + y2) / 2, mur.a[1] + uz * tm],
            taille: [t2 - t1, y2 - y1, epaisseur],
            angle: mur.angle,
            altitude: mur.altitude || 0
          });
        }

        bloc(trou.debut - section, trou.debut, trou.bas, trou.haut);
        bloc(trou.fin, trou.fin + section, trou.bas, trou.haut);
        bloc(trou.debut - section, trou.fin + section,
             trou.haut, trou.haut + section);
      });
    });

    return blocs;
  }

  // ---------------------------------------------------------------------------
  // Escaliers
  // ---------------------------------------------------------------------------

  var HAUTEUR_MARCHE = 0.18;  // m, hauteur de marche visée
  var GIRON = 0.28;           // m, profondeur d'une marche
  var HAUTEUR_RAMPE = 0.90;   // m, main courante au-dessus du nez de marche

  /* Bornes d'un escalier repris à la main. Au-delà ce n'est plus un
     escalier : trois mètres de large, ou six de long pour monter un étage.
     En deçà on ne passe plus — soixante centimètres, c'est déjà étroit. */
  var LIMITES_ESCALIER = {
    largeur:  [0.60, 3.00],
    longueur: [1.00, 6.00],
    hauteur:  [1.00, 4.00]
  };

  /**
   * Ramène une cote dans ses bornes.
   *
   * @returns {number} la cote bornée, ou `defaut` si elle n'en est pas une.
   */
  function borneEscalier(nom, valeur, defaut) {
    var bornes = LIMITES_ESCALIER[nom];
    if (!bornes) return defaut;
    if (!isFinite(valeur) || valeur <= 0) return defaut;

    return Math.min(bornes[1], Math.max(bornes[0], valeur));
  }

  /** Enregistre une zone d'escalier tracée sur un plan, en coordonnées 0–1. */
  function ajouterEscalier(niveau, points) {
    if (!points || points.length < 4) return null;

    // Tous les sommets sont gardés : une zone d'escalier n'est pas
    // forcément un quadrilatère — une volée peut contourner un mur.
    var zone = { niveau: niveau, points: points.slice() };
    API.zonesEscalier.push(zone);
    return zone;
  }

  function viderEscaliers(niveau) {
    if (niveau === undefined) { API.zonesEscalier.length = 0; return; }

    for (var i = API.zonesEscalier.length - 1; i >= 0; i--) {
      if (API.zonesEscalier[i].niveau === niveau) API.zonesEscalier.splice(i, 1);
    }
  }

  /**
   * Repère d'une zone d'escalier : sens de montée et largeur.
   *
   * Le côté le plus long donne la direction de montée — c'est par là qu'on
   * grimpe. Le reste est mesuré sur la boîte englobante orientée sur cette
   * direction : la zone peut compter quatre sommets comme six, et des points
   * cliqués à la main ne forment jamais un polygone régulier. Prendre
   * l'emprise réelle plutôt que les deux côtés voisins du plus long évite
   * d'hériter de leur imprécision, et donne la même chose sur un rectangle.
   */
  function repereEscalier(zone) {
    if (!zone || zone.length < 4) return null;

    var n = zone.length;
    var meilleur = -1, plusLong = -1;

    for (var i = 0; i < n; i++) {
      var a = zone[i], b = zone[(i + 1) % n];
      var d = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) +
                        (b[1] - a[1]) * (b[1] - a[1]));
      if (d > plusLong) { plusLong = d; meilleur = i; }
    }

    if (plusLong < 0.3) return null;

    var depart = zone[meilleur];
    var suivant = zone[(meilleur + 1) % n];

    var ux = (suivant[0] - depart[0]) / plusLong;
    var uz = (suivant[1] - depart[1]) / plusLong;

    // Le travers, perpendiculaire à la montée en repère gaucher.
    var wx = -uz, wz = ux;

    // Emprise de tous les sommets, le long de la montée et en travers.
    var tMin = Infinity, tMax = -Infinity;
    var sMin = Infinity, sMax = -Infinity;

    for (var k = 0; k < n; k++) {
      var dx = zone[k][0] - depart[0];
      var dz = zone[k][1] - depart[1];

      var t = dx * ux + dz * uz;
      var s = dx * wx + dz * wz;

      if (t < tMin) tMin = t; if (t > tMax) tMax = t;
      if (s < sMin) sMin = s; if (s > sMax) sMax = s;
    }

    var longueur = tMax - tMin;
    var largeur = sMax - sMin;

    if (longueur < 0.3 || largeur < 0.3) return null;

    /* L'origine est le coin de l'emprise d'où part la volée : c'est de là
       que se comptent les marches et la largeur. */
    return {
      origine: [depart[0] + ux * tMin + wx * sMin,
                depart[1] + uz * tMin + wz * sMin],
      montee: [ux, uz],
      travers: [wx, wz],
      longueur: longueur,
      largeur: largeur
    };
  }

  /**
   * Marches et rampe d'un escalier, en mètres.
   *
   * La hauteur de marche est déduite du nombre de marches plutôt que
   * l'inverse : c'est la seule façon que la dernière arrive exactement au
   * plancher de l'étage. Un escalier qui s'arrête à deux centimètres du
   * niveau supérieur ne mène nulle part.
   *
   * Le giron nominal est de 28 cm, réduit si la zone tracée est trop courte
   * pour les loger tous — mieux vaut des marches serrées qu'une volée qui
   * déborde de son emprise.
   *
   * `largeur` et `longueur` reprennent à la main les cotes que le tracé
   * donnait. L'origine du repère ne bouge pas : l'escalier grandit depuis
   * son coin de départ et garde donc sa place au sol comme son orientation.
   *
   * @param {Array} zone      Quatre points [x, z] en mètres.
   * @param {Object} options  { hauteur, largeur, longueur, hauteurMarche, giron }
   */
  function escalier(zone, options) {
    var o = options || {};
    var hauteur = borneEscalier("hauteur", o.hauteur, 2.5);
    var viseeMarche = o.hauteurMarche > 0 ? o.hauteurMarche : HAUTEUR_MARCHE;
    var gironVise = o.giron > 0 ? o.giron : GIRON;

    var repere = repereEscalier(zone);
    if (!repere) return null;

    // Les cotes posées à la main l'emportent sur celles du tracé.
    var largeurVolee = borneEscalier("largeur", o.largeur, repere.largeur);
    var longueurVolee = borneEscalier("longueur", o.longueur, repere.longueur);

    var nombre = Math.max(1, Math.round(hauteur / viseeMarche));
    var hauteurMarche = hauteur / nombre;

    /* Le giron se déduit de la longueur et du nombre de marches, sans jamais
       dépasser le giron confortable : une volée courte serre ses marches,
       une volée longue ne les étire pas au-delà du raisonnable. */
    var giron = Math.min(gironVise, longueurVolee / nombre);
    var course = giron * nombre;

    var ux = repere.montee[0], uz = repere.montee[1];
    var wx = repere.travers[0], wz = repere.travers[1];

    // Le +X local suit le travers, le +Z la montée — même convention que
    // les murs, en repère gaucher Babylon.
    var angle = Math.atan2(-wz, wx);

    var marches = [];

    for (var i = 0; i < nombre; i++) {
      var t = (i + 0.5) * giron;
      var sommet = (i + 1) * hauteurMarche;

      marches.push({
        centre: [
          repere.origine[0] + ux * t + wx * largeurVolee / 2,
          sommet / 2,
          repere.origine[1] + uz * t + wz * largeurVolee / 2
        ],
        // Chaque marche monte du sol : l'escalier est plein, il se lit de
        // profil comme de dessous.
        taille: [largeurVolee, sommet, giron],
        angle: angle,
        rang: i
      });
    }

    var pente = Math.atan2(hauteur, course);
    var bord = Math.max(0.05, largeurVolee / 2 - 0.05);

    var rampe = {
      centre: [
        repere.origine[0] + ux * course / 2 + wx * (largeurVolee / 2 + bord),
        hauteur / 2 + HAUTEUR_RAMPE,
        repere.origine[1] + uz * course / 2 + wz * (largeurVolee / 2 + bord)
      ],
      taille: [Math.sqrt(course * course + hauteur * hauteur), 0.06, 0.06],

      /* Babylon compose les angles d'Euler dans l'ordre Z, X, Y : le roulis
         s'applique d'abord, dans le repère non encore lacé. RotationZ envoie
         le +X local sur (cos r, sin r), donc un roulis positif relève
         l'extrémité +X. Le lacet mettant ensuite ce +X dans le sens de la
         montée, la pente doit être positive pour que la rampe grimpe avec
         l'escalier — la signer à l'envers l'enterrerait dans les marches en
         haut de volée et la ferait flotter en bas. */
      angle: Math.atan2(-uz, ux),
      pente: pente
    };

    return {
      nombre: nombre,
      hauteurMarche: hauteurMarche,
      giron: giron,
      course: course,
      largeur: largeurVolee,
      // La longueur retenue, que le panneau de réglages réaffiche telle
      // quelle : bornée, elle peut différer de celle qu'on lui a demandée.
      longueur: longueurVolee,
      hauteur: hauteur,
      marches: marches,
      rampe: rampe
    };
  }

  // ---------------------------------------------------------------------------
  // Découpe en panneaux
  // ---------------------------------------------------------------------------

  /**
   * Découpe un mur en boîtes, en contournant ses percements.
   *
   * Aucune géométrie constructive n'est nécessaire : un mur percé se bâtit
   * en trumeaux pleins de part et d'autre du trou, plus une allège dessous
   * et un linteau dessus. C'est plus léger qu'une soustraction de volumes,
   * et les collisions de la visite s'en accommodent naturellement.
   *
   * @returns {Array} [{ centre: [x, y, z], taille: [long, haut, ep], angle }]
   */
  function panneaux(mur, hauteur, epaisseur) {
    var ep = epaisseur > 0 ? epaisseur : EPAISSEUR;
    var blocs = [];

    var dx = mur.b[0] - mur.a[0], dz = mur.b[1] - mur.a[1];
    var lg = Math.sqrt(dx * dx + dz * dz);
    if (lg < LONGUEUR_MIN || !(hauteur > 0)) return blocs;

    var ux = dx / lg, uz = dz / lg;

    function bloc(t1, t2, y1, y2) {
      if (t2 - t1 < 0.01 || y2 - y1 < 0.01) return;
      var tm = (t1 + t2) / 2;
      blocs.push({
        centre: [mur.a[0] + ux * tm, (y1 + y2) / 2, mur.a[1] + uz * tm],
        taille: [t2 - t1, y2 - y1, ep],
        angle: mur.angle
      });
    }

    var trous = (mur.trous || []).slice().sort(function (p, q) {
      return p.debut - q.debut;
    });

    var curseur = 0;

    trous.forEach(function (trou) {
      var debut = Math.max(0, Math.min(lg, trou.debut));
      var fin   = Math.max(0, Math.min(lg, trou.fin));
      if (fin - debut < 0.01) return;

      if (debut > curseur) bloc(curseur, debut, 0, hauteur);
      if (trou.bas > 0)     bloc(debut, fin, 0, trou.bas);
      if (trou.haut < hauteur) bloc(debut, fin, trou.haut, hauteur);

      curseur = Math.max(curseur, fin);
    });

    if (lg > curseur) bloc(curseur, lg, 0, hauteur);

    return blocs;
  }

  /** Longueur cumulée des murs, pour le métré. */
  function longueurTotale(listeMurs) {
    return (listeMurs || []).reduce(function (somme, mur) {
      return somme + mur.longueur;
    }, 0);
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  var API = {
    EPAISSEUR:    EPAISSEUR,
    TOLERANCE:    TOLERANCE,
    LONGUEUR_MIN: LONGUEUR_MIN,
    PEINTURES:    PEINTURES,
    PREFIXE:      PREFIXE,

    creerHabillage: creerHabillage,
    pour:           pour,
    cible:          cible,
    selectionner:   selectionner,
    toutAppliquer:  toutAppliquer,
    estHabillage:   estHabillage,
    repereFace:     repereFace,

    repere:         repere,
    versMonde:      versMonde,
    versNormalise:  versNormalise,
    pointVersMonde: pointVersMonde,
    murs:           murs,
    percer:         percer,
    vitrages:       vitrages,
    degagements:    degagements,
    panneaux:       panneaux,
    longueurTotale: longueurTotale,

    // Entrée principale : identifiant de l'ouverture qui en tient lieu.
    entreeId:         null,
    definirEntree:    definirEntree,
    estEntree:        estEntree,
    ouverturePointee: ouverturePointee,
    entree:           entree,
    encadrements:     encadrements,

    // Escaliers : zones tracées sur le plan, en coordonnées normalisées.
    zonesEscalier:   [],
    HAUTEUR_MARCHE:  HAUTEUR_MARCHE,
    GIRON:           GIRON,
    ajouterEscalier: ajouterEscalier,
    viderEscaliers:  viderEscaliers,
    repereEscalier:  repereEscalier,
    escalier:        escalier,
    LIMITES_ESCALIER: LIMITES_ESCALIER,
    borneEscalier:   borneEscalier
  };

  global.MursPlan = API;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }

})(typeof window !== "undefined" ? window : globalThis);
