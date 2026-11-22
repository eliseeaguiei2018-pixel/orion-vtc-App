import { useState, type ReactNode } from 'react';
import { TopBar } from './ui';
import { useI18n } from '../i18n';
import { formatXOF } from '../data';
import { clientId, modeLocal, openSupport } from '../api';
import { partager } from '../partage';
import { lienTel } from '../telephone';
import { Objet } from './Vehicules';
import {
  IconBriefcase, IconCheck, IconChevron, IconFingerprint, IconInfo, IconMessage, IconPhone, IconPlus, IconShare, IconShieldCheck, IconStar,
  IconSteering, IconUser, IconUsers,
} from '../icons';
import {
  OFFRE_PARRAINAGE, codeParrainage, codeParrainageValide, contacts as lireContacts, coursesPro, demande, enregistrerContact, enregistrerGroupe,
  enregistrerParrain, enregistrerProche, enregistrerProfilPro, famille as lireFamille, formatCodeParrainage, groupes as lireGroupes, lienSms,
  noterDemande, parrainSaisi, profilPro, relevePro, retirerContact, retirerGroupe, retirerProche, telephoneValide,
  type Contact, type Groupe, type Proche, type ProfilPro, type Tranche,
} from '../compte';

/**
 * ÉCRANS DU VOLET COMPTE (version 1.5.7) : contrôle de sécurité, parrainage, famille,
 * contacts, groupes, profil professionnel, offre entreprise, candidature chauffeur.
 *
 * Même registre que le menu : icônes au trait, sans couleur, groupes de lignes. Les données
 * restent sur le téléphone (compte.ts) ; les demandes à ORION passent par le support.
 */
const T = 1.9;
type Toast = (m: string, erreur?: boolean) => void;
const jour = (iso: string, langue: string) => new Date(iso).toLocaleDateString(langue, { day: 'numeric', month: 'long', year: 'numeric' });

/** Anneau d'avancement « n/total » : un trait continu, proportionnel à ce qui est fait. */
export function Anneau({ fait, total, taille = 64 }: { fait: number; total: number; taille?: number }) {
  const r = 26; const tour = 2 * Math.PI * r;
  return (
    <span className="anneau" style={{ width: taille, height: taille }} role="img" aria-label={`${fait} / ${total}`}>
      <svg viewBox="0 0 64 64" width={taille} height={taille}>
        <circle cx="32" cy="32" r={r} className="anneau-piste" />
        {fait > 0 && <circle cx="32" cy="32" r={r} className="anneau-fait" strokeDasharray={`${(tour * fait) / Math.max(1, total)} ${tour}`} transform="rotate(-90 32 32)" />}
      </svg>
      <b>{fait}<small>/{total}</small></b>
    </span>
  );
}

function Page({ titre, onBack, children }: { titre: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="screen page sans-couleur">
      <TopBar onBack={onBack} title={titre} />
      <div className="page-body compte-page">{children}</div>
    </div>
  );
}
const Champ = ({ libelle, children }: { libelle: string; children: ReactNode }) => (
  <label className="as-champ"><span>{libelle}</span><div className="field">{children}</div></label>
);
const numeroSaisi = (v: string) => v.replace(/[^0-9+ ]/g, '').slice(0, 17);

/* ====================== CONTRÔLE DE SÉCURITÉ ====================== */

export interface EtapeSecurite { cle: 'contact' | 'partage' | 'verrou' | 'assurance'; fait: boolean; onAction: () => void }

export function ControleSecuriteScreen({ etapes, onBack }: { etapes: EtapeSecurite[]; onBack: () => void }) {
  const { t } = useI18n();
  const fait = etapes.filter((e) => e.fait).length;
  const icone = { contact: <IconUser size={24} strokeWidth={T} />, partage: <IconShare size={24} strokeWidth={T} />, verrou: <IconFingerprint size={24} strokeWidth={T} />, assurance: <IconShieldCheck size={24} strokeWidth={T} /> };
  return (
    <Page titre={t('cpt_controle_t')} onBack={onBack}>
      <div className="controle-tete">
        <Anneau fait={fait} total={etapes.length} taille={92} />
        <p>{fait === etapes.length ? t('ctl_complet') : t('ctl_sous', { n: fait, t: etapes.length })}</p>
      </div>
      <div className="menu-groupe">
        {etapes.map((e) => (
          <button key={e.cle} className="menu-ligne" onClick={e.onAction}>
            <span className="menu-ico">{icone[e.cle]}</span>
            <span className="menu-texte"><strong>{t(`ctl_${e.cle}`)}</strong><small>{t(`ctl_${e.cle}_d`)}</small></span>
            {e.fait
              ? <span className="etat-fait"><IconCheck size={14} strokeWidth={3} /> {t('ctl_fait')}</span>
              : <span className="etat-a-faire">{t('ctl_faire')}</span>}
          </button>
        ))}
      </div>
    </Page>
  );
}

/* =========================== PARRAINAGE =========================== */

export function ParrainageScreen({ onBack, onToast }: { onBack: () => void; onToast: Toast }) {
  const { t } = useI18n();
  const code = codeParrainage(clientId());
  const [ami, setAmi] = useState('');
  const [saisi, setSaisi] = useState(parrainSaisi());
  const [erreur, setErreur] = useState<string | null>(null);
  const offre = { m: formatXOF(OFFRE_PARRAINAGE.remise), n: OFFRE_PARRAINAGE.courses };
  const copier = async () => {
    try { await navigator.clipboard.writeText(code); onToast(t('par_copie')); } catch { onToast(code); }
  };
  const inviter = async () => {
    const issue = await partager('ORION', t('par_message', { code, ...offre }), 'https://orion.ci');
    if (issue === 'copie') onToast(t('par_copie'));
  };
  const valider = () => {
    const v = formatCodeParrainage(ami);
    if (!codeParrainageValide(v)) { setErreur(t('par_invalide')); return; }
    if (v === code) { setErreur(t('par_soi')); return; }
    enregistrerParrain(v); setSaisi(v); setErreur(null); setAmi(''); onToast(t('par_ok', { code: v }));
  };
  return (
    <Page titre={t('par_titre')} onBack={onBack}>
      <div className="parrain-tete">
        <span className="parrain-objet"><Objet nom="cadeau" taille={132} volume /></span>
        <h2 className="h-title">{t('cpt_inviter_t')}</h2>
        <p className="h-sub">{t('par_offre', offre)}</p>
      </div>
      <div className="card parrain-code">
        <span className="faint">{t('par_code')}</span>
        <strong className="num">{code}</strong>
        <button className="btn btn-ghost" style={{ width: 'auto', padding: '10px 16px', fontSize: 14 }} onClick={() => void copier()}>{t('par_copier')}</button>
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => void inviter()}><IconShare size={18} /> {t('par_inviter')}</button>

      <span className="eyebrow" style={{ display: 'block', marginTop: 26 }}>{t('par_saisir')}</span>
      {saisi
        ? <p className="etat-ligne"><IconCheck size={16} strokeWidth={2.6} /> {t('par_deja', { code: saisi })}</p>
        : (
          <div className="row gap-sm" style={{ marginTop: 10 }}>
            <div className="field grow" style={{ minWidth: 0 }}>
              <input value={ami} placeholder="ORION-XXXXXX" aria-label={t('par_champ')} autoCapitalize="characters" maxLength={12}
                onChange={(e) => { setAmi(formatCodeParrainage(e.target.value)); setErreur(null); }} />
            </div>
            <button className="btn btn-ghost" style={{ width: 'auto', flex: 'none', padding: '12px 16px', fontSize: 14 }} disabled={ami.length < 8} onClick={valider}>{t('par_valider')}</button>
          </div>
        )}
      {erreur && <p className="as-erreur" role="alert">{erreur}</p>}
      <p className="note-info"><IconInfo size={14} /> <span>{t('par_note')}</span></p>
    </Page>
  );
}

/* ============================ CONTACTS ============================ */

export function ContactsScreen({ onBack, onConfiance }: {
  onBack: () => void;
  /** Le contact de confiance a changé : il sert au partage automatique et aux alertes. */
  onConfiance: (c: { name: string; phone: string } | null) => void;
}) {
  const { t } = useI18n();
  const [liste, setListe] = useState<Contact[]>(lireContacts);
  const [ajout, setAjout] = useState(liste.length === 0);
  const [nom, setNom] = useState(''); const [tel, setTel] = useState('');
  const [erreur, setErreur] = useState(false);
  const suite = (l: Contact[]) => {
    setListe(l);
    const c = l.find((x) => x.confiance);
    onConfiance(c ? { name: c.nom, phone: c.telephone } : null);
  };
  const ajouter = () => {
    if (nom.trim().length < 2 || !telephoneValide(tel)) { setErreur(true); return; }
    // Le premier contact devient le contact de confiance : c'est lui que le partage prévient.
    suite(enregistrerContact({ nom, telephone: tel, confiance: !liste.some((c) => c.confiance) }));
    setNom(''); setTel(''); setErreur(false); setAjout(false);
  };
  return (
    <Page titre={t('cpt_contacts')} onBack={onBack}>
      <p className="h-sub compte-intro">{t('ctc_sous')}</p>
      {liste.length === 0 && !ajout && <p className="faint compte-vide">{t('ctc_vide')}</p>}
      {liste.length > 0 && (
        <div className="menu-groupe">
          {liste.map((c) => (
            <div key={c.id} className="menu-ligne statique contact-ligne">
              <span className="menu-ico"><IconUser size={25} strokeWidth={T} /></span>
              <span className="menu-texte">
                <strong>{c.nom}</strong>
                <small>{c.telephone}{c.confiance ? ` · ${t('ctc_confiance')}` : ''}</small>
                <span className="contact-actions">
                  <a className="lien-action" href={lienTel(c.telephone) ?? undefined}><IconPhone size={15} /> {t('ctc_appeler')}</a>
                  <a className="lien-action" href={lienSms([c.telephone], '')}><IconMessage size={15} /> {t('ctc_ecrire')}</a>
                  {!c.confiance && <button className="lien-action" onClick={() => suite(enregistrerContact({ ...c, confiance: true }))}><IconStar size={15} /> {t('ctc_definir')}</button>}
                  <button className="lien-action" onClick={() => suite(retirerContact(c.id))}>{t('fam_retirer')}</button>
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      {ajout ? (
        <div className="as-form compte-form">
          <Champ libelle={t('fam_nom')}><input value={nom} maxLength={60} autoComplete="off" onChange={(e) => setNom(e.target.value)} /></Champ>
          <Champ libelle={t('fam_tel')}><input inputMode="tel" value={tel} placeholder="07 00 00 00 00" onChange={(e) => setTel(numeroSaisi(e.target.value))} /></Champ>
          {erreur && <p className="as-erreur" role="alert">{t('fam_err')}</p>}
          <button className="btn btn-primary" onClick={ajouter}>{t('fam_enregistrer')}</button>
        </div>
      ) : (
        <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => setAjout(true)}><IconPlus size={18} /> {t('ctc_ajouter')}</button>
      )}
    </Page>
  );
}

/* ============================= GROUPES ============================= */

export function GroupesScreen({ onBack, onContacts }: { onBack: () => void; onContacts: () => void }) {
  const { t } = useI18n();
  const carnet = lireContacts();
  const [liste, setListe] = useState<Groupe[]>(lireGroupes);
  const [creation, setCreation] = useState(false);
  const [nom, setNom] = useState(''); const [membres, setMembres] = useState<string[]>([]);
  const [erreur, setErreur] = useState(false);
  const creer = () => {
    if (nom.trim().length < 2 || membres.length < 2) { setErreur(true); return; }
    setListe(enregistrerGroupe({ nom, membres })); setNom(''); setMembres([]); setErreur(false); setCreation(false);
  };
  const numeros = (g: Groupe) => g.membres.map((id) => carnet.find((c) => c.id === id)?.telephone).filter((x): x is string => Boolean(x));
  return (
    <Page titre={t('cpt_groupes')} onBack={onBack}>
      <p className="h-sub compte-intro">{t('grp_sous')}</p>
      {carnet.length < 2 && (
        <>
          <p className="faint compte-vide">{t('grp_vide')}</p>
          <button className="btn btn-ghost" onClick={onContacts}><IconPlus size={18} /> {t('ctc_ajouter')}</button>
        </>
      )}
      {liste.length > 0 && (
        <div className="menu-groupe">
          {liste.map((g) => (
            <div key={g.id} className="menu-ligne statique contact-ligne">
              <span className="menu-ico"><IconUsers size={25} strokeWidth={T} /></span>
              <span className="menu-texte">
                <strong>{g.nom}</strong>
                <small>{t('grp_membres', { n: numeros(g).length })} · {g.membres.map((id) => carnet.find((c) => c.id === id)?.nom).filter(Boolean).join(', ')}</small>
                <span className="contact-actions">
                  <a className="lien-action" href={lienSms(numeros(g), t('grp_sms'))}><IconMessage size={15} /> {t('grp_ecrire')}</a>
                  <button className="lien-action" onClick={() => setListe(retirerGroupe(g.id))}>{t('fam_retirer')}</button>
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      {carnet.length >= 2 && (creation ? (
        <div className="as-form compte-form">
          <Champ libelle={t('grp_nom')}><input value={nom} maxLength={40} onChange={(e) => setNom(e.target.value)} /></Champ>
          <span className="eyebrow">{t('grp_choisir')}</span>
          <div className="as-antecedents">
            {carnet.map((c) => {
              const on = membres.includes(c.id);
              return (
                <button key={c.id} className={`as-antecedent${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setMembres(on ? membres.filter((x) => x !== c.id) : [...membres, c.id])}>
                  <span className="as-coche"><IconCheck size={13} /></span>{c.nom}
                </button>
              );
            })}
          </div>
          {erreur && <p className="as-erreur" role="alert">{t('grp_err')}</p>}
          <button className="btn btn-primary" onClick={creer}>{t('fam_enregistrer')}</button>
        </div>
      ) : (
        <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => setCreation(true)}><IconPlus size={18} /> {t('grp_nouveau')}</button>
      ))}
    </Page>
  );
}

/* ============================= FAMILLE ============================= */

export function FamilleScreen({ onBack, onCommander }: { onBack: () => void; onCommander: (p: Proche) => void }) {
  const { t } = useI18n();
  const [liste, setListe] = useState<Proche[]>(lireFamille);
  const [ajout, setAjout] = useState(liste.length === 0);
  const [nom, setNom] = useState(''); const [tel, setTel] = useState(''); const [lien, setLien] = useState('');
  const [tranche, setTranche] = useState<Tranche>('adulte');
  const [erreur, setErreur] = useState(false);
  const ajouter = () => {
    if (nom.trim().length < 2 || !telephoneValide(tel)) { setErreur(true); return; }
    setListe(enregistrerProche({ nom, telephone: tel, tranche, lien: lien.trim() || undefined }));
    setNom(''); setTel(''); setLien(''); setTranche('adulte'); setErreur(false); setAjout(false);
  };
  return (
    <Page titre={t('cpt_famille')} onBack={onBack}>
      <p className="h-sub compte-intro">{t('fam_sous')}</p>
      {liste.length === 0 && !ajout && <p className="faint compte-vide">{t('fam_vide')}</p>}
      {liste.length > 0 && (
        <div className="menu-groupe">
          {liste.map((p) => (
            <div key={p.id} className="menu-ligne statique contact-ligne">
              <span className="menu-ico"><IconUser size={25} strokeWidth={T} /></span>
              <span className="menu-texte">
                <strong>{p.nom}</strong>
                <small>{t(`fam_${p.tranche}`)}{p.lien ? ` · ${p.lien}` : ''} · {p.telephone}</small>
                <span className="contact-actions">
                  <button className="lien-action fort" onClick={() => onCommander(p)}>{t('fam_commander', { nom: p.nom.split(' ')[0] ?? p.nom })} <IconChevron size={14} /></button>
                  <button className="lien-action" onClick={() => setListe(retirerProche(p.id))}>{t('fam_retirer')}</button>
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      {ajout ? (
        <div className="as-form compte-form">
          <Champ libelle={t('fam_nom')}><input value={nom} maxLength={60} autoComplete="off" onChange={(e) => setNom(e.target.value)} /></Champ>
          <Champ libelle={t('fam_tel')}><input inputMode="tel" value={tel} placeholder="07 00 00 00 00" onChange={(e) => setTel(numeroSaisi(e.target.value))} /></Champ>
          <Champ libelle={t('fam_lien')}><input value={lien} maxLength={30} onChange={(e) => setLien(e.target.value)} /></Champ>
          <div className="chips">
            {(['ado', 'adulte', 'senior'] as const).map((x) => (
              <button key={x} className={`chip${tranche === x ? ' active' : ''}`} onClick={() => setTranche(x)}>{t(`fam_${x}`)}</button>
            ))}
          </div>
          {erreur && <p className="as-erreur" role="alert">{t('fam_err')}</p>}
          <button className="btn btn-primary" onClick={ajouter}>{t('fam_enregistrer')}</button>
        </div>
      ) : (
        <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => setAjout(true)}><IconPlus size={18} /> {t('fam_ajouter')}</button>
      )}
    </Page>
  );
}

/* ====================== PROFIL PROFESSIONNEL ====================== */

export function BusinessScreen({ onBack, onToast }: { onBack: () => void; onToast: Toast }) {
  const { t, lang } = useI18n();
  const [profil, setProfil] = useState<ProfilPro | null>(profilPro);
  const [f, setF] = useState<ProfilPro>(profil ?? { societe: '', email: '', nif: '', motifObligatoire: false });
  const [erreur, setErreur] = useState(false);
  const courses = coursesPro();
  const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const duMois = courses.filter((c) => Date.parse(c.le) >= debutMois);
  const total = duMois.reduce((s, c) => s + c.montant, 0);
  const enregistrer = () => {
    if (f.societe.trim().length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) { setErreur(true); return; }
    enregistrerProfilPro(f); setProfil(profilPro()); setErreur(false); onToast(t('pro_ok'));
  };
  const exporter = async () => {
    const issue = await partager(t('cpt_pro_tableau'), relevePro(courses), '');
    if (issue === 'copie') onToast(t('pro_copie'));
  };
  return (
    <Page titre={t('cpt_pro_tableau')} onBack={onBack}>
      {profil && (
        <>
          <span className="eyebrow">{t('pro_tableau')}</span>
          <div className="pro-chiffres">
            <div><span>{t('pro_mois')}</span><strong className="num">{formatXOF(total)}</strong></div>
            <div><span>{t('pro_courses')}</span><strong className="num">{duMois.length}</strong></div>
          </div>
          {courses.length === 0
            ? <p className="faint compte-vide">{t('pro_vide')}</p>
            : (
              <>
                <div className="menu-groupe">
                  {courses.slice(0, 30).map((c) => (
                    <div key={c.id} className="menu-ligne statique">
                      <span className="menu-ico"><IconBriefcase size={24} strokeWidth={T} /></span>
                      <span className="menu-texte"><strong>{c.trajet}</strong><small>{jour(c.le, lang)}{c.motif ? ` · ${c.motif}` : ''}</small></span>
                      <span className="num pro-montant">{formatXOF(c.montant)}</span>
                    </div>
                  ))}
                </div>
                <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => void exporter()}><IconShare size={18} /> {t('pro_exporter')}</button>
              </>
            )}
        </>
      )}
      <span className="eyebrow" style={{ display: 'block', marginTop: profil ? 26 : 0 }}>{t('pro_profil')}</span>
      <div className="as-form compte-form">
        <Champ libelle={t('pro_societe')}><input value={f.societe} maxLength={80} onChange={(e) => setF({ ...f, societe: e.target.value })} /></Champ>
        <Champ libelle={t('pro_email')}><input type="email" inputMode="email" autoCapitalize="none" value={f.email} maxLength={120} onChange={(e) => setF({ ...f, email: e.target.value })} /></Champ>
        <Champ libelle={t('pro_nif')}><input value={f.nif ?? ''} maxLength={30} onChange={(e) => setF({ ...f, nif: e.target.value.toUpperCase() })} /></Champ>
        <div className="opt">
          <span className="col grow" style={{ textAlign: 'start' }}><strong style={{ fontSize: 14 }}>{t('pro_motif_oblig')}</strong></span>
          <button className={`toggle${f.motifObligatoire ? ' on' : ''}`} role="switch" aria-checked={f.motifObligatoire} aria-label={t('pro_motif_oblig')} onClick={() => setF({ ...f, motifObligatoire: !f.motifObligatoire })}><span /></button>
        </div>
        {erreur && <p className="as-erreur" role="alert">{t('pro_err')}</p>}
        <button className="btn btn-primary" onClick={enregistrer}>{t('fam_enregistrer')}</button>
        {profil && <button className="btn btn-ghost" onClick={() => { enregistrerProfilPro(null); setProfil(null); setF({ societe: '', email: '', nif: '', motifObligatoire: false }); }}>{t('pro_retirer')}</button>}
      </div>
      <p className="note-info"><IconInfo size={14} /> <span>{t('pro_note')}</span></p>
    </Page>
  );
}

/* ================== DEMANDES ENVOYÉES À ORION ================== */

/** Liste d'atouts, formulaire court, envoi au support ORION, puis trace de la demande. */
function DemandeOrion({ quoi, titre, atouts, icone, onBack, onToast, champs, composer, valide }: {
  quoi: 'chauffeur' | 'entreprise'; titre: string; atouts: string[]; icone: ReactNode; onBack: () => void; onToast: Toast;
  champs: ReactNode; composer: () => { sujet: string; texte: string }; valide: () => boolean;
}) {
  const { t, lang } = useI18n();
  const [trace, setTrace] = useState(() => demande(quoi));
  const [erreur, setErreur] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const envoyer = async () => {
    if (!valide()) { setErreur(true); return; }
    setErreur(false); setEnvoi(true);
    const { sujet, texte } = composer();
    const r = await openSupport(clientId(), texte, sujet);
    setEnvoi(false);
    if (!r) { onToast(t('dem_echec'), true); return; }
    noterDemande(quoi, sujet); setTrace(demande(quoi)); onToast(t('dem_ok'));
  };
  return (
    <Page titre={titre} onBack={onBack}>
      <div className="demande-tete"><span className="menu-ico grand">{icone}</span><h2 className="h-title">{titre}</h2></div>
      <ul className="atouts">{atouts.map((a) => <li key={a}><IconCheck size={16} strokeWidth={2.6} /> <span>{a}</span></li>)}</ul>
      {trace
        ? <p className="etat-ligne"><IconCheck size={16} strokeWidth={2.6} /> {t('dem_envoyee', { d: jour(trace.le, lang) })}</p>
        : (
          <div className="as-form compte-form">
            {champs}
            {erreur && <p className="as-erreur" role="alert">{t('dem_err')}</p>}
            <button className="btn btn-primary" disabled={envoi} onClick={() => void envoyer()}>{t('dem_envoyer')}</button>
          </div>
        )}
      {modeLocal() && <p className="note-info"><IconInfo size={14} /> <span>{t('dem_local')}</span></p>}
    </Page>
  );
}

export function RevenusScreen({ nom, telephone, onBack, onToast }: { nom: string; telephone: string; onBack: () => void; onToast: Toast }) {
  const { t } = useI18n();
  const [type, setType] = useState<'voiture' | 'moto'>('voiture');
  const [commune, setCommune] = useState('');
  return (
    <DemandeOrion quoi="chauffeur" titre={t('rev_titre')} icone={<IconSteering size={30} strokeWidth={T} />} onBack={onBack} onToast={onToast}
      atouts={[t('rev_1'), t('rev_2'), t('rev_3')]}
      valide={() => commune.trim().length >= 2}
      composer={() => ({
        sujet: 'Candidature chauffeur',
        texte: `Candidature ${type === 'voiture' ? 'chauffeur (voiture)' : 'livreur (moto)'} — ${nom || 'sans nom'}, ${telephone || 'numéro non renseigné'}, commune : ${commune.trim()}.`,
      })}
      champs={(
        <>
          <span className="eyebrow">{t('rev_type')}</span>
          <div className="chips">
            {(['voiture', 'moto'] as const).map((x) => <button key={x} className={`chip${type === x ? ' active' : ''}`} onClick={() => setType(x)}>{t(`rev_${x}`)}</button>)}
          </div>
          <Champ libelle={t('rev_commune')}><input value={commune} maxLength={40} placeholder="Cocody, Yopougon…" onChange={(e) => setCommune(e.target.value)} /></Champ>
        </>
      )} />
  );
}

export function EntrepriseScreen({ nom, telephone, onBack, onToast }: { nom: string; telephone: string; onBack: () => void; onToast: Toast }) {
  const { t } = useI18n();
  const [societe, setSociete] = useState(profilPro()?.societe ?? '');
  const [effectif, setEffectif] = useState('');
  return (
    <DemandeOrion quoi="entreprise" titre={t('ent_titre')} icone={<IconBriefcase size={30} strokeWidth={T} />} onBack={onBack} onToast={onToast}
      atouts={[t('ent_1'), t('ent_2'), t('ent_3')]}
      valide={() => societe.trim().length >= 2}
      composer={() => ({
        sujet: 'Compte entreprise',
        texte: `Demande de compte entreprise — société : ${societe.trim()}, collaborateurs : ${effectif || 'non précisé'}. Contact : ${nom || 'sans nom'}, ${telephone || 'numéro non renseigné'}.`,
      })}
      champs={(
        <>
          <Champ libelle={t('pro_societe')}><input value={societe} maxLength={80} onChange={(e) => setSociete(e.target.value)} /></Champ>
          <Champ libelle={t('ent_effectif')}><input inputMode="numeric" value={effectif} maxLength={5} onChange={(e) => setEffectif(e.target.value.replace(/\D/g, ''))} /></Champ>
        </>
      )} />
  );
}
