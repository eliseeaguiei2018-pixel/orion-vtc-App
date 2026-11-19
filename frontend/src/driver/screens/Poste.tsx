import { useEffect, useState } from 'react';
import { IconPhone, IconShield, IconUsers } from '../../icons';
import { lienTel, numeroLisible } from '../../telephone';
import type { ScreenProps } from '../Driver';
import type { MessagesChef, Poste as PosteData, RequeteVue } from '../types';
import { Banner, BellButton, PageHeader, Progress, Section, Stat } from '../ui';
import { dateTime, fcfa, shortDate } from '../format';

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
      <PageHeader title="Mon poste" sub={poste?.equipe ? `${poste.equipe.name}${poste.equipe.chef ? ` · chef : ${poste.equipe.chef}` : ''}` : 'Activité, demandes et messages'} right={<BellButton count={unread} onClick={openNotices} />} />
      <div className="dv-seg" role="tablist">
        <button className={onglet === 'activite' ? 'on' : ''} onClick={() => setOnglet('activite')}>Activité</button>
        <button className={onglet === 'demandes' ? 'on' : ''} onClick={() => setOnglet('demandes')}>Demandes</button>
        <button className={onglet === 'messages' ? 'on' : ''} onClick={() => setOnglet('messages')}>Messages{nonLus > 0 ? ` (${nonLus})` : ''}</button>
      </div>
      {erreur && <div className="dv-empty">Poste indisponible — vérifiez votre connexion.</div>}
      {poste && onglet === 'activite' && <Activite poste={poste} />}
      {poste && onglet === 'demandes' && <Demandes app={app} poste={poste} />}
      {onglet === 'messages' && <Messages app={app} msgs={msgs} />}
    </div>
  );
}

function Activite({ poste }: { poste: PosteData }) {
  const a = poste.activite;
  const g = poste.argent;
  const chef = poste.equipe?.chefTelephone ? lienTel(poste.equipe.chefTelephone) : null;
  return (
    <>
      {poste.alertes.map((x, i) => (
        <Banner key={i} tone={x.severite === 'critique' ? 'danger' : 'warn'} icon={<IconShield size={18} />} title="Point d’attention">{x.texte}</Banner>
      ))}
      <Section title={`Mes ${a.periodeJours} derniers jours`}>
        <div className="dv-stats">
          <Stat accent label="Courses" value={a.courses} sub={`${a.joursTravailles} jour${a.joursTravailles > 1 ? 's' : ''} travaillé${a.joursTravailles > 1 ? 's' : ''}`} />
          <Stat label="Revenus nets" value={fcfa(a.revenus)} sub={`Commission ${fcfa(a.commissionVersee)}`} />
          <Stat label="Note" value={a.nbNotes ? a.noteMoyenne.toFixed(1) : '—'} sub={`${a.nbNotes} avis`} />
          <Stat label="Kilomètres" value={`${a.kilometres.toLocaleString('fr-FR')} km`} sub={`${a.coursesAnnulees} annulée${a.coursesAnnulees > 1 ? 's' : ''}`} />
        </div>
      </Section>
      <Section title="Mon argent">
        <div className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
          <div className="row between"><span className="muted">Solde</span><strong>{fcfa(g.solde)}</strong></div>
          <div className="row between"><span className="muted">Dette espèces à reverser</span><strong>{fcfa(g.detteEspeces)} / {fcfa(g.plafondDette)}</strong></div>
          {g.plafondDette > 0 && <Progress value={g.detteEspeces} max={g.plafondDette} tone={g.detteEspeces > g.plafondDette ? 'danger' : 'green'} />}
          <div className="row between"><span className="muted">Reste à rembourser (prêt, avance)</span><strong>{fcfa(g.resteDu)}</strong></div>
        </div>
      </Section>
      <Section title="Mon équipe">
        {poste.equipe ? (
          <div className="card dv-item">
            <div className="dv-item-ico"><IconUsers size={20} /></div>
            <div className="grow">
              <div className="dv-item-title">{poste.equipe.name}</div>
              <div className="dv-item-sub">{poste.equipe.mission ?? 'Équipe ORION'}{poste.equipe.chef ? ` · chef : ${poste.equipe.chef}` : ''}</div>
            </div>
            {chef && <a className="dv-pill green" href={chef} aria-label={`Appeler mon chef d’équipe ${numeroLisible(poste.equipe.chefTelephone)}`}><IconPhone size={13} /> Appeler</a>}
          </div>
        ) : <div className="faint" style={{ fontSize: 13 }}>Vous n’êtes pas encore rattaché à une équipe.</div>}
        {poste.acces
          ? <div className="faint" style={{ fontSize: 12.5 }}>Votre identifiant console ORION : <strong>{poste.acces.identifiant}</strong>{poste.acces.aChangerMotDePasse ? ' (mot de passe provisoire à changer à la première connexion)' : ''}</div>
          : <div className="faint" style={{ fontSize: 12.5 }}>Pas encore d’identifiant console : demandez-le à votre chef d’équipe.</div>}
      </Section>
      {(poste.maintenance.length > 0 || poste.litiges.length > 0) && (
        <Section title="Suivi">
          {poste.maintenance.map((m) => <div key={m.id} className="card dv-item"><div className="grow"><div className="dv-item-title">🔧 {m.title}</div><div className="dv-item-sub">{m.status}{m.dueDate ? ` · prévu le ${shortDate(m.dueDate)}` : ''}</div></div></div>)}
          {poste.litiges.map((l) => <div key={l.id} className="card dv-item"><div className="grow"><div className="dv-item-title">Litige sur une course</div><div className="dv-item-sub">{l.kind} · {l.status} · {shortDate(l.createdAt)}</div></div></div>)}
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
      <Section title="Nouvelle demande">
        <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void envoyer(); }}>
          <label className="dv-label">Type
            <select className="dv-select" value={type} onChange={(e) => setType(e.target.value)}>
              {poste.typesRequete.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
            </select>
          </label>
          {financiere && (
            <div className="dv-grid2">
              <label className="dv-label">Montant (F)
                <input className="dv-input" type="number" inputMode="numeric" min={1} max={plafond ?? undefined} value={montant} onChange={(e) => setMontant(e.target.value)} />
              </label>
              {type === 'pret' && (
                <label className="dv-label">Échéances (mois)
                  <select className="dv-select" value={echeances} onChange={(e) => setEcheances(e.target.value)}>
                    {Array.from({ length: poste.plafonds.echeancesMax }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          {plafond !== null && <div className="faint" style={{ fontSize: 12 }}>Plafond : {fcfa(plafond)}{m > plafond ? ' — montant trop élevé' : ''}</div>}
          {type === 'conge' && (
            <div className="dv-grid2">
              <label className="dv-label">Du<input className="dv-input" type="date" value={du} onChange={(e) => setDu(e.target.value)} /></label>
              <label className="dv-label">Au<input className="dv-input" type="date" value={au} onChange={(e) => setAu(e.target.value)} /></label>
            </div>
          )}
          <label className="dv-label">Motif
            <textarea className="dv-input" rows={3} maxLength={600} placeholder="Expliquez votre demande" value={motif} onChange={(e) => setMotif(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={!valide || app.busy}>Envoyer à mon chef d’équipe</button>
          <div className="faint" style={{ fontSize: 12 }}>Circuit : votre chef d’équipe donne son avis, la direction financière décide, la trésorerie verse. Un prêt se rembourse sur vos revenus.</div>
        </form>
      </Section>
      <Section title="Mes demandes">
        {poste.requetes.length === 0 && <div className="dv-empty">Aucune demande pour l’instant.</div>}
        <div className="col" style={{ gap: 8 }}>
          {poste.requetes.map((r) => <RequeteCarte key={r.id} r={r} />)}
        </div>
      </Section>
    </>
  );
}

function RequeteCarte({ r }: { r: RequeteVue }) {
  const etapes: Array<[string, string | null]> = [['Déposée', r.createdAt], ['Avis du chef', r.instruiteLe], ['Décision', r.decideLe], ['Versée', r.verseLe]];
  return (
    <div className="card" style={{ padding: 14, display: 'grid', gap: 6 }}>
      <div className="row between">
        <strong>{r.typeLabel}{r.montant ? ` · ${fcfa(r.montant)}` : ''}</strong>
        <span className={`dv-pill ${TON_STATUT[r.statut] ?? ''}`}>{r.statutLabel}</span>
      </div>
      <div className="faint" style={{ fontSize: 12.5 }}>{r.motif}</div>
      {r.du && r.au && <div className="faint" style={{ fontSize: 12.5 }}>Du {shortDate(r.du)} au {shortDate(r.au)}</div>}
      <div className="dv-steps">{etapes.map(([l, at]) => <span key={l} className={at ? 'done' : ''} title={l} />)}</div>
      {r.montantAccorde !== null && r.montantAccorde !== r.montant && <div style={{ fontSize: 13 }}>Montant accordé : <strong>{fcfa(r.montantAccorde)}</strong></div>}
      {r.decisionNote && <div style={{ fontSize: 13 }}>Décision : {r.decisionNote}</div>}
      {r.plan && (
        <div className="faint" style={{ fontSize: 12 }}>
          Échéancier : {r.plan.map((e) => `${fcfa(e.montant)} le ${shortDate(e.dueDate)}${e.payeeLe ? ' ✓' : ''}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

function Messages({ app, msgs }: { app: ScreenProps['app']; msgs: MessagesChef | null }) {
  const [reponse, setReponse] = useState<Record<string, string>>({});
  const [rendu, setRendu] = useState<Record<string, string>>({});
  if (!msgs) return <div className="dv-empty">Chargement…</div>;
  if (!msgs.identifiant) return <div className="dv-empty">Pas encore d’identifiant ORION : les messages de votre chef d’équipe arriveront ici dès qu’il vous en aura créé un.</div>;
  return (
    <>
      {msgs.rapports.filter((r) => r.statut === 'demande' || r.statut === 'a_revoir').map((r) => (
        <div key={r.id} className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
          <div className="row between"><strong>📋 {r.titre}</strong><span className="dv-pill gold">{r.statutLabel}</span></div>
          <div className="faint" style={{ fontSize: 12.5 }}>Demandé par {r.demandeParNom} · à rendre le {shortDate(r.echeance)}</div>
          <div style={{ fontSize: 13 }}>{r.consigne}</div>
          {r.retour && <div style={{ fontSize: 13 }}>Retour : {r.retour.texte}</div>}
          <textarea className="dv-input" rows={3} placeholder="Votre rapport" value={rendu[r.id] ?? ''} onChange={(e) => setRendu({ ...rendu, [r.id]: e.target.value })} />
          <button className="btn btn-primary" disabled={(rendu[r.id] ?? '').trim().length < 3 || app.busy}
            onClick={() => void app.actions.rendreRapport(r.id, rendu[r.id]!.trim()).then((ok) => { if (ok) setRendu({ ...rendu, [r.id]: '' }); })}>Rendre le rapport</button>
        </div>
      ))}
      {msgs.messages.length === 0 && <div className="dv-empty">Aucun message de votre chef d’équipe.</div>}
      {msgs.messages.map((m) => (
        <div key={m.id} className="card" style={{ padding: 14, display: 'grid', gap: 8, borderColor: !m.luLe ? 'var(--green)' : undefined }}
          onClick={() => { if (!m.luLe) void app.actions.lireMessage(m.id); }}>
          <div className="row between">
            <strong>{m.urgent ? '⚠️ ' : ''}{m.sujet ?? `Message de ${m.deNom}`}</strong>
            <span className="faint" style={{ fontSize: 11.5 }}>{dateTime(m.at)}</span>
          </div>
          <div style={{ fontSize: 14 }}>{m.texte}</div>
          {m.reponses.map((x, i) => <div key={i} className="faint" style={{ fontSize: 13 }}>↳ {x.deNom} : {x.texte}</div>)}
          <div className="row gap-sm">
            <input className="dv-input" placeholder={m.reponseAttendue ? 'Réponse attendue…' : 'Répondre…'} value={reponse[m.id] ?? ''} onChange={(e) => setReponse({ ...reponse, [m.id]: e.target.value })} />
            <button className="dv-pill green" disabled={!(reponse[m.id] ?? '').trim() || app.busy}
              onClick={() => void app.actions.repondreMessage(m.id, reponse[m.id]!.trim()).then((ok) => { if (ok) setReponse({ ...reponse, [m.id]: '' }); })}>Envoyer</button>
          </div>
        </div>
      ))}
    </>
  );
}
