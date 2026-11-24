import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { createRepository, type Repository } from '../../core/db/repository.js';
import { conflict, forbidden, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import type { Permission } from '../admin/roles.js';
import { driverTokenOf, requireDriver, verifyDriverToken } from '../driver-app/auth.js';
import type { Ride } from './store.js';

/**
 * LA VOIX DE BORD D'ORION PRO : une fois le client à bord (code à 4 chiffres donné au
 * chauffeur), la voix du GPS lui souhaite la bienvenue, personnellement :
 *  - sa civilité et son nom (civilité choisie dans son compte, sinon déduite du prénom) ;
 *  - un salut et un vœu selon le moment de la journée (heure d'Abidjan, GMT) ;
 *  - les consignes de bord (ceinture, Wi-Fi, pharmacie, eau, bouton SOS) ;
 *  - ORION Assurance : couvert à 100 % s'il l'a activée pour cette course, sinon 50 %.
 * Voix féminine pour un client, masculine pour une cliente. La direction peut retoucher
 * chaque phrase depuis la console : les textes ci-dessous sont ceux d'origine.
 */

export type Civilite = 'M' | 'Mme';
export type VoixBord = 'feminine' | 'masculine';
export type MomentAccueil = 'matin' | 'fin_matinee' | 'debut_apres_midi' | 'fin_apres_midi' | 'debut_soiree' | 'soir' | 'nuit';

export interface PhraseMoment { salut: string; voeu: string; fin: string }
export interface TextesBienvenue {
  moments: Record<MomentAccueil, PhraseMoment>;
  /** Corps du message. Repères : {salut} {civilite} {nom} {voeu} {assurance} {fin}. */
  corps: string;
  assure: string;
  nonAssure: string;
}

export const TEXTES_BIENVENUE: TextesBienvenue = {
  moments: {
    matin: { salut: 'Bonjour', voeu: 'j’espère que vous allez bien et que vous avez passé une excellente nuit', fin: 'Excellente journée' },
    fin_matinee: { salut: 'Bonjour', voeu: 'j’espère que votre journée se passe bien', fin: 'Excellente journée' },
    debut_apres_midi: { salut: 'Bonsoir', voeu: 'j’espère que vous passez un excellent début d’après-midi', fin: 'Excellent après-midi' },
    fin_apres_midi: { salut: 'Bonsoir', voeu: 'j’espère que vous avez passé un excellent après-midi', fin: 'Excellente fin d’après-midi' },
    debut_soiree: { salut: 'Bonsoir', voeu: 'j’espère que votre soirée a bien débuté et que la journée s’est bien passée', fin: 'Excellente soirée' },
    soir: { salut: 'Bonsoir', voeu: 'j’espère que la soirée s’est bien achevée', fin: 'Excellente soirée' },
    nuit: { salut: 'Bonsoir', voeu: 'j’espère que vous allez bien et que toute cette journée a été bénéfique pour vous', fin: 'Excellente nuit' },
  },
  corps: '{salut} {civilite} {nom}, bienvenue à bord d’ORION. {voeu}, et que vous passerez un excellent trajet avec votre chauffeur. '
    + 'Veuillez attacher votre ceinture de sécurité, même à l’arrière du véhicule. '
    + 'Votre chauffeur est entièrement à votre disposition : pour quoi que ce soit, n’hésitez pas à lui faire part de vos besoins. '
    + 'Vous bénéficiez à bord d’un Wi-Fi gratuit, d’une boîte à pharmacie et de bouteilles d’eau. '
    + 'En cas de problème, n’hésitez pas à nous contacter avec le bouton SOS présent dans l’application : ORION sera ravi de vous assister. '
    + '{assurance} '
    + 'Merci d’avoir choisi ORION pour votre transport. {fin}, et que le Bon Dieu vous protège.',
  assure: 'Votre course est protégée par ORION Assurance : en cas d’accident, chose que nous ne souhaitons pas bien sûr, vous êtes totalement pris en charge, à 100 %.',
  nonAssure: 'Sachez également qu’en cas d’accident, chose que nous ne souhaitons pas bien sûr, vous êtes totalement pris en charge à 100 % si vous activez ORION Assurance avant votre commande ; pour cette course, ORION vous prendra en charge à 50 %.',
};

/** Moment de la journée à Abidjan (GMT toute l'année). */
export function momentAccueil(d: Date): MomentAccueil {
  const h = d.getUTCHours();
  if (h >= 4 && h < 10) return 'matin';
  if (h >= 10 && h < 12) return 'fin_matinee';
  if (h >= 12 && h < 15) return 'debut_apres_midi';
  if (h >= 15 && h < 17) return 'fin_apres_midi';
  if (h >= 17 && h < 18) return 'debut_soiree';
  if (h >= 18 && h < 20) return 'soir';
  return 'nuit';
}

/* ------------------------- Civilité déduite du prénom ------------------------- */

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const liste = (s: string) => new Set(s.split(/\s+/).filter(Boolean).map(sansAccents));

/** Prénoms féminins courants en Côte d'Ivoire (akan, mandingue, chrétiens, français). */
const FEMININS = liste(`aya adjoua akissi akoua ahou amenan amoin affoue afoue ama amah adjo adjara aicha aichatou aissata aminata awa fatou fatoumata
  mariam mariame mariama assita kadidja kadidiatou kadiatou kady salimata rokia ramata nafissatou bintou djeneba fanta mawa maimouna hawa safiatou
  korotoum oumou nadia grace marie anne christelle carine sandrine nathalie patricia josiane joelle prisca estelle laetitia audrey brigitte sylvie
  chantal celine julie sophie isabelle sarah rachel esther ruth deborah emmanuelle danielle michelle yvette viviane solange florence claudine
  bernadette jeanne jacqueline pauline rose rosine olga alice clarisse edwige ella eunice flora gisele henriette irene judith lydie mireille monique
  nina odette paule raissa simone suzanne therese valerie yolande madeleine marthe marguerite veronique aurelie elodie emilie ines lea manon chloe
  claire laure laura lucie melanie nadege noemie ophelie stephanie tatiana vanessa victoire yasmine amandine armelle blandine carole cynthia diane
  dorcas edith fabienne francine gabrielle huguette ingrid josephine lucienne marina nicole perpetue reine sabine tania ursule virginie wendy
  aurore charlotte delphine elisabeth elise eva fanny gaelle helene jessica juliette justine karine linda lise louise lucile marion mathilde
  nadine natacha oceane pascale regine sonia sylviane yvonne zoe ange-marie marie-claire marie-france marie-noelle marie-laure`);

/** Prénoms masculins courants (hors jours akan, souvent portés comme noms de famille). */
const MASCULINS = liste(`jean pierre paul jacques michel andre joseph emmanuel serge patrick eric olivier didier franck frank herve alain christian
  daniel david samuel moise ibrahim ibrahima moussa mamadou souleymane seydou drissa adama bakary lassina yacouba karim abdoulaye amadou ousmane issa
  sekou siaka mohamed mohammed ali aboubacar boubacar cheick cheikh brahima zoumana fousseni kassoum salif sidiki tiemoko vamara aristide arnaud armand
  blaise bruno cedric charles constant cyrille dieudonne edouard felix fabrice fernand francois gerard gilles guillaume henri hugues innocent isaac
  jeremie jonathan jules julien justin kevin laurent leon lucien marc marcel martin mathieu matthieu maurice nicolas noel parfait pascal philippe
  raoul raymond remi richard robert roger romain sebastien simon stephane sylvain thierry thomas vincent wilfried xavier yves zacharie alphonse
  auguste benoit bertrand boris christophe desire elie eugene firmin gaston georges germain gustave hippolyte joel landry lionel ludovic marius
  narcisse octave prosper rodrigue sylvestre theodore urbain victor guy roland regis achille abel adrien alexandre alexis antoine anthony arthur
  axel benjamin clement damien denis florent gabriel hugo jordan lucas mickael quentin rene valentin william idrissa inza lamine mamadi namory
  ousmane oumar omar youssouf yaya zie bamba`);

/** Jours de naissance akan, masculins : prénoms, mais aussi noms de famille très répandus. */
const JOURS_AKAN_MASCULINS = liste('kouassi kwasi kouadio kodjo konan kouakou kwaku yao kouame kwame koffi kofi kouamé');

/**
 * Civilité probable d'après le nom saisi. Les prénoms sans ambiguïté priment (« Kouassi Aya » :
 * Aya, donc Madame) ; un jour akan masculin seul (« Konan Yao ») donne Monsieur ; sinon, inconnu.
 */
export function civiliteProbable(nom: string | undefined | null): Civilite | null {
  if (!nom) return null;
  const mots = sansAccents(nom).split(/[\s,]+/).filter(Boolean);
  for (const m of mots) {
    const variantes = [m, ...m.split('-')];
    for (const v of variantes) {
      if (FEMININS.has(v)) return 'Mme';
      if (MASCULINS.has(v)) return 'M';
    }
  }
  return mots.some((m) => m.split('-').some((v) => JOURS_AKAN_MASCULINS.has(v))) ? 'M' : null;
}

/** Voix de bord : féminine pour accueillir un client, masculine pour une cliente. */
export const voixPour = (c: Civilite | null): VoixBord => (c === 'Mme' ? 'masculine' : 'feminine');

/** Nom tel qu'il se dit : espaces réguliers, majuscules de saisie adoucies (« KOUASSI Aya » → « Kouassi Aya »). */
export function nomADire(nom: string): string {
  return nom.trim().replace(/\s+/g, ' ').split(' ')
    .map((mot) => (mot.length > 1 && mot === mot.toUpperCase() ? mot.charAt(0) + mot.slice(1).toLowerCase() : mot)).join(' ');
}

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface MessageBienvenue {
  texte: string;
  voix: VoixBord;
  civilite: Civilite | null;
  /** D'où vient la civilité : choisie par le client, déduite du prénom, ou inconnue. */
  origineCivilite: 'compte' | 'prenom' | 'inconnue';
  moment: MomentAccueil;
  assure: boolean;
}

export function composerBienvenue(o: { nom?: string | null; civilite?: Civilite | null; at: Date; assure: boolean; textes?: TextesBienvenue }): MessageBienvenue {
  const T = o.textes ?? TEXTES_BIENVENUE;
  const deduite = o.civilite ? null : civiliteProbable(o.nom);
  const civilite = o.civilite ?? deduite;
  const moment = momentAccueil(o.at);
  const p = T.moments[moment];
  const titre = civilite === 'M' ? 'Monsieur' : civilite === 'Mme' ? 'Madame' : '';
  const nom = o.nom ? nomADire(o.nom) : '';
  const texte = T.corps
    .replace('{salut}', p.salut)
    .replace('{civilite}', titre)
    .replace('{nom}', nom)
    .replace('{voeu}', majuscule(p.voeu))
    .replace('{assurance}', o.assure ? T.assure : T.nonAssure)
    .replace('{fin}', p.fin)
    // Sans civilité ni nom : « Bonjour, bienvenue à bord » (pas d'espace ni de virgule orphelins).
    .replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
  return { texte, voix: voixPour(civilite), civilite, origineCivilite: o.civilite ? 'compte' : deduite ? 'prenom' : 'inconnue', moment, assure: o.assure };
}

/* ------------------------------- Routes ------------------------------- */

interface EnregistrementTextes extends TextesBienvenue { id: 'textes'; majLe: string; majPar: string }
const depots = new WeakMap<Container, Repository<EnregistrementTextes>>();
function depotTextes(c: Container): Repository<EnregistrementTextes> {
  let d = depots.get(c);
  if (!d) { d = createRepository<EnregistrementTextes>('voix_bord'); depots.set(c, d); }
  return d;
}
/** Textes en vigueur : ceux de la console fusionnés sur ceux d'origine (un moment oublié garde son texte). */
export function textesEnVigueur(c: Container): TextesBienvenue {
  const e = depotTextes(c).get('textes');
  if (!e) return TEXTES_BIENVENUE;
  return {
    corps: e.corps || TEXTES_BIENVENUE.corps,
    assure: e.assure || TEXTES_BIENVENUE.assure,
    nonAssure: e.nonAssure || TEXTES_BIENVENUE.nonAssure,
    moments: Object.fromEntries((Object.keys(TEXTES_BIENVENUE.moments) as MomentAccueil[]).map((k) => [k, { ...TEXTES_BIENVENUE.moments[k], ...(e.moments?.[k] ?? {}) }])) as Record<MomentAccueil, PhraseMoment>,
  };
}

/** Le client a-t-il activé ORION Assurance pour cette course ? */
export const courseAssuree = (ride: Ride): boolean => (ride.quote.breakdown?.insurance ?? 0) > 0;

export async function bienvenueRoutes(app: FastifyInstance, container: Container): Promise<void> {
  /** ORION Pro : écouter l'accueil avant la première course (client et cliente d'exemple, heure réelle). */
  app.get('/drivers/:id/voix-bord/essai', async (req) => {
    const { id } = req.params as { id: string };
    requireDriver(req, id);
    const { genre } = parse(z.object({ genre: z.enum(['feminine', 'masculine']).default('feminine') }), req.query ?? {});
    // Voix féminine : elle accueille un client ; voix masculine : une cliente.
    return composerBienvenue(genre === 'feminine'
      ? { nom: 'Konan Yao', civilite: 'M', at: new Date(), assure: true, textes: textesEnVigueur(container) }
      : { nom: 'Aya Kouassi', civilite: 'Mme', at: new Date(), assure: false, textes: textesEnVigueur(container) });
  });

  /** Message d'accueil de la course, pour la voix de bord du chauffeur (client à bord). */
  app.get('/rides/:id/bienvenue', async (req) => {
    const { id } = req.params as { id: string };
    const ride = container.rides.get(id);
    if (!ride) throw notFound('Course introuvable');
    const chauffeur = verifyDriverToken(driverTokenOf(req));
    if (!chauffeur || chauffeur !== ride.driverId) throw forbidden('Réservé au chauffeur de la course');
    if (ride.serviceType === 'delivery') throw conflict('Pas d’accueil vocal pour une livraison');
    if (!['in_progress', 'arrived'].includes(ride.status)) throw conflict('Le client n’est pas encore à bord');
    const client = container.clients.get(ride.clientId);
    // Moment de l'accueil : la prise en charge (départ de la course), ou maintenant.
    const depart = [...ride.events].reverse().find((e) => e.type === 'in_progress' || e.type === 'started')?.at;
    const message = composerBienvenue({
      nom: client?.deletedAt ? null : client?.name ?? null,
      civilite: client?.civilite ?? null,
      at: depart ? new Date(depart) : new Date(),
      assure: courseAssuree(ride),
      textes: textesEnVigueur(container),
    });
    if (!ride.events.some((e) => e.type === 'bienvenue')) {
      ride.events.push({ type: 'bienvenue', at: new Date().toISOString(), payload: { moment: message.moment, voix: message.voix, civilite: message.civilite, origine: message.origineCivilite } });
      container.rides.persist(ride);
    }
    return message;
  });
}

/** Console : textes de la voix de bord (lecture, retouche, retour au texte d'origine) et essai. */
export function voixBordAdminRoutes(
  scoped: FastifyInstance,
  container: Container,
  exiger: (req: FastifyRequest, perm: Permission) => void,
  journaliser: (req: FastifyRequest, action: string, target?: string, details?: Record<string, unknown>) => void,
): void {
  const phrase = z.object({ salut: z.string().trim().min(2).max(40), voeu: z.string().trim().min(3).max(240), fin: z.string().trim().min(3).max(80) });
  const momentKeys = Object.keys(TEXTES_BIENVENUE.moments) as [MomentAccueil, ...MomentAccueil[]];
  scoped.get('/admin/voix-bord', async (req) => {
    exiger(req, 'services:read');
    const e = depotTextes(container).get('textes');
    const exemple = (civilite: Civilite, nom: string, h: number, assure: boolean) => {
      const at = new Date(); at.setUTCHours(h, 0, 0, 0);
      return composerBienvenue({ nom, civilite, at, assure, textes: textesEnVigueur(container) });
    };
    return {
      textes: textesEnVigueur(container), origine: TEXTES_BIENVENUE, majLe: e?.majLe ?? null, majPar: e?.majPar ?? null,
      exemples: [exemple('M', 'Konan Yao', 8, true), exemple('Mme', 'Aya Kouassi', 19, false)],
    };
  });
  scoped.put('/admin/voix-bord', async (req) => {
    exiger(req, 'services:write');
    const body = parse(z.object({
      corps: z.string().trim().min(40).max(2000).refine((s) => s.includes('{nom}') && s.includes('{salut}'), 'Le texte doit garder {salut} et {nom}'),
      assure: z.string().trim().min(10).max(400),
      nonAssure: z.string().trim().min(10).max(400),
      moments: z.record(z.enum(momentKeys), phrase),
    }), req.body);
    const acteur = (req as unknown as { admin?: { name?: string } }).admin?.name ?? 'console';
    depotTextes(container).put({ id: 'textes', ...body, moments: { ...TEXTES_BIENVENUE.moments, ...body.moments } as Record<MomentAccueil, PhraseMoment>, majLe: new Date().toISOString(), majPar: acteur });
    journaliser(req, 'voix_bord.update', 'textes');
    return { textes: textesEnVigueur(container) };
  });
  scoped.delete('/admin/voix-bord', async (req) => {
    exiger(req, 'services:write');
    depotTextes(container).delete?.('textes');
    journaliser(req, 'voix_bord.reset', 'textes');
    return { textes: TEXTES_BIENVENUE };
  });
}
