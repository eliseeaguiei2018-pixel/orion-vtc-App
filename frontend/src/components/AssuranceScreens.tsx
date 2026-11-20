import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { TopBar } from './ui';
import { IconCheck, IconGlobe, IconLock, IconMedical, IconPhone, IconShieldCheck, IconUsers, IconWallet } from '../icons';
import {
  modeLocal,
  ANTECEDENTS, GROUPES_SANGUINS, enregistrerDossierAssurance, lireDossierAssurance, statutAssurance, supprimerDossierAssurance,
  type FicheMedicale, type StatutAssurance,
} from '../api';

/**
 * ORION ASSURANCE (app cliente).
 *
 * 1. PRÉSENTATION : le client lit à quoi sert le service, pourquoi c'est important, qui
 *    peut voir ses informations et comment elles sont protégées. Le bouton d'inscription
 *    ne s'active qu'après lecture jusqu'au bout et double consentement.
 * 2. DOSSIER en trois étapes : identité et pièce, santé, personne à prévenir.
 * 3. STATUT : protection active, et chaque ouverture du dossier par le SAMU.
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

  const ouvrirDossier = async () => {
    const r = await lireDossierAssurance();
    if (typeof r === 'string') { onToast(r, true); return; }
    if (r.fiche) setFiche(r.fiche);
    setMode('formulaire');
  };

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
    }} onToast={onToast} />;
  }
  return <Statut statut={statut} onBack={onBack} onModifier={() => void ouvrirDossier()} onSupprime={(s) => {
    setStatut(s); setFiche(VIDE); setMode('presentation'); onChange?.(false); onToast(t('as_supprime'));
  }} onToast={onToast} />;
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

  const valide = (): string | null => {
    if (etape === 1) {
      const { nom, prenoms, dateNaissance } = f.identite;
      if (nom.trim().length < 2 || prenoms.trim().length < 2 || !dateNaissance || f.piece.numero.trim().length < 6 || !f.piece.expiration) return t('as_err_requis');
      if (f.piece.expiration < aujourdhui()) return t('as_err_expiree');
    }
    if (etape === 3) {
      if (f.urgence.nom.trim().length < 2 || f.urgence.lien.trim().length < 2 || !/^\+?[0-9]{8,15}$/.test(f.urgence.telephone.replace(/[\s.-]/g, ''))) return t('as_err_requis');
    }
    return null;
  };
  const suivant = async () => {
    const e = valide();
    setErreur(e);
    if (e) return;
    if (etape < 3) { setEtape(etape + 1); return; }
    setEnvoi(true);
    const propre: FicheMedicale = {
      ...f,
      cmu: f.cmu?.trim() || undefined,
      medecin: f.medecin?.nom?.trim() || f.medecin?.telephone?.trim() ? { nom: f.medecin?.nom?.trim() || undefined, telephone: f.medecin?.telephone?.trim() || undefined } : undefined,
      sante: { ...f.sante, allergies: f.sante.allergies?.trim() || undefined, traitements: f.sante.traitements?.trim() || undefined, autresAntecedents: f.sante.autresAntecedents?.trim() || undefined },
    };
    const r = await enregistrerDossierAssurance(propre);
    setEnvoi(false);
    if (typeof r === 'string') { setErreur(r); onToast(r, true); return; }
    onEnregistre(r);
  };

  const ouiNon = (cle: 'anticoagulants' | 'stimulateurCardiaque' | 'reactionAllergiqueGrave', question: string) => (
    <div className="as-question">
      <span>{t(question)}</span>
      <div className="chips">
        {[true, false].map((v) => (
          <button key={String(v)} className={`chip${f.sante[cle] === v ? ' active' : ''}`} onClick={() => maj('sante', { [cle]: v })}>{t(v ? 'as_oui' : 'as_non')}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="screen page">
      <TopBar onBack={etape > 1 ? () => setEtape(etape - 1) : onBack} title={t('as_title')} />
      <div className="page-body as-page">
        <div className="as-etapes">
          {[1, 2, 3].map((n) => <span key={n} className={n <= etape ? 'on' : ''} />)}
        </div>
        <AvisLangue />
        <span className="eyebrow">{t('as_etape', { n: etape })}</span>
        <h2 className="h-title" style={{ margin: '6px 0 14px' }}>{t(etape === 1 ? 'as_identite' : etape === 2 ? 'as_sante' : 'as_urgence')}</h2>

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
            <span className="eyebrow" style={{ marginTop: 10 }}>{t('as_antecedents')}</span>
            <div className="as-antecedents">
              {ANTECEDENTS.map((a) => {
                const on = f.sante.antecedents.includes(a);
                return (
                  <button key={a} className={`as-antecedent${on ? ' on' : ''}`} onClick={() => maj('sante', { antecedents: on ? f.sante.antecedents.filter((x) => x !== a) : [...f.sante.antecedents, a] })}>
                    <span className="as-coche"><IconCheck size={13} /></span>{t(`ant_${a}`)}
                  </button>
                );
              })}
            </div>
            {ouiNon('anticoagulants', 'as_q_anticoag')}
            {ouiNon('stimulateurCardiaque', 'as_q_pacemaker')}
            {ouiNon('reactionAllergiqueGrave', 'as_q_allergie')}
            <label className="as-champ"><span>{t('as_allergies')}</span><div className="field"><input value={f.sante.allergies ?? ''} maxLength={300} onChange={(e) => maj('sante', { allergies: e.target.value })} /></div></label>
            <label className="as-champ"><span>{t('as_traitements')}</span><div className="field"><input value={f.sante.traitements ?? ''} maxLength={300} onChange={(e) => maj('sante', { traitements: e.target.value })} /></div></label>
            <label className="as-champ"><span>{t('as_autres')}</span><div className="field"><input value={f.sante.autresAntecedents ?? ''} maxLength={300} onChange={(e) => maj('sante', { autresAntecedents: e.target.value })} /></div></label>
          </div>
        )}

        {etape === 3 && (
          <div className="as-form">
            <label className="as-champ"><span>{t('as_contact_nom')}</span><div className="field"><input value={f.urgence.nom} onChange={(e) => maj('urgence', { nom: e.target.value })} /></div></label>
            <label className="as-champ"><span>{t('as_contact_lien')}</span><div className="field"><input value={f.urgence.lien} onChange={(e) => maj('urgence', { lien: e.target.value })} /></div></label>
            <label className="as-champ"><span>{t('as_contact_tel')}</span><div className="field"><span className="dialcode">+225</span><input inputMode="tel" value={f.urgence.telephone.replace(/^\+225/, '')} onChange={(e) => maj('urgence', { telephone: `+225${e.target.value.replace(/[^0-9 ]/g, '')}` })} /></div></label>
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
          {etape < 3 ? t('as_suivant') : envoi ? t('as_enregistrement') : <><IconShieldCheck size={18} /> {t('as_enregistrer')}</>}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Statut */

function Statut({ statut, onBack, onModifier, onSupprime, onToast }: {
  statut: StatutAssurance | null; onBack: () => void; onModifier: () => void; onSupprime: (s: StatutAssurance) => void; onToast: (m: string, e?: boolean) => void;
}) {
  const { t } = useI18n();
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
