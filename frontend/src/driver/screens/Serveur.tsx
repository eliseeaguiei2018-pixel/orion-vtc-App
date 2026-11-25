import { useState } from 'react';
import { IconCheck, IconShieldCheck } from '../../icons';
import { useI18n } from '../../i18n';
import { adresseServeur, etatServeur, relierServeur, testerServeur } from '../../api';
import { saveSession } from '../session';
import { Modal } from '../ui';
import { tr } from '../i18n';

const hote = (u: string) => { try { return new URL(u).host; } catch { return u; } };

/**
 * SERVEUR ORION (app chauffeur) — même réglage que l'app cliente.
 *
 * L'app est livrée reliée au serveur d'ORION. Si l'adresse change (nouvel hébergement),
 * le chauffeur la saisit ici : elle est testée (c'est bien un serveur ORION ?) avant d'être
 * retenue, puis l'app redémarre. Le compte vit sur le serveur : changer de serveur ferme
 * la session en cours.
 */
export function ServeurOrion({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const etat = etatServeur();
  const [saisie, setSaisie] = useState(etat.url);
  const [essai, setEssai] = useState<'repos' | 'test' | 'ok'>('repos');
  const [erreur, setErreur] = useState('');

  const relier = async () => {
    setErreur('');
    const a = adresseServeur(saisie);
    if ('erreur' in a) { setErreur(t(a.erreur === 'https' ? 'srv_err_https' : 'srv_err_adresse')); return; }
    setEssai('test');
    const r = await testerServeur(a.url);
    if (!r.ok) { setEssai('repos'); setErreur(t(r.raison === 'pas_orion' ? 'srv_err_pas_orion' : 'srv_err_injoignable')); return; }
    setEssai('ok');
    window.setTimeout(() => { saveSession(null); relierServeur(a.url); }, 1200);
  };

  return (
    <Modal title={t('srv_title')} onClose={onClose}>
      <div className="col" style={{ gap: 10 }}>
        <div className="card dv-item">
          <i className={`dv-point-serveur${etat.url ? ' on' : ''}`} aria-hidden="true" />
          <div className="grow">
            <div className="dv-item-title">{t(etat.url ? 'srv_etat_relie' : 'srv_etat_autonome')}</div>
            <div className="dv-item-sub">{etat.url ? hote(etat.url) : tr('Mode démonstration : courses simulées sur ce téléphone')}</div>
          </div>
          {etat.url && <IconShieldCheck size={20} />}
        </div>
        <label className="dv-label">{t('srv_adresse')}
          <input className="dv-input" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="https://orion-backend.onrender.com" value={saisie}
            onChange={(e) => { setSaisie(e.target.value); setErreur(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void relier(); }} />
        </label>
        {erreur && <div className="dv-banner danger" role="alert"><div className="grow"><strong>{erreur}</strong></div></div>}
        {essai === 'ok' && <div className="dv-banner success" role="status"><IconCheck size={16} /><div className="grow"><strong>{t('srv_ok')}</strong></div></div>}
        <button className="btn btn-primary" disabled={essai !== 'repos' || !saisie.trim()} onClick={() => void relier()}>
          {t(essai === 'test' ? 'srv_test_en_cours' : 'srv_tester')}
        </button>
        {etat.url && etat.origine === 'application' && (
          <button className="btn btn-ghost" disabled={essai !== 'repos'} onClick={() => { saveSession(null); relierServeur(null); }}>{t('srv_detacher')}</button>
        )}
        <div className="faint" style={{ fontSize: 12 }}>{tr('Le compte chauffeur vit sur le serveur : changer de serveur ferme la session en cours.')}</div>
      </div>
    </Modal>
  );
}

/** Ligne « Serveur ORION · adresse » (connexion, profil) qui ouvre le réglage. */
export function LienServeur() {
  const [ouvert, setOuvert] = useState(false);
  const etat = etatServeur();
  return (
    <>
      <button type="button" className="dv-lien-serveur" onClick={() => setOuvert(true)}>
        <i className={`dv-point-serveur${etat.url ? ' on' : ''}`} aria-hidden="true" />
        {tr('Serveur ORION')} · {etat.url ? hote(etat.url) : tr('non relié')}
      </button>
      {ouvert && <ServeurOrion onClose={() => setOuvert(false)} />}
    </>
  );
}
