/**
 * AGENT ORION AUTOMATIQUE — premier interlocuteur d'une alerte SOS.
 *
 * Quand une personne déclenche un SOS, ce n'est pas à elle d'appeler le SAMU, la police
 * ou les pompiers : c'est le CENTRE DE CONTRÔLE ORION qui le fait, selon ce qui se
 * passe. Encore faut-il le savoir tout de suite, à toute heure, même si aucun agent
 * humain n'a encore ouvert le dossier. C'est le rôle de cet agent :
 *
 *   1. il répond dans la seconde et tient la conversation (questions courtes, une à
 *      la fois, réponses d'un toucher si la personne ne peut pas écrire) ;
 *   2. il qualifie la situation (malaise, accident, agression, incendie, chauffeur
 *      dangereux, harcèlement, panne, objet oublié) et sa gravité ;
 *   3. il décide QUI le centre doit prévenir et le lui demande aussitôt, avec la raison ;
 *   4. il donne les gestes qui protègent en attendant ;
 *   5. il passe la main à l'agent humain dès que celui-ci prend le dossier.
 *
 * L'agent ne prétend jamais qu'un secours est en route : il dit ce qu'il a demandé au
 * centre. C'est le journal des appels du centre qui dit ensuite « joint ».
 *
 * FICHIER PARTAGÉ, sans aucune dépendance : il est copié à l'identique dans
 * `backend/src/modules/safety/agent-sos.ts` (serveur) et `frontend/src/agentSos.ts`
 * (application sans serveur). Le test `backend/tests/agent-sos.test.ts` échoue si les
 * deux copies divergent.
 */

export type LangueAgent = 'fr' | 'en';

export type MotifSos =
  | 'inconnu' | 'medical' | 'accident' | 'agression' | 'incendie'
  | 'chauffeur' | 'harcelement' | 'panne' | 'objet';

export type GraviteSos = 'vitale' | 'grave' | 'moderee' | 'faible';

/** Ce que l'agent demande au centre de contrôle : un service à prévenir, ou un geste interne. */
export type CleDemande =
  | 'samu' | 'police' | 'pompiers' | 'depannage'
  | 'centre:rappel' | 'centre:chauffeur' | 'centre:arret' | 'centre:remplacement' | 'centre:support';

export interface DemandeCentre {
  cle: CleDemande;
  /** Raison lisible par l'opérateur du centre (toujours en français : c'est sa langue de travail). */
  raison: string;
}

type Attente =
  | 'motif' | 'danger' | 'blesses' | 'conscience' | 'respiration' | 'saignement' | 'coince' | 'abri'
  | 'agresseur' | 'arme' | 'comportement' | 'arret' | 'sortis' | 'fumee' | 'remplacement' | 'fin';

type Fait =
  | 'blesses' | 'inconscient' | 'respireMal' | 'saigne' | 'coince' | 'arme' | 'agresseurPresent'
  | 'abri' | 'sortis' | 'refuseArret' | 'detour' | 'ivre' | 'vitesse' | 'deplace' | 'enfant' | 'enceinte'
  /** C'est la personne qui écrit qui est souffrante (elle est donc consciente). */
  | 'pourSoi';

export interface EtatAgentSos {
  langue: LangueAgent;
  motif: MotifSos;
  gravite: GraviteSos;
  /** Demandes déjà adressées au centre (jamais deux fois la même). */
  demandes: CleDemande[];
  /** Question posée, en attente de réponse. */
  attente: Attente | null;
  /** La personne ne peut pas parler : réponses d'un toucher, aucune consigne voyante. */
  discret: boolean;
  faits: Partial<Record<Fait, boolean>>;
  /** Questions posées et consignes données : l'agent ne se répète pas. */
  dit: string[];
  incompris: number;
  tours: number;
  relances: number;
  /** La personne a confirmé que tout va bien : l'agent ne pose plus de question. */
  termine: boolean;
}

export interface ContexteSos {
  /** Comment l'alerte est née : bouton SOS, choc détecté, ou réponse au contrôle de sécurité. */
  origine: 'bouton' | 'choc' | 'controle';
  /** Une course est en cours (le centre peut joindre le chauffeur et suivre le véhicule). */
  enCourse: boolean;
  /** Lieu de l'alerte, tel que le centre le lit (« Riviera Bonoumin, Cocody »). */
  lieu?: string;
  langue?: LangueAgent;
}

export interface TourAgent {
  etat: EtatAgentSos;
  /** Ce que l'agent écrit à la personne, dans l'ordre. */
  messages: string[];
  /** Nouvelles demandes au centre, nées de ce tour. */
  demandes: DemandeCentre[];
  /** Réponses proposées d'un toucher. */
  suggestions: string[];
  /** Synthèse pour l'opérateur du centre. */
  resume: string;
  /** L'alerte peut être close (fausse manœuvre confirmée, aucun service engagé). */
  terminer: boolean;
}

/* ------------------------------- Compréhension ------------------------------- */

const normaliser = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

const OUI = /^(oui|ouais|ouai|yes|yeah|yep|si\b|ok\b|d'accord|daccord|exact|affirmatif|tout a fait|c'est ca|1$)/;
const NON = /^(non|nan|no\b|nope|pas du tout|aucun|aucune|personne\b|negatif|2$)/;
const NE_SAIT_PAS = /(je ne sais pas|je sais pas|sais pas|aucune idee|peut-etre|peut etre|don't know|dont know|not sure|maybe)/;

const MOTIFS: Array<[MotifSos, RegExp]> = [
  ['incendie', /(incendie|fumee|flamme|\bbrule\b|en train de bruler|prend feu|pris feu|a pris feu|explos|\bfire\b|smoke|burning|(^|[^a-z])feu(?! rouge| tricolore| vert| orange|x)\b)/],
  ['agression', /(agress|braqu|cambriol|\bvole\b|\bvolee?\b|m'a vole|m'ont vole|on m'a vole|depouill|arrach|racket|kidnapp|enlev|sequestr|\bviol|menac|frapp|tabass|battu|gifl|etrangl|m'a tape|couteau|pistolet|fusil|machette|\barmee?s?\b|\barmes?\b|microbes|assault|attack|robb|mugg|threat|\bgun\b|knife|weapon)/],
  ['accident', /(accident|collision|percut|renvers|tonneau|carambol|rentre dedans|rentre dans|sortie? de (la )?route|on a tape|\bchoc\b|crash|hit by)/],
  ['medical', /(malaise|evanoui|inconscient|perdu connaissance|convuls|epilep|\bcrise\b|asthm|respir|etouff|poitrine|\bcoeur\b|cardiaque|\bavc\b|paralys|saign|hemorrag|\bsang\b|bless|fractur|douleur|mal au|mal a la|mal aux|\bvomi|vertige|allerg|accouch|contraction|enceinte|diabet|drepanocyt|brulure|me sens mal|ne va pas bien|va tres mal|faint|unconscious|breath|bleed|chest pain|heart|seizure|pregnan|injur|\bhurt|\bsick\b|illness|\bill\b)/],
  ['chauffeur', /(roule trop vite|trop vite|exces de vitesse|conduit mal|conduite dangereuse|dangereusement|zigzag|\bivre\b|saoul|bourre|alcool|drogue|somnol|s'endort|endormi|dort au volant|telephone au volant|grille (le |les |un )?feu|change (de |d')(route|itineraire|chemin|trajet)|pas (le|la) bon(ne)? (chemin|route|itineraire)|detour|mauvaise direction|refuse de s'arreter|veut pas s'arreter|ne s'arrete pas|pas me laisser descendre|verrouill|speeding|too fast|drunk|wrong (way|route)|won't stop|wont stop|(chauffeur|conducteur|driver).*(inquiet|peur|bizarre|louche|etrange|dangereu|agressif|insult|worr|scar|weird|rude))/],
  ['harcelement', /(harcel|attouch|me touche|m'a touche|main sur|deplace|avances|\bdrague|me suit|me suivent|suivie? par|filature|obscen|sexuel|harass|touching|touched me|stalk|following me)/],
  ['panne', /(\bpanne|\bcreve|crevaison|pneu|ne demarre|demarre plus|en rade|embourb|batterie a plat|plus de batterie|plus de charge|moteur (s'est )?arrete|\bcale\b|surchauffe|breakdown|broke down|flat tire|won't start|wont start)/],
  ['objet', /(oublie|j'ai laisse|perdu mon|perdu ma|perdu mes|objet perdu|lost my|left my|forgot my)/],
];

const PAS_PARLER = /(peux pas parler|peut pas parler|peux pas ecrire|pas parler|discret|\bchut\b|il (m')?ecoute|il m'entend|il me regarde|can't talk|cant talk|cannot talk|can't speak)/;
const FAUSSE_ALERTE = /(fausse (alerte|manoeuvre|manip)|par erreur|\berreur\b|me suis trompe|tout va bien|ca va bien|c'est bon|rien de grave|pas grave|plus besoin|\bannul|vous pouvez clore|suis en securite|false alarm|by mistake|i'm fine|im fine|i am fine|i am safe|i'm safe|all good|all is well|never mind|(^| )ca va( mieux)?( merci)?$)/;
const AGGRAVE = /(s'aggrave|aggrave|empire|de pire en pire|getting worse|\bworse\b)/;
const VA_MAL = /(ne va pas|va pas bien|pas en securite|pas bien du tout|not safe|not ok|not fine)/;
const DETRESSE = /(aide|au secours|secours|\bhelp\b|urgence|urgent|danger|j'ai peur|\bvite\b|\bsos\b|emergency|scared)/;
const RAPPEL = /(appelez[- ]moi|rappelez[- ]moi|appelle[- ]moi|call me)/;
const DELAI = /(quand|combien de temps|ils arrivent|arrivent quand|how long|when will)/;
const MERCI = /^(merci|thanks|thank you)/;

const FAITS: Array<[Fait, RegExp, boolean]> = [
  ['inconscient', /(inconscient|evanoui|ne repond (plus|pas)|ne bouge (plus|pas)|ne reagit|perdu connaissance|unconscious|not responding|passed out)/, true],
  ['respireMal', /(ne respire (plus|pas)|respire (plus|pas|mal)|a respirer|etouff|can't breathe|cant breathe|not breathing)/, true],
  ['saigne', /(pas de saignement|ne saigne pas|ne saigne plus|pas de sang|no bleeding|not bleeding)/, false],
  ['saigne', /(saign|hemorrag|beaucoup de sang|plein de sang|bleed)/, true],
  ['blesses', /(pas de blesse|aucun blesse|personne n'est blesse|pas blesse|ne suis pas blesse|no one is hurt|not hurt|not injured|nobody is hurt)/, false],
  ['blesses', /(bless|fractur|injur|\bhurt)/, true],
  ['coince', /(coince|bloquee? dans|incarcer|peu[xt] pas sortir|trapped|stuck inside)/, true],
  ['arme', /(couteau|pistolet|fusil|machette|\barmee?s?\b|\barmes?\b|\bgun\b|knife|weapon)/, true],
  ['agresseurPresent', /(est parti|sont partis|est partie|ont fui|a fui|s'est enfui|he left|they left|he is gone|they are gone)/, false],
  ['agresseurPresent', /(encore la|toujours la|il me suit|ils me suivent|il revient|still here|still there)/, true],
  ['refuseArret', /(refuse de s'arreter|veut pas s'arreter|ne s'arrete pas|pas me laisser descendre|verrouill|won't stop|wont stop|won't let me)/, true],
  ['detour', /(change (de |d')(route|itineraire|chemin|trajet)|pas (le|la) bon(ne)? (chemin|route|itineraire)|detour|mauvaise direction|wrong (way|route))/, true],
  ['ivre', /(\bivre\b|saoul|bourre|alcool|drogue|somnol|s'endort|endormi|dort au volant|drunk|asleep|sleepy)/, true],
  ['vitesse', /(trop vite|exces de vitesse|dangereusement|conduite dangereuse|conduit mal|zigzag|grille (le |les |un )?feu|speeding|too fast)/, true],
  ['deplace', /(deplace|attouch|me touche|m'a touche|avances|\bdrague|obscen|sexuel|harass|touching|touched me)/, true],
  ['pourSoi', /(c'est moi|je me sens|j'ai (mal|une douleur|du mal|des vertiges)|je saigne|je suis bless|je fais (un|une)|j'etouffe|je n'arrive|je vais m'evanouir|it's me|its me|i feel|i am hurt|i'm hurt|i am bleeding|i can't breathe|i cant breathe)/, true],
  ['enfant', /(enfant|\bbebe\b|nourrisson|\bchild\b|\bbaby\b|\bkid\b)/, true],
  ['enceinte', /(enceinte|accouch|contraction|pregnan)/, true],
];

/* --------------------------------- Phrases --------------------------------- */

type Bi = [string, string];
const choisir = (l: LangueAgent, t: Bi): string => (l === 'en' ? t[1] : t[0]);

const NOM_SERVICE: Record<'samu' | 'police' | 'pompiers' | 'depannage', Bi> = {
  samu: ['le SAMU (185)', 'the ambulance service (185)'],
  police: ['la police (170)', 'the police (170)'],
  pompiers: ['les sapeurs-pompiers (180)', 'the fire brigade (180)'],
  depannage: ['le dépannage ORION', 'ORION roadside assistance'],
};

const P = {
  ouvertureBouton: (lieu?: string): Bi => [
    `Ici le centre de contrôle ORION. J’ai bien votre alerte${lieu ? ` et votre position (${lieu})` : ' et votre position'}. Que se passe-t-il ?`,
    `ORION control centre here. I have your alert${lieu ? ` and your position (${lieu})` : ' and your position'}. What is happening?`,
  ],
  ouvertureChoc: (): Bi => [
    'Ici le centre de contrôle ORION. Un choc violent vient d’être détecté sur votre trajet. Êtes-vous blessé(e) ?',
    'ORION control centre here. A violent impact was just detected on your trip. Are you hurt?',
  ],
  ouvertureControle: (): Bi => [
    'Ici le centre de contrôle ORION. Vous nous dites ne pas vous sentir en sécurité : je suis là. Qu’est-ce qui vous inquiète ?',
    'ORION control centre here. You told us you do not feel safe: I am with you. What is worrying you?',
  ],
  aucunAppel: ['Vous n’avez aucun appel à passer : le centre s’en charge.', 'You have no call to make: the centre handles it.'] as Bi,
  prevenir: (services: string): Bi => [
    `Je fais prévenir ${services} par le centre de contrôle.`,
    `I am having the control centre alert ${services}.`,
  ],
  parPrecaution: (services: string): Bi => [
    `Par précaution, je fais prévenir ${services} par le centre de contrôle.`,
    `As a precaution, I am having the control centre alert ${services}.`,
  ],
  centreChauffeur: ['Le centre appelle votre chauffeur maintenant et suit le véhicule en direct.', 'The centre is calling your driver now and tracking the vehicle live.'] as Bi,
  centreRappel: ['Un agent du centre vous appelle sur votre numéro.', 'A centre agent is calling you on your number.'] as Bi,
  centreArret: ['C’est transmis : le centre fait arrêter la course au prochain endroit sûr et organise la suite de votre trajet.', 'Done: the centre is having the ride stopped at the next safe place and arranging the rest of your trip.'] as Bi,
  centreRemplacement: ['Le centre vous envoie un autre véhicule ORION.', 'The centre is sending you another ORION vehicle.'] as Bi,
  centreSupport: [
    'Ce n’est pas une urgence vitale : je transmets au support ORION, qui contacte le chauffeur pour retrouver votre objet. La réponse arrivera dans vos messages.',
    'This is not a life-threatening emergency: I am passing it to ORION support, who will contact the driver to find your item. The answer will arrive in your messages.',
  ] as Bi,
  discret: ['Compris. Je reste discret : répondez d’un simple toucher, sans montrer votre téléphone.', 'Understood. I will stay discreet: answer with a single tap, without showing your phone.'] as Bi,
  qMotif: ['Dites-moi en un mot ce qui se passe, ou touchez une réponse.', 'Tell me in a word what is happening, or tap an answer.'] as Bi,
  qMotif2: ['Je veux être sûr de bien vous aider. Est-ce un accident, un malaise, une agression, ou un problème avec le chauffeur ?', 'I want to be sure I help you properly. Is it an accident, an illness, an assault, or a problem with the driver?'] as Bi,
  qDanger: ['Êtes-vous en danger immédiat ?', 'Are you in immediate danger?'] as Bi,
  qBlesses: ['Y a-t-il des blessés ?', 'Is anyone hurt?'] as Bi,
  qBlesse: ['Êtes-vous blessé(e) ?', 'Are you hurt?'] as Bi,
  qConscience: ['La personne est-elle consciente et respire-t-elle normalement ?', 'Is the person conscious and breathing normally?'] as Bi,
  qRespiration: ['Avez-vous du mal à respirer, ou une douleur dans la poitrine ?', 'Are you struggling to breathe, or do you have chest pain?'] as Bi,
  qSaignement: ['Y a-t-il un saignement important ?', 'Is there heavy bleeding?'] as Bi,
  qCoince: ['Quelqu’un est-il coincé dans un véhicule, ou voyez-vous de la fumée ?', 'Is anyone trapped in a vehicle, or do you see smoke?'] as Bi,
  qAbri: ['Êtes-vous à l’abri de la circulation ?', 'Are you clear of the traffic?'] as Bi,
  qAgresseur: ['L’agresseur est-il encore près de vous ?', 'Is the attacker still near you?'] as Bi,
  qArme: ['Est-il armé ?', 'Is he armed?'] as Bi,
  qComportement: ['Que fait-il exactement ?', 'What exactly is he doing?'] as Bi,
  qArret: ['Voulez-vous que la course soit arrêtée au prochain endroit sûr ?', 'Do you want the ride stopped at the next safe place?'] as Bi,
  qSortis: ['Tout le monde est-il sorti du véhicule ?', 'Is everyone out of the vehicle?'] as Bi,
  qFumee: ['Quelqu’un est-il blessé ou a-t-il respiré de la fumée ?', 'Is anyone hurt, or has anyone breathed in smoke?'] as Bi,
  qRemplacement: ['Souhaitez-vous qu’un autre véhicule ORION vienne vous chercher ?', 'Would you like another ORION vehicle to pick you up?'] as Bi,
  qFin: ['Vous confirmez que tout va bien et que vous êtes en sécurité ?', 'Can you confirm that all is well and that you are safe?'] as Bi,
  qFinObjet: ['Puis-je clore cette alerte SOS ?', 'May I close this SOS alert?'] as Bi,
  cPls: [
    'Allongez-la sur le côté, la tête légèrement en arrière, et ne lui donnez rien à boire. Restez près d’elle : un agent du centre vous appelle pour vous guider.',
    'Lay them on their side, head slightly back, and give them nothing to drink. Stay close: a centre agent is calling to guide you.',
  ] as Bi,
  cSoi: [
    'Asseyez-vous ou allongez-vous, desserrez col et ceinture, et ne faites aucun effort. Un agent du centre vous appelle.',
    'Sit or lie down, loosen your collar and belt, and make no effort. A centre agent is calling you.',
  ] as Bi,
  cCompression: ['Appuyez fort sur la plaie avec un tissu propre, sans relâcher.', 'Press firmly on the wound with a clean cloth and do not let go.'] as Bi,
  cChaussee: [
    'Si vous pouvez marcher, quittez la chaussée et mettez-vous derrière une glissière ou sur le trottoir. Ne déplacez pas un blessé qui ne peut pas bouger seul.',
    'If you can walk, leave the road and stand behind a barrier or on the pavement. Do not move an injured person who cannot move alone.',
  ] as Bi,
  cChausseePanne: ['Descendez du côté opposé à la circulation et attendez à l’écart de la chaussée.', 'Get out on the side away from traffic and wait clear of the road.'] as Bi,
  cAgression: ['Ne résistez pas et ne négociez pas vos affaires : votre vie passe avant tout.', 'Do not resist and do not argue over your belongings: your life comes first.'] as Bi,
  cEloigner: ['Si vous pouvez vous éloigner vers un lieu fréquenté et éclairé, faites-le. Le centre suit votre position en direct.', 'If you can move to a busy, well-lit place, do so. The centre is tracking your position live.'] as Bi,
  cEvacuer: [
    'Sortez du véhicule tout de suite et éloignez-vous d’au moins 50 mètres, à l’écart de la circulation. Ne retournez pas chercher vos affaires.',
    'Get out of the vehicle right now and move at least 50 metres away, clear of traffic. Do not go back for your belongings.',
  ] as Bi,
  cChauffeur: ['Restez attaché(e) et gardez votre téléphone en main.', 'Keep your seat belt on and your phone in your hand.'] as Bi,
  cPersonnesDedans: ['Je signale au centre qu’il reste quelqu’un à l’intérieur. N’y retournez pas vous-même si les flammes ou la fumée sont proches.', 'I am telling the centre someone is still inside. Do not go back yourself if flames or smoke are close.'] as Bi,
  suivi: ['Je reste avec vous. Écrivez-moi si quoi que ce soit change.', 'I am staying with you. Write to me if anything changes.'] as Bi,
  note: ['Bien noté, je transmets au centre.', 'Noted, I am passing it on to the centre.'] as Bi,
  aggrave: ['Je le signale immédiatement au centre de contrôle.', 'I am reporting it to the control centre right now.'] as Bi,
  delai: [
    'Dès que le centre a joint un service, cela s’affiche au-dessus de cette conversation. Je vous le dis aussi ici.',
    'As soon as the centre reaches a service, it shows above this conversation. I will tell you here too.',
  ] as Bi,
  merci: ['Je vous en prie. Je reste en ligne.', 'You are welcome. I am staying on the line.'] as Bi,
  finOk: ['C’est noté, je clos l’alerte. Au moindre doute, appuyez de nouveau sur SOS : le centre répond à toute heure.', 'Noted, I am closing the alert. If in any doubt, press SOS again: the centre answers at any hour.'] as Bi,
  finHumain: ['Merci. Je préviens le centre que vous êtes en sécurité ; un agent vous confirme la clôture.', 'Thank you. I am telling the centre you are safe; an agent will confirm the closure.'] as Bi,
  finNon: ['D’accord, je reste avec vous. Dites-moi ce qui se passe.', 'All right, I am staying with you. Tell me what is happening.'] as Bi,
  relance1: ['Je suis toujours là. Si vous ne pouvez pas écrire, touchez simplement une réponse.', 'I am still here. If you cannot write, just tap an answer.'] as Bi,
  relance2: [
    'Sans nouvelle de vous, je demande au centre de vous appeler et de prévenir la police par précaution. Si tout va bien, dites-le-moi.',
    'With no news from you, I am asking the centre to call you and alert the police as a precaution. If all is well, tell me.',
  ] as Bi,
  relance2Deja: ['Sans nouvelle de vous, je demande au centre de vous appeler. Si tout va bien, dites-le-moi.', 'With no news from you, I am asking the centre to call you. If all is well, tell me.'] as Bi,
  passageHumain: (agent: string): Bi => [
    `${agent}, du centre de contrôle ORION, prend votre dossier et a tout notre échange sous les yeux.`,
    `${agent}, from the ORION control centre, is taking over your case and can see our whole conversation.`,
  ],
  passageHumainAnonyme: [
    'Un agent du centre de contrôle ORION prend votre dossier. Il a tout notre échange sous les yeux.',
    'An agent from the ORION control centre is taking over your case and can see our whole conversation.',
  ] as Bi,
};

const S = {
  motifs: [
    ['Accident', 'Malaise ou blessure', 'Agression ou menace', 'Le chauffeur m’inquiète', 'Incendie ou fumée', 'Panne du véhicule', 'Je ne peux pas parler', 'Fausse manœuvre, tout va bien'],
    ['Accident', 'Illness or injury', 'Assault or threat', 'The driver worries me', 'Fire or smoke', 'Vehicle breakdown', 'I can’t talk', 'Pressed by mistake, I’m fine'],
  ],
  controle: [
    ['Il roule trop vite', 'Il a changé d’itinéraire', 'Propos ou gestes déplacés', 'Je suis menacé(e)', 'Je ne peux pas parler'],
    ['He is driving too fast', 'He took a wrong route', 'Inappropriate words or touching', 'I am being threatened', 'I can’t talk'],
  ],
  discret: [
    ['Je suis menacé(e)', 'Je suis blessé(e)', 'Le chauffeur m’inquiète', 'Fausse manœuvre, tout va bien'],
    ['I am being threatened', 'I am hurt', 'The driver worries me', 'Pressed by mistake, I’m fine'],
  ],
  ouiNon: [['Oui', 'Non'], ['Yes', 'No']],
  blesses: [['Oui, il y a des blessés', 'Non, personne n’est blessé', 'Je ne sais pas'], ['Yes, someone is hurt', 'No one is hurt', 'I don’t know']],
  blesse: [['Oui, je suis blessé(e)', 'Non, je ne suis pas blessé(e)'], ['Yes, I am hurt', 'No, I am not hurt']],
  conscience: [
    ['Oui, elle est consciente', 'Non, elle ne répond plus', 'Elle respire mal', 'C’est moi qui suis souffrant(e)'],
    ['Yes, they are conscious', 'No, not responding', 'They can’t breathe well', 'It’s me who is unwell'],
  ],
  saignement: [['Oui, ça saigne beaucoup', 'Non, pas de saignement'], ['Yes, heavy bleeding', 'No bleeding']],
  abri: [['Oui, je suis à l’abri', 'Non, je suis sur la chaussée'], ['Yes, I am clear', 'No, I am on the road']],
  agresseur: [['Oui, il est encore là', 'Non, il est parti'], ['Yes, still here', 'No, he left']],
  comportement: [
    ['Il roule trop vite', 'Il a changé d’itinéraire', 'Il refuse de s’arrêter', 'Il semble ivre ou somnolent', 'Propos ou gestes déplacés'],
    ['He is driving too fast', 'He took a wrong route', 'He won’t stop', 'He seems drunk or sleepy', 'Inappropriate words or touching'],
  ],
  arret: [['Oui, arrêtez la course', 'Non, je continue'], ['Yes, stop the ride', 'No, I will continue']],
  fin: [['Oui, tout va bien', 'Non, j’ai besoin d’aide'], ['Yes, all is well', 'No, I need help']],
  suivi: [['Appelez-moi', 'Je suis en sécurité maintenant', 'Ça s’aggrave'], ['Call me', 'I am safe now', 'It is getting worse']],
} satisfies Record<string, [string[], string[]]>;

const sugg = (l: LangueAgent, t: [string[], string[]]): string[] => (l === 'en' ? t[1] : t[0]);

/* --------------------------------- Moteur --------------------------------- */

const LIBELLE_MOTIF: Record<MotifSos, string> = {
  inconnu: 'Motif à préciser', medical: 'Urgence médicale', accident: 'Accident', agression: 'Agression',
  incendie: 'Incendie', chauffeur: 'Chauffeur signalé', harcelement: 'Harcèlement', panne: 'Panne', objet: 'Objet oublié',
};

const RANG_GRAVITE: Record<GraviteSos, number> = { faible: 0, moderee: 1, grave: 2, vitale: 3 };
const GRAVITE_MOTIF: Record<MotifSos, GraviteSos> = {
  inconnu: 'moderee', medical: 'grave', accident: 'grave', agression: 'grave', incendie: 'grave',
  chauffeur: 'moderee', harcelement: 'moderee', panne: 'faible', objet: 'faible',
};
/** Un motif plus grave remplace un motif moins grave, jamais l'inverse. */
const RANG_MOTIF: Record<MotifSos, number> = {
  inconnu: 0, objet: 1, panne: 2, harcelement: 3, chauffeur: 4, medical: 5, accident: 6, agression: 7, incendie: 8,
};

function etatInitial(langue: LangueAgent): EtatAgentSos {
  return {
    langue, motif: 'inconnu', gravite: 'moderee', demandes: [], attente: 'motif', discret: false,
    faits: {}, dit: [], incompris: 0, tours: 0, relances: 0, termine: false,
  };
}

/** Synthèse pour l'opérateur : motif, faits établis, gravité. */
export function resumeAgentSos(e: EtatAgentSos): string {
  const f = e.faits;
  const morceaux: string[] = [LIBELLE_MOTIF[e.motif]];
  if (f.inconscient) morceaux.push('personne inconsciente');
  if (f.respireMal) morceaux.push('détresse respiratoire');
  if (f.saigne) morceaux.push('saignement important');
  if (f.blesses === true && !f.saigne && !f.inconscient && e.motif !== 'medical') morceaux.push('blessé(s)');
  if (f.blesses === false) morceaux.push('aucun blessé déclaré');
  if (f.coince) morceaux.push('personne coincée ou fumée');
  if (f.arme) morceaux.push('arme signalée');
  if (f.pourSoi && e.motif === 'medical') morceaux.push('l’usager lui-même');
  if (f.agresseurPresent === true) morceaux.push('agresseur encore présent');
  if (f.agresseurPresent === false && e.motif === 'agression') morceaux.push('agresseur parti');
  if (f.refuseArret) morceaux.push('le chauffeur refuse de s’arrêter');
  if (f.detour) morceaux.push('itinéraire modifié');
  if (f.ivre) morceaux.push('chauffeur possiblement ivre ou somnolent');
  if (f.vitesse) morceaux.push('conduite dangereuse');
  if (f.deplace) morceaux.push('propos ou gestes déplacés');
  if (f.sortis === false) morceaux.push('personne(s) encore dans le véhicule');
  if (f.abri === false) morceaux.push('usager sur la chaussée');
  if (f.enfant) morceaux.push('enfant concerné');
  if (f.enceinte) morceaux.push('femme enceinte');
  if (e.discret) morceaux.push('ne peut pas parler');
  if (e.termine) morceaux.push('l’usager dit être en sécurité');
  return `${morceaux.join(' · ')} — gravité ${e.gravite === 'moderee' ? 'modérée' : e.gravite}`;
}

interface Tour {
  e: EtatAgentSos;
  ctx: ContexteSos;
  messages: string[];
  demandes: DemandeCentre[];
  suggestions: string[];
  terminer: boolean;
}

const dire = (t: Tour, phrase: Bi): void => { t.messages.push(choisir(t.e.langue, phrase)); };
const direUneFois = (t: Tour, cle: string, phrase: Bi): void => {
  if (t.e.dit.includes(cle)) return;
  t.e.dit.push(cle);
  dire(t, phrase);
};
const aggraver = (e: EtatAgentSos, g: GraviteSos): void => { if (RANG_GRAVITE[g] > RANG_GRAVITE[e.gravite]) e.gravite = g; };

/** Demande au centre, une seule fois par clé. Renvoie vrai si la demande est nouvelle. */
function demander(t: Tour, cle: CleDemande, raison: string): boolean {
  if (t.e.demandes.includes(cle)) return false;
  t.e.demandes.push(cle);
  t.demandes.push({ cle, raison });
  return true;
}

/** Annonce à la personne les services que le centre va prévenir à sa place. */
function annoncer(t: Tour, cles: CleDemande[], precaution = false): void {
  const externes = cles.filter((c): c is 'samu' | 'police' | 'pompiers' | 'depannage' => !c.startsWith('centre:'));
  if (externes.length === 0) return;
  const noms = externes.map((c) => choisir(t.e.langue, NOM_SERVICE[c]));
  const et = t.e.langue === 'en' ? ' and ' : ' et ';
  const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')}${et}${noms[noms.length - 1]}` : noms[0]!;
  dire(t, (precaution ? P.parPrecaution : P.prevenir)(liste));
  direUneFois(t, 'aucunAppel', P.aucunAppel);
}

/** Pose une question (une seule par tour) et propose les réponses d'un toucher. */
function poser(t: Tour, attente: Attente, phrase: Bi, reponses: [string[], string[]]): void {
  t.e.attente = attente;
  if (!t.e.dit.includes(`q:${attente}`)) t.e.dit.push(`q:${attente}`);
  dire(t, phrase);
  t.suggestions = sugg(t.e.langue, reponses);
}
const dejaPose = (e: EtatAgentSos, a: Attente): boolean => e.dit.includes(`q:${a}`);

/**
 * Ce que la situation, telle qu'on la connaît, impose de demander au centre. Appelé à
 * chaque tour : une information nouvelle (« il est armé », « elle ne respire plus »)
 * déclenche aussitôt le service qui manque.
 */
function decider(t: Tour): void {
  const { e, ctx } = t;
  const f = e.faits;
  const nouvelles: CleDemande[] = [];
  const precaution: CleDemande[] = [];
  const ajouter = (cle: CleDemande, raison: string, parPrecaution = false): void => {
    if (demander(t, cle, raison)) (parPrecaution ? precaution : nouvelles).push(cle);
  };

  if (f.inconscient || f.respireMal || f.saigne) aggraver(e, 'vitale');
  if (f.arme || f.agresseurPresent || f.sortis === false) aggraver(e, 'vitale');
  if (f.refuseArret) aggraver(e, 'grave');

  switch (e.motif) {
    case 'medical':
      ajouter('samu', `Urgence médicale${f.inconscient ? ' — personne inconsciente' : f.respireMal ? ' — détresse respiratoire' : f.saigne ? ' — hémorragie' : ''}`);
      if (f.inconscient || f.respireMal) ajouter('centre:rappel', f.pourSoi ? 'Usager en détresse : rester en ligne avec lui' : 'Guider les premiers gestes par téléphone');
      break;
    case 'accident':
      ajouter('police', 'Accident de la circulation — constat et sécurisation');
      if (f.blesses === true || f.inconscient || f.saigne || f.respireMal) ajouter('samu', 'Accident avec blessé(s)');
      if (f.coince) ajouter('pompiers', 'Personne coincée ou fumée après accident');
      if (f.blesses === false) ajouter('depannage', 'Véhicule accidenté, aucun blessé');
      break;
    case 'agression':
      ajouter('police', `Agression${f.arme ? ' à main armée' : ''}${f.agresseurPresent ? ' — agresseur encore sur place' : ''}`);
      if (f.blesses === true || f.saigne || f.inconscient) ajouter('samu', 'Victime d’agression blessée');
      if (ctx.enCourse) ajouter('centre:chauffeur', 'Agression signalée pendant la course : joindre le chauffeur, suivre le véhicule');
      break;
    case 'incendie':
      ajouter('pompiers', `Incendie de véhicule${f.sortis === false ? ' — personne(s) à l’intérieur' : ''}`);
      if (f.blesses === true || f.sortis === false || f.respireMal) ajouter('samu', 'Incendie : blessé ou fumée inhalée');
      break;
    case 'chauffeur':
      ajouter('centre:chauffeur', `Appeler le chauffeur : ${[f.vitesse && 'conduite dangereuse', f.detour && 'itinéraire modifié', f.ivre && 'possiblement ivre ou somnolent', f.refuseArret && 'refuse de s’arrêter', f.deplace && 'propos ou gestes déplacés'].filter(Boolean).join(', ') || 'le client se dit inquiet'}`);
      if (f.refuseArret || f.ivre) ajouter('police', f.refuseArret ? 'Le chauffeur refuse de s’arrêter : client retenu dans le véhicule' : 'Chauffeur possiblement ivre au volant');
      break;
    case 'harcelement':
      if (ctx.enCourse) ajouter('centre:chauffeur', 'Harcèlement signalé pendant la course : intervenir auprès du chauffeur');
      else ajouter('centre:rappel', 'Harcèlement signalé : rappeler l’usager');
      break;
    case 'panne':
      ajouter('depannage', 'Véhicule en panne avec un client à bord');
      break;
    case 'objet':
      ajouter('centre:support', 'Objet oublié : contacter le chauffeur');
      break;
    default:
      break;
  }

  // Un blessé, quel que soit le motif, appelle le SAMU.
  if (e.motif !== 'inconnu' && e.motif !== 'objet' && (f.inconscient || f.respireMal || f.saigne)) {
    ajouter('samu', 'Blessé grave signalé dans la conversation');
  }
  // Ne peut pas parler : on n'attend pas d'en savoir plus pour lever le doute.
  if (e.discret) {
    ajouter('police', 'L’usager ne peut pas parler : levée de doute', true);
    if (ctx.enCourse) ajouter('centre:chauffeur', 'L’usager ne peut pas parler : suivre le véhicule, ne pas alerter le chauffeur sans consigne');
  }

  annoncer(t, nouvelles);
  annoncer(t, precaution, true);
  if (t.demandes.some((d) => d.cle === 'centre:chauffeur') && e.motif !== 'agression' && !e.discret) direUneFois(t, 'centreChauffeur', P.centreChauffeur);
  if (t.demandes.some((d) => d.cle === 'centre:support')) direUneFois(t, 'centreSupport', P.centreSupport);
  if (t.demandes.some((d) => d.cle === 'centre:rappel') && e.motif === 'harcelement') direUneFois(t, 'centreRappel', P.centreRappel);
}

/** Les gestes qui protègent, puis la prochaine question utile — une seule par tour. */
function poursuivre(t: Tour): void {
  const { e, ctx } = t;
  const f = e.faits;
  if (e.termine) return;

  switch (e.motif) {
    case 'medical':
      if (f.pourSoi) {
        // La personne écrit : elle est consciente. On cherche le signe de gravité chez elle.
        if (f.respireMal) direUneFois(t, 'cSoi', P.cSoi);
        if (f.saigne) direUneFois(t, 'cCompression', P.cCompression);
        if (f.respireMal === undefined && !dejaPose(e, 'respiration')) return poser(t, 'respiration', P.qRespiration, S.ouiNon);
        if (f.saigne === undefined && !dejaPose(e, 'saignement')) return poser(t, 'saignement', P.qSaignement, S.saignement);
        break;
      }
      if (f.inconscient || f.respireMal) direUneFois(t, 'cPls', P.cPls);
      if (f.saigne) direUneFois(t, 'cCompression', P.cCompression);
      if (f.inconscient === undefined && !dejaPose(e, 'conscience')) return poser(t, 'conscience', P.qConscience, S.conscience);
      if (f.saigne === undefined && !dejaPose(e, 'saignement')) return poser(t, 'saignement', P.qSaignement, S.saignement);
      break;
    case 'accident':
      if (f.saigne) direUneFois(t, 'cCompression', P.cCompression);
      if (f.abri === false) direUneFois(t, 'cChaussee', P.cChaussee);
      if (f.blesses === undefined && !dejaPose(e, 'blesses')) return poser(t, 'blesses', P.qBlesses, S.blesses);
      if (f.coince === undefined && !dejaPose(e, 'coince')) return poser(t, 'coince', P.qCoince, S.ouiNon);
      if (f.abri === undefined && !dejaPose(e, 'abri')) return poser(t, 'abri', P.qAbri, S.abri);
      break;
    case 'agression':
      direUneFois(t, 'cAgression', P.cAgression);
      if (f.agresseurPresent === true && !e.discret) { e.discret = true; direUneFois(t, 'discret', P.discret); }
      if (f.agresseurPresent === undefined && !dejaPose(e, 'agresseur')) return poser(t, 'agresseur', P.qAgresseur, S.agresseur);
      if (f.agresseurPresent === true && f.arme === undefined && !dejaPose(e, 'arme')) return poser(t, 'arme', P.qArme, S.ouiNon);
      if (f.blesses === undefined && !dejaPose(e, 'blesses')) return poser(t, 'blesses', P.qBlesse, S.blesse);
      direUneFois(t, 'cEloigner', P.cEloigner);
      break;
    case 'incendie':
      direUneFois(t, 'cEvacuer', P.cEvacuer);
      if (f.sortis === false) direUneFois(t, 'cPersonnesDedans', P.cPersonnesDedans);
      if (f.sortis === undefined && !dejaPose(e, 'sortis')) return poser(t, 'sortis', P.qSortis, S.ouiNon);
      if (f.blesses === undefined && !dejaPose(e, 'fumee')) return poser(t, 'fumee', P.qFumee, S.ouiNon);
      break;
    case 'chauffeur': {
      const precise = f.vitesse || f.detour || f.ivre || f.refuseArret || f.deplace;
      if (!precise && !dejaPose(e, 'comportement')) return poser(t, 'comportement', P.qComportement, S.comportement);
      direUneFois(t, 'cChauffeur', P.cChauffeur);
      if (ctx.enCourse && !e.demandes.includes('centre:arret') && !dejaPose(e, 'arret')) return poser(t, 'arret', P.qArret, S.arret);
      break;
    }
    case 'harcelement':
      if (!dejaPose(e, 'danger')) return poser(t, 'danger', P.qDanger, S.ouiNon);
      if (ctx.enCourse && !e.demandes.includes('centre:arret') && !dejaPose(e, 'arret')) return poser(t, 'arret', P.qArret, S.arret);
      break;
    case 'panne':
      if (f.abri === false) direUneFois(t, 'cChausseePanne', P.cChausseePanne);
      if (f.abri === undefined && !dejaPose(e, 'abri')) return poser(t, 'abri', P.qAbri, S.abri);
      if (!e.demandes.includes('centre:remplacement') && !dejaPose(e, 'remplacement')) return poser(t, 'remplacement', P.qRemplacement, S.ouiNon);
      break;
    case 'objet':
      if (!dejaPose(e, 'fin')) return poser(t, 'fin', P.qFinObjet, S.fin);
      break;
    default:
      if (e.discret) { t.e.attente = 'motif'; t.suggestions = sugg(e.langue, S.discret); return; }
      if (e.incompris >= 2) {
        if (demander(t, 'centre:rappel', 'Situation non comprise par l’agent automatique : rappeler l’usager')) dire(t, P.centreRappel);
        if (!dejaPose(e, 'danger')) return poser(t, 'danger', P.qDanger, S.ouiNon);
      }
      t.e.attente = 'motif';
      dire(t, e.incompris >= 1 ? P.qMotif2 : P.qMotif);
      t.suggestions = sugg(e.langue, S.motifs);
      return;
  }

  // Tout ce qui devait être demandé l'a été : l'agent reste présent, sans harceler.
  e.attente = null;
  direUneFois(t, 'suivi', P.suivi);
  t.suggestions = sugg(e.langue, S.suivi);
}

function finir(t: Tour): TourAgent {
  return {
    etat: t.e, messages: t.messages, demandes: t.demandes, suggestions: t.suggestions,
    resume: resumeAgentSos(t.e), terminer: t.terminer,
  };
}

/** Premier message de l'agent, dès la création de l'alerte. */
export function ouvrirAgentSos(ctx: ContexteSos): TourAgent {
  const e = etatInitial(ctx.langue ?? 'fr');
  const t: Tour = { e, ctx, messages: [], demandes: [], suggestions: [], terminer: false };
  if (ctx.origine === 'choc') {
    // Un choc mesuré par les capteurs : on n'attend pas la réponse pour prévenir.
    e.motif = 'accident'; e.gravite = 'grave'; e.attente = 'blesses'; e.dit.push('q:blesses');
    dire(t, P.ouvertureChoc());
    demander(t, 'samu', 'Choc violent détecté par les capteurs');
    demander(t, 'police', 'Accident détecté automatiquement');
    annoncer(t, ['samu', 'police'], true);
    t.suggestions = sugg(e.langue, S.blesse);
    return finir(t);
  }
  if (ctx.origine === 'controle') {
    dire(t, P.ouvertureControle());
    t.suggestions = sugg(e.langue, S.controle);
    return finir(t);
  }
  dire(t, P.ouvertureBouton(ctx.lieu));
  t.suggestions = sugg(e.langue, S.motifs);
  return finir(t);
}

/** Réponse de l'agent à un message de la personne. */
export function repondreAgentSos(etat: EtatAgentSos, texte: string, ctx: ContexteSos): TourAgent {
  const e: EtatAgentSos = { ...etat, demandes: [...etat.demandes], faits: { ...etat.faits }, dit: [...etat.dit] };
  const t: Tour = { e, ctx, messages: [], demandes: [], suggestions: [], terminer: false };
  const n = normaliser(texte);
  e.tours += 1;
  e.relances = 0;
  const attente = e.attente;
  let compris = false;

  // La personne revient après avoir dit que tout allait bien : l'agent se remet à l'écoute.
  if (e.termine && !FAUSSE_ALERTE.test(n)) e.termine = false;

  // 1. Ne peut pas parler : mode discret, sans attendre.
  if (PAS_PARLER.test(n) && !e.discret) {
    e.discret = true; compris = true;
    direUneFois(t, 'discret', P.discret);
  }

  // 2. Faits établis par le message, quelle que soit la question posée.
  // Pour un même fait, la formulation négative est testée d'abord et l'emporte
  // (« personne n'est blessé » contient « blessé »).
  const avant = JSON.stringify(e.faits);
  const etablis = new Set<Fait>();
  for (const [fait, regle, valeur] of FAITS) {
    if (etablis.has(fait) || !regle.test(n)) continue;
    e.faits[fait] = valeur;
    etablis.add(fait);
  }

  // 3. Réponse par oui / non à la question en attente.
  const oui = OUI.test(n);
  const non = NON.test(n);
  if (attente && (oui || non || NE_SAIT_PAS.test(n))) {
    const v = oui && !non;
    const doute = !oui && !non;
    // « Oui » ou « non » ne répond pas à une question ouverte.
    if (attente !== 'motif' && attente !== 'comportement') compris = true;
    switch (attente) {
      case 'blesses': case 'fumee': e.faits.blesses = doute ? true : v; break;
      case 'conscience': if (!doute) { e.faits.inconscient = !v; if (v && e.faits.respireMal === undefined) e.faits.respireMal = false; } break;
      case 'respiration': if (!doute) e.faits.respireMal = v; break;
      case 'saignement': if (!doute) e.faits.saigne = v; break;
      case 'coince': if (!doute) e.faits.coince = v; break;
      case 'abri': if (!doute) e.faits.abri = v; break;
      case 'agresseur': if (!doute) e.faits.agresseurPresent = v; break;
      case 'arme': if (!doute) e.faits.arme = v; break;
      case 'sortis': if (!doute) e.faits.sortis = v; break;
      case 'danger':
        if (v || doute) {
          aggraver(e, 'grave');
          if (demander(t, 'police', 'L’usager se dit en danger immédiat')) annoncer(t, ['police']);
          if (demander(t, 'centre:rappel', 'L’usager se dit en danger immédiat : le rappeler')) dire(t, P.centreRappel);
        }
        break;
      case 'arret':
        if (v && demander(t, 'centre:arret', 'Le client demande l’arrêt de la course au prochain endroit sûr')) dire(t, P.centreArret);
        break;
      case 'remplacement':
        if (v && demander(t, 'centre:remplacement', 'Envoyer un véhicule de remplacement au client')) dire(t, P.centreRemplacement);
        break;
      case 'fin':
        if (v) {
          e.termine = true;
          const engage = e.demandes.some((d) => !d.startsWith('centre:') || d === 'centre:chauffeur');
          const sensible = e.motif === 'agression' || e.motif === 'harcelement' || e.motif === 'chauffeur' || e.discret;
          // Une personne menacée peut être forcée d'écrire « tout va bien » : dans ce cas
          // seul un agent humain clôt, après l'avoir entendue.
          if (engage || sensible) { dire(t, P.finHumain); demander(t, 'centre:rappel', 'L’usager dit être en sécurité : confirmer de vive voix avant de clore'); }
          else { dire(t, P.finOk); t.terminer = true; }
          e.attente = null;
          return finir(t);
        }
        dire(t, P.finNon);
        e.attente = 'motif';
        e.dit = e.dit.filter((d) => d !== 'q:fin');
        t.suggestions = sugg(e.langue, S.motifs);
        return finir(t);
      default: break;
    }
  }
  if (JSON.stringify(e.faits) !== avant) compris = true;
  // La question posée est restée sans réponse (la personne a écrit autre chose) : on la
  // reposera une fois, après avoir pris en compte ce qu'elle vient de dire.
  const repondu = attente === null || oui || non || NE_SAIT_PAS.test(n) || JSON.stringify(e.faits) !== avant;
  if (attente && !repondu && !e.dit.includes(`r:${attente}`)) {
    e.dit = e.dit.filter((d) => d !== `q:${attente}`);
    e.dit.push(`r:${attente}`);
  }

  // 4. Motif : le plus grave reconnu l'emporte et ne redescend jamais.
  let motifCite = false;
  for (const [motif, regle] of MOTIFS) {
    if (!regle.test(n)) continue;
    compris = true;
    motifCite = true;
    if (RANG_MOTIF[motif] > RANG_MOTIF[e.motif]) { e.motif = motif; aggraver(e, GRAVITE_MOTIF[motif]); }
    break;
  }
  // Un fait médical sans motif (« il saigne ») suffit à qualifier une urgence médicale.
  if (e.motif === 'inconnu' && (e.faits.inconscient || e.faits.respireMal || e.faits.saigne || e.faits.blesses)) {
    e.motif = 'medical'; aggraver(e, 'grave');
  }

  // 5. Fausse manœuvre : on fait confirmer avant de lâcher le dossier.
  if (FAUSSE_ALERTE.test(n) && !VA_MAL.test(n) && attente !== 'fin' && !motifCite) {
    poser(t, 'fin', P.qFin, S.fin);
    return finir(t);
  }

  // 6. Demandes explicites.
  if (RAPPEL.test(n)) { compris = true; if (demander(t, 'centre:rappel', 'L’usager demande à être rappelé')) dire(t, P.centreRappel); }
  if (AGGRAVE.test(n)) {
    compris = true;
    aggraver(e, e.gravite === 'grave' ? 'vitale' : 'grave');
    dire(t, P.aggrave);
    if (demander(t, 'centre:rappel', 'L’usager signale que la situation s’aggrave : le rappeler')) dire(t, P.centreRappel);
  }
  if (DELAI.test(n)) { compris = true; dire(t, P.delai); }
  if (MERCI.test(n) && !compris) { dire(t, P.merci); t.suggestions = sugg(e.langue, S.suivi); return finir(t); }

  // 7. Appel à l'aide sans précision : on ne fait pas répéter trois fois quelqu'un qui a peur.
  if (!compris && DETRESSE.test(n)) {
    compris = true; e.incompris += 1; aggraver(e, 'grave');
    if (demander(t, 'centre:rappel', 'Appel à l’aide sans précision : rappeler l’usager')) dire(t, P.centreRappel);
  }
  else if (!compris) {
    e.incompris += 1;
    // Un message libre pendant une situation déjà qualifiée est une information : on la transmet.
    if (e.motif !== 'inconnu') dire(t, P.note);
  } else if (e.motif !== 'inconnu') e.incompris = 0;

  decider(t);
  poursuivre(t);
  return finir(t);
}

/**
 * Silence de la personne. `secondes` = temps écoulé depuis son dernier signe de vie
 * (son dernier message, ou la création de l'alerte). Renvoie `null` tant qu'il n'y a
 * rien à faire : une relance à 30 s, puis une levée de doute à 75 s.
 */
export function relancerAgentSos(etat: EtatAgentSos, ctx: ContexteSos, secondes: number): TourAgent | null {
  if (etat.termine || etat.attente === null) return null;
  if (etat.relances === 0 && secondes >= 30) {
    const e: EtatAgentSos = { ...etat, relances: 1 };
    const t: Tour = { e, ctx, messages: [], demandes: [], suggestions: [], terminer: false };
    dire(t, P.relance1);
    t.suggestions = sugg(e.langue, etat.motif === 'inconnu' ? S.motifs : S.suivi);
    return finir(t);
  }
  if (etat.relances === 1 && secondes >= 75) {
    const e: EtatAgentSos = { ...etat, relances: 2, demandes: [...etat.demandes] };
    const t: Tour = { e, ctx, messages: [], demandes: [], suggestions: [], terminer: false };
    aggraver(e, 'grave');
    demander(t, 'centre:rappel', 'Aucune réponse de l’usager depuis l’alerte : le rappeler');
    const police = demander(t, 'police', 'Aucune réponse de l’usager depuis l’alerte : levée de doute');
    dire(t, police ? P.relance2 : P.relance2Deja);
    t.suggestions = sugg(e.langue, S.fin);
    e.attente = 'fin';
    return finir(t);
  }
  return null;
}

/** L'agent humain prend le dossier : l'agent automatique l'annonce et se tait. */
export function passerLaMainSos(etat: EtatAgentSos, agent: string): string {
  // Un compte technique n'a pas de prénom à présenter : on n'écrit pas « Supervision ORION, du centre… ».
  const prenom = agent.trim();
  return choisir(etat.langue, !prenom || /orion|supervision|centre/i.test(prenom) ? P.passageHumainAnonyme : P.passageHumain(prenom));
}

/** Intitulé d'une demande, pour l'écran de la personne et pour la console. */
export function libelleDemande(cle: CleDemande, langue: LangueAgent = 'fr'): string {
  const noms: Record<CleDemande, Bi> = {
    samu: ['SAMU', 'Ambulance (SAMU)'],
    police: ['Police secours', 'Police'],
    pompiers: ['Sapeurs-pompiers', 'Fire brigade'],
    depannage: ['Dépannage ORION', 'ORION roadside assistance'],
    'centre:rappel': ['Un agent du centre vous appelle', 'A centre agent is calling you'],
    'centre:chauffeur': ['Le centre appelle votre chauffeur', 'The centre is calling your driver'],
    'centre:arret': ['Arrêt de la course au prochain endroit sûr', 'Ride stopped at the next safe place'],
    'centre:remplacement': ['Véhicule de remplacement', 'Replacement vehicle'],
    'centre:support': ['Support ORION — objet oublié', 'ORION support — lost item'],
  };
  return choisir(langue, noms[cle]);
}
