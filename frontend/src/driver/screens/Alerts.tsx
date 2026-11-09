import { IconBolt, IconClock, IconShield, IconWallet, IconWifi } from '../../icons';
import type { DriverApp } from '../useDriver';
import { Banner } from '../ui';
import { daysUntil, fcfa } from '../format';

/**
 * Bandeaux SYNCHRONISÉS avec la console : maintenance ORION, service VTC coupé,
 * suspension motivée, dossier à compléter, dette espèces / plafond, compte gelé,
 * avertissements qualité, assurance qui expire, lien temps réel perdu.
 */
export function Alerts({ app, onFixDossier }: { app: DriverApp; onFixDossier?: () => void }) {
  const { driver, appConfig, finance, driverConfig, link, live } = app;
  if (!driver) return null;
  const out: JSX.Element[] = [];
  const insurance = daysUntil(driver.insuranceExpiry);

  if (live && link === 'offline') {
    out.push(<Banner key="link" tone="warn" icon={<IconWifi size={18} />} title="Connexion temps réel interrompue">Reconnexion automatique en cours…</Banner>);
  }
  if (appConfig && !appConfig.open) {
    out.push(<Banner key="closed" tone="danger" icon={<IconShield size={18} />} title="ORION est momentanément fermé">Maintenance en cours : la mise en ligne est suspendue par la direction.</Banner>);
  } else if (appConfig && appConfig.services['course'] === false) {
    out.push(<Banner key="vtc" tone="warn" icon={<IconShield size={18} />} title="Service VTC suspendu par ORION">Aucune nouvelle course n’est proposée pour le moment.</Banner>);
  }
  if (driver.kycStatus === 'suspended') {
    out.push(<Banner key="susp" tone="danger" icon={<IconShield size={18} />} title="Compte suspendu">{driver.suspensionReason ? `Motif : ${driver.suspensionReason}. ` : ''}Contactez le support ORION pour régulariser votre situation.</Banner>);
  } else if (driver.kycStatus === 'draft') {
    out.push(<Banner key="kyc" tone="warn" icon={<IconShield size={18} />} title="Dossier à compléter"
      action={onFixDossier && <button className="dv-pill green" onClick={onFixDossier}>Compléter</button>}>Complétez et envoyez votre dossier pour être validé par ORION.</Banner>);
  } else if (driver.kycStatus === 'docs_submitted' || driver.kycStatus === 'manual_review') {
    out.push(<Banner key="kyc" tone="info" icon={<IconClock size={18} />} title="Dossier en cours de validation">ORION examine vos documents. Vous serez prévenu ici dès la validation.</Banner>);
  }
  if (finance?.frozen) {
    out.push(<Banner key="frozen" tone="danger" icon={<IconWallet size={18} />} title="Portefeuille gelé">Un litige est en cours d’instruction : les retraits sont bloqués temporairement.</Banner>);
  }
  if (finance?.cashBlocked) {
    out.push(<Banner key="debt" tone="danger" icon={<IconWallet size={18} />} title="Plafond de dette espèces dépassé">Dette : {fcfa(finance.cashDebt)} (plafond {fcfa(finance.cashDebtLimit)}). Vous ne recevez plus de courses payées en espèces : régularisez auprès d’ORION.</Banner>);
  } else if (finance && finance.cashDebt > 0 && finance.cashDebt > finance.cashDebtLimit * 0.7) {
    out.push(<Banner key="debt" tone="warn" icon={<IconWallet size={18} />} title="Dette espèces proche du plafond">{fcfa(finance.cashDebt)} sur {fcfa(finance.cashDebtLimit)} autorisés.</Banner>);
  }
  if (insurance !== null && insurance < 0) {
    out.push(<Banner key="ins" tone="danger" icon={<IconShield size={18} />} title="Assurance expirée">Renouvelez votre assurance et mettez à jour votre dossier.</Banner>);
  } else if (insurance !== null && insurance <= 30) {
    out.push(<Banner key="ins" tone="warn" icon={<IconShield size={18} />} title={`Assurance : expire dans ${insurance} j`}>Pensez à la renouveler pour éviter une suspension.</Banner>);
  }
  if ((driver.warnings ?? 0) > 0) {
    out.push(<Banner key="warn" tone="warn" icon={<IconBolt size={18} />} title={`${driver.warnings} avertissement${(driver.warnings ?? 0) > 1 ? 's' : ''} qualité`}>Note minimale exigée : {driverConfig.quality.minRating.toFixed(1)} ★. Soignez l’accueil et la conduite.</Banner>);
  }
  return out.length ? <div className="col" style={{ gap: 10 }}>{out}</div> : null;
}
