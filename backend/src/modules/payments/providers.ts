/**
 * Moyens de paiement — marché ivoirien.
 *
 * Le mobile money est dominant en Côte d'Ivoire : on l'expose en priorité, aux côtés des
 * espèces et de la carte. Chaque fournisseur implémente une interface commune
 * (pattern Strategy) → on ajoute/retire un opérateur sans toucher au reste du code.
 *
 * Les implémentations ci-dessous sont des ADAPTATEURS de référence (sandbox) : en
 * production, on branche les API réelles (Orange Money, MTN MoMo, Moov Money, Wave,
 * agrégateurs type CinetPay/PayDunya) derrière la même interface.
 */
export type PaymentMethod =
  | 'cash'
  | 'orange_money'
  | 'mtn_momo'
  | 'moov_money'
  | 'wave'
  | 'card';

export interface PaymentCatalogEntry {
  method: PaymentMethod;
  label: string;
  kind: 'cash' | 'mobile_money' | 'card';
  /** Indicatif requis pour le mobile money (CI = +225). */
  requiresPhone: boolean;
  ussdHint?: string;
}

export const PAYMENT_CATALOG: PaymentCatalogEntry[] = [
  { method: 'orange_money', label: 'Orange Money', kind: 'mobile_money', requiresPhone: true, ussdHint: '#144#' },
  { method: 'mtn_momo', label: 'MTN MoMo', kind: 'mobile_money', requiresPhone: true, ussdHint: '*133#' },
  { method: 'moov_money', label: 'Moov Money', kind: 'mobile_money', requiresPhone: true, ussdHint: '*155#' },
  { method: 'wave', label: 'Wave', kind: 'mobile_money', requiresPhone: true },
  { method: 'cash', label: 'Espèces', kind: 'cash', requiresPhone: false },
  { method: 'card', label: 'Carte bancaire', kind: 'card', requiresPhone: false },
];

export interface ChargeRequest {
  method: PaymentMethod;
  amount: number;
  currency: 'XOF';
  phone?: string; // +225XXXXXXXXXX pour le mobile money
  reference: string;
}

export type PaymentStatus = 'pending' | 'authorized' | 'captured' | 'failed';

export interface ChargeResult {
  reference: string;
  method: PaymentMethod;
  amount: number;
  currency: 'XOF';
  status: PaymentStatus;
  /** Pour le mobile money : invite à confirmer côté téléphone. */
  customerActionRequired?: boolean;
  message: string;
}

export interface PaymentProvider {
  readonly method: PaymentMethod;
  charge(req: ChargeRequest): Promise<ChargeResult>;
}

const CI_PHONE = /^\+225\d{8,10}$/;

/**
 * Adaptateur mobile money de référence (bac à sable).
 *
 * Aucun opérateur réel n'est encore branché. Hors production, le bac à sable joue le
 * rôle de l'opérateur et CONFIRME le paiement comme le client le ferait sur son
 * téléphone : sans cela, un paiement Orange Money, Wave ou MTN restait « en attente »
 * pour toujours, l'app cliente affichait « paiement reçu » alors que le serveur ne
 * l'enregistrait pas, et le chauffeur restait bloqué « en course ». En production,
 * le statut reste « en attente » jusqu'à la confirmation de l'opérateur réel.
 */
class MobileMoneyProvider implements PaymentProvider {
  constructor(public readonly method: PaymentMethod, private readonly bacASable: boolean) {}
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!req.phone || !CI_PHONE.test(req.phone)) {
      return {
        reference: req.reference,
        method: this.method,
        amount: req.amount,
        currency: 'XOF',
        status: 'failed',
        message: 'Numéro mobile money invalide (format +225XXXXXXXX)',
      };
    }
    if (this.bacASable) {
      return {
        reference: req.reference,
        method: this.method,
        amount: req.amount,
        currency: 'XOF',
        status: 'captured',
        message: 'Paiement confirmé (bac à sable : aucun opérateur réel branché)',
      };
    }
    // En prod : appel API opérateur → push USSD/notification de confirmation.
    return {
      reference: req.reference,
      method: this.method,
      amount: req.amount,
      currency: 'XOF',
      status: 'pending',
      customerActionRequired: true,
      message: 'Confirmez le paiement sur votre téléphone',
    };
  }
}

class CashProvider implements PaymentProvider {
  readonly method = 'cash' as const;
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    return {
      reference: req.reference,
      method: 'cash',
      amount: req.amount,
      currency: 'XOF',
      status: 'authorized', // capturé à la fin de la course, en main propre
      message: 'Paiement en espèces à la fin de la course',
    };
  }
}

class CardProvider implements PaymentProvider {
  readonly method = 'card' as const;
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    return {
      reference: req.reference,
      method: 'card',
      amount: req.amount,
      currency: 'XOF',
      status: 'authorized',
      message: 'Carte autorisée',
    };
  }
}

/** Registre des fournisseurs de paiement actifs. */
export class PaymentRegistry {
  private readonly providers = new Map<PaymentMethod, PaymentProvider>();

  /** `bacASable` : hors production, les paiements mobile money sont confirmés sur-le-champ. */
  constructor(bacASable = false) {
    for (const m of ['orange_money', 'mtn_momo', 'moov_money', 'wave'] as const) {
      this.providers.set(m, new MobileMoneyProvider(m, bacASable));
    }
    this.providers.set('cash', new CashProvider());
    this.providers.set('card', new CardProvider());
  }

  get(method: PaymentMethod): PaymentProvider | undefined {
    return this.providers.get(method);
  }
}
