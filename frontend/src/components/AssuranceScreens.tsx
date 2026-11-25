import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { TopBar } from './ui';
import { IconCheck, IconClose, IconFingerprint, IconGlobe, IconInfo, IconLock, IconMedical, IconPhone, IconShieldCheck, IconUsers, IconWallet } from '../icons';
import { attenteCode, choisirEmpreinte, codeFaible, codePossible, coffreDepuis, definirCode, modeCoffre, retirerCoffre, verifierCode, CODE_MAX, CODE_MIN } from '../coffre';
import { etatBiometrie, verifierBiometrie, verifierCodeTelephone, type EtatBio } from '../security';
import {
  modeLocal,
  ALLERGIES, ANTECEDENTS, COMMUNICATION, GROUPES_SANGUINS, enregistrerDossierAssurance, lireDossierAssurance, statutAssurance, supprimerDossierAssurance,
  type FicheMedicale, type StatutAssurance,
} from '../api';

/**
 * ORION ASSURANCE (app cliente).
 *
 * 1. PRÉSENTATION : le client lit à quoi sert le service, pourquoi c'est important, qui
 *    peut voir ses informations et comment elles sont protégées. Le bouton d'inscription
 *    ne s'active qu'après lecture jusqu'au bout et double consentement.
 * 2. DOSSIER en cinq étapes : identité et pièce ; groupe sanguin et problèmes de santé ;
 *    allergies et traitements ; situation particulière ; personnes à prévenir.
 * 3. VERROU : le dossier ne s'ouvre dans l'application qu'avec l'empreinte ou le visage
 *    du téléphone, ou un code secret défini par le client (voir coffre.ts).
 * 4. STATUT : protection active, et chaque ouverture du dossier par le SAMU.
 *
 * Rien de médical n'est gardé sur le téléphone : le dossier est envoyé chiffré en transit
 * (HTTPS), chiffré au repos sur le serveur, et relu à la demande seulement.
 */

type Mode = 'chargement' | 'presentation' | 'formulaire' | 'statut';

const VIDE: FicheMedicale = {
  identite: { nom: '', prenoms: '', dateNaissance: '' },
  piece: { type: 'cni', numero: '', expiration: '' },
  sante: { groupeSanguin: 'inconnu', antecedents: [], anticoagulants: false, stimulateurCardiaque: false, reactionAllergiqueGrave: false },
  urgence: { nom: '', lien: '', telephone: '' },
};

export function AssuranceScreen({ onBack, onToast, onChange, nomClient }: {
  onBack: () => void;
  onToast: (m: string, erreur?: boolean) => void;
  /** Prévenu à chaque inscription / suppression (activation de l'option à la commande). */
  onChange?: (inscrit: boolean) => void;
  nomClient?: string | null;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('chargement');
  const [statut, setStatut] = useState<StatutAssurance | null>(null);
  const [fiche, setFiche] = useState<FicheMedicale>(VIDE);

  useEffect(() => {
    void statutAssurance().then((s) => {
      setStatut(s);
      setMode(s?.inscrit ? 'statut' : 'presentation');
    });
  }, []);

  /* Le verrou en cours : à définir (première fois) ou à ouvrir, puis l'action qui suit. */
  const [verrou, setVerrou] = useState<null | { but: 'definir' | 'ouvrir'; suite: () => void; libre?: boolean }>(null);

  const charger = async () => {
    const r = await lireDossierAssurance();
    if (typeof r === 'string') { onToast(r, true); return; }
    if (r.fiche) setFiche(r.fiche);
    setMode('formulaire');
  };
  /* Lire ou modifier le dossier : toujours derrière le verrou. Un dossier d'avant cette
     version, sans protection, en reçoit une avant de s'ouvrir. */
  const ouvrirDossier = () => setVerrou({ but: modeCoffre() ? 'ouvrir' : 'definir', suite: () => void charger() });
  const changerProtection = () => setVerrou({ but: 'ouvrir', suite: () => setVerrou({ but: 'definir', suite: () => onToast(t('as_v_change')), libre: true }) });

  if (verrou) {
    return <VerrouDossier but={verrou.but} libre={verrou.libre}
      onFermer={() => setVerrou(null)}
      onReussi={() => { const suite = verrou.suite; setVerrou(null); suite(); }} />;
  }
  if (mode === 'chargement') return <div className="screen page"><TopBar onBack={onBack} title={t('as_title')} /><div className="page-body" /></div>;
  if (mode === 'presentation') {
    return <Presentation onBack={onBack} onContinuer={() => {
      const [prenoms, ...nom] = (nomClient ?? '').trim().split(/\s+/);
      setFiche((f) => ({ ...f, identite: { ...f.identite, prenoms: f.identite.prenoms || (prenoms ?? ''), nom: f.identite.nom || nom.join(' ') } }));
      setMode('formulaire');
    }} />;
  }
  if (mode === 'formulaire') {
    return <Formulaire initiale={fiche} onBack={() => setMode(statut?.inscrit ? 'statut' : 'presentation')} onEnregistre={(s) => {
      setStatut(s); setMode('statut'); onChange?.(true); onToast(t('as_enregistre'));
      // Premier enregistrement : le client choisit tout de suite comment protéger son dossier.
      if (!modeCoffre()) setVerrou({ but: 'definir', suite: () => onToast(t('as_v_protege')) });
    }} onToast={onToast} />;
  }
  return <Statut statut={statut} onBack={onBack} onModifier={ouvrirDossier} onProtection={changerProtection} onSupprime={(s) => {
    retirerCoffre();
    setStatut(s); setFiche(VIDE); setMode('presentation'); onChange?.(false); onToast(t('as_supprime'));
  }} onToast={onToast} />;
}

/* ------------------------------------------------------------ Verrou du dossier */

/**
 * Définir la protection du dossier (empreinte ou visage du téléphone, ou code secret), ou
 * l'ouvrir. `libre` : changement de protection après ouverture — on peut alors renoncer.
 */
function VerrouDossier({ but, libre, onReussi, onFermer }: { but: 'definir' | 'ouvrir'; libre?: boolean; onReussi: () => void; onFermer: () => void }) {
  const { t } = useI18n();
  const mode = modeCoffre();
  const [bio, setBio] = useState<EtatBio | null>(null);
  const [vue, setVue] = useState<'choix' | 'code'>(but === 'ouvrir' && mode === 'code' ? 'code' : 'choix');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [attente, setAttente] = useState(attenteCode());
  const textes = (sousTitre: string) => ({ titre: t('as_v_sys'), sousTitre, annuler: t('bio_annuler') });

  useEffect(() => { void etatBiometrie().then(setBio); }, []);
  useEffect(() => {
    if (attente <= 0) return;
    const i = setInterval(() => setAttente(attenteCode()), 1000);
    return () => clearInterval(i);
  }, [attente]);

  const parEmpreinte = async (pourDefinir: boolean) => {
    setEnCours(true); setErreur(null);
    const r = await verifierBiometrie(textes(t(pourDefinir ? 'as_v_sys_lier' : 'as_v_sys_ouvrir')));
    setEnCours(false);
    if (!r.ok) { setErreur(t(`bio_motif_${r.motif}`)); return; }
    if (pourDefinir) choisirEmpreinte();
    onReussi();
  };
  const parCodeTelephone = async () => {
    setEnCours(true); setErreur(null);
    const r = await verifierCodeTelephone(textes(t('as_v_sys_ouvrir')));
    setEnCours(false);
    if (r.ok) onReussi(); else setErreur(t(`bio_motif_${r.motif}`));
  };
  // Dossier protégé par l'empreinte : la fenêtre du téléphone s'ouvre d'elle-même.
  useEffect(() => { if (but === 'ouvrir' && mode === 'empreinte') void parEmpreinte(false); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validerCode = async () => {
    setErreur(null);
    if (but === 'definir') {
      if (codeFaible(code)) { setErreur(t('as_v_faible', { min: CODE_MIN, max: CODE_MAX })); return; }
      if (code !== confirmation) { setErreur(t('as_v_differents')); return; }
      setEnCours(true);
      const ok = await definirCode(code);
      setEnCours(false);
      if (ok) onReussi(); else setErreur(t('as_v_indispo'));
      return;
    }
    setEnCours(true);
    const r = await verifierCode(code);
    setEnCours(false); setCode('');
    if (r.ok) { onReussi(); return; }
    setAttente(r.attente);
    setErreur(r.attente > 0 ? t('as_v_attendre', { s: r.attente }) : t('as_v_faux', { n: r.restants }));
  };

  const champCode = (valeur: string, regler: (v: string) => void, libelle: string, auto?: boolean) => (
    <label className="as-champ"><span>{libelle}</span>
      <div className="field">
        <IconLock size={16} />
        <input className="as-code" type="password" inputMode="numeric" autoComplete="off" maxLength={CODE_MAX} value={valeur} autoFocus={auto}
          disabled={attente > 0} onChange={(e) => regler(e.target.value.replace(/\D/g, '').slice(0, CODE_MAX))} />
      </div>
    </label>
  );
  // Empreinte choisie puis retirée du téléphone, et plus aucun code d'écran : rien ne peut
  // vérifier — on laisse redéfinir une protection plutôt que de bloquer le dossier à jamais.
  const sansRecours = but === 'ouvrir' && mode === 'empreinte' && bio !== null && !bio.dispo && !bio.codeTelephone;
  const definir = but === 'definir' || sansRecours;

  return (
    <div className="screen page">
      <TopBar onBack={vue === 'code' && definir ? () => { setVue('choix'); setErreur(null); setCode(''); setConfirmation(''); } : but === 'ouvrir' || libre ? onFermer : undefined} title={t('as_title')} />
      <div className="page-body as-page">
        <div className="as-hero rise">
          <span className="as-hero-ico"><IconLock size={30} /></span>
          <h2 className="h-title">{t(definir ? 'as_v_titre_definir' : 'as_v_titre_ouvrir')}</h2>
          <p className="h-sub">{t(definir ? 'as_v_sous_definir' : mode === 'code' ? 'as_v_sous_code' : 'as_v_sous_empreinte')}</p>
        </div>

        {definir && vue === 'choix' && (
          <div className="as-form">
            <button className="as-protection" disabled={enCours || !bio?.dispo} onClick={() => void parEmpreinte(true)}>
              <span className="as-section-ico"><IconFingerprint size={22} /></span>
              <span className="col grow" style={{ textAlign: 'start', minWidth: 0 }}>
                <strong>{t('as_v_empreinte')}</strong>
                <small>{bio === null ? '…' : bio.dispo ? t('as_v_empreinte_d') : t(`bio_raison_${bio.raison}`)}</small>
              </span>
            </button>
            <button className="as-protection" disabled={enCours || !codePossible()} onClick={() => { setVue('code'); setErreur(null); }}>
              <span className="as-section-ico"><IconLock size={22} /></span>
              <span className="col grow" style={{ textAlign: 'start', minWidth: 0 }}>
                <strong>{t('as_v_code')}</strong>
                <small>{t('as_v_code_d', { min: CODE_MIN, max: CODE_MAX })}</small>
              </span>
            </button>
            <p className="as-garantie"><IconInfo size={14} /> {t('as_v_note')}</p>
          </div>
        )}

        {definir && vue === 'code' && (
          <div className="as-form">
            {champCode(code, setCode, t('as_v_saisir', { min: CODE_MIN, max: CODE_MAX }), true)}
            {champCode(confirmation, setConfirmation, t('as_v_confirmer'))}
            <button className="btn btn-primary" disabled={enCours || code.length < CODE_MIN || confirmation.length < CODE_MIN} onClick={() => void validerCode()}>
              <IconShieldCheck size={18} /> {t('as_v_proteger')}
            </button>
            <p className="as-garantie"><IconInfo size={14} /> {t('as_v_code_note')}</p>
          </div>
        )}

        {!definir && mode === 'code' && (
          <div className="as-form">
            {champCode(code, setCode, t('as_v_votre_code'), true)}
            <button className="btn btn-primary" disabled={enCours || attente > 0 || code.length < CODE_MIN} onClick={() => void validerCode()}>
              <IconLock size={18} /> {attente > 0 ? t('as_v_attendre', { s: attente }) : t('as_v_ouvrir')}
            </button>
            <p className="as-garantie"><IconInfo size={14} /> {t('as_v_oublie')}</p>
          </div>
        )}

        {!definir && mode === 'empreinte' && (
          <div className="as-form">
            <button className="btn btn-primary" disabled={enCours || bio === null || !bio.dispo} onClick={() => void parEmpreinte(false)}>
              <IconFingerprint size={18} /> {t('as_v_ouvrir_empreinte')}
            </button>
            {bio?.codeTelephone && (
              <button className="btn btn-ghost" disabled={enCours} onClick={() => void parCodeTelephone()}>{t('lock_code')}</button>
            )}
            {bio && !bio.dispo && <p className="as-garantie"><IconInfo size={14} /> {t(`bio_raison_${bio.raison}`)}</p>}
          </div>
        )}

        {erreur && <p className="as-erreur" role="alert"><IconClose size={14} /> {erreur}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Présentation */

function Presentation({ onBack, onContinuer }: { onBack: () => void; onContinuer: () => void }) {
  const { t } = useI18n();
  const [luJusquauBout, setLu] = useState(false);
  const [compris, setCompris] = useState(false);
  const [accord, setAccord] = useState(false);
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = fin.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e?.isIntersecting) setLu(true); }, { threshold: 0.6 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const sections: Array<[JSX.Element, string, string]> = [
    [<IconShieldCheck size={20} key="a" />, 'as_quoi_t', 'as_quoi'],
    [<IconMedical size={20} key="b" />, 'as_pourquoi_t', 'as_pourquoi'],
    [<IconUsers size={20} key="c" />, 'as_demande_t', 'as_demande'],
    [<IconPhone size={20} key="d" />, 'as_qui_t', 'as_qui'],
    // Sans serveur ORION, le dossier ne peut pas être sur nos serveurs : l'écran le dit.
    [<IconLock size={20} key="e" />, 'as_protege_t', modeLocal() ? 'as_protege_local' : 'as_protege'],
    [<IconWallet size={20} key="f" />, 'as_prix_t', 'as_prix'],
  ];
  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('as_title')} />
      <div className="page-body as-page">
        <div className="as-hero rise">
          <span className="as-hero-ico"><IconMedical size={30} /></span>
          <h2 className="h-title">{t('as_title')}</h2>
          <p className="h-sub">{t('as_tag')}</p>
        </div>
        <AvisLangue />
        {sections.map(([ico, titre, texte], i) => (
          <section key={titre} className="as-section rise" style={{ animationDelay: `${0.05 * i}s` }}>
            <span className="as-section-ico">{ico}</span>
            <div><h3>{t(titre)}</h3><p>{t(texte)}</p></div>
          </section>
        ))}
        <div ref={fin} className="as-consentement">
          <label className={`as-case${compris ? ' on' : ''}`}>
            <input type="checkbox" checked={compris} onChange={(e) => setCompris(e.target.checked)} />
            <span className="as-coche"><IconCheck size={14} /></span>{t('as_lu')}
          </label>
          <label className={`as-case${accord ? ' on' : ''}`}>
            <input type="checkbox" checked={accord} onChange={(e) => setAccord(e.target.checked)} />
            <span className="as-coche"><IconCheck size={14} /></span>{t('as_accepte')}
          </label>
          <button className="btn btn-primary" disabled={!luJusquauBout || !compris || !accord} onClick={onContinuer}>
            <IconShieldCheck size={18} /> {t('as_inscrire')}
          </button>
          {!luJusquauBout && <p className="faint" style={{ textAlign: 'center', fontSize: 12 }}>{t('as_lire_tout')}</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Formulaire */

const aujourdhui = () => new Date().toISOString().slice(0, 10);

const ETAPES = 5;
const TITRES = ['as_identite', 'as_sante', 'as_e_allergies', 'as_e_situation', 'as_urgence'];
const telOk = (v: string) => /^\+?[0-9]{8,15}$/.test(v.replace(/[\s.-]/g, ''));
const propreTexte = (v?: string) => v?.trim() || undefined;

function Formulaire({ initiale, onBack, onEnregistre, onToast }: {
  initiale: FicheMedicale; onBack: () => void; onEnregistre: (s: StatutAssurance) => void; onToast: (m: string, e?: boolean) => void;
}) {
  const { t } = useI18n();
  const [etape, setEtape] = useState(1);
  const [f, setF] = useState<FicheMedicale>(initiale);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const maj = <K extends keyof FicheMedicale>(k: K, v: Partial<NonNullable<FicheMedicale[K]>>) =>
    setF((x) => ({ ...x, [k]: { ...(x[k] as object), ...v } }));
  const u2 = f.urgence2 ?? { nom: '', lien: '', telephone: '' };
  const u2Commence = Boolean(u2.nom.trim() || u2.lien.trim() || u2.telephone.trim());

  const valide = (): string | null => {
    if (etape === 1) {
      const { nom, prenoms, dateNaissance } = f.identite;
      if (nom.trim().length < 2 || prenoms.trim().length < 2 || !dateNaissance || f.piece.numero.trim().length < 6 || !f.piece.expiration) return t('as_err_requis');
      if (f.piece.expiration < aujourdhui()) return t('as_err_expiree');
    }
    if (etape === 2) {
      const { poidsKg, tailleCm } = f.sante;
      if ((poidsKg !== undefined && (poidsKg < 20 || poidsKg > 300)) || (tailleCm !== undefined && (tailleCm < 80 || tailleCm > 250))) return t('as_err_mesures');
    }
    if (etape === 5) {
      if (f.urgence.nom.trim().length < 2 || f.urgence.lien.trim().length < 2 || !telOk(f.urgence.telephone)) return t('as_err_requis');
      // Second contact : facultatif, mais complet s'il est commencé.
      if (u2Commence && (u2.nom.trim().length < 2 || u2.lien.trim().length < 2 || !telOk(u2.telephone))) return t('as_err_contact2');
    }
    return null;
  };
  const suivant = async () => {
    const e = valide();
    setErreur(e);
    if (e) return;
    if (etape < ETAPES) { setEtape(etape + 1); return; }
    setEnvoi(true);
    const sa = f.sante;
    const propre: FicheMedicale = {
      ...f,
      cmu: f.cmu?.trim() || undefined,
      medecin: f.medecin?.nom?.trim() || f.medecin?.telephone?.trim() ? { nom: f.medecin?.nom?.trim() || undefined, telephone: f.medecin?.telephone?.trim() || undefined } : undefined,
      mutuelle: f.mutuelle?.compagnie?.trim() || f.mutuelle?.numero?.trim() ? { compagnie: propreTexte(f.mutuelle?.compagnie), numero: propreTexte(f.mutuelle?.numero) } : undefined,
      urgence2: u2Commence ? u2 : undefined,
      sante: {
        ...sa,
        allergies: propreTexte(sa.allergies), traitements: propreTexte(sa.traitements), autresAntecedents: propreTexte(sa.autresAntecedents),
        chirurgies: propreTexte(sa.chirurgies), implants: propreTexte(sa.implants), langues: propreTexte(sa.langues),
        consignes: propreTexte(sa.consignes), hopital: propreTexte(sa.hopital),
        allergiesConnues: sa.allergiesConnues?.length ? sa.allergiesConnues : undefined,
        communication: sa.communication?.length ? sa.communication : undefined,
        // Réponses liées à un antécédent : sans lui, elles n'ont pas de sens.
        insuline: sa.antecedents.includes('diabete') ? sa.insuline : undefined,
        grossesseMois: sa.antecedents.includes('grossesse') ? sa.grossesseMois : undefined,
      },
    };
    const r = await enregistrerDossierAssurance(propre);
    setEnvoi(false);
    if (typeof r === 'string') { setErreur(r); onToast(r, true); return; }
    onEnregistre(r);
  };

  type CleOuiNon = 'anticoagulants' | 'stimulateurCardiaque' | 'reactionAllergiqueGrave' | 'insuline' | 'hospitalisationRecente';
  const ouiNon = (cle: CleOuiNon, question: string) => (
    <div className="as-question">
      <span>{t(question)}</span>
      <div className="chips">
        {[true, false].map((v) => (
          <button key={String(v)} className={`chip${f.sante[cle] === v ? ' active' : ''}`} onClick={() => maj('sante', { [cle]: v })}>{t(v ? 'as_oui' : 'as_non')}</button>
        ))}
      </div>
    </div>
  );
  /** Cases à cocher d'une liste fermée (antécédents, allergies, communication). */
  const cases = <T extends string>(liste: readonly T[], choisis: readonly T[], prefixe: string, regler: (v: T[]) => void) => (
    <div className="as-antecedents">
      {liste.map((a) => {
        const on = choisis.includes(a);
        return (
          <button key={a} className={`as-antecedent${on ? ' on' : ''}`} aria-pressed={on} onClick={() => regler(on ? choisis.filter((x) => x !== a) : [...choisis, a])}>
            <span className="as-coche"><IconCheck size={13} /></span>{t(`${prefixe}${a}`)}
          </button>
        );
      })}
    </div>
  );
  const texte = (cle: 'allergies' | 'traitements' | 'autresAntecedents' | 'chirurgies' | 'implants' | 'langues' | 'consignes' | 'hopital', libelle: string, max = 300) => (
    <label className="as-champ"><span>{t(libelle)}</span><div className="field"><input value={f.sante[cle] ?? ''} maxLength={max} onChange={(e) => maj('sante', { [cle]: e.target.value })} /></div></label>
  );
  const nombre = (cle: 'poidsKg' | 'tailleCm', libelle: string, unite: string) => (
    <label className="as-champ"><span>{t(libelle)}</span>
      <div className="field">
        <input inputMode="numeric" value={f.sante[cle] ?? ''} maxLength={3}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); maj('sante', { [cle]: v ? Number(v) : undefined }); }} />
        <span className="faint" style={{ fontSize: 13, flex: 'none' }}>{unite}</span>
      </div>
    </label>
  );
  const contact = (c: { nom: string; lien: string; telephone: string }, regler: (v: Partial<{ nom: string; lien: string; telephone: string }>) => void) => (
    <>
      <label className="as-champ"><span>{t('as_contact_nom')}</span><div className="field"><input value={c.nom} onChange={(e) => regler({ nom: e.target.value })} /></div></label>
      <label className="as-champ"><span>{t('as_contact_lien')}</span><div className="field"><input value={c.lien} onChange={(e) => regler({ lien: e.target.value })} /></div></label>
      <label className="as-champ"><span>{t('as_contact_tel')}</span><div className="field"><span className="dialcode">+225</span><input inputMode="tel" value={c.telephone.replace(/^\+225/, '')} onChange={(e) => { const n = e.target.value.replace(/[^0-9]/g, ''); regler({ telephone: n ? `+225${n}` : '' }); }} /></div></label>
    </>
  );

  return (
    <div className="screen page">
      <TopBar onBack={etape > 1 ? () => { setErreur(null); setEtape(etape - 1); } : onBack} title={t('as_title')} />
      <div className="page-body as-page">
        <div className="as-etapes">
          {Array.from({ length: ETAPES }, (_, i) => <span key={i} className={i < etape ? 'on' : ''} />)}
        </div>
        <AvisLangue />
        <span className="eyebrow">{t('as_etape', { n: etape })}</span>
        <h2 className="h-title" style={{ margin: '6px 0 14px' }}>{t(TITRES[etape - 1]!)}</h2>

        {etape === 1 && (
          <div className="as-form">
            <label className="as-champ"><span>{t('as_nom')}</span><div className="field"><input autoComplete="family-name" value={f.identite.nom} onChange={(e) => maj('identite', { nom: e.target.value })} /></div></label>
            <label className="as-champ"><span>{t('as_prenoms')}</span><div className="field"><input autoComplete="given-name" value={f.identite.prenoms} onChange={(e) => maj('identite', { prenoms: e.target.value })} /></div></label>
            <div className="as-ligne">
              <label className="as-champ"><span>{t('as_naissance')}</span><div className="field"><input type="date" max={aujourdhui()} value={f.identite.dateNaissance} onChange={(e) => maj('identite', { dateNaissance: e.target.value })} /></div></label>
              <div className="as-champ"><span>{t('as_sexe')}</span>
                <div className="chips">{(['F', 'M'] as const).map((x) => <button key={x} className={`chip${f.identite.sexe === x ? ' active' : ''}`} onClick={() => maj('identite', { sexe: x })}>{t(x === 'F' ? 'as_f' : 'as_m')}</button>)}</div>
              </div>
            </div>
            <span className="eyebrow" style={{ marginTop: 6 }}>{t('as_piece')}</span>
            <div className="chips">{(['cni', 'passeport'] as const).map((x) => <button key={x} className={`chip${f.piece.type === x ? ' active' : ''}`} onClick={() => maj('piece', { type: x })}>{t(x === 'cni' ? 'as_cni' : 'as_passeport')}</button>)}</div>
            <div className="as-ligne">
              <label className="as-champ"><span>{t('as_numero')}</span><div className="field"><input autoCapitalize="characters" value={f.piece.numero} onChange={(e) => maj('piece', { numero: e.target.value.toUpperCase() })} /></div></label>
              <label className="as-champ"><span>{t('as_expiration')}</span><div className="field"><input type="date" min={aujourdhui()} value={f.piece.expiration} onChange={(e) => maj('piece', { expiration: e.target.value })} /></div></label>
            </div>
            <label className="as-champ"><span>{t('as_cmu')}</span><div className="field"><input inputMode="numeric" value={f.cmu ?? ''} onChange={(e) => setF((x) => ({ ...x, cmu: e.target.value.toUpperCase() }))} /></div></label>
            <span className="eyebrow" style={{ marginTop: 6 }}>{t('as_mutuelle')}</span>
            <div className="as-ligne">
              <div className="field"><input placeholder={t('as_mutuelle_nom')} maxLength={80} value={f.mutuelle?.compagnie ?? ''} onChange={(e) => setF((x) => ({ ...x, mutuelle: { ...x.mutuelle, compagnie: e.target.value } }))} /></div>
              <div className="field"><input placeholder={t('as_mutuelle_num')} maxLength={40} value={f.mutuelle?.numero ?? ''} onChange={(e) => setF((x) => ({ ...x, mutuelle: { ...x.mutuelle, numero: e.target.value.toUpperCase() } }))} /></div>
            </div>
          </div>
        )}

        {etape === 2 && (
          <div className="as-form">
            <span className="eyebrow">{t('as_groupe')}</span>
            <div className="as-groupes">
              {GROUPES_SANGUINS.map((g) => (
                <button key={g} className={`as-groupe${f.sante.groupeSanguin === g ? ' on' : ''}`} onClick={() => maj('sante', { groupeSanguin: g })}>{g === 'inconnu' ? t('as_inconnu') : g}</button>
              ))}
            </div>
            <div className="as-ligne" style={{ marginTop: 6 }}>
              {nombre('poidsKg', 'as_poids', 'kg')}
              {nombre('tailleCm', 'as_taille', 'cm')}
            </div>
            <span className="eyebrow" style={{ marginTop: 10 }}>{t('as_antecedents')}</span>
            {cases(ANTECEDENTS, f.sante.antecedents, 'ant_', (v) => maj('sante', { antecedents: v }))}
            {f.sante.antecedents.includes('diabete') && ouiNon('insuline', 'as_q_insuline')}
            {f.sante.antecedents.includes('grossesse') && (
              <div className="as-question">
                <span>{t('as_q_grossesse')}</span>
                <div className="chips as-mois">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <button key={n} className={`chip${f.sante.grossesseMois === n ? ' active' : ''}`} onClick={() => maj('sante', { grossesseMois: n })}>{n}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {etape === 3 && (
          <div className="as-form">
            {ouiNon('reactionAllergiqueGrave', 'as_q_allergie')}
            <span className="eyebrow" style={{ marginTop: 6 }}>{t('as_allergies_connues')}</span>
            {cases(ALLERGIES, f.sante.allergiesConnues ?? [], 'as_alg_', (v) => maj('sante', { allergiesConnues: v }))}
            {texte('allergies', 'as_allergies')}
            {ouiNon('anticoagulants', 'as_q_anticoag')}
            {texte('traitements', 'as_traitements')}
          </div>
        )}

        {etape === 4 && (
          <div className="as-form">
            {ouiNon('stimulateurCardiaque', 'as_q_pacemaker')}
            {texte('implants', 'as_implants', 200)}
            {ouiNon('hospitalisationRecente', 'as_q_hospitalisation')}
            {texte('chirurgies', 'as_chirurgies')}
            <span className="eyebrow" style={{ marginTop: 6 }}>{t('as_communication')}</span>
            {cases(COMMUNICATION, f.sante.communication ?? [], 'as_com_', (v) => maj('sante', { communication: v }))}
            {texte('langues', 'as_langues', 80)}
            {texte('hopital', 'as_hopital', 80)}
            {texte('consignes', 'as_consignes')}
            {texte('autresAntecedents', 'as_autres')}
          </div>
        )}

        {etape === 5 && (
          <div className="as-form">
            <span className="eyebrow">{t('as_contact_1')}</span>
            {contact(f.urgence, (v) => maj('urgence', v))}
            <span className="eyebrow" style={{ marginTop: 8 }}>{t('as_contact_2')}</span>
            {contact(u2, (v) => setF((x) => ({ ...x, urgence2: { ...u2, ...v } })))}
            <span className="eyebrow" style={{ marginTop: 8 }}>{t('as_medecin')}</span>
            <div className="as-ligne">
              <div className="field"><input placeholder={t('as_nom')} value={f.medecin?.nom ?? ''} onChange={(e) => setF((x) => ({ ...x, medecin: { ...x.medecin, nom: e.target.value } }))} /></div>
              <div className="field"><input inputMode="tel" placeholder={t('as_medecin_tel')} value={f.medecin?.telephone ?? ''} onChange={(e) => setF((x) => ({ ...x, medecin: { ...x.medecin, telephone: e.target.value.replace(/[^0-9+ ]/g, '') } }))} /></div>
            </div>
            <p className="as-garantie"><IconLock size={14} /> {t('as_securite')}</p>
          </div>
        )}

        {erreur && <p className="as-erreur" role="alert">{erreur}</p>}
        <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={envoi} onClick={() => void suivant()}>
          {etape < ETAPES ? t('as_suivant') : envoi ? t('as_enregistrement') : <><IconShieldCheck size={18} /> {t('as_enregistrer')}</>}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Statut */

function Statut({ statut, onBack, onModifier, onProtection, onSupprime, onToast }: {
  statut: StatutAssurance | null; onBack: () => void; onModifier: () => void; onProtection: () => void;
  onSupprime: (s: StatutAssurance) => void; onToast: (m: string, e?: boolean) => void;
}) {
  const { t } = useI18n();
  const protection = modeCoffre();
  const protegeLe = coffreDepuis();
  const [confirmer, setConfirmer] = useState(false);
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('as_title')} />
      <div className="page-body as-page">
        <div className="as-carte-active rise">
          <span className="as-hero-ico"><IconShieldCheck size={30} /></span>
          <div>
            <strong>{t('as_active')}</strong>
            <span>{t('as_depuis', { d: date(statut?.depuis ?? null) })}</span>
          </div>
        </div>
        <p className="as-garantie"><IconLock size={14} /> {t('as_securite')}</p>
        <button className="btn btn-primary" style={{ marginTop: 6 }} onClick={onModifier}><IconMedical size={18} /> {t('as_modifier')}</button>

        {/* Verrou du dossier : comment il s'ouvre dans l'application, et depuis quand. */}
        <span className="eyebrow" style={{ display: 'block', marginTop: 22 }}>{t('as_v_rubrique')}</span>
        <div className="card as-verrou" style={{ marginTop: 8 }}>
          <span className="as-section-ico">{protection === 'empreinte' ? <IconFingerprint size={22} /> : <IconLock size={22} />}</span>
          <span className="col grow" style={{ minWidth: 0, textAlign: 'start' }}>
            <strong>{t(protection === 'empreinte' ? 'as_v_par_empreinte' : protection === 'code' ? 'as_v_par_code' : 'as_v_aucune')}</strong>
            <small className="faint">{protection && protegeLe ? t('as_v_depuis', { d: date(protegeLe) }) : t('as_v_aucune_d')}</small>
          </span>
          <button className="btn btn-ghost" style={{ width: 'auto', flex: 'none', padding: '10px 14px', fontSize: 13 }} onClick={protection ? onProtection : onModifier}>
            {t(protection ? 'as_v_changer' : 'as_v_proteger')}
          </button>
        </div>

        <span className="eyebrow" style={{ display: 'block', marginTop: 22 }}>{t('as_consultations')}</span>
        <div className="card" style={{ padding: 14, marginTop: 8 }}>
          {statut?.consultations.length
            ? statut.consultations.map((c) => (
              <p key={c.le} className="as-consultation"><IconShieldCheck size={14} /> {t('as_consulte', { par: c.par, le: new Date(c.le).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
            ))
            : <p className="faint" style={{ margin: 0, fontSize: 13 }}>{t('as_aucune')}</p>}
        </div>

        {!confirmer
          ? <button className="btn set-supprimer" style={{ marginTop: 22 }} onClick={() => setConfirmer(true)}>{t('as_supprimer')}</button>
          : (
            <div className="card set-confirmation" style={{ marginTop: 22 }}>
              <p style={{ marginTop: 0 }}>{t('as_supprimer_conf')}</p>
              <button className="btn btn-danger" onClick={() => void supprimerDossierAssurance().then((r) => (typeof r === 'string' ? onToast(r, true) : onSupprime(r)))}>{t('as_supprimer_oui')}</button>
              <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setConfirmer(false)}>{t('as_precedent')}</button>
            </div>
          )}
      </div>
    </div>
  );
}

/**
 * Textes médicaux et juridiques non encore validés par un traducteur assermenté dans
 * cette langue : on le dit au client, dans sa langue, plutôt que de le laisser deviner
 * pourquoi l'écran est en français.
 */
function AvisLangue() {
  const { t, lang } = useI18n();
  if (lang === 'fr' || lang === 'en') return null;
  return <p className="as-avis-langue" role="note"><IconGlobe size={14} /> {t('as_langue_note')}</p>;
}
