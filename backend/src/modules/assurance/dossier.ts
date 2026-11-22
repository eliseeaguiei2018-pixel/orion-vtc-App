import { z } from 'zod';
import type { Repository } from '../../core/db/repository.js';
import type { CoffreMedical, DonneeChiffree } from './chiffrement.js';

/**
 * ORION ASSURANCE : DOSSIER DE PREMIERS SECOURS DU CLIENT.
 *
 * Ce que le client confie ici (identité, pièce d'identité, CMU, groupe sanguin,
 * antécédents, traitements, contact d'urgence) ne sert qu'à une chose : permettre au
 * SAMU et à la supervision ORION de le prendre en charge vite et sans erreur s'il a un
 * accident pendant une course.
 *
 * Règles imposées par le serveur, pas seulement promises :
 *  - le dossier est stocké CHIFFRÉ (AES-256-GCM, cf. chiffrement.ts), jamais en clair ;
 *  - il n'est lisible que par son titulaire, connecté, et par l'agent SAMU qui a pris
 *    en charge une alerte EN COURS le concernant ;
 *  - chaque consultation par ORION est inscrite dans le dossier lui-même : le client
 *    voit qui l'a ouvert, quand, et pour quelle alerte ;
 *  - l'inscription est gratuite ; elle seule permet d'activer l'option à 2 % sur une
 *    course (sans dossier, l'assistance ne pourrait pas être rapide) ;
 *  - le client peut supprimer son dossier à tout moment.
 */

/** Version du texte d'information que le client doit avoir lu et accepté. */
export const CONSENTEMENT_VERSION = '2026-11';

export const GROUPES_SANGUINS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'inconnu'] as const;

/** Antécédents qui changent les premiers gestes (ordre de l'écran de l'app). */
export const ANTECEDENTS = [
  'asthme', 'hypertension', 'diabete', 'drepanocytose', 'epilepsie',
  'cardiaque', 'renale', 'coagulation', 'grossesse', 'mobilite_reduite',
  // Questionnaire enrichi (application 1.5.7).
  'avc', 'respiratoire', 'cancer', 'hepatique',
] as const;

/** Allergies qui changent un geste de secours ou un médicament donné en urgence. */
export const ALLERGIES = ['penicilline', 'aspirine_ains', 'anesthesiques', 'iode', 'latex', 'aliments', 'venins'] as const;

/** Ce que les secours doivent savoir pour se faire comprendre du client. */
export const COMMUNICATION = ['malentendant', 'malvoyant', 'parole_difficile', 'non_francophone'] as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
// Les espaces, points et tirets de saisie (« +225 07 58 42 19 63 ») sont retirés avant
// contrôle : on stocke le numéro tel qu'on le compose, 8 à 15 chiffres (norme E.164).
const telephone = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().replace(/[\s.-]/g, '') : v),
  z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide'),
);
const texteLibre = (max: number) => z.string().trim().max(max).optional();
const aujourdHui = () => new Date().toISOString().slice(0, 10);

export const ficheSchema = z.object({
  identite: z.object({
    nom: z.string().trim().min(2, 'Nom trop court').max(60),
    prenoms: z.string().trim().min(2, 'Prénoms trop courts').max(80),
    dateNaissance: date,
    sexe: z.enum(['F', 'M']).optional(),
  }),
  piece: z.object({
    type: z.enum(['cni', 'passeport']),
    numero: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9 -]{4,18}[A-Z0-9]$/, 'Numéro de pièce invalide'),
    expiration: date,
  }),
  cmu: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9 -]{4,18}[A-Z0-9]$/, 'Numéro CMU invalide').optional(),
  sante: z.object({
    groupeSanguin: z.enum(GROUPES_SANGUINS),
    antecedents: z.array(z.enum(ANTECEDENTS)).max(ANTECEDENTS.length),
    autresAntecedents: texteLibre(300),
    allergies: texteLibre(300),
    traitements: texteLibre(300),
    anticoagulants: z.boolean(),
    stimulateurCardiaque: z.boolean(),
    reactionAllergiqueGrave: z.boolean(),
    /*
     * Questionnaire enrichi : tout est facultatif, pour que les dossiers déjà enregistrés
     * restent valides et que personne ne soit forcé de répondre à ce qu'il ignore.
     */
    poidsKg: z.number().min(20).max(300).optional(),
    tailleCm: z.number().min(80).max(250).optional(),
    allergiesConnues: z.array(z.enum(ALLERGIES)).max(ALLERGIES.length).optional(),
    insuline: z.boolean().optional(),
    grossesseMois: z.number().int().min(1).max(9).optional(),
    hospitalisationRecente: z.boolean().optional(),
    chirurgies: texteLibre(300),
    implants: texteLibre(200),
    communication: z.array(z.enum(COMMUNICATION)).max(COMMUNICATION.length).optional(),
    langues: texteLibre(80),
    consignes: texteLibre(300),
    hopital: texteLibre(80),
  }),
  urgence: z.object({
    nom: z.string().trim().min(2, 'Nom du contact trop court').max(80),
    lien: z.string().trim().min(2).max(40),
    telephone,
  }),
  /** Seconde personne à prévenir, si la première ne répond pas. */
  urgence2: z.object({
    nom: z.string().trim().min(2, 'Nom du contact trop court').max(80),
    lien: z.string().trim().min(2).max(40),
    telephone,
  }).optional(),
  medecin: z.object({ nom: z.string().trim().max(80).optional(), telephone: telephone.optional() }).optional(),
  /** Mutuelle ou assurance santé privée : demandée à l'admission dans une clinique. */
  mutuelle: z.object({ compagnie: z.string().trim().max(80).optional(), numero: z.string().trim().max(40).optional() }).optional(),
}).superRefine((f, ctx) => {
  // « En cours de validité » : une pièce expirée ne permet pas d'identifier le client.
  if (f.piece.expiration < aujourdHui()) {
    ctx.addIssue({ code: 'custom', path: ['piece', 'expiration'], message: 'Pièce d’identité expirée : renseignez une pièce en cours de validité' });
  }
  const naissance = Date.parse(f.identite.dateNaissance);
  const age = (Date.now() - naissance) / (365.25 * 86_400_000);
  if (!Number.isFinite(naissance) || age < 16 || age > 120) {
    ctx.addIssue({ code: 'custom', path: ['identite', 'dateNaissance'], message: 'Date de naissance invalide (16 ans minimum)' });
  }
});

export type FicheMedicale = z.infer<typeof ficheSchema>;

export const consentementSchema = z.object({
  version: z.literal(CONSENTEMENT_VERSION),
  /** Le client a lu la présentation du service jusqu'au bout. */
  lu: z.literal(true),
  /** Il accepte que ces informations soient transmises au SAMU en cas d'accident. */
  accepte: z.literal(true),
});

export interface Consultation {
  le: string;
  /** Nom de l'agent : le client sait qui a ouvert son dossier. */
  par: string;
  alerteId: string;
}

interface DossierStocke {
  /** Identifiant du client (un dossier par client). */
  id: string;
  chiffre: DonneeChiffree;
  consentementVersion: string;
  consentementLe: string;
  creeLe: string;
  majLe: string;
  consultations: Consultation[];
}

export interface StatutDossier {
  disponible: boolean;
  inscrit: boolean;
  depuis: string | null;
  majLe: string | null;
  consultations: Consultation[];
}

export class DossierMedicalService {
  constructor(private readonly repo: Repository<DossierStocke>, private readonly coffre: CoffreMedical) {}

  get disponible(): boolean {
    return this.coffre.disponible;
  }

  /** Nombre de clients inscrits (tableau de bord : aucune donnée de santé n'en sort). */
  nombreInscrits(): number {
    return this.repo.all().length;
  }

  estInscrit(clientId: string): boolean {
    return Boolean(this.repo.get(clientId));
  }

  statut(clientId: string): StatutDossier {
    const d = this.repo.get(clientId);
    return {
      disponible: this.coffre.disponible,
      inscrit: Boolean(d),
      depuis: d?.creeLe ?? null,
      majLe: d?.majLe ?? null,
      consultations: d?.consultations ?? [],
    };
  }

  inscrire(clientId: string, fiche: FicheMedicale): StatutDossier {
    const maintenant = new Date().toISOString();
    const ancien = this.repo.get(clientId);
    this.repo.put({
      id: clientId,
      chiffre: this.coffre.chiffrer(clientId, fiche),
      consentementVersion: CONSENTEMENT_VERSION,
      consentementLe: maintenant,
      creeLe: ancien?.creeLe ?? maintenant,
      majLe: maintenant,
      consultations: ancien?.consultations ?? [],
    });
    return this.statut(clientId);
  }

  /** Lecture par le titulaire lui-même (écran de l'app). */
  lire(clientId: string): FicheMedicale | null {
    const d = this.repo.get(clientId);
    return d ? this.coffre.dechiffrer<FicheMedicale>(clientId, d.chiffre) : null;
  }

  /**
   * Lecture d'URGENCE par la supervision. Les conditions (alerte en cours, agent
   * gestionnaire) sont vérifiées par la route ; ici, la consultation est inscrite
   * dans le dossier AVANT de rendre les données.
   */
  lirePourUrgence(clientId: string, par: string, alerteId: string): FicheMedicale | null {
    const d = this.repo.get(clientId);
    if (!d) return null;
    d.consultations = [{ le: new Date().toISOString(), par, alerteId }, ...d.consultations].slice(0, 50);
    this.repo.put(d);
    return this.coffre.dechiffrer<FicheMedicale>(clientId, d.chiffre);
  }

  supprimer(clientId: string): void {
    this.repo.delete(clientId);
  }
}
