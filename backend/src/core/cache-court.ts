/**
 * CACHE COURT : un calcul lourd partagé par tous les postes ouverts.
 *
 * Certaines analyses de la console (prévision de demande, signaux de fraude) lisent un
 * mois d'activité. Leur résultat ne change pas d'une seconde à l'autre, mais cinquante
 * employés connectés les redemandent chacun toutes les quelques secondes. Le résultat est
 * gardé `dureeMs`, et un calcul déjà en cours est partagé au lieu d'être relancé : la
 * charge ne dépend plus du nombre de personnes connectées.
 *
 * Réservé aux ANALYSES. Une alerte SOS, une course ou un solde se lisent toujours en direct.
 */
export class CacheCourt<T> {
  private valeur: { t: number; v: T } | null = null;
  private enCours: Promise<T> | null = null;

  constructor(private readonly dureeMs: number) {}

  async obtenir(calculer: () => T | Promise<T>, maintenant = Date.now()): Promise<T> {
    if (this.valeur && maintenant - this.valeur.t < this.dureeMs) return this.valeur.v;
    if (this.enCours) return this.enCours;
    this.enCours = (async () => {
      try {
        const v = await calculer();
        this.valeur = { t: Date.now(), v };
        return v;
      } finally {
        this.enCours = null;
      }
    })();
    return this.enCours;
  }

  /** Oublie le résultat (une donnée de fond vient de changer). */
  vider(): void {
    this.valeur = null;
  }
}
