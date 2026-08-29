/**
 * Catalogue 3D — moteur de rendu Babylon.js
 *
 * La pièce est décrite par cinq surfaces indépendantes (sol + quatre murs),
 * portées par le module Surfaces. Ce fichier traduit ce modèle en maillages
 * et matériaux Babylon, monte le décor autour, et tient l'état commun.
 *
 * Il ne fait plus tout : trois fichiers en sont sortis, et reçoivent de lui
 * le noyau qui leur donne accès à cet état.
 *
 *   traceur2d.js — le canvas 2D du modal d'import
 *   maison.js    — les volumes bâtis depuis un plan analysé
 *   panneau.js   — le formulaire de gauche et le métré
 *
 * Exposé sur window.Moteur pour pilotage depuis la console.
 */
(function () {
  "use strict";

  // --- Configuration -------------------------------------------------------

  var CONFIG = {
    /* Environnement image-based : une photographie de lumière, dont le PBR
       tire ses reflets. C'est elle qui fait la différence entre un carreau et
       un aplat de couleur.

       Studio à lumière chaude, et local. Deux environnements ont été écartés
       avant lui, tous deux pour la même raison : ils versaient du bleu sur les
       carreaux et annulaient leur teinte. Un sable relevé à 210/199/179 —
       écart rouge/bleu de +31 — s'affichait à 198/193/194 sous le ciel du
       réseau Babylon, puis à 173/177/184 sous un studio froid, soit un écart
       devenu négatif : le carreau rendait plus de bleu que de rouge.

       Récupérable par « node outils/dl-hdri.js », le dossier textures/
       n'étant pas versionné. */
    hdrUrl: "textures/photo_studio_loft_hall_1k.hdr",

    // Côté du cube filtré à la volée depuis le .hdr. 512 suffit pour de
    // l'éclairage ; au-delà, on paye un préfiltrage plus long sans le voir.
    hdrResolution: 512,

    /* À 0,7, le studio chaud rendait bien la teinte des carreaux mais laissait
       la scène terne — luminance 145 là où l'ancien ciel donnait 178. Le
       niveau plein rattrape la lumière sans rien coûter à la couleur : c'est
       le même environnement, seulement plus présent. */
    hdrIntensite: 1.0,

    /* Les lampes ne sont plus la source principale : l'environnement porte la
       lumière, elles ne font que sculpter. À pleine intensité par-dessus lui,
       les clairs brûlaient et le carrelage tournait au plastique. Le facteur
       s'applique aux trois lampes de chaque ambiance — il survit donc aux
       changements de preset, ce qu'un réglage posé une fois ne ferait pas. */
    facteurLampes: 0.6,

    /* La page vit dans app/ ; catalogue/ et textures/ sont à la racine.
       Une page qui les voit ailleurs — la copie publiée, où tout est à plat —
       le déclare avant de charger ce fichier. */
    baseRessources: (typeof window !== "undefined" && window.BASE_RESSOURCES)
      || "../",

    /* Les modèles 3D déposés dans modeles-3d/. La liste n'est pas tenue ici :
       le serveur lit le dossier, et le panneau affiche ce qu'il y trouve. */
    modeles: {
      dossier: "modeles-3d/",
      // Hauteur par défaut d'un meuble posé, faute d'en savoir plus. Un
      // modèle deux fois trop grand se remarque ; un modèle à sa taille
      // native peut arriver en millimètres comme en pouces.
      hauteur: 1.00,
      liste: "/api/modeles-3d"
    },

    /* Le meuble désigné dans la scène. */
    mobilier: {
      surlignage: "#4d9fff"   // le bleu d'accent de l'interface
    },

    /* Les cotes réelles de chaque modèle, en mètres.
     *
     * Les fichiers arrivent à des échelles sans rapport les unes avec les
     * autres — de 0,23 unité pour une cuvette à 132 pour un tapis. Aucune
     * n'a de sens dans une scène où le mur fait 2,50 m : c'est la seule
     * raison d'être de cette table.
     *
     * `largeur` et `profondeur` sont les deux cotes au sol, `hauteur` la
     * verticale. Les deux premières sont appariées par ordre de grandeur, et
     * non par axe : voir `recalibreMesh`.
     */
    calibrage: {
      "plante-entree.glb":         { hauteur: 1.00 },
      "Arbre.glb":                 { hauteur: 4.00 },
      "baignoire.glb":             { largeur: 1.80, profondeur: 0.90, hauteur: 0.60 },
      "Toilette.glb":              { largeur: 0.70, profondeur: 0.40, hauteur: 0.80 },
      "Porte-serviettes.glb":      { largeur: 0.80, hauteur: 1.10 },
      "canape d'angle noir.glb":   { largeur: 2.20, profondeur: 2.20, hauteur: 0.85 },
      "Canapé marron.glb":         { largeur: 2.80, profondeur: 0.90, hauteur: 0.85 },
      "Canapé beige.glb":          { largeur: 2.50, profondeur: 0.90, hauteur: 0.85 },
      "Tapis design bleublanc.glb": { largeur: 2.50, profondeur: 1.70 },
      "Tapis rondblanc.glb":       { largeur: 1.50, profondeur: 1.50 },

      /* parking.glb n'y figure pas, et c'est délibéré. Ce n'est pas un
         objet mais une scène — quarante-cinq maillages, une voiture, des
         cônes, un lampadaire — et lui imposer les cotes d'une place de
         stationnement y écraserait tout le reste. Il attend son propre
         traitement. `calibrageDe` prévient à chaque chargement. */

      /* La route se calibre à la pièce, pas au fichier : route.glb est une
         planche de six sections, et sa boîte englobante décrit la planche.
         Six mètres, c'est une chaussée à deux voies. */
      "route.glb":                 { piece: "road_straight", largeur: 6.00 }
    },

    /* La route qui longe la façade est, dans la scène d'accueil.
       route.glb est une planche de six pièces de voirie : on n'en pose
       qu'une, répétée. Chacune fait deux mètres de côté, à sa taille. */
    routeDemo: {
      fichier: "route.glb",
      ecart: 1.00      // m — entre le mur et le bord de la chaussée
      /* Ni la largeur ni le compte des sections ne sont ici. La première
         vient de `calibrage`, le second du terrain que la route traverse de
         bout en bout. Deux nombres écrits à la main se démentiraient au
         premier changement de l'un ou de l'autre. */
    },

    /* Les deux plantes qui encadrent la porte d'entrée.
       « Plant - White Pot » par Jakers_H [CC-BY] via Poly Pizza — le crédit
       est porté par l'interface, dans le volet du même nom.
       Sa taille vient de `calibrage`, comme celle de tous les modèles. */
    planteEntree: {
      fichier: "plante-entree.glb",
      ecart:   0.60,   // m — de part et d'autre de l'axe de la porte
      retrait: 0.50    // m — vers l'extérieur, devant la façade
    },

    /* Éclairage.
       Chaque ambiance décrit ses trois lumières, l'intensité de l'IBL et sa
       température de couleur, qui teinte l'ensemble (voir js/eclairage.js).

       Les intensités sont réparties pour qu'un même matériau garde une teinte
       comparable du sol au mur : une directionnelle dominante laisserait deux
       parois sur quatre sans aucune lumière directe.

       L'appoint est une seconde directionnelle, opposée et sans ombre portée,
       dont c'est précisément le rôle. */
    eclairage: {
      presetParDefaut: "showroom",

      // Intensité de la lumière d'une fenêtre, par m² de vitrage.
      fenetreParMetreCarre: 2.6,

      // Lumière du jour entrant par les baies, indépendante de l'ambiance
      // intérieure : le ciel ne change pas de couleur avec le luminaire.
      couleurFenetre: [0.92, 0.95, 1.0],

      presets: {
        showroom: {
          cle: "showroom",
          nom: "Showroom",
          // Neutre : c'est le rendu de référence des matériaux.
          temperature: 6500,
          ambiance: { intensite: 0.50, ciel: [1.00, 1.00, 1.00], sol: [0.50, 0.50, 0.55] },
          soleil: { intensite: 0.85, couleur: [1.00, 1.00, 1.00], direction: [-0.5, -1, -0.35] },
          appoint: { intensite: 0.45, couleur: [0.95, 0.97, 1.00], direction: [0.5, -0.6, 0.35] },
          environnement: 1.00,
          facteurFenetre: 1.0,
          inclinaison: 0.48
        },

        naturelle: {
          cle: "naturelle",
          nom: "Lumière naturelle",
          temperature: 7200,
          ambiance: { intensite: 0.55, ciel: [1.00, 1.00, 1.00], sol: [0.55, 0.56, 0.60] },
          // Directionnelle douce : le ciel domine, pas le soleil direct.
          soleil: { intensite: 0.50, couleur: [1.00, 1.00, 1.00], direction: [-0.4, -1, -0.3] },
          appoint: { intensite: 0.38, couleur: [0.94, 0.97, 1.00], direction: [0.5, -0.6, 0.35] },
          environnement: 1.40,
          facteurFenetre: 1.5,
          // Soleil au zénith, et lumière solaire chaude entrant par les baies.
          inclinaison: 0.40,
          couleurFenetre: [1.00, 0.96, 0.88]
        },

        bain: {
          cle: "bain",
          nom: "Salle de bain",
          // Blanc froid de LED.
          temperature: 6200,
          // Ambiante forte : lumière enveloppante, peu directionnelle.
          ambiance: { intensite: 0.95, ciel: [1.00, 1.00, 1.00], sol: [0.72, 0.73, 0.78] },
          soleil: { intensite: 0.35, couleur: [1.00, 1.00, 1.00], direction: [-0.4, -1, -0.3] },
          appoint: { intensite: 0.55, couleur: [0.97, 0.99, 1.00], direction: [0.5, -0.7, 0.35] },
          environnement: 0.70,
          facteurFenetre: 1.0,
          inclinaison: 0.48
        },

        cuisine: {
          cle: "cuisine",
          nom: "Cuisine",
          temperature: 4000,
          ambiance: { intensite: 0.50, ciel: [1.00, 1.00, 1.00], sol: [0.55, 0.55, 0.58] },
          // Luminaire de plafond : direction quasi verticale, intensité forte.
          soleil: { intensite: 1.15, couleur: [1.00, 0.99, 0.96], direction: [-0.15, -1, -0.10] },
          appoint: { intensite: 0.40, couleur: [1.00, 0.98, 0.94], direction: [0.35, -0.75, 0.3] },
          environnement: 0.70,
          facteurFenetre: 1.0,
          inclinaison: 0.48
        },

        chambre: {
          cle: "chambre",
          nom: "Chambre",
          temperature: 2700,
          ambiance: { intensite: 0.35, ciel: [1.00, 1.00, 1.00], sol: [0.60, 0.58, 0.55] },
          soleil: { intensite: 0.40, couleur: [1.00, 0.98, 0.94], direction: [-0.5, -0.9, -0.35] },
          appoint: { intensite: 0.24, couleur: [1.00, 0.96, 0.90], direction: [0.5, -0.6, 0.35] },
          environnement: 0.45,
          facteurFenetre: 0.9,
          // Soleil couchant : lumière rasante et chaude.
          inclinaison: 0.52
        }
      }
    },

    /* Décor extérieur : ce qu'on aperçoit par les baies et en tournant autour
       de la pièce. Volontairement sommaire — il doit reposer l'œil et mettre
       les matériaux en valeur, pas capter l'attention. */
    exterieur: {
      ciel: { turbidite: 8, luminance: 1.0, azimutParDefaut: 0.25 },

      sol: {
        cote: 100,        // m
        // Posé légèrement sous la pièce : à la même altitude, les deux plans
        // se disputeraient chaque pixel.
        altitude: -0.02,
        couleur: [0.290, 0.478, 0.227], // #4A7A3A
        echelleBruit: 0.05,
        amplitudeBruit: 0.15,
        rugosite: 0.95,
        // Une maille de texture couvre 8 m de terrain.
        metresParMaille: 8
      },

      arbres: {
        nombre: 10,
        largeur: 4,
        hauteur: 6,
        definition: { largeur: 256, hauteur: 512 },
        hauteurTronc: 0.20,
        couleurTronc: [0.361, 0.227, 0.118],   // #5C3A1E
        feuillageSombre: [0.239, 0.420, 0.208], // #3D6B35
        feuillageClair: [0.353, 0.604, 0.282]   // #5A9A48
      },

      brume: { densite: 0.008, couleur: [0.784, 0.847, 0.910] } // #C8D8E8
    },

    fenetre: {
      // Le vitrage se pose juste devant le carreau : la consigne était de ne
      // pas découper le mur, un retrait réel le masquerait.
      retraitVitre: 0.002,
      // Le dormant, lui, avance de 2 cm : c'est ce décroché qui donne à l'œil
      // l'impression d'une baie en retrait.
      saillieCadre: 0.02,
      largeurCadre: 0.04,
      couleurCadre: [0.17, 0.18, 0.20],
      emissiviteVitre: 1.2,
      // Distance de la source lumineuse devant le vitrage.
      reculLumiere: 0.30,
      angleCone: Math.PI * 0.78
    },

    piece: {
      longueur: 10, // axe X, en mètres
      largeur: 6,   // axe Z, en mètres
      hauteur: 2.5  // hauteur des murs, en mètres
    },

    // Maison reconstruite depuis un plan analysé.
    maison: {
      epaisseur: 0.10,       // m, épaisseur des murs
      couleur: "#e9e5dd",    // enduit clair
      rugosite: 0.92,
      couleurVitre: "#a8cadf",
      alphaVitre: 0.28,
      /* Émissivité du vitrage. Discrète à dessein : elle ne sert qu'à faire
         déborder le jour du cadre de la baie sous la couche de halo, comme
         sur une photographie d'intérieur. Au-delà, la vitre cesse d'être une
         vitre et devient une lampe. */
      emissiviteVitre: 0.35,
      surlignage: "#4d9fff",     // contour du mur sélectionné
      couleurEntree: "#8a5a2b",  // encadrement de la porte d'entrée
      couleurMarche: "#cfcdc7",  // pierre grise claire
      couleurRampe:  "#3c4046"   // métal sombre
    },

    // Fond de joint : ce qui reste visible entre les carreaux.
    joint: {
      couleur: [0.22, 0.22, 0.24],
      rugosite: 0.85,
      metallique: 0.0
    },

    carreau: {
      rugosite: 0.35,
      metallique: 0.0,
      hauteur: 0.008 // épaisseur apparente au-dessus du fond de joint (m)
    },

    limites: { min: 0.1, max: 500 },
    limitesHauteur: { min: 0.1, max: 20 },

    // Plafond pour l'ensemble des surfaces, au-delà du garde-fou par surface.
    maxCarreauxScene: 60000
  };

  // --- État ----------------------------------------------------------------

  var canvas, engine, scene, camera, generateurOmbres;
  var lumiereSoleil, lumiereAmbiance, lumiereAppoint;
  var grille, materiauJoint, materiauVitre, materiauCadre;

  var ciel, materiauCiel, solExterieur, arbres = [];
  var presetActif = CONFIG.eclairage.presetParDefaut;
  var fenetres = [];   // modèle pur (module Fenetres)
  var rendusFenetres = {}; // id -> { vitre, cadre, lumiere }

  var surfaces = [];   // modèle pur (module Surfaces)
  var rendus = {};     // id -> { fond, carrelage, materiau, repere, resultat }
  var surfaceActive = "sol";
  var chute = 5;

  var dims = {
    longueur: CONFIG.piece.longueur,
    largeur: CONFIG.piece.largeur,
    hauteur: CONFIG.piece.hauteur
  };

  /**
   * Contours du sol importés depuis le plan de masse, ou null (pièce
   * rectangulaire).
   *
   * Format : [[[x, z], …], …] en mètres — une liste de contours, et non un
   * seul. Un relevé donne rarement un bloc unique : les polygones de pièces
   * sont séparés par l'épaisseur des cloisons, et une aile peut se détacher
   * du corps de logis. Tant que ce champ n'a porté qu'un contour, tout ce
   * qui tombait hors du bloc principal restait sans carrelage.
   *
   * Quand il est défini, le sol prend cette forme ; les murs restent
   * rectangulaires sur la boîte englobante (évolution future possible).
   */
  var contoursPiece = null;

  /**
   * Maison reconstruite depuis un plan analysé, ou null.
   *
   * { repere, contour, pieces: [{ nom, type, contour, aire }],
   *   murs: [...], ouvertures: [...] }
   *
   * Tout y est exprimé en mètres dans le repère commun établi par
   * MursPlan.repere : le sol, les murs et les ouvertures ne peuvent pas
   * dériver les uns par rapport aux autres.
   */
  var maison = null;

  /**
   * Maillages bâtis pour la maison, à défaire avant de la rebâtir.
   *
   * L'objet est partagé tel quel avec maison.js, qui le remplit : seuls ses
   * champs changent, jamais l'objet lui-même — le remplacer romprait le lien
   * entre les deux fichiers.
   */
  /* `metre` porte le métré de l'habillage, cumulé par lot de carrelage et
     non par face : quarante faces feraient quarante lignes au devis, quand
     ce qui se commande est un lot. */
  var rendusMaison = { murs: [], vitres: [], parMur: {}, metre: [] };

  /**
   * Revêtement des murs de la maison : réglages d'ensemble, exceptions par
   * mur, et mur sélectionné. Modèle pur tenu par MursPlan.
   */
  var habillageMurs = null;

  // --- Utilitaires ---------------------------------------------------------

  function borner(valeur, min, max) {
    if (!isFinite(valeur)) return min;
    return Math.min(max, Math.max(min, valeur));
  }

  /* Densité de rendu maximale. Au-delà, le gain visible ne paie plus la
     mémoire consommée — et sur un téléphone, il la paie d'un écran noir. */
  var DENSITE_RENDU_MAX = 2;

  /* Largeur en deçà de laquelle on tient l'appareil pour un téléphone. */
  var LARGEUR_TELEPHONE = 768;

  /**
   * Vrai si la page prend des captures d'écran de la scène.
   *
   * Seul l'outil d'édition le fait, pour la fiche PDF. La page de visite le
   * déclare avant de charger ce fichier — comme elle déclare déjà la racine
   * des ressources. Sans déclaration, on suppose l'outil d'édition : c'est le
   * cas où une capture manquante se verrait tout de suite.
   */
  function capturesEcranAttendues() {
    if (typeof window === "undefined") return true;
    return window.CAPTURES_ECRAN !== false;
  }

  /**
   * Vrai sur un appareil dont le budget graphique est étroit.
   *
   * Deux signaux, et l'un ou l'autre suffit : un écran étroit, ou une densité
   * élevée. Le second attrape le téléphone tenu à l'horizontale, dont la
   * largeur dépasse le seuil sans que sa mémoire ait grandi.
   */
  function appareilModeste() {
    if (typeof window === "undefined") return false;
    return window.innerWidth < LARGEUR_TELEPHONE ||
           (window.devicePixelRatio || 1) > DENSITE_RENDU_MAX;
  }

  function afficherErreur(message) {
    var boite = document.getElementById("erreur");
    if (!boite) return;
    boite.textContent = message;
    boite.style.display = "block";
  }

  function couleurBabylon(hexadecimal) {
    try {
      return BABYLON.Color3.FromHexString(hexadecimal);
    } catch (e) {
      return new BABYLON.Color3(0.8, 0.79, 0.76);
    }
  }

  function murActifs() {
    var champ = document.getElementById("murs");
    return champ ? champ.checked : true;
  }

  // --- Construction de la scène -------------------------------------------

  function creerScene() {
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.043, 0.047, 0.059, 1.0);

    /* Tone mapping ACES posé sur la scène, et non par un pipeline de
       post-traitement.

       Un DefaultRenderingPipeline a été essayé, avec bloom, vignette et
       occlusion ambiante. Il rendait l'écran entièrement vert au retour de
       la visite immersive : cette page monte une seconde caméra sur la même
       scène, et le rattachement d'un pipeline à une caméra qui change ne
       s'en remet pas. Le SSAO2 d'abord, puis le pipeline seul, ont produit
       le même défaut.

       Posée ici, la configuration s'applique à toute caméra de la scène,
       présente ou future, sans rien à rattacher ni à détacher. C'est moins
       flatteur — pas de bloom, pas de vignette — et c'est sûr. */
    try {
      scene.imageProcessingConfiguration.toneMappingEnabled = true;
      scene.imageProcessingConfiguration.toneMappingType =
        BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
      scene.imageProcessingConfiguration.exposure = 1.2;
      scene.imageProcessingConfiguration.contrast = 1.08;
    } catch (e) {
      /* Repli : exposition seule, sans tone mapping. Une machine qui refuse
         la courbe ACES doit voir sa pièce, fût-elle moins nuancée. */
      scene.imageProcessingConfiguration.exposure = 1.1;
    }

    surfaces = Surfaces.creer();

    creerCamera();
    creerEclairage();
    creerHalo();
    construireExterieur();
    reconstruireTout();
    construireFenetres();
    construireGrille();
    recadrerCamera();

    return scene;
  }

  function creerCamera() {
    camera = new BABYLON.ArcRotateCamera(
      "cameraOrbitale",
      -Math.PI / 2,      // alpha : vue de face
      Math.PI / 3.2,     // beta  : légèrement en plongée
      18,                // rayon initial, ajusté par recadrerCamera()
      BABYLON.Vector3.Zero(),
      scene
    );

    camera.attachControl(canvas, true);
    camera.minZ = 0.05;
    camera.maxZ = 2000;

    // La caméra reste au-dessus du sol et à distance raisonnable.
    camera.lowerBetaLimit = 0.05;
    camera.upperBetaLimit = Math.PI / 2 - 0.02;
    camera.lowerRadiusLimit = 0.5;
    camera.upperRadiusLimit = 900;

    camera.wheelDeltaPercentage = 0.02; // zoom proportionnel à la distance
    camera.pinchDeltaPercentage = 0.02;
    camera.panningSensibility = 120;
    camera.panningInertia = 0.85;
    camera.inertia = 0.82;
    camera.useNaturalPinchZoom = true;
  }

  /**
   * Halo lumineux autour des sources claires.
   *
   * Remplace le bloom du pipeline de post-traitement, retiré parce qu'il
   * s'attachait aux caméras et ne survivait pas à la visite immersive. Une
   * couche d'effet, elle, est rendue par la scène pour toute caméra : rien
   * à rattacher, donc rien à désynchroniser.
   *
   * Ce halo ne touche pas les carreaux. Une couche de ce type ne réagit qu'à
   * l'émissif d'un matériau, et un carreau n'en a aucun : sa brillance vient
   * du spéculaire, que cette couche ne voit pas. Ce qui s'allume ici, ce sont
   * les vitres — seul matériau franchement émissif de la scène. Le jour
   * déborde légèrement du cadre des baies, ce qu'une photographie
   * d'intérieur montre toujours.
   *
   * Le feuillage des arbres est écarté. Il porte un émissif de confort, posé
   * pour qu'un billboard sans volume ne s'assombrisse pas d'un côté ; le
   * laisser luire cernerait chaque arbre d'une auréole verte. On l'écarte par
   * un sélecteur plutôt que par une liste : le décor se reconstruit à chaque
   * changement de réglage, et une liste de maillages serait à retenir.
   */
  function creerHalo() {
    if (!scene || !BABYLON.GlowLayer) return null;

    /* Une couche d'effet tient ses propres cibles de rendu, à la taille du
       tampon, et les floute en deux passes. C'est un agrément — le jour qui
       déborde du cadre des baies — payé en mémoire et en remplissage. Sur un
       téléphone, où le contexte se perd déjà pour le seul tampon, l'agrément
       n'est plus défendable : on rend la pièce, sans halo. */
    if (appareilModeste()) {
      CONFIG.halo = null;
      return null;
    }

    try {
      var halo = new BABYLON.GlowLayer("halo", scene, { blurKernelSize: 32 });
      halo.intensity = 0.3;

      halo.customEmissiveColorSelector = function (maillage, sousMaillage, materiau, resultat) {
        if (maillage.name.indexOf("arbre-") === 0) {
          resultat.set(0, 0, 0, 0);
          return;
        }

        var e = materiau && materiau.emissiveColor;
        if (!e) {
          resultat.set(0, 0, 0, 0);
          return;
        }

        resultat.set(e.r, e.g, e.b, 1);
      };

      CONFIG.halo = halo;
    } catch (e) {
      /* Silencieux : le halo est un agrément. Une machine qui le refuse doit
         voir sa pièce, pas un message d'erreur. */
      CONFIG.halo = null;
    }

    return CONFIG.halo;
  }

  function creerEclairage() {
    // 1. Éclairage image-based : source principale de la lumière PBR.
    try {
      /* HDRCubeTexture, et non CreateFromPrefilteredData : celle-ci attend un
         .env déjà filtré, quand un .hdr est une photographie brute. Le dernier
         argument demande le préfiltrage au chargement — sans lui, la scène
         n'aurait qu'un reflet net, jamais la diffusion douce d'un studio. */
      var hdr = new BABYLON.HDRCubeTexture(
        CONFIG.baseRessources + CONFIG.hdrUrl,
        scene,
        CONFIG.hdrResolution,
        false,   // pas de génération d'harmoniques sphériques séparée
        true,    // inverser l'axe Z : convention Babylon
        false,   // gamma : un HDR est déjà linéaire
        true     // préfiltrer au chargement
      );
      scene.environmentTexture = hdr;
      scene.environmentIntensity = CONFIG.hdrIntensite;

      /* Pas de skybox tirée de l'environnement : le ciel visible est celui du
         module extérieur. L'HDR ne sert plus qu'à l'éclairage image-based. */
    } catch (e) {
      afficherErreur(
        "L'environnement HDR n'a pas pu être chargé (" + e.message +
        "). La scène reste éclairée par les lumières de secours."
      );
    }

    /* 2. Remplissage hémisphérique : garantit une scène lisible même si le
          .env distant est indisponible (hors ligne, CDN bloqué).

          Sa couleur de sol est volontairement proche de sa couleur de ciel.
          Une paroi verticale reçoit la moyenne des deux ; les creuser
          rendrait tous les murs nettement plus sombres que le sol. */
    lumiereAmbiance = new BABYLON.HemisphericLight(
      "ambiance", new BABYLON.Vector3(0, 1, 0), scene
    );

    // 3. Directionnelle : donne la direction des ombres portées.
    lumiereSoleil = new BABYLON.DirectionalLight(
      "soleil", new BABYLON.Vector3(-0.5, -1, -0.35), scene
    );
    lumiereSoleil.position = new BABYLON.Vector3(15, 30, 12);

    /* 4. Appoint opposé, sans ombre portée.
          La directionnelle seule ne touche que deux parois sur quatre : les
          deux autres ne recevaient que l'hémisphérique, d'où un même carreau
          six fois plus sombre d'un mur à l'autre. */
    lumiereAppoint = new BABYLON.DirectionalLight(
      "appoint", new BABYLON.Vector3(0.5, -0.6, 0.35), scene
    );
    lumiereAppoint.specular = new BABYLON.Color3(0.2, 0.2, 0.2);

    // 5. Les intensités et teintes viennent de l'ambiance choisie.
    appliquerPreset(presetActif);

    generateurOmbres = new BABYLON.ShadowGenerator(1024, lumiereSoleil);
    generateurOmbres.useBlurExponentialShadowMap = true;
    generateurOmbres.blurKernel = 32;
    generateurOmbres.darkness = 0.35;
  }

  /** Preset d'ambiance courant, développé par le module Eclairage. */
  function presetResolu() {
    var table = CONFIG.eclairage.presets;
    var preset = table[presetActif] || table[CONFIG.eclairage.presetParDefaut];
    return Eclairage.resoudrePreset(preset);
  }

  /**
   * Recharge toutes les lumières depuis une ambiance.
   * Aucune géométrie n'est refaite : le changement est immédiat.
   */
  function appliquerPreset(cle) {
    if (CONFIG.eclairage.presets[cle]) presetActif = cle;

    var reglage = presetResolu();
    if (!reglage) return null;

    /* Les intensités des ambiances sont écrites pour un éclairage porté par
       les lampes. Depuis que l'environnement HDRI porte la lumière, elles
       s'ajoutent à lui : le facteur les ramène à leur rôle de modelé. Il
       s'applique ici, et non une fois pour toutes à la création — sans quoi
       le premier changement d'ambiance rendrait aux lampes leur pleine
       puissance et rebrûlerait la scène. */
    var facteur = CONFIG.facteurLampes > 0 ? CONFIG.facteurLampes : 1;

    if (lumiereAmbiance) {
      lumiereAmbiance.intensity = reglage.ambiance.intensite * facteur;
      lumiereAmbiance.diffuse = BABYLON.Color3.FromArray(reglage.ambiance.ciel);
      lumiereAmbiance.groundColor = BABYLON.Color3.FromArray(reglage.ambiance.sol);
    }

    if (lumiereSoleil) {
      lumiereSoleil.intensity = reglage.soleil.intensite * facteur;
      lumiereSoleil.diffuse = BABYLON.Color3.FromArray(reglage.soleil.couleur);
      lumiereSoleil.direction = BABYLON.Vector3.FromArray(reglage.soleil.direction).normalize();
    }

    if (lumiereAppoint) {
      lumiereAppoint.intensity = reglage.appoint.intensite * facteur;
      lumiereAppoint.diffuse = BABYLON.Color3.FromArray(reglage.appoint.couleur);
      lumiereAppoint.direction = BABYLON.Vector3.FromArray(reglage.appoint.direction).normalize();
    }

    /* L'ambiance module l'environnement, elle ne le fixe pas : `environnement`
       vaut 1 pour le showroom et s'écarte pour les autres, CONFIG.hdrIntensite
       donnant le niveau de référence. */
    if (scene) {
      scene.environmentIntensity = reglage.environnement * CONFIG.hdrIntensite;
    }

    // Le soleil du ciel se replace là où pointent les ombres.
    majCiel(reglage);

    // Les baies suivent l'ambiance : plus présentes en lumière naturelle.
    majIntensiteFenetres(reglage);
    ajusterOmbres();

    return reglage;
  }

  /** Cadre la shadow map sur l'emprise réelle de la pièce. */
  function ajusterOmbres() {
    if (!lumiereSoleil) return;

    var portee = Math.max(dims.longueur, dims.largeur, dims.hauteur);

    lumiereSoleil.position = new BABYLON.Vector3(portee * 0.9, portee * 1.6, portee * 0.7);
    lumiereSoleil.shadowMinZ = 0.1;
    lumiereSoleil.shadowMaxZ = portee * 4;
    lumiereSoleil.autoUpdateExtends = false;
    lumiereSoleil.orthoLeft = -portee;
    lumiereSoleil.orthoRight = portee;
    lumiereSoleil.orthoBottom = -portee;
    lumiereSoleil.orthoTop = portee;
  }

  // --- Matériaux -----------------------------------------------------------

  /**
   * Réglages communs à tous les matériaux PBR de la scène.
   *
   * Ils servent la cohérence d'aspect d'une surface à l'autre : sans eux, un
   * même carreau paraît plus clair au sol qu'au mur, le sol étant vu sous un
   * angle rasant et éclairé par le dessus.
   */
  function reglerMateriauPBR(materiau) {
    /* Indice de réfraction abaissé. À 1,5, la réflectance d'un diélectrique à
       incidence normale vaut 4 % et monte vers 100 % en rasant : c'est ce
       voile spéculaire qui blanchit le sol. À 1,2 elle tombe à 0,8 %. */
    materiau.indexOfRefraction = 1.2;

    /* Chute de lumière non physique. Sans effet ici — nos lumières sont
       directionnelles et hémisphériques, donc sans atténuation en distance —
       mais posé pour que l'ajout d'une lumière ponctuelle ne réintroduise pas
       d'écart entre surfaces. */
    materiau.usePhysicalLightFalloff = false;

    return materiau;
  }

  /** Fond de joint, commun à toutes les surfaces carrelées. */
  function obtenirMateriauJoint() {
    if (materiauJoint) return materiauJoint;

    materiauJoint = new BABYLON.PBRMaterial("jointPBR", scene);
    materiauJoint.albedoColor = BABYLON.Color3.FromArray(CONFIG.joint.couleur);
    materiauJoint.roughness = CONFIG.joint.rugosite;
    materiauJoint.metallic = CONFIG.joint.metallique;
    materiauJoint.environmentIntensity = 0.7;

    reglerMateriauPBR(materiauJoint);

    return materiauJoint;
  }

  /** Matériau propre à une surface, créé à la demande. */
  function obtenirMateriauSurface(surface) {
    var rendu = rendus[surface.id] || (rendus[surface.id] = {});
    if (rendu.materiau) return rendu.materiau;

    rendu.materiau = new BABYLON.PBRMaterial("surface-" + surface.id, scene);
    rendu.materiau.environmentIntensity = 0.85;
    // Les surfaces sont planes et adossées à un fond opaque : l'orientation
    // des faces n'a pas d'incidence, les normales étant fixées explicitement.
    rendu.materiau.backFaceCulling = false;

    reglerMateriauPBR(rendu.materiau);

    return rendu.materiau;
  }

  /**
   * Applique l'apparence d'une surface sur son matériau : texture du catalogue
   * si elle en porte une, sinon sa couleur unie.
   */
  /**
   * La surface est-elle celle que le panneau affiche ?
   *
   * Comparer à `surfaceActive` ne suffit plus : viser un mur peut désigner
   * l'habillage de la maison, dont l'identifiant diffère de celui de la zone
   * cliquée sur le plan.
   */
  function estSurfaceAffichee(surface) {
    var courante = Panneau.surfaceCourante();
    return !!(surface && courante && surface.id === courante.id);
  }

  function appliquerApparence(surface) {
    var materiau = obtenirMateriauSurface(surface);

    if (!surface.texture) {
      if (typeof Materiaux !== "undefined") Materiaux.retirer(materiau);
      materiau.albedoColor = couleurBabylon(surface.couleur);
      materiau.roughness = CONFIG.carreau.rugosite;
      materiau.metallic = CONFIG.carreau.metallique;

      if (estSurfaceAffichee(surface)) Panneau.afficherEtatTexture("");
      return Promise.resolve();
    }

    if (typeof Materiaux === "undefined") {
      Panneau.afficherEtatTexture("Le module js/materiaux.js n'a pas été chargé.", true);
      return Promise.resolve();
    }

    if (estSurfaceAffichee(surface)) {
      Panneau.afficherEtatTexture("Chargement de la texture…", false);
    }

    return Materiaux
      .appliquer(materiau, surface.texture, scene, CONFIG.baseRessources)
      .then(function (resultat) {
        var concerne = estSurfaceAffichee(surface);

        if (resultat.erreur) {
          if (concerne) Panneau.afficherEtatTexture(resultat.erreur, true);
          surface.texture = "";
          materiau.albedoColor = couleurBabylon(surface.couleur);
          return;
        }

        if (concerne) {
          Panneau.afficherEtatTexture(
            "Cartes : " + Object.keys(resultat.materiau.cartes).sort().join(", ") + ".", false
          );
        }
      });
  }

  // --- Surfaces ------------------------------------------------------------

  /**
   * Nombre de dessins disponibles pour les carreaux d'une surface.
   *
   * Lu dans le catalogue, donc connu au moment de bâtir la géométrie : les UV
   * doivent désigner la bonne case de l'atlas dès la construction, bien avant
   * que la texture n'ait fini de charger.
   */
  function tamponsDeSurface(surface) {
    if (!surface || !surface.texture || typeof Materiaux === "undefined") return 1;
    return Materiaux.nombreTampons(surface.texture);
  }

  /**
   * Schéma de pose multi-formats d'une surface, ou null.
   *
   * Il se lit sur le matériau, jamais sur la surface : un opus appartient au
   * produit — c'est la même pierre débitée en quatre formats — et non au
   * réglage d'habillage. Changer de texture doit donc le faire suivre ou
   * disparaître, ce qu'un champ recopié dans la surface ne ferait pas.
   *
   * Reste que disposer d'un module et s'en servir sont deux choses : le même
   * travertin se pose en opus ou dans son seul format de référence, et c'est
   * la surface qui tranche. `poseOpus` à false rend donc la trame ordinaire,
   * schéma ou pas.
   *
   * La comparaison est stricte : une surface bâtie ailleurs qu'ici, ou venue
   * d'un enregistrement antérieur au réglage, n'a pas la clé du tout. Elle
   * doit alors garder l'opus — c'est ce que le matériau prescrit, et c'est ce
   * que le code faisait avant que le choix n'existe.
   */
  function schemaDeSurface(surface) {
    if (!surface || !surface.texture || typeof Materiaux === "undefined") return null;
    if (surface.poseOpus === false) return null;
    if (typeof Materiaux.schemaPose !== "function") return null;
    return Materiaux.schemaPose(surface.texture);
  }

  /**
   * Centre de l'emprise d'un contour [[x, z]] — l'origine s'il n'y en a pas.
   *
   * C'est là que se pose le plan de calepinage. Calepinage.calculer travaille
   * sur une boîte longueur × largeur centrée sur zéro ; le contour du sol,
   * lui, est là où les murs le placent, et depuis que le tracé lui donne sa
   * forme il n'a aucune raison de tomber sur l'origine.
   */
  function centreEmprise(contours) {
    if (!contours || !contours.length) return [0, 0];

    var xMin = Infinity, xMax = -Infinity;
    var zMin = Infinity, zMax = -Infinity;
    var points = 0;

    contours.forEach(function (contour) {
      if (!contour || contour.length < 3) return;
      contour.forEach(function (p) {
        if (p[0] < xMin) xMin = p[0];
        if (p[0] > xMax) xMax = p[0];
        if (p[1] < zMin) zMin = p[1];
        if (p[1] > zMax) zMax = p[1];
        points++;
      });
    });

    if (!points) return [0, 0];

    return [(xMin + xMax) / 2, (zMin + zMax) / 2];
  }

  /** Géométrie courante de la pièce, empruntée au module de calepinage. */
  function geometriePiece() {
    var listeMurs = Calepinage.murs(dims.longueur, dims.largeur, dims.hauteur);
    var parId = {};
    listeMurs.forEach(function (mur) { parId[mur.nom] = mur; });
    return { murs: listeMurs, parId: parId };
  }

  /**
   * Bâtit un maillage de sol depuis un polygone [[x, z]] en mètres.
   * Remplace CreateGround quand un plan importé définit la forme de la pièce.
   *
   * La triangulation par ear-clipping (module Plan) gère les pièces convexes
   * et non convexes (L, T…).
   *
   * Les UV sont au pas du carreau, en mètres, et non étalées de 0 à 1 sur la
   * boîte englobante : une texture posée là garde ses proportions, quelle
   * que soit la taille du sol. Étalées, elles s'étireraient d'autant plus
   * que la maison est grande. L'origine est celle du monde, la même que
   * celle de la trame de calepinage : le fond et les carreaux qui le
   * couvrent restent en phase.
   */
  function creerFondPolygone(contours, surface) {
    // Un contour seul reste accepté : maison.js pose ses dalles d'étage ainsi.
    var liste = (contours && Array.isArray(contours[0]) && Array.isArray(contours[0][0]))
      ? contours
      : [contours];

    /* Chaque contour est triangulé pour lui-même, et une pièce qui échoue
       n'emporte pas les autres : sur un plan d'une dizaine de pièces, un
       contour bancal ne doit pas laisser toute la maison sans sol. L'échec
       se dit en console — muet, il se traduirait par une pièce nue que rien
       n'explique. */
    var triangles = [];
    liste.forEach(function (pts, rang) {
      if (!pts || pts.length < 3) {
        console.warn("Sol : contour " + (rang + 1) + " ignoré (" +
          (pts ? pts.length : 0) + " sommets).");
        return;
      }

      var part;
      try {
        part = Plan.triangulation(pts.map(function (p) {
          return { x: p[0], y: p[1] };
        }));
      } catch (e) {
        console.warn("Sol : contour " + (rang + 1) + " non triangulable — " +
          e.message);
        return;
      }

      if (!part.length) {
        console.warn("Sol : contour " + (rang + 1) + " n'a produit aucun " +
          "triangle ; cette pièce restera sans carrelage.");
        return;
      }

      part.forEach(function (tri) { triangles.push(tri); });
    });

    if (!triangles.length) return null;

    var positions = [], normales = [], uvs = [], indices = [];

    var pasU = surface && surface.largeurCarreau > 0 ? surface.largeurCarreau : 1;
    var pasV = surface && surface.longueurCarreau > 0 ? surface.longueurCarreau : 1;

    triangles.forEach(function (tri) {
      var base = positions.length / 3;
      tri.forEach(function (p) {
        // {x, y} du triangulateur → (x, 0, z) dans la scène
        positions.push(p.x, 0, p.y);
        normales.push(0, 1, 0);
        uvs.push(p.x / pasU, p.y / pasV);
      });
      indices.push(base, base + 1, base + 2);
    });

    var maillage = new BABYLON.Mesh("fond-sol", scene);
    var vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.normals   = normales;
    vd.uvs       = uvs;
    vd.indices   = indices;
    vd.applyToMesh(maillage, false);
    return maillage;
  }

  function detruireRendu(identifiant) {
    var rendu = rendus[identifiant];
    if (!rendu) return;

    if (rendu.fond) { rendu.fond.dispose(); rendu.fond = null; }
    if (rendu.carrelage) { rendu.carrelage.dispose(); rendu.carrelage = null; }
    rendu.resultat = null;
    rendu.repere = null;
    // Sans cette remise à zéro, l'avertissement d'une reconstruction ratée
    // survivrait au passage de la surface en couleur unie.
    rendu.erreur = null;
  }

  /**
   * Les contours que le carrelage doit couvrir, en mètres.
   *
   * Trois sources, de la plus fidèle à la plus grossière :
   *
   *   1. les pièces du rez-de-chaussée, quand une maison est bâtie. Ce sont
   *      les polygones relevés sur le plan : le sol s'arrête au nu intérieur
   *      des cloisons, là où s'arrête vraiment le carrelage. On ne carrèle
   *      pas sous un mur, et le métré ne doit pas le compter ;
   *   2. le contour posé à la main, quand on a isolé une seule pièce ;
   *   3. le rectangle des cotes saisies, faute de plan.
   *
   * La maison passe avant le contour posé à la main, et c'est le sujet :
   * l'enveloppe du plan est une seule silhouette extérieure, dont la boîte
   * englobante servait de sol. Sur un plan en L, ou dès que les pièces ne
   * remplissent pas leur rectangle, le carrelage débordait de la maison —
   * jusque dans le jardin. Les pièces, elles, décrivent exactement les
   * surfaces à couvrir, une par une.
   *
   * Rend null quand aucun plan ne décrit le sol : la pièce est alors le
   * rectangle des cotes saisies, que le calepinage sait déjà remplir au
   * carreau près. Le découper n'apprendrait rien et referait ses comptes.
   *
   * @returns {Array<Array<[number, number]>>|null}
   */
  function contoursSol() {
    if (maison && maison.pieces) {
      var auSol = maison.pieces.filter(function (piece) {
        return !(piece.altitude > 0) && piece.contour && piece.contour.length >= 3;
      }).map(function (piece) { return piece.contour; });

      if (auSol.length) return auSol;
    }

    if (contoursPiece && contoursPiece.length) return contoursPiece;

    return null;
  }

  /**
   * Le sol des cotes saisies : un rectangle centré sur l'origine.
   *
   * Il passe par le même chemin que les contours d'un plan — quatre coins
   * plutôt que dix, mais même construction. Deux chemins séparés finiraient
   * par diverger, et le sol changerait d'aspect selon qu'un plan est chargé
   * ou non.
   */
  function rectangleDesCotes() {
    return [[
      [-dims.longueur / 2, -dims.largeur / 2],
      [ dims.longueur / 2, -dims.largeur / 2],
      [ dims.longueur / 2,  dims.largeur / 2],
      [-dims.longueur / 2,  dims.largeur / 2]
    ]];
  }

  /** Vrai si la surface doit apparaître dans la scène. */
  function surfaceVisible(surface) {
    // Une maison bâtie porte ses propres murs : ceux de la pièce
    // rectangulaire se superposeraient aux siens.
    if (surface.type === "mur" && maison) return false;
    return surface.type === "sol" || murActifs();
  }

  /**
   * Construit le support d'une surface : le sol, ou la paroi d'un mur.
   * En mode carrelé il sert de fond de joint ; en couleur unie il porte
   * directement la teinte de la surface.
   */
  function construireFond(surface, geo) {
    var rendu = rendus[surface.id] || (rendus[surface.id] = {});
    var maillage;

    if (surface.type === "sol") {
      maillage = creerFondPolygone(contoursSol() || rectangleDesCotes(), surface);
      if (!maillage) return;

      rendu.repere = null;
    } else {
      var mur = geo.parId[surface.id];
      if (!mur) return;

      maillage = BABYLON.MeshBuilder.CreatePlane("fond-" + surface.id, {
        width: mur.largeur,
        height: dims.hauteur,
        sideOrientation: BABYLON.Mesh.DOUBLESIDE
      }, scene);

      maillage.position.set(mur.centre[0], mur.centre[1], mur.centre[2]);
      // Le plan naît dans le plan XY : on le fait pivoter pour l'aligner sur
      // la paroi. Les deux faces sont générées, l'orientation exacte importe peu.
      maillage.rotation.y = Math.atan2(-mur.normale[0], -mur.normale[2]);

      rendu.repere = mur;
    }

    maillage.material = surface.mode === "carrele"
      ? obtenirMateriauJoint()
      : obtenirMateriauSurface(surface);

    maillage.receiveShadows = true;
    maillage.isPickable = false;

    rendu.fond = maillage;
  }

  /**
   * Bâtit le maillage carrelé d'une surface.
   *
   * Le calepinage est calculé dans un plan 2D ; `projeter(u, v)` place chaque
   * point dans l'espace. Sol et murs partagent donc exactement le même code —
   * un mur n'est qu'un rectangle dans un autre plan.
   *
   * Un carreau = un éventail de triangles autour de son premier sommet : les
   * contours issus de la découpe restent convexes, l'éventail est valide.
   */
  function construireCarrelage(surface, geo, resultat) {
    var rendu = rendus[surface.id] || (rendus[surface.id] = {});

    var projeter, normale, decoupe = null, compte = null;

    if (surface.type === "sol") {
      /* Le plan de calepinage se pose sur l'emprise du sol, pas sur
         l'origine du monde. Sans ce décalage, la trame et le contour ne se
         recouvrent que par leur intersection : partout ailleurs le fond de
         joint affleure, et le sol paraît gris par plaques. */
      var contours = contoursSol();
      var centre = centreEmprise(contours);

      projeter = function (u, v) {
        return [u + centre[0], CONFIG.carreau.hauteur, v + centre[1]];
      };
      normale = { x: 0, y: 1, z: 0 };

      /* Le sol s'arrête au contour, au carreau près : ceux du bord sont
         coupés dessus, pas gardés entiers. Gardés entiers — ce qu'un simple
         test du centre revenait à faire — ils dépassaient de près d'un
         demi-carreau au-delà des murs, et le carrelage mordait sur le
         terrain.

         Les triangles se calculent une fois pour toute la surface : le
         contour ne bouge pas d'un carreau à l'autre. */
      if (contours) {
        /* Les carreaux à découper sont exprimés dans le plan de calepinage :
           ce sont les contours qui y descendent, une fois, plutôt que chaque
           carreau qui en remonte. */
        var trianglesSol = Plan.trianglesDeContour(
          contours.map(function (contour) {
            return contour.map(function (p) {
              return [p[0] - centre[0], p[1] - centre[1]];
            });
          })
        );

        if (trianglesSol.length) {
          decoupe = function (contour) {
            return Plan.decouperSurContour(contour, trianglesSol);
          };

          /* Le métré suit le même contour que la pose. Les comptes rendus
             par Calepinage portent sur sa boîte : sur un L, ou dès que le
             tracé laisse un garage de côté, ils annoncent des carreaux que
             personne ne posera. Un devis ne peut pas se le permettre. */
          compte = Plan.compterSurContour(
            resultat.carreaux, trianglesSol, resultat.aireCarreau
          );
        }
      }
    } else {
      var mur = geo.parId[surface.id];
      if (!mur) return;

      projeter = function (u, v) {
        return Calepinage.projeterSurMur(mur, u, v, CONFIG.carreau.hauteur);
      };
      normale = { x: mur.normale[0], y: mur.normale[1], z: mur.normale[2] };
    }

    var maillage = maillerCarrelage(
      "carrelage-" + surface.id, surface, resultat, projeter, normale, decoupe
    );
    if (!maillage) return;

    maillage.material = obtenirMateriauSurface(surface);
    maillage.receiveShadows = true;
    maillage.isPickable = false;

    rendu.carrelage = maillage;
    rendu.resultat = compte ? metreRamene(resultat, compte) : resultat;
  }

  /**
   * Copie d'un calepinage dont les comptes sont ceux réellement posés.
   *
   * L'original n'est pas touché : il porte encore `carreaux`, la trame
   * entière, dont le maillage vient de se servir. Seuls les nombres que lit
   * le métré sont repris.
   */
  function metreRamene(resultat, compte) {
    var ramene = {};
    Object.keys(resultat).forEach(function (cle) {
      ramene[cle] = resultat[cle];
    });

    ramene.entiers      = compte.entiers;
    ramene.coupes       = compte.coupes;
    ramene.total        = compte.total;
    ramene.surfacePosee = compte.surfacePosee;
    // La surface du sol, c'est celle du contour — plus celle de la boîte.
    ramene.surfaceSol   = compte.surfaceSol;

    return ramene;
  }

  /**
   * Assemble le maillage d'un calepinage.
   *
   * `projeter(u, v)` place un point du plan de pose dans l'espace, `normale`
   * oriente les faces, et `decoupe(contour)` dit ce qu'il reste d'un carreau
   * — c'est ainsi qu'un sol polygonal s'arrête net à son contour et qu'un mur
   * ne se carrelle pas au travers de ses portes.
   *
   * `decoupe` rend une liste de morceaux : vide pour écarter le carreau, un
   * seul élément pour le garder tel quel — le cas courant, celui du plein
   * champ — plusieurs le long d'un bord. Sans `decoupe`, tous les carreaux
   * sont posés entiers.
   *
   * Un carreau = un éventail de triangles autour de son premier sommet : les
   * contours issus de la découpe restent convexes, l'éventail est valide.
   *
   * @returns {BABYLON.Mesh|null} null si aucun carreau ne subsiste.
   */
  function maillerCarrelage(nom, surface, resultat, projeter, normale, decoupe) {
    var positions = [];
    var normales = [];
    var uvs = [];   // atlas des tampons — carte d'albédo
    var uvs2 = [];  // [0,1] par carreau — cartes de relief, communes
    var indices = [];

    var nombreTampons = tamponsDeSurface(surface);

    /* Marge d'environ un texel : à la frontière de deux cases de l'atlas, le
       filtrage bilinéaire irait sinon puiser dans la case voisine et ferait
       apparaître un liseré du dessin d'à côté. */
    var margeAtlas = nombreTampons > 1 ? 0.001 : 0;

    for (var c = 0; c < resultat.carreaux.length; c++) {
      var carreau = resultat.carreaux[c];
      var tampon = carreau.tampon || 0;

      var morceaux = decoupe ? decoupe(carreau.contour) : [carreau.contour];

      for (var m = 0; m < morceaux.length; m++) {
        var contour = morceaux[m];
        var base = positions.length / 3;

        for (var i = 0; i < contour.length; i++) {
          var p = contour[i];
          var point = projeter(p[0], p[1]);

          positions.push(point[0], point[1], point[2]);
          normales.push(normale.x, normale.y, normale.z);

          /* Les UV se lisent dans le repère du carreau entier, jamais dans
             celui du morceau : un carreau coupé au bord montre la portion
             correspondante du dessin, à la même échelle et dans le même
             alignement que ses voisins restés entiers. Les prendre sur le
             morceau y écraserait le motif. */
          var coord = Calepinage.uv(carreau, p);

          // Le U est replié dans la case du tampon retenu ; le V reste intact.
          var u = (tampon + margeAtlas + coord[0] * (1 - 2 * margeAtlas)) / nombreTampons;
          uvs.push(u, coord[1]);
          uvs2.push(coord[0], coord[1]);
        }

        for (var t = 1; t < contour.length - 1; t++) {
          indices.push(base, base + t, base + t + 1);
        }
      }
    }

    if (!indices.length) return null;

    var maillage = new BABYLON.Mesh(nom, scene);

    var donnees = new BABYLON.VertexData();
    donnees.positions = positions;
    donnees.normals = normales;
    donnees.uvs = uvs;
    donnees.uvs2 = uvs2;
    donnees.indices = indices;
    donnees.applyToMesh(maillage, false);

    return maillage;
  }

  /** Reconstruit une seule surface. Les autres ne sont pas touchées. */
  function reconstruireSurface(surface, geo, differerMetre) {
    // L'habillage des murs de la maison ne se reconstruit pas surface par
    // surface : c'est la maison entière qui se rebâtit.
    if (MursPlan.estHabillage(surface.id)) {
      Maison.construire();
      if (!differerMetre) Panneau.majMetre();
      return;
    }

    var geometrie = geo || geometriePiece();

    detruireRendu(surface.id);

    if (!surfaceVisible(surface)) {
      if (!differerMetre) Panneau.majMetre();
      return;
    }

    construireFond(surface, geometrie);

    if (surface.mode === "carrele") {
      var options = Surfaces.optionsCalepinage(surface, dims, geometrie.murs, chute);
      // Le tirage du dessin se fait avec le reste : il dépend de la position
      // du carreau dans la trame, comme la rotation.
      options.nombreTampons = tamponsDeSurface(surface);

      /* Présent, le schéma remplace la trame : le format et le motif réglés
         au panneau ne s'appliquent plus, c'est le module qui commande. */
      options.schema = schemaDeSurface(surface);

      var resultat = Calepinage.calculer(options);

      if (resultat.erreur) {
        (rendus[surface.id] || (rendus[surface.id] = {})).erreur =
          surface.nom + " : " + resultat.erreur;
      } else {
        rendus[surface.id].erreur = null;
        construireCarrelage(surface, geometrie, resultat);
      }
    }

    if (!differerMetre) {
      Panneau.majMetre();
      majVisibiliteMurs();
    }
  }

  /** Reconstruit les cinq surfaces. */
  function reconstruireTout() {
    var geo = geometriePiece();

    ajusterOmbres();

    // Garde-fou d'ensemble : le module en pose un par surface, mais cinq
    // surfaces cumulées peuvent rester lourdes alors qu'aucune ne déborde.
    var estimation = 0;
    surfaces.forEach(function (surface) {
      if (surface.mode !== "carrele" || !surfaceVisible(surface)) return;
      var d = Surfaces.dimensions(surface, dims, geo.murs);
      var aire = surface.largeurCarreau * surface.longueurCarreau;
      if (aire > 0) estimation += (d.longueur * d.largeur) / aire;
    });

    if (estimation > CONFIG.maxCarreauxScene) {
      surfaces.forEach(function (surface) {
        detruireRendu(surface.id);
        if (surfaceVisible(surface)) construireFond(surface, geo);
      });
      Panneau.afficherMetreBrut(
        '<p class="avertissement">Calepinage trop dense sur l\'ensemble de la pièce (~' +
        Math.ceil(estimation).toLocaleString("fr-FR") +
        ' carreaux). Agrandis les formats, réduis la pièce, ou passe des surfaces en couleur unie.</p>'
      );
      majVisibiliteMurs();
      return;
    }

    surfaces.forEach(function (surface) {
      reconstruireSurface(surface, geo, true);
    });

    Panneau.majMetre();
    majVisibiliteMurs();
  }

  /**
   * Masque le mur situé entre la caméra et la pièce, sinon il boucherait la
   * vue dès qu'on la regarde depuis l'extérieur.
   */
  function majVisibiliteMurs() {
    // La caméra active, pas l'orbitale : pendant la visite on est dedans, et
    // tous les murs doivent rester en place.
    var vue = (scene && scene.activeCamera) || camera;
    if (!vue) return;

    var p = vue.position;

    surfaces.forEach(function (surface) {
      if (surface.type !== "mur") return;

      var rendu = rendus[surface.id];
      if (!rendu || !rendu.repere) return;

      var c = rendu.repere.centre;
      var n = rendu.repere.normale;

      // Produit scalaire positif : la caméra est du côté intérieur du mur.
      var cote = (p.x - c[0]) * n[0] + (p.y - c[1]) * n[1] + (p.z - c[2]) * n[2];
      var visible = cote > 0;

      if (rendu.fond) rendu.fond.isVisible = visible;
      if (rendu.carrelage) rendu.carrelage.isVisible = visible;

      /* Les baies de ce mur disparaissent avec lui. Leur lumière, elle, reste
         allumée : elle éclaire la pièce, que la paroi soit affichée ou non. */
      Object.keys(rendusFenetres).forEach(function (identifiant) {
        var baie = rendusFenetres[identifiant];
        if (!baie || baie.mur !== surface.id) return;

        if (baie.vitre) baie.vitre.isVisible = visible;
        if (baie.cadre) baie.cadre.isVisible = visible;
      });
    });
  }

  // --- Environnement extérieur ---------------------------------------------

  /** Vrai si l'extérieur doit être affiché. */
  function exterieurActif() {
    var champ = document.getElementById("exterieur");
    return champ ? champ.checked : true;
  }

  /**
   * Ciel physique. Le soleil y est placé à la main plutôt que par
   * l'inclinaison interne de SkyMaterial : on maîtrise ainsi la correspondance
   * entre l'astre visible et la direction des ombres.
   */
  function construireCiel() {
    if (typeof BABYLON.SkyMaterial === "undefined") {
      afficherErreur(
        "La bibliothèque SkyMaterial n'a pas été chargée : le ciel physique " +
        "est remplacé par un fond uni."
      );
      return;
    }

    materiauCiel = new BABYLON.SkyMaterial("cielMateriau", scene);
    materiauCiel.backFaceCulling = false;
    materiauCiel.turbidity = CONFIG.exterieur.ciel.turbidite;
    materiauCiel.luminance = CONFIG.exterieur.ciel.luminance;
    materiauCiel.useSunPosition = true;

    ciel = BABYLON.MeshBuilder.CreateBox("ciel", { size: 3000 }, scene);
    ciel.material = materiauCiel;
    ciel.isPickable = false;
    // La boîte suit la caméra : on ne doit jamais pouvoir en sortir.
    ciel.infiniteDistance = true;
  }

  /** Place le soleil du ciel d'après l'ambiance et la direction des ombres. */
  function majCiel(reglage) {
    if (!materiauCiel) return;

    var azimut = Eclairage.azimutDepuisDirection(reglage.soleil.direction);
    var position = Eclairage.positionSoleil(reglage.inclinaison, azimut, 1000);

    materiauCiel.sunPosition = BABYLON.Vector3.FromArray(position);
    // Un soleil bas épaissit l'atmosphère traversée.
    materiauCiel.turbidity = CONFIG.exterieur.ciel.turbidite *
      (reglage.inclinaison > 0.5 ? 1.4 : 1.0);
  }

  /** Texture d'herbe : teinte de base nuancée par un bruit doux. */
  function creerTextureHerbe() {
    var reglage = CONFIG.exterieur.sol;
    var taille = 256;

    var canevas = document.createElement("canvas");
    canevas.width = taille;
    canevas.height = taille;

    var contexte = canevas.getContext("2d");
    var image = contexte.createImageData(taille, taille);

    // L'échelle est convertie en un nombre entier de mailles : la texture se
    // répète sur tout le terrain, une couture se verrait.
    var periode = Math.max(1, Math.round(taille * reglage.echelleBruit));

    for (var y = 0; y < taille; y++) {
      for (var x = 0; x < taille; x++) {
        var n = Exterieur.fbm(x / taille, y / taille, periode, 4, 17, 0.6);
        var facteur = 1 + (n - 0.5) * reglage.amplitudeBruit * 2;

        var i = (y * taille + x) * 4;
        image.data[i] = Math.round(Math.min(255, reglage.couleur[0] * 255 * facteur));
        image.data[i + 1] = Math.round(Math.min(255, reglage.couleur[1] * 255 * facteur));
        image.data[i + 2] = Math.round(Math.min(255, reglage.couleur[2] * 255 * facteur));
        image.data[i + 3] = 255;
      }
    }

    contexte.putImageData(image, 0, 0);
    return new BABYLON.Texture(canevas.toDataURL("image/png"), scene);
  }

  /** Terrain herbeux sur lequel la pièce est posée. */
  function construireSolExterieur() {
    if (solExterieur) {
      solExterieur.dispose();
      solExterieur = null;
    }

    var reglage = CONFIG.exterieur.sol;

    solExterieur = BABYLON.MeshBuilder.CreateGround("solExterieur", {
      width: reglage.cote,
      height: reglage.cote,
      subdivisions: 1
    }, scene);

    solExterieur.position.y = reglage.altitude;
    solExterieur.isPickable = false;

    var materiau = new BABYLON.PBRMaterial("herbePBR", scene);
    var texture = creerTextureHerbe();
    var repetitions = reglage.cote / reglage.metresParMaille;
    texture.uScale = repetitions;
    texture.vScale = repetitions;

    materiau.albedoTexture = texture;
    materiau.albedoColor = BABYLON.Color3.White();
    materiau.roughness = reglage.rugosite;
    materiau.metallic = 0;
    materiau.environmentIntensity = 0.6;
    reglerMateriauPBR(materiau);

    solExterieur.material = materiau;
    solExterieur.receiveShadows = true;
  }

  /** Texture d'arbre : tronc et feuillage sur fond transparent. */
  function creerTextureArbre(arbre) {
    var reglage = CONFIG.exterieur.arbres;
    var largeur = reglage.definition.largeur;
    var hauteur = reglage.definition.hauteur;

    var canevas = document.createElement("canvas");
    canevas.width = largeur;
    canevas.height = hauteur;

    var contexte = canevas.getContext("2d");
    var image = contexte.createImageData(largeur, hauteur);

    var hautTronc = 1 - reglage.hauteurTronc;
    var tronc = reglage.couleurTronc;
    var sombre = reglage.feuillageSombre;
    var clair = reglage.feuillageClair;

    for (var y = 0; y < hauteur; y++) {
      for (var x = 0; x < largeur; x++) {
        var u = x / largeur;
        var v = y / hauteur;
        var i = (y * largeur + x) * 4;

        if (v > hautTronc) {
          // Tronc : un simple fût centré, à peine nuancé.
          var demiFut = 0.055;
          if (Math.abs(u - 0.5) < demiFut) {
            var ombre = 0.75 + 0.35 * (1 - Math.abs(u - 0.5) / demiFut);
            image.data[i] = Math.round(tronc[0] * 255 * ombre);
            image.data[i + 1] = Math.round(tronc[1] * 255 * ombre);
            image.data[i + 2] = Math.round(tronc[2] * 255 * ombre);
            image.data[i + 3] = 255;
          } else {
            image.data[i + 3] = 0;
          }
          continue;
        }

        var opacite = Exterieur.feuillage(u, v, reglage.hauteurTronc, arbre.graine);
        if (opacite <= 0.004) {
          image.data[i + 3] = 0;
          continue;
        }

        // Dégradé du sombre en bas vers le clair en haut, plus un grain.
        var grain = Exterieur.fbm(u, v, 9, 3, arbre.graine + 51, 0.6);
        var melange = Math.max(0, Math.min(1,
          (1 - v / hautTronc) * 0.65 + grain * 0.5
        ));

        for (var c = 0; c < 3; c++) {
          var valeur = (sombre[c] + (clair[c] - sombre[c]) * melange) * arbre.teinte;
          image.data[i + c] = Math.round(Math.max(0, Math.min(255, valeur * 255)));
        }
        image.data[i + 3] = Math.round(opacite * 255);
      }
    }

    contexte.putImageData(image, 0, 0);

    var texture = new BABYLON.Texture(canevas.toDataURL("image/png"), scene);
    texture.hasAlpha = true;
    if (arbre.miroir) texture.uScale = -1;

    return texture;
  }

  function detruireArbres() {
    arbres.forEach(function (arbre) {
      if (arbre.maillage) arbre.maillage.dispose();
    });
    arbres = [];
  }

  /** Plante les arbres en billboard autour de la pièce. */
  function construireArbres() {
    detruireArbres();
    if (!exterieurActif()) return;

    var reglage = CONFIG.exterieur.arbres;

    var implantation = Exterieur.arbres(
      { longueur: dims.longueur, largeur: dims.largeur },
      { nombre: reglage.nombre, largeur: reglage.largeur, hauteur: reglage.hauteur }
    );

    implantation.forEach(function (arbre) {
      var maillage = BABYLON.MeshBuilder.CreatePlane("arbre-" + arbre.rang, {
        width: arbre.largeur,
        height: arbre.hauteur
      }, scene);

      // Billboard sur l'axe Y seulement : l'arbre pivote vers la caméra mais
      // reste debout, ce qu'un billboard total ne garantirait pas.
      maillage.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
      maillage.position.set(arbre.x, arbre.hauteur / 2, arbre.z);
      maillage.isPickable = false;
      // Les arbres ne projettent pas d'ombre : trop coûteux pour du décor.
      maillage.receiveShadows = false;

      var materiau = new BABYLON.StandardMaterial("arbre-" + arbre.rang, scene);
      materiau.diffuseTexture = creerTextureArbre(arbre);
      materiau.diffuseTexture.hasAlpha = true;
      materiau.useAlphaFromDiffuseTexture = true;
      // Seuil alpha plutôt que transparence triée : pas d'ordre à gérer entre
      // arbres qui se chevauchent.
      materiau.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
      materiau.alphaCutOff = 0.35;
      materiau.backFaceCulling = false;
      materiau.specularColor = new BABYLON.Color3(0, 0, 0);
      // Feuillage éclairé de façon uniforme : un billboard n'a pas de volume.
      materiau.emissiveColor = new BABYLON.Color3(0.18, 0.20, 0.16);

      maillage.material = materiau;

      arbre.maillage = maillage;
      arbres.push(arbre);
    });
  }

  // --- Modèles 3D : plantes d'entrée et mobilier ---------------------------

  /* Chaque fichier n'est téléchargé qu'une fois. Le modèle reste désactivé
     dans la scène et sert de patron : un canapé posé dix fois ne coûte qu'un
     chargement, et rebâtir la maison n'en coûte aucun.

     Le cache range des promesses, pas des modèles : deux demandes lancées
     avant la première réponse doivent attendre la même, sinon le fichier
     part deux fois sur le réseau. */
  var patrons = {};

  /**
   * Ramène un modèle à des dimensions réelles.
   *
   * Les fichiers arrivent à des échelles sans rapport les unes avec les
   * autres. Rien ne les rattrape sinon la mesure : on prend l'encombrement
   * réel, et on en déduit le facteur qui l'amène aux cotes voulues.
   *
   * ─── Pourquoi les deux cotes au sol ne sont pas assignées par axe ───────
   *
   * `largeur` n'est pas « le X du modèle ». Rien ne dit dans quel sens une
   * baignoire a été modélisée : la même, tournée d'un quart de tour à
   * l'export, sortirait longue de 90 cm et large de 1,80 m. Les deux cotes
   * sont donc appariées par ordre de grandeur — la plus grande sur le plus
   * grand côté — ce qui rend le résultat indifférent au sens de
   * modélisation. La cuvette du test le montre : son long côté est sur Z,
   * celui du canapé marron sur X, et les deux tombent juste.
   *
   * Un axe sans cote prend la moyenne des facteurs posés : c'est ce qui
   * donne au tapis son épaisseur de 2 cm plutôt qu'une hauteur inventée.
   *
   * @param {BABYLON.AbstractMesh|Array} meshes  le modèle, ou ses maillages.
   * @param {number} [cibleLargeur]     m, au sol
   * @param {number} [cibleHauteur]     m
   * @param {number} [cibleProfondeur]  m, au sol
   * @returns {{x, y, z}|null} les facteurs d'échelle, ou null faute de mesure.
   */
  function recalibreMesh(meshes, cibleLargeur, cibleHauteur, cibleProfondeur) {
    var racine = (meshes && meshes.length !== undefined) ? meshes[0] : meshes;
    if (!racine || !racine.getHierarchyBoundingVectors) return null;

    var boite = racine.getHierarchyBoundingVectors(true);
    var mesure = {
      x: boite.max.x - boite.min.x,
      y: boite.max.y - boite.min.y,
      z: boite.max.z - boite.min.z
    };

    var facteur = { x: null, y: null, z: null };

    if (cibleHauteur > 0 && mesure.y > 0) facteur.y = cibleHauteur / mesure.y;

    // Les cotes au sol, de la plus grande à la plus petite.
    var auSol = [];
    if (cibleLargeur > 0) auSol.push(cibleLargeur);
    if (cibleProfondeur > 0) auSol.push(cibleProfondeur);
    auSol.sort(function (a, b) { return b - a; });

    if (auSol.length) {
      var grand = mesure.x >= mesure.z ? "x" : "z";
      var petit = grand === "x" ? "z" : "x";

      if (mesure[grand] > 0) facteur[grand] = auSol[0] / mesure[grand];
      if (auSol.length > 1 && mesure[petit] > 0) {
        facteur[petit] = auSol[1] / mesure[petit];
      }
    }

    // Les axes laissés libres suivent les autres : le modèle garde ses
    // proportions là où on ne lui en impose pas.
    var poses = ["x", "y", "z"].filter(function (a) { return facteur[a] !== null; });
    if (!poses.length) return null;

    var moyenne = poses.reduce(function (t, a) { return t + facteur[a]; }, 0) /
                  poses.length;

    ["x", "y", "z"].forEach(function (a) {
      if (facteur[a] === null) facteur[a] = moyenne;
    });

    return facteur;
  }

  /* Au-delà de ce rapport entre le plus grand et le plus petit facteur, le
     modèle n'est plus mis à l'échelle : il est étiré. */
  var ETIREMENT_MAX = 2;

  /** Les facteurs d'échelle d'un modèle, d'après la table de calibrage. */
  function calibrageDe(meshes, fichier) {
    var cotes = CONFIG.calibrage[fichier];

    if (!cotes) {
      /* Sans cotes, le modèle retombe sur la hauteur par défaut — un mètre,
         quoi qu'il représente. C'est un pis-aller, pas un choix : le dire
         évite qu'un objet arrive à une taille absurde sans qu'on sache
         pourquoi. */
      console.warn("Modèle « " + fichier + " » sans cotes dans " +
        "CONFIG.calibrage : posé à " + CONFIG.modeles.hauteur +
        " m de haut, faute de mieux.");
      return null;
    }

    var facteur = recalibreMesh(meshes, cotes.largeur, cotes.hauteur,
                                cotes.profondeur);
    if (!facteur) return null;

    /* Des cotes qui ne respectent pas les proportions du modèle le
       déforment. C'est souvent le signe qu'il a été modélisé couché ou
       debout — une rotation manque, qu'aucune mise à l'échelle ne remplace.
       Le dire, plutôt que de livrer un objet étiré sans explication. */
    var facteurs = [facteur.x, facteur.y, facteur.z];
    var etirement = Math.max.apply(null, facteurs) /
                    Math.min.apply(null, facteurs);

    if (etirement > ETIREMENT_MAX) {
      console.warn("Calibrage de « " + fichier + " » : étirement ×" +
        etirement.toFixed(1) + ". Ses proportions ne sont pas celles " +
        "demandées — il lui manque sans doute une rotation.");
    }

    return facteur;
  }

  /* Les modèles du décor de démonstration : la rue et ce qui la borde. Ils
     ne sont ni du mobilier ni du bâti, seulement le contexte autour de la
     maison — et rien de ce qu'ils portent n'a de raison de briller. */
  var DECOR_MAT = ["route.glb", "parking.glb", "Arbre.glb"];

  /**
   * Ôte le brillant des matériaux d'un modèle de décor.
   *
   * Ces fichiers viennent de bibliothèques en ligne, avec les réglages de la
   * scène où ils ont été faits. La voirie de route.glb arrivait à 40 % de
   * métal pour une rugosité de 0,23 : sous un HDRI photographique, elle
   * renvoyait le studio comme une flaque. Un enrobé ne réfléchit rien.
   *
   * Le mobilier, lui, n'est pas touché : un robinet ou un miroir ont le droit
   * de briller, et c'est au fichier de le dire.
   */
  function materDecor(maillages, fichier) {
    if (DECOR_MAT.indexOf(fichier) === -1) return;

    (maillages || []).forEach(function (maillage) {
      var materiau = maillage && maillage.material;
      if (!materiau || materiau.metallic === undefined) return;

      materiau.metallic = 0;
      materiau.roughness = 0.9;
    });
  }

  /**
   * Charge un modèle GLB de modeles-3d/, ou rend null s'il ne vient pas.
   *
   * @param {string} fichier  nom de fichier, accents et espaces compris.
   * @returns {Promise<{noeud, basse, hauteur}|null>}
   */
  function chargerModele(fichier) {
    if (patrons[fichier]) return patrons[fichier];

    if (!BABYLON.SceneLoader) {
      console.warn("Modèles 3D : le chargeur glTF n'est pas là.");
      return Promise.resolve(null);
    }

    patrons[fichier] = new Promise(function (resoudre) {
      BABYLON.SceneLoader.ImportMesh(
        "",
        CONFIG.baseRessources + CONFIG.modeles.dossier,
        // Espaces, accents et apostrophes sont courants dans ces noms : sans
        // encodage, l'URL se coupe au premier caractère réservé.
        encodeURIComponent(fichier),
        scene,
        function (maillages) {
          var racine = maillages[0];
          if (!racine) { resoudre(null); return; }

          materDecor(maillages, fichier);

          /* L'encombrement se mesure avant de désactiver : il donne le
             facteur d'échelle, et le modèle peut faire n'importe quelle
             taille — c'est la hauteur voulue qui commande, pas la sienne. */
          var boite = racine.getHierarchyBoundingVectors(true);
          var hauteur = boite.max.y - boite.min.y;

          /* L'échelle se calcule avant de désactiver, et une seule fois :
             elle ne dépend que du fichier, pas de l'endroit où on le pose. */
          var echelle = calibrageDe(racine, fichier);

          racine.setEnabled(false);

          resoudre((hauteur > 0)
            ? {
                noeud: racine,
                basse: boite.min.y,
                hauteur: hauteur,
                echelle: echelle,
                /* Un fichier peut être un catalogue plutôt qu'un objet :
                   route.glb tient six pièces de voirie côte à côte. Les
                   garder nommées permet d'en poser une seule. */
                pieces: maillages
              }
            : null);
        },
        null,
        function (scene, message) {
          /* Le cas le plus courant : la page ouverte en file://, où le
             navigateur refuse la requête. Les textures passent, elles, par
             des balises image — d'où une scène qui semble complète, moins
             ses modèles. */
          console.warn("Modèle « " + fichier + " » : chargement impossible. " +
            (message || "") +
            " (une page ouverte en file:// ne peut pas lire de .glb ; " +
            "lancez node outils/serveur.js.)");
          resoudre(null);
        }
      );
    });

    return patrons[fichier];
  }

  /**
   * Pose une copie d'un patron au sol, à la position voulue.
   *
   * L'échelle et la position vont sur un socle parent, jamais sur la copie :
   * le chargeur glTF range dans la racine du modèle le passage au repère
   * main-gauche, et l'écraser retournerait l'objet.
   *
   * @returns {BABYLON.TransformNode|null} le socle, à disposer pour retirer.
   */
  function poserModele(patron, nom, x, z, hauteurVoulue) {
    if (!patron) return null;

    /* La table de calibrage l'emporte : elle porte les cotes réelles du
       modèle, mesurées une fois pour toutes. La hauteur voulue ne sert que
       pour les fichiers qu'elle ne connaît pas — et pour qui il faut bien
       choisir quelque chose. */
    var echelle = patron.echelle ||
                  ((hauteurVoulue > 0 ? hauteurVoulue : CONFIG.modeles.hauteur) /
                   patron.hauteur);

    return poserCopie(patron.noeud, nom, x, z, echelle, patron.basse);
  }

  /**
   * Pose la copie d'un nœud au sol, à l'échelle donnée.
   *
   * `basse` est l'ordonnée du bas du modèle avant mise à l'échelle ; passée
   * à null, elle est mesurée sur place — ce qu'il faut quand on copie une
   * pièce d'un catalogue, dont on ne connaît pas l'assise d'avance.
   *
   * `echelle` est un nombre, ou trois facteurs {x, y, z} quand le modèle
   * doit être ramené à des cotes qui ne respectent pas ses proportions.
   *
   * @returns {BABYLON.TransformNode|null} le socle, à disposer pour retirer.
   */
  function poserCopie(source, nom, x, z, echelle, basse) {
    if (!source) return null;

    var facteur = (typeof echelle === "number")
      ? { x: echelle, y: echelle, z: echelle }
      : echelle;

    if (!facteur || !(facteur.y > 0)) return null;

    var copie = source.clone(nom);
    if (!copie) return null;

    copie.setEnabled(true);
    /* Une pièce prise dans un catalogue porte sa place dans la planche : la
       laisser décalerait la copie d'autant. Sa rotation et son échelle
       propres, elles, restent — c'est là que le chargeur glTF range le
       passage au repère main-gauche. */
    copie.position.set(0, 0, 0);

    var socle = new BABYLON.TransformNode(nom + "-socle", scene);
    copie.parent = socle;

    socle.scaling.set(facteur.x, facteur.y, facteur.z);
    socle.position.set(x, 0, z);

    socle.computeWorldMatrix(true);
    copie.computeWorldMatrix(true);
    var boite = copie.getHierarchyBoundingVectors(true);

    if (basse === null || basse === undefined) {
      // Mesurer après coup : le monde est le seul repère où l'assise se lit.
      basse = boite.min.y / facteur.y;
    }

    /* Le modèle se recentre sur le socle, horizontalement. Rien ne garantit
       que son origine soit en son milieu — et un objet qui tourne autour
       d'un point qu'il ne contient pas décrit un arc au lieu de pivoter sur
       place. Le socle devient donc son axe. */
    if (facteur.x !== 0 && facteur.z !== 0) {
      copie.position.x -= ((boite.min.x + boite.max.x) / 2 - x) / facteur.x;
      copie.position.z -= ((boite.min.z + boite.max.z) / 2 - z) / facteur.z;
    }

    // Le bas du modèle descend à zéro : il se pose au sol, il n'y flotte pas.
    socle.position.y = -basse * facteur.y;

    var morceaux = copie.getChildMeshes().concat(
      copie.getTotalVertices && copie.getTotalVertices() ? [copie] : []
    );

    morceaux.forEach(function (m) {
      m.receiveShadows = true;
      if (generateurOmbres) generateurOmbres.addShadowCaster(m);

      /* Sourd au clic par défaut. Le décor — plantes du seuil, voirie — n'a
         pas à répondre : le viser ne veut rien dire. Seul le mobilier posé à
         la main s'y ouvre, et `rendrePreneur` s'en charge. */
      m.isPickable = false;
    });

    socle.metadata = { morceaux: morceaux };
    return socle;
  }

  /**
   * Rend un objet posé sensible au clic, et signe ses maillages.
   *
   * Sans la signature, un clic sur un canapé serait cherché parmi les murs.
   * Avec elle, chaque maillage sait à quel objet il appartient, et le clic
   * remonte au socle en une fois — quel que soit le morceau touché.
   */
  function rendrePreneur(socle) {
    if (!socle || !socle.metadata) return socle;

    socle.metadata.morceaux.forEach(function (m) {
      m.isPickable = true;
      m.metadata = m.metadata || {};
      m.metadata.mobilier = socle;
    });

    return socle;
  }

  // --- Décor de démonstration ----------------------------------------------

  /* Ce qui n'habille que la scène d'accueil — la voirie — pend d'un seul
     nœud. Il suffit de le disposer pour que rien n'en reste, et c'est ce qui
     arrive dès qu'un plan de l'utilisateur paraît : sa maison à lui n'a
     aucune raison d'hériter de la rue d'une vitrine.

     Les plantes du seuil n'en sont pas. Elles encadrent l'entrée de toute
     maison qui en marque une, et suivent la leur d'elles-mêmes.

     `demoAutorisee` retient la décision. Sans elle, la première
     reconstruction de la maison — un mur repeint suffit — reposerait la
     route que l'ouverture d'un plan venait d'effacer. */
  var decorDemo = null, demoAutorisee = true;

  function groupeDecorDemo() {
    if (!decorDemo || decorDemo.isDisposed()) {
      decorDemo = new BABYLON.TransformNode("decor-demo", scene);
    }
    return decorDemo;
  }

  /**
   * Efface le décor de démonstration.
   *
   * @param {boolean} definitif  vrai quand un plan de l'utilisateur prend la
   *   main : le décor ne doit alors plus jamais revenir.
   */
  function effacerDecorDemo(definitif) {
    if (decorDemo && !decorDemo.isDisposed()) decorDemo.dispose();
    decorDemo = null;

    // Les plantes ne sont pas touchées : elles appartiennent à la maison,
    // pas à la vitrine, et se refont avec elle.
    if (definitif) demoAutorisee = false;
  }

  // --- Plantes d'entrée ----------------------------------------------------

  /* `jetonPlante` compte les demandes. Un chargement est asynchrone ; sans ce
     compteur, la réponse d'une maison effacée entre-temps viendrait poser ses
     plantes devant une porte qui n'existe plus. */
  var plantes = [], jetonPlante = 0;

  function detruirePlantes() {
    plantes.forEach(function (noeud) {
      if (!noeud.isDisposed()) noeud.dispose();
    });
    plantes = [];
  }

  /**
   * Pose deux plantes de part et d'autre de la porte d'entrée, dehors.
   *
   * L'entrée donne tout : son centre, et le côté qui mène à la rue. Le
   * décalage latéral se prend sur la perpendiculaire — un quart de tour du
   * vecteur qui pointe vers le dehors.
   */
  function construirePlantesEntree() {
    detruirePlantes();

    var demande = ++jetonPlante;

    /* Les plantes ne sont pas un décor de vitrine : elles encadrent l'entrée
       de toute maison qui en marque une, celle de l'utilisateur comprise.
       Elles suivent la maison d'elles-mêmes — cette fonction se rappelle à
       chaque construction, et commence par ôter les précédentes. */
    var entree = maison && departDevantEntree();
    if (!entree || !entree.porte || !exterieurActif()) return;

    var reglage = CONFIG.planteEntree;

    chargerModele(reglage.fichier).then(function (patron) {
      // La maison a pu changer, ou disparaître, pendant le téléchargement.
      if (!patron || demande !== jetonPlante) return;

      var centre = entree.porte.centre;
      var dehors = entree.porte.dehors;
      var cote = [-dehors[1], dehors[0]];

      // Le seuil, avancé de son retrait vers la rue.
      var seuil = [
        centre[0] + dehors[0] * reglage.retrait,
        centre[1] + dehors[1] * reglage.retrait
      ];

      [-1, 1].forEach(function (sens, rang) {
        // La taille vient de la table de calibrage, comme pour tout modèle.
        var socle = poserModele(
          patron, "plante-entree-" + rang,
          seuil[0] + cote[0] * reglage.ecart * sens,
          seuil[1] + cote[1] * reglage.ecart * sens
        );

        if (socle) plantes.push(socle);
      });
    });
  }

  // --- Route de démonstration ----------------------------------------------

  /**
   * Pose une route le long de la façade est, en pièces jointives.
   *
   * route.glb n'est pas une route : c'est une planche de six pièces de
   * voirie posées côte à côte — droite, virage, carrefour, T. On n'en copie
   * donc qu'une, la section droite, autant de fois qu'il faut.
   *
   * Elle sert à sa taille : deux mètres de côté, ce qui fait une voie de
   * desserte plausible et couvre la façade avec trois ou quatre sections. La
   * mettre à l'échelle d'une départementale demanderait des sections de six
   * mètres, et il en faudrait alors une seule pour dépasser la maison.
   *
   * Le sens de la chaussée n'a pas à être corrigé : la section court sur son
   * axe Y local, que la rotation rangée dans le fichier couche sur le Z du
   * monde. Elle longe donc le nord-sud d'elle-même.
   */
  function construireRouteDemo() {
    if (!demoAutorisee || !maison || !maison.contour || !exterieurActif()) return;

    var reglage = CONFIG.routeDemo;
    var demande = ++jetonPlante;

    chargerModele(reglage.fichier).then(function (patron) {
      if (!patron || !demoAutorisee || demande !== jetonPlante) return;

      var cotes = CONFIG.calibrage[reglage.fichier] || {};

      var section = (patron.pieces || []).filter(function (m) {
        return m.name === cotes.piece;
      })[0];

      if (!section) {
        console.warn("Route : pièce « " + cotes.piece + " » absente de " +
          reglage.fichier + ".");
        return;
      }

      /* La section se calibre elle-même : la boîte du fichier décrit la
         planche entière, pas une pièce. Six mètres de large, c'est une
         chaussée à deux voies — et la section étant carrée, elle en mesure
         autant en longueur, ce qui donne le pas de la file. */
      var echelle = recalibreMesh(section, cotes.largeur);
      if (!echelle) return;

      var mesure = section.getHierarchyBoundingVectors(true);
      var pas = (mesure.max.z - mesure.min.z) * echelle.z;
      var largeur = (mesure.max.x - mesure.min.x) * echelle.x;

      if (!(pas > 0)) return;

      var bb = Plan.boiteEnglobante(maison.contour);
      var centre = centreEmprise(maison.contour);

      /* La chaussée se range à l'est, son bord à `ecart` du mur. Son axe
         tombe donc une demi-largeur plus loin. */
      var x = centre[0] + bb.longueur / 2 + reglage.ecart + largeur / 2;

      /* Elle traverse le terrain de part en part, du bord nord au bord sud.
         Le compte se déduit de l'un et de l'autre : une route qui s'arrête
         au milieu de l'herbe n'est pas une route, c'est un tronçon.

         Le terrain est centré sur l'origine — c'est là que Babylon pose un
         `CreateGround` — et la chaussée l'est donc aussi, sans égard pour la
         maison, qui n'occupe qu'une fraction de sa longueur. */
      var terrain = CONFIG.exterieur.sol.cote;
      var sections = Math.ceil(terrain / pas);
      var depart = -(sections - 1) * pas / 2;

      /* L'assise ne se mesure qu'une fois. Toutes les sections sont la même
         pièce à la même échelle : cinquante mesures de boîte englobante
         coûteraient cinquante matrices monde pour un seul résultat. */
      var basse = null;

      for (var i = 0; i < sections; i++) {
        var socle = poserCopie(section, "route-demo-" + i,
                               x, depart + i * pas, echelle, basse);
        if (!socle) continue;

        if (basse === null) basse = -socle.position.y / echelle.y;
        socle.parent = groupeDecorDemo();
      }
    });
  }

  // --- Mobilier posé à la main ---------------------------------------------

  /* Les meubles ne tiennent pas à la maison : ils survivent à ses
     reconstructions, et ne s'effacent qu'à la demande. C'est ce qui permet
     de meubler, puis de retoucher les murs sans tout replacer. */
  var mobilierScene = [];
  var modeleArme = null;

  // L'objet désigné, et le halo qui le montre.
  var selection = null, surlignageMobilier = null;

  /* Le clavier de la caméra orbitale est-il en place ? Il l'est au départ —
     `attachControl` monte toutes les entrées — et se retire le temps qu'un
     meuble soit désigné, pour que les flèches ne servent qu'à lui. */
  var clavierCameraActif = true;

  /* Le pas d'une poussée et celui d'un quart de tour. Dix centimètres : de
     quoi ajuster sans reprendre le clic, assez pour se voir. Quinze degrés :
     vingt-quatre positions sur un tour, dont les angles droits. */
  var PAS_MOBILIER = 0.10;    // m
  var PAS_ROTATION = Math.PI / 12;   // 15°

  /** Le modèle en attente d'un clic, ou null. */
  function mobilierArme() {
    return modeleArme;
  }

  /**
   * Arme la pose : le prochain clic au sol posera ce modèle.
   * Le repasser au même fichier désarme — un second clic sur le bouton
   * renonce, comme partout ailleurs dans cette interface.
   */
  function armerModele(fichier) {
    modeleArme = (fichier && fichier !== modeleArme) ? fichier : null;
    if (canvas) canvas.style.cursor = modeleArme ? "copy" : "";
    return modeleArme;
  }

  /**
   * Pose un modèle au sol, à la position donnée en mètres.
   *
   * @param {string} fichier  nom du .glb dans modeles-3d/.
   * @param {number} x, z     position au sol, en mètres.
   * @param {number} [hauteur] hauteur voulue, en mètres.
   * @returns {Promise<boolean>} vrai si le meuble est posé.
   */
  /**
   * Un mur occupe-t-il ce point du sol ?
   *
   * On lit les boîtes englobantes de la maçonnerie bâtie, en plan. Les
   * marches et la rampe partagent la même liste sans porter de numéro de
   * mur : elles ne comptent pas.
   */
  function murAuPoint(x, z) {
    var murs = rendusMaison.murs || [];

    for (var i = 0; i < murs.length; i++) {
      var m = murs[i];
      if (m.isDisposed() || !m.metadata || m.metadata.mur === undefined) continue;

      var b = m.getBoundingInfo().boundingBox;
      if (x >= b.minimumWorld.x && x <= b.maximumWorld.x &&
          z >= b.minimumWorld.z && z <= b.maximumWorld.z) {
        return true;
      }
    }

    return false;
  }

  /**
   * Pose un modèle au sol, à la position donnée en mètres.
   *
   * @param {string} fichier  nom du .glb dans modeles-3d/.
   * @param {number} x, z     position au sol, en mètres.
   * @param {Object} [options]
   *   angle       orientation autour de Y, en radians
   *   restaurer   vrai quand la pose vient du stockage : le contrôle des
   *               murs est alors levé, et rien n'est réenregistré.
   * @returns {Promise<boolean|Object>} vrai si posé, sinon un motif.
   */
  function placerModele(fichier, x, z, options) {
    var o = options || {};

    /* Un meuble dans un mur n'est pas un meuble mal placé, c'est un meuble
       invisible : la maçonnerie le recouvre, et le clic qui le reprendrait
       accroche le mur avant lui. Mieux vaut refuser la pose.

       Sauf en relecture : ce meuble-là a déjà été posé une fois, et la
       maison qui l'entoure n'est peut-être pas celle d'alors. Le refuser
       reviendrait à le perdre en silence. */
    if (!o.restaurer && murAuPoint(x, z)) {
      return Promise.resolve({ refus: "mur" });
    }

    return chargerModele(fichier).then(function (patron) {
      if (!patron) return false;

      var socle = poserModele(
        patron, "mobilier-" + mobilierScene.length + "-" + fichier, x, z
      );

      if (!socle) return false;

      /* Le meuble se pose sur le carrelage, pas sur le fond de joint. Les
         carreaux affleurent à `carreau.hauteur` au-dessus de zéro : un objet
         calé sur zéro s'y enfonce d'autant. Sur un canapé de 85 cm cela ne
         se voit pas ; sur un tapis de 2 cm, il disparaît à moitié sous le
         sol — c'est là que le défaut se remarque. */
      socle.position.y += CONFIG.carreau.hauteur;

      if (o.angle) socle.rotation.y = o.angle;

      /* Le fichier voyage avec l'objet : c'est tout ce qu'il faut pour le
         reposer plus tard, le reste — échelle, assise — se recalcule. */
      socle.metadata.fichier = fichier;

      // Posé à la main, donc repris à la main : celui-là répond au clic.
      rendrePreneur(socle);
      mobilierScene.push(socle);

      if (!o.restaurer) enregistrerMobilier();
      return true;
    });
  }

  // --- Le mobilier survit au rechargement ----------------------------------

  /* Une page rechargée perd tout ce que la mémoire tenait. Le mobilier n'est
     pas du travail jetable : on le retrouve où on l'avait laissé.

     Le stockage local suffit — c'est le seul qui traverse un rechargement
     sans serveur ni geste de l'utilisateur. La clé API, elle, continue de
     n'y aller jamais : une position de canapé n'est pas un secret. */
  var STOCKAGE_MOBILIER = "catalogue3d.mobilier";
  var FORMAT_MOBILIER = 1;

  /**
   * Ce qu'on retient d'un meuble : de quoi le reposer, et rien de plus.
   *
   * Ni l'échelle ni l'assise n'y figurent : elles se déduisent du fichier et
   * de la table de calibrage. Les y écrire les figerait au jour de la pose,
   * et un modèle recalibré depuis reviendrait à son ancienne taille.
   */
  function enregistrerMobilier() {
    if (typeof localStorage === "undefined") return false;

    var liste = mobilierScene
      .filter(function (s) { return !s.isDisposed() && s.metadata.fichier; })
      .map(function (s) {
        return {
          fichier: s.metadata.fichier,
          x: +s.position.x.toFixed(4),
          z: +s.position.z.toFixed(4),
          angle: +(s.rotation.y || 0).toFixed(5)
        };
      });

    try {
      localStorage.setItem(STOCKAGE_MOBILIER, JSON.stringify({
        format: FORMAT_MOBILIER,
        meubles: liste
      }));
      return true;
    } catch (e) {
      /* Navigation privée, quota plein : le mobilier reste à l'écran, il ne
         survivra simplement pas au rechargement. Le dire une fois. */
      console.warn("Mobilier : enregistrement impossible (" + e.message + ").");
      return false;
    }
  }

  /** Ce que le stockage retient, ou une liste vide. */
  function relireMobilier() {
    if (typeof localStorage === "undefined") return [];

    var brut;
    try {
      brut = localStorage.getItem(STOCKAGE_MOBILIER);
    } catch (e) {
      return [];
    }
    if (!brut) return [];

    var range;
    try {
      range = JSON.parse(brut);
    } catch (e) {
      console.warn("Mobilier : enregistrement illisible, ignoré.");
      return [];
    }

    // Un format inconnu vient d'une version ultérieure : on le laisse.
    if (!range || range.format !== FORMAT_MOBILIER) return [];

    return (range.meubles || []).filter(function (m) {
      return m && typeof m.fichier === "string" &&
             isFinite(m.x) && isFinite(m.z);
    });
  }

  /**
   * Repose le mobilier retenu au dernier passage.
   *
   * Les poses s'enchaînent plutôt que de partir ensemble : chacune numérote
   * son socle sur la longueur de la liste, et deux poses simultanées
   * porteraient le même nom.
   *
   * @returns {Promise<number>} le nombre de meubles remis en place.
   */
  function restaurerMobilier() {
    var retenus = relireMobilier();
    if (!retenus.length) return Promise.resolve(0);

    var poses = 0;

    return retenus.reduce(function (suite, meuble) {
      return suite.then(function () {
        return placerModele(meuble.fichier, meuble.x, meuble.z, {
          angle: meuble.angle,
          restaurer: true
        }).then(function (fait) { if (fait === true) poses++; });
      });
    }, Promise.resolve()).then(function () {
      /* Réécrire après coup : un modèle disparu du dossier ne se repose pas,
         et l'enregistrement doit refléter ce qui est réellement là. */
      if (poses !== retenus.length) enregistrerMobilier();

      if (poses) Panneau.majMobilier(poses + " meuble" +
        (poses > 1 ? "s remis" : " remis") + " en place.");

      return poses;
    });
  }

  /**
   * Ce qu'il y a à dire d'une pose, en un mot.
   *
   * @param {boolean|Object} pose  le retour de `placerModele`.
   * @returns {string} vide quand tout s'est bien passé.
   */
  function compteRenduPose(pose, fichier) {
    if (pose === true) return "";

    if (pose && pose.refus === "mur") {
      return "Position invalide — trop proche d'un mur.";
    }

    return "« " + fichier + " » n'a pas pu être chargé.";
  }

  /** Retire tout le mobilier posé. Les plantes d'entrée n'en sont pas. */
  function viderMobilier() {
    selectionnerMobilier(null);
    mobilierScene.forEach(function (socle) { socle.dispose(); });
    mobilierScene = [];

    // Vidé pour de bon : le rechargement ne doit pas le ramener.
    enregistrerMobilier();
    return true;
  }

  // --- Manipuler un meuble posé --------------------------------------------

  /**
   * Désigne un meuble, ou n'en désigne aucun.
   *
   * Le halo est refait à chaque fois plutôt qu'entretenu : une couche de
   * surlignage garde des références sur les maillages qu'on lui confie, et
   * un meuble supprimé y laisserait un fantôme.
   */
  /**
   * Coupe ou rend le clavier de la caméra orbitale.
   *
   * Les flèches lui appartiennent autant qu'au meuble désigné, et Babylon
   * les écoute sur le canvas — donc avant tout gestionnaire posé sur la
   * fenêtre. Un `preventDefault` arriverait trop tard : quand il s'exécute,
   * la caméra a déjà pris le sien. Il faut lui retirer l'oreille.
   *
   * Seule l'entrée clavier est détachée : la souris continue de tourner et
   * de zoomer pendant qu'on pousse un meuble, ce qui est bien commode pour
   * juger de sa place.
   */
  function clavierCamera(actif) {
    /* Ne rien faire deux fois. Un clic dans le vide relâche la sélection,
       donc rend le clavier — et il y en a beaucoup. Ré-attacher une entrée
       déjà attachée empilerait les écouteurs, et chaque flèche ferait
       tourner la caméra d'autant de crans qu'on a cliqué. */
    if (actif === clavierCameraActif) return;

    var entree = camera && camera.inputs && camera.inputs.attached &&
                 camera.inputs.attached.keyboard;
    if (!entree) return;

    try {
      if (actif) entree.attachControl();
      else entree.detachControl();
      clavierCameraActif = actif;
    } catch (e) {
      /* Version de Babylon sans ces méthodes : on s'en passe, comme le fait
         déjà la visite immersive au même endroit. */
    }
  }

  function selectionnerMobilier(socle) {
    if (surlignageMobilier) {
      surlignageMobilier.dispose();
      surlignageMobilier = null;
    }

    selection = (socle && !socle.isDisposed()) ? socle : null;

    /* Un seul endroit décide, et tous les chemins y passent : la croix,
       Échap, le clic dans le vide, la corbeille, le vidage d'ensemble. La
       caméra ne peut donc pas rester sourde après coup.

       Une volée d'escalier ne se pousse pas aux flèches : elles restent donc
       à la caméra: la lui retirer les rendrait mortes des deux côtés. */
    clavierCamera(!selection || !!escalierSelectionne());

    if (selection) {
      surlignageMobilier = new BABYLON.HighlightLayer("surlignage-mobilier", scene);
      var bleu = couleurBabylon(CONFIG.mobilier.surlignage);

      selection.metadata.morceaux.forEach(function (m) {
        if (!m.isDisposed()) surlignageMobilier.addMesh(m, bleu);
      });
    }

    majOutilsMobilier();
    return selection;
  }

  /** Le meuble désigné, ou null. */
  function mobilierSelectionne() {
    return selection;
  }

  /**
   * Pousse le meuble désigné, dans le repère de la caméra.
   *
   * « Gauche » veut dire la gauche de l'écran, pas le −X du monde. La caméra
   * tourne autour de la scène : rapporter les flèches aux axes du monde
   * ferait avancer l'objet vers soi une fois sur quatre, sans qu'on
   * comprenne pourquoi.
   *
   * ─── Le sens de la droite, en repère main-gauche ────────────────────────
   *
   * `droite = haut ∧ avant`, soit (f.z, 0, −f.x). Le signe se vérifie sur le
   * cas connu : la caméra par défaut est posée en alpha = −π/2, donc du côté
   * des Z négatifs, et regarde vers le +Z. Sa droite doit être le +X — ce
   * que la formule donne, et que son opposée donnait à l'envers. C'est le
   * bug qu'on corrige ici : les flèches horizontales étaient inversées.
   *
   * L'axe de la profondeur, lui, était juste : depuis cette même caméra,
   * pousser « vers le fond » éloigne vers le +Z, et non vers le −Z.
   *
   * @param {number} deLaDroite  −1 vers la gauche de l'écran, +1 vers sa droite
   * @param {number} duFond      −1 vers soi, +1 vers le fond
   */
  function deplacerMobilier(deLaDroite, duFond) {
    // Une volee se regle, elle ne se pousse pas : sa zone tracee la place.
    if (!selection || escalierSelectionne()) return false;

    var vue = scene && scene.activeCamera;
    if (!vue) return false;

    // La direction du regard, rabattue au sol : on pousse sur le plan, pas
    // dans la pente du regard.
    var avant = vue.getTarget().subtract(vue.position);
    avant.y = 0;

    if (avant.lengthSquared() < 1e-6) avant = new BABYLON.Vector3(0, 0, 1);
    avant.normalize();

    // La droite de l'écran : haut ∧ avant, en repère main-gauche.
    var droite = new BABYLON.Vector3(avant.z, 0, -avant.x);

    selection.position.x +=
      (droite.x * deLaDroite + avant.x * duFond) * PAS_MOBILIER;
    selection.position.z +=
      (droite.z * deLaDroite + avant.z * duFond) * PAS_MOBILIER;

    majOutilsMobilier();
    enregistrerMobilier();
    return true;
  }

  /** Fait pivoter le meuble désigné d'un quart de pas, sur place. */
  function pivoterMobilier(sens) {
    if (!selection || escalierSelectionne()) return false;

    selection.rotation.y += PAS_ROTATION * (sens < 0 ? -1 : 1);
    majOutilsMobilier();
    enregistrerMobilier();
    return true;
  }

  /** Retire le meuble désigné. */
  function supprimerMobilier() {
    /* Une volee s'efface en effacant sa zone, sur le plan : la retirer ici
       la ferait revenir au prochain assemblage. */
    if (!selection || escalierSelectionne()) return false;

    var parti = selection;
    selectionnerMobilier(null);

    mobilierScene = mobilierScene.filter(function (s) { return s !== parti; });
    parti.dispose();

    enregistrerMobilier();
    return true;
  }

  /**
   * Le point du sol visé par un événement de pointeur, en mètres.
   *
   * Le sol et le carrelage ne sont pas cliquables — un clic dessus doit
   * choisir une surface, pas la traverser. On ne peut donc pas s'appuyer sur
   * un lancer de rayon contre eux : on coupe le rayon de la caméra sur le
   * plan mathématique y = 0, qui existe toujours, même sans maison.
   *
   * @returns {[number, number]|null} null si le rayon fuit vers le ciel.
   */
  function solVise(x, y) {
    if (!scene || !scene.activeCamera) return null;

    var rayon = scene.createPickingRay(x, y, BABYLON.Matrix.Identity(),
                                       scene.activeCamera);

    var distance = rayon.intersectsPlane(
      BABYLON.Plane.FromPositionAndNormal(
        BABYLON.Vector3.Zero(), new BABYLON.Vector3(0, 1, 0)
      )
    );

    // Négatif : le plan est derrière la caméra. Null : le rayon est parallèle.
    if (distance === null || distance === undefined || distance < 0) return null;

    var point = rayon.origin.add(rayon.direction.scale(distance));
    return [point.x, point.z];
  }

  /**
   * Clic dans la scène : poser le meuble armé.
   *
   * On écoute le « tap » plutôt que l'appui, comme la sélection de mur :
   * Babylon ne le déclenche qu'en l'absence de glissement, ce qui laisse la
   * caméra orbiter sans semer un meuble à chaque tour.
   */
  function brancherPoseMobilier() {
    if (!scene) return;

    scene.onPointerObservable.add(function (info) {
      if (info.type !== BABYLON.PointerEventTypes.POINTERTAP) return;
      if (Visite.active()) return;

      // 1. Un modèle armé attend ce clic : il passe avant tout.
      if (modeleArme) {
        var point = solVise(scene.pointerX, scene.pointerY);
        if (!point) return;

        var fichier = modeleArme;

        /* Un armement, une pose. Sans cela, le clic suivant — pour orbiter,
           pour choisir un mur — en sèmerait un second sans qu'on l'ait
           demandé. */
        armerModele(null);

        placerModele(fichier, point[0], point[1]).then(function (pose) {
          Panneau.majMobilier(compteRenduPose(pose, fichier));
        });
        return;
      }

      /* 2. Sinon, le clic désigne — ou libère. Le meuble touché se lit dans
         la marque de son maillage ; ailleurs, la sélection tombe. */
      var touche = info.pickInfo;
      var marque = (touche && touche.hit && touche.pickedMesh)
        ? touche.pickedMesh.metadata
        : null;

      /* Un mur ne libère pas la sélection. Un meuble posé contre une cloison
         se vise mal : le rayon accroche la maçonnerie avant l'objet, et le
         panneau se refermait sous les doigts à chaque tentative. Ce clic-là
         ne dit rien du mobilier — on le laisse passer sans conclure. */
      if (marque && marque.mur !== undefined) return;

      selectionnerMobilier((marque && marque.mobilier) || null);
    });
  }

  /**
   * Le clavier, quand un meuble est désigné.
   *
   * Les flèches sont aussi celles de la visite immersive, et le plan porte
   * les siennes : on se tait dès que l'un des deux a la main, et dès que le
   * curseur est dans un champ de saisie — sinon taper une largeur de pièce
   * déplacerait un canapé.
   */
  function brancherClavierMobilier() {
    window.addEventListener("keydown", function (e) {
      if (!selection || Visite.active()) return;

      var actif = document.activeElement;
      if (actif && /^(INPUT|TEXTAREA|SELECT)$/.test(actif.tagName)) return;

      var fait = true;

      switch (e.key) {
        case "ArrowLeft":  deplacerMobilier(-1, 0); break;
        case "ArrowRight": deplacerMobilier(1, 0); break;
        case "ArrowUp":    deplacerMobilier(0, 1); break;
        case "ArrowDown":  deplacerMobilier(0, -1); break;
        case "r": case "R": pivoterMobilier(1); break;
        case "Delete": case "Backspace": supprimerMobilier(); break;
        case "Escape": selectionnerMobilier(null); break;
        default: fait = false;
      }

      // Les flèches font défiler la page, Retour arrière remonte d'un cran
      // dans l'historique : ni l'un ni l'autre pendant qu'on meuble.
      if (fait) e.preventDefault();
    });
  }

  // --- Panneau flottant du meuble désigné ----------------------------------

  var outilsMobilier = null;

  /** Câble les boutons du panneau flottant. Une seule fois. */
  function brancherOutilsMobilier() {
    outilsMobilier = document.getElementById("mobilier-outils");
    if (!outilsMobilier) return;

    var gestes = {
      gauche:   function () { deplacerMobilier(-1, 0); },
      droite:   function () { deplacerMobilier(1, 0); },
      avant:    function () { deplacerMobilier(0, 1); },
      arriere:  function () { deplacerMobilier(0, -1); },
      antihoraire: function () { pivoterMobilier(-1); },
      horaire:  function () { pivoterMobilier(1); },
      supprimer: function () { supprimerMobilier(); },
      /* Fermer n'est pas supprimer. On lâche l'objet — le halo s'éteint, la
         palette se retire — et il reste exactement où il est. C'est aussi ce
         que fait Échap. */
      fermer:   function () { selectionnerMobilier(null); }
    };

    outilsMobilier.addEventListener("click", function (e) {
      var bouton = e.target;
      while (bouton && bouton !== outilsMobilier && !bouton.getAttribute("data-geste")) {
        bouton = bouton.parentNode;
      }
      if (!bouton || bouton === outilsMobilier) return;

      var geste = gestes[bouton.getAttribute("data-geste")];
      if (geste) geste();
    });

    /* Le panneau flotte au-dessus du canvas : sans cela, cliquer une flèche
       traverserait jusqu'à la scène, qui y verrait un clic à côté et
       lâcherait la sélection au premier appui. */
    outilsMobilier.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
    });
  }

  // --- Réglages d'une volée d'escalier -------------------------------------

  /* Un escalier n'est pas un meuble : il naît d'une zone tracée sur le plan,
     et ses cotes se règlent au lieu de se déplacer. La palette de
     déplacement n'aurait aucun sens sur lui — pousser une volée d'un
     centimètre reviendrait à déplacer sa zone, ce qui est un autre geste. */
  var reglagesEscalier = null, champsEscalier = null;

  /** La zone de l'escalier désigné, ou null si ce n'en est pas un. */
  function escalierSelectionne() {
    return (selection && selection.metadata && selection.metadata.escalier)
      ? selection.metadata.escalier
      : null;
  }

  function brancherReglagesEscalier() {
    reglagesEscalier = document.getElementById("escalier-reglages");
    if (!reglagesEscalier) return;

    champsEscalier = {
      largeur:  document.getElementById("escalier-largeur"),
      longueur: document.getElementById("escalier-longueur"),
      hauteur:  document.getElementById("escalier-hauteur")
    };

    Object.keys(champsEscalier).forEach(function (cote) {
      var champ = champsEscalier[cote];
      if (!champ) return;

      /* « input » et non « change » : la volée se refait sous les doigts,
         c'est tout l'objet du panneau. */
      champ.addEventListener("input", function () {
        redimensionnerEscalier(cote, parseFloat(champ.value));
      });
    });

    var fermer = document.getElementById("escalier-fermer");
    if (fermer) {
      fermer.addEventListener("click", function () {
        selectionnerMobilier(null);
      });
    }

    // Les clics du panneau ne descendent pas jusqu'à la scène, qui y verrait
    // un clic à côté et lâcherait la volée sous les doigts.
    reglagesEscalier.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
    });
  }

  /**
   * Donne une cote nouvelle à la volée désignée, et la refait.
   *
   * La cote est rangée sur la zone d'origine — la seule qui survive à un
   * assemblage — puis les volées sont rebâties. La maison, elle, ne bouge
   * pas : ce serait la refaire entière à chaque frappe.
   */
  function redimensionnerEscalier(cote, valeurCm) {
    var zone = escalierSelectionne();
    if (!zone || !isFinite(valeurCm)) return false;

    zone[cote] = MursPlan.borneEscalier(cote, valeurCm / 100, zone[cote]);

    Maison.rebatirEscaliers();

    /* Les maillages d'hier sont disposés : la sélection doit se reporter sur
       la volée qui vient de les remplacer, faute de quoi le panneau piloterait
       un escalier qui n'existe plus. */
    selectionnerMobilier(socleDeLEscalier(zone));
    return true;
  }

  /** Le socle de la volée bâtie pour cette zone, ou null. */
  function socleDeLEscalier(zone) {
    var trouve = null;

    (rendusMaison.murs || []).forEach(function (m) {
      if (!m.isDisposed() && m.metadata && m.metadata.escalier === zone) {
        trouve = m;
      }
    });

    return trouve;
  }

  /** Replace et remplit le panneau de réglages, ou le retire. */
  function majReglagesEscalier(ecran) {
    if (!reglagesEscalier) return;

    var zone = escalierSelectionne();
    if (!zone || !ecran) {
      reglagesEscalier.classList.add("masque");
      return;
    }

    /* Les cotes affichées sont celles que la volée a réellement prises, pas
       celles qu'on lui a demandées : bornées, ou rabotées par le tracé, elles
       peuvent différer. Un champ qu'on est en train de remplir n'est pas
       réécrit, sans quoi la saisie deviendrait impossible. */
    var volee = selection.metadata.volee;

    if (volee) {
      [["largeur", volee.largeur], ["longueur", volee.longueur],
       ["hauteur", volee.hauteur]].forEach(function (paire) {
        var champ = champsEscalier[paire[0]];
        if (champ && document.activeElement !== champ) {
          champ.value = Math.round(paire[1] * 100);
        }
      });

      var etat = document.getElementById("escalier-etat");
      if (etat) {
        etat.textContent = volee.nombre + " marches de " +
          Math.round(volee.hauteurMarche * 100) + " cm, giron " +
          Math.round(volee.giron * 100) + " cm.";
      }
    }

    reglagesEscalier.style.left = Math.round(ecran.x) + "px";
    reglagesEscalier.style.top = Math.round(ecran.y) + "px";
    reglagesEscalier.classList.remove("masque");
  }

  /**
   * Replace le panneau au-dessus du meuble désigné.
   *
   * Appelé après chaque rendu tant qu'il y a une sélection : la caméra
   * bouge, l'objet aussi, et un panneau qui resterait où il était ne
   * désignerait plus rien.
   */
  function majOutilsMobilier() {
    if (!outilsMobilier) return;

    if (!selection || selection.isDisposed() || !scene.activeCamera) {
      outilsMobilier.classList.add("masque");
      majReglagesEscalier(null);
      return;
    }

    var boite = null;
    selection.metadata.morceaux.forEach(function (m) {
      if (m.isDisposed()) return;
      var b = m.getBoundingInfo().boundingBox;
      if (!boite) boite = { min: b.minimumWorld.clone(), max: b.maximumWorld.clone() };
      else {
        boite.min = BABYLON.Vector3.Minimize(boite.min, b.minimumWorld);
        boite.max = BABYLON.Vector3.Maximize(boite.max, b.maximumWorld);
      }
    });

    if (!boite) {
      outilsMobilier.classList.add("masque");
      majReglagesEscalier(null);
      return;
    }

    // Le panneau se pose au-dessus de l'objet, pas dedans.
    var sommet = new BABYLON.Vector3(
      (boite.min.x + boite.max.x) / 2, boite.max.y, (boite.min.z + boite.max.z) / 2
    );

    var ecran = BABYLON.Vector3.Project(
      sommet,
      BABYLON.Matrix.Identity(),
      scene.getTransformMatrix(),
      scene.activeCamera.viewport.toGlobal(
        engine.getRenderWidth(), engine.getRenderHeight()
      )
    );

    // Derrière la caméra : le panneau n'a plus lieu d'être montré.
    if (ecran.z < 0 || ecran.z > 1) {
      outilsMobilier.classList.add("masque");
      majReglagesEscalier(null);
      return;
    }

    /* Une volée se règle, elle ne se pousse pas : la palette de déplacement
       ne la concerne pas, et lui montrer des flèches sans effet vaudrait
       moins que rien. */
    if (escalierSelectionne()) {
      outilsMobilier.classList.add("masque");
      majReglagesEscalier(ecran);
      return;
    }

    majReglagesEscalier(null);

    outilsMobilier.style.left = Math.round(ecran.x) + "px";
    outilsMobilier.style.top = Math.round(ecran.y) + "px";
    outilsMobilier.classList.remove("masque");
  }

  /** Brume de fond : elle fond les arbres lointains et creuse la profondeur. */
  function appliquerBrume() {
    var reglage = CONFIG.exterieur.brume;

    if (!exterieurActif()) {
      scene.fogMode = BABYLON.Scene.FOGMODE_NONE;
      return;
    }

    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = reglage.densite;
    scene.fogColor = BABYLON.Color3.FromArray(reglage.couleur);
  }

  /** Monte ou retire l'ensemble du décor extérieur. */
  function majExterieur() {
    var actif = exterieurActif();

    if (ciel) ciel.setEnabled(actif);
    if (solExterieur) solExterieur.setEnabled(actif);

    if (actif && !arbres.length) construireArbres();
    else if (!actif) detruireArbres();

    appliquerBrume();
  }

  function construireExterieur() {
    construireCiel();
    construireSolExterieur();
    construireArbres();
    appliquerBrume();

    /* Le ciel naît après le premier appel à appliquerPreset : sans ce
       rattrapage, son soleil resterait à sa position par défaut, en
       contradiction avec le sens des ombres. */
    majCiel(presetResolu());

    majExterieur();
  }

  // --- Fenêtres ------------------------------------------------------------

  /** Vitrage : blanc lumineux, il figure le jour derrière la baie. */
  function obtenirMateriauVitre() {
    if (materiauVitre) return materiauVitre;

    materiauVitre = new BABYLON.PBRMaterial("vitrePBR", scene);
    materiauVitre.albedoColor = new BABYLON.Color3(0.96, 0.97, 1.0);
    materiauVitre.emissiveColor = new BABYLON.Color3(1, 1, 1);
    materiauVitre.emissiveIntensity = CONFIG.fenetre.emissiviteVitre;
    materiauVitre.roughness = 0.25;
    materiauVitre.metallic = 0;
    materiauVitre.backFaceCulling = false;
    reglerMateriauPBR(materiauVitre);

    return materiauVitre;
  }

  /** Dormant gris anthracite. */
  function obtenirMateriauCadre() {
    if (materiauCadre) return materiauCadre;

    materiauCadre = new BABYLON.PBRMaterial("cadrePBR", scene);
    materiauCadre.albedoColor = BABYLON.Color3.FromArray(CONFIG.fenetre.couleurCadre);
    materiauCadre.roughness = 0.55;
    materiauCadre.metallic = 0.1;
    materiauCadre.backFaceCulling = false;
    reglerMateriauPBR(materiauCadre);

    return materiauCadre;
  }

  /**
   * Assemble des quadrilatères plans en un maillage.
   * Même éventail de triangles que pour les carreaux : les quadrilatères de
   * la baie et de son dormant sont convexes.
   */
  function batirQuadrilateres(nom, quads, projeter, normale, materiau) {
    var positions = [];
    var normales = [];
    var uvs = [];
    var indices = [];

    quads.forEach(function (quad) {
      var base = positions.length / 3;

      quad.forEach(function (point, rang) {
        var espace = projeter(point[0], point[1]);
        positions.push(espace[0], espace[1], espace[2]);
        normales.push(normale[0], normale[1], normale[2]);
        uvs.push(rang === 1 || rang === 2 ? 1 : 0, rang >= 2 ? 1 : 0);
      });

      for (var t = 1; t < quad.length - 1; t++) {
        indices.push(base, base + t, base + t + 1);
      }
    });

    var maillage = new BABYLON.Mesh(nom, scene);

    var donnees = new BABYLON.VertexData();
    donnees.positions = positions;
    donnees.normals = normales;
    donnees.uvs = uvs;
    donnees.indices = indices;
    donnees.applyToMesh(maillage, false);

    maillage.material = materiau;
    maillage.isPickable = false;

    return maillage;
  }

  function detruireFenetre(identifiant) {
    var rendu = rendusFenetres[identifiant];
    if (!rendu) return;

    if (rendu.vitre) rendu.vitre.dispose();
    if (rendu.cadre) rendu.cadre.dispose();
    if (rendu.lumiere) rendu.lumiere.dispose();

    delete rendusFenetres[identifiant];
  }

  function detruireFenetres() {
    Object.keys(rendusFenetres).forEach(detruireFenetre);
  }

  /** Construit le vitrage, le dormant et la source lumineuse d'une baie. */
  function construireFenetre(fenetre, geo, reglage) {
    var mur = geo.parId[fenetre.mur];
    if (!mur) return;

    var config = CONFIG.fenetre;

    var projeterVitre = function (u, v) {
      return Calepinage.projeterSurMur(
        mur, u, v, CONFIG.carreau.hauteur + config.retraitVitre
      );
    };
    var projeterCadre = function (u, v) {
      return Calepinage.projeterSurMur(
        mur, u, v, CONFIG.carreau.hauteur + config.saillieCadre
      );
    };

    var rendu = { mur: fenetre.mur };

    rendu.vitre = batirQuadrilateres(
      "vitre-" + fenetre.id,
      [Fenetres.coins(fenetre, dims.hauteur)],
      projeterVitre, mur.normale, obtenirMateriauVitre()
    );

    rendu.cadre = batirQuadrilateres(
      "cadre-" + fenetre.id,
      Fenetres.cadre(fenetre, dims.hauteur, config.largeurCadre),
      projeterCadre, mur.normale, obtenirMateriauCadre()
    );

    // Source lumineuse, en retrait devant la baie et tournée vers la pièce.
    var centre = Fenetres.centreLocal(fenetre, dims.hauteur);
    var position = Calepinage.projeterSurMur(
      mur, centre[0], centre[1], config.reculLumiere
    );

    var origine = BABYLON.Vector3.FromArray(position);
    var cible = new BABYLON.Vector3(0, dims.hauteur / 2, 0);
    var direction = cible.subtract(origine);

    // Une baie posée au centre exact d'un mur donnerait un vecteur nul.
    if (direction.lengthSquared() < 1e-6) {
      direction = BABYLON.Vector3.FromArray(mur.normale);
    }
    direction.normalize();

    rendu.lumiere = new BABYLON.SpotLight(
      "jour-" + fenetre.id, origine, direction, config.angleCone, 2, scene
    );
    rendu.lumiere.diffuse = BABYLON.Color3.FromArray(
      Eclairage.couleurFenetre(reglage || presetResolu(), CONFIG.eclairage.couleurFenetre)
    );
    rendu.lumiere.specular = new BABYLON.Color3(0.3, 0.3, 0.32);
    rendu.lumiere.range = Math.max(dims.longueur, dims.largeur) * 2;
    rendu.lumiere.intensity = Eclairage.intensiteFenetre(
      Fenetres.surface(fenetre),
      CONFIG.eclairage.fenetreParMetreCarre,
      (reglage || presetResolu()).facteurFenetre
    );

    rendusFenetres[fenetre.id] = rendu;
  }

  /** Reconstruit toutes les baies. */
  function construireFenetres() {
    detruireFenetres();

    if (!murActifs()) {
      Panneau.majListeFenetres();
      return;
    }

    var geo = geometriePiece();
    var reglage = presetResolu();

    fenetres.forEach(function (fenetre) {
      Fenetres.ajuster(fenetre, geo.murs, dims.hauteur);
      construireFenetre(fenetre, geo, reglage);
    });

    Panneau.majListeFenetres();
    majVisibiliteMurs();
  }

  /**
   * Réajuste intensité et teinte des baies après un changement d'ambiance.
   * La lumière du jour ne prend pas la couleur du luminaire intérieur : seul
   * un preset qui le déclare explicitement — le soleil de midi — la réchauffe.
   */
  function majIntensiteFenetres(reglage) {
    var actif = reglage || presetResolu();
    var couleur = BABYLON.Color3.FromArray(
      Eclairage.couleurFenetre(actif, CONFIG.eclairage.couleurFenetre)
    );

    fenetres.forEach(function (fenetre) {
      var rendu = rendusFenetres[fenetre.id];
      if (!rendu || !rendu.lumiere) return;

      rendu.lumiere.intensity = Eclairage.intensiteFenetre(
        Fenetres.surface(fenetre), CONFIG.eclairage.fenetreParMetreCarre, actif.facteurFenetre
      );
      rendu.lumiere.diffuse = couleur;
    });

    // Le vitrage lui-même prend la teinte du jour qui le traverse.
    if (materiauVitre) materiauVitre.emissiveColor = couleur;
  }

  /** Ajoute une baie. Retourne { ok } ou { ok: false, erreur }. */
  function ajouterFenetre(options) {
    var geo = geometriePiece();
    var fenetre = Fenetres.creer(options.mur, options);

    var controle = Fenetres.verifier(fenetre, geo.murs, dims.hauteur);
    if (!controle.ok) return controle;

    fenetres.push(fenetre);
    Fenetres.ajuster(fenetre, geo.murs, dims.hauteur);
    construireFenetre(fenetre, geo, presetResolu());

    Panneau.majListeFenetres();
    majVisibiliteMurs();

    return { ok: true, fenetre: fenetre };
  }

  function supprimerFenetre(identifiant) {
    detruireFenetre(identifiant);
    fenetres = Fenetres.retirer(fenetres, identifiant);
    Panneau.majListeFenetres();
  }

  // --- Repères de la scène -------------------------------------------------

  /**
   * Grille de repère au pas métrique, redimensionnée avec le sol.
   * Le pas s'élargit sur les grandes surfaces pour rester lisible.
   */
  function construireGrille() {
    if (grille) {
      grille.dispose();
      grille = null;
    }

    var afficher = document.getElementById("grille");
    if (afficher && !afficher.checked) return;

    var L = dims.longueur, l = dims.largeur;
    var pas = 1;
    var maxDim = Math.max(L, l);
    if (maxDim > 200) pas = 20;
    else if (maxDim > 80) pas = 10;
    else if (maxDim > 30) pas = 5;

    var demiL = L / 2, demil = l / 2;
    // Au-dessus du carrelage, sinon la grille disparaît sous les carreaux.
    var y = CONFIG.carreau.hauteur + 0.004;
    var lignes = [];
    var i;

    for (i = -Math.floor(demiL / pas) * pas; i <= demiL; i += pas) {
      lignes.push([
        new BABYLON.Vector3(i, y, -demil),
        new BABYLON.Vector3(i, y, demil)
      ]);
    }
    for (i = -Math.floor(demil / pas) * pas; i <= demil; i += pas) {
      lignes.push([
        new BABYLON.Vector3(-demiL, y, i),
        new BABYLON.Vector3(demiL, y, i)
      ]);
    }

    // Contour de l'emprise, tracé par-dessus la grille.
    lignes.push([
      new BABYLON.Vector3(-demiL, y, -demil),
      new BABYLON.Vector3(demiL, y, -demil),
      new BABYLON.Vector3(demiL, y, demil),
      new BABYLON.Vector3(-demiL, y, demil),
      new BABYLON.Vector3(-demiL, y, -demil)
    ]);

    grille = BABYLON.MeshBuilder.CreateLineSystem("grille", { lines: lignes }, scene);
    grille.color = new BABYLON.Color3(0.45, 0.5, 0.6);
    grille.alpha = 0.28;
    grille.isPickable = false;
  }

  // --- Caméra --------------------------------------------------------------

  /** Recentre et éloigne la caméra pour cadrer la pièce entière. */
  function recadrerCamera() {
    if (!camera) return;

    var diagonale = Math.sqrt(
      dims.longueur * dims.longueur + dims.largeur * dims.largeur
    );

    var avecMurs = murActifs();
    var hauteurUtile = avecMurs ? dims.hauteur : 0;

    camera.setTarget(new BABYLON.Vector3(
      0, avecMurs ? hauteurUtile / 2 : Math.min(1, diagonale * 0.05), 0
    ));

    var encombrement = Math.sqrt(diagonale * diagonale + hauteurUtile * hauteurUtile);
    camera.radius = encombrement * 1.25 + 2;
    camera.upperRadiusLimit = Math.max(900, encombrement * 6);
  }

  /**
   * Cadre la maison entière en vue trois quarts aérienne.
   *
   * Le rayon est déduit du champ de vision plutôt que d'un coefficient
   * empirique : sur un écran étroit c'est l'ouverture horizontale qui
   * limite, sur un écran large c'est la verticale. Prendre la plus
   * contraignante des deux garantit que rien ne sort du cadre.
   */
  function cadrerMaison() {
    if (!camera) return;

    var boite = (maison && maison.contour && maison.contour.length)
      ? Plan.boiteEnglobante(maison.contour)
      : { longueur: dims.longueur, largeur: dims.largeur };

    var diagonale = Math.sqrt(
      boite.longueur * boite.longueur + boite.largeur * boite.largeur
    );
    var encombrement = Math.sqrt(
      diagonale * diagonale + dims.hauteur * dims.hauteur
    );

    // Trois quarts : un angle de coin, assez haut pour lire le plan de la
    // maison sans écraser les murs.
    camera.alpha = -Math.PI / 4;
    camera.beta  = Math.PI / 3.6;
    camera.setTarget(new BABYLON.Vector3(0, dims.hauteur * 0.35, 0));

    var champ = camera.fov || 0.8;
    var proportion = engine ? engine.getAspectRatio(camera) : 1.6;
    var demiVertical = Math.tan(champ / 2);
    var demiHorizontal = demiVertical * (proportion > 0 ? proportion : 1.6);

    var rayon = (encombrement / 2) /
                Math.max(0.05, Math.min(demiVertical, demiHorizontal));

    camera.upperRadiusLimit = Math.max(900, encombrement * 6);
    camera.radius = Math.min(camera.upperRadiusLimit, rayon * 1.12 + 1.5);
  }

  // --- API publique --------------------------------------------------------

  /**
   * Redimensionne la pièce. Valeurs en mètres.
   * La hauteur est facultative : omise, elle reste inchangée.
   */
  function definirDimensionsPiece(longueur, largeur, hauteur) {
    dims.longueur = borner(parseFloat(longueur), CONFIG.limites.min, CONFIG.limites.max);
    dims.largeur = borner(parseFloat(largeur), CONFIG.limites.min, CONFIG.limites.max);

    if (hauteur !== undefined) {
      dims.hauteur = borner(
        parseFloat(hauteur), CONFIG.limitesHauteur.min, CONFIG.limitesHauteur.max
      );
    }

    reconstruireTout();
    // Les murs de la maison suivent la hauteur H comme ceux de la pièce.
    Maison.construire();
    /* Le métré de l'habillage se refait avec la maison, et reconstruireTout
       vient de l'afficher sans lui : sans cette reprise il resterait d'une
       hauteur en retard. */
    Panneau.majMetre();
    // Les baies sont recalées sur les nouvelles dimensions plutôt que perdues.
    construireFenetres();
    // Les arbres s'écartent d'autant que la pièce grandit.
    construireArbres();
    construireGrille();
    // Le plan suit les proportions de la pièce : il est redessiné, pas
    // simplement mis à jour.
    Panneau.dessinerPlan();
    Panneau.majResume();
  }

  // --- Visite immersive ----------------------------------------------------

  /** Le bouton n'a de sens qu'une fois une maison bâtie. */
  function majBoutonVisite() {
    var bouton = document.getElementById("btn-visite");
    if (!bouton) return;

    var possible = !!(maison && maison.pieces && maison.pieces.length);
    bouton.disabled = !possible && !Visite.active();
    bouton.textContent = Visite.active()
      ? "🚶 Quitter la visite"
      : "🚶 Visite immersive";
  }

  function afficherBandeauVisite(visible) {
    var bandeau = document.getElementById("bandeau-visite");
    if (bandeau) bandeau.classList.toggle("masque", !visible);
    document.body.classList.toggle("en-visite", visible);
  }

  /* Recul du point de départ devant la porte, en mètres. Assez pour voir la
     façade et l'encadrement de l'entrée dans le champ, assez peu pour qu'un
     pas en avant suffise à franchir le seuil. */
  var RECUL_ENTREE = 2.0;

  /* Écart à la porte servant à reconnaître l'intérieur. Court exprès : au
     delà, sur une petite entrée, le point d'essai sortirait par le mur d'en
     face et l'on croirait le dehors dedans. */
  var SONDE_ENTREE = 0.9;

  /**
   * Point de départ devant l'entrée, sur le pas de la porte, dehors.
   *
   * Le visiteur arrive comme un visiteur : depuis la rue, face à la façade,
   * la porte devant lui. Il entre en marchant. Démarrer à l'intérieur —
   * ce que faisait cette fonction — escamotait l'arrivée et posait le client
   * dans une pièce sans qu'il ait vu par où il venait d'entrer.
   *
   * Reste à savoir de quel côté est la rue. Aucune convention d'orientation
   * ne le dit : la normale d'un mur est perpendiculaire, sans plus, et c'est
   * l'emplacement des pièces qui tranche. On sonde donc les deux côtés du
   * percement ; celui qui tombe dans une pièce est l'intérieur, l'autre est
   * le dehors.
   *
   * @returns {{depart, regard, porte}|null} en mètres. `regard` vise
   *   l'intérieur à travers la porte : c'est la direction dans laquelle on
   *   franchit le seuil. `porte` donne son centre et le vecteur unitaire qui
   *   pointe vers le dehors — de quoi poser quelque chose sur le seuil sans
   *   refaire le tour des pièces pour savoir de quel côté est la rue.
   */
  function departDevantEntree() {
    if (!maison || !maison.murs) return null;

    var porte = MursPlan.entree(maison.murs);
    if (!porte) return null;

    var versInterieur = orientationEntree(porte);
    if (!versInterieur) return null;

    // Le dehors, c'est l'autre côté.
    var dehors = [-versInterieur[0], -versInterieur[1]];

    var x = porte.centre[0] + dehors[0] * RECUL_ENTREE;
    var z = porte.centre[1] + dehors[1] * RECUL_ENTREE;

    return {
      depart: [x, z],
      // On regarde la porte, et au-delà l'intérieur : c'est là qu'on va.
      regard: [x + versInterieur[0], z + versInterieur[1]],
      porte: {
        centre: [porte.centre[0], porte.centre[1]],
        dehors: dehors
      }
    };
  }

  /**
   * Vecteur unitaire de la porte vers l'intérieur du logement, ou null.
   *
   * Deux méthodes, dans cet ordre. La bonne : sonder les deux côtés et
   * retenir celui qui tombe dans une pièce du rez-de-chaussée. Le repli :
   * viser le barycentre des pièces. Il sert quand aucune sonde n'aboutit —
   * une porte en fond de couloir étroit, un contour de pièce qui s'arrête
   * au nu du mur — et vaut toujours mieux que renoncer, car renoncer
   * renverrait le visiteur au milieu du salon.
   */
  function orientationEntree(porte) {
    var auSol = (maison.pieces || []).filter(function (piece) {
      return !(piece.altitude > 0) && piece.contour && piece.contour.length >= 3;
    });
    if (!auSol.length) return null;

    for (var sens = 1; sens >= -1; sens -= 2) {
      var x = porte.centre[0] + porte.normale[0] * SONDE_ENTREE * sens;
      var z = porte.centre[1] + porte.normale[1] * SONDE_ENTREE * sens;

      var dedans = auSol.some(function (piece) {
        return Plan.pointDansPolygone([x, z], piece.contour);
      });

      if (dedans) return [porte.normale[0] * sens, porte.normale[1] * sens];
    }

    /* Repli : le côté de la normale qui pointe vers le gros du bâti. On ne
       compare que le signe, la longueur n'a pas d'intérêt ici. */
    var sommets = 0, cx = 0, cz = 0;
    auSol.forEach(function (piece) {
      piece.contour.forEach(function (p) { cx += p[0]; cz += p[1]; sommets++; });
    });
    if (!sommets) return null;

    var versCentre = [cx / sommets - porte.centre[0], cz / sommets - porte.centre[1]];
    var projection = versCentre[0] * porte.normale[0] + versCentre[1] * porte.normale[1];

    // Le barycentre tombe pile sur le plan du mur : rien ne départage.
    if (Math.abs(projection) < 1e-6) return null;

    var sens = projection > 0 ? 1 : -1;
    return [porte.normale[0] * sens, porte.normale[1] * sens];
  }

  function basculerVisite() {
    if (Visite.active()) { Visite.arreter(); return; }
    if (!maison || !maison.pieces || !maison.pieces.length) return;

    /* On lâche le meuble avant de partir en visite. Sa palette flotterait
       au milieu de la promenade, et la caméra orbitale resterait sourde au
       clavier tout le temps qu'on est ailleurs — pour le retrouver figé au
       retour. */
    selectionnerMobilier(null);

    // La visite commence toujours de plain-pied : on entre par le bas.
    var rezDeChaussee = {
      pieces: maison.pieces.filter(function (piece) {
        return !(piece.altitude > 0);
      })
    };

    /* Devant l'entrée si elle est marquée, sinon au cœur de la plus grande
       pièce. On entre chez soi par la porte — et l'on regarde où l'on va,
       ce que seule l'entrée sait dire. */
    var parLEntree = departDevantEntree();

    var depart = parLEntree ? parLEntree.depart : Visite.departConseille(
      rezDeChaussee.pieces.length ? rezDeChaussee : maison
    );
    if (!depart) return;

    var lance = Visite.demarrer({
      scene: scene,
      canvas: canvas,
      depart: depart,
      regard: parLEntree ? parLEntree.regard : null,
      cameraPrecedente: camera,
      surQuitter: function () {
        afficherBandeauVisite(false);
        majBoutonVisite();
        // On retrouve la vue trois quarts d'où l'on était parti.
        cadrerMaison();
      }
    });

    if (!lance) return;

    afficherBandeauVisite(true);
    majBoutonVisite();
  }

  /**
   * Installe une maison analysée, ou l'efface si `donnees` vaut null.
   *
   * Les quatre murs rectangulaires de la pièce n'ont plus lieu d'être quand
   * la maison porte les siens : ils sont décochés, l'utilisateur reste libre
   * de les rallumer.
   */
  function definirMaison(donnees, options) {
    var o = options || {};
    maison = donnees || null;

    if (maison) {
      // L'habillage reprend les réglages muraux en cours : passer au plan
      // ne remet pas le revêtement à zéro. Les exceptions par mur, elles,
      // ne survivent pas à une nouvelle maison — leurs murs n'existent plus.
      if (!habillageMurs) {
        habillageMurs = MursPlan.creerHabillage(
          Surfaces.trouver(surfaces, "nord")
        );
      } else {
        MursPlan.selectionner(habillageMurs, -1);
        habillageMurs.parMur = {};
      }
    }

    /* Les murs de la pièce rectangulaire feraient double emploi avec ceux de
       la maison : ils cessent d'être visibles, sans que la case « Murs »
       change de sens pour autant. */
    surfaces.forEach(function (surface) {
      if (surface.type === "mur" && maison) detruireRendu(surface.id);
    });

    /* Le sol se refait, parce que ce sont désormais les pièces de la maison
       qui lui donnent sa forme — voir `contoursSol`. Sans cette ligne, il
       resterait celui d'avant : le rectangle des cotes saisies, qui déborde
       de la maison partout où les pièces ne remplissent pas leur boîte. Le
       cas se voit surtout dans la visite partagée, où la maison arrive après
       les dimensions. */
    var sol = Surfaces.trouver(surfaces, "sol");
    if (sol) reconstruireSurface(sol, undefined, true);

    Maison.construire();
    /* Le décor du seuil suit la maison : il se repose quand elle change, et
       s'efface avec elle. L'appel vaut aussi pour `donnees` nul — il n'y a
       alors plus de porte, donc plus de plantes. */
    construirePlantesEntree();
    construireRouteDemo();
    majBoutonVisite();
    // Le partage suit la visite : ils dépendent tous deux de la maison.
    Panneau.majBoutonPartager();
    Panneau.majOnglets();
    // Bâtir la maison, c'est monter son habillage : le devis suit.
    Panneau.majMetre();

    // Une maison fraîchement bâtie se montre en entier, pas de biais. Un
    // simple rafraîchissement, lui, laisse la caméra où elle est.
    if (maison && !o.garderCadrage) cadrerMaison();
  }

  // --- Noyau partagé -------------------------------------------------------

  var noyauPartage = null;

  /**
   * Ce que scene.js prête aux autres fichiers.
   *
   * L'état global reste ici — une seule maison, un seul jeu de surfaces, une
   * seule caméra — et se lit par accesseurs plutôt que de se recopier : un
   * `maison` capturé au chargement pointerait sur la maison d'avant dès la
   * première reconstruction. Les objets mutés en place, `dims` et
   * `rendusMaison`, se partagent directement : il n'y a rien à réassigner.
   *
   * Le noyau ne porte que ce que scene.js possède. Entre eux, les trois
   * autres fichiers s'appellent par leur globale — Panneau.majMetre() se lit
   * mieux qu'un renvoi de plus à travers ce même objet.
   */
  function noyau() {
    if (noyauPartage) return noyauPartage;

    noyauPartage = {
      CONFIG: CONFIG,
      dims: dims,

      // Babylon
      scene: function () { return scene; },
      ombres: function () { return generateurOmbres; },
      recadrerCamera: recadrerCamera,

      // Maison analysée
      maison: function () { return maison; },
      rendusMaison: rendusMaison,
      habillage: function () { return habillageMurs; },
      /* Repose un habillage entier — celui qu'un lien de visite rapporte.
         La maison se bâtit juste après : ses murs se montent déjà revêtus,
         plutôt que blancs puis refaits. */
      installerHabillage: function (habillage) {
        if (habillage) habillageMurs = habillage;
      },
      definirMaison: function (donnees, options) {
        definirMaison(donnees, options);
      },
      /**
       * Donne au sol sa forme : un contour, une liste de contours, ou null
       * pour revenir au rectangle des dimensions saisies.
       *
       * Les deux formes sont acceptées parce que les deux ont un sens : une
       * pièce isolée n'a qu'un contour, un plan entier en a autant que de
       * blocs. Normaliser ici évite d'avoir à le faire à chaque appel.
       */
      definirPolygone: function (contour) {
        if (!contour || !contour.length) {
          contoursPiece = null;
          return;
        }

        var liste = (Array.isArray(contour[0]) && Array.isArray(contour[0][0]))
          ? contour
          : [contour];

        liste = liste.filter(function (un) { return un && un.length >= 3; });
        contoursPiece = liste.length ? liste : null;
      },
      basculerVisite: function () { basculerVisite(); },

      /* Le décor d'accueil s'efface dès qu'un plan de l'utilisateur paraît.
         `definitif` le lui interdit de revenir. */
      effacerDecorDemo: effacerDecorDemo,

      // Mobilier posé à la main
      placerModele:  placerModele,
      armerModele:   armerModele,
      mobilierArme:  mobilierArme,
      viderMobilier: viderMobilier,
      compteRenduPose: compteRenduPose,
      enregistrerMobilier: enregistrerMobilier,
      relireMobilier: relireMobilier,
      restaurerMobilier: restaurerMobilier,
      mobilierScene: function () { return mobilierScene; },
      mobilierSelectionne: mobilierSelectionne,
      selectionnerMobilier: selectionnerMobilier,
      deplacerMobilier: deplacerMobilier,
      pivoterMobilier:  pivoterMobilier,
      supprimerMobilier: supprimerMobilier,

      // Surfaces de la pièce
      surfaces: function () { return surfaces; },
      rendus: function () { return rendus; },
      surfaceActive: function () { return surfaceActive; },
      definirSurfaceActive: function (id) { surfaceActive = id; },
      chute: function () { return chute; },
      definirChute: function (valeur) { chute = valeur; },
      geometriePiece: geometriePiece,
      murActifs: murActifs,
      reconstruireSurface: reconstruireSurface,
      reconstruireTout: reconstruireTout,
      definirDimensionsPiece: definirDimensionsPiece,
      majVisibiliteMurs: majVisibiliteMurs,

      // Matériaux et maillage
      couleurBabylon: couleurBabylon,
      reglerMateriauPBR: reglerMateriauPBR,
      obtenirMateriauJoint: obtenirMateriauJoint,
      obtenirMateriauSurface: obtenirMateriauSurface,
      appliquerApparence: appliquerApparence,
      tamponsDeSurface: tamponsDeSurface,
      schemaDeSurface: schemaDeSurface,
      maillerCarrelage: maillerCarrelage,
      creerFondPolygone: creerFondPolygone,

      // Décor et baies
      fenetres: function () { return fenetres; },
      ajouterFenetre: ajouterFenetre,
      supprimerFenetre: supprimerFenetre,
      construireFenetres: construireFenetres,
      construireGrille: construireGrille,
      majExterieur: majExterieur,
      presetActif: function () { return presetActif; },
      appliquerPreset: appliquerPreset
    };

    return noyauPartage;
  }

  // --- Démarrage -----------------------------------------------------------

  function demarrer() {
    canvas = document.getElementById("renderCanvas");

    if (typeof BABYLON === "undefined") {
      afficherErreur(
        "Babylon.js n'a pas pu être chargé depuis le CDN. " +
        "Vérifie la connexion réseau, puis recharge la page."
      );
      document.getElementById("chargement").textContent = "Moteur 3D indisponible.";
      return;
    }

    if (typeof Calepinage === "undefined" || typeof Surfaces === "undefined" ||
        typeof Eclairage === "undefined" || typeof Fenetres === "undefined" ||
        typeof Exterieur === "undefined" || typeof Plan === "undefined") {
      afficherErreur(
        "Modules requis manquants : calepinage.js, surfaces.js, eclairage.js, " +
        "fenetres.js, exterieur.js et plan.js."
      );
      return;
    }

    /* Les fichiers découpés hors de scene.js. Sans eux la page se charge mais
       ne bâtit plus rien : mieux vaut le dire que laisser une scène vide. */
    if (typeof Maison === "undefined" || typeof Traceur2D === "undefined" ||
        typeof Panneau === "undefined") {
      afficherErreur(
        "Modules requis manquants : maison.js, panneau.js et traceur2d.js."
      );
      return;
    }

    if (!BABYLON.Engine.isSupported()) {
      afficherErreur("WebGL n'est pas disponible sur ce navigateur ou cette machine.");
      return;
    }

    /* `body.en-visite` masque tout le panneau de gauche. Elle est posée à
       l'entrée en visite immersive et retirée à la sortie — mais une erreur
       survenue entre les deux la laisserait collée, et l'utilisateur se
       retrouverait devant une scène nue sans savoir pourquoi. On repart
       toujours d'un corps propre. */
    afficherBandeauVisite(false);

    /* Taille du tampon de rendu, arrêtée AVANT la création du moteur.
     *
     * Un iPhone annonce une densité de 3 : en résolution native, le tampon
     * d'un écran de 390×844 fait 1170×2532, et il n'est pas seul — s'y
     * ajoutent la profondeur, le stencil et les échantillons de l'anticrénelage.
     * Le relevé ?diag pris sur l'appareil est sans appel : le contexte WebGL
     * est perdu à la création du moteur, avant qu'une seule texture ne soit
     * chargée. Le budget est épuisé par le tampon seul.
     *
     * On plafonne donc la densité de rendu à 2. Au-delà, l'œil ne distingue
     * plus grand-chose sur un écran tenu à bout de bras, et la mémoire, elle,
     * croît avec le carré : passer de 3 à 2 la ramène à 44 %.
     *
     * « adaptToDeviceRatio » est laissé à faux, et l'échelle posée juste après :
     * autrement Babylon allouerait d'abord le tampon en densité native — celui
     * qui tue le contexte — avant qu'on ait la main pour le réduire. On part
     * de la taille CSS, la plus petite, et on monte. */
    var densiteEcran = window.devicePixelRatio || 1;
    var densiteRendu = Math.min(densiteEcran, DENSITE_RENDU_MAX);

    engine = new BABYLON.Engine(canvas, true, {
      /* Le tampon conservé sert aux captures d'écran de la fiche PDF, qui
         n'existe que dans l'outil d'édition. La visite du client n'en prend
         aucune : lui en imposer le coût, c'est payer une seconde image plein
         écran pour rien — sur un téléphone, ce rien peut coûter le contexte. */
      preserveDrawingBuffer: capturesEcranAttendues(),
      stencil: true,
      antialias: true
    }, false);

    engine.setHardwareScalingLevel(1 / densiteRendu);

    /* Perte du contexte WebGL.
     *
     * Le pilote graphique peut retirer le contexte à tout moment — mémoire
     * épuisée, onglet mis en veille, GPU réinitialisé. C'est le mode de
     * panne le plus probable sur un téléphone, où le budget est étroit et la
     * page concurrente de tout le reste.
     *
     * Sans ces deux observateurs, la panne est muette : la boucle de rendu
     * continue de tourner sur un contexte mort et le client reste devant un
     * écran noir, sans rien à nous rapporter. Babylon sait rétablir le
     * contexte et recharger ce qu'il contenait ; ce qui manquait, c'est de
     * le dire.
     */
    engine.onContextLostObservable.add(function () {
      afficherErreur(
        "L'affichage 3D a été interrompu par l'appareil, souvent faute de " +
        "mémoire. Rétablissement en cours — si l'image ne revient pas, " +
        "fermez les autres onglets puis rechargez la page."
      );
    });

    engine.onContextRestoredObservable.add(function () {
      var boite = document.getElementById("erreur");
      if (boite) boite.style.display = "none";
    });

    /* Le noyau avant la scène : la construire meuble déjà la maison, et les
       trois fichiers n'ont rien tant qu'ils ne l'ont pas reçu. */
    Maison.installer(noyau());
    Panneau.installer(noyau());
    Traceur2D.installer(noyau());
    // Le partage n'est pas indispensable au rendu : l'application tourne
    // sans lui, la page de visite ne s'ouvre simplement pas.
    if (typeof Partage !== "undefined") Partage.installer(noyau());

    creerScene();
    brancherPoseMobilier();
    brancherClavierMobilier();
    brancherOutilsMobilier();
    brancherReglagesEscalier();
    Panneau.brancher();

    /* Un projet reçu par lien, s'il y en a un. L'application ouvre alors ce
       qu'on lui donne, comme le fait la page de visite : un vendeur qui rouvre
       son projet depuis un mail, ou reçoit celui d'un collègue, retrouve la
       scène et pas la démonstration. */
    var recu = (typeof Partage !== "undefined" && Partage.aUnLien())
      ? Partage.deserialiser(window.location.hash)
      : null;

    if (recu && recu.valide) {
      /* Le lien remplace la démonstration, il ne se pose pas par-dessus.
         La monter d'abord ferait clignoter une maison qui n'est pas celle du
         projet — et surtout son montage se poursuit en arrière-plan : il
         retombait sur le projet restauré et l'effaçait.

         Et l'on attend le catalogue : sans lui, `appliquerApparence` ne
         reconnaît aucun identifiant de matériau, traite chacun comme une
         erreur et vide la texture de la surface. Le projet arrivait alors
         complet — murs, cotes, mobilier — mais sans un seul carrelage. */
      Panneau.catalogueCharge().then(function () {
        Partage.appliquer(recu);

        var champNom = document.getElementById("nom-projet");
        if (champNom && recu.nom) champNom.value = recu.nom;

        Panneau.chargerPanneau();
        Panneau.majMetre();
      });

      /* Le mobilier du navigateur n'est pas rappelé : le lien porte le sien,
         et les meubles d'hier viendraient s'y ajouter. Le lien fait foi, pas
         le navigateur qui l'ouvre. */
    } else {
      /* Une pièce meublée dès l'ouverture : la page ne s'affiche plus sur une
         scène vide, et ce qu'on y voit est bâti par le chemin ordinaire. Elle
         s'efface d'elle-même dès qu'un plan est chargé. */
      Traceur2D.demo();

      /* Puis le mobilier d'hier, remis où il était. Après la démo : les
         meubles se posent dans le monde, et la maison doit exister pour qu'on
         les y retrouve à leur place. */
      restaurerMobilier();
    }

    var compteurFps = document.getElementById("resume-fps");
    var dernierAffichage = 0;

    engine.runRenderLoop(function () {
      // Avant le rendu : le mur qui se trouve entre la caméra et la pièce
      // doit disparaître, sans quoi il boucherait la vue depuis l'extérieur.
      majVisibiliteMurs();

      scene.render();

      // Le panneau du meuble désigné suit la caméra : il n'a de sens qu'au
      // bon endroit de l'écran, et la caméra bouge à chaque image.
      if (selection) majOutilsMobilier();

      // Rafraîchit le compteur 2 fois par seconde, pas à chaque frame.
      var maintenant = performance.now();
      if (compteurFps && maintenant - dernierAffichage > 500) {
        compteurFps.textContent = engine.getFps().toFixed(0) + " ips";
        dernierAffichage = maintenant;
      }
    });

    window.addEventListener("resize", function () { engine.resize(); });

    var ecranMasque = false;
    function masquerChargement() {
      if (ecranMasque) return;
      ecranMasque = true;
      var ecran = document.getElementById("chargement");
      if (!ecran) return;
      ecran.classList.add("masque");
      setTimeout(function () { ecran.style.display = "none"; }, 400);
    }

    scene.executeWhenReady(masquerChargement);

    /**
     * Écran de chargement de Babylon, aux couleurs de l'enseigne.
     *
     * Babylon en pose un par défaut — fond gris-bleu, « Loading... » en
     * anglais — dès qu'on lui demande d'en montrer un. Il n'a rien à voir
     * avec le nôtre, et le client le prendrait pour une autre application.
     *
     * Celui-ci rejoue le voile de la page plutôt que d'en dresser un second :
     * même logo, même fond, même rouet. Une seule identité, décrite à un seul
     * endroit — la feuille de style de index.html.
     *
     * Rien ne l'appelle aujourd'hui : le chargement des meubles passe par
     * `SceneLoader.ImportMesh`, qui ne montre aucun écran. Il est là pour que
     * le jour où quelque chose en demande un, ce soit celui-ci.
     */
    function EcranChargement() {
      this.loadingUIBackgroundColor = "#0b0c0f";
      this._texte = "Chargement…";
    }

    Object.defineProperty(EcranChargement.prototype, "loadingUIText", {
      get: function () { return this._texte; },
      set: function (valeur) {
        this._texte = valeur;
        var ecran = document.getElementById("chargement");
        var ligne = ecran && ecran.querySelector("p");
        if (ligne) ligne.textContent = valeur;
      }
    });

    EcranChargement.prototype.displayLoadingUI = function () {
      var ecran = document.getElementById("chargement");
      if (!ecran) return;

      ecranMasque = false;
      ecran.style.display = "";

      /* Un recalcul forcé entre l'affichage et le retrait de la classe :
         sans lui, les deux se fondent dans le même lot de style et la
         transition d'opacité ne part jamais de zéro.

         Lecture synchrone plutôt que `requestAnimationFrame` : celui-ci ne
         se déclenche pas dans un onglet en arrière-plan, et l'écran restait
         alors à demi transparent. */
      void ecran.offsetHeight;
      ecran.classList.remove("masque");
    };

    EcranChargement.prototype.hideLoadingUI = function () {
      ecranMasque = false;
      masquerChargement();
    };

    engine.loadingScreen = new EcranChargement();

    // Filet de sécurité : si une ressource distante ne se résout jamais,
    // on découvre quand même la scène plutôt que de rester sur le voile.
    setTimeout(masquerChargement, 8000);

    window.Moteur = {
      engine: engine,
      scene: scene,
      camera: camera,

      /* Le pas de la porte d'entrée, dehors, et la direction pour entrer.
         La page de visite s'en sert pour faire arriver le client par où l'on
         arrive chez les gens, au lieu de le poser au milieu du salon. Rend
         null si aucune entrée n'est marquée sur le plan. */
      departDevantEntree: departDevantEntree,

      surfaces: function () { return surfaces; },
      surface: function (id) { return Surfaces.trouver(surfaces, id); },
      surfaceActive: function () { return surfaceActive; },

      dimensions: function () {
        return {
          longueur: dims.longueur,
          largeur: dims.largeur,
          hauteur: dims.hauteur
        };
      },
      definirDimensionsPiece: definirDimensionsPiece,

      /** Modifie une surface par programme : Moteur.regler("nord", {motif:"chevron"}) */
      regler: function (id, reglages) {
        var surface = Surfaces.trouver(surfaces, id);
        if (!surface) return null;

        Surfaces.REGLAGES.forEach(function (cle) {
          if (reglages[cle] !== undefined) surface[cle] = reglages[cle];
        });

        appliquerApparence(surface);
        reconstruireSurface(surface);
        if (surface.id === surfaceActive) Panneau.chargerPanneau();

        return surface;
      },

      metre: function () {
        var entrees = [];
        surfaces.forEach(function (surface) {
          var rendu = rendus[surface.id];
          if (rendu && rendu.resultat) {
            entrees.push({ surface: surface, resultat: rendu.resultat });
          }
        });
        return Surfaces.agreger(entrees, chute, Panneau.nomTexture);
      },

      presets: function () { return Object.keys(CONFIG.eclairage.presets); },
      presetActif: function () { return presetActif; },
      appliquerPreset: appliquerPreset,

      exterieur: function () {
        return { ciel: ciel, sol: solExterieur, arbres: arbres.slice() };
      },
      majExterieur: majExterieur,

      fenetres: function () { return fenetres.slice(); },
      ajouterFenetre: ajouterFenetre,
      supprimerFenetre: supprimerFenetre,

      /* Les polygones réellement carrelés, en mètres. C'est la seule source
         honnête pour une surface à commander : ni la boîte englobante, ni les
         cotes saisies, mais ce que le sol couvre. */
      contoursSol: function () {
        var liste = contoursSol() || rectangleDesCotes();
        return liste.map(function (contour) {
          return contour.map(function (p) { return [p[0], p[1]]; });
        });
      },

      recadrerCamera: recadrerCamera,
      reconstruireTout: reconstruireTout,
      ajouterOmbre: function (mesh) {
        if (generateurOmbres) generateurOmbres.addShadowCaster(mesh);
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", demarrer);
  } else {
    demarrer();
  }
})();
