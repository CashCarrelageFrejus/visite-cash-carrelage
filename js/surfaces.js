/**
 * Catalogue 3D — modèle de surfaces
 *
 * Une pièce est décrite comme cinq surfaces indépendantes : le sol et les
 * quatre murs. Chacune porte ses propres réglages — mode d'habillage, texture,
 * couleur, motif de pose, format de carreau, joint, rotation — et produit son
 * propre métré.
 *
 * Module pur : aucune dépendance à Babylon, donc vérifiable sous Node.
 * Le rendu est entièrement à la charge de scene.js.
 */
(function (global) {
  "use strict";

  /** Réglages d'habillage, ceux qui se copient d'une surface à l'autre. */
  var REGLAGES = [
    "mode", "texture", "couleur", "motif",
    "largeurCarreau", "longueurCarreau", "joint", "rotationAleatoire",
    "poseOpus"
  ];

  var DEFAUTS = {
    mode: "carrele",        // "carrele" | "uni"
    texture: "",            // identifiant du catalogue, vide = couleur seule
    couleur: "#ccc9c2",
    motif: "droite",
    largeurCarreau: 0.60,   // m
    longueurCarreau: 0.60,  // m
    joint: 0.003,           // m
    rotationAleatoire: false,

    /* Poser selon le schéma multi-formats du matériau, quand il en déclare un.
     *
     * Le schéma appartient au produit — c'est le débit de la pierre — mais
     * s'en servir est une décision de pose : le même travertin s'appose en
     * opus ou dans son seul format de référence. Le premier vit donc sur la
     * fiche du catalogue, le second ici, sur la surface. */
    poseOpus: false
  };

  /* L'ordre fixe l'affichage des onglets. Les identifiants de mur reprennent
     ceux de Calepinage.murs(), qui fournit leur géométrie. */
  var DESCRIPTION = [
    { id: "sol", nom: "Sol", court: "Sol", type: "sol" },
    { id: "nord", nom: "Mur Nord", court: "Nord", type: "mur" },
    { id: "sud", nom: "Mur Sud", court: "Sud", type: "mur" },
    { id: "est", nom: "Mur Est", court: "Est", type: "mur" },
    { id: "ouest", nom: "Mur Ouest", court: "Ouest", type: "mur" }
  ];

  // --- Création et manipulation ---------------------------------------------

  /** Crée les cinq surfaces avec leurs réglages par défaut. */
  function creer(surcharges) {
    return DESCRIPTION.map(function (modele) {
      var surface = {
        id: modele.id,
        nom: modele.nom,
        court: modele.court,
        type: modele.type
      };

      REGLAGES.forEach(function (cle) { surface[cle] = DEFAUTS[cle]; });

      if (surcharges && surcharges[modele.id]) {
        REGLAGES.forEach(function (cle) {
          if (surcharges[modele.id][cle] !== undefined) {
            surface[cle] = surcharges[modele.id][cle];
          }
        });
      }

      return surface;
    });
  }

  function trouver(surfaces, identifiant) {
    for (var i = 0; i < surfaces.length; i++) {
      if (surfaces[i].id === identifiant) return surfaces[i];
    }
    return null;
  }

  /** Recopie les réglages d'habillage d'une surface vers une autre. */
  function copier(source, cible) {
    REGLAGES.forEach(function (cle) { cible[cle] = source[cle]; });
    return cible;
  }

  /** Recopie les réglages de `source` vers toutes les surfaces murales. */
  function copierVersMurs(source, surfaces) {
    var touchees = [];
    surfaces.forEach(function (surface) {
      if (surface.type === "mur" && surface.id !== source.id) {
        copier(source, surface);
        touchees.push(surface);
      }
    });
    return touchees;
  }

  // --- Géométrie -------------------------------------------------------------

  /**
   * Dimensions du rectangle à calepiner, en mètres.
   *
   * `piece` : { longueur, largeur, hauteur }
   * `murs`  : sortie de Calepinage.murs(), pour la largeur de chaque paroi.
   */
  function dimensions(surface, piece, murs) {
    if (surface.type === "sol") {
      return { longueur: piece.longueur, largeur: piece.largeur };
    }

    var paroi = null;
    for (var i = 0; murs && i < murs.length; i++) {
      if (murs[i].nom === surface.id) paroi = murs[i];
    }

    // Un mur est un rectangle : sa largeur devient la longueur du calepinage,
    // la hauteur de la pièce en devient la largeur.
    return { longueur: paroi ? paroi.largeur : 0, largeur: piece.hauteur };
  }

  /** Assemble les options attendues par Calepinage.calculer. */
  function optionsCalepinage(surface, piece, murs, chute) {
    var d = dimensions(surface, piece, murs);

    return {
      longueur: d.longueur,
      largeur: d.largeur,
      largeurCarreau: surface.largeurCarreau,
      longueurCarreau: surface.longueurCarreau,
      joint: surface.joint,
      motif: surface.motif,
      rotationAleatoire: surface.rotationAleatoire,
      chute: chute
    };
  }

  // --- Métadonnées du catalogue ----------------------------------------------

  /**
   * Convertit un format écrit en clair vers les dimensions du modèle.
   *
   * Accepte « 100x100 », « 60×120 », « 30,3 x 61,3 ». Les valeurs du catalogue
   * sont en centimètres, celles du modèle en mètres.
   * Retourne null si la chaîne n'est pas exploitable.
   */
  function formatDepuisTexte(texte) {
    if (typeof texte !== "string") return null;

    var normalise = texte.replace(/,/g, ".");
    var lu = normalise.match(/^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i);
    if (!lu) return null;

    var largeur = parseFloat(lu[1]);
    var longueur = parseFloat(lu[2]);
    if (!(largeur > 0) || !(longueur > 0)) return null;

    return { largeurCarreau: largeur / 100, longueurCarreau: longueur / 100 };
  }

  /**
   * Extrait d'une fiche du catalogue les réglages qu'elle recommande.
   *
   * Deux conventions cohabitent : `format_recommande` et `rotation_aleatoire`
   * pour les séries produits, `formats[]` et `rotationAleatoire` pour les
   * matériaux importés. La première prime, la seconde sert de repli — sans
   * quoi un matériau importé n'appliquerait silencieusement aucun réglage.
   *
   * Ne retourne que les clés réellement renseignées : une fiche muette ne doit
   * rien imposer à la surface.
   */
  function reglagesDepuisMateriau(materiau) {
    var reglages = {};
    if (!materiau) return reglages;

    var format = formatDepuisTexte(materiau.format_recommande);

    if (!format && Array.isArray(materiau.formats) && materiau.formats.length) {
      var premier = materiau.formats[0];
      if (premier && premier.largeur > 0 && premier.longueur > 0) {
        format = {
          largeurCarreau: premier.largeur / 100,
          longueurCarreau: premier.longueur / 100
        };
      }
    }

    if (format) {
      reglages.largeurCarreau = format.largeurCarreau;
      reglages.longueurCarreau = format.longueurCarreau;
    }

    var rotation = materiau.rotation_aleatoire;
    if (rotation === undefined) rotation = materiau.rotationAleatoire;
    if (typeof rotation === "boolean") reglages.rotationAleatoire = rotation;

    /* Un matériau qui déclare un schéma se pose en opus par défaut : c'est
       pour cela qu'il est débité ainsi. La clé est renseignée dans les deux
       cas, y compris à false — sans quoi, en passant d'un travertin à un
       Halley, le réglage de l'un resterait accroché à l'autre, qui n'a aucun
       module à poser. */
    reglages.poseOpus = typeof materiau.schema_pose === "string" &&
      materiau.schema_pose !== "";

    return reglages;
  }

  /**
   * Applique à UNE surface les réglages recommandés par un matériau.
   *
   * Les autres surfaces ne sont pas touchées : c'est ce qui permet à chaque
   * paroi de garder son format et sa rotation propres. Les valeurs posées ici
   * restent modifiables à la main ensuite, ce ne sont que des propositions.
   *
   * Retourne les réglages effectivement appliqués.
   */
  function appliquerMateriau(surface, materiau) {
    var reglages = reglagesDepuisMateriau(materiau);
    if (!surface) return reglages;

    Object.keys(reglages).forEach(function (cle) {
      surface[cle] = reglages[cle];
    });

    return reglages;
  }

  // --- Plan vu du dessus -----------------------------------------------------

  var PLAN_DEFAUT = {
    largeurMax: 236,  // px disponibles dans le panneau
    hauteurMax: 148,
    coteMin: 46       // en deçà, une bande deviendrait impossible à viser
  };

  /**
   * Géométrie du schéma de la pièce vue du dessus, en pixels.
   *
   * Repère de l'écran calqué sur celui du monde : X vers la droite, Z vers le
   * bas. Le mur nord (z négatif) est donc en haut, le sud en bas, l'ouest à
   * gauche, l'est à droite.
   *
   * Les bandes murales sont coupées d'onglet aux angles : deux murs voisins
   * partagent une arête sans se recouvrir, et les cinq zones pavent exactement
   * le rectangle.
   *
   * Les proportions sont respectées tant que la pièce reste raisonnablement
   * proportionnée. Au-delà — un couloir de 30 m sur 1 m — le petit côté est
   * ramené à `coteMin` : la fidélité ne vaut pas une bande de deux pixels.
   */
  function plan(longueur, largeur, options) {
    var reglages = options || {};
    var largeurMax = reglages.largeurMax || PLAN_DEFAUT.largeurMax;
    var hauteurMax = reglages.hauteurMax || PLAN_DEFAUT.hauteurMax;
    var coteMin = reglages.coteMin || PLAN_DEFAUT.coteMin;

    var rapport = (longueur > 0 && largeur > 0) ? longueur / largeur : 1;

    var w = largeurMax;
    var h = w / rapport;

    if (h > hauteurMax) {
      h = hauteurMax;
      w = h * rapport;
    }

    var proportionnel = w >= coteMin && h >= coteMin;

    w = Math.min(largeurMax, Math.max(coteMin, w));
    h = Math.min(hauteurMax, Math.max(coteMin, h));

    // Épaisseur des bandes : assez large pour être visée, assez fine pour
    // laisser au sol une zone utile.
    var petitCote = Math.min(w, h);
    var t = Math.max(5, Math.min(14, petitCote * 0.18));
    t = Math.max(4, Math.min(t, petitCote / 2 - 5));

    return {
      largeur: w,
      hauteur: h,
      epaisseur: t,
      proportionnel: proportionnel,
      zones: [
        { id: "nord", titre: "Mur nord", points: [[0, 0], [w, 0], [w - t, t], [t, t]] },
        { id: "est", titre: "Mur est", points: [[w, 0], [w, h], [w - t, h - t], [w - t, t]] },
        { id: "sud", titre: "Mur sud", points: [[w, h], [0, h], [t, h - t], [w - t, h - t]] },
        { id: "ouest", titre: "Mur ouest", points: [[0, h], [0, 0], [t, t], [t, h - t]] },
        { id: "sol", titre: "Sol", points: [[t, t], [w - t, t], [w - t, h - t], [t, h - t]] }
      ]
    };
  }

  // --- Métré -----------------------------------------------------------------

  /** Centimètres lisibles : 60, 22,5… */
  function cm(metres) {
    var valeur = Math.round(metres * 1000) / 10;
    return String(valeur).replace(".", ",");
  }

  /**
   * Format posé sur une surface, tel qu'il s'écrit au métré.
   *
   * `resultat` est facultatif : donné, et s'il vient d'un schéma de pose, le
   * format réglé au panneau ne veut plus rien dire — le module en impose
   * plusieurs, et c'est son nom qu'il faut lire.
   */
  function format(surface, resultat) {
    if (resultat && resultat.schemaLibelle) return resultat.schemaLibelle;
    return cm(surface.largeurCarreau) + "×" + cm(surface.longueurCarreau);
  }

  /**
   * Référence commandable d'une surface : ce qui distingue deux lots à
   * commander séparément, soit le matériau et le format.
   */
  function reference(surface, nomTexture) {
    if (surface.texture) {
      return (nomTexture && nomTexture(surface.texture)) || surface.texture;
    }
    return "Couleur " + String(surface.couleur).toUpperCase();
  }

  /**
   * Agrège les métrés des surfaces carrelées.
   *
   * `entrees` : [{ surface, resultat }] où `resultat` vient de
   * Calepinage.calculer. Seules les surfaces effectivement carrelées y figurent.
   *
   * Le total est aussi regroupé par référence et par format : additionner des
   * carreaux de formats différents en un seul nombre ne donnerait rien de
   * commandable.
   */
  function agreger(entrees, chute, nomTexture) {
    var detail = [];
    var groupes = {};
    var ordre = [];
    var ensemble = { entiers: 0, coupes: 0, total: 0, surfacePosee: 0 };

    var pourcentage = chute > 0 ? chute : 0;

    entrees.forEach(function (entree) {
      var surface = entree.surface;
      var resultat = entree.resultat;

      detail.push({
        id: surface.id,
        nom: surface.nom,
        court: surface.court,
        format: format(surface, resultat),
        entiers: resultat.entiers,
        coupes: resultat.coupes,
        total: resultat.total,
        surfacePosee: resultat.surfacePosee,
        // Le détail par format, pour un opus seul. Null ailleurs.
        formats: resultat.formats || null
      });

      ensemble.entiers += resultat.entiers;
      ensemble.coupes += resultat.coupes;
      ensemble.total += resultat.total;
      ensemble.surfacePosee += resultat.surfacePosee;

      var libelle = reference(surface, nomTexture);

      /* Un lot par format à commander. Une pose ordinaire n'en a qu'un ; un
         opus en a autant que son module compte de tailles, et les fondre en
         un seul chiffre donnerait un bon de commande inexécutable. */
      var lots = resultat.formats && resultat.formats.length
        ? resultat.formats.map(function (f) {
            return { format: f.format, total: f.total };
          })
        : [{ format: format(surface, resultat), total: resultat.total }];

      lots.forEach(function (lot) {
        var cle = libelle + " | " + lot.format;

        if (!groupes[cle]) {
          groupes[cle] = {
            reference: libelle,
            format: lot.format,
            total: 0,
            surfaces: []
          };
          ordre.push(cle);
        }

        groupes[cle].total += lot.total;
        if (groupes[cle].surfaces.indexOf(surface.nom) === -1) {
          groupes[cle].surfaces.push(surface.nom);
        }
      });
    });

    var commandes = ordre.map(function (cle) {
      var groupe = groupes[cle];
      groupe.totalAvecChute = Math.ceil(groupe.total * (1 + pourcentage / 100));
      return groupe;
    });

    return {
      detail: detail,
      commandes: commandes,
      ensemble: ensemble,
      chute: pourcentage,
      totalAvecChute: Math.ceil(ensemble.total * (1 + pourcentage / 100)),
      // Vrai dès que plusieurs lots distincts sont à commander : le total
      // global n'est alors qu'un cumul, pas une quantité à commander.
      lotsMultiples: commandes.length > 1
    };
  }

  global.Surfaces = {
    REGLAGES: REGLAGES,
    DEFAUTS: DEFAUTS,
    DESCRIPTION: DESCRIPTION,
    creer: creer,
    trouver: trouver,
    copier: copier,
    copierVersMurs: copierVersMurs,
    dimensions: dimensions,
    plan: plan,
    formatDepuisTexte: formatDepuisTexte,
    reglagesDepuisMateriau: reglagesDepuisMateriau,
    appliquerMateriau: appliquerMateriau,
    optionsCalepinage: optionsCalepinage,
    agreger: agreger,
    format: format,
    reference: reference
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.Surfaces;
  }
})(typeof window !== "undefined" ? window : globalThis);
