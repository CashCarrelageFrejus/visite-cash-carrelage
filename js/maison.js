/**
 * Catalogue 3D — construction de la maison
 *
 * Traduit en volumes Babylon le modèle que MursPlan livre : murs et leurs
 * revêtements, vitrages des baies percées, encadrement de la porte d'entrée,
 * volées d'escalier et planchers des niveaux hauts.
 *
 * Rien n'est calculé ici : les géométries arrivent déjà orientées, il n'y a
 * qu'à les instancier. Le modèle, l'habillage et les matériaux communs
 * viennent du noyau de scene.js.
 *
 * Exposé sur window.Maison.
 */
(function () {
  "use strict";

  /** Noyau de la scène : état global et primitives 3D. Voir scene.js. */
  var N = null;

  /* Matériaux propres aux volumes bâtis, créés à la première demande et
     gardés ensuite : une maison compte vite une centaine de boîtes, et il
     n'en faut qu'un par teinte. */
  var materiauVitreMaison, materiauMurMaison, materiauEntree, materiauBattant;
  var materiauMarche, materiauRampe;

  // --- Maison reconstruite depuis un plan ----------------------------------

  /** Matériau PBR uni, pour les volumes bâtis sans texture. */
  function materiauUni(nom, hex, options) {
    var o = options || {};
    var materiau = new BABYLON.PBRMaterial(nom, N.scene());

    materiau.albedoColor = N.couleurBabylon(hex);
    materiau.metallic  = o.metallique === undefined ? 0 : o.metallique;
    materiau.roughness = o.rugosite === undefined ? 0.85 : o.rugosite;

    if (o.alpha !== undefined && o.alpha < 1) {
      materiau.alpha = o.alpha;
      materiau.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      // Une vitre ne reçoit pas d'ombre portée sur elle-même sans artefact.
      materiau.backFaceCulling = false;
    }

    N.reglerMateriauPBR(materiau);
    return materiau;
  }

  function detruireMaison() {
    // Retirer du surlignage avant de disposer : la couche garderait sinon
    // des références sur des maillages morts.
    if (coucheSurlignage) coucheSurlignage.removeAllMeshes();

    N.rendusMaison.murs.forEach(function (m) { m.dispose(); });
    N.rendusMaison.vitres.forEach(function (m) { m.dispose(); });
    N.rendusMaison.murs = [];
    N.rendusMaison.vitres = [];
    N.rendusMaison.parMur = {};
    // Le métré se refait avec les maillages : le garder décrirait un
    // habillage qui n'existe plus.
    N.rendusMaison.metre = [];
  }

  /**
   * Ajoute au métré de l'habillage ce qu'une face vient de consommer.
   *
   * Le cumul se fait par jeu de réglages, pas par face. Un mur a deux faces,
   * une maison en a des dizaines, et ce qui se commande est un lot de
   * carrelage — pas une paroi.
   */
  function cumulerMetre(reglages, pose) {
    var lot = null;

    N.rendusMaison.metre.forEach(function (entree) {
      if (entree.surface === reglages) lot = entree;
    });

    if (!lot) {
      lot = {
        surface: reglages,
        resultat: { entiers: 0, coupes: 0, total: 0, surfacePosee: 0 }
      };
      N.rendusMaison.metre.push(lot);
    }

    lot.resultat.entiers      += pose.entiers;
    lot.resultat.coupes       += pose.coupes;
    lot.resultat.total        += pose.total;
    lot.resultat.surfacePosee += pose.surfacePosee;
  }

  /**
   * Bâtit les murs de la maison.
   *
   * Chaque mur est livré par MursPlan sous forme de boîtes déjà orientées :
   * il n'y a plus qu'à les instancier. Les collisions sont armées d'emblée,
   * la visite immersive s'appuiera dessus.
   */
  function construireMaison() {
    var maison = N.maison();

    detruireMaison();
    if (!maison || !maison.murs || !maison.murs.length) return;

    construirePlanchersMaison();

    if (N.murActifs()) {
      maison.murs.forEach(habillerMur);
      construireVitragesMaison();
      construireEncadrementEntree();
      construireBattants();
    }

    construireEscaliers();
    majSurlignageMur();
  }

  /**
   * Bâtit les volées d'escalier des zones tracées.
   *
   * Chaque marche monte du sol : l'escalier est plein, il se lit de profil
   * comme de dessous. La dernière arrive exactement au plancher du niveau
   * supérieur — c'est le module qui s'en charge, en déduisant la hauteur de
   * marche du nombre plutôt que l'inverse.
   */
  /* Les volées posées, chacune sous son socle. Les tenir à part permet de
     les refaire seules — changer une cote d'escalier n'a pas à rebâtir la
     maison entière, et le panneau de réglages appelle cela à chaque
     frappe. */
  var escaliersPoses = [];

  function detruireEscaliers() {
    escaliersPoses.forEach(function (socle) {
      if (!socle.isDisposed()) socle.dispose();
    });
    escaliersPoses = [];
  }

  function construireEscaliers() {
    detruireEscaliers();

    var maison = N.maison();
    if (!maison || !maison.niveaux) return;

    var aBatir = maison.niveaux.some(function (niveau) {
      return (niveau.escaliers || []).length;
    });
    if (!aBatir) return;

    if (!materiauMarche) {
      materiauMarche = materiauUni("maison-marche", N.CONFIG.maison.couleurMarche, {
        rugosite: 0.75
      });
    }
    if (!materiauRampe) {
      materiauRampe = materiauUni("maison-rampe", N.CONFIG.maison.couleurRampe, {
        rugosite: 0.35, metallique: 0.80
      });
    }

    var ecartes = 0;

    maison.niveaux.forEach(function (niveau) {
      (niveau.escaliers || []).forEach(function (zone, rang) {
        /* Les cotes reprises à la main vivent sur la zone d'origine, la
           seule qui survive d'un assemblage à l'autre. À défaut, la volée
           prend celles de son tracé et la hauteur sous plafond. */
        var source = zone.source || {};

        var volee = MursPlan.escalier(zone, {
          hauteur:  source.hauteur > 0 ? source.hauteur : N.dims.hauteur,
          largeur:  source.largeur,
          longueur: source.longueur
        });

        // Zone trop étroite ou trop courte pour loger une volée : le dire,
        // plutôt que de laisser un rectangle gris sans escalier dessous.
        if (!volee) { ecartes++; return; }

        var prefixe = "escalier-" + niveau.cle + "-" + rang;

        /* Un socle par volée : il en fait un objet qu'on peut désigner d'un
           clic, et disposer d'un seul geste. */
        var socle = new BABYLON.TransformNode(prefixe, N.scene());
        var morceaux = [];

        volee.marches.forEach(function (marche) {
          var boite = BABYLON.MeshBuilder.CreateBox(
            prefixe + "-m" + marche.rang,
            {
              width: marche.taille[0],
              height: marche.taille[1],
              depth: marche.taille[2]
            },
            N.scene()
          );

          boite.position.set(marche.centre[0],
                             marche.centre[1] + niveau.altitude,
                             marche.centre[2]);
          boite.rotation.y = marche.angle;
          boite.material = materiauMarche;
          boite.receiveShadows = true;
          boite.checkCollisions = true;

          if (N.ombres()) N.ombres().addShadowCaster(boite);
          morceaux.push(boite);
        });

        var rampe = BABYLON.MeshBuilder.CreateBox(prefixe + "-rampe", {
          width:  volee.rampe.taille[0],
          height: volee.rampe.taille[1],
          depth:  volee.rampe.taille[2]
        }, N.scene());

        rampe.position.set(volee.rampe.centre[0],
                           volee.rampe.centre[1] + niveau.altitude,
                           volee.rampe.centre[2]);
        /* Babylon compose les angles d'Euler dans l'ordre Z, X, Y : le roulis
           bascule la barre dans le plan vertical d'abord, le lacet oriente
           ensuite ce plan dans le sens de la montée. */
        rampe.rotation.y = volee.rampe.angle;
        rampe.rotation.z = volee.rampe.pente;
        rampe.material = materiauRampe;

        if (N.ombres()) N.ombres().addShadowCaster(rampe);
        morceaux.push(rampe);

        /* Tout passe sous le socle, et devient sensible au clic : c'est ce
           qui permet de désigner une volée pour la reprendre. La marque
           porte la zone d'origine — celle qu'il faudra modifier — et le
           socle, pour que la sélection remonte à l'objet entier. */
        morceaux.forEach(function (m) {
          m.parent = socle;
          m.isPickable = true;
          m.metadata = { escalier: source, mobilier: socle };
        });

        socle.metadata = { escalier: source, morceaux: morceaux, volee: volee };

        escaliersPoses.push(socle);
        N.rendusMaison.murs.push(socle);
      });
    });

    /* Le tracé refuse déjà les zones trop petites, message à l'appui : si
       l'une passe quand même ici — analyse rechargée, échelle recalibrée
       depuis — l'utilisateur a tracé un escalier qui n'existe pas en 3D.
       C'est une erreur, et la console est le seul canal : le panneau du
       plan n'est pas dans cette portée. */
    if (ecartes) {
      console.error("Escaliers : " + ecartes +
        " zone(s) trop petite(s) pour loger une volée, ignorée(s).");
    }
  }

  /**
   * Encadre l'entrée principale.
   *
   * Deux jambages et un linteau en saillie, d'une teinte à part : c'est ce
   * qui distingue la porte d'entrée des autres une fois en 3D.
   */
  function construireEncadrementEntree() {
    var maison = N.maison();
    if (!maison || !maison.murs) return;

    var blocs = MursPlan.encadrements(maison.murs, {
      epaisseur: N.CONFIG.maison.epaisseur
    });
    if (!blocs.length) return;

    if (!materiauEntree) {
      /* Mat, et pas métallique du tout. L'encadrement était réglé à 25 % de
         métal pour une rugosité de 0,45 : de quoi renvoyer l'environnement
         net comme un miroir. Sous un HDRI photographique, ses jambages
         reflétaient un bâtiment reconnaissable — on lisait la baie du studio
         dans le tableau de la porte.

         Un dormant de porte est peint ou verni : sa réflexion est celle d'un
         diélectrique mat, pas d'un métal poli. Les faces intérieures ne
         demandent pas de matériau à part — ces blocs traversent le mur, leurs
         deux côtés sont la même boîte, et ce qui vaut pour l'un vaut pour
         l'autre. */
      materiauEntree = materiauUni("maison-entree", N.CONFIG.maison.couleurEntree, {
        rugosite: 0.9, metallique: 0
      });
    }

    blocs.forEach(function (bloc, rang) {
      var piece = BABYLON.MeshBuilder.CreateBox(
        "maison-entree-" + rang,
        { width: bloc.taille[0], height: bloc.taille[1], depth: bloc.taille[2] },
        N.scene()
      );

      piece.position.set(bloc.centre[0], bloc.centre[1] + bloc.altitude,
                         bloc.centre[2]);
      piece.rotation.y = bloc.angle;
      piece.material = materiauEntree;
      piece.receiveShadows = true;

      if (N.ombres()) N.ombres().addShadowCaster(piece);
      N.rendusMaison.murs.push(piece);
    });
  }

  // --- Sélection d'un mur --------------------------------------------------

  var coucheSurlignage = null;

  /**
   * Entoure le mur sélectionné d'un liseré coloré.
   *
   * Les maillages sont recréés à chaque reconstruction : le surlignage est
   * refait par-dessus, jamais conservé.
   */
  function majSurlignageMur() {
    if (coucheSurlignage) coucheSurlignage.removeAllMeshes();

    if (!N.maison() || !N.habillage() || N.habillage().selection < 0) return;

    var morceaux = N.rendusMaison.parMur[N.habillage().selection];
    if (!morceaux || !morceaux.length) return;

    if (!coucheSurlignage) {
      coucheSurlignage = new BABYLON.HighlightLayer("surlignage-mur", N.scene());
      coucheSurlignage.innerGlow = false;
    }

    var teinte = N.couleurBabylon(N.CONFIG.maison.surlignage);
    morceaux.forEach(function (maillage) {
      coucheSurlignage.addMesh(maillage, teinte);
    });
  }

  /** Le panneau ne pilote plus que ce mur. */
  function selectionnerMur(index) {
    if (!N.maison() || !N.habillage()) return;

    var reglages = MursPlan.selectionner(N.habillage(), index);
    if (!reglages) return;

    // Le panneau se recale sur ce mur : surface visée, onglet « Murs »,
    // champs rechargés. Le liseré, lui, est de notre ressort.
    Panneau.viserMur(reglages.id);
    majSurlignageMur();
  }

  /**
   * Clic dans la scène : désigner un mur.
   *
   * On écoute le « tap » plutôt que l'appui : Babylon ne le déclenche qu'en
   * l'absence de glissement, ce qui laisse la caméra tourner librement sans
   * changer la sélection à chaque orbite.
   */
  function brancherSelectionMur() {
    if (!N.scene()) return;

    N.scene().onPointerObservable.add(function (info) {
      if (info.type !== BABYLON.PointerEventTypes.POINTERTAP) return;
      if (Visite.active()) return;
      // Un meuble armé attend ce clic : il ne doit pas changer de mur au
      // passage. Les deux écoutent le même tap, l'un des deux doit céder.
      if (N.mobilierArme()) return;
      if (!N.maison() || !N.habillage()) return;

      var touche = info.pickInfo;
      if (!touche || !touche.hit || !touche.pickedMesh) return;

      var donnees = touche.pickedMesh.metadata;
      if (!donnees || donnees.mur === undefined) return;

      // Cliquer à côté ne désélectionne pas : seul le bouton du panneau
      // revient au réglage d'ensemble, sans ambiguïté.
      selectionnerMur(donnees.mur);
    });
  }

  /**
   * Bâtit un mur et son revêtement.
   *
   * Le volume porteur prend la teinte unie quand le mur est peint, et le fond
   * de joint quand il est carrelé — exactement comme le support d'une surface
   * du panneau. Les carreaux se posent ensuite sur ses deux faces : une
   * cloison se regarde des deux côtés.
   */
  function habillerMur(mur, index) {
    var reglages = MursPlan.pour(N.habillage(), index);
    var carrele = reglages.mode === "carrele";

    /* Un mur qu'on vient de détacher du réglage d'ensemble a un matériau
       tout neuf : sans cela il resterait blanc jusqu'à la première
       modification du panneau. */
    var neuf = !(N.rendus()[reglages.id] && N.rendus()[reglages.id].materiau);
    var materiauSurface = N.obtenirMateriauSurface(reglages);
    if (neuf) N.appliquerApparence(reglages);

    var materiauBloc = carrele ? N.obtenirMateriauJoint() : materiauSurface;

    var morceaux = [];

    // L'étage se bâtit à la hauteur d'un plafond au-dessus du rez-de-chaussée.
    var altitude = mur.altitude || 0;

    MursPlan.panneaux(mur, N.dims.hauteur, N.CONFIG.maison.epaisseur)
      .forEach(function (bloc, rang) {
        var boite = BABYLON.MeshBuilder.CreateBox(
          "maison-mur-" + index + "-" + rang,
          { width: bloc.taille[0], height: bloc.taille[1], depth: bloc.taille[2] },
          N.scene()
        );

        boite.position.set(bloc.centre[0], bloc.centre[1] + altitude, bloc.centre[2]);
        boite.rotation.y = bloc.angle;
        boite.material = materiauBloc;
        boite.receiveShadows = true;
        boite.checkCollisions = true;
        boite.metadata = { mur: index };

        if (N.ombres()) N.ombres().addShadowCaster(boite);
        morceaux.push(boite);
      });

    if (carrele) {
      [1, -1].forEach(function (cote) {
        var maillage = carrelerFace(mur, index, cote, reglages);
        if (maillage) morceaux.push(maillage);
      });
    }

    morceaux.forEach(function (m) { N.rendusMaison.murs.push(m); });
    N.rendusMaison.parMur[index] = morceaux;
  }

  /**
   * Carrelle une face de mur.
   *
   * Le calepinage est calculé dans le plan de la face, puis projeté comme
   * pour un mur de la pièce rectangulaire. Les carreaux qui tomberaient dans
   * une porte ou une fenêtre sont écartés : sans cela le carrelage
   * recouvrirait les ouvertures qu'on vient de percer.
   */
  function carrelerFace(mur, index, cote, reglages) {
    var face = MursPlan.repereFace(
      mur, N.dims.hauteur, cote, N.CONFIG.maison.epaisseur
    );
    if (!face) return null;

    // Le plan de pose suit le mur, étage compris.
    face.centre[1] += (mur.altitude || 0);

    var resultat = Calepinage.calculer({
      longueur: face.largeur,
      largeur: N.dims.hauteur,
      largeurCarreau: reglages.largeurCarreau,
      longueurCarreau: reglages.longueurCarreau,
      joint: reglages.joint,
      motif: reglages.motif,
      rotationAleatoire: reglages.rotationAleatoire,
      nombreTampons: N.tamponsDeSurface(reglages),
      /* Un travertin en opus habille aussi bien un mur qu'un sol, et le
         schéma vient du produit : rien ne justifierait qu'une face de mur
         retombe sur la trame droite alors que le sol reçoit le module. */
      schema: N.schemaDeSurface(reglages)
    });

    if (!resultat || resultat.erreur || !resultat.carreaux.length) return null;

    var demiL = face.largeur / 2;
    var demiH = N.dims.hauteur / 2;

    /* Les percements sont repérés depuis le départ du mur ; le plan de pose,
       lui, est centré. La face arrière parcourt le mur à l'envers, ses
       abscisses sont donc retournées. */
    var trous = (mur.trous || []).map(function (trou) {
      return {
        u1: cote < 0 ? demiL - trou.fin : trou.debut - demiL,
        u2: cote < 0 ? demiL - trou.debut : trou.fin - demiL,
        v1: trou.bas - demiH,
        v2: trou.haut - demiH
      };
    });

    /* Le carreau s'arrête au percement, comme le sol s'arrête à son contour.
       Un trou est un rectangle : ce qu'il laisse d'un carreau n'est plus
       convexe, et le maillage remplit les carreaux en éventail. La soustraction
       rend donc quatre bandes convexes plutôt qu'un seul contour creusé. */
    var decoupe = trous.length ? function (contour) {
      return Plan.retirerRectangles(contour, trous);
    } : null;

    /* Ce que cette face consomme réellement. Les comptes de Calepinage
       portent sur la paroi pleine : les carreaux tombés dans une porte y
       figurent encore, et personne ne les achètera.

       `total` compte les carreaux achetés — un carreau que le percement
       entame est acheté entier et recoupé sur place, il compte donc pour un.
       `surfacePosee`, elle, ne retient que ce qui reste au mur. */
    var pose = { entiers: 0, coupes: 0, total: 0, surfacePosee: 0 };

    resultat.carreaux.forEach(function (carreau) {
      var morceaux = decoupe ? decoupe(carreau.contour) : [carreau.contour];
      if (!morceaux.length) return;

      var aire = 0;
      morceaux.forEach(function (m) { aire += Calepinage.aire(m); });
      if (!(aire > 0)) return;

      pose.total++;
      pose.surfacePosee += aire;

      // Même tolérance que Calepinage : un millième en moins reste un entier.
      if (aire >= resultat.aireCarreau * 0.999) pose.entiers++;
      else pose.coupes++;
    });

    var maillage = N.maillerCarrelage(
      "maison-carrelage-" + index + "-" + (cote > 0 ? "a" : "b"),
      reglages, resultat,
      function (u, v) {
        return Calepinage.projeterSurMur(face, u, v, N.CONFIG.carreau.hauteur);
      },
      { x: face.normale[0], y: 0, z: face.normale[2] },
      decoupe
    );

    if (!maillage) return null;

    // Le métré ne compte que ce qui est bel et bien monté.
    cumulerMetre(reglages, pose);

    maillage.material = N.obtenirMateriauSurface(reglages);
    maillage.receiveShadows = true;
    maillage.metadata = { mur: index };

    return maillage;
  }

  /**
   * Ferme les baies vitrées laissées ouvertes par le percement.
   *
   * Le panneau n'est pas traversable : on entre par les portes, pas par la
   * fenêtre. Il ne porte pas d'ombre, une vitre n'en projetant guère.
   */
  function construireVitragesMaison() {
    var maison = N.maison();
    if (!maison || !maison.murs) return;

    if (!materiauVitreMaison) {
      materiauVitreMaison = materiauUni("maison-vitre", N.CONFIG.maison.couleurVitre, {
        rugosite: 0.08,
        metallique: 0.0,
        alpha: N.CONFIG.maison.alphaVitre
      });

      /* Le vitrage émet un peu de sa propre teinte. Sans cela il reste inerte
         sous la couche de halo, qui ne réagit qu'à l'émissif : c'est ce qui
         fait déborder le jour du cadre de la baie.

         La teinte suit celle du verre plutôt qu'un blanc pur, pour que le
         débord garde le bleu du ciel et ne blanchisse pas l'ouverture. */
      materiauVitreMaison.emissiveColor = N.couleurBabylon(N.CONFIG.maison.couleurVitre);
      materiauVitreMaison.emissiveIntensity = N.CONFIG.maison.emissiviteVitre;
    }

    // Un vitrage par niveau : la liste des murs porte déjà leur altitude.
    (maison.niveaux || [{ murs: maison.murs, altitude: 0 }])
      .forEach(function (niveau) {
    MursPlan.vitrages(niveau.murs).forEach(function (bloc, rang) {
      var vitre = BABYLON.MeshBuilder.CreateBox(
        "maison-vitre-" + niveau.cle + "-" + rang,
        { width: bloc.taille[0], height: bloc.taille[1], depth: bloc.taille[2] },
        N.scene()
      );

      vitre.position.set(bloc.centre[0], bloc.centre[1] + niveau.altitude,
                         bloc.centre[2]);
      vitre.rotation.y = bloc.angle;
      vitre.material = materiauVitreMaison;
      vitre.checkCollisions = true;

      N.rendusMaison.vitres.push(vitre);
    });
      });
  }

  /**
   * Battants des portes pleines.
   *
   * Sans eux, le percement d'une porte reste un trou : de dehors, on voyait
   * le carrelage et les murs du séjour à travers la porte d'entrée. Ce n'était
   * ni une transparence ni une normale inversée — il n'y avait tout
   * simplement aucun maillage, `vitrages` ne posant que les ouvertures
   * vitrées.
   *
   * Sans collision, à dessein. La visite immersive entre par cette porte :
   * elle commence sur le pas, dehors, et le premier pas franchit le seuil.
   * Un battant qui arrête le visiteur enfermerait la maison. Il bouche donc
   * la vue sans barrer le passage — on traverse une porte qu'on voit fermée,
   * ce qui se lit comme une porte qui s'ouvre.
   */
  function construireBattants() {
    var maison = N.maison();
    if (!maison || !maison.murs) return;

    if (!materiauBattant) {
      materiauBattant = materiauUni("maison-battant", N.CONFIG.maison.couleurEntree, {
        rugosite: 0.9, metallique: 0
      });
    }

    (maison.niveaux || [{ murs: maison.murs, altitude: 0, cle: "rdc" }])
      .forEach(function (niveau) {
        MursPlan.battants(niveau.murs).forEach(function (bloc, rang) {
          var battant = BABYLON.MeshBuilder.CreateBox(
            "maison-battant-" + niveau.cle + "-" + rang,
            { width: bloc.taille[0], height: bloc.taille[1], depth: bloc.taille[2] },
            N.scene()
          );

          battant.position.set(bloc.centre[0], bloc.centre[1] + niveau.altitude,
                               bloc.centre[2]);
          battant.rotation.y = bloc.angle;
          battant.material = materiauBattant;
          battant.receiveShadows = true;
          battant.checkCollisions = false;

          if (N.ombres()) N.ombres().addShadowCaster(battant);
          N.rendusMaison.murs.push(battant);
        });
      });
  }

  /**
   * Plancher des niveaux hauts.
   *
   * Le rez-de-chaussée a le sol carrelé du panneau ; un étage, lui, n'aurait
   * rien sous les pieds. On lui pose une dalle prise sur son contour.
   */
  function construirePlanchersMaison() {
    var maison = N.maison();
    if (!maison || !maison.niveaux) return;

    if (!materiauMurMaison) {
      materiauMurMaison = materiauUni("maison-plancher", N.CONFIG.maison.couleur, {
        rugosite: N.CONFIG.maison.rugosite
      });
    }

    maison.niveaux.forEach(function (niveau) {
      if (!(niveau.altitude > 0) || !niveau.contour) return;

      var dalle = N.creerFondPolygone(niveau.contour);
      if (!dalle) return;

      dalle.position.y = niveau.altitude;
      dalle.material = materiauMurMaison;
      dalle.receiveShadows = true;
      dalle.checkCollisions = true;
      dalle.isPickable = false;

      N.rendusMaison.murs.push(dalle);
    });
  }

  window.Maison = {
    /** Reçoit le noyau de scene.js. À appeler avant tout le reste. */
    installer: function (partage) { N = partage; },

    construire: construireMaison,
    brancherSelection: brancherSelectionMur,

    /** Refait les seules volées d'escalier, la maison restant en place. */
    rebatirEscaliers: construireEscaliers
  };
})();
