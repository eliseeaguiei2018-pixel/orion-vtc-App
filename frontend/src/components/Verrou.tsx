import { useEffect, useState } from 'react';
import { LogoApp } from './Logo';
import { IconFingerprint, IconLock } from '../icons';
import { useI18n } from '../i18n';
import { etatBiometrie, setBiometricEnabled, verifierBiometrie, verifierCodeTelephone, type MotifEchec, type ResultatBio } from '../security';

/**
 * ÉCRAN DE VERROUILLAGE — commun à l'app client et à l'app chauffeur. Quand l'empreinte
 * (ou le visage) a été liée dans les paramètres, l'application la demande à l'ouverture ;
 * le code du téléphone sert de recours. Hors de l'application installée, rien ne peut
 * vérifier : la liaison est retirée et l'application s'ouvre.
 */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [echec, setEchec] = useState<MotifEchec | null>(null);
  const [code, setCode] = useState(false);
  const textes = { titre: t('lock_title'), sousTitre: t('lock_hint'), annuler: t('bio_annuler') };
  const conclure = (r: ResultatBio) => { setBusy(false); if (r.ok) onUnlock(); else setEchec(r.motif); };
  const unlock = async () => {
    setBusy(true); setEchec(null);
    const etat = await etatBiometrie();
    if (!etat.dispo && (etat.raison === 'web' || !etat.codeTelephone)) { setBiometricEnabled(false); onUnlock(); return; }
    setCode(etat.codeTelephone);
    conclure(etat.dispo ? await verifierBiometrie(textes) : await verifierCodeTelephone(textes));
  };
  const parCode = async () => { setBusy(true); setEchec(null); conclure(await verifierCodeTelephone(textes)); };
  useEffect(() => { void unlock(); /* tente automatiquement à l'ouverture */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="lock-screen">
      <LogoApp size={72} />
      <div className="lock-fp" onClick={() => { if (!busy) void unlock(); }} role="button">
        <IconFingerprint size={56} />
      </div>
      <h2 className="h-title">{t('lock_title')}</h2>
      <p className="h-sub" style={{ textAlign: 'center' }}>{echec ? t(`bio_motif_${echec}`) : t('lock_hint')}</p>
      <button className="btn btn-primary" style={{ maxWidth: 280, marginTop: 18 }} disabled={busy} onClick={() => void unlock()}>
        <IconLock size={18} /> {t('lock_unlock')}
      </button>
      {echec && code && (
        <button className="btn btn-ghost" style={{ maxWidth: 280, marginTop: 10 }} disabled={busy} onClick={() => void parCode()}>{t('lock_code')}</button>
      )}
    </div>
  );
}

