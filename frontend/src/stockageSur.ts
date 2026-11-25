/**
 * STOCKAGE SÛR — à importer EN PREMIER dans chaque point d'entrée.
 *
 * Quand l'application est ouverte dans un cadre intégré (page partagée, aperçu) et que le
 * navigateur bloque le stockage des sites tiers (navigation privée, Brave, réglage
 * « bloquer les cookies tiers »), le simple fait de LIRE `window.localStorage` lève une
 * erreur de sécurité. L'application s'arrêtait alors avant d'afficher quoi que ce soit.
 *
 * Ici, on vérifie une fois que le stockage répond. S'il est refusé, on le remplace par
 * une mémoire le temps de la visite : l'application s'ouvre et fonctionne, elle oublie
 * simplement ses réglages à la fermeture. Si le stockage répond, on ne touche à rien.
 */
class Memoire implements Storage {
  private donnees = new Map<string, string>();
  [cle: string]: unknown;
  get length(): number { return this.donnees.size; }
  key(i: number): string | null { return [...this.donnees.keys()][i] ?? null; }
  getItem(cle: string): string | null { return this.donnees.get(String(cle)) ?? null; }
  setItem(cle: string, valeur: string): void { this.donnees.set(String(cle), String(valeur)); }
  removeItem(cle: string): void { this.donnees.delete(String(cle)); }
  clear(): void { this.donnees.clear(); }
}

/** `Object.keys(localStorage)` doit continuer à lister les clés : on les expose. */
function memoire(): Storage {
  const m = new Memoire();
  return new Proxy(m, {
    ownKeys: (c) => Array.from({ length: c.length }, (_, i) => c.key(i) as string),
    getOwnPropertyDescriptor: (c, cle) => (typeof cle === 'string' && c.getItem(cle) !== null
      ? { value: c.getItem(cle), enumerable: true, configurable: true, writable: true }
      : undefined),
    get: (c, cle) => {
      const v = Reflect.get(c, cle, c) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(c) : v;
    },
  });
}

for (const nom of ['localStorage', 'sessionStorage'] as const) {
  let repond = false;
  try { window[nom].getItem('orion.essai'); repond = true; } catch { repond = false; }
  if (!repond) {
    try { Object.defineProperty(window, nom, { value: memoire(), configurable: true, enumerable: true }); } catch { /* navigateur qui interdit le remplacement : rien de plus à faire */ }
  }
}

export {};
