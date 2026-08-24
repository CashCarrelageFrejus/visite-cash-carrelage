/**
 * Catalogue 3D — visite immersive
 *
 * Bascule la scène en vue première personne : on marche dans la maison, on
 * passe les portes, on se cogne aux murs.
 *
 * Parti pris d'interaction : le regard ne pivote que pendant qu'un bouton de
 * la souris est maintenu, et le clavier est alors coupé. On regarde, ou on
 * marche, jamais les deux. Pas de verrouillage du pointeur : la souris ne
 * disparaît jamais, on quitte sans surprise.
 *
 * Module IIFE. Le choix du point de départ est une fonction pure, testable
 * sous Node ; le reste pilote Babylon.
 */
(function (global) {
  "use strict";

  var HAUTEUR_OEIL = 1.65;   // m
  var RAYON = 0.35;          // m, demi-largeur du corps

  /* Le corps s'étend de 0,10 m à 2,00 m : il passe sous un linteau à 2,10 m
     tout en butant sur un canapé de 0,80 m. L'ellipsoïde étant centré sur la
     caméra, il faut le décaler vers le bas — c'est le piège classique. */
  var DEMI_CORPS = 0.95;
  var DECALAGE_CORPS = (0.10 + 2.00) / 2 - HAUTEUR_OEIL;  // −0,60 m

  var VITESSE_MS = 1.4;
  var FACTEUR_COURSE = 2.4;

  /* Babylon avance de speed × racine(dt / (images/s × 100)) par image, soit
     environ 3,16 × speed mètres par seconde à 60 images/s. */
  var CONVERSION = 3.16;

  /* ZQSD, et les flèches pour ceux qui préfèrent. A et E doublent le pas de
     côté : ce sont les touches qui encadrent le Z sur un clavier français,
     et beaucoup les cherchent là.

     Ces quatre listes vont à `keysLeft` et `keysRight` de la caméra, qui
     translatent sans tourner — un pas de côté, précisément. Rien à écrire
     image après image : la caméra n'existe que pendant la visite, et A comme
     E ne font donc rien en vue orbitale. */
  var TOUCHES = {
    avant:   [90, 38],           // Z, ↑
    arriere: [83, 40],           // S, ↓
    gauche:  [81, 37, 65],       // Q, ←, A
    droite:  [68, 39, 69]        // D, →, E
  };

  var etat = null;

  // ---------------------------------------------------------------------------
  // Choix du point de départ — logique pure
  // ---------------------------------------------------------------------------

  function _aire(contour) {
    var a = 0, n = contour.length;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      a += contour[i][0] * contour[j][1] - contour[j][0] * contour[i][1];
    }
    return Math.abs(a / 2);
  }

  function _dedans(x, z, contour) {
    var dedans = false, n = contour.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = contour[i][0], zi = contour[i][1];
      var xj = contour[j][0], zj = contour[j][1];
      if (((zi > z) !== (zj > z)) &&
          (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
        dedans = !dedans;
      }
    }
    return dedans;
  }

  /** Distance d'un point au bord du polygone. */
  function _distanceAuBord(x, z, contour) {
    var mini = Infinity;

    for (var i = 0; i < contour.length; i++) {
      var a = contour[i], b = contour[(i + 1) % contour.length];
      var dx = b[0] - a[0], dz = b[1] - a[1];
      var carre = dx * dx + dz * dz;

      var t = carre > 0
        ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / carre))
        : 0;

      var px = a[0] + t * dx, pz = a[1] + t * dz;
      var d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
      if (d < mini) mini = d;
    }

    return mini;
  }

  /**
   * Point le plus dégagé d'une pièce.
   *
   * Le centre de la boîte englobante tomberait hors d'une pièce en L. On
   * échantillonne donc l'intérieur et on retient le point le plus éloigné
   * des murs : c'est là qu'on a le plus de recul pour commencer la visite.
   *
   * @returns {[number, number]|null} [x, z] en mètres.
   */
  function centreDegage(contour, resolution) {
    if (!contour || contour.length < 3) return null;

    var pas = resolution || 24;

    var xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    contour.forEach(function (p) {
      if (p[0] < xMin) xMin = p[0];
      if (p[0] > xMax) xMax = p[0];
      if (p[1] < zMin) zMin = p[1];
      if (p[1] > zMax) zMax = p[1];
    });

    var centreX = (xMin + xMax) / 2, centreZ = (zMin + zMax) / 2;
    var meilleur = null, meilleureDistance = -1, meilleurEcart = Infinity;

    for (var i = 0; i < pas; i++) {
      for (var j = 0; j < pas; j++) {
        var x = xMin + (xMax - xMin) * (i + 0.5) / pas;
        var z = zMin + (zMax - zMin) * (j + 0.5) / pas;
        if (!_dedans(x, z, contour)) continue;

        var d = _distanceAuBord(x, z, contour);
        var ecart = Math.sqrt((x - centreX) * (x - centreX) +
                              (z - centreZ) * (z - centreZ));

        /* Dans une pièce allongée, le point le plus éloigné des murs est
           tout un segment, pas un point : à distance égale, on prend le
           plus proche du centre, sinon on démarrerait collé à un bout. */
        var mieux = d > meilleureDistance + 1e-6 ||
                    (d > meilleureDistance - 1e-6 && ecart < meilleurEcart);

        if (mieux) {
          if (d > meilleureDistance) meilleureDistance = d;
          meilleurEcart = ecart;
          meilleur = [x, z];
        }
      }
    }

    return meilleur;
  }

  /**
   * Point de départ conseillé : le centre dégagé de la plus grande pièce.
   *
   * @param {Object} maison  { pieces: [{ contour }] }
   * @returns {[number, number]|null}
   */
  function departConseille(maison) {
    if (!maison || !maison.pieces || !maison.pieces.length) return null;

    var plusGrande = null, meilleureAire = -1;

    maison.pieces.forEach(function (piece) {
      if (!piece.contour || piece.contour.length < 3) return;
      var aire = _aire(piece.contour);
      if (aire > meilleureAire) { meilleureAire = aire; plusGrande = piece; }
    });

    return plusGrande ? centreDegage(plusGrande.contour) : null;
  }

  // ---------------------------------------------------------------------------
  // Pilotage de la caméra
  // ---------------------------------------------------------------------------

  function active() {
    return etat !== null;
  }

  /** Coupe ou rétablit le clavier de la caméra. */
  function clavier(camera, actif) {
    var entree = camera.inputs && camera.inputs.attached &&
                 camera.inputs.attached.keyboard;
    if (!entree) return;

    try {
      // detachControl vide aussi les touches en cours : sans cela, une
      // touche enfoncée au moment du clic resterait bloquée.
      if (actif) entree.attachControl(); else entree.detachControl();
    } catch (e) { /* version de Babylon sans ces méthodes : on s'en passe */ }
  }

  /**
   * Entre en visite.
   *
   * @param {Object} options
   *   scene, engine, canvas   objets Babylon
   *   depart                  [x, z] en mètres
   *   cameraPrecedente        caméra à restaurer en sortant
   *   surQuitter              rappel appelé à la sortie
   */
  function demarrer(options) {
    var o = options || {};
    if (etat || !o.scene || !o.canvas) return false;

    var scene = o.scene;
    var depart = o.depart || [0, 0];

    scene.collisionsEnabled = true;

    var camera = new BABYLON.UniversalCamera(
      "visite",
      new BABYLON.Vector3(depart[0], HAUTEUR_OEIL, depart[1]),
      scene
    );

    camera.minZ = 0.05;
    camera.fov = 1.05;
    camera.speed = VITESSE_MS / CONVERSION;
    camera.angularSensibility = 3200;
    camera.inertia = 0.6;

    camera.checkCollisions = true;
    camera.ellipsoid = new BABYLON.Vector3(RAYON, DEMI_CORPS, RAYON);
    camera.ellipsoidOffset = new BABYLON.Vector3(0, DECALAGE_CORPS, 0);

    /* Gravité maison : la hauteur est simplement maintenue. Plus sûr que la
       gravité de Babylon, qui dépend d'un sol muni de collisions et dont le
       réglage de l'ellipsoïde est délicat. */
    camera.applyGravity = false;

    camera.keysUp    = TOUCHES.avant.slice();
    camera.keysDown  = TOUCHES.arriere.slice();
    camera.keysLeft  = TOUCHES.gauche.slice();
    camera.keysRight = TOUCHES.droite.slice();

    /* Regarder où l'on entre. L'appelant donne la direction quand il la
       connaît — franchir une porte, c'est s'en éloigner. Sans elle, faute de
       mieux, on part vers le +X : arbitraire, mais au moins constant. */
    var regard = o.regard || [depart[0] + 1, depart[1]];
    camera.setTarget(new BABYLON.Vector3(regard[0], HAUTEUR_OEIL, regard[1]));

    camera.attachControl(o.canvas, true);

    etat = {
      scene: scene,
      canvas: o.canvas,
      camera: camera,
      precedente: o.cameraPrecedente || null,
      surQuitter: o.surQuitter || null,
      regarde: false,
      course: false
    };

    /* Le clavier ne sert que quand on ne regarde pas.
     *
     * Le doigt est écarté : sur un écran tactile il n'y a pas de clavier à
     * couper, et surtout la page de visite y branche ses propres commandes —
     * un pouce qui marche, un autre qui regarde, en même temps. Remettre la
     * marche à zéro à chaque début de glissement l'arrêterait net. */
    etat.surPointerDown = function (evenement) {
      if (evenement && evenement.pointerType === "touch") return;
      etat.regarde = true;
      camera.cameraDirection.set(0, 0, 0);
      clavier(camera, false);
    };

    etat.surPointerUp = function (evenement) {
      if (evenement && evenement.pointerType === "touch") return;
      if (!etat.regarde) return;
      etat.regarde = false;
      clavier(camera, true);
    };

    etat.surTouche = function (evenement) {
      if (evenement.key === "Escape") { arreter(); return; }

      if (evenement.key === "Shift") {
        var court = evenement.type === "keydown";
        if (court !== etat.course) {
          etat.course = court;
          camera.speed = VITESSE_MS *
            (court ? FACTEUR_COURSE : 1) / CONVERSION;
        }
      }
    };

    o.canvas.addEventListener("pointerdown", etat.surPointerDown);
    window.addEventListener("pointerup", etat.surPointerUp);
    window.addEventListener("keydown", etat.surTouche);
    window.addEventListener("keyup", etat.surTouche);

    // Maintien de la hauteur, image après image.
    etat.observateur = scene.onBeforeRenderObservable.add(function () {
      camera.position.y = HAUTEUR_OEIL;
    });

    if (etat.precedente) etat.precedente.detachControl(o.canvas);
    scene.activeCamera = camera;

    return true;
  }

  /** Quitte la visite et rétablit la caméra précédente. */
  function arreter() {
    if (!etat) return false;

    var courant = etat;
    etat = null;

    courant.canvas.removeEventListener("pointerdown", courant.surPointerDown);
    window.removeEventListener("pointerup", courant.surPointerUp);
    window.removeEventListener("keydown", courant.surTouche);
    window.removeEventListener("keyup", courant.surTouche);

    if (courant.observateur) {
      courant.scene.onBeforeRenderObservable.remove(courant.observateur);
    }

    courant.camera.detachControl(courant.canvas);

    if (courant.precedente) {
      courant.scene.activeCamera = courant.precedente;
      courant.precedente.attachControl(courant.canvas, true);
    }

    courant.camera.dispose();

    if (courant.surQuitter) courant.surQuitter();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  global.Visite = {
    HAUTEUR_OEIL: HAUTEUR_OEIL,
    VITESSE_MS:   VITESSE_MS,
    TOUCHES:      TOUCHES,

    /* La caméra de la visite, pour qui veut la piloter autrement — une
       manette tactile, par exemple, qui n'a pas de touches à simuler. */
    camera: function () { return etat ? etat.camera : null; },

    centreDegage:    centreDegage,
    departConseille: departConseille,
    demarrer:        demarrer,
    arreter:         arreter,
    active:          active
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.Visite;
  }

})(typeof window !== "undefined" ? window : globalThis);
