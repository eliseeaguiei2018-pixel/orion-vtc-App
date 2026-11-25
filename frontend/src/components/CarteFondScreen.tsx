import { useEffect, useRef, useState } from 'react';
import { TopBar } from './ui';
import { IconCheck, IconMap, IconPin } from '../icons';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { fermerAvisSansCle, optionsCarte } from './CarteGoogle';
import { IconCompass, IconRefresh, IconSearch } from '../icons';
import { verifierPlaces } from '../lieuxGoogle';
import { verifierItineraires } from '../itineraireGoogle';
import { verifierAdresses } from '../adressesGoogle';
import { etatService, suivreServices, type EtatService, type ServiceGoogle } from '../servicesGoogle';
import {
  causeRefus, chargerGoogle, choisirFond, cleGoogleIntegree, cleGoogleSaisie, cleRefusee, definirCleGoogle, essaiSansCle, fondCarte, googleDejaCharge,
  googleSeul, motifRefus, reessayerGoogle, suivreFondCarte,
} from '../carteGoogle';

/**
 * FOND DE CARTE — carte ORION (OpenStreetMap, livrée avec l'application) ou Google Maps.
 *
 * Google Maps demande une clé d'API : le client la colle ici, elle reste sur son téléphone.
 * Dès qu'elle est enregistrée, un APERÇU affiche la vraie carte Google : si elle apparaît
 * nette, tout est bon ; si Google la refuse, son motif est affiché avec la correction à
 * faire, et la carte ORION reste en service.
 *
 * Construction « Google seul » : l'écran ne propose ni choix ni clé. Il montre la carte
 * Google en service et, si elle manque, pourquoi.
 */
export function CarteFondScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const { resolved } = useTheme();
  const [fond, setFond] = useState(fondCarte);
  const [cle, setCle] = useState(cleGoogleSaisie);
  const [refus, setRefus] = useState(cleRefusee);
  const [motif, setMotif] = useState(motifRefus);
  const [apercuPret, setApercuPret] = useState(false);
  /** Le service de Google n'a pas répondu (pas de connexion) : ce n'est pas la clé qui est en cause. */
  const [injoignable, setInjoignable] = useState(false);
  const apercu = useRef<HTMLDivElement>(null);
  const [essai, setEssai] = useState(0);
  // Lieux, itinéraires, adresses : trois services distincts de la carte chez Google ; l'écran
  // dit lesquels répondent pour la clé de l'application.
  const lireServices = (): Record<ServiceGoogle, EtatService> => ({ lieux: etatService('lieux'), itineraires: etatService('itineraires'), adresses: etatService('adresses') });
  const [services, setServices] = useState(lireServices);
  const [verif, setVerif] = useState(false);
  useEffect(() => suivreServices(() => setServices(lireServices())), []);
  const verifier = (lesquels: (e: EtatService) => boolean) => {
    const essais: Array<[ServiceGoogle, () => Promise<unknown>]> = [['lieux', verifierPlaces], ['itineraires', verifierItineraires], ['adresses', verifierAdresses]];
    const aFaire = essais.filter(([nom]) => lesquels(etatService(nom)));
    if (!aFaire.length) return;
    setVerif(true);
    void Promise.all(aFaire.map(([, essai]) => essai())).finally(() => setVerif(false));
  };
  useEffect(() => { if (googleSeul()) verifier((e) => e === 'inconnu'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const LIGNES: Array<{ nom: ServiceGoogle; icone: typeof IconSearch; titre: string; cle: string }> = [
    { nom: 'lieux', icone: IconSearch, titre: 'lieux_google_titre', cle: 'lieux_google' },
    { nom: 'itineraires', icone: IconCompass, titre: 'itineraires_google_titre', cle: 'itineraires_google' },
    { nom: 'adresses', icone: IconPin, titre: 'adresses_google_titre', cle: 'adresses_google' },
  ];
  useEffect(() => suivreFondCarte(() => { setFond(fondCarte()); setRefus(cleRefusee()); setMotif(motifRefus()); setEssai((n) => n + 1); }), []);

  // Aperçu : la vraie carte Google, centrée sur le Plateau.
  const google = fond === 'google';
  useEffect(() => {
    if (!google || !apercu.current) { setApercuPret(false); return; }
    let annule = false;
    const boite = apercu.current;
    setInjoignable(false);
    void chargerGoogle().then((g) => {
      if (annule) return;
      const m = new g.Map(boite, optionsCarte(g, resolved !== 'light', { lat: 5.3236, lng: -4.0217 }, 15));
      g.event.addListenerOnce(m, 'tilesloaded', () => { if (!annule) { setApercuPret(true); fermerAvisSansCle(boite); } });
    }).catch((e: Error) => {
      if (annule) return;
      if (e.message === 'cle-refusee') { setRefus(true); setMotif(motifRefus()); } else setInjoignable(true);
    });
    return () => { annule = true; boite.innerHTML = ''; };
  }, [google, resolved, essai]);

  const enregistrer = () => {
    const c = cle.trim();
    if (!c) return;
    const dejaCharge = googleDejaCharge();
    definirCleGoogle(c);
    // L'API de Google ne se recharge pas avec une autre clé dans la même page : on relance l'application.
    if (dejaCharge) window.location.reload();
  };
  const integree = cleGoogleIntegree();
  const avecCle = integree || Boolean(cleGoogleSaisie());
  const etat = refus || motif
    ? `${t('carte_etat_refus')}${motif ? ` ${t(causeRefus(motif), { m: motif })}` : ''}`
    : google && injoignable ? t(googleSeul() ? 'carte_indispo_reseau' : 'carte_etat_reseau')
    : google ? (essaiSansCle() && !avecCle ? t('carte_essai') : apercuPret ? t('carte_etat_ok') : t('carte_apercu_attente')) : t('carte_etat_sans');

  if (googleSeul()) {
    return (
      <div className="screen page sans-couleur">
        <TopBar onBack={onBack} title={t('carte_titre')} />
        <div className="page-body">
          <span className="eyebrow set-titre">{t('carte_fond')}</span>
          <div className="menu-groupe">
            <div className="menu-ligne" role="group">
              <span className="menu-ico"><IconPin size={27} strokeWidth={1.9} /></span>
              <span className="menu-texte"><strong>{t('carte_d_google')}</strong><small>{t('carte_google_seule')}</small></span>
              <IconCheck size={20} strokeWidth={2.4} />
            </div>
          </div>
          {!refus && !motif && (
            <div className="carte-apercu" aria-label={t('carte_apercu')}>
              <div ref={apercu} className="carte-apercu-carte" />
              {!apercuPret && !injoignable && <span className="carte-apercu-attente">{t('carte_apercu_attente')}</span>}
            </div>
          )}
          <p className={refus || motif || injoignable ? 'carte-etat refus' : 'carte-etat'} role="status" aria-live="polite">{etat}</p>
          {(refus || motif || injoignable) && (
            <button className="btn btn-ghost" onClick={reessayerGoogle}><IconRefresh size={17} /> {t('carte_reessayer')}</button>
          )}
          <span className="eyebrow set-titre">{t('services_google_titre')}</span>
          <div className="menu-groupe">
            {LIGNES.map(({ nom, icone: Icone, titre, cle: base }) => {
              const e = services[nom];
              return (
                <div key={nom} className="menu-ligne etat-service" role="group" data-service={nom} data-etat={e}>
                  <span className="menu-ico"><Icone size={27} strokeWidth={1.9} /></span>
                  <span className="menu-texte"><strong>{t(titre)}</strong>
                    <small>{t(e === 'actif' ? `${base}_actif` : e === 'refuse' ? `${base}_refuse` : e === 'injoignable' ? `${base}_injoignable` : 'lieux_google_inconnu')}</small></span>
                  {e === 'actif' && <IconCheck size={20} strokeWidth={2.4} />}
                </div>
              );
            })}
          </div>
          {Object.values(services).some((e) => e !== 'actif') && (
            <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={verif} onClick={() => verifier((e) => e !== 'actif')}><IconRefresh size={17} /> {t('lieux_google_verifier')}</button>
          )}
          <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 14 }}>{t('carte_legal_google')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen page sans-couleur">
      <TopBar onBack={onBack} title={t('carte_titre')} />
      <div className="page-body">
        <span className="eyebrow set-titre">{t('carte_fond')}</span>
        <div className="menu-groupe">
          <button className="menu-ligne" onClick={() => choisirFond('orion')} aria-pressed={fond === 'orion'}>
            <span className="menu-ico"><IconMap size={27} strokeWidth={1.9} /></span>
            <span className="menu-texte"><strong>{t('carte_orion')}</strong><small>OpenStreetMap · Overture Maps</small></span>
            {fond === 'orion' && <IconCheck size={20} strokeWidth={2.4} />}
          </button>
          <button className="menu-ligne" onClick={() => choisirFond(avecCle ? 'google' : 'google-essai')} aria-pressed={fond === 'google'}>
            <span className="menu-ico"><IconPin size={27} strokeWidth={1.9} /></span>
            <span className="menu-texte"><strong>{t('carte_d_google')}</strong><small>{avecCle ? t('carte_avec_cle') : t('carte_essai')}</small></span>
            {fond === 'google' && <IconCheck size={20} strokeWidth={2.4} />}
          </button>
        </div>

        {google && (
          <div className="carte-apercu" aria-label={t('carte_apercu')}>
            <div ref={apercu} className="carte-apercu-carte" />
            {!apercuPret && !injoignable && <span className="carte-apercu-attente">{t('carte_apercu_attente')}</span>}
          </div>
        )}
        <p className={refus || motif || injoignable ? 'carte-etat refus' : 'carte-etat'} role="status" aria-live="polite">{etat}</p>

        <span className="eyebrow set-titre">{t('carte_cle')}</span>
        <p className="faint" style={{ fontSize: 13, lineHeight: 1.5, margin: '0 0 10px' }}>{t('carte_cle_aide')}</p>
        <div className="field" style={{ marginBottom: 10 }}>
          <input value={cle} onChange={(e) => setCle(e.target.value)} placeholder="AIza…" aria-label={t('carte_cle')}
            autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="text" />
        </div>
        <button className="btn btn-primary" disabled={!cle.trim() || cle.trim() === cleGoogleSaisie()} onClick={enregistrer}>{t('carte_enregistrer')}</button>
        {cleGoogleSaisie() && (
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => { const recharger = googleDejaCharge(); definirCleGoogle(''); setCle(''); if (recharger) window.location.reload(); }}>{t('carte_retirer')}</button>
        )}
        <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 14 }}>{t('carte_legal_google')}</p>
      </div>
    </div>
  );
}
