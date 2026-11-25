import { useState } from 'react';
import { TopBar } from './ui';
import { IconCheck, IconShieldCheck } from '../icons';
import { useI18n } from '../i18n';
import { adresseServeur, etatServeur, relierServeur, testerServeur } from '../api';

/**
 * SERVEUR ORION.
 *
 * L'application fonctionne seule (courses simulées, données sur le téléphone) tant
 * qu'aucun serveur n'est en ligne. Cet écran la relie au serveur ORION : les courses,
 * les alertes SOS et les messages arrivent alors au centre de contrôle, et le compte
 * suit la personne d'un appareil à l'autre. L'adresse est testée avant d'être retenue.
 */
export function ServeurScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const etat = etatServeur();
  const [saisie, setSaisie] = useState(etat.url);
  const [essai, setEssai] = useState<'repos' | 'test' | 'ok'>('repos');
  const [erreur, setErreur] = useState('');
  const hote = (u: string) => { try { return new URL(u).host; } catch { return u; } };

  const relier = async () => {
    setErreur('');
    const a = adresseServeur(saisie);
    if ('erreur' in a) { setErreur(t(a.erreur === 'https' ? 'srv_err_https' : 'srv_err_adresse')); return; }
    setEssai('test');
    const r = await testerServeur(a.url);
    if (!r.ok) { setEssai('repos'); setErreur(t(r.raison === 'pas_orion' ? 'srv_err_pas_orion' : 'srv_err_injoignable')); return; }
    setEssai('ok');
    // Le temps de lire la confirmation, puis l'application redémarre reliée au serveur.
    window.setTimeout(() => relierServeur(a.url), 1400);
  };

  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('srv_title')} />
      <div className="page-body">
        <div className={`srv-etat${etat.url ? ' relie' : ''}`}>
          <span className="srv-point" aria-hidden="true" />
          <span className="col grow" style={{ textAlign: 'start' }}>
            <strong>{t(etat.url ? 'srv_etat_relie' : 'srv_etat_autonome')}</strong>
            <span className="faint">{etat.url ? hote(etat.url) : t('srv_etat_autonome_d')}</span>
          </span>
          {etat.url && <IconShieldCheck size={20} />}
        </div>

        <p className="h-sub" style={{ margin: '16px 0 14px' }}>{t('srv_intro')}</p>

        <label className="eyebrow" htmlFor="srv-adresse">{t('srv_adresse')}</label>
        <div className="field" style={{ margin: '10px 0 8px' }}>
          <input
            id="srv-adresse" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="https://orion-backend.onrender.com" value={saisie}
            onChange={(e) => { setSaisie(e.target.value); setErreur(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void relier(); }}
          />
        </div>
        {erreur && <p className="photo-erreur" role="alert">{erreur}</p>}
        {essai === 'ok' && <p className="srv-succes" role="status"><IconCheck size={15} /> {t('srv_ok')}</p>}

        <button className="btn btn-primary" style={{ marginTop: 6 }} disabled={essai !== 'repos' || !saisie.trim()} onClick={() => void relier()}>
          {t(essai === 'test' ? 'srv_test_en_cours' : 'srv_tester')}
        </button>
        {etat.url && (
          <button className="btn btn-ghost" style={{ marginTop: 10 }} disabled={essai !== 'repos'} onClick={() => relierServeur(null)}>
            {t('srv_detacher')}
          </button>
        )}
        <p className="faint" style={{ fontSize: 12, marginTop: 14 }}>{t('srv_note')}</p>
      </div>
    </div>
  );
}
