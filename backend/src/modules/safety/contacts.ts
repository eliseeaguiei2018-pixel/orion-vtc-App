import { randomUUID } from 'node:crypto';
import { badRequest, notFound } from '../../core/errors.js';
import type { Repository } from '../../core/db/repository.js';

/**
 * RÉPERTOIRE D'URGENCE ET REGISTRE DES CONTACTS.
 *
 * La session SAMU affichait les numéros de secours comme de simples étiquettes :
 * l'opérateur lisait « 185 » à l'écran et devait composer à la main sur son téléphone,
 * sans qu'aucune trace ne soit gardée. Dans une crise, c'est deux défauts graves :
 * on perd des secondes, et on ne sait plus après coup qui a été joint, quand, par qui,
 * ni ce qui a été dit.
 *
 * Ce module apporte les deux moitiés manquantes :
 *   1. un RÉPERTOIRE éditable depuis la console (les numéros d'astreinte changent, le
 *      garage partenaire change, l'assureur change — jamais par un redéploiement) ;
 *   2. un REGISTRE : chaque tentative de contact est consignée avec son auteur, son
 *      canal, son issue et son horodatage. C'est la pièce qu'on produit à l'assureur,
 *      à la police ou au juge.
 *
 * Note d'intégration : ORION n'a pas de passerelle téléphonique. Le serveur fournit le
 * lien de composition (`tel:` / `sms:`) que le poste de l'opérateur ouvre sur son
 * combiné ou son softphone, et consigne la tentative. Brancher un opérateur SIP plus
 * tard ne changera que l'exécution de l'appel, pas ce registre.
 */

export type ContactCategorie = 'secours' | 'interne' | 'partenaire' | 'course';

export interface ContactUrgence {
  id: string;
  label: string;
  numero: string;
  categorie: ContactCategorie;
  /** Ordre d'affichage dans le poste de l'opérateur (plus petit = plus haut). */
  ordre: number;
  actif: boolean;
  /** Précision affichée à l'opérateur (ex. « nuit et week-end »). */
  note?: string;
}

/** Répertoire de départ — Côte d'Ivoire. Entièrement modifiable depuis la console. */
export const CONTACTS_DEFAUT: ContactUrgence[] = [
  { id: 'samu', label: 'SAMU', numero: '185', categorie: 'secours', ordre: 1, actif: true, note: 'Urgences médicales' },
  { id: 'police', label: 'Police secours', numero: '170', categorie: 'secours', ordre: 2, actif: true },
  { id: 'police-111', label: 'Police (ligne 111)', numero: '111', categorie: 'secours', ordre: 3, actif: true },
  { id: 'pompiers', label: 'Sapeurs-pompiers (GSPM)', numero: '180', categorie: 'secours', ordre: 4, actif: true, note: 'Incendie, désincarcération' },
  { id: 'astreinte-ops', label: 'Astreinte Opérations ORION', numero: '+2250700000001', categorie: 'interne', ordre: 10, actif: true, note: '24/7' },
  { id: 'direction', label: 'Direction (DG)', numero: '+2250700000002', categorie: 'interne', ordre: 11, actif: true, note: 'Incident grave uniquement' },
  { id: 'assurance', label: 'Assureur flotte', numero: '+2250700000003', categorie: 'partenaire', ordre: 20, actif: true, note: 'Déclaration de sinistre' },
  { id: 'remorquage', label: 'Remorquage partenaire', numero: '+2250700000004', categorie: 'partenaire', ordre: 21, actif: true },
  { id: 'garage', label: 'Garage électrique agréé', numero: '+2250700000005', categorie: 'partenaire', ordre: 22, actif: true, note: 'Véhicules haute tension' },
];

export type CanalContact = 'appel' | 'sms' | 'whatsapp';
export type IssueContact = 'tentative' | 'joint' | 'non_joint' | 'messagerie';

/** Une tentative de contact, consignée. */
export interface ContactJournalEntry {
  id: string;
  /** Alerte SOS concernée. */
  alertId: string;
  /** Qui a appelé (nom de l'employé connecté). */
  agent: string;
  /** Entrée du répertoire, ou « libre » pour un numéro saisi à la main. */
  contactId: string;
  label: string;
  numero: string;
  canal: CanalContact;
  issue: IssueContact;
  /** Message envoyé (SMS/WhatsApp) ou compte rendu de l'appel. */
  message?: string;
  at: string;
}

/** Lien de composition remis au poste de l'opérateur. */
export function lienComposition(canal: CanalContact, numero: string, message?: string): string {
  const n = numero.replace(/\s+/g, '');
  if (canal === 'appel') return `tel:${n}`;
  if (canal === 'sms') return `sms:${n}${message ? `?body=${encodeURIComponent(message)}` : ''}`;
  return `https://wa.me/${n.replace(/^\+/, '')}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

const RECORD_ID = 'contacts_urgence';
interface ContactsRecord { id: string; contacts: ContactUrgence[] }

export class EmergencyContactsService {
  private contacts: ContactUrgence[];
  private readonly journal: ContactJournalEntry[] = [];

  constructor(
    private readonly repo?: Repository<ContactsRecord>,
    private readonly journalRepo?: Repository<ContactJournalEntry>,
  ) {
    const saved = repo?.get(RECORD_ID);
    this.contacts = saved?.contacts?.length ? saved.contacts.map((c) => ({ ...c })) : CONTACTS_DEFAUT.map((c) => ({ ...c }));
    for (const e of journalRepo?.all() ?? []) this.journal.push(e);
  }

  /** Répertoire complet (console). */
  list(): ContactUrgence[] {
    return [...this.contacts].sort((a, b) => a.ordre - b.ordre || a.label.localeCompare(b.label, 'fr'));
  }

  /** Ce que l'opérateur voit dans son poste : uniquement les lignes actives. */
  actifs(): ContactUrgence[] { return this.list().filter((c) => c.actif); }

  get(id: string): ContactUrgence | undefined { return this.contacts.find((c) => c.id === id); }

  /** Ajout ou modification d'une ligne du répertoire. */
  upsert(input: Partial<ContactUrgence> & { label: string; numero: string }): ContactUrgence {
    const numero = input.numero.trim();
    if (numero.length < 3) throw badRequest('Numéro trop court');
    const pente = input.label.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const id = input.id ?? (pente || randomUUID().slice(0, 8));
    const existant = this.contacts.find((c) => c.id === id);
    const contact: ContactUrgence = {
      id,
      label: input.label.trim(),
      numero,
      categorie: input.categorie ?? existant?.categorie ?? 'partenaire',
      ordre: input.ordre ?? existant?.ordre ?? 50,
      actif: input.actif ?? existant?.actif ?? true,
      note: input.note ?? existant?.note,
    };
    if (existant) Object.assign(existant, contact);
    else this.contacts.push(contact);
    this.persist();
    return contact;
  }

  remove(id: string): void {
    // Les numéros de secours nationaux ne se suppriment pas : on peut les désactiver,
    // jamais les faire disparaître par mégarde d'un poste de crise.
    const c = this.get(id);
    if (!c) throw notFound('Contact introuvable');
    if (c.categorie === 'secours') throw badRequest('Un numéro de secours national ne peut pas être supprimé — désactivez-le si nécessaire');
    this.contacts = this.contacts.filter((x) => x.id !== id);
    this.persist();
  }

  private persist(): void { this.repo?.put({ id: RECORD_ID, contacts: this.contacts }); }

  /**
   * Consigne une tentative de contact et renvoie le lien de composition.
   * Appelée AVANT la mise en relation : on trace l'intention, même si l'appel échoue.
   */
  consigner(input: {
    alertId: string; agent: string; canal: CanalContact;
    contactId?: string; numero?: string; label?: string;
    message?: string; issue?: IssueContact;
  }): { entry: ContactJournalEntry; lien: string } {
    const repertoire = input.contactId ? this.get(input.contactId) : undefined;
    const numero = (repertoire?.numero ?? input.numero ?? '').trim();
    if (!numero) throw badRequest('Aucun numéro à composer');
    const entry: ContactJournalEntry = {
      id: randomUUID().slice(0, 8),
      alertId: input.alertId,
      agent: input.agent,
      contactId: repertoire?.id ?? 'libre',
      label: repertoire?.label ?? input.label ?? 'Numéro libre',
      numero,
      canal: input.canal,
      issue: input.issue ?? 'tentative',
      message: input.message,
      at: new Date().toISOString(),
    };
    this.journal.push(entry);
    this.journalRepo?.put(entry);
    return { entry, lien: lienComposition(input.canal, numero, input.message) };
  }

  /** Mise à jour de l'issue après l'appel (joint, messagerie, injoignable). */
  conclure(entryId: string, issue: IssueContact, compteRendu?: string): ContactJournalEntry {
    const e = this.journal.find((x) => x.id === entryId);
    if (!e) throw notFound('Tentative de contact introuvable');
    e.issue = issue;
    if (compteRendu) e.message = compteRendu;
    this.journalRepo?.put(e);
    return e;
  }

  /** Registre d'une alerte (pièce du dossier). */
  pourAlerte(alertId: string): ContactJournalEntry[] {
    return this.journal.filter((e) => e.alertId === alertId).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  /** Registre global (audit direction). */
  tout(limit = 200): ContactJournalEntry[] {
    return [...this.journal].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
  }
}
