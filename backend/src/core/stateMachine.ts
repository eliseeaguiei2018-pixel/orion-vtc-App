import { conflict } from './errors.js';

/**
 * Machine à états déclarative : les transitions autorisées sont des DONNÉES, pas du code
 * en dur. Chaque service (VTC, livraison, micro-mobilité) déclare sa propre machine, ce
 * qui rend l'extension triviale (cf. docs/04). Empêche aussi les transitions illégales
 * (robustesse : pas de "course terminée" puis "en route").
 */
export class StateMachine<S extends string> {
  constructor(
    private readonly transitions: Record<S, readonly S[]>,
    public readonly initial: S,
  ) {}

  canTransition(from: S, to: S): boolean {
    return (this.transitions[from] ?? []).includes(to);
  }

  assertTransition(from: S, to: S): void {
    if (!this.canTransition(from, to)) {
      throw conflict(`Transition invalide: ${from} -> ${to}`, {
        from,
        to,
        allowed: this.transitions[from] ?? [],
      });
    }
  }

  isTerminal(state: S): boolean {
    return (this.transitions[state] ?? []).length === 0;
  }
}
