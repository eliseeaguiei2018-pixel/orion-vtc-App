/**
 * INDEX CHRONOLOGIQUE : des éléments rangés par date, interrogeables par fenêtre.
 *
 * Les données d'ORION arrivent presque toujours dans l'ordre du temps (une course est
 * créée « maintenant », une écriture comptable aussi) : l'ajout est alors un simple
 * `push`. Un ajout dans le désordre (import d'historique, réhydratation) est rangé à sa
 * place par recherche dichotomique.
 *
 * Une fenêtre (« les 30 derniers jours ») se lit en O(log n + taille de la fenêtre), au
 * lieu de parcourir et trier tout l'historique : c'est ce qui permet à la console de
 * rester rapide avec des millions de courses.
 */
export class IndexChrono<T> {
  private readonly temps: number[] = [];
  private readonly elements: T[] = [];

  get taille(): number {
    return this.elements.length;
  }

  ajouter(t: number, element: T): void {
    const n = this.temps.length;
    if (n === 0 || t >= this.temps[n - 1]!) {
      this.temps.push(t);
      this.elements.push(element);
      return;
    }
    const i = this.premierIndex(t, true);
    this.temps.splice(i, 0, t);
    this.elements.splice(i, 0, element);
  }

  /** Indice du premier élément dont la date est >= t (> t si `strict`, pour ranger après les égaux). */
  private premierIndex(t: number, strict = false): number {
    let bas = 0;
    let haut = this.temps.length;
    while (bas < haut) {
      const milieu = (bas + haut) >>> 1;
      const v = this.temps[milieu]!;
      if (v < t || (strict && v === t)) bas = milieu + 1; else haut = milieu;
    }
    return bas;
  }

  /** Éléments datés de `t` ou après, du plus ancien au plus récent. */
  depuis(t: number): T[] {
    return this.elements.slice(this.premierIndex(t));
  }

  /** Éléments datés dans [debut, fin[, du plus ancien au plus récent. */
  entre(debut: number, fin: number): T[] {
    return this.elements.slice(this.premierIndex(debut), this.premierIndex(fin));
  }

  /** Nombre d'éléments datés de `t` ou après (sans copie). */
  compterDepuis(t: number): number {
    return this.elements.length - this.premierIndex(t);
  }

  /** Les `n` plus récents, du plus récent au plus ancien, en sautant `decalage` éléments. */
  recents(n: number, decalage = 0): T[] {
    const fin = Math.max(0, this.elements.length - decalage);
    const debut = Math.max(0, fin - n);
    return this.elements.slice(debut, fin).reverse();
  }

  /** Parcourt du plus récent au plus ancien ; s'arrête quand `visiter` renvoie false. */
  parcourirRecents(visiter: (element: T) => boolean | void): void {
    for (let i = this.elements.length - 1; i >= 0; i -= 1) {
      if (visiter(this.elements[i]!) === false) return;
    }
  }

  /**
   * Éléments datés de `t` ou après, du plus récent au plus ancien, lus à la demande :
   * celui qui ne veut que les 50 premiers ne paie que pour 50, même sur un an d'historique.
   */
  *recentsDepuis(t: number): Generator<T> {
    const debut = this.premierIndex(t);
    for (let i = this.elements.length - 1; i >= debut; i -= 1) yield this.elements[i]!;
  }

  /** Tous les éléments, du plus ancien au plus récent (copie). */
  tous(): T[] {
    return this.elements.slice();
  }
}
