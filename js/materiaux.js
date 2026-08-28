/**
 * Catalogue 3D — matériaux PBR
 *
 * Charge catalogue/materiaux.json (produit par outils/indexer-textures.js) et
 * applique un jeu de cartes PBR sur un PBRMaterial de Babylon.
 *
 * Deux dispositions de cartes sont acceptées :
 *
 *   - carte « orm » unique, canaux R = occlusion, V = rugosité, B = métal.
 *     C'est la convention glTF, consommée telle quelle par Babylon.
 *
 *   - cartes séparées (occlusion / rugosite / metallique), disposition la plus
 *     répandue dans les bibliothèques en ligne. Babylon n'a pas d'emplacement
 *     pour des cartes de rugosité et de métallicité distinctes : on les
 *     recompose donc en une carte ORM dans un canvas, au chargement.
 */
(function (global) {
  "use strict";

  var CHEMIN_CATALOGUE = "catalogue/materiaux.json";

  // Valeurs par défaut d'un carreau céramique, appliquées quand la carte
  // correspondante est absente du jeu.
  var DEFAUTS = {
    rugosite: 0.35,
    metallique: 0.0
  };

  /* Rugosité plancher, pour une fiche qui déclarerait la sienne. À zéro, la
     surface devient un miroir parfait : sous un environnement HDRI, elle
     renvoie le studio au lieu du carreau, et l'on ne voit plus la texture.
     Aucun carrelage n'est un miroir, pas même un poli brillant. */
  var RUGOSITE_MIN = 0.2;

  /** Rugosité d'une fiche, jamais assez basse pour faire un miroir. */
  function rugositeDe(materiau) {
    var valeur = materiau.rugosite !== undefined
      ? materiau.rugosite : DEFAUTS.rugosite;
    return Math.max(RUGOSITE_MIN, valeur);
  }

  /* Métallicité d'une fiche. Un carreau céramique n'est pas un métal : sa
     réflexion est celle d'un diélectrique, et la monter donnerait une
     tôle colorée. Le zéro par défaut est le bon, et la borne haute évite
     qu'une fiche l'oublie. */
  function metalliciteDe(materiau) {
    var valeur = materiau.metallique !== undefined
      ? materiau.metallique : DEFAUTS.metallique;
    return Math.min(1, Math.max(0, valeur));
  }

  var catalogue = [];

  // --- Chargement du catalogue ---------------------------------------------

  /**
   * Récupère la liste des matériaux.
   * Résout toujours : en cas d'échec, l'objet porte un champ `erreur`.
   */
  function charger(base) {
    if (typeof fetch !== "function") {
      return Promise.resolve({ erreur: "fetch indisponible dans ce navigateur." });
    }

    return fetch(base + CHEMIN_CATALOGUE)
      .then(function (reponse) {
        if (!reponse.ok) throw new Error("HTTP " + reponse.status);
        return reponse.json();
      })
      .then(function (donnees) {
        catalogue = (donnees.materiaux || []).filter(function (m) {
          return m && m.id && m.cartes;
        });
        return { materiaux: catalogue };
      })
      .catch(function (e) {
        // Cas de très loin le plus fréquent : page ouverte en file://.
        var enLocal = global.location && global.location.protocol === "file:";
        return {
          erreur: enLocal
            ? "Les textures exigent un serveur HTTP : lance « node outils/serveur.js » " +
              "puis ouvre http://localhost:8080/ (en file://, le navigateur refuse " +
              "de lire le catalogue et d'échantillonner les images locales)."
            : "Catalogue de matériaux illisible (" + e.message + "). " +
              "Lance « node outils/indexer-textures.js » pour le régénérer."
        };
      });
  }

  function parId(identifiant) {
    for (var i = 0; i < catalogue.length; i++) {
      if (catalogue[i].id === identifiant) return catalogue[i];
    }
    return null;
  }

  // --- Recomposition d'une carte ORM ---------------------------------------

  function chargerImage(url) {
    return new Promise(function (resoudre, rejeter) {
      var image = new Image();
      image.onload = function () { resoudre(image); };
      image.onerror = function () { rejeter(new Error("Image illisible : " + url)); };
      image.src = url;
    });
  }

  /** Pixels d'une image, redimensionnée si besoin. */
  function lirePixels(image, largeur, hauteur) {
    var canevas = document.createElement("canvas");
    canevas.width = largeur;
    canevas.height = hauteur;

    var contexte = canevas.getContext("2d");
    contexte.drawImage(image, 0, 0, largeur, hauteur);

    return contexte.getImageData(0, 0, largeur, hauteur).data;
  }

  /**
   * Assemble occlusion / rugosité / métallicité en une seule carte ORM.
   * Retourne { url, pilotees } où `pilotees` indique quels canaux proviennent
   * réellement d'une carte — les autres restent pilotés par un scalaire.
   */
  function composerOrm(urls) {
    var canaux = [
      { cle: "occlusion", decalage: 0, defaut: 255 },
      { cle: "rugosite", decalage: 1, defaut: 255 },
      { cle: "metallique", decalage: 2, defaut: 255 }
    ];

    var presents = canaux.filter(function (c) { return urls[c.cle]; });

    return Promise.all(presents.map(function (c) {
      return chargerImage(urls[c.cle]).then(function (img) {
        return { canal: c, image: img };
      });
    })).then(function (charges) {
      // La plus grande carte impose la définition commune.
      var largeur = 1, hauteur = 1;
      charges.forEach(function (c) {
        largeur = Math.max(largeur, c.image.naturalWidth);
        hauteur = Math.max(hauteur, c.image.naturalHeight);
      });

      var canevas = document.createElement("canvas");
      canevas.width = largeur;
      canevas.height = hauteur;

      var contexte = canevas.getContext("2d");
      var sortie = contexte.createImageData(largeur, hauteur);
      var pixels = sortie.data;

      // Remplissage neutre, puis écrasement canal par canal.
      for (var i = 0; i < pixels.length; i += 4) {
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 255;
        pixels[i + 3] = 255;
      }

      var pilotees = {};

      charges.forEach(function (charge) {
        var source = lirePixels(charge.image, largeur, hauteur);
        var decalage = charge.canal.decalage;

        // Cartes en niveaux de gris : le canal rouge suffit.
        for (var p = 0; p < pixels.length; p += 4) {
          pixels[p + decalage] = source[p];
        }
        pilotees[charge.canal.cle] = true;
      });

      contexte.putImageData(sortie, 0, 0);

      // Data URL plutôt que RawTexture : le chemin de chargement est alors le
      // même que pour les autres cartes, donc même traitement de l'axe V.
      return { url: canevas.toDataURL("image/png"), pilotees: pilotees };
    });
  }

  // --- Atlas de tampons ------------------------------------------------------

  /**
   * Assemble les tampons d'un matériau en une seule image, côte à côte.
   *
   * Pourquoi un atlas : tous les carreaux d'une surface partagent un maillage
   * et un matériau uniques. Faire varier leur dessin ne peut donc pas passer
   * par plusieurs textures — c'est aux UV de désigner, carreau par carreau, la
   * case de l'atlas à échantillonner.
   */
  function composerAtlas(urls) {
    return Promise.all(urls.map(chargerImage)).then(function (images) {
      var largeur = 0, hauteur = 0;
      images.forEach(function (img) {
        largeur = Math.max(largeur, img.naturalWidth);
        hauteur = Math.max(hauteur, img.naturalHeight);
      });

      var canevas = document.createElement("canvas");
      canevas.width = largeur * images.length;
      canevas.height = hauteur;

      var contexte = canevas.getContext("2d");
      images.forEach(function (img, rang) {
        contexte.drawImage(img, rang * largeur, 0, largeur, hauteur);
      });

      return {
        url: canevas.toDataURL("image/png"),
        nombre: images.length,
        largeurCase: largeur
      };
    });
  }

  /**
   * Teinte d'ajustement déclarée par une fiche, ou le blanc.
   *
   * Elle multiplie la carte d'albédo : au-dessus de 1 elle éclaircit, en
   * dessous elle assombrit. C'est le rattrapage d'un scan terne — un carreau
   * photographié dans le magasin ne rend pas la lumière qu'il a en vitrine —
   * sans repasser sur les images : les PNG restent la prise de vue d'origine,
   * et la correction se relit dans le catalogue, chiffre à l'appui.
   *
   * Trois nombres, dans l'ordre rouge, vert, bleu. Les écarter légèrement
   * colore la correction ; les garder égaux ne fait que monter la lumière.
   */
  function teinteDeFiche(materiau) {
    var t = materiau && materiau.teinte;
    if (!Array.isArray(t) || t.length < 3) return BABYLON.Color3.White();
    return new BABYLON.Color3(t[0], t[1], t[2]);
  }

  /** Tampons déclarés par une fiche, ou la seule carte d'albédo. */
  function tampons(materiau) {
    if (materiau && Array.isArray(materiau.tampons) && materiau.tampons.length > 1) {
      return materiau.tampons.slice();
    }
    return materiau && materiau.cartes && materiau.cartes.albedo
      ? [materiau.cartes.albedo]
      : [];
  }

  /** Nombre de tampons d'un matériau du catalogue. */
  function nombreTampons(identifiant) {
    var materiau = parId(identifiant);
    return materiau ? Math.max(1, tampons(materiau).length) : 1;
  }

  /**
   * Schéma de pose multi-formats déclaré par une fiche, ou null.
   *
   * Le champ `schema_pose` ne nomme qu'un schéma ; c'est OpusSchemas qui le
   * définit. La fiche ne décrit donc jamais un découpage elle-même — un opus
   * bancal viendrait d'un fichier de catalogue, échapperait aux contrôles de
   * `OpusSchemas.verifier` et se verrait à l'écran, pas au chargement.
   *
   * Un nom inconnu est signalé et ignoré : mieux vaut le carrelage droit que
   * pas de sol du tout.
   */
  function schemaPose(identifiant) {
    var materiau = parId(identifiant);
    if (!materiau || !materiau.schema_pose) return null;

    if (typeof OpusSchemas === "undefined") {
      console.warn("Schéma de pose « " + materiau.schema_pose +
        " » demandé, mais opus-schemas.js n'est pas chargé.");
      return null;
    }

    var schema = OpusSchemas.schema(materiau.schema_pose);
    if (!schema) {
      console.warn("Schéma de pose inconnu : " + materiau.schema_pose +
        " (" + identifiant + "). Pose droite par défaut.");
    }
    return schema;
  }

  // --- Application sur un matériau -----------------------------------------

  function creerTexture(url, scene, lineaire) {
    var texture = new BABYLON.Texture(url, scene);
    // Les cartes de données (normales, ORM) ne doivent pas subir la correction
    // gamma : seule la couleur de base est stockée en espace sRGB.
    texture.gammaSpace = !lineaire;
    return texture;
  }

  /** Libère les textures posées par une application précédente. */
  function retirer(materiauBabylon) {
    var anciennes = materiauBabylon._texturesCatalogue || [];
    anciennes.forEach(function (t) { t.dispose(); });
    materiauBabylon._texturesCatalogue = [];

    materiauBabylon.albedoTexture = null;
    materiauBabylon.bumpTexture = null;
    materiauBabylon.metallicTexture = null;
    materiauBabylon.ambientTexture = null;
  }

  /**
   * Applique un matériau du catalogue sur un PBRMaterial.
   * Résout avec { erreur } si une carte est introuvable.
   */
  function appliquer(materiauBabylon, identifiant, scene, base) {
    var materiau = parId(identifiant);
    if (!materiau) return Promise.resolve({ erreur: "Matériau inconnu : " + identifiant });

    retirer(materiauBabylon);

    var cartes = materiau.cartes;
    var url = function (cle) { return cartes[cle] ? base + cartes[cle] : null; };
    var posees = [];

    // Répétition de la texture à l'intérieur d'un carreau. Les UV du
    // calepinage couvrent [0,1] par carreau : 1 = une texture par carreau.
    var echelle = materiau.echelle > 0 ? materiau.echelle : 1;

    function reglerEchelle(texture) {
      texture.uScale = echelle;
      texture.vScale = echelle;
      posees.push(texture);
      return texture;
    }

    /* Les tampons vivent dans un atlas échantillonné par le premier jeu d'UV.
       Les cartes de relief, elles, restent communes à tous les tampons et
       gardent donc le second jeu, qui couvre [0,1] par carreau. */
    var listeTampons = tampons(materiau);
    var multiTampons = listeTampons.length > 1;

    var suiteAlbedo = Promise.resolve();
    var teinte = teinteDeFiche(materiau);

    if (multiTampons) {
      suiteAlbedo = composerAtlas(listeTampons.map(function (c) { return base + c; }))
        .then(function (atlas) {
          var texture = reglerEchelle(creerTexture(atlas.url, scene, false));
          texture.coordinatesIndex = 0;
          materiauBabylon.albedoTexture = texture;
          materiauBabylon.albedoColor = teinte;
        });
    } else if (cartes.albedo) {
      var albedo = reglerEchelle(creerTexture(url("albedo"), scene, false));
      albedo.coordinatesIndex = 0;
      materiauBabylon.albedoTexture = albedo;
      materiauBabylon.albedoColor = teinte;
    }

    // Nombre de cases de l'atlas, lu par la scène pour construire les UV.
    materiauBabylon.nombreTampons = Math.max(1, listeTampons.length);

    if (cartes.normal) {
      materiauBabylon.bumpTexture = reglerEchelle(creerTexture(url("normal"), scene, true));
      materiauBabylon.bumpTexture.coordinatesIndex = multiTampons ? 1 : 0;
      // Les cartes DirectX ont le vert inversé par rapport à la convention
      // OpenGL retenue par Babylon.
      materiauBabylon.invertNormalMapY = materiau.normalesDirectX === true;
    }

    var suite;

    if (cartes.orm) {
      var ormTexture = reglerEchelle(creerTexture(url("orm"), scene, true));
      ormTexture.coordinatesIndex = multiTampons ? 1 : 0;
      materiauBabylon.metallicTexture = ormTexture;
      materiauBabylon.useAmbientOcclusionFromMetallicTextureRed = true;
      materiauBabylon.useRoughnessFromMetallicTextureGreen = true;
      materiauBabylon.useMetallnessFromMetallicTextureBlue = true;
      materiauBabylon.useRoughnessFromMetallicTextureAlpha = false;
      // La carte pilote entièrement les deux grandeurs.
      materiauBabylon.roughness = 1;
      materiauBabylon.metallic = 1;
      suite = Promise.resolve({});
    } else if (cartes.rugosite || cartes.metallique || cartes.occlusion) {
      suite = composerOrm({
        occlusion: url("occlusion"),
        rugosite: url("rugosite"),
        metallique: url("metallique")
      }).then(function (compose) {
        var texture = reglerEchelle(creerTexture(compose.url, scene, true));
        materiauBabylon.metallicTexture = texture;
        materiauBabylon.useAmbientOcclusionFromMetallicTextureRed = true;
        materiauBabylon.useRoughnessFromMetallicTextureGreen = true;
        materiauBabylon.useMetallnessFromMetallicTextureBlue = true;
        materiauBabylon.useRoughnessFromMetallicTextureAlpha = false;

        /* Un canal sans carte reste à 255 : le scalaire correspondant en
           devient le pilote, d'où le repli sur les valeurs du catalogue.
           Quand la carte pilote, le scalaire vaut 1 — c'est un multiplicateur,
           pas une valeur, et l'abaisser étoufferait la carte. */
        materiauBabylon.roughness = compose.pilotees.rugosite
          ? 1
          : rugositeDe(materiau);
        materiauBabylon.metallic = compose.pilotees.metallique
          ? 1
          : metalliciteDe(materiau);

        return {};
      });
    } else {
      // Aucune carte de réflectance : tout repose sur les scalaires.
      materiauBabylon.metallicTexture = null;
      materiauBabylon.roughness = rugositeDe(materiau);
      materiauBabylon.metallic = metalliciteDe(materiau);
      suite = Promise.resolve({});
    }

    return Promise.all([suite, suiteAlbedo])
      .then(function () {
        materiauBabylon._texturesCatalogue = posees;
        return { materiau: materiau, tampons: listeTampons.length };
      })
      .catch(function (e) {
        materiauBabylon._texturesCatalogue = posees;
        return { erreur: "Cartes du matériau « " + materiau.nom + " » illisibles : " + e.message };
      });
  }

  global.Materiaux = {
    charger: charger,
    appliquer: appliquer,
    retirer: retirer,
    parId: parId,
    tampons: tampons,
    nombreTampons: nombreTampons,
    schemaPose: schemaPose,
    liste: function () { return catalogue.slice(); }
  };
})(typeof window !== "undefined" ? window : globalThis);
