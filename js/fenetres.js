/**
 * Catalogue 3D — fenêtres
 *
 * Une fenêtre est une entité indépendante posée sur un mur : sa taille, sa
 * hauteur depuis le sol et sa position le long du mur lui appartiennent.
 * Plusieurs fenêtres peuvent cohabiter sur la même paroi.
 *
 * Module pur : la géométrie est calculée dans le plan local du mur, en
 * réutilisant le repère fourni par Calepinage.murs(). Aucune dépendance à
 * Babylon.
 *
 * Repère local d'un mur : `u` court horizontalement depuis le milieu du mur,
 * `v` monte depuis le milieu de sa hauteur.
 */
(function (global) {
  "use strict";

  var DEFAUTS = {
    largeur: 1.20,     // m
    hauteur: 1.40,     // m
    hauteurSol: 0.90,  // m, bas de la fenêtre au-dessus du sol
    positionH: 0,      // m, décalage le long du mur depuis son milieu
    centree: true
  };

  /** Marge conservée entre le bord d'une fenêtre et l'angle du mur. */
  var MARGE = 0.05;

  var compteur = 0;

  function creer(mur, options) {
    var o = options || {};

    compteur++;

    return {
      id: "fenetre-" + compteur,
      mur: mur,
      largeur: o.largeur > 0 ? o.largeur : DEFAUTS.largeur,
      hauteur: o.hauteur > 0 ? o.hauteur : DEFAUTS.hauteur,
      hauteurSol: o.hauteurSol >= 0 ? o.hauteurSol : DEFAUTS.hauteurSol,
      positionH: isFinite(o.positionH) ? o.positionH : DEFAUTS.positionH,
      centree: o.centree === undefined ? DEFAUTS.centree : o.centree === true
    };
  }

  /** Largeur du mur portant la fenêtre, ou 0 si le mur est inconnu. */
  function largeurMur(fenetre, murs) {
    for (var i = 0; murs && i < murs.length; i++) {
      if (murs[i].nom === fenetre.mur) return murs[i].largeur;
    }
    return 0;
  }

  /**
   * Vérifie qu'une fenêtre tient sur son mur.
   * Retourne { ok } ou { ok: false, erreur }.
   */
  function verifier(fenetre, murs, hauteurPiece) {
    var largeurParoi = largeurMur(fenetre, murs);

    if (!largeurParoi) {
      return { ok: false, erreur: "Mur inconnu : " + fenetre.mur + "." };
    }
    if (!(fenetre.largeur > 0) || !(fenetre.hauteur > 0)) {
      return { ok: false, erreur: "Les dimensions doivent être strictement positives." };
    }
    if (fenetre.largeur + 2 * MARGE > largeurParoi) {
      return {
        ok: false,
        erreur: "Fenêtre trop large pour ce mur (" +
          Math.round(largeurParoi * 100) + " cm disponibles)."
      };
    }
    if (fenetre.hauteurSol < 0) {
      return { ok: false, erreur: "La hauteur depuis le sol ne peut pas être négative." };
    }
    if (fenetre.hauteurSol + fenetre.hauteur + MARGE > hauteurPiece) {
      return {
        ok: false,
        erreur: "Fenêtre trop haute : elle dépasse le plafond (" +
          Math.round(hauteurPiece * 100) + " cm)."
      };
    }

    return { ok: true };
  }

  /**
   * Ramène une fenêtre dans les limites de son mur.
   * Utile après un redimensionnement de la pièce : plutôt que de faire
   * disparaître les fenêtres, on les recale.
   */
  function ajuster(fenetre, murs, hauteurPiece) {
    var largeurParoi = largeurMur(fenetre, murs);
    if (!largeurParoi) return fenetre;

    var largeurMax = Math.max(0.1, largeurParoi - 2 * MARGE);
    fenetre.largeur = Math.min(fenetre.largeur, largeurMax);

    var hauteurMax = Math.max(0.1, hauteurPiece - 2 * MARGE);
    fenetre.hauteur = Math.min(fenetre.hauteur, hauteurMax);

    fenetre.hauteurSol = Math.max(
      MARGE,
      Math.min(fenetre.hauteurSol, hauteurPiece - fenetre.hauteur - MARGE)
    );

    if (fenetre.centree) {
      fenetre.positionH = 0;
    } else {
      var debattement = Math.max(0, (largeurParoi - fenetre.largeur) / 2 - MARGE);
      fenetre.positionH = Math.max(-debattement, Math.min(debattement, fenetre.positionH));
    }

    return fenetre;
  }

  /** Centre de la fenêtre dans le plan local du mur : [u, v]. */
  function centreLocal(fenetre, hauteurPiece) {
    return [
      fenetre.centree ? 0 : fenetre.positionH,
      fenetre.hauteurSol + fenetre.hauteur / 2 - hauteurPiece / 2
    ];
  }

  /**
   * Les quatre coins de la fenêtre dans le plan local du mur, dans le sens
   * du parcours : bas-gauche, bas-droite, haut-droite, haut-gauche.
   */
  function coins(fenetre, hauteurPiece, dilatation) {
    var centre = centreLocal(fenetre, hauteurPiece);
    var d = dilatation || 0;

    var demiL = fenetre.largeur / 2 + d;
    var demiH = fenetre.hauteur / 2 + d;

    return [
      [centre[0] - demiL, centre[1] - demiH],
      [centre[0] + demiL, centre[1] - demiH],
      [centre[0] + demiL, centre[1] + demiH],
      [centre[0] - demiL, centre[1] + demiH]
    ];
  }

  /**
   * Le cadre, comme quatre quadrilatères formant un pourtour.
   * Le pourtour est extérieur à la baie : il l'encadre sans la masquer.
   */
  function cadre(fenetre, hauteurPiece, epaisseur) {
    var interieur = coins(fenetre, hauteurPiece, 0);
    var exterieur = coins(fenetre, hauteurPiece, epaisseur);

    var bandes = [];
    for (var i = 0; i < 4; i++) {
      var suivant = (i + 1) % 4;
      bandes.push([
        exterieur[i], exterieur[suivant], interieur[suivant], interieur[i]
      ]);
    }
    return bandes;
  }

  function surface(fenetre) {
    return fenetre.largeur * fenetre.hauteur;
  }

  /** Fenêtres posées sur un mur donné. */
  function surMur(fenetres, identifiantMur) {
    return fenetres.filter(function (f) { return f.mur === identifiantMur; });
  }

  function retirer(fenetres, identifiant) {
    return fenetres.filter(function (f) { return f.id !== identifiant; });
  }

  /** Libellé court pour la liste du panneau. */
  function libelle(fenetre, nomMur) {
    var cm = function (m) { return Math.round(m * 100); };
    return (nomMur || fenetre.mur) + " — " +
      cm(fenetre.largeur) + "×" + cm(fenetre.hauteur) +
      " cm à " + cm(fenetre.hauteurSol) + " cm";
  }

  global.Fenetres = {
    DEFAUTS: DEFAUTS,
    MARGE: MARGE,
    creer: creer,
    verifier: verifier,
    ajuster: ajuster,
    centreLocal: centreLocal,
    coins: coins,
    cadre: cadre,
    surface: surface,
    surMur: surMur,
    retirer: retirer,
    libelle: libelle
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.Fenetres;
  }
})(typeof window !== "undefined" ? window : globalThis);
