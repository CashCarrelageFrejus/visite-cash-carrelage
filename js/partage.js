/**
 * Catalogue 3D — partage d'une visite par lien
 *
 * Emballe l'état du projet courant dans l'ancre d'une URL, que visite.html
 * déballe pour rejouer la scène en lecture seule. Rien ne transite par un
 * serveur : l'ancre reste dans le navigateur, le lien se colle dans un mail.
 *
 * Trois soucis gouvernent le format :
 *
 *   - La taille. Une ancre voyage dans un corps de mail, où les clients
 *     coupent les longues lignes. On abrège donc les clés, on arrondit les
 *     nombres au dixième de millimètre, et l'on ne verse la maison qu'une
 *     fois — son modèle répète ses murs et ses pièces au niveau puis en tête,
 *     et les écrire deux fois doublerait le lien pour rien.
 *
 *   - La robustesse. Un lien tronqué par un client de messagerie ne doit pas
 *     casser la page : la lecture ne lève jamais, et tout champ manquant
 *     retombe sur la valeur par défaut du modèle.
 *
 *   - La fidélité. Ce qui est relu doit bâtir la même maison, sans quoi le
 *     client visite autre chose que ce qu'on lui a montré. Le modèle de la
 *     maison est donc recopié tel quel plutôt que champ par champ : une
 *     énumération se démoderait en silence à la première évolution du plan.
 *
 * Module IIFE. Le codage et l'arrondi sont des fonctions pures, vérifiables
 * sous Node ; seules la capture et la restauration touchent à la scène.
 */
(function (global) {
  "use strict";

  /** Version du format d'ancre. Un lien d'une autre version est refusé. */
  var VERSION = 1;

  var PAGE_VISITE = "visite.html";

  /**
   * Adresse publique de la visite, en ligne.
   *
   * C'est la seule ligne à changer le jour où le dépôt change de nom ou de
   * compte. Laissée vide, l'application retombe sur le lien relatif — ce
   * qu'elle faisait avant la mise en ligne, et qui reste juste tant que la
   * page et la visite sont voisines.
   *
   * La barre oblique finale compte : l'adresse désigne le dossier publié, et
   * c'est son index.html qui est la visite.
   */
  var URL_PUBLIQUE = "https://cashcarrelagefrejus.github.io/visite-cash-carrelage/";

  /**
   * Choisit entre le lien public et le lien local.
   *
   * Par défaut, dès qu'une adresse publique est renseignée, c'est elle qui
   * part : un lien collé dans un mail doit s'ouvrir chez le client, pas
   * pointer vers un poste du magasin. Reste le cas de l'essai — on veut alors
   * vérifier une visite avant de la publier. Ajouter « ?lien=local » à
   * l'adresse de l'application suffit à récupérer le lien du voisinage.
   *
   * Ce garde-fou ne joue qu'en local : sur une application déjà servie en
   * ligne, un lien relatif serait tout aussi bon, et le paramètre n'aurait
   * plus rien à corriger.
   */
  function enLocal() {
    var hote = global.location ? global.location.hostname : "";
    return hote === "localhost" || hote === "127.0.0.1" || hote === "::1" ||
           hote === "" || /^192\.168\./.test(hote);
  }

  function lienPublicVoulu() {
    if (!URL_PUBLIQUE) return false;

    var requete = global.location ? global.location.search : "";
    if (/[?&]lien=local\b/.test(requete)) return !enLocal();
    if (/[?&]lien=public\b/.test(requete)) return true;

    return true;
  }

  /* Précision retenue pour tout nombre versé au lien : le dixième de
     millimètre pour les longueurs, 1e-4 radian pour les angles — six
     millièmes de degré, soit un millimètre de dérive sur un mur de dix
     mètres. En deçà, on n'écrirait que du bruit de virgule flottante, et
     chaque décimale inutile est un caractère de plus dans le mail. */
  var DECIMALES = 4;

  /**
   * Clés abrégées des réglages d'habillage.
   *
   * Ces réglages sont les seuls à se répéter cinq fois pour la pièce et
   * autant de fois qu'il y a de murs repris à la main : c'est là que
   * l'abréviation paye. Le reste du modèle garde ses noms.
   */
  var CLES_REGLAGES = {
    mode: "m",
    texture: "t",
    couleur: "c",
    motif: "o",
    largeurCarreau: "lc",
    longueurCarreau: "gc",
    joint: "j",
    rotationAleatoire: "ra",
    poseOpus: "po"
  };

  /**
   * Marque d'un tableau porteur de propriétés.
   *
   * Les zones d'escalier voyagent sous cette forme : un tableau de points,
   * plus un champ `source` qui porte les cotes reprises à la main. JSON les
   * perdrait sans bruit — un tableau ne sérialise que ses éléments — et
   * l'escalier se rebâtirait aux cotes déduites du tracé.
   */
  var MARQUE_TABLEAU = "@t";

  /** Noyau de scene.js, reçu par installer(). Nul hors de l'application. */
  var N = null;

  // ---------------------------------------------------------------------------
  // Codage — fonctions pures
  // ---------------------------------------------------------------------------

  function _arrondir(valeur) {
    if (!isFinite(valeur)) return 0;
    var facteur = Math.pow(10, DECIMALES);
    return Math.round(valeur * facteur) / facteur;
  }

  /**
   * Recopie une valeur en arrondissant tous ses nombres.
   *
   * Générique à dessein : le modèle de la maison est copié tel quel, sans
   * énumérer ses champs. Il évolue — un niveau a gagné ses escaliers, une
   * ouverture sa marque d'entrée — et une énumération aurait laissé filer
   * ces ajouts sans que rien ne le signale.
   */
  function compacter(valeur) {
    if (typeof valeur === "number") return _arrondir(valeur);
    if (valeur === null || typeof valeur !== "object") return valeur;

    if (Array.isArray(valeur)) {
      var elements = valeur.map(compacter);

      /* Les propriétés posées sur un tableau : rares, mais porteuses de
         sens. On les met à l'abri dans un objet plutôt que de les perdre. */
      var extras = Object.keys(valeur).filter(function (cle) {
        return !/^\d+$/.test(cle) && cle !== "length";
      });
      if (!extras.length) return elements;

      var enveloppe = {};
      enveloppe[MARQUE_TABLEAU] = elements;
      extras.forEach(function (cle) {
        enveloppe[cle] = compacter(valeur[cle]);
      });
      return enveloppe;
    }

    var copie = {};
    Object.keys(valeur).forEach(function (cle) {
      var v = valeur[cle];
      // Une fonction ou un indéfini n'a rien à faire dans un lien.
      if (typeof v === "function" || v === undefined) return;
      copie[cle] = compacter(v);
    });
    return copie;
  }

  /** Inverse de compacter : rend aux tableaux marqués leurs propriétés. */
  function decompacter(valeur) {
    if (valeur === null || typeof valeur !== "object") return valeur;

    if (Array.isArray(valeur)) return valeur.map(decompacter);

    if (Object.prototype.hasOwnProperty.call(valeur, MARQUE_TABLEAU)) {
      var brut = valeur[MARQUE_TABLEAU];
      var tableau = Array.isArray(brut) ? brut.map(decompacter) : [];

      Object.keys(valeur).forEach(function (cle) {
        if (cle !== MARQUE_TABLEAU) tableau[cle] = decompacter(valeur[cle]);
      });
      return tableau;
    }

    var copie = {};
    Object.keys(valeur).forEach(function (cle) {
      copie[cle] = decompacter(valeur[cle]);
    });
    return copie;
  }

  // --- Base64 URL-safe -------------------------------------------------------

  /* btoa ne connaît que le Latin-1 : « Chantier Frégeat » le ferait lever.
     On passe donc par UTF-8, converti en chaîne d'octets, avant de coder. */

  function _versOctets(texte) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(texte);

    // Repli pour un moteur sans TextEncoder : encodeURIComponent produit le
    // même UTF-8, en pourcent-codage.
    var echappe = encodeURIComponent(texte);
    var octets = [];
    for (var i = 0; i < echappe.length; i++) {
      if (echappe[i] === "%") {
        octets.push(parseInt(echappe.substr(i + 1, 2), 16));
        i += 2;
      } else {
        octets.push(echappe.charCodeAt(i));
      }
    }
    return octets;
  }

  function _depuisOctets(octets) {
    if (typeof TextDecoder === "function") {
      return new TextDecoder().decode(new Uint8Array(octets));
    }

    var pourcent = "";
    for (var i = 0; i < octets.length; i++) {
      pourcent += "%" + ("0" + octets[i].toString(16)).slice(-2);
    }
    return decodeURIComponent(pourcent);
  }

  /** Objet → base64 URL-safe, sans remplissage. */
  function encoder(valeur) {
    var octets = _versOctets(JSON.stringify(compacter(valeur)));

    var binaire = "";
    for (var i = 0; i < octets.length; i++) {
      binaire += String.fromCharCode(octets[i]);
    }

    return btoa(binaire)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  /** base64 URL-safe → objet, ou null si la chaîne ne tient pas debout. */
  function decoder(chaine) {
    if (typeof chaine !== "string" || !chaine) return null;

    try {
      var base64 = chaine.replace(/-/g, "+").replace(/_/g, "/");

      // Le remplissage a été retiré à l'écriture : atob l'exige au retour.
      while (base64.length % 4) base64 += "=";

      var binaire = atob(base64);
      var octets = new Array(binaire.length);
      for (var i = 0; i < binaire.length; i++) {
        octets[i] = binaire.charCodeAt(i);
      }

      return decompacter(JSON.parse(_depuisOctets(octets)));
    } catch (e) {
      // Lien tronqué par un client de messagerie, collé de travers, ou
      // vieilli : la page appelante affichera son message, pas une trace.
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Réglages d'habillage — abrégés à l'aller, complétés au retour
  // ---------------------------------------------------------------------------

  /**
   * Réglages abrégés d'une surface ou d'un mur.
   *
   * L'identité de la surface (`id`, `nom`, `court`, `type`) est conservée en
   * clair : elle est lue par la fiche des matériaux de la visite, et il n'y
   * en a qu'une poignée.
   */
  function compacterReglages(source) {
    var abrege = {};

    ["id", "nom", "court", "type"].forEach(function (cle) {
      if (source[cle] !== undefined) abrege[cle] = source[cle];
    });

    Object.keys(CLES_REGLAGES).forEach(function (cle) {
      if (source[cle] === undefined) return;
      var valeur = source[cle];
      abrege[CLES_REGLAGES[cle]] =
        typeof valeur === "number" ? _arrondir(valeur) : valeur;
    });

    return abrege;
  }

  /**
   * Réglages relus, complétés par les valeurs par défaut du modèle.
   *
   * Un champ absent — lien d'une version antérieure, réglage ajouté depuis —
   * ne laisse jamais un indéfini filer vers le calepinage, qui bâtirait des
   * carreaux de taille NaN.
   */
  function lireReglages(abrege, defauts) {
    var reglages = {};
    var base = defauts || (global.Surfaces ? global.Surfaces.DEFAUTS : {});
    var lu = abrege || {};

    ["id", "nom", "court", "type"].forEach(function (cle) {
      if (lu[cle] !== undefined) reglages[cle] = lu[cle];
    });

    Object.keys(CLES_REGLAGES).forEach(function (cle) {
      var valeur = lu[CLES_REGLAGES[cle]];
      reglages[cle] = valeur === undefined ? base[cle] : valeur;
    });

    return reglages;
  }

  // ---------------------------------------------------------------------------
  // Capture de l'état courant
  // ---------------------------------------------------------------------------

  /**
   * Champs qu'un mur, une pièce ou une ouverture n'a pas à emporter.
   *
   * `longueur` et `angle` se retrouvent depuis les extrémités du mur ;
   * `altitude` et `niveau` sont ceux de l'étage qui les contient. Les
   * recalculer coûte trois lignes, les écrire coûtait un tiers du lien —
   * et un plan de soixante murs les répète soixante fois.
   */
  var CHAMPS_DEDUITS = ["longueur", "angle", "altitude", "niveau"];

  /** Retire d'un objet les champs que la relecture saura recalculer. */
  function _alleger(objet) {
    var copie = {};
    Object.keys(objet).forEach(function (cle) {
      if (CHAMPS_DEDUITS.indexOf(cle) === -1) copie[cle] = objet[cle];
    });
    return copie;
  }

  /**
   * Rend à un mur ce que l'allègement lui a retiré.
   *
   * La convention d'angle est celle de MursPlan : Babylon tourne autour de Y
   * en repère gaucher, le +X local devient (cos θ, 0, −sin θ). S'en écarter
   * bâtirait la maison à l'envers.
   */
  function _restituerMur(mur, niveau) {
    if (mur.longueur === undefined || mur.angle === undefined) {
      var a = mur.a || [0, 0], b = mur.b || [0, 0];
      var dx = b[0] - a[0], dz = b[1] - a[1];
      if (mur.longueur === undefined) mur.longueur = Math.sqrt(dx * dx + dz * dz);
      if (mur.angle === undefined) mur.angle = Math.atan2(-dz, dx);
    }
    if (mur.altitude === undefined) mur.altitude = niveau.altitude || 0;
    if (mur.niveau === undefined) mur.niveau = niveau.cle;
    return mur;
  }

  function _restituerAppartenance(objet, niveau) {
    if (objet.altitude === undefined) objet.altitude = niveau.altitude || 0;
    if (objet.niveau === undefined) objet.niveau = niveau.cle;
    return objet;
  }

  /**
   * Modèle de la maison, allégé de ses répétitions.
   *
   * `pieces`, `murs` et `ouvertures` de la racine ne sont que la concaténation
   * de ceux des niveaux : les écrire doublerait le lien. On ne verse que les
   * niveaux, et la relecture reconstitue la racine.
   */
  function compacterMaison(maison) {
    if (!maison || !maison.niveaux || !maison.niveaux.length) return null;

    var niveaux = maison.niveaux.map(function (niveau) {
      var copie = compacter(niveau);

      copie.murs = (copie.murs || []).map(_alleger);
      copie.pieces = (copie.pieces || []).map(_alleger);
      copie.ouvertures = (copie.ouvertures || []).map(_alleger);

      return copie;
    });

    return { repere: compacter(maison.repere), niveaux: niveaux };
  }

  /** Rebâtit la racine du modèle et les champs déduits de ses niveaux. */
  function lireMaison(brut) {
    if (!brut || !Array.isArray(brut.niveaux) || !brut.niveaux.length) return null;

    var niveaux = brut.niveaux.filter(function (niveau) {
      return niveau && typeof niveau === "object";
    });
    if (!niveaux.length) return null;

    niveaux.forEach(function (niveau) {
      if (niveau.altitude === undefined) niveau.altitude = 0;

      (niveau.murs || []).forEach(function (mur) { _restituerMur(mur, niveau); });
      (niveau.pieces || []).forEach(function (piece) {
        _restituerAppartenance(piece, niveau);
      });
      (niveau.ouvertures || []).forEach(function (ouverture) {
        _restituerAppartenance(ouverture, niveau);
      });
    });

    function concat(champ) {
      return niveaux.reduce(function (tout, niveau) {
        return tout.concat(niveau[champ] || []);
      }, []);
    }

    return {
      repere:     brut.repere || null,
      contour:    niveaux[0].contour || [],
      niveaux:    niveaux,
      pieces:     concat("pieces"),
      murs:       concat("murs"),
      ouvertures: concat("ouvertures")
    };
  }

  function compacterHabillage(habillage) {
    if (!habillage) return null;

    var parMur = {};
    Object.keys(habillage.parMur || {}).forEach(function (index) {
      parMur[index] = compacterReglages(habillage.parMur[index]);
    });

    return {
      g: compacterReglages(habillage.global),
      pm: parMur
    };
  }

  function lireHabillage(brut) {
    if (!brut) return null;

    var parMur = {};
    Object.keys(brut.pm || {}).forEach(function (index) {
      parMur[index] = lireReglages(brut.pm[index]);
    });

    return {
      global: lireReglages(brut.g),
      parMur: parMur,
      // Aucun mur n'est sélectionné dans une visite : il n'y a rien à régler.
      selection: -1
    };
  }

  /**
   * Point de vue de départ.
   *
   * En pleine visite, c'est là où l'on se tient : on partage ce qu'on est en
   * train de regarder. Sinon, la visite s'ouvrira d'elle-même au cœur de la
   * plus grande pièce — inutile de figer un point de vue que l'on n'a pas
   * choisi, et c'est autant de caractères en moins dans le lien.
   */
  function capturerCamera() {
    if (!N || !global.Visite || !global.Visite.active()) return null;

    var camera = N.scene() && N.scene().activeCamera;
    if (!camera || camera.name !== "visite") return null;

    return {
      p: [_arrondir(camera.position.x), _arrondir(camera.position.z)],
      r: [_arrondir(camera.rotation.x), _arrondir(camera.rotation.y)]
    };
  }

  /**
   * Le mobilier posé, tel qu'il se range déjà dans le stockage local.
   *
   * Sans lui, le client visiterait une maison vide là où on lui a montré une
   * pièce meublée — et le vendeur, lui, verrait ses propres meubles revenir
   * du stockage de son navigateur, croyant les avoir envoyés.
   */
  function capturerMobilier() {
    if (!N || !N.mobilierScene) return [];

    return N.mobilierScene()
      .filter(function (socle) {
        return !socle.isDisposed() && socle.metadata && socle.metadata.fichier;
      })
      .map(function (socle) {
        return {
          f: socle.metadata.fichier,
          x: _arrondir(socle.position.x),
          z: _arrondir(socle.position.z),
          a: _arrondir(socle.rotation.y || 0)
        };
      });
  }

  /** Nom du projet, tel que saisi dans l'application. */
  function nomProjet() {
    var champ = global.document && document.getElementById("nom-projet");
    return champ && champ.value ? champ.value.trim() : "";
  }

  /**
   * État complet du projet, prêt à coder.
   *
   * @returns {Object|null} null si l'application n'est pas installée.
   */
  function capturer() {
    if (!N) return null;

    var etat = {
      v: VERSION,
      p: [_arrondir(N.dims.longueur), _arrondir(N.dims.largeur),
          _arrondir(N.dims.hauteur)],
      s: N.surfaces().map(compacterReglages)
    };

    var nom = nomProjet();
    if (nom) etat.n = nom;

    var maison = compacterMaison(N.maison());
    if (maison) etat.m = maison;

    var habillage = compacterHabillage(N.habillage());
    if (habillage) etat.h = habillage;

    /* L'entrée principale n'est pas dans le modèle de la maison : elle vit
       sur MursPlan, et c'est elle qui décide par où l'on entre en visite. */
    if (global.MursPlan && MursPlan.entreeId !== null &&
        MursPlan.entreeId !== undefined) {
      etat.e = MursPlan.entreeId;
    }

    var mobilier = capturerMobilier();
    if (mobilier.length) etat.f = mobilier;

    var camera = capturerCamera();
    if (camera) etat.c = camera;

    return etat;
  }

  // ---------------------------------------------------------------------------
  // Lecture d'un état reçu
  // ---------------------------------------------------------------------------

  /**
   * État relu et complété, quoi qu'on lui donne.
   *
   * Ne lève jamais et rend toujours un état exploitable : c'est la seule
   * garantie qui compte, la page de visite n'ayant personne pour la
   * dépanner. Un lien illisible se reconnaît à `valide` faux.
   */
  function normaliser(brut) {
    var lu = (brut && typeof brut === "object") ? brut : {};

    /* Les cinq surfaces sont toujours rendues, même quand le lien ne porte
       rien : la scène en attend cinq, et une pièce sans sol n'existe pas.
       Celles qui manquent prennent les réglages par défaut du modèle.

       C'est vrai jusque pour une ancre illisible. Un appelant qui négligerait
       `valide` obtiendrait alors une pièce fade, jamais un plantage — la page
       de visite n'a personne pour la dépanner. */
    var recues = {};
    (Array.isArray(lu.s) ? lu.s : []).forEach(function (surface) {
      if (surface && surface.id) recues[surface.id] = surface;
    });

    var modele = global.Surfaces
      ? global.Surfaces.DESCRIPTION
      : [{ id: "sol", nom: "Sol", court: "Sol", type: "sol" }];

    var etat = {
      valide: false,
      version: typeof lu.v === "number" ? lu.v : 0,
      nom: typeof lu.n === "string" ? lu.n : "",
      piece: { longueur: 4, largeur: 3, hauteur: 2.5 },
      surfaces: modele.map(function (description) {
        var reglages = lireReglages(recues[description.id]);
        reglages.id    = description.id;
        reglages.nom   = description.nom;
        reglages.court = description.court;
        reglages.type  = description.type;
        return reglages;
      }),
      maison: null,
      habillage: null,
      entreeId: null,
      mobilier: [],
      camera: null
    };

    var piece = Array.isArray(lu.p) ? lu.p : [];
    ["longueur", "largeur", "hauteur"].forEach(function (cle, rang) {
      var valeur = piece[rang];
      if (typeof valeur === "number" && valeur > 0) etat.piece[cle] = valeur;
    });

    // Un lien d'une autre version décrirait un projet qu'on ne sait pas
    // rejouer : mieux vaut le dire que d'en montrer une approximation.
    if (etat.version !== VERSION) return etat;

    etat.maison = lireMaison(lu.m);
    etat.habillage = lireHabillage(lu.h);
    if (typeof lu.e === "string" || typeof lu.e === "number") {
      etat.entreeId = lu.e;
    }

    /* Un meuble sans fichier ni position ne se poserait nulle part : on
       l'écarte plutôt que de laisser un modèle atterrir à l'origine. */
    etat.mobilier = (Array.isArray(lu.f) ? lu.f : []).filter(function (meuble) {
      return meuble && typeof meuble.f === "string" &&
             typeof meuble.x === "number" && typeof meuble.z === "number";
    }).map(function (meuble) {
      return {
        fichier: meuble.f,
        x: meuble.x,
        z: meuble.z,
        angle: typeof meuble.a === "number" ? meuble.a : 0
      };
    });

    if (lu.c && Array.isArray(lu.c.p) && lu.c.p.length === 2) {
      etat.camera = {
        depart: [lu.c.p[0], lu.c.p[1]],
        rotation: Array.isArray(lu.c.r) ? [lu.c.r[0], lu.c.r[1]] : null
      };
    }

    etat.valide = true;
    return etat;
  }

  // ---------------------------------------------------------------------------
  // Interface publique
  // ---------------------------------------------------------------------------

  /** État courant du projet, codé pour une ancre d'URL. */
  function serialiser() {
    var etat = capturer();
    return etat ? encoder(etat) : "";
  }

  /**
   * Ancre → état exploitable. Ne lève jamais.
   *
   * Le « # » de tête est toléré : on passe indifféremment location.hash ou
   * l'ancre nue.
   */
  function deserialiser(ancre) {
    var texte = typeof ancre === "string" ? ancre : "";
    if (texte.charAt(0) === "#") texte = texte.slice(1);
    return normaliser(decoder(texte));
  }

  /**
   * Vrai si l'ancre de la page porte une visite partagée.
   *
   * Sert à scene.js pour ne pas remettre en place le mobilier de ce
   * navigateur : quand un lien fait foi, il apporte le sien.
   */
  function aUnLien() {
    if (!global.location || !global.location.hash) return false;
    return deserialiser(global.location.hash).valide;
  }

  /**
   * Lien complet vers la visite.
   *
   * Une fois la visite en ligne, c'est l'adresse publique qui part : le lien
   * finit dans un mail ou un SMS, et « localhost » n'y veut rien dire. Tant
   * qu'aucune adresse n'est renseignée — ou pendant un essai, voir
   * `lienPublicVoulu` —, on garde le chemin relatif : l'application et la
   * visite sont voisines dans le même dossier.
   *
   * Dans les deux cas, l'ancre est la même. C'est elle qui porte le projet ;
   * l'adresse ne fait que désigner la page qui saura la rejouer.
   */
  function lien() {
    var ancre = serialiser();
    if (!ancre) return "";

    if (lienPublicVoulu()) return URL_PUBLIQUE + "#" + ancre;

    var base = global.location ? global.location.href.split("#")[0] : "";
    var dossier = base.replace(/[^/]*$/, "");

    return dossier + PAGE_VISITE + "#" + ancre;
  }

  /**
   * Rejoue un état sur la scène : dimensions, revêtements, maison.
   *
   * Le catalogue de matériaux doit être chargé avant l'appel, sans quoi les
   * textures resteraient sur leur couleur de repli.
   */
  function appliquer(etat) {
    if (!N || !etat || !etat.valide) return false;

    /* L'entrée d'abord : la maison s'installe ensuite, et c'est elle qui
       décide par où la visite commence. */
    if (global.MursPlan && etat.entreeId !== null) {
      MursPlan.entreeId = etat.entreeId;
    }

    etat.surfaces.forEach(function (recue) {
      var surface = N.surfaces().filter(function (s) {
        return s.id === recue.id;
      })[0];
      if (!surface) return;

      Object.keys(CLES_REGLAGES).forEach(function (cle) {
        if (recue[cle] !== undefined) surface[cle] = recue[cle];
      });
      N.appliquerApparence(surface);
    });

    N.definirDimensionsPiece(etat.piece.longueur, etat.piece.largeur,
                             etat.piece.hauteur);

    if (etat.maison) {
      /* L'habillage se pose avant la maison : `definirMaison` bâtit les murs,
         et il les lui faut déjà revêtus pour ne pas les monter blancs puis
         les refaire. */
      if (etat.habillage) N.installerHabillage(etat.habillage);
      N.definirMaison(etat.maison);
    }

    poserMobilier(etat.mobilier);
    return true;
  }

  /**
   * Repose le mobilier du lien, et lui seul.
   *
   * Le stockage local est vidé d'abord : la page de visite partage son
   * origine avec l'application, et les meubles d'hier du vendeur s'y
   * trouvent encore. Ils donneraient une visite que le client, lui, ne voit
   * pas — le lien doit faire foi, pas le navigateur qui l'ouvre.
   */
  function poserMobilier(meubles) {
    if (!N || !N.viderMobilier || !N.placerModele) return Promise.resolve(0);

    N.viderMobilier();
    if (!meubles || !meubles.length) return Promise.resolve(0);

    var poses = 0;

    // En file : les modèles se chargent du réseau, et les lancer tous
    // ensemble sature le décodeur pour un gain nul.
    return meubles.reduce(function (suite, meuble) {
      return suite.then(function () {
        return N.placerModele(meuble.fichier, meuble.x, meuble.z, {
          angle: meuble.angle,
          restaurer: true
        }).then(function (fait) { if (fait === true) poses++; });
      });
    }, Promise.resolve()).then(function () { return poses; });
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  global.Partage = {
    VERSION: VERSION,
    PAGE_VISITE: PAGE_VISITE,
    CLES_REGLAGES: CLES_REGLAGES,

    /** Reçoit le noyau de scene.js. À appeler avant capture ou restauration. */
    installer: function (partage) { N = partage; },

    // Pures, vérifiables sous Node
    compacter:    compacter,
    decompacter:  decompacter,
    encoder:      encoder,
    decoder:      decoder,
    normaliser:   normaliser,
    lireReglages: lireReglages,
    compacterReglages: compacterReglages,
    compacterMaison:   compacterMaison,
    lireMaison:        lireMaison,

    // Liées à la scène
    capturer:     capturer,
    serialiser:   serialiser,
    deserialiser: deserialiser,
    lien:         lien,
    aUnLien:      aUnLien,
    appliquer:    appliquer
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.Partage;
  }

})(typeof window !== "undefined" ? window : globalThis);
