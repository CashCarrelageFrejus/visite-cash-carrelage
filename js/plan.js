/**
 * Catalogue 3D — outil plan de masse
 *
 * Fonctions pures pour le tracé d'une pièce polygonale à partir d'un
 * plan photographié : étalonnage d'échelle, capture des sommets,
 * triangulation par "ear-clipping", test d'inclusion.
 *
 * Module pur : aucune dépendance DOM ni Babylon. Testable sous Node.
 * Le rendu et l'interaction sont entièrement gérés par scene.js.
 *
 * Convention de coordonnées :
 *   • dans le traceur (canvas) : {x, y} en pixels, y vers le bas
 *   • dans la scène 3D (Babylon) : [x, z] en mètres, y = altitude
 */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Géométrie 2D — traceur
  // ---------------------------------------------------------------------------

  /**
   * Aire algébrique du polygone (formule du lacet).
   * Résultat positif si les sommets sont dans le sens anti-horaire
   * en coordonnées mathématiques (Y vers le haut) ; négatif sinon.
   * En coordonnées canvas (Y vers le bas) le signe est inversé.
   */
  function aireSignee(pts) {
    var n = pts.length, a = 0;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return a / 2;
  }

  /**
   * Contraint la direction depuis `prev` vers `curr` au multiple de 90°
   * le plus proche (snap orthogonal, activé par la touche Shift).
   *
   * @param {{x, y}} prev  Point d'origine (en pixels canvas).
   * @param {{x, y}} curr  Position courante du curseur.
   * @returns {{x, y}}     Position contrainte.
   */
  function orthoSnap(prev, curr) {
    var dx = curr.x - prev.x;
    var dy = curr.y - prev.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return { x: prev.x, y: prev.y };

    var angle = Math.atan2(dy, dx);
    // Arrondi au multiple de 90° le plus proche
    var angle90 = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);

    return {
      x: Math.round(prev.x + Math.cos(angle90) * dist),
      y: Math.round(prev.y + Math.sin(angle90) * dist)
    };
  }

  // ---------------------------------------------------------------------------
  // Test d'inclusion — ray-casting
  // ---------------------------------------------------------------------------

  /**
   * Teste si le point `pt` ([x, z]) est à l'intérieur du polygone `poly`
   * (tableau de [x, z]).  Algorithme du lancer de rayon vers +X.
   *
   * Fonctionne sur les polygones convexes et non convexes.
   * Cas limites (bord, sommet) : résultat indéfini mais sans erreur.
   */
  function pointDansPolygone(pt, poly) {
    var x = pt[0], z = pt[1];
    var dedans = false;
    var n = poly.length;

    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = poly[i][0], zi = poly[i][1];
      var xj = poly[j][0], zj = poly[j][1];

      if (((zi > z) !== (zj > z)) &&
          (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
        dedans = !dedans;
      }
    }
    return dedans;
  }

  // ---------------------------------------------------------------------------
  // Triangulation par ear-clipping
  // ---------------------------------------------------------------------------

  function _signTriangle(p1, p2, p3) {
    return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  }

  function _ptDansTriangle(p, a, b, c) {
    var d1 = _signTriangle(p, a, b);
    var d2 = _signTriangle(p, b, c);
    var d3 = _signTriangle(p, c, a);
    var neg = d1 < 0 || d2 < 0 || d3 < 0;
    var pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }

  /**
   * Teste si le sommet `i` du polygone `pts` forme une "oreille" :
   *   1. L'angle intérieur est convexe (dans le sens de la liste).
   *   2. Aucun autre sommet ne se trouve dans le triangle formé.
   *
   * @param {Array<{x,y}>} pts    Sommets du polygone (en cours de réduction).
   * @param {number}        i     Indice du sommet testé.
   * @param {boolean}       ccw   Vrai si le polygone est orienté CCW.
   */
  function _estOreille(pts, i, ccw) {
    var n = pts.length;
    var a = pts[(i - 1 + n) % n];
    var b = pts[i];
    var c = pts[(i + 1) % n];

    // Signe du produit vectoriel 2D : positif = tourner à gauche (CCW)
    var cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    // Une oreille doit être convexe dans le bon sens
    if (ccw ? cross <= 0 : cross >= 0) return false;

    // Aucun autre sommet dans le triangle (sauf les voisins immédiats)
    for (var j = 0; j < n; j++) {
      if (j === (i - 1 + n) % n || j === i || j === (i + 1) % n) continue;
      if (_ptDansTriangle(pts[j], a, b, c)) return false;
    }
    return true;
  }

  /**
   * Triangule un polygone simple par ear-clipping.
   *
   * @param {Array<{x, y}>} sommets  Sommets dans un sens quelconque.
   * @returns {Array<Array<{x, y}>>} Liste de triangles [a, b, c].
   *
   * Fonctionne sur les polygones convexes et non convexes.
   * Dégénérescences (côtés nuls, auto-intersections) : résultat partiel.
   */
  function triangulation(sommets) {
    if (!sommets || sommets.length < 3) return [];

    // Copie de travail
    var pts = sommets.map(function (p) { return { x: p.x, y: p.y }; });
    var triangles = [];

    // Normaliser en CCW (aire signée positive en coords mathématiques).
    // En canvas (Y vers le bas), aireSignee < 0 correspond à CCW visuel ;
    // on l'accepte tel quel — seule la cohérence interne importe.
    var ccw = aireSignee(pts) > 0;
    if (!ccw) {
      pts.reverse();
      ccw = true;
    }

    var maxIter = pts.length * pts.length + pts.length;

    for (var iter = 0; pts.length > 3 && iter < maxIter; iter++) {
      var taille = pts.length;
      var trouve = false;

      for (var i = 0; i < taille; i++) {
        if (_estOreille(pts, i, ccw)) {
          var n = pts.length;
          triangles.push([
            { x: pts[(i - 1 + n) % n].x, y: pts[(i - 1 + n) % n].y },
            { x: pts[i].x,                y: pts[i].y                },
            { x: pts[(i + 1) % n].x,      y: pts[(i + 1) % n].y     }
          ]);
          pts.splice(i, 1);
          trouve = true;
          break;
        }
      }

      if (!trouve) break; // polygone dégénéré — s'arrêter proprement
    }

    if (pts.length === 3) {
      triangles.push([
        { x: pts[0].x, y: pts[0].y },
        { x: pts[1].x, y: pts[1].y },
        { x: pts[2].x, y: pts[2].y }
      ]);
    }

    return triangles;
  }

  // ---------------------------------------------------------------------------
  // Découpe d'un carreau sur le contour du sol
  // ---------------------------------------------------------------------------

  /* Un carreau posé à cheval sur le bord doit être coupé, pas jeté ni gardé
     entier : gardé entier il déborde de la maison, jeté il laisse un liseré
     nu le long des murs.

     Sutherland–Hodgman coupe un polygone par un demi-plan, mais ne vaut que
     si la zone de coupe est convexe — or un plan en L ne l'est pas. D'où le
     détour : on triangule le contour une fois, et on coupe le carreau sur
     chaque triangle. Les triangles pavent le contour sans se recouvrir, les
     morceaux obtenus ne se recouvrent donc pas davantage, et chacun reste
     convexe — ce qui compte, car l'appelant les maille en éventail. */

  /** Aire minimale d'un morceau retenu : 1 mm². En deçà, c'est un artefact. */
  var AIRE_MORCEAU_MIN = 1e-6;

  /**
   * Côté du point p par rapport à la droite orientée a→b.
   * Positif à gauche, négatif à droite, nul sur la droite.
   */
  function _cote(a, b, p) {
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  }

  /** Ce qui reste du polygone à gauche de la droite orientée a→b. */
  function _couperDemiPlan(polygone, a, b) {
    var sortie = [];
    var n = polygone.length;

    for (var i = 0; i < n; i++) {
      var p = polygone[i];
      var q = polygone[(i + 1) % n];
      var dp = _cote(a, b, p);
      var dq = _cote(a, b, q);

      if (dp >= 0) sortie.push(p);

      // Le segment traverse la droite : le point de passage entre au contour.
      if ((dp >= 0) !== (dq >= 0)) {
        var t = dp / (dp - dq);
        sortie.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }

    return sortie;
  }

  /**
   * Intersection d'un polygone convexe et d'un triangle.
   *
   * @param {Array} polygone  [[x, z], …] convexe.
   * @param {Array} triangle  [[x, z], [x, z], [x, z]].
   * @returns {Array|null} le morceau commun, ou null s'il n'y en a pas.
   */
  function couperSurTriangle(polygone, triangle) {
    if (!polygone || polygone.length < 3 || !triangle || triangle.length < 3) {
      return null;
    }

    /* Le sens du triangle décide de quel côté « la gauche » se trouve. Le
       redresser ici évite de dépendre de celui que la triangulation a
       retenu. Trois points alignés n'ont pas de côté : les couper donnerait
       un polygone d'aire nulle plutôt que rien du tout. */
    var oriente = _cote(triangle[0], triangle[1], triangle[2]);
    if (Math.abs(oriente) < 1e-12) return null;

    var t = oriente > 0
      ? triangle
      : [triangle[0], triangle[2], triangle[1]];

    var morceau = polygone;
    for (var i = 0; i < 3; i++) {
      morceau = _couperDemiPlan(morceau, t[i], t[(i + 1) % 3]);
      if (morceau.length < 3) return null;
    }

    return morceau;
  }

  /** Triangles d'un contour [[x, z], …], prêts pour `decouperSurContour`. */
  function trianglesDeContour(contour) {
    if (!contour || contour.length < 3) return [];

    return triangulation(contour.map(function (p) {
      return { x: p[0], y: p[1] };
    })).map(function (tri) {
      return tri.map(function (p) { return [p.x, p.y]; });
    });
  }

  /**
   * Ce qui reste d'un carreau une fois ramené dans le contour du sol.
   *
   * @param {Array} polygone   [[x, z], …] convexe — le carreau.
   * @param {Array} triangles  sortie de `trianglesDeContour`, calculée une
   *                           seule fois pour tous les carreaux.
   * @returns {Array<Array>} zéro morceau (carreau hors du sol), un seul
   *   (carreau entier, le cas courant), ou plusieurs.
   *
   * Un carreau peut se scinder ailleurs qu'au bord : les diagonales de la
   * triangulation traversent le sol de part en part, et un carreau à cheval
   * sur deux triangles rend deux morceaux. Ils sont jointifs au bit près —
   * le point de coupe se calcule des deux côtés sur la même arête — donc
   * sans fente ni recouvrement à l'écran.
   */
  function decouperSurContour(polygone, triangles) {
    if (!polygone || polygone.length < 3 || !triangles || !triangles.length) {
      return [];
    }

    var xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    polygone.forEach(function (p) {
      if (p[0] < xMin) xMin = p[0];
      if (p[0] > xMax) xMax = p[0];
      if (p[1] < zMin) zMin = p[1];
      if (p[1] > zMax) zMax = p[1];
    });

    var morceaux = [];

    triangles.forEach(function (tri) {
      /* Rejet par les boîtes d'abord : sur un sol un peu grand, l'immense
         majorité des couples carreau/triangle ne se touchent pas, et trois
         coupes de Sutherland–Hodgman coûtent bien plus que six comparaisons. */
      var tx1 = Math.min(tri[0][0], tri[1][0], tri[2][0]);
      if (tx1 > xMax) return;
      var tx2 = Math.max(tri[0][0], tri[1][0], tri[2][0]);
      if (tx2 < xMin) return;
      var tz1 = Math.min(tri[0][1], tri[1][1], tri[2][1]);
      if (tz1 > zMax) return;
      var tz2 = Math.max(tri[0][1], tri[1][1], tri[2][1]);
      if (tz2 < zMin) return;

      var morceau = couperSurTriangle(polygone, tri);

      /* Deux triangles voisins partagent une arête : un carreau qui la longe
         y produit un morceau d'aire nulle. Le garder ferait des triangles
         dégénérés, et le long d'une arête intérieure, du z-fighting. */
      if (morceau && airePolygone(morceau) > AIRE_MORCEAU_MIN) {
        morceaux.push(morceau);
      }
    });

    return morceaux;
  }

  /**
   * Ce qu'il reste d'un polygone convexe une fois un rectangle retiré.
   *
   * Un percement est un rectangle : porte, fenêtre, baie. Le retirer d'un
   * carreau donne une forme en L, en U ou en cadre — non convexe, donc
   * impropre à l'éventail de triangles qui maille les carreaux.
   *
   * D'où la découpe en quatre bandes plutôt qu'un contour unique : les deux
   * côtés sur toute la hauteur, puis le dessus et le dessous de ce qui reste
   * entre eux. Quatre morceaux convexes, jointifs, sans recouvrement, et
   * jamais plus de quatre quelle que soit la position du trou.
   *
   *      ┌───┬───────┬───┐
   *      │   │  haut │   │
   *      │ g ├───────┤ d │      g et d courent sur toute la hauteur,
   *      │ a │ TROU  │ r │      haut et bas ne prennent que l'entre-deux.
   *      │ u ├───────┤ o │
   *      │ c │  bas  │ i │
   *      └───┴───────┴───┘
   *
   * @param {Array} polygone  [[u, v], …] convexe.
   * @param {Object} trou     { u1, u2, v1, v2 }, bornes du percement.
   * @returns {Array<Array>} de zéro à quatre morceaux.
   */
  function retirerRectangle(polygone, trou) {
    if (!polygone || polygone.length < 3 || !trou) return [];

    var morceaux = [];

    function garder(part) {
      if (part.length >= 3 && airePolygone(part) > AIRE_MORCEAU_MIN) {
        morceaux.push(part);
      }
    }

    /* Les demi-plans se disent par une droite orientée : `_couperDemiPlan`
       garde ce qui est à sa gauche. Deux points suffisent à la porter. */
    garder(_couperDemiPlan(polygone, [trou.u1, 0], [trou.u1, 1]));   // u ≤ u1
    garder(_couperDemiPlan(polygone, [trou.u2, 1], [trou.u2, 0]));   // u ≥ u2

    var entre = _couperDemiPlan(polygone, [trou.u1, 1], [trou.u1, 0]);
    if (entre.length >= 3) {
      entre = _couperDemiPlan(entre, [trou.u2, 0], [trou.u2, 1]);
    }

    if (entre.length >= 3) {
      garder(_couperDemiPlan(entre, [1, trou.v1], [0, trou.v1]));    // v ≤ v1
      garder(_couperDemiPlan(entre, [0, trou.v2], [1, trou.v2]));    // v ≥ v2
    }

    return morceaux;
  }

  /**
   * Ce qu'il reste d'un carreau une fois tous les percements retirés.
   *
   * Les trous s'enlèvent l'un après l'autre, chaque morceau repassant sous
   * le suivant : deux fenêtres proches ne se marchent donc pas dessus.
   *
   * @param {Array} polygone  [[u, v], …] convexe.
   * @param {Array} trous     [{ u1, u2, v1, v2 }, …]
   * @returns {Array<Array>} morceaux convexes, vide si tout est percé.
   */
  function retirerRectangles(polygone, trous) {
    if (!polygone || polygone.length < 3) return [];
    if (!trous || !trous.length) return [polygone];

    var morceaux = [polygone];

    trous.forEach(function (trou) {
      var reste = [];
      morceaux.forEach(function (part) {
        retirerRectangle(part, trou).forEach(function (bout) {
          reste.push(bout);
        });
      });
      morceaux = reste;
    });

    return morceaux;
  }

  /**
   * Ce qu'un calepinage laisse une fois ramené dans un contour.
   *
   * Calepinage.calculer pose sa trame sur une boîte : c'est le seul cadre
   * qu'il connaisse. Sur un plan en L, ou dès que le tracé laisse un garage
   * de côté, cette boîte déborde largement ce qui sera carrelé. Le métré
   * comptait donc des carreaux que personne ne poserait — et c'est un devis.
   *
   * Un carreau entamé par le contour reste un carreau acheté : `total` les
   * compte tous, entiers comme recoupés. La chute, elle, s'ajoute par-dessus,
   * ailleurs.
   *
   * @param {Array} carreaux     `resultat.carreaux` de Calepinage.
   * @param {Array} triangles    sortie de `trianglesDeContour`.
   * @param {number} aireCarreau aire d'un carreau entier, en m².
   * @returns {{entiers, coupes, total, surfacePosee, surfaceSol}}
   */
  function compterSurContour(carreaux, triangles, aireCarreau) {
    var bilan = {
      entiers: 0, coupes: 0, total: 0, surfacePosee: 0, surfaceSol: 0
    };
    if (!carreaux || !triangles || !triangles.length) return bilan;

    triangles.forEach(function (tri) {
      bilan.surfaceSol += airePolygone(tri);
    });

    carreaux.forEach(function (carreau) {
      var morceaux = decouperSurContour(carreau.contour, triangles);
      if (!morceaux.length) return;

      var aire = 0;
      morceaux.forEach(function (m) { aire += airePolygone(m); });
      if (!(aire > 0)) return;

      bilan.total++;
      bilan.surfacePosee += aire;

      /* Entier ou recoupé se juge sur ce qu'il en reste. La tolérance est
         celle de Calepinage : une coupe qui n'enlève qu'un millième du
         carreau ne fait pas de lui un carreau à recouper. */
      if (aire >= aireCarreau * 0.999) bilan.entiers++;
      else bilan.coupes++;
    });

    return bilan;
  }

  // ---------------------------------------------------------------------------
  // Conversion canvas → coordonnées monde 3D
  // ---------------------------------------------------------------------------

  /**
   * Convertit des sommets canvas (pixels) en coordonnées monde 3D (mètres).
   *
   * Le résultat est un tableau de [x, z] centré sur l'origine (barycentre).
   * L'axe X du canvas devient l'axe X du monde ; l'axe Y du canvas descend,
   * le Z du monde remonte — d'où le changement de signe.
   *
   * Ce signe accorde le plan et la scène. Sans lui, la maison serait bâtie
   * en miroir : les longueurs resteraient justes, mais la gauche et la
   * droite seraient échangées une fois à l'intérieur. Voir la note détaillée
   * en tête de MursPlan.versMonde, qui fait la même conversion pour les murs.
   *
   * @param {Array<{x, y}>} sommets  Coordonnées canvas.
   * @param {number}         echelle  Pixels par mètre (issue de la calibration).
   * @returns {Array<[number, number]>}  [[x, z], …] en mètres.
   */
  function sommetsVersMonde(sommets, echelle) {
    if (!echelle || echelle <= 0 || !sommets || !sommets.length) return [];

    var pts = sommets.map(function (s) {
      return [s.x / echelle, s.y / echelle];
    });

    // Centrer sur l'origine (barycentre)
    var cx = 0, cz = 0;
    pts.forEach(function (p) { cx += p[0]; cz += p[1]; });
    cx /= pts.length;
    cz /= pts.length;

    return pts.map(function (p) { return [p[0] - cx, -(p[1] - cz)]; });
  }

  /**
   * Dimensions de la boîte englobante d'un polygone monde [[x, z]].
   *
   * @returns {{ longueur: number, largeur: number }}
   *   longueur = étendue sur X, largeur = étendue sur Z.
   */
  function boiteEnglobante(pts) {
    if (!pts || !pts.length) return { longueur: 0, largeur: 0 };

    var xMin = Infinity, xMax = -Infinity;
    var zMin = Infinity, zMax = -Infinity;

    pts.forEach(function (p) {
      if (p[0] < xMin) xMin = p[0]; if (p[0] > xMax) xMax = p[0];
      if (p[1] < zMin) zMin = p[1]; if (p[1] > zMax) zMax = p[1];
    });

    return {
      longueur: xMax - xMin,
      largeur:  zMax - zMin
    };
  }

  // ---------------------------------------------------------------------------
  // Accrochage d'une pièce au réseau de murs
  // ---------------------------------------------------------------------------

  /**
   * Réglages de l'accrochage, en mètres.
   *
   * La tolérance de 30 cm est celle d'un relevé : un mur de 20 cm dessiné à
   * la main, plus l'imprécision du modèle qui l'a relevé sur une image. Plus
   * large, on accrocherait un bord au mur d'à côté ; plus étroit, on
   * laisserait sur place des bords manifestement destinés à ce mur-là.
   */
  var ACCROCHE = {
    tolerance:    0.30,            // écart maximal entre un bord et son mur
    angle:        Math.PI / 22.5,  // 8° — au-delà, bord et mur divergent
    recouvrement: 0.20,            // longueur commune minimale
    saut:         1.00,            // déplacement maximal d'un sommet
    retrait:      0                // décalage vers l'intérieur de la pièce
  };

  /** Aire d'un polygone monde [[x, z]], en m². */
  function airePolygone(pts) {
    if (!pts || pts.length < 3) return 0;

    var a = 0;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    }
    return Math.abs(a) / 2;
  }

  /**
   * Centre de gravité d'un polygone monde [[x, z]].
   *
   * La moyenne des sommets ne suffit pas : sur une pièce en L elle peut
   * tomber hors des murs, et c'est ce point qui dit de quel côté d'un mur se
   * trouve l'intérieur. On prend donc le vrai centroïde, et on ne retombe
   * sur la moyenne que si l'aire est nulle.
   */
  function _centroide(pts) {
    if (!pts || !pts.length) return null;

    var a = 0, cx = 0, cz = 0;

    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      a  += f;
      cx += (pts[j][0] + pts[i][0]) * f;
      cz += (pts[j][1] + pts[i][1]) * f;
    }

    if (Math.abs(a) > 1e-12) return [cx / (3 * a), cz / (3 * a)];

    var sx = 0, sz = 0;
    pts.forEach(function (p) { sx += p[0]; sz += p[1]; });
    return [sx / pts.length, sz / pts.length];
  }

  /** Direction unitaire de a vers b, et longueur. null si a et b coïncident. */
  function _direction(a, b) {
    var dx = b[0] - a[0], dz = b[1] - a[1];
    var lg = Math.sqrt(dx * dx + dz * dz);
    if (lg < 1e-9) return null;
    return { d: [dx / lg, dz / lg], lg: lg };
  }

  /**
   * Intersection de deux droites (point + direction), ou null si elles sont
   * trop parallèles pour que le point de croisement veuille dire quelque chose.
   */
  function _croisement(p1, d1, p2, d2) {
    var det = d1[0] * d2[1] - d1[1] * d2[0];
    // sin 5° : en deçà, deux murs sont dans le prolongement l'un de l'autre
    // et leur « coin » partirait à l'infini.
    if (Math.abs(det) < 0.0872) return null;

    var wx = p2[0] - p1[0], wz = p2[1] - p1[1];
    var t = (wx * d2[1] - wz * d2[0]) / det;

    return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
  }

  /** Sommets consécutifs confondus retirés : ils ne portent aucun bord. */
  function _degrouper(contour) {
    var net = [];
    contour.forEach(function (p) {
      var dernier = net[net.length - 1];
      if (dernier && Math.abs(dernier[0] - p[0]) < 1e-9 &&
                     Math.abs(dernier[1] - p[1]) < 1e-9) return;
      net.push([p[0], p[1]]);
    });

    // Le dernier peut rejoindre le premier : le polygone se ferme tout seul.
    while (net.length > 1) {
      var a = net[0], b = net[net.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) net.pop();
      else break;
    }

    return net;
  }

  /**
   * Quelles pièces attestent la droite que porte chaque mur.
   *
   * La question ne se pose pas tronçon par tronçon : une façade est découpée
   * à chaque pièce qui vient s'y appuyer, et l'un de ces morceaux peut
   * n'être bordé que par une seule d'entre elles sans cesser d'être une
   * façade. C'est le plan du mur qui compte, pas la tranche.
   *
   * @returns {Array<Array<number>>} par mur, les rangs des pièces qui
   *   attestent sa droite — le sien compris.
   */
  function _soutiensParDroite(murs, tolerance) {
    var lignes = [];
    var rattachement = [];

    murs.forEach(function (mur) {
      var axe = (mur && mur.a && mur.b) ? _direction(mur.a, mur.b) : null;
      if (!axe) { rattachement.push(-1); return; }

      var trouve = -1;

      for (var i = 0; i < lignes.length && trouve < 0; i++) {
        var l = lignes[i];

        // 5° : au-delà, deux murs ne sont plus dans le même plan.
        if (Math.abs(l.d[0] * axe.d[1] - l.d[1] * axe.d[0]) > 0.0872) continue;

        var ea = Math.abs(-l.d[1] * (mur.a[0] - l.p[0]) + l.d[0] * (mur.a[1] - l.p[1]));
        var eb = Math.abs(-l.d[1] * (mur.b[0] - l.p[0]) + l.d[0] * (mur.b[1] - l.p[1]));
        if (ea > tolerance || eb > tolerance) continue;

        trouve = i;
      }

      if (trouve < 0) {
        lignes.push({ p: [mur.a[0], mur.a[1]], d: axe.d, pieces: [] });
        trouve = lignes.length - 1;
      }

      (mur.pieces || []).forEach(function (p) {
        if (lignes[trouve].pieces.indexOf(p) < 0) lignes[trouve].pieces.push(p);
      });

      rattachement.push(trouve);
    });

    return rattachement.map(function (i) {
      return i < 0 ? [] : lignes[i].pieces;
    });
  }

  /**
   * Cherche le mur qui porte un bord de pièce.
   *
   * Trois conditions, toutes nécessaires : le mur doit être parallèle au
   * bord, en être assez proche, et courir le long de lui sur une longueur
   * appréciable. Sans cette dernière, un bord s'accrocherait à un mur
   * lointain qui se trouve simplement aligné avec lui.
   */
  function _murPorteur(a, b, bord, murs, soutiens, reglages) {
    var mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    var sinTol = Math.sin(reglages.angle);
    var meilleur = null;

    murs.forEach(function (mur, rang) {
      if (!mur || !mur.a || !mur.b) return;

      /* Un plan de mur que seule cette pièce atteste n'est rien d'autre que
         son propre bord : s'y accrocher, c'est se donner raison à soi-même,
         et une pièce mal relevée resterait mal relevée en se croyant
         vérifiée. Une façade, elle, est attestée par toutes les pièces qui
         la longent, et une cloison par les deux qu'elle sépare. */
      if (soutiens) {
        var atteste = soutiens[rang];
        if (atteste.length === 1 && atteste[0] === reglages.piece) return;
      }

      var axe = _direction(mur.a, mur.b);
      if (!axe) return;

      // Parallélisme, au sens de la droite : un mur parcouru à l'envers
      // porte le même bord.
      var croix = Math.abs(bord.d[0] * axe.d[1] - bord.d[1] * axe.d[0]);
      if (croix > sinTol) return;

      var ecart = Math.abs(-axe.d[1] * (mx - mur.a[0]) +
                            axe.d[0] * (mz - mur.a[1]));
      if (ecart > reglages.tolerance) return;

      // Longueur commune, mesurée le long du mur.
      var t1 = (a[0] - mur.a[0]) * axe.d[0] + (a[1] - mur.a[1]) * axe.d[1];
      var t2 = (b[0] - mur.a[0]) * axe.d[0] + (b[1] - mur.a[1]) * axe.d[1];

      var commun = Math.min(Math.max(t1, t2), axe.lg) -
                   Math.max(Math.min(t1, t2), 0);

      if (commun < reglages.recouvrement) return;
      if (commun < 0.30 * Math.min(bord.lg, axe.lg)) return;

      // Le plus proche l'emporte ; à distance égale, le plus longuement
      // partagé — c'est bien lui qui délimite la pièce.
      var note = ecart - Math.min(commun, bord.lg) * 0.02;

      if (!meilleur || note < meilleur.note) {
        meilleur = { mur: mur, axe: axe, ecart: ecart, commun: commun, note: note };
      }
    });

    return meilleur;
  }

  /**
   * Accroche le contour d'une pièce au réseau de murs.
   *
   * Le raisonnement est celui d'un plan de bâtiment : les murs font foi, le
   * polygone de la pièce ne sert qu'à désigner la zone. Chaque bord cherche
   * donc le mur qui le porte et adopte sa droite ; les sommets sont ensuite
   * refaits en croisant les droites voisines. La pièce obtenue suit
   * réellement les murs, et reste fermée par construction.
   *
   * Un bord sans mur garde sa droite d'origine, et la pièce n'est alors plus
   * délimitée de tous les côtés : `ferme` le dit, à l'appelant d'en tirer les
   * conséquences.
   *
   * `options.piece` est le rang de la pièce dans le jeu qui a engendré les
   * murs. Le préciser écarte les murs qu'elle est seule à attester — sans
   * quoi un bord mal placé s'accrocherait au mur né de ce bord même, et se
   * déclarerait vérifié sans avoir bougé d'un centimètre.
   *
   * @param {Array} contour  [[x, z], …] en mètres — la zone repérée.
   * @param {Array} murs     [{ a: [x, z], b: [x, z], pieces }] en mètres.
   * @param {Object} [options] { tolerance, angle, recouvrement, saut, retrait,
   *                             piece }
   * @returns {{contour, accroches, total, ferme, deplacement, aire}}
   */
  function accrocherAuxMurs(contour, murs, options) {
    var o = options || {};
    var reglages = {
      tolerance:    o.tolerance    === undefined ? ACCROCHE.tolerance    : o.tolerance,
      angle:        o.angle        === undefined ? ACCROCHE.angle        : o.angle,
      recouvrement: o.recouvrement === undefined ? ACCROCHE.recouvrement : o.recouvrement,
      saut:         o.saut         === undefined ? ACCROCHE.saut         : o.saut,
      retrait:      o.retrait      === undefined ? ACCROCHE.retrait      : o.retrait,
      // Rang de la pièce recalée, quand les murs portent leur provenance.
      piece:        o.piece        === undefined ? null                  : o.piece
    };

    var depart = _degrouper(contour || []);

    var tel_quel = {
      contour: depart,
      accroches: 0,
      total: depart.length,
      ferme: false,
      deplacement: 0,
      aire: airePolygone(depart)
    };

    if (depart.length < 3 || !murs || !murs.length) return tel_quel;

    var centre = _centroide(depart);

    /* Les plans de mur sont regroupés deux fois plus finement que la
       tolérance d'accrochage : sans cela, le bord fautif d'une pièce se
       confondrait avec la vraie cloison toute proche, et se ferait attester
       par la pièce d'en face. */
    var soutiens = reglages.piece === null
      ? null
      : _soutiensParDroite(murs, reglages.tolerance / 2);

    /* 1. Chaque bord adopte la droite du mur qui le porte.
          Le retrait se prend vers l'intérieur : sur un plan, la surface
          annoncée est celle qu'on foule, mesurée entre les faces des murs et
          non entre leurs axes. */
    var droites = [];
    var accroches = 0;

    for (var i = 0; i < depart.length; i++) {
      var a = depart[i];
      var b = depart[(i + 1) % depart.length];

      var bord = _direction(a, b);
      if (!bord) return tel_quel;   // bord nul : contour inexploitable

      var porteur = _murPorteur(a, b, bord, murs, soutiens, reglages);

      if (!porteur) {
        droites.push({ p: a, d: bord.d, mur: false });
        continue;
      }

      var p = [porteur.mur.a[0], porteur.mur.a[1]];
      var d = porteur.axe.d;

      if (reglages.retrait) {
        // De quel côté de l'axe se tient la pièce ?
        var cote = -d[1] * (centre[0] - p[0]) + d[0] * (centre[1] - p[1]);
        var sens = cote >= 0 ? 1 : -1;
        p = [p[0] - d[1] * reglages.retrait * sens,
             p[1] + d[0] * reglages.retrait * sens];
      }

      droites.push({ p: p, d: d, mur: true });
      accroches++;
    }

    /* 2. Les sommets renaissent du croisement des droites voisines. Deux
          droites presque parallèles ne font pas un coin : le sommet
          d'origine reste. Un croisement qui projetterait le sommet à l'autre
          bout de la maison non plus — mieux vaut un coin en place qu'un
          polygone retourné. */
    var refait = [];
    var deplacement = 0;

    for (var k = 0; k < depart.length; k++) {
      var avant = droites[(k - 1 + depart.length) % depart.length];
      var apres = droites[k];
      var sommet = depart[k];

      var croise = (avant.mur || apres.mur)
        ? _croisement(avant.p, avant.d, apres.p, apres.d)
        : null;

      if (croise) {
        var saut = Math.sqrt(Math.pow(croise[0] - sommet[0], 2) +
                             Math.pow(croise[1] - sommet[1], 2));
        if (saut <= reglages.saut) {
          if (saut > deplacement) deplacement = saut;
          refait.push(croise);
          continue;
        }
      }

      refait.push([sommet[0], sommet[1]]);
    }

    var net = _degrouper(refait);
    if (net.length < 3) return tel_quel;

    return {
      contour: net,
      accroches: accroches,
      total: depart.length,
      // Une pièce n'est close que si chacun de ses bords court le long d'un
      // mur : c'est la définition même d'une pièce sur un plan.
      ferme: accroches === depart.length,
      deplacement: deplacement,
      aire: airePolygone(net)
    };
  }

  // ---------------------------------------------------------------------------
  // Partage du plan entre les pièces
  // ---------------------------------------------------------------------------

  /**
   * Réglages du partage, en mètres.
   *
   * Le pas est volontairement grossier : la grille ne sert qu'à établir la
   * forme — combien de côtés, et où sont les décrochés. La précision, elle,
   * vient ensuite de l'accrochage aux droites des murs.
   */
  var CELLULE = {
    pas:            0.05,   // côté d'une cellule de grille
    marge:          0.60,   // vide conservé autour du réseau de murs
    epaisseur:      0.10,   // épaisseur des murs, qui font barrière
    simplification: 0.08,   // tolérance de Douglas-Peucker
    aireMin:        1.0,    // en deçà, ce n'est pas une pièce
    appuiMin:       0.15,   // part minimale de pourtour appuyée sur un mur

    /* Un placard fait 0,8 m² et des WC 1,4 : les seuils taillés pour une
       pièce à vivre les écarteraient tous. Sous ce plafond, une pièce est
       jugée sur des critères proportionnés à sa taille — faute de quoi elle
       retombe sur son rectangle relevé, qui lui déborde sur ses voisines. */
    petite:         3.0,    // m² annoncés en deçà desquels on assouplit
    appuiMinPetite: 0.05,
    aireMinPetite:  0.20
  };

  /* Seul l'état « muré » se lit dans la grille : le partage n'a plus besoin
     de distinguer le libre du déjà-pris, chaque cellule étant attribuée en
     une passe et non par propagation. */
  var MUR = 1;

  /**
   * Rasterise le réseau de murs.
   *
   * Une cellule est murée si son centre tombe dans l'épaisseur du mur : les
   * pièces s'arrêtent donc à la face intérieure, et les surfaces obtenues
   * sont des surfaces habitables.
   */
  function _grilleMurs(murs, reglages, points) {
    var xMin = Infinity, xMax = -Infinity;
    var zMin = Infinity, zMax = -Infinity;

    var etendre = function (p) {
      if (!p) return;
      if (p[0] < xMin) xMin = p[0]; if (p[0] > xMax) xMax = p[0];
      if (p[1] < zMin) zMin = p[1]; if (p[1] > zMax) zMax = p[1];
    };

    murs.forEach(function (mur) {
      if (!mur || !mur.a || !mur.b) return;
      etendre(mur.a);
      etendre(mur.b);
    });

    // Centres de pièce et contour d'enveloppe : la grille doit tous les
    // contenir, sans quoi une pièce excentrée n'aurait pas de place.
    (points || []).forEach(etendre);

    if (!isFinite(xMin)) return null;

    var pas = reglages.pas;
    var x0 = xMin - reglages.marge;
    var z0 = zMin - reglages.marge;

    var nx = Math.ceil((xMax - xMin + reglages.marge * 2) / pas) + 1;
    var nz = Math.ceil((zMax - zMin + reglages.marge * 2) / pas) + 1;

    // Garde-fou : une échelle aberrante ne doit pas réserver un giga-octet.
    if (nx * nz > 4e6) return null;

    var grille = {
      nx: nx, nz: nz, pas: pas, x0: x0, z0: z0,
      cases: new Uint8Array(nx * nz)
    };

    /* La barrière épouse l'emprise réelle du mur : une cellule est murée si
       son centre tombe dans l'épaisseur. Un plancher est posé à trois quarts
       de cellule, faute de quoi un mur plus mince que la grille ne marquerait
       rien et laisserait fuir le remplissage. */
    var demi = Math.max(reglages.epaisseur / 2, pas * 0.75);

    murs.forEach(function (mur) {
      if (!mur || !mur.a || !mur.b) return;
      _tracerMur(grille, mur.a, mur.b, demi);
    });

    return grille;
  }

  /** Mure les cellules dont le centre tombe à moins de `demi` du segment. */
  function _tracerMur(grille, a, b, demi) {
    var pas = grille.pas;

    var iMin = Math.max(0, Math.floor((Math.min(a[0], b[0]) - demi - grille.x0) / pas));
    var iMax = Math.min(grille.nx - 1,
                        Math.ceil((Math.max(a[0], b[0]) + demi - grille.x0) / pas));
    var jMin = Math.max(0, Math.floor((Math.min(a[1], b[1]) - demi - grille.z0) / pas));
    var jMax = Math.min(grille.nz - 1,
                        Math.ceil((Math.max(a[1], b[1]) + demi - grille.z0) / pas));

    var dx = b[0] - a[0], dz = b[1] - a[1];
    var longueur2 = dx * dx + dz * dz;

    for (var j = jMin; j <= jMax; j++) {
      var cz = grille.z0 + (j + 0.5) * pas;

      for (var i = iMin; i <= iMax; i++) {
        var cx = grille.x0 + (i + 0.5) * pas;

        var t = longueur2 < 1e-12
          ? 0
          : ((cx - a[0]) * dx + (cz - a[1]) * dz) / longueur2;
        t = Math.min(1, Math.max(0, t));

        var ex = cx - (a[0] + t * dx);
        var ez = cz - (a[1] + t * dz);

        if (ex * ex + ez * ez <= demi * demi) {
          grille.cases[j * grille.nx + i] = MUR;
        }
      }
    }
  }

  /** Deux segments se croisent-ils franchement ? */
  function _segmentsSeCroisent(p1x, p1z, p2x, p2z, q1x, q1z, q2x, q2z) {
    var d1 = (q2x - q1x) * (p1z - q1z) - (q2z - q1z) * (p1x - q1x);
    var d2 = (q2x - q1x) * (p2z - q1z) - (q2z - q1z) * (p2x - q1x);
    var d3 = (p2x - p1x) * (q1z - p1z) - (p2z - p1z) * (q1x - p1x);
    var d4 = (p2x - p1x) * (q2z - p1z) - (p2z - p1z) * (q2x - p1x);

    /* Croisement strict : un rayon qui effleure le bout d'un mur ne compte
       pas. À 5 cm de résolution, ces cas rasants ne changent rien, et les
       traiter séparément ferait basculer des cellules entières sur un
       arrondi. */
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }

  /** Prépare les murs pour le test de visibilité : bornes précalculées. */
  function _barrieres(murs) {
    var liste = [];

    murs.forEach(function (mur) {
      if (!mur || !mur.a || !mur.b) return;

      liste.push({
        ax: mur.a[0], az: mur.a[1], bx: mur.b[0], bz: mur.b[1],
        xMin: Math.min(mur.a[0], mur.b[0]), xMax: Math.max(mur.a[0], mur.b[0]),
        zMin: Math.min(mur.a[1], mur.b[1]), zMax: Math.max(mur.a[1], mur.b[1])
      });
    });

    return liste;
  }

  /** Un mur coupe-t-il la vue entre deux points ? */
  function _vueBouchee(x1, z1, x2, z2, barrieres) {
    var xMin = x1 < x2 ? x1 : x2, xMax = x1 < x2 ? x2 : x1;
    var zMin = z1 < z2 ? z1 : z2, zMax = z1 < z2 ? z2 : z1;

    for (var b = 0; b < barrieres.length; b++) {
      var mur = barrieres[b];

      // Rejet par les bornes : la plupart des murs sont hors de portée du
      // rayon, et ce test coûte quatre comparaisons.
      if (mur.xMax < xMin || mur.xMin > xMax ||
          mur.zMax < zMin || mur.zMin > zMax) continue;

      if (_segmentsSeCroisent(x1, z1, x2, z2,
                              mur.ax, mur.az, mur.bx, mur.bz)) return true;
    }

    return false;
  }

  /**
   * Partage le plan entre les pièces : à chaque cellule sa pièce.
   *
   * Une cellule revient à la pièce dont le centre est le plus proche — mais
   * seulement si ce centre est en vue. Un mur qui coupe le trajet écarte la
   * pièce, et la cellule se rabat sur la suivante.
   *
   * C'est ce qui permet de se passer de cellules parfaitement closes : un
   * mur n'a plus à refermer un contour, il lui suffit de barrer la vue. Un
   * réseau troué — le cas courant sur un plan relevé automatiquement —
   * partage quand même le plan correctement.
   *
   * Les centres sont essayés du plus proche au plus lointain et le premier
   * en vue l'emporte : dans l'immense majorité des cellules, c'est le
   * premier essayé, et un seul rayon suffit.
   */
  function _partager(grille, graines, barrieres, dedans) {
    var total = grille.nx * grille.nz;
    var appartenance = new Int16Array(total);
    var essaye = new Uint8Array(graines.length);
    var distances = new Float64Array(graines.length);

    for (var c = 0; c < total; c++) appartenance[c] = -1;

    for (var j = 0; j < grille.nz; j++) {
      var cz = grille.z0 + (j + 0.5) * grille.pas;

      for (var i = 0; i < grille.nx; i++) {
        var indice = j * grille.nx + i;

        if (grille.cases[indice] === MUR) continue;
        if (dedans && !dedans[indice]) continue;

        var cx = grille.x0 + (i + 0.5) * grille.pas;

        var g;
        for (g = 0; g < graines.length; g++) {
          essaye[g] = 0;
          var dx = cx - graines[g][0], dz = cz - graines[g][1];
          distances[g] = dx * dx + dz * dz;
        }

        var restants = graines.length;

        while (restants > 0) {
          var meilleur = -1;

          for (g = 0; g < graines.length; g++) {
            if (essaye[g]) continue;
            if (meilleur < 0 || distances[g] < distances[meilleur]) meilleur = g;
          }

          essaye[meilleur] = 1;
          restants--;

          if (!_vueBouchee(cx, cz, graines[meilleur][0], graines[meilleur][1],
                           barrieres)) {
            appartenance[indice] = meilleur;
            break;
          }
        }
      }
    }

    return appartenance;
  }

  /** Cellules situées dans l'enveloppe du bâtiment. */
  function _masqueEnveloppe(grille, enveloppe) {
    if (!enveloppe || enveloppe.length < 3) return null;

    var dedans = new Uint8Array(grille.nx * grille.nz);

    for (var j = 0; j < grille.nz; j++) {
      var cz = grille.z0 + (j + 0.5) * grille.pas;

      for (var i = 0; i < grille.nx; i++) {
        var cx = grille.x0 + (i + 0.5) * grille.pas;
        if (pointDansPolygone([cx, cz], enveloppe)) {
          dedans[j * grille.nx + i] = 1;
        }
      }
    }

    return dedans;
  }

  /**
   * Retranche du partage les emprises réservées.
   *
   * Une trémie d'escalier occupe du sol sans qu'aucun mur ne l'entoure : le
   * partage la donnerait à la pièce voisine, qui se retrouverait à carreler
   * la cage. Ces emprises sont donc murées comme le serait une cloison, et
   * la pièce se creuse d'elle-même autour.
   */
  function _reserver(grille, reserves) {
    if (!reserves || !reserves.length) return;

    reserves.forEach(function (zone) {
      if (!zone || zone.length < 3) return;

      for (var j = 0; j < grille.nz; j++) {
        var cz = grille.z0 + (j + 0.5) * grille.pas;

        for (var i = 0; i < grille.nx; i++) {
          var cx = grille.x0 + (i + 0.5) * grille.pas;
          if (pointDansPolygone([cx, cz], zone)) {
            grille.cases[j * grille.nx + i] = MUR;
          }
        }
      }
    });
  }

  /** Indice de cellule d'un point, ou -1 s'il tombe hors de la grille. */
  function _cellule(grille, point) {
    var i = Math.floor((point[0] - grille.x0) / grille.pas);
    var j = Math.floor((point[1] - grille.z0) / grille.pas);

    if (i < 0 || j < 0 || i >= grille.nx || j >= grille.nz) return -1;
    return j * grille.nx + i;
  }

  /**
   * Cellule libre la plus proche d'un point.
   *
   * Le centre d'une pièce peut tomber dans l'épaisseur d'une cloison quand
   * le rectangle relevé est décalé : on cherche alors autour, en cercles
   * croissants, plutôt que de renoncer.
   */
  function _celluleLibre(grille, point, rayonMax) {
    var depart = _cellule(grille, point);
    if (depart < 0) return -1;
    if (grille.cases[depart] !== MUR) return depart;

    var i0 = depart % grille.nx;
    var j0 = (depart - i0) / grille.nx;

    for (var r = 1; r <= rayonMax; r++) {
      for (var di = -r; di <= r; di++) {
        for (var dj = -r; dj <= r; dj++) {
          // Seulement le pourtour du carré de rayon r.
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;

          var i = i0 + di, j = j0 + dj;
          if (i < 0 || j < 0 || i >= grille.nx || j >= grille.nz) continue;

          var indice = j * grille.nx + i;
          if (grille.cases[indice] !== MUR) return indice;
        }
      }
    }

    return -1;
  }

  /**
   * Contour de la zone remplie, suivi le long des arêtes de la grille.
   *
   * Chaque cellule prise dont le voisin ne l'est pas livre une arête
   * orientée ; enchaînées bout à bout, ces arêtes forment les boucles du
   * contour. La plus grande est le pourtour, les autres sont des trous —
   * un poteau au milieu d'une pièce, par exemple.
   */
  function _contourDeRegion(grille, pris) {
    var sortantes = {};   // coin -> arêtes qui en partent
    var aretes = [];

    for (var j = 0; j < grille.nz; j++) {
      for (var i = 0; i < grille.nx; i++) {
        if (!pris[j * grille.nx + i]) continue;

        var haut  = j > 0                ? pris[(j - 1) * grille.nx + i] : 0;
        var bas   = j < grille.nz - 1    ? pris[(j + 1) * grille.nx + i] : 0;
        var gauche= i > 0                ? pris[j * grille.nx + (i - 1)] : 0;
        var droite= i < grille.nx - 1    ? pris[j * grille.nx + (i + 1)] : 0;

        // Sens horaire dans le repère de la grille : le contour se referme.
        if (!haut)   _ajouterArete(sortantes, aretes, grille, i,     j,     i + 1, j);
        if (!droite) _ajouterArete(sortantes, aretes, grille, i + 1, j,     i + 1, j + 1);
        if (!bas)    _ajouterArete(sortantes, aretes, grille, i + 1, j + 1, i,     j + 1);
        if (!gauche) _ajouterArete(sortantes, aretes, grille, i,     j + 1, i,     j);
      }
    }

    var boucles = [];

    aretes.forEach(function (arete) {
      if (arete.vue) return;

      var boucle = [];
      var courante = arete;

      while (courante && !courante.vue) {
        courante.vue = true;
        boucle.push(courante.de);

        var suite = sortantes[courante.vers];
        courante = null;

        if (suite) {
          for (var k = 0; k < suite.length; k++) {
            if (!suite[k].vue) { courante = suite[k]; break; }
          }
        }
      }

      if (boucle.length >= 4) boucles.push(boucle);
    });

    return boucles.map(function (boucle) {
      return boucle.map(function (coin) {
        var i = coin % (grille.nx + 1);
        var j = (coin - i) / (grille.nx + 1);
        return [grille.x0 + i * grille.pas, grille.z0 + j * grille.pas];
      });
    });
  }

  function _ajouterArete(sortantes, aretes, grille, i1, j1, i2, j2) {
    var largeurCoins = grille.nx + 1;
    var de   = j1 * largeurCoins + i1;
    var vers = j2 * largeurCoins + i2;

    var arete = { de: de, vers: vers, vue: false };
    aretes.push(arete);

    if (!sortantes[de]) sortantes[de] = [];
    sortantes[de].push(arete);
  }

  /**
   * Simplification de Ramer-Douglas-Peucker.
   *
   * Le contour sorti de la grille est un escalier : une marche par cellule.
   * Sans cette passe, une pièce compterait des centaines de côtés au lieu
   * des six ou huit qu'elle a réellement.
   */
  function _douglasPeucker(points, epsilon) {
    if (points.length < 3) return points.slice();

    var garder = new Uint8Array(points.length);
    garder[0] = 1;
    garder[points.length - 1] = 1;

    // Pile plutôt que récursion : un contour brut compte des milliers de
    // points, et la pile d'appels n'est pas extensible.
    var aTraiter = [[0, points.length - 1]];

    while (aTraiter.length) {
      var bornes = aTraiter.pop();
      var debut = bornes[0], fin = bornes[1];
      if (fin <= debut + 1) continue;

      var a = points[debut], b = points[fin];
      var dx = b[0] - a[0], dz = b[1] - a[1];
      var longueur = Math.sqrt(dx * dx + dz * dz);

      var pire = -1, distanceMax = -1;

      for (var i = debut + 1; i < fin; i++) {
        var p = points[i];
        var distance;

        if (longueur < 1e-12) {
          distance = Math.sqrt(Math.pow(p[0] - a[0], 2) + Math.pow(p[1] - a[1], 2));
        } else {
          distance = Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / longueur;
        }

        if (distance > distanceMax) { distanceMax = distance; pire = i; }
      }

      if (distanceMax > epsilon) {
        garder[pire] = 1;
        aTraiter.push([debut, pire]);
        aTraiter.push([pire, fin]);
      }
    }

    var retenus = [];
    for (var k = 0; k < points.length; k++) {
      if (garder[k]) retenus.push(points[k]);
    }
    return retenus;
  }

  /** Fait partir la boucle d'un coin extrême, toujours un vrai sommet. */
  function _demarrerSurUnCoin(boucle) {
    var meilleur = 0;

    for (var i = 1; i < boucle.length; i++) {
      if (boucle[i][0] < boucle[meilleur][0] ||
         (boucle[i][0] === boucle[meilleur][0] &&
          boucle[i][1] < boucle[meilleur][1])) {
        meilleur = i;
      }
    }

    return boucle.slice(meilleur).concat(boucle.slice(0, meilleur));
  }

  /** Aire minimale d'un trou pour valoir la peine d'être creusé, en m². */
  var TROU_MIN_CELLULE = 0.10;

  /** Simplifie une boucle fermée par Douglas-Peucker. */
  function _simplifierBoucle(boucle, epsilon) {
    /* La boucle est refermée sur elle-même avant d'être simplifiée : sans
       ce point de retour, Douglas-Peucker tiendrait le dernier sommet pour
       une extrémité et le conserverait, laissant un sommet parasite au
       milieu du dernier côté. */
    var ferme = _demarrerSurUnCoin(boucle);
    ferme.push([ferme[0][0], ferme[0][1]]);

    var simple = _douglasPeucker(ferme, epsilon);
    simple.pop();

    return _degrouper(simple);
  }

  /**
   * Largeur de la saignée qui relie un trou à son pourtour, en mètres.
   *
   * Cinq millimètres : assez pour que la triangulation par oreilles y trouve
   * de la place — à un millimètre elle échoue et la pièce se retrouve sans
   * sol — assez peu pour ne rien coûter, un centième de mètre carré sur une
   * pièce de trente.
   */
  var SAIGNEE = 0.005;

  /**
   * Coud un trou au pourtour par une saignée.
   *
   * Un contour est une boucle unique — le sol, le carrelage et le tracé sur
   * le plan n'en connaissent pas d'autre forme. Pour qu'une pièce puisse
   * avoir un trou, on relie donc le trou au pourtour par un aller-retour, et
   * la boucle reste unique.
   *
   * L'aller et le retour sont écartés d'un millimètre. Confondus, ils
   * feraient un polygone dégénéré : la triangulation par oreilles n'y trouve
   * aucune oreille valide et rend zéro triangle — la pièce n'aurait tout
   * simplement pas de sol. Un millimètre suffit à lever l'ambiguïté et ne
   * coûte que quelques millimètres carrés de surface.
   */
  function _coudreTrou(pourtour, trou) {
    /* La saignée part du milieu d'une arête du pourtour, jamais d'un de ses
       sommets : ancrée sur un sommet, sa branche de retour recouperait
       l'arête voisine et le polygone cesserait d'être simple — plus aucune
       triangulation n'en sortirait. Ses deux bords sont écartés le long de
       l'arête, donc à plat sur elle : ils ne peuvent croiser personne. */
    var meilleurI = 0, meilleurJ = 0, plusCourt = Infinity;

    for (var i = 0; i < pourtour.length; i++) {
      var a = pourtour[i], b = pourtour[(i + 1) % pourtour.length];

      for (var j = 0; j < trou.length; j++) {
        var mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        var d = Math.pow(mx - trou[j][0], 2) + Math.pow(mz - trou[j][1], 2);
        if (d < plusCourt) { plusCourt = d; meilleurI = i; meilleurJ = j; }
      }
    }

    var a1 = pourtour[meilleurI];
    var a2 = pourtour[(meilleurI + 1) % pourtour.length];

    var ex = a2[0] - a1[0], ez = a2[1] - a1[1];
    var lg = Math.sqrt(ex * ex + ez * ez) || 1;

    // Deux points sur l'arête, de part et d'autre de son milieu.
    var demi = Math.min(SAIGNEE, lg / 4) / 2;
    var mx2 = (a1[0] + a2[0]) / 2, mz2 = (a1[1] + a2[1]) / 2;

    var entree = [mx2 - ex / lg * demi, mz2 - ez / lg * demi];
    var sortie = [mx2 + ex / lg * demi, mz2 + ez / lg * demi];

    // Le trou est parcouru depuis son sommet le plus proche, et refermé sur
    // un point à peine décalé pour ne pas dupliquer un sommet.
    var pivot = trou[meilleurJ];
    var vers = [pivot[0] + (sortie[0] - entree[0]), pivot[1] + (sortie[1] - entree[1])];

    return []
      .concat(pourtour.slice(0, meilleurI + 1))
      .concat([entree])
      .concat(trou.slice(meilleurJ), trou.slice(0, meilleurJ))
      .concat([vers, sortie])
      .concat(pourtour.slice(meilleurI + 1));
  }

  /**
   * Contour d'une région de cellules, simplifié, trous compris.
   *
   * @returns {{contour, trous}|null}
   */
  function _contourSimplifie(grille, masque, epsilon) {
    var boucles = _contourDeRegion(grille, masque);
    if (!boucles.length) return null;

    // Le pourtour est la boucle qui embrasse la plus grande aire.
    var retenue = boucles[0], meilleure = airePolygone(boucles[0]);
    for (var b = 1; b < boucles.length; b++) {
      var aire = airePolygone(boucles[b]);
      if (aire > meilleure) { meilleure = aire; retenue = boucles[b]; }
    }

    var contour = _simplifierBoucle(retenue, epsilon);
    if (contour.length < 3) return null;

    /* Les autres boucles cernent ce que la pièce entoure sans l'occuper :
       une trémie d'escalier, un poteau. Les ignorer ferait carreler le vide.
       Les plus petites sont du bruit de grille. */
    var trous = 0;

    boucles.forEach(function (boucle) {
      if (boucle === retenue) return;
      if (airePolygone(boucle) < TROU_MIN_CELLULE) return;

      var creux = _simplifierBoucle(boucle, epsilon);
      if (creux.length < 3) return;

      contour = _coudreTrou(contour, creux);
      trous++;
    });

    return { contour: contour, trous: trous };
  }

  /**
   * Part du pourtour d'une région qui s'appuie sur un mur.
   *
   * C'est ce qui distingue une pièce d'un partage arbitraire : une pièce
   * réelle est bordée de maçonnerie, une pièce inventée par le seul jeu des
   * distances ne l'est pas. Le rapport se lit comme un indice de confiance.
   */
  function _appuiSurMurs(grille, masque) {
    var total = 0, surMur = 0;

    for (var j = 0; j < grille.nz; j++) {
      for (var i = 0; i < grille.nx; i++) {
        var indice = j * grille.nx + i;
        if (!masque[indice]) continue;

        var cotes = [
          j > 0             ? indice - grille.nx : -1,
          j < grille.nz - 1 ? indice + grille.nx : -1,
          i > 0             ? indice - 1         : -1,
          i < grille.nx - 1 ? indice + 1         : -1
        ];

        for (var c = 0; c < 4; c++) {
          var voisin = cotes[c];
          if (voisin >= 0 && masque[voisin]) continue;

          total++;
          if (voisin >= 0 && grille.cases[voisin] === MUR) surMur++;
        }
      }
    }

    return total ? surMur / total : 0;
  }

  /**
   * Partage le plan entre les pièces et rend le contour de chacune.
   *
   * Une pièce n'est plus définie comme ce que ses murs enferment — sur un
   * plan relevé automatiquement, les murs intérieurs ne se referment
   * pratiquement jamais — mais comme ce qu'elle est seule à voir. Chaque
   * cellule revient à la pièce dont le centre est le plus proche parmi
   * celles qu'aucun mur ne lui cache. Un mur n'a donc plus à fermer un
   * contour : il lui suffit de barrer la vue.
   *
   * Le partage est calculé une fois pour toutes les pièces : c'est une
   * partition, chaque cellule n'appartenant qu'à une seule d'entre elles.
   * Deux rectangles qui se recouvraient donnent désormais deux polygones
   * disjoints, séparés par leur médiatrice là où aucun mur ne tranche.
   *
   * @param {Array} murs     [{ a: [x, z], b: [x, z] }] en mètres.
   * @param {Array} graines  [[x, z], …] un centre par pièce.
   * @param {Object} [options] { pas, marge, epaisseur, simplification,
   *                             aireMin, appuiMin, enveloppe,
   *                             aires:    surfaces annoncées, une par graine,
   *                             reserves: emprises exclues du partage }
   * @returns {Array<{contour, ferme, motif, aire, appuiMurs}>} un par graine.
   */
  function cellulesPieces(murs, graines, options) {
    var o = options || {};
    var reglages = {
      pas:            o.pas            === undefined ? CELLULE.pas            : o.pas,
      marge:          o.marge          === undefined ? CELLULE.marge          : o.marge,
      epaisseur:      o.epaisseur      === undefined ? CELLULE.epaisseur      : o.epaisseur,
      simplification: o.simplification === undefined ? CELLULE.simplification : o.simplification,
      aireMin:        o.aireMin        === undefined ? CELLULE.aireMin        : o.aireMin,
      appuiMin:       o.appuiMin       === undefined ? CELLULE.appuiMin       : o.appuiMin,

      petite:         o.petite         === undefined ? CELLULE.petite         : o.petite,
      appuiMinPetite: o.appuiMinPetite === undefined ? CELLULE.appuiMinPetite : o.appuiMinPetite,
      aireMinPetite:  o.aireMinPetite  === undefined ? CELLULE.aireMinPetite  : o.aireMinPetite
    };

    var echec = function (motif) {
      return { contour: [], ferme: false, motif: motif, aire: 0,
               appuiMurs: 0, trous: 0 };
    };

    if (!graines || !graines.length) return [];

    var tousEchecs = function (motif) {
      return graines.map(function () { return echec(motif); });
    };

    if (!murs || !murs.length) return tousEchecs("aucun mur");

    var reperes = graines.filter(Boolean).concat(o.enveloppe || []);
    var grille = _grilleMurs(murs, reglages, reperes);
    if (!grille) return tousEchecs("réseau de murs inexploitable");

    // Trémies d'escalier et autres emprises à ne donner à personne.
    _reserver(grille, o.reserves);

    /* Les centres tombés dans l'épaisseur d'une cloison sont ramenés au vide
       le plus proche : un rectangle décalé ne doit pas priver sa pièce de
       tout point de vue. */
    var vues = graines.map(function (graine) {
      if (!graine || graine.length < 2) return null;

      var libre = _celluleLibre(grille, graine, Math.ceil(0.5 / reglages.pas));
      if (libre < 0) return null;

      var i = libre % grille.nx;
      var j = (libre - i) / grille.nx;

      return [grille.x0 + (i + 0.5) * grille.pas,
              grille.z0 + (j + 0.5) * grille.pas];
    });

    var valides = [];
    vues.forEach(function (v, rang) { if (v) valides.push(rang); });
    if (!valides.length) return tousEchecs("aucun centre exploitable");

    var dedans = _masqueEnveloppe(grille, o.enveloppe);

    var partage = _partager(
      grille,
      valides.map(function (rang) { return vues[rang]; }),
      _barrieres(murs),
      dedans
    );

    // Un masque par pièce, découpé dans la partition.
    var total = grille.nx * grille.nz;
    var masques = valides.map(function () { return new Uint8Array(total); });
    var tailles = valides.map(function () { return 0; });

    for (var c = 0; c < total; c++) {
      var proprietaire = partage[c];
      if (proprietaire < 0) continue;
      masques[proprietaire][c] = 1;
      tailles[proprietaire]++;
    }

    var resultats = graines.map(function () {
      return echec("centre hors du réseau de murs");
    });

    valides.forEach(function (rang, place) {
      /* Un centre posé hors du bâtiment n'a rien à partager. Le dire ainsi
         plutôt que « part trop petite » : ce n'est pas la même erreur, et ce
         n'est pas le même remède. */
      if (dedans) {
        var sienne = _cellule(grille, vues[rang]);
        if (sienne < 0 || !dedans[sienne]) {
          resultats[rang] = echec("centre hors du bâtiment");
          return;
        }
      }

      /* Les seuils se règlent sur la taille annoncée : ceux d'une pièce à
         vivre écarteraient tout placard, et un placard écarté retombe sur
         son rectangle, qui déborde sur le séjour. */
      var annoncee = (o.aires && o.aires[rang] > 0) ? o.aires[rang] : null;
      var petite = annoncee !== null && annoncee < reglages.petite;

      var aireMin = petite
        ? Math.min(reglages.aireMinPetite, annoncee * 0.4)
        : reglages.aireMin;
      var appuiMin = petite ? reglages.appuiMinPetite : reglages.appuiMin;

      var aireGrille = tailles[place] * reglages.pas * reglages.pas;
      if (aireGrille < aireMin) {
        resultats[rang] = echec("part trop petite");
        return;
      }

      var trace = _contourSimplifie(grille, masques[place],
                                    reglages.simplification);
      if (!trace) { resultats[rang] = echec("contour introuvable"); return; }

      var contour = trace.contour;
      var appui = _appuiSurMurs(grille, masques[place]);

      /* Une part que presque aucun mur ne borde n'est pas une pièce : c'est
         un morceau de plan attribué au plus proche, faute de mieux. */
      if (appui < appuiMin) {
        var refus = echec("pourtour sans murs (" +
          Math.round(appui * 100) + " % appuyé)");
        refus.appuiMurs = appui;
        resultats[rang] = refus;
        return;
      }

      resultats[rang] = {
        contour: contour,
        ferme: true,
        motif: null,
        aire: airePolygone(contour),
        appuiMurs: appui,
        // Nombre de creux cousus : un contour qui en porte ne supporte plus
        // qu'on lui reprenne ses droites une à une.
        trous: trace.trous
      };
    });

    return resultats;
  }

  /**
   * Contour d'une pièce, dans le partage du plan entre toutes.
   *
   * Enveloppe de `cellulesPieces` pour une pièce isolée. Le partage étant
   * global, `options.graines` et `options.rang` la situent parmi les autres ;
   * sans eux, la pièce est seule et prend tout ce qu'elle voit.
   *
   * @param {Array} murs    [{ a: [x, z], b: [x, z] }] en mètres.
   * @param {Array} graine  [x, z] — le centre de la pièce.
   * @param {Object} [options] voir cellulesPieces, plus { graines, rang }
   * @returns {{contour, ferme, motif, aire, appuiMurs}}
   */
  function cellulePiece(murs, graine, options) {
    var o = options || {};

    if (!graine || graine.length < 2) {
      return { contour: [], ferme: false, motif: "pièce sans centre",
               aire: 0, appuiMurs: 0 };
    }

    var graines = o.graines && o.graines.length ? o.graines : [graine];
    var rang = o.graines && o.graines.length ? (o.rang || 0) : 0;

    var toutes = cellulesPieces(murs, graines, o);

    return toutes[rang] || { contour: [], ferme: false,
                             motif: "pièce inconnue", aire: 0, appuiMurs: 0 };
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  global.Plan = {
    ACCROCHE:          ACCROCHE,
    CELLULE:           CELLULE,

    aireSignee:        aireSignee,
    airePolygone:      airePolygone,
    orthoSnap:         orthoSnap,
    pointDansPolygone: pointDansPolygone,
    triangulation:     triangulation,

    trianglesDeContour:  trianglesDeContour,
    couperSurTriangle:   couperSurTriangle,
    decouperSurContour:  decouperSurContour,
    compterSurContour:   compterSurContour,
    retirerRectangle:    retirerRectangle,
    retirerRectangles:   retirerRectangles,

    sommetsVersMonde:  sommetsVersMonde,
    boiteEnglobante:   boiteEnglobante,
    centrePolygone:    _centroide,
    accrocherAuxMurs:  accrocherAuxMurs,
    cellulePiece:      cellulePiece,
    cellulesPieces:    cellulesPieces
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.Plan;
  }

})(typeof window !== "undefined" ? window : globalThis);
