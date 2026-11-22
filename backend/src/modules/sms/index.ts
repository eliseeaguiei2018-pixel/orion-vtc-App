/**
 * ENVOI DES SMS (codes de connexion clients et chauffeurs).
 *
 * Trois fournisseurs, choisis par `SMS_PROVIDER` :
 * - `orange`  : API SMS d'Orange Côte d'Ivoire (Orange Developer), opérateur local,
 *               jeton OAuth2 mis en cache et renouvelé à l'expiration ;
 * - `twilio`  : secours international (numéro ou service de messagerie Twilio) ;
 * - `console` : développement. Rien ne part : le serveur renvoie le code de test à
 *               l'app, et refuse d'émettre un code en production (le client serait
 *               bloqué devant un SMS qui n'arrivera jamais).
 *
 * Ni le code ni le numéro complet ne sont jamais écrits dans les journaux.
 */

export interface SmsSender {
  /** Nom du fournisseur, pour les journaux et l'état du serveur. */
  readonly fournisseur: 'orange' | 'twilio' | 'console';
  /** Vrai si le fournisseur envoie réellement des SMS. */
  readonly reel: boolean;
  /** Envoie un SMS au numéro E.164 (+225…). Lève une SmsError en cas d'échec. */
  envoyer(numero: string, message: string): Promise<{ id?: string }>;
}

export class SmsError extends Error {
  /** `codeOperateur` : code d'erreur de l'opérateur (Twilio : 63015, 63003…), s'il est connu. */
  constructor(message: string, readonly statut?: number, readonly codeOperateur?: number) {
    super(message);
    this.name = 'SmsError';
  }
}

type Fetch = typeof fetch;
const DELAI_MS = 10_000;

async function appel(fetchFn: Fetch, url: string, init: RequestInit): Promise<{ statut: number; corps: Record<string, unknown> }> {
  let r: Response;
  try {
    r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(DELAI_MS) });
  } catch (e) {
    throw new SmsError(`Opérateur SMS injoignable (${(e as Error).name})`);
  }
  const texte = await r.text();
  let corps: Record<string, unknown> = {};
  try { corps = texte ? JSON.parse(texte) as Record<string, unknown> : {}; } catch { corps = { brut: texte.slice(0, 200) }; }
  return { statut: r.status, corps };
}

/* ------------------------------------------------------------------ Orange */

export interface OrangeOptions {
  clientId: string;
  clientSecret: string;
  /** Adresse d'expédition fournie par Orange, ex. `tel:+2250000`. */
  expediteur: string;
  /** Nom affiché (« ORION »), à faire valider par Orange. */
  nomExpediteur?: string;
  baseUrl?: string;
}

export class OrangeSms implements SmsSender {
  readonly fournisseur = 'orange' as const;
  readonly reel = true;
  private jeton: { valeur: string; expireA: number } | null = null;
  private readonly base: string;

  constructor(private readonly o: OrangeOptions, private readonly fetchFn: Fetch = fetch) {
    this.base = (o.baseUrl ?? 'https://api.orange.com').replace(/\/$/, '');
  }

  private async jetonValide(forcer = false): Promise<string> {
    if (!forcer && this.jeton && this.jeton.expireA > Date.now() + 60_000) return this.jeton.valeur;
    const basic = Buffer.from(`${this.o.clientId}:${this.o.clientSecret}`).toString('base64');
    const { statut, corps } = await appel(this.fetchFn, `${this.base}/oauth/v3/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: 'grant_type=client_credentials',
    });
    const valeur = typeof corps.access_token === 'string' ? corps.access_token : '';
    if (statut !== 200 || !valeur) throw new SmsError(`Orange : authentification refusée (${statut})`, statut);
    const duree = Number(corps.expires_in) || 3600;
    this.jeton = { valeur, expireA: Date.now() + duree * 1000 };
    return valeur;
  }

  async envoyer(numero: string, message: string): Promise<{ id?: string }> {
    const url = `${this.base}/smsmessaging/v1/outbound/${encodeURIComponent(this.o.expediteur)}/requests`;
    const corpsRequete = JSON.stringify({
      outboundSMSMessageRequest: {
        address: `tel:${numero}`,
        senderAddress: this.o.expediteur,
        ...(this.o.nomExpediteur ? { senderName: this.o.nomExpediteur } : {}),
        outboundSMSTextMessage: { message },
      },
    });
    const tenter = async (jeton: string) => appel(this.fetchFn, url, {
      method: 'POST',
      headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json', accept: 'application/json' },
      body: corpsRequete,
    });
    let r = await tenter(await this.jetonValide());
    // Jeton révoqué ou expiré côté Orange : un seul renouvellement, puis on abandonne.
    if (r.statut === 401) r = await tenter(await this.jetonValide(true));
    if (r.statut !== 201 && r.statut !== 200) {
      const detail = (r.corps.requestError as { serviceException?: { text?: string }; policyException?: { text?: string } } | undefined);
      const texte = detail?.serviceException?.text ?? detail?.policyException?.text ?? '';
      throw new SmsError(`Orange : envoi refusé (${r.statut}${texte ? ` · ${texte}` : ''})`, r.statut);
    }
    const res = (r.corps.outboundSMSMessageRequest as { resourceURL?: string } | undefined)?.resourceURL;
    return { id: res ? res.split('/').pop() : undefined };
  }
}

/* ------------------------------------------------------------------ Twilio */

export interface TwilioOptions {
  accountSid: string;
  authToken: string;
  /** Numéro d'expédition (+1…) OU identifiant de service de messagerie (MG…). */
  de?: string;
  serviceMessagerie?: string;
  baseUrl?: string;
}

export class TwilioSms implements SmsSender {
  readonly fournisseur = 'twilio' as const;
  readonly reel = true;
  private readonly base: string;

  constructor(private readonly o: TwilioOptions, private readonly fetchFn: Fetch = fetch) {
    this.base = (o.baseUrl ?? 'https://api.twilio.com').replace(/\/$/, '');
  }

  async envoyer(numero: string, message: string): Promise<{ id?: string }> {
    const corps = new URLSearchParams({ To: numero, Body: message });
    if (this.o.serviceMessagerie) corps.set('MessagingServiceSid', this.o.serviceMessagerie);
    else if (this.o.de) corps.set('From', this.o.de);
    const basic = Buffer.from(`${this.o.accountSid}:${this.o.authToken}`).toString('base64');
    const r = await appel(this.fetchFn, `${this.base}/2010-04-01/Accounts/${encodeURIComponent(this.o.accountSid)}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: corps.toString(),
    });
    if (r.statut !== 201 && r.statut !== 200) {
      throw new SmsError(`Twilio : envoi refusé (${r.statut}${typeof r.corps.message === 'string' ? ` · ${r.corps.message}` : ''})`, r.statut);
    }
    return { id: typeof r.corps.sid === 'string' ? r.corps.sid : undefined };
  }
}

/* -------------------------------------------------------------- WhatsApp */

/**
 * CODES DE CONNEXION PAR WHATSAPP (Twilio, API Messages, canal « whatsapp: »).
 *
 * - Bac à sable Twilio (essais) : expéditeur +14155238886 ; chaque testeur envoie d'abord le
 *   message d'inscription (« join … ») à ce numéro, puis reçoit le code en message libre.
 * - Production : numéro WhatsApp Business d'ORION et modèle « authentification » approuvé
 *   par Meta (`modele`, identifiant HX…) : le code passe en variable {{1}}.
 *
 * WhatsApp signale certains refus APRÈS l'acceptation de l'envoi (numéro sans WhatsApp, testeur
 * pas inscrit au bac à sable) : l'état du message est relu quelques instants pour pouvoir le
 * dire au client tout de suite, au lieu de le laisser attendre un code qui n'arrivera pas.
 */
export interface WhatsAppSender {
  readonly fournisseur: 'twilio' | 'meta';
  /** Envoie le code au numéro E.164 (+225…). Lève une SmsError en cas d'échec. */
  envoyer(numero: string, code: string, message: string): Promise<{ id?: string }>;
}

export interface TwilioWhatsAppOptions {
  accountSid: string;
  authToken: string;
  /** Numéro WhatsApp d'expédition, avec ou sans le préfixe « whatsapp: ». */
  de: string;
  /** Modèle d'authentification approuvé (HX…) ; absent : message libre (bac à sable). */
  modele?: string;
  baseUrl?: string;
  /** Pause entre deux lectures de l'état du message (ms) et nombre de lectures. */
  attenteMs?: number;
  lectures?: number;
}

const ETATS_ECHEC = new Set(['failed', 'undelivered']);
const ETATS_PARTIS = new Set(['sent', 'delivered', 'read']);

export class TwilioWhatsApp implements WhatsAppSender {
  readonly fournisseur = 'twilio' as const;
  private readonly base: string;

  constructor(
    private readonly o: TwilioWhatsAppOptions,
    private readonly fetchFn: Fetch = fetch,
    private readonly pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.base = (o.baseUrl ?? 'https://api.twilio.com').replace(/\/$/, '');
  }

  private get auth(): string {
    return `Basic ${Buffer.from(`${this.o.accountSid}:${this.o.authToken}`).toString('base64')}`;
  }

  async envoyer(numero: string, code: string, message: string): Promise<{ id?: string }> {
    const de = this.o.de.startsWith('whatsapp:') ? this.o.de : `whatsapp:${this.o.de}`;
    const corps = new URLSearchParams({ To: `whatsapp:${numero}`, From: de });
    if (this.o.modele) {
      corps.set('ContentSid', this.o.modele);
      corps.set('ContentVariables', JSON.stringify({ 1: code }));
    } else {
      corps.set('Body', message);
    }
    const compte = `${this.base}/2010-04-01/Accounts/${encodeURIComponent(this.o.accountSid)}`;
    const r = await appel(this.fetchFn, `${compte}/Messages.json`, {
      method: 'POST',
      headers: { authorization: this.auth, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: corps.toString(),
    });
    if (r.statut !== 201 && r.statut !== 200) {
      const codeOp = typeof r.corps.code === 'number' ? r.corps.code : undefined;
      throw new SmsError(`Twilio WhatsApp : envoi refusé (${r.statut}${typeof r.corps.message === 'string' ? ` · ${r.corps.message}` : ''})`, r.statut, codeOp);
    }
    const sid = typeof r.corps.sid === 'string' ? r.corps.sid : undefined;
    if (!sid) return {};
    // Relecture de l'état : un refus de WhatsApp arrive en général en moins d'une seconde.
    for (let i = 0; i < (this.o.lectures ?? 3); i++) {
      await this.pause(this.o.attenteMs ?? 1200);
      let etat: { statut: number; corps: Record<string, unknown> };
      try {
        etat = await appel(this.fetchFn, `${compte}/Messages/${encodeURIComponent(sid)}.json`, {
          method: 'GET', headers: { authorization: this.auth, accept: 'application/json' },
        });
      } catch { return { id: sid }; }
      const statut = typeof etat.corps.status === 'string' ? etat.corps.status : '';
      if (ETATS_PARTIS.has(statut)) return { id: sid };
      if (ETATS_ECHEC.has(statut)) {
        const codeOp = typeof etat.corps.error_code === 'number' ? etat.corps.error_code : Number(etat.corps.error_code) || undefined;
        throw new SmsError(`Twilio WhatsApp : message ${statut}${codeOp ? ` (${codeOp})` : ''}`, 200, codeOp);
      }
    }
    return { id: sid };
  }
}

/**
 * CODES PAR WHATSAPP, API OFFICIELLE DE META (WhatsApp Cloud API).
 *
 * Règle de Meta : un code de connexion part toujours dans un modèle de catégorie
 * « Authentification » approuvé (bouton « Copier le code »). Le code y figure deux fois :
 * dans le texte du message et dans le bouton. Le numéro de test de Meta n'écrit qu'aux
 * numéros ajoutés dans sa liste de destinataires (refus 131030 sinon).
 */
export interface MetaWhatsAppOptions {
  phoneId: string;
  jeton: string;
  modele: string;
  langue: string;
  version?: string;
  baseUrl?: string;
}

export class MetaWhatsApp implements WhatsAppSender {
  readonly fournisseur = 'meta' as const;
  private readonly base: string;

  constructor(private readonly o: MetaWhatsAppOptions, private readonly fetchFn: Fetch = fetch) {
    this.base = (o.baseUrl ?? 'https://graph.facebook.com').replace(/\/$/, '');
  }

  // Le texte libre est ignoré : le message est celui du modèle approuvé par Meta.
  async envoyer(numero: string, code: string, _message?: string): Promise<{ id?: string }> {
    const corps = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: numero.replace(/\D/g, ''),
      type: 'template',
      template: {
        name: this.o.modele,
        language: { code: this.o.langue },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    };
    const r = await appel(this.fetchFn, `${this.base}/${this.o.version ?? 'v23.0'}/${encodeURIComponent(this.o.phoneId)}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.o.jeton}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(corps),
    });
    if (r.statut !== 200 && r.statut !== 201) {
      const err = (r.corps.error ?? {}) as { code?: number; message?: string; error_data?: { details?: string } };
      const detail = err.error_data?.details ?? err.message ?? '';
      throw new SmsError(`Meta WhatsApp : envoi refusé (${r.statut}${err.code ? ` · ${err.code}` : ''}${detail ? ` · ${detail}` : ''})`, r.statut, err.code);
    }
    const messages = r.corps.messages as Array<{ id?: string }> | undefined;
    return { id: messages?.[0]?.id };
  }
}

export interface WhatsAppConfig {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WHATSAPP_FROM?: string;
  TWILIO_WHATSAPP_CONTENT_SID?: string;
  META_WHATSAPP_PHONE_ID?: string;
  META_WHATSAPP_TOKEN?: string;
  META_WHATSAPP_TEMPLATE?: string;
  META_WHATSAPP_LANGUE?: string;
  META_GRAPH_VERSION?: string;
}

/**
 * Envoi des codes par WhatsApp, ou `null` si rien n'est réglé : Meta (API officielle) en
 * priorité, sinon Twilio.
 */
export function creerWhatsApp(c: WhatsAppConfig, fetchFn: Fetch = fetch): WhatsAppSender | null {
  if (c.META_WHATSAPP_PHONE_ID && c.META_WHATSAPP_TOKEN) {
    return new MetaWhatsApp({
      phoneId: c.META_WHATSAPP_PHONE_ID, jeton: c.META_WHATSAPP_TOKEN,
      modele: c.META_WHATSAPP_TEMPLATE ?? 'orion_code', langue: c.META_WHATSAPP_LANGUE ?? 'fr',
      version: c.META_GRAPH_VERSION,
    }, fetchFn);
  }
  if (!c.TWILIO_WHATSAPP_FROM || !c.TWILIO_ACCOUNT_SID || !c.TWILIO_AUTH_TOKEN) return null;
  return new TwilioWhatsApp({
    accountSid: c.TWILIO_ACCOUNT_SID, authToken: c.TWILIO_AUTH_TOKEN,
    de: c.TWILIO_WHATSAPP_FROM, modele: c.TWILIO_WHATSAPP_CONTENT_SID,
  }, fetchFn);
}

/** Texte WhatsApp du code (message libre, bac à sable) : le code en gras, en tête. */
export function messageCodeWhatsApp(code: string, minutes: number, pour: 'client' | 'chauffeur'): string {
  const qui = pour === 'chauffeur' ? 'ORION Chauffeur' : 'ORION';
  return `*${code}* est votre code ${qui}. Valable ${minutes} min. Ne le communiquez à personne : ORION ne vous le demandera jamais.`;
}

/* ------------------------------------------------------------------ Console */

/** Développement : aucun SMS ne part (le code de test est renvoyé à l'app hors production). */
export class ConsoleSms implements SmsSender {
  readonly fournisseur = 'console' as const;
  readonly reel = false;
  async envoyer(): Promise<{ id?: string }> {
    return {};
  }
}

/* ------------------------------------------------------------------ Fabrique */

export interface SmsConfig {
  SMS_PROVIDER: 'console' | 'orange' | 'twilio';
  SMS_SENDER_NAME?: string;
  ORANGE_SMS_CLIENT_ID?: string;
  ORANGE_SMS_CLIENT_SECRET?: string;
  ORANGE_SMS_SENDER: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
  TWILIO_MESSAGING_SERVICE_SID?: string;
}

export function creerSms(c: SmsConfig, fetchFn: Fetch = fetch): SmsSender {
  if (c.SMS_PROVIDER === 'orange') {
    return new OrangeSms({
      clientId: c.ORANGE_SMS_CLIENT_ID ?? '', clientSecret: c.ORANGE_SMS_CLIENT_SECRET ?? '',
      expediteur: c.ORANGE_SMS_SENDER, nomExpediteur: c.SMS_SENDER_NAME,
    }, fetchFn);
  }
  if (c.SMS_PROVIDER === 'twilio') {
    return new TwilioSms({
      accountSid: c.TWILIO_ACCOUNT_SID ?? '', authToken: c.TWILIO_AUTH_TOKEN ?? '',
      de: c.TWILIO_FROM, serviceMessagerie: c.TWILIO_MESSAGING_SERVICE_SID,
    }, fetchFn);
  }
  return new ConsoleSms();
}

/**
 * Texte du SMS de connexion : court (un seul SMS, alphabet GSM), le code en tête pour
 * le remplissage automatique d'iOS et d'Android, et l'avertissement anti-arnaque.
 */
export function messageCode(code: string, minutes: number, pour: 'client' | 'chauffeur'): string {
  const qui = pour === 'chauffeur' ? 'ORION Chauffeur' : 'ORION';
  return `${code} est votre code ${qui}. Valable ${minutes} min. Ne le communiquez à personne : ORION ne vous le demandera jamais.`;
}
