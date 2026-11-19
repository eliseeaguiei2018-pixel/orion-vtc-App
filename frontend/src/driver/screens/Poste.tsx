import { useEffect, useState } from 'react';
import { IconPhone, IconShield, IconUsers } from '../../icons';
import { lienTel, numeroLisible } from '../../telephone';
import type { ScreenProps } from '../Driver';
import type { MessagesChef, Poste as PosteData, RequeteVue } from '../types';
import { Banner, BellButton, PageHeader, Progress, Section, Stat } from '../ui';
import { dateTime, fcfa, shortDate } from '../format';
import { tr } from '../i18n';

type Onglet = 'activite' | 'demandes' | 'messages';

/**
 * MON POSTE — le même poste que dans la console ORION (compte chauffeur) : activité
 * sur 30 jours, argent (solde, dette espèces, reste dû), équipe et chef à appeler,
 * requêtes (prêt, avance, congé…) qui suivent le circuit chef → direction financière
 * → trésorerie, messages et rapports demandés par le chef d'équipe.
 */
export function Poste({ app, unread, openNotices }: ScreenProps) {
  const [onglet, setOnglet] = useState<Onglet>('activite');
  const [poste, setPoste] = useState<PosteData | null>(null);
  const [msgs, setMsgs] = useState<MessagesChef | null>(null);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    void app.backend.poste().then((p) => { setPoste(p); setErreur(false); }).catch(() => setErreur(true));
    void app.backend.messages().then(setMsgs).catch(() => undefined);
  }, [app.backend, app.posteVersion]);

  const nonLus = msgs?.nonLus ?? poste?.messagesNonLus ?? 0;
  return (
    <div className="dv-page">
      <PageHeader title={tr('Mon poste')} sub={poste?.equipe ? `${poste.equipe.name}${poste.equipe.chef ? tr(' · chef : {0}', [poste.equipe.chef]) : ''}` : tr('Activité, demandes et messages')} right={<BellButton count={unread} onClick={openNotices} />} />
      <div className="dv-seg" role="tablist">
        <button className={onglet === 'activite' ? 'on' : ''} onClick={() => setOnglet('activite')}>{tr('Activité')}</button>
        <button className={onglet === 'demandes' ? 'on' : ''} onClick={() => setOnglet('demandes')}>{tr('Demandes')}</button>
        <button className={onglet === 'messages' ? 'on' : ''} onClick={() => setOnglet('messages')}>{nonLus > 0 ? tr('Messages ({0})', [nonLus]) : tr('Messages')}</button>
      </div>
      {erreur && <div className="dv-empty">{tr('Poste indisponible — vérifiez votre connexion.')}</div>}
      {poste && onglet === 'activite' && <Activite app={app} poste={poste} />}
      {poste && onglet === 'demandes' && <Demandes app={app} poste={poste} />}
      {onglet === 'messages' && <Messages app={app} msgs={msgs} />}
    </div>
  );
}

function Activite({ app, poste }: { app: ScreenProps['app']; poste: PosteData }) {
  const a = poste.activite;
  const g = poste.argent;
  const chef = poste.equipe?.chefTelephone ? lienTel(poste.equipe.chefTelephone) : null;
  return (
    <>
      {poste.alertes.map((x, i) => (
        <Banner key={i} tone={x.severite === 'critique' ? 'danger' : 'warn'} icon={<IconShield size={18} />} title={tr('Point d’attention')}>{x.texte}</Banner>
      ))}
      <Section title={tr('Mes {0} derniers jours', [a.periodeJours])}>
        <div className="dv-stats">
          <Stat accent label={tr('Courses')} value={a.courses} sub={tr(a.joursTravailles > 1 ? '{0} jours travaillés' : '{0} jour travaillé', [a.joursTravailles])} />
          <Stat label={tr('Revenus nets')} value={fcfa(a.revenus)} sub={tr('Commission {0}', [fcfa(a.commissionVersee)])} />
          <Stat label={tr('Note')} value={a.nbNotes ? a.noteMoyenne.toFixed(1) : '—'} sub={tr('{0} avis', [a.nbNotes])} />
          <Stat label={tr('Kilomètres')} value={`${a.kilometres.toLocaleString('fr-FR')} km`} sub={tr(a.coursesAnnulees > 1 ? '{0} annulées' : '{0} annulée', [a.coursesAnnulees])} />
        </div>
      </Section>
      <Section title={tr('Mon argent')}>
        <div className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
          <div className="row between"><span className="muted">{tr('Solde')}</span><strong>{fcfa(g.solde)}</strong></div>
          <div className="row between"><span className="muted">{tr('Dette espèces à reverser')}</span><strong>{fcfa(g.detteEspeces)} / {fcfa(g.plafondDette)}</strong></div>
          {g.plafondDette > 0 && <Progress value={g.detteEspeces} max={g.plafondDette} tone={g.detteEspeces > g.plafondDette ? 'danger' : 'green'} />}
          <div className="row between"><span className="muted">{tr('Reste à rembourser (prêt, avance)')}</span><strong>{fcfa(g.resteDu)}</strong></div>
        </div>
      </Section>
      <Section title={tr('Mon équipe')}>
        {poste.equipe ? (
          <div className="card dv-item">
            <div className="dv-item-ico"><IconUsers size={20} /></div>
            <div className="grow">
              <div className="dv-item-title">{poste.equipe.name}</div>
              <div className="dv-item-sub">{poste.equipe.mission ?? tr('Équipe ORION')}{poste.equipe.chef ? tr(' · chef : {0}', [poste.equipe.chef]) : ''}</div>
            </div>
            {chef && <a className="dv-pill green" href={chef} aria-label={tr('Appeler mon chef d’équipe {0}', [numeroLisible(poste.equipe.chefTelephone)])}><IconPhone size={13} /> {tr('Appeler')}</a>}
          </div>
        ) : <div className="faint" style={{ fontSize: 13 }}>{tr('Vous n’êtes pas encore rattaché à une équipe.')}</div>}
        {poste.acces
          ? <>
              <div className="faint" style={{ fontSize: 12.5 }}>{tr('Votre identifiant console ORION :')} <strong>{poste.acces.identifiant}</strong>{poste.acces.aChangerMotDePasse ? tr(' (mot de passe provisoire à changer à la première connexion)') : ''}</div>
              <MotDePasseConsole app={app} aChoisir={poste.acces.aChangerMotDePasse} />
            </>
          : <div className="faint" style={{ fontSize: 12.5 }}>{tr('Pas encore d’identifiant console : demandez-le à votre chef d’équipe.')}</div>}
      </Section>
      {(poste.maintenance.length > 0 || poste.litiges.length > 0) && (
        <Section title={tr('Suivi')}>
          {poste.maintenance.map((m) => <div key={m.id} className="card dv-item"><div className="grow"><div className="dv-item-title">🔧 {m.title}</div><div className="dv-item-sub">{m.status}{m.dueDate ? tr(' · prévu le {0}', [shortDate(m.dueDate)]) : ''}</div></div></div>)}
          {poste.litiges.map((l) => <div key={l.id} className="card dv-item"><div className="grow"><div className="dv-item-title">{tr('Litige sur une course')}</div><div className="dv-item-sub">{l.kind} · {l.status} · {shortDate(l.createdAt)}</div></div></div>)}
        </Section>
      )}
    </>
  );
}

const TON_STATUT: Record<string, string> = { deposee: 'gold', instruite: 'gold', accordee: 'green', versee: 'green', refusee: 'danger', cloturee: '' };

function Demandes({ app, poste }: { app: ScreenProps['app']; poste: PosteData }) {
  const [type, setType] = useState(poste.typesRequete[0]?.code ?? 'avance');
  const [montant, setMontant] = useState('');
  const [echeances, setEcheances] = useState('3');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [motif, setMotif] = useState('');
  const financiere = poste.typesRequete.find((x) => x.code === type)?.financiere ?? false;
  const plafond = type === 'avance' ? poste.plafonds.avance : type === 'pret' ? poste.plafonds.pret : null;
  const m = Number(montant);
  const valide = motif.trim().length >= 3 && (!financiere || m > 0) && (plafond === null || m <= plafond) && (type !== 'conge' || (du && au && au >= du));

  const envoyer = async () => {
    const r = await app.actions.deposerRequete({
      type, motif: motif.trim(),
      ...(financiere ? { montant: m } : {}),
      ...(type === 'pret' ? { echeances: Number(echeances) } : {}),
      ...(type === 'conge' ? { du, au } : {}),
    });
    if (r) { setMontant(''); setMotif(''); setDu(''); setAu(''); }
  };

  return (
    <>
      <Section title={tr('Nouvelle demande')}>
        <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void envoyer(); }}>
          <label className="dv-label">{tr('Type')}
            <select className="dv-select" value={type} onChange={(e) => setType(e.target.value)}>
              {poste.typesRequete.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
            </select>
          </label>
          {financiere && (
            <div className="dv-grid2">
              <label className="dv-label">{tr('Montant (F)')}
                <input className="dv-input" type="number" inputMode="numeric" min={1} max={plafond ?? undefined} value={montant} onChange={(e) => setMontant(e.target.value)} />
              </label>
              {type === 'pret' && (
                <label className="dv-label">{tr('Échéances (mois)')}
                  <select className="dv-select" value={echeances} onChange={(e) => setEcheances(e.target.value)}>
                    {Array.from({ length: poste.plafonds.echeancesMax }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          {plafond !== null && <div className="faint" style={{ fontSize: 12 }}>{tr('Plafond : {0}{1}', [fcfa(plafond), m > plafond ? tr(' — montant trop élevé') : ''])}</div>}
          {type === 'conge' && (
            <div className="dv-grid2">
              <label className="dv-label">{tr('Du')}<input className="dv-input" type="date" value={du} onChange={(e) => setDu(e.target.value)} /></label>
              <label className="dv-label">{tr('Au')}<input className="dv-input" type="date" value={au} onChange={(e) => setAu(e.target.value)} /></label>
            </div>
          )}
          <label className="dv-label">{tr('Motif')}
            <textarea className="dv-input" rows={3} maxLength={600} placeholder={tr('Expliquez votre demande')} value={motif} onChange={(e) => setMotif(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={!valide || app.busy}>{tr('Envoyer à mon chef d’équipe')}</button>
          <div className="faint" style={{ fontSize: 12 }}>{tr('Circuit : votre chef d’équipe donne son avis, la direction financière décide, la trésorerie verse. Un prêt se rembourse sur vos revenus.')}</div>
        </form>
      </Section>
      <Section title={tr('Mes demandes')}>
        {poste.requetes.length === 0 && <div className="dv-empty">{tr('Aucune demande pour l’instant.')}</div>}
        <div className="col" style={{ gap: 8 }}>
          {poste.requetes.map((r) => <RequeteCarte key={r.id} r={r} />)}
        </div>
      </Section>
    </>
  );
}

function RequeteCarte({ r }: { r: RequeteVue }) {
  const etapes: Array<[string, string | null]> = [[tr('Déposée'), r.createdAt], [tr('Avis du chef'), r.instruiteLe], [tr('Décision'), r.decideLe], [tr('Versée'), r.verseLe]];
  return (
    <div className="card" style={{ padding: 14, display: 'grid', gap: 6 }}>
      <div className="row between">
        <strong>{r.typeLabel}{r.montant ? ` · ${fcfa(r.montant)}` : ''}</strong>
        <span className={`dv-pill ${TON_STATUT[r.statut] ?? ''}`}>{r.statutLabel}</span>
      </div>
      <div className="faint" style={{ fontSize: 12.5 }}>{r.motif}</div>
      {r.du && r.au && <div className="faint" style={{ fontSize: 12.5 }}>{tr('Du {0} au {1}', [shortDate(r.du), shortDate(r.au)])}</div>}
      <div className="dv-steps">{etapes.map(([l, at]) => <span key={l} className={at ? 'done' : ''} title={l} />)}</div>
      {r.montantAccorde !== null && r.montantAccorde !== r.montant && <div style={{ fontSize: 13 }}>{tr('Montant accordé :')} <strong>{fcfa(r.montantAccorde)}</strong></div>}
      {r.decisionNote && <div style={{ fontSize: 13 }}>{tr('Décision : {0}', [r.decisionNote])}</div>}
      {r.plan && (
        <div className="faint" style={{ fontSize: 12 }}>
          {tr('Échéancier : {0}', [r.plan.map((e) => `${fcfa(e.montant)} le ${shortDate(e.dueDate)}${e.payeeLe ? ' ✓' : ''}`).join(' · ')])}
        </div>
      )}
    </div>
  );
}

function Messages({ app, msgs }: { app: ScreenProps['app']; msgs: MessagesChef | null }) {
  const [reponse, setReponse] = useState<Record<string, string>>({});
  const [rendu, setRendu] = useState<Record<string, string>>({});
  if (!msgs) return <div className="dv-empty">{tr('Chargement…')}</div>;
  if (!msgs.identifiant) return <div className="dv-empty">{tr('Pas encore d’identifiant ORION : les messages de votre chef d’équipe arriveront ici dès qu’il vous en aura créé un.')}</div>;
  return (
    <>
      {msgs.rapports.filter((r) => r.statut === 'demande' || r.statut === 'a_revoir').map((r) => (
        <div key={r.id} className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
          <div className="row between"><strong>📋 {r.titre}</strong><span className="dv-pill gold">{r.statutLabel}</span></div>
          <div className="faint" style={{ fontSize: 12.5 }}>{tr('Demandé par {0} · à rendre le {1}', [r.demandeParNom, shortDate(r.echeance)])}</div>
          <div style={{ fontSize: 13 }}>{r.consigne}</div>
          {r.retour && <div style={{ fontSize: 13 }}>{tr('Retour : {0}', [r.retour.texte])}</div>}
          <textarea className="dv-input" rows={3} placeholder={tr('Votre rapport')} value={rendu[r.id] ?? ''} onChange={(e) => setRendu({ ...rendu, [r.id]: e.target.value })} />
          <button className="btn btn-primary" disabled={(rendu[r.id] ?? '').trim().length < 3 || app.busy}
            onClick={() => void app.actions.rendreRapport(r.id, rendu[r.id]!.trim()).then((ok) => { if (ok) setRendu({ ...rendu, [r.id]: '' }); })}>{tr('Rendre le rapport')}</button>
        </div>
      ))}
      {msgs.messages.length === 0 && <div className="dv-empty">{tr('Aucun message de votre chef d’équipe.')}</div>}
      {msgs.messages.map((m) => (
        <div key={m.id} className="card" style={{ padding: 14, display: 'grid', gap: 8, borderColor: !m.luLe ? 'var(--green)' : undefined }}
          onClick={() => { if (!m.luLe) void app.actions.lireMessage(m.id); }}>
          <div className="row between">
            <strong>{m.urgent ? '⚠️ ' : ''}{m.sujet ?? tr('Message de {0}', [m.deNom])}</strong>
            <span className="faint" style={{ fontSize: 11.5 }}>{dateTime(m.at)}</span>
          </div>
          <div style={{ fontSize: 14 }}>{m.texte}</div>
          {m.reponses.map((x, i) => <div key={i} className="faint" style={{ fontSize: 13 }}>↳ {x.deNom} : {x.texte}</div>)}
          <div className="row gap-sm">
            <input className="dv-input" placeholder={m.reponseAttendue ? tr('Réponse attendue…') : tr('Répondre…')} value={reponse[m.id] ?? ''} onChange={(e) => setReponse({ ...reponse, [m.id]: e.target.value })} />
            <button className="dv-pill green" disabled={!(reponse[m.id] ?? '').trim() || app.busy}
              onClick={() => void app.actions.repondreMessage(m.id, reponse[m.id]!.trim()).then((ok) => { if (ok) setReponse({ ...reponse, [m.id]: '' }); })}>{tr('Envoyer')}</button>
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Identifiant console créé automatiquement pour chaque chauffeur : il en choisit lui-même
 * le mot de passe ici (sa connexion par code SMS prouve qui il est). Il peut ensuite ouvrir
 * « Mon poste » dans la console ORION avec cet identifiant.
 */
function MotDePasseConsole({ app, aChoisir }: { app: ScreenProps['app']; aChoisir: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  const [mdp, setMdp] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const differents = confirmation.length > 0 && mdp !== confirmation;
  const valide = mdp.length >= 10 && mdp === confirmation;
  if (!ouvert) {
    return (
      <button type="button" className="dv-pill green" style={{ alignSelf: 'flex-start' }} onClick={() => setOuvert(true)}>
        <IconShield size={13} /> {aChoisir ? tr('Choisir mon mot de passe console') : tr('Changer mon mot de passe console')}
      </button>
    );
  }
  return (
    <form className="card dv-form" style={{ padding: 14 }} onSubmit={(e) => {
      e.preventDefault();
      if (!valide) return;
      void app.actions.definirMotDePasseConsole(mdp).then((ok) => { if (ok) { setOuvert(false); setMdp(''); setConfirmation(''); } });
    }}>
      <div className="faint" style={{ fontSize: 12.5 }}>{tr('Au moins 10 caractères. Il sert à ouvrir « Mon poste » dans la console ORION.')}</div>
      <label className="dv-label">{tr('Nouveau mot de passe')}
        <input className="dv-input" type="password" autoComplete="new-password" minLength={10} value={mdp} onChange={(e) => setMdp(e.target.value)} />
      </label>
      <label className="dv-label">{tr('Confirmer le mot de passe')}
        <input className="dv-input" type="password" autoComplete="new-password" value={confirmation} aria-invalid={differents} onChange={(e) => setConfirmation(e.target.value)} />
      </label>
      {differents && <div className="dv-code-erreur">{tr('Les deux mots de passe sont différents.')}</div>}
      <div className="dv-grid2">
        <button type="button" className="btn btn-ghost" onClick={() => { setOuvert(false); setMdp(''); setConfirmation(''); }}>{tr('Annuler')}</button>
        <button className="btn btn-primary" disabled={!valide || app.busy}>{tr('Enregistrer')}</button>
      </div>
    </form>
  );
}
