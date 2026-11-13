import type { Container } from '../../container.js';

/**
 * LIBÉRATION DES CHAUFFEURS BLOQUÉS « EN COURSE ».
 *
 * Un chauffeur passe `on_trip` à l'attribution et ne redevient `online` qu'au
 * paiement, à la notation ou à l'annulation. C'est voulu : après `completed`, il
 * encaisse encore les espèces, et on ne veut pas qu'une nouvelle offre lui tombe
 * dessus pendant qu'il rend la monnaie.
 *
 * Mais si personne ne paie — client parti sans régler, app fermée, réseau coupé
 * au moment du paiement — rien ne le libère JAMAIS. Il reste « en course » toute
 * la journée, invisible du dispatch, sans revenu, et le vivier se vide un
 * chauffeur à la fois. Trouvé en enregistrant la démonstration : treize
 * chauffeurs bloqués, zéro course active, et le client renvoyé « aucun chauffeur ».
 *
 * Ce balayage tourne en arrière-plan : toute course terminée depuis plus de
 * `graceMinutes` dont le chauffeur est encore `on_trip` est libérée. La course
 * reste `completed` — l'impayé est un fait financier, il ne retient pas le
 * véhicule. L'événement est tracé au journal et le chauffeur prévenu.
 */

const MINUTE = 60_000;

export interface LiberationFaite {
  rideId: string;
  driverId: string;
  driverName: string;
  montant: number;
  termineeDepuisMin: number;
}

export class RideReleaseService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly c: Container,
    /** Délai pendant lequel le chauffeur encaisse tranquillement avant d'être libéré. */
    private readonly graceMinutes: number,
  ) {}

  /** Démarre le balayage périodique (pas en test : on appelle `tick` à la main). */
  start(everyMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick(); }, everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Courses terminées, non réglées, dont le chauffeur attend toujours : à surveiller. */
  enAttenteDePaiement(now = Date.now()): Array<{ rideId: string; driverId: string; depuisMin: number; montant: number }> {
    const out: Array<{ rideId: string; driverId: string; depuisMin: number; montant: number }> = [];
    // Ensemble des courses terminées non payées, tenu par le magasin : aucune relecture
    // des fins de course du mois.
    const depuis = new Date(now - 30 * 24 * 60 * MINUTE).toISOString();
    for (const r of this.c.rides.listAwaitingPayment()) {
      if (!r.driverId) continue;
      if ((r.events.find((e) => e.type === 'completed')?.at ?? r.createdAt) < depuis) continue;
      const fin = r.events.find((e) => e.type === 'completed')?.at ?? r.createdAt;
      out.push({
        rideId: r.id, driverId: r.driverId,
        depuisMin: Math.round((now - Date.parse(fin)) / MINUTE),
        montant: r.quote.amount,
      });
    }
    return out;
  }

  /** Un passage : libère ce qui doit l'être, renvoie ce qui a été fait. */
  tick(now = Date.now()): LiberationFaite[] {
    const faites: LiberationFaite[] = [];
    const depuis = new Date(now - 30 * 24 * 60 * MINUTE).toISOString();
    for (const r of this.c.rides.listAwaitingPayment()) {
      if (!r.driverId) continue;
      if ((r.events.find((e) => e.type === 'completed')?.at ?? r.createdAt) < depuis) continue;
      const driver = this.c.drivers.get(r.driverId);
      if (!driver || driver.availability !== 'on_trip') continue;

      const fin = r.events.find((e) => e.type === 'completed')?.at ?? r.createdAt;
      const depuisMin = (now - Date.parse(fin)) / MINUTE;
      if (depuisMin < this.graceMinutes) continue;

      // Déjà libéré pour cette course : ne pas tracer deux fois.
      if (r.events.some((e) => e.type === 'driver_released_unpaid')) continue;

      this.c.matching.releaseLock(driver.id);
      this.c.drivers.setAvailability(driver.id, 'online');
      r.events.push({ type: 'driver_released_unpaid', at: new Date(now).toISOString(), payload: { afterMinutes: Math.round(depuisMin) } });
      this.c.rides.persist(r);

      this.c.audit.log({
        actor: 'Système ORION', role: 'super_admin', action: 'ride.driver_released_unpaid',
        target: r.id, details: { driverId: driver.id, amount: r.quote.amount, afterMinutes: Math.round(depuisMin) },
      });
      // Le chauffeur doit savoir qu'il est de nouveau visible du dispatch — et que
      // l'encaissement de cette course reste à régulariser.
      this.c.notifications.notify(
        { driverId: driver.id },
        'Vous êtes de nouveau disponible',
        `La course ${r.id.slice(0, 8)} est terminée sans paiement enregistré depuis ${Math.round(depuisMin)} min. Vous pouvez reprendre des courses ; l’encaissement reste à régulariser.`,
      );
      faites.push({ rideId: r.id, driverId: driver.id, driverName: driver.name, montant: r.quote.amount, termineeDepuisMin: Math.round(depuisMin) });
    }
    return faites;
  }
}
