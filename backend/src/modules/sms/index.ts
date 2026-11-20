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
  constructor(message: string, readonly statut?: number) {
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
