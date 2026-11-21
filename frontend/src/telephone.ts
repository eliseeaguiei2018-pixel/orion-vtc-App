/**
 * TÉLÉPHONE : du numéro enregistré au clavier du portable.
 *
 * Un lien `tel:` ouvre le clavier téléphonique avec le numéro déjà composé : sur Android,
 * l'application Téléphone ; sur iPhone, la fenêtre d'appel ; sur un ordinateur, l'appli
 * d'appel associée (Teams, Skype, téléphone relié). La personne n'a plus qu'à appuyer sur
 * la touche verte : l'application n'appelle jamais à sa place.
 */

/**
 * Numéro composable : chiffres et « + » initial seulement (« +225 07 01 02 03 04 » →
 * « +2250701020304 »). Un numéro ivoirien local à 10 chiffres reçoit l'indicatif +225,
 * pour qu'un téléphone étranger puisse le composer. Même règle que le serveur.
 */
export function numeroComposable(brut: string | null | undefined): string | null {
  if (!brut) return null;
  const n = brut.trim().replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  if (n.startsWith('00')) return `+${n.slice(2)}`;
  if (/^0\d{9}$/.test(n)) return `+225${n}`;
  return /^\+?\d{6,15}$/.test(n) ? n : null;
}

/** Lien qui ouvre le clavier du téléphone, ou null si le numéro n'est pas composable. */
export function lienTel(brut: string | null | undefined): string | null {
  const n = numeroComposable(brut);
  return n ? `tel:${n}` : null;
}

/** Numéro lisible : « +225 07 01 02 03 04 ». */
export function numeroLisible(brut: string | null | undefined): string {
  const n = numeroComposable(brut);
  if (!n) return brut ?? '';
  const m = /^\+225(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(n);
  return m ? `+225 ${m.slice(1).join(' ')}` : n;
}

/**
 * Ouvre le clavier du téléphone. Passe par un lien réel (et non window.open) : c'est ce
 * que les vues web d'Android et d'iOS transmettent au système sans bloquer.
 */
export function ouvrirClavier(lien: string): void {
  const a = document.createElement('a');
  a.href = lien;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Numéro FICTIF de démonstration. L'indicatif « 00 » n'est attribué à aucun opérateur
 * ivoirien : le clavier s'ouvre bien avec un numéro composé, mais il ne peut joindre
 * personne. Sert quand le chauffeur est simulé (application sans serveur).
 */
export const NUMERO_DEMONSTRATION = '+2250000000000';
