import type { AccesGoogle } from './acces.js';

/**
 * reCAPTCHA ENTERPRISE — écarter les robots avant d'envoyer un SMS ou d'ouvrir une session.
 *
 * L'application obtient un jeton reCAPTCHA pour l'action en cours (« connexion_client »…) et
 * le joint à sa demande (en-tête `x-recaptcha-token`). Le serveur demande ici à Google une
 * évaluation : le jeton est-il valide, pour cette action, et quel est le score de risque
 * (0 = robot, 1 = humain) ? Sous le seuil, la demande est refusée : pas de SMS envoyé, donc
 * pas de facture gonflée par des robots, ni d'essais de mots de passe en série.
 *
 * Modes : `off` (aucune vérification), `observe` (évalue et journalise sans jamais bloquer :
 * à utiliser pour régler le seuil), `enforce` (bloque). En mode `enforce`, si Google ne répond
 * pas, la demande est refusée : une protection qui s'ouvre en cas de panne ne protège pas
 * pendant une attaque.
 */
export type ModeRecaptcha = 'off' | 'observe' | 'enforce';

export interface Evaluation { ok: boolean; score?: number; raison?: 'absent' | 'invalide' | 'action' | 'score' | 'indisponible'; motifs?: string[] }

interface Reponse {
  tokenProperties?: { valid?: boolean; invalidReason?: string; action?: string };
  riskAnalysis?: { score?: number; reasons?: string[] };
}

export class Recaptcha {
  constructor(private readonly o: { acces: AccesGoogle; cleSite: string; seuil?: number; mode: ModeRecaptcha }) {}

  get mode(): ModeRecaptcha { return this.o.mode; }
  get actif(): boolean { return this.o.mode !== 'off'; }

  /** Demande à Google d'évaluer le jeton. Ne lève jamais : le résultat dit pourquoi c'est refusé. */
  async evaluer(d: { jeton?: string; action: string; ip?: string; agent?: string }): Promise<Evaluation> {
    if (!d.jeton) return { ok: false, raison: 'absent' };
    let r: Reponse;
    try {
      r = await this.o.acces.appel<Reponse>('reCAPTCHA Enterprise', `https://recaptchaenterprise.googleapis.com/v1/projects/${await this.o.acces.projet()}/assessments`, {
        corps: { event: { token: d.jeton, siteKey: this.o.cleSite, expectedAction: d.action, userIpAddress: d.ip, userAgent: d.agent?.slice(0, 300) } },
      });
    } catch {
      return { ok: false, raison: 'indisponible' };
    }
    if (!r.tokenProperties?.valid) return { ok: false, raison: 'invalide', motifs: r.tokenProperties?.invalidReason ? [r.tokenProperties.invalidReason] : undefined };
    // Un jeton obtenu pour une autre action (ex. la page d'accueil) ne vaut pas pour une connexion.
    if (r.tokenProperties.action !== d.action) return { ok: false, raison: 'action' };
    const score = r.riskAnalysis?.score ?? 0;
    if (score < (this.o.seuil ?? 0.5)) return { ok: false, score, raison: 'score', motifs: r.riskAnalysis?.reasons };
    return { ok: true, score };
  }
}
