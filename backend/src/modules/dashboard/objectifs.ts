import type { Repository } from '../../core/db/repository.js';

/**
 * OBJECTIFS FINANCIERS d'ORION : le chiffre d'affaires visé pour la journée, la semaine,
 * le mois et l'année. Fixés par la direction (console, permission finance:write), ils
 * servent de référence aux courbes du tableau de bord.
 */
export interface ObjectifsFinanciers {
  jour: number;
  semaine: number;
  mois: number;
  annee: number;
  /** Dernière modification : qui et quand (affiché dans la console). */
  majLe?: string;
  majPar?: string;
}

type Enregistrement = ObjectifsFinanciers & { id: string };
const ID = 'objectifs-financiers';

/** Valeurs de départ, à ajuster par la direction (F CFA de chiffre d'affaires). */
export const OBJECTIFS_DEFAUT: ObjectifsFinanciers = { jour: 450_000, semaine: 3_000_000, mois: 13_000_000, annee: 160_000_000 };

export class ServiceObjectifs {
  private courant: ObjectifsFinanciers;

  constructor(private readonly repo?: Repository<Enregistrement>) {
    const enregistre = repo?.get(ID);
    if (enregistre) {
      const { id: _id, ...reste } = enregistre;
      this.courant = { ...OBJECTIFS_DEFAUT, ...reste };
    } else {
      this.courant = { ...OBJECTIFS_DEFAUT };
    }
  }

  get(): ObjectifsFinanciers {
    return { ...this.courant };
  }

  mettreAJour(patch: Partial<Pick<ObjectifsFinanciers, 'jour' | 'semaine' | 'mois' | 'annee'>>, par: string): ObjectifsFinanciers {
    this.courant = { ...this.courant, ...patch, majLe: new Date().toISOString(), majPar: par };
    this.repo?.put({ id: ID, ...this.courant });
    return this.get();
  }
}
