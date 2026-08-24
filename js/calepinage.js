/**
 * Catalogue 3D — calepinage
 *
 * Géométrie pure du calepinage : à partir des dimensions du sol, du format de
 * carreau, de la largeur de joint et du motif, produit la liste des carreaux
 * posés (découpés au bord du sol) et le métré associé.
 *
 * Aucune dépendance à Babylon.js : le module est testable seul sous Node.
 *
 * Repère : plan (x, z) en mètres, sol centré sur l'origine.
 *   x ∈ [-L/2, +L/2]   z ∈ [-l/2, +l/2]
 */
(function (global) {
  "use strict";

  // Garde-fou : au-delà, la scène devient ingérable pour le navigateur.
  var MAX_CARREAUX = 30000;

  // Un carreau dont l'aire résiduelle après découpe est inférieure à 1 mm²
  // est un artefact de calcul flottant, pas une coupe réelle.
  var AIRE_NEGLIGEABLE = 1e-6;

  var MOTIFS = {
    "droite": "Pose droite",
    "quinconce-50": "Quinconce 50 %",
    "quinconce-tiers": "Quinconce 2/3 - 1/3",
    "chevron": "Chevron (point de Hongrie)"
  };

  var RACINE2 = Math.SQRT2;

  // --- Géométrie de base ---------------------------------------------------

  /**
   * Mélange deux indices de cellule en un entier bien réparti.
   *
   * Volontairement déterministe : la rotation d'un carreau ne doit pas changer
   * à chaque reconstruction de la scène, sinon le sol se remélangerait au
   * moindre réglage. Elle est ancrée sur la position du carreau dans la trame.
   */
  function melanger(a, b, graine) {
    var h = (a * 73856093) ^ (b * 19349663) ^ ((graine || 0) * 83492791);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  /** Aire algébrique d'un polygone (formule du lacet). Points [x, z]. */
  function aire(polygone) {
    var somme = 0;
    for (var i = 0, n = polygone.length; i < n; i++) {
      var a = polygone[i], b = polygone[(i + 1) % n];
      somme += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(somme) / 2;
  }

  /**
   * Sutherland–Hodgman sur un demi-plan aligné sur un axe.
   * axe : 0 pour x, 1 pour z. garderInferieur : conserve c <= limite.
   */
  function couperDemiPlan(polygone, axe, limite, garderInferieur) {
    var sortie = [];
    var n = polygone.length;

    for (var i = 0; i < n; i++) {
      var a = polygone[i];
      var b = polygone[(i + 1) % n];

      // Distance signée : positive du côté conservé.
      var da = garderInferieur ? (limite - a[axe]) : (a[axe] - limite);
      var db = garderInferieur ? (limite - b[axe]) : (b[axe] - limite);

      var aDedans = da >= 0;
      var bDedans = db >= 0;

      if (aDedans) sortie.push(a);

      if (aDedans !== bDedans) {
        var t = da / (da - db);
        sortie.push([
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t
        ]);
      }
    }

    return sortie;
  }

  /** Découpe un polygone convexe sur l'emprise rectangulaire du sol. */
  function couperSurSol(polygone, demiL, demil) {
    var p = couperDemiPlan(polygone, 0, demiL, true);
    if (p.length < 3) return null;
    p = couperDemiPlan(p, 0, -demiL, false);
    if (p.length < 3) return null;
    p = couperDemiPlan(p, 1, demil, true);
    if (p.length < 3) return null;
    p = couperDemiPlan(p, 1, -demil, false);
    return p.length >= 3 ? p : null;
  }

  // --- Génération des carreaux --------------------------------------------

  /**
   * Motifs orthogonaux : pose droite et quinconces.
   * Les rangées courent selon X et se décalent selon Z ; le décalage d'une
   * rangée à l'autre porte sur X, exprimé en fraction du pas.
   */
  function genererOrthogonal(o, emettre) {
    var pasX = o.largeurCarreau + o.joint;
    var pasZ = o.longueurCarreau + o.joint;

    var fraction;
    if (o.motif === "quinconce-50") fraction = 1 / 2;
    else if (o.motif === "quinconce-tiers") fraction = 1 / 3;
    else fraction = 0;

    // Période du motif : nombre de rangées avant répétition du décalage.
    var periode = fraction === 0 ? 1 : Math.round(1 / fraction);

    var z0 = -o.demil;
    var rangee = 0;

    while (z0 < o.demil) {
      var decalage = fraction === 0 ? 0 : (rangee % periode) * pasX * fraction;

      // On démarre une cellule avant le bord pour couvrir la coupe de gauche.
      var x0 = -o.demiL + decalage - pasX;
      var colonne = 0;

      while (x0 < o.demiL) {
        emettre(
          [
            [x0, z0],
            [x0 + o.largeurCarreau, z0],
            [x0 + o.largeurCarreau, z0 + o.longueurCarreau],
            [x0, z0 + o.longueurCarreau]
          ],
          [x0, z0],                        // origine du repère local
          [o.largeurCarreau, 0],           // vecteur d'arête 1
          [0, o.longueurCarreau],          // vecteur d'arête 2
          colonne, rangee                  // position dans la trame
        );
        x0 += pasX;
        colonne++;
      }

      z0 += pasZ;
      rangee++;
    }
  }

  /**
   * Chevron (point de Hongrie) : parallélogrammes à ±45°, coupes d'about
   * verticales. Les carreaux se rangent en bandes verticales alternées ; deux
   * bandes voisines se rejoignent sur une couture verticale et forment le "Λ".
   *
   *   longueurCarreau  = longueur de la grande arête (à 45°)
   *   largeurCarreau   = largeur perpendiculaire du carreau
   */
  function genererChevron(o, emettre) {
    // Emprise horizontale d'un carreau, et longueur de son arête verticale.
    var empriseX = o.longueurCarreau * RACINE2 / 2;
    var areteZ = o.largeurCarreau * RACINE2;

    // Un décalage vertical de joint*√2 entre deux carreaux d'une même bande
    // produit un joint de largeur `joint` mesuré perpendiculairement.
    var pasX = empriseX + o.joint;
    var pasZ = areteZ + o.joint * RACINE2;

    var kMin = Math.floor(-o.demiL / pasX) - 1;
    var kMax = Math.ceil(o.demiL / pasX) + 1;

    for (var k = kMin; k <= kMax; k++) {
      var monte = (((k % 2) + 2) % 2) === 0; // bande "/" ou "\"
      var xk = k * pasX;

      // Décalage vertical de la bande : aligne les aboutements sur la couture.
      var phi = monte ? 0 : empriseX;

      var mMin = Math.floor((-o.demil - phi - areteZ - empriseX) / pasZ);
      var mMax = Math.ceil((o.demil - phi + empriseX) / pasZ);

      for (var m = mMin; m <= mMax; m++) {
        var zb = phi + m * pasZ;

        var p0 = [xk, zb];
        var p1 = [xk, zb + areteZ];
        var p2, p3;

        if (monte) {
          p2 = [xk + empriseX, zb + areteZ + empriseX];
          p3 = [xk + empriseX, zb + empriseX];
        } else {
          p2 = [xk + empriseX, zb + areteZ - empriseX];
          p3 = [xk + empriseX, zb - empriseX];
        }

        emettre(
          [p0, p1, p2, p3],
          p0,
          [p1[0] - p0[0], p1[1] - p0[1]],
          [p3[0] - p0[0], p3[1] - p0[1]],
          k, m
        );
      }
    }
  }

  /**
   * Pose un opus : un module multi-formats, répété sur tout le sol.
   *
   * ─── Le joint, et pourquoi il se prend en dedans ───────────────────────
   *
   * Le module se répète à son pas exact — 120 cm ne devient pas 120 + joint.
   * Chaque tuile est rentrée d'un demi-joint sur ses quatre côtés : entre
   * deux tuiles voisines les deux demis font un joint plein, et au raccord de
   * deux modules aussi. Un pas augmenté du joint aurait doublé celui-là seul,
   * et le raccord se serait vu comme une couture.
   *
   * ─── Les UV, rapportées au format de référence ─────────────────────────
   *
   * Les vecteurs d'arête ne mesurent pas la tuile mais le format de
   * référence. `uv` résolvant p − origine = u·arête1 + v·arête2, une tuile de
   * 20 cm sur une référence de 40 obtient donc u ∈ [0 ; 0,5] : elle montre la
   * moitié de la texture, à la même échelle que ses voisines. C'est tout
   * l'objet d'un opus — une seule pierre, débitée en plusieurs formats.
   *
   * ─── Le tampon, tiré par tuile ─────────────────────────────────────────
   *
   * L'indice de colonne mêle le rang du module et celui de la tuile en son
   * sein. Deux tuiles d'un même module tombent donc sur des cases
   * différentes, et tirent leur dessin séparément — sans quoi le module
   * entier n'en porterait qu'un, et l'opus se répéterait à l'identique.
   */
  function genererOpus(o, emettre) {
    var schema = o.schema;

    var moduleL = schema.module.l / 100;
    var moduleH = schema.module.h / 100;
    if (!(moduleL > 0) || !(moduleH > 0)) return;

    var refL = schema.reference.largeur / 100;
    var refH = schema.reference.hauteur / 100;
    var demiJoint = o.joint / 2;

    // Un module de marge de chaque côté : les coupes de bord sont couvertes.
    var colonnes = Math.ceil(2 * o.demiL / moduleL) + 2;
    var rangees = Math.ceil(2 * o.demil / moduleH) + 2;
    var parModule = schema.tuiles.length;

    /* Le format nominal de chaque tuile, calculé une fois : il sert des
       milliers de fois, et deux tuiles de même taille doivent tomber sur le
       même libellé pour se cumuler au métré.
     *
     * Toujours le petit côté d'abord — c'est ainsi que le format se vend, et
     * surtout un 20 × 40 posé en travers reste un 20 × 40 dans le carton. Les
     * distinguer scinderait la commande en deux lots d'une même référence,
     * qu'aucun fournisseur ne saurait honorer séparément. */
    var libelles = schema.tuiles.map(function (t) {
      return Math.min(t.largeur, t.hauteur) + "×" + Math.max(t.largeur, t.hauteur);
    });

    for (var r = 0; r < rangees; r++) {
      var baseZ = -o.demil - moduleH + r * moduleH;

      for (var c = 0; c < colonnes; c++) {
        var baseX = -o.demiL - moduleL + c * moduleL;

        for (var i = 0; i < parModule; i++) {
          var t = schema.tuiles[i];

          var x0 = baseX + t.x / 100 + demiJoint;
          var z0 = baseZ + t.y / 100 + demiJoint;
          var x1 = baseX + (t.x + t.largeur) / 100 - demiJoint;
          var z1 = baseZ + (t.y + t.hauteur) / 100 - demiJoint;

          // Un joint plus large que la tuile ne laisserait rien à poser.
          if (!(x1 > x0) || !(z1 > z0)) continue;

          emettre(
            [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
            [x0, z0],
            [refL, 0],
            [0, refH],
            c * parModule + i,
            r,
            /* L'aire nominale est celle de la tuile joint déduit — la même
               que celle qu'elle aura si rien ne la coupe. La comparer à
               `t.largeur × t.hauteur` ferait passer toute tuile pour coupée. */
            { aire: (x1 - x0) * (z1 - z0), libelle: libelles[i] }
          );
        }
      }
    }
  }

  // --- API -----------------------------------------------------------------

  /**
   * Calcule le calepinage complet.
   *
   * options :
   *   longueur, largeur           dimensions du sol (m)
   *   largeurCarreau, longueurCarreau  format du carreau (m)
   *   joint                       largeur de joint (m)
   *   motif                       clé de MOTIFS
   *   chute                       pourcentage de casse/chute (défaut 0)
   *   schema                      module multi-formats d'OpusSchemas, ou rien
   *
   * Retourne { carreaux, entiers, coupes, total, totalAvecChute,
   *            surfaceSol, surfacePosee, aireCarreau, motif,
   *            formats, schemaLibelle }
   * ou { erreur } si le calepinage dépasse la limite de carreaux.
   *
   * `formats` ventile le décompte par format de tuile ; il vaut null hors
   * opus, la pose n'ayant alors qu'un seul format.
   */
  function calculer(options) {
    var o = {
      demiL: options.longueur / 2,
      demil: options.largeur / 2,
      largeurCarreau: options.largeurCarreau,
      longueurCarreau: options.longueurCarreau,
      joint: options.joint || 0,
      motif: MOTIFS[options.motif] ? options.motif : "droite",
      rotationAleatoire: options.rotationAleatoire === true,
      // Nombre de dessins disponibles pour ce carreau. Au-delà de 1, chacun
      // reçoit le sien : une pierre n'est jamais deux fois la même.
      nombreTampons: Math.max(1, Math.floor(options.nombreTampons || 1)),

      /* Schéma de pose multi-formats, ou rien. Présent, il remplace la trame
         : ce n'est plus un carreau qu'on répète mais un module entier. */
      schema: options.schema || null
    };

    /* Un opus ne tourne pas. Les quarts de tour de `uv` pivotent autour de
       (0,5 ; 0,5), ce qui suppose des UV bornées à l'unité — or ici elles
       sont rapportées au format de référence, et chaque tuile n'en occupe
       qu'une fraction. Faire tourner cela enverrait la texture chercher le
       dessin d'à côté. */
    if (o.schema) o.rotationAleatoire = false;

    // Un quart de tour échange les deux côtés du carreau : sur un format non
    // carré, la texture s'en trouverait étirée. On s'y limite donc au
    // demi-tour, qui préserve les proportions. C'est aussi ce que fait un
    // carreleur : seuls les carreaux carrés se posent dans les quatre sens.
    var carre = Math.abs(options.largeurCarreau - options.longueurCarreau) < 1e-9;
    var quartsPossibles = carre ? [0, 1, 2, 3] : [0, 2];

    if (!(o.largeurCarreau > 0) || !(o.longueurCarreau > 0)) {
      return { erreur: "Le format de carreau doit être strictement positif." };
    }

    /* L'aire d'un carreau, qui sert à estimer la densité et à distinguer un
       entier d'un coupé. Un opus n'en a pas une seule : on prend celle de sa
       tuile moyenne, et chaque tuile emporte ensuite la sienne. */
    var aireCarreau = o.schema
      ? (o.schema.module.l * o.schema.module.h / 1e4) / o.schema.tuiles.length
      : o.largeurCarreau * o.longueurCarreau;

    var surfaceSol = options.longueur * options.largeur;

    // Estimation préalable : évite de construire 10 millions de polygones
    // avant de s'apercevoir que c'est irréaliste.
    var estimation = Math.ceil(surfaceSol / aireCarreau) + 64;
    if (estimation > MAX_CARREAUX) {
      return {
        erreur: "Calepinage trop dense (~" + estimation.toLocaleString("fr-FR") +
          " carreaux). Réduis le sol ou agrandis le format."
      };
    }

    var carreaux = [];
    var entiers = 0;
    var coupes = 0;
    var surfacePosee = 0;
    var debordement = false;

    /* Décompte par format, pour l'opus seul. Une trame n'a qu'un format et
       n'a rien à ventiler ; un opus en pose quatre, et un métré qui les
       cumulerait ne dirait pas ce qu'il faut commander — on ne commande pas
       cent « carreaux » quand ce sont trente 20 × 20 et vingt 40 × 60. */
    var parFormat = {};
    var ordreFormats = [];

    function compter(nominal, entier) {
      if (!nominal || !nominal.libelle) return;

      var groupe = parFormat[nominal.libelle];
      if (!groupe) {
        groupe = parFormat[nominal.libelle] = {
          format: nominal.libelle,
          aire: nominal.aire,
          entiers: 0,
          coupes: 0,
          total: 0
        };
        ordreFormats.push(groupe);
      }

      if (entier) groupe.entiers++;
      else groupe.coupes++;
      groupe.total++;
    }

    function emettre(quad, origine, arete1, arete2, colonne, rangee, nominal) {
      if (debordement) return;
      if (carreaux.length >= MAX_CARREAUX) {
        debordement = true;
        return;
      }

      var decoupe = couperSurSol(quad, o.demiL, o.demil);
      if (!decoupe) return;

      var a = aire(decoupe);
      if (a < AIRE_NEGLIGEABLE) return;

      /* Sur une trame, toutes les tuiles ont la même aire ; sur un opus,
         chacune la sienne. Sans cela, une 20 × 20 entière passerait pour une
         40 × 60 coupée aux deux tiers. */
      var nominale = nominal && nominal.aire > 0 ? nominal.aire : aireCarreau;

      // Tolérance relative : une coupe qui ne retire qu'un millième du carreau
      // reste un carreau entier du point de vue du métré.
      var entier = a >= nominale * 0.999;

      if (entier) entiers++;
      else coupes++;

      compter(nominal, entier);
      surfacePosee += a;

      carreaux.push({
        contour: decoupe,
        origine: origine,
        arete1: arete1,
        arete2: arete2,
        entier: entier,
        cellule: [colonne, rangee],
        // Nombre de quarts de tour appliqués à la texture (0 à 3).
        rotation: o.rotationAleatoire
          ? quartsPossibles[melanger(colonne, rangee) % quartsPossibles.length]
          : 0,
        /* Dessin retenu pour ce carreau. Le grain de sel diffère de celui de
           la rotation, sans quoi les deux tirages seraient corrélés et l'on
           verrait revenir toujours le même dessin dans la même orientation. */
        tampon: o.nombreTampons > 1
          ? melanger(colonne, rangee, 6151) % o.nombreTampons
          : 0
      });
    }

    if (o.schema) genererOpus(o, emettre);
    else if (o.motif === "chevron") genererChevron(o, emettre);
    else genererOrthogonal(o, emettre);

    if (debordement) {
      return {
        erreur: "Calepinage trop dense (plus de " +
          MAX_CARREAUX.toLocaleString("fr-FR") +
          " carreaux). Réduis le sol ou agrandis le format."
      };
    }

    // Chaque carreau coupé consomme un carreau entier à l'achat.
    var total = entiers + coupes;
    var chute = options.chute > 0 ? options.chute : 0;

    return {
      carreaux: carreaux,
      entiers: entiers,
      coupes: coupes,
      total: total,
      totalAvecChute: Math.ceil(total * (1 + chute / 100)),
      chute: chute,
      surfaceSol: surfaceSol,
      surfacePosee: surfacePosee,
      aireCarreau: aireCarreau,
      motif: o.motif,
      motifLibelle: MOTIFS[o.motif],

      /* Ventilation par format, du plus grand au plus petit — ou null quand
         la pose n'a qu'un format, auquel cas celui de la surface suffit. */
      formats: o.schema
        ? ordreFormats.slice().sort(function (a, b) { return b.aire - a.aire; })
        : null,
      schemaLibelle: o.schema ? (o.schema.nom || "Opus") : null
    };
  }

  /**
   * Repères des quatre murs d'une pièce rectangulaire, vus de l'intérieur.
   *
   * Coordonnées en tableaux [x, y, z] : le module reste indépendant de Babylon.
   * La pièce est centrée sur l'origine, le sol en y = 0.
   *
   * `axeU` court horizontalement le long du mur, `normale` pointe vers
   * l'intérieur. Ils vérifient axeU × (0,1,0) = normale, ce qui donne une
   * orientation cohérente en tournant autour de la pièce.
   */
  function murs(longueur, largeur, hauteur) {
    var demiL = longueur / 2;
    var demil = largeur / 2;
    var miHauteur = hauteur / 2;

    return [
      { nom: "nord", centre: [0, miHauteur, -demil], axeU: [1, 0, 0], normale: [0, 0, 1], largeur: longueur },
      { nom: "sud", centre: [0, miHauteur, demil], axeU: [-1, 0, 0], normale: [0, 0, -1], largeur: longueur },
      { nom: "ouest", centre: [-demiL, miHauteur, 0], axeU: [0, 0, -1], normale: [1, 0, 0], largeur: largeur },
      { nom: "est", centre: [demiL, miHauteur, 0], axeU: [0, 0, 1], normale: [-1, 0, 0], largeur: largeur }
    ];
  }

  /**
   * Place un point (u, v) du plan de calepinage d'un mur dans l'espace.
   * `u` court le long du mur, `v` monte. `decalage` écarte le point vers
   * l'intérieur de la pièce, pour poser les carreaux devant le fond de joint.
   */
  function projeterSurMur(mur, u, v, decalage) {
    var d = decalage || 0;
    return [
      mur.centre[0] + u * mur.axeU[0] + mur.normale[0] * d,
      mur.centre[1] + v,
      mur.centre[2] + u * mur.axeU[2] + mur.normale[2] * d
    ];
  }

  /**
   * Coordonnées UV d'un point dans le repère local du carreau.
   * Résout p - origine = u·arete1 + v·arete2 (base affine du parallélogramme),
   * puis applique la rotation du carreau : quarts de tour autour de (0,5 ; 0,5).
   */
  function uv(carreau, point) {
    var e1 = carreau.arete1, e2 = carreau.arete2;
    var det = e1[0] * e2[1] - e1[1] * e2[0];
    if (Math.abs(det) < 1e-12) return [0, 0];

    var dx = point[0] - carreau.origine[0];
    var dz = point[1] - carreau.origine[1];

    var u = (dx * e2[1] - dz * e2[0]) / det;
    var v = (e1[0] * dz - e1[1] * dx) / det;

    switch (carreau.rotation) {
      case 1: return [1 - v, u];
      case 2: return [1 - u, 1 - v];
      case 3: return [v, 1 - u];
      default: return [u, v];
    }
  }

  var Calepinage = {
    MOTIFS: MOTIFS,
    MAX_CARREAUX: MAX_CARREAUX,
    calculer: calculer,
    uv: uv,
    aire: aire,
    murs: murs,
    projeterSurMur: projeterSurMur
  };

  global.Calepinage = Calepinage;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Calepinage;
  }
})(typeof window !== "undefined" ? window : globalThis);
