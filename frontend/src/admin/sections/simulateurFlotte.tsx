import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminError, LIVE, adminGet, adminPost } from '../api';

/**
 * SIMULATEUR DE FLOTTE — Mon poste du PDG.
 *
 * Deux questions, un seul écran :
 *   1. combien de voitures, chauffeurs, bornes et motos faut-il pour servir la part de marché
 *      visée dans le district d'Abidjan ?
 *   2. la flotte prévue par ORION (5 000 voitures) permet-elle de servir combien de courses ?
 * Le calcul est fait ici, en direct, à chaque réglage ; le serveur garde le plan enregistré
 * (retrouvé sur tous les appareils de la direction) et mesure le pilote réel pour le recaler.
 */
export interface PlanFlotte {
  marcheCoursesJour: number; partVisee: number; coursesParVoitureJour: number; disponibilite: number; margePointe: number;
  gammes: { or: number; diamant: number }; equipes: number; remplacants: number;
  kmParVoitureJour: number; kwhPar100: number; voituresParBorne: number; bornesParDepot: number; puissanceBorneKw: number;
  livraisonsJour: number; coursesParMotoJour: number; partCargo: number; coursesParCargoJour: number;
  objectifFlotte: number;
  modifie?: { le: string; par: string };
}
interface Mesures {
  flotte: { argent: number; or: number; diamant: number; voitures: number; motos: number; cargos: number };
  enLigne: number; enCourse: number; occupation: number | null; jours: number;
  coursesTerminees: number; livraisonsTerminees: number; voituresActives: number;
  coursesParVoitureJour: number | null; sansChauffeurPct: number | null; approcheMedianeMin: number | null; demandes: number;
}
interface EtatFlotte { plan: PlanFlotte; defaut: PlanFlotte; mesures: Mesures }

const DEFAUT: PlanFlotte = {
  marcheCoursesJour: 150_000, partVisee: 40, coursesParVoitureJour: 18, disponibilite: 85, margePointe: 25,
  gammes: { or: 20, diamant: 5 }, equipes: 2, remplacants: 10,
  kmParVoitureJour: 300, kwhPar100: 15, voituresParBorne: 9, bornesParDepot: 25, puissanceBorneKw: 60,
  livraisonsJour: 15_000, coursesParMotoJour: 25, partCargo: 1, coursesParCargoJour: 4,
  objectifFlotte: 5000,
};

/** Seuils qui déclenchent le palier suivant (mesurés sur le pilote). */
const SEUILS = { occupation: 65, sansChauffeur: 5, approche: 6 };
const PALIERS = [0.1, 0.3, 0.6, 1];

const nf = new Intl.NumberFormat('fr-FR');
const n0 = (v: number) => nf.format(Math.round(v));
const n1 = (v: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(v);
const arrondi50 = (v: number) => Math.max(50, Math.round(v / 50) * 50);

/** Le calcul du simulateur (mêmes règles que la note de dimensionnement remise à la direction). */
export function calculerFlotte(p: PlanFlotte) {
  const facteur = (1 + p.margePointe / 100) / (p.disponibilite / 100);
  const courses = p.marcheCoursesJour * p.partVisee / 100;
  const voitures = Math.ceil((courses / p.coursesParVoitureJour) * facteur);
  const or = Math.round(voitures * p.gammes.or / 100);
  const diamant = Math.round(voitures * p.gammes.diamant / 100);
  const argent = Math.max(0, voitures - or - diamant);
  const chauffeurs = Math.ceil(voitures * p.equipes * (1 + p.remplacants / 100));
  const bornes = Math.ceil(voitures / p.voituresParBorne);
  const depots = Math.ceil(bornes / p.bornesParDepot);
  const energieMWh = (voitures * (p.disponibilite / 100) * p.kmParVoitureJour * p.kwhPar100) / 100 / 1000;
  const puissanceMW = (bornes * p.puissanceBorneKw) / 1000;
  const colisCargo = p.livraisonsJour * p.partCargo / 100;
  const motos = Math.ceil(((p.livraisonsJour - colisCargo) / p.coursesParMotoJour) * facteur);
  const cargos = colisCargo > 0 ? Math.ceil((colisCargo / p.coursesParCargoJour) * facteur) : 0;
  // Calcul inverse : ce que permet la flotte prévue par ORION.
  const coursesPlan = (p.objectifFlotte / facteur) * p.coursesParVoitureJour;
  return {
    courses, voitures, argent, or, diamant, chauffeurs, bornes, depots, energieMWh, puissanceMW, motos, cargos,
    plan: {
      voitures: p.objectifFlotte,
      courses: coursesPlan,
      part: (coursesPlan / p.marcheCoursesJour) * 100,
      couverture: voitures > 0 ? (p.objectifFlotte / voitures) * 100 : 0,
      chauffeurs: Math.ceil(p.objectifFlotte * p.equipes * (1 + p.remplacants / 100)),
      bornes: Math.ceil(p.objectifFlotte / p.voituresParBorne),
    },
  };
}

export function SimulateurFlotte() {
  const [etat, setEtat] = useState<EtatFlotte | null>(null);
  const [plan, setPlan] = useState<PlanFlotte>(DEFAUT);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean } | null>(null);

  const recevoir = useCallback((e: EtatFlotte) => { setEtat(e); setPlan(e.plan); }, []);
  useEffect(() => {
    if (!LIVE) return;
    void adminGet<EtatFlotte>('/admin/direction/flotte').then(recevoir).catch(() => setMessage({ texte: 'Le serveur n’a pas répondu : le simulateur calcule avec les valeurs par défaut.', erreur: true }));
  }, [recevoir]);

  const r = useMemo(() => calculerFlotte(plan), [plan]);
  const m = etat?.mesures ?? null;
  const enregistre = etat?.plan ?? DEFAUT;
  const { modifie: _a, ...sansTrace } = plan;
  const { modifie: _b, ...enregistreSansTrace } = enregistre;
  const change = JSON.stringify(sansTrace) !== JSON.stringify(enregistreSansTrace);
  const gammesValides = plan.gammes.or + plan.gammes.diamant <= 100;
  const maj = <K extends keyof PlanFlotte>(k: K, v: PlanFlotte[K]) => setPlan((p) => ({ ...p, [k]: v }));

  const enregistrer = async () => {
    setEnvoi(true); setMessage(null);
    try {
      const { modifie: _m, ...corps } = plan;
      recevoir(await adminPost<EtatFlotte>('/admin/direction/flotte', corps));
      setMessage({ texte: 'Plan de flotte enregistré : vous le retrouverez sur tous vos appareils.' });
    } catch (e) {
      setMessage({ texte: e instanceof AdminError ? e.message : 'Le serveur n’a pas répondu. Rien n’a changé.', erreur: true });
    } finally { setEnvoi(false); }
  };

  // Paliers de la flotte prévue, et ce que disent les mesures du pilote.
  const flotteActuelle = m?.flotte.voitures ?? 0;
  const paliers = PALIERS.map((f) => (f === 1 ? plan.objectifFlotte : arrondi50(plan.objectifFlotte * f)));
  const declencheurs = m ? [
    m.occupation !== null && m.occupation > SEUILS.occupation ? `occupation ${m.occupation} % (> ${SEUILS.occupation} %)` : null,
    m.sansChauffeurPct !== null && m.sansChauffeurPct > SEUILS.sansChauffeur ? `${n1(m.sansChauffeurPct)} % de demandes sans chauffeur (> ${SEUILS.sansChauffeur} %)` : null,
    m.approcheMedianeMin !== null && m.approcheMedianeMin > SEUILS.approche ? `approche médiane ${n1(m.approcheMedianeMin)} min (> ${SEUILS.approche} min)` : null,
  ].filter((x): x is string => x !== null) : [];
  const prochain = paliers.find((p) => p > flotteActuelle) ?? null;

  return (
    <div className="adm-card adm-flotte">
      <div className="adm-card-h">
        <h3>Simulateur de flotte</h3>
        <span className="adm-muted">dimensionner ORION pour le district d’Abidjan</span>
      </div>

      {/* Le pilote, mesuré : ce qui permet de recaler les hypothèses. */}
      <div className="adm-flotte-pilote" aria-label="Mesures du pilote">
        <Mesure libelle="Voitures validées" valeur={m ? n0(m.flotte.voitures) : '—'}
          detail={m ? `Argent ${m.flotte.argent} · Or ${m.flotte.or} · Diamant ${m.flotte.diamant}` : 'serveur non joint'} />
        <Mesure libelle="Motos · cargos" valeur={m ? `${n0(m.flotte.motos)} · ${n0(m.flotte.cargos)}` : '—'} detail="livraison" />
        <Mesure libelle="Occupation" valeur={m?.occupation != null ? `${m.occupation} %` : '—'}
          detail={m ? `${m.enCourse} en course sur ${m.enLigne} en ligne` : ''} alerte={(m?.occupation ?? 0) > SEUILS.occupation} />
        <Mesure libelle="Courses par voiture / jour" valeur={m?.coursesParVoitureJour != null ? n1(m.coursesParVoitureJour) : '—'}
          detail={m ? `${n0(m.coursesTerminees)} courses sur ${m.jours} j` : ''} />
        <Mesure libelle="Sans chauffeur" valeur={m?.sansChauffeurPct != null ? `${n1(m.sansChauffeurPct)} %` : '—'}
          detail={m ? `${n0(m.demandes)} demandes sur ${m.jours} j` : ''} alerte={(m?.sansChauffeurPct ?? 0) > SEUILS.sansChauffeur} />
        <Mesure libelle="Approche médiane" valeur={m?.approcheMedianeMin != null ? `${n1(m.approcheMedianeMin)} min` : '—'}
          detail="acceptation → arrivée" alerte={(m?.approcheMedianeMin ?? 0) > SEUILS.approche} />
      </div>
      {m?.coursesParVoitureJour != null && Math.abs(m.coursesParVoitureJour - plan.coursesParVoitureJour) >= 0.5 && (
        <p className="adm-flotte-recaler">
          Le pilote mesure {n1(m.coursesParVoitureJour)} courses par voiture et par jour ; le plan en suppose {n1(plan.coursesParVoitureJour)}.
          <button type="button" className="adm-btn xs" onClick={() => maj('coursesParVoitureJour', Math.max(1, Math.round(m.coursesParVoitureJour! * 10) / 10))}>Utiliser la mesure du pilote</button>
        </p>
      )}

      <div className="adm-flotte-corps">
        {/* Hypothèses */}
        <div className="adm-flotte-hypotheses">
          <fieldset>
            <legend>Demande</legend>
            <Champ libelle="Marché VTC du district" unite="courses / jour" valeur={plan.marcheCoursesJour} min={10_000} max={600_000} pas={5000} curseur
              onChange={(v) => maj('marcheCoursesJour', Math.round(v))} aide="Hypothèse à confirmer : toutes plateformes confondues." />
            <Champ libelle="Part de marché visée" unite="%" valeur={plan.partVisee} min={1} max={70} pas={1} curseur onChange={(v) => maj('partVisee', v)} />
          </fieldset>
          <fieldset>
            <legend>Productivité</legend>
            <Champ libelle="Courses par voiture et par jour" unite="courses" valeur={plan.coursesParVoitureJour} min={4} max={40} pas={0.5} onChange={(v) => maj('coursesParVoitureJour', v)} />
            <Champ libelle="Flotte disponible en pointe" unite="%" valeur={plan.disponibilite} min={50} max={100} pas={1} onChange={(v) => maj('disponibilite', v)} aide="Recharge, entretien, repos." />
            <Champ libelle="Marge pour la pointe" unite="%" valeur={plan.margePointe} min={0} max={100} pas={1} onChange={(v) => maj('margePointe', v)} />
          </fieldset>
          <fieldset>
            <legend>Gammes et chauffeurs</legend>
            <Champ libelle="Or" unite="% de la flotte" valeur={plan.gammes.or} min={0} max={100} pas={1} onChange={(v) => maj('gammes', { ...plan.gammes, or: v })} />
            <Champ libelle="Diamant" unite="% de la flotte" valeur={plan.gammes.diamant} min={0} max={100} pas={1} onChange={(v) => maj('gammes', { ...plan.gammes, diamant: v })}
              aide={gammesValides ? `Argent : ${n0(100 - plan.gammes.or - plan.gammes.diamant)} % (le reste).` : undefined} />
            {!gammesValides && <p className="adm-erreur" role="alert">L’Or et le Diamant dépassent 100 % de la flotte.</p>}
            <div className="adm-flotte-champ">
              <span className="adm-flotte-lbl">Équipes par voiture</span>
              <div className="adm-flotte-segment" role="radiogroup" aria-label="Équipes de chauffeurs par voiture">
                {[1, 2, 3].map((e) => (
                  <button key={e} type="button" role="radio" aria-checked={plan.equipes === e} className={plan.equipes === e ? 'actif' : ''} onClick={() => maj('equipes', e)}>{e}</button>
                ))}
              </div>
            </div>
            <Champ libelle="Chauffeurs remplaçants" unite="%" valeur={plan.remplacants} min={0} max={50} pas={1} onChange={(v) => maj('remplacants', v)} />
          </fieldset>
          <fieldset>
            <legend>Livraison</legend>
            <Champ libelle="Colis par jour" unite="colis" valeur={plan.livraisonsJour} min={0} max={300_000} pas={1000} curseur onChange={(v) => maj('livraisonsJour', Math.round(v))} />
            <Champ libelle="Colis par moto et par jour" unite="colis" valeur={plan.coursesParMotoJour} min={5} max={60} pas={1} onChange={(v) => maj('coursesParMotoJour', v)} />
            <Champ libelle="Part en cargo" unite="% des colis" valeur={plan.partCargo} min={0} max={50} pas={0.5} onChange={(v) => maj('partCargo', v)} />
            <Champ libelle="Colis par cargo et par jour" unite="colis" valeur={plan.coursesParCargoJour} min={1} max={20} pas={0.5} onChange={(v) => maj('coursesParCargoJour', v)} />
          </fieldset>
          <details className="adm-flotte-details">
            <summary>Recharge électrique</summary>
            <Champ libelle="Km par voiture et par jour" unite="km" valeur={plan.kmParVoitureJour} min={50} max={600} pas={10} onChange={(v) => maj('kmParVoitureJour', v)} />
            <Champ libelle="Consommation" unite="kWh / 100 km" valeur={plan.kwhPar100} min={8} max={30} pas={0.5} onChange={(v) => maj('kwhPar100', v)} />
            <Champ libelle="Voitures par borne rapide" unite="voitures" valeur={plan.voituresParBorne} min={2} max={30} pas={1} onChange={(v) => maj('voituresParBorne', v)} />
            <Champ libelle="Bornes par dépôt" unite="bornes" valeur={plan.bornesParDepot} min={4} max={100} pas={1} onChange={(v) => maj('bornesParDepot', Math.round(v))} />
            <Champ libelle="Puissance d’une borne" unite="kW" valeur={plan.puissanceBorneKw} min={22} max={350} pas={1} onChange={(v) => maj('puissanceBorneKw', v)} />
          </details>
        </div>

        {/* Résultats */}
        <div className="adm-flotte-resultats" aria-live="polite">
          <div className="adm-flotte-vedette">
            <span className="adm-muted">Voitures nécessaires</span>
            <strong>{n0(r.voitures)}</strong>
            <span className="adm-muted">pour {n1(plan.partVisee)} % du marché, soit {n0(r.courses)} courses par jour</span>
          </div>
          <div className="adm-flotte-tuiles">
            <Tuile libelle="Argent" valeur={n0(r.argent)} />
            <Tuile libelle="Or" valeur={n0(r.or)} />
            <Tuile libelle="Diamant" valeur={n0(r.diamant)} />
            <Tuile libelle="Chauffeurs" valeur={n0(r.chauffeurs)} detail={`${plan.equipes} équipe${plan.equipes > 1 ? 's' : ''} + ${n0(plan.remplacants)} %`} />
            <Tuile libelle="Bornes rapides" valeur={n0(r.bornes)} detail={`${n0(r.depots)} dépôts · ${n1(r.puissanceMW)} MW`} />
            <Tuile libelle="Énergie" valeur={`${n0(r.energieMWh)} MWh`} detail="par jour" />
            <Tuile libelle="Motos" valeur={n0(r.motos)} detail="livraison" />
            <Tuile libelle="Cargos" valeur={n0(r.cargos)} detail="gros colis" />
          </div>

          {/* Calcul inverse : la flotte prévue par ORION. */}
          <div className="adm-flotte-plan">
            <div className="adm-flotte-plan-tete">
              <h4>Flotte prévue par ORION</h4>
              <label className="adm-flotte-objectif">
                <input className="adm-input mono" inputMode="numeric" aria-label="Flotte prévue (voitures)" value={nf.format(plan.objectifFlotte)}
                  onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, '')); if (v > 0) maj('objectifFlotte', Math.min(200_000, v)); }} />
                <span>voitures</span>
              </label>
            </div>
            <p>
              Elle sert environ <strong>{n0(r.plan.courses)} courses par jour</strong>, soit <strong>{n1(r.plan.part)} %</strong> du marché estimé,
              avec {n0(r.plan.chauffeurs)} chauffeurs et {n0(r.plan.bornes)} bornes rapides.
            </p>
            <div className="adm-flotte-jauge" role="img" aria-label={`La flotte prévue couvre ${n0(r.plan.couverture)} % du besoin calculé`}>
              <span style={{ width: `${Math.min(100, r.plan.couverture)}%` }} />
            </div>
            <p className="adm-muted adm-flotte-note">
              {r.plan.couverture >= 100
                ? `La flotte prévue dépasse le besoin calculé (${n0(r.voitures)} voitures) : marge pour gagner davantage de marché.`
                : `La flotte prévue couvre ${n0(r.plan.couverture)} % du besoin calculé (${n0(r.voitures)} voitures).`}
            </p>
          </div>

          {/* Paliers */}
          <div className="adm-flotte-paliers">
            <h4>Paliers de croissance</h4>
            <ol>
              <li className="fait"><span className="adm-flotte-palier-n">{n0(flotteActuelle)}</span><span>Aujourd’hui (pilote)</span></li>
              {paliers.map((p, i) => (
                <li key={i} className={flotteActuelle >= p ? 'fait' : p === prochain ? 'prochain' : ''}>
                  <span className="adm-flotte-palier-n">{n0(p)}</span>
                  <span>{i === 3 ? 'Cible' : `Palier ${i + 1}`}{[' · centre', ' · grandes communes', ' · périphérie', ' · district entier'][i] ?? ''}</span>
                </li>
              ))}
            </ol>
            <p className={`adm-flotte-signal${declencheurs.length ? ' go' : ''}`}>
              {!m ? 'Mesures du pilote indisponibles.'
                : declencheurs.length
                  ? `Passer au palier suivant${prochain ? ` (${n0(prochain)} voitures)` : ''} : ${declencheurs.join(' · ')}.`
                  : `Rester au palier actuel : occupation, demandes sans chauffeur et approche restent sous les seuils (${SEUILS.occupation} %, ${SEUILS.sansChauffeur} %, ${SEUILS.approche} min).`}
            </p>
          </div>
        </div>
      </div>

      {enregistre.modifie && <p className="adm-muted adm-prix-trace">Plan enregistré le {new Date(enregistre.modifie.le).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} par {enregistre.modifie.par}</p>}
      {message && <p className={message.erreur ? 'adm-erreur' : 'adm-ok'} role="status">{message.texte}</p>}
      <div className="adm-dialogue-actions adm-flotte-actions">
        <button type="button" className="adm-btn" disabled={envoi} onClick={() => setPlan({ ...(etat?.defaut ?? DEFAUT), modifie: plan.modifie })}>Valeurs par défaut</button>
        <button type="button" className="adm-btn" disabled={envoi || !change} onClick={() => setPlan(enregistre)}>Annuler les changements</button>
        {LIVE && <button type="button" className="adm-btn solid" disabled={envoi || !change || !gammesValides} onClick={() => void enregistrer()}>{envoi ? 'Enregistrement…' : 'Enregistrer ce plan'}</button>}
      </div>
    </div>
  );
}

function Mesure({ libelle, valeur, detail, alerte }: { libelle: string; valeur: string; detail?: string; alerte?: boolean }) {
  return (
    <div className={`adm-flotte-mesure${alerte ? ' alerte' : ''}`}>
      <span className="adm-muted">{libelle}</span>
      <strong className="mono">{valeur}</strong>
      {detail ? <small className="adm-muted">{detail}</small> : null}
    </div>
  );
}

function Tuile({ libelle, valeur, detail }: { libelle: string; valeur: string; detail?: string }) {
  return (
    <div className="adm-flotte-tuile">
      <span className="adm-muted">{libelle}</span>
      <strong className="mono">{valeur}</strong>
      {detail ? <small className="adm-muted">{detail}</small> : null}
    </div>
  );
}

function Champ({ libelle, unite, valeur, min, max, pas, onChange, curseur, aide }: {
  libelle: string; unite: string; valeur: number; min: number; max: number; pas: number;
  onChange: (v: number) => void; curseur?: boolean; aide?: string;
}) {
  const borner = (v: number) => Math.min(max, Math.max(min, v));
  const [texte, setTexte] = useState(nf.format(valeur));
  useEffect(() => { setTexte(nf.format(valeur)); }, [valeur]);
  return (
    <div className="adm-flotte-champ">
      <label className="adm-flotte-ligne">
        <span className="adm-flotte-lbl">{libelle}</span>
        <input className="adm-input mono" inputMode="decimal" value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onBlur={() => { const v = Number(texte.replace(/[\s  ]/g, '').replace(',', '.')); if (Number.isFinite(v)) onChange(borner(v)); else setTexte(nf.format(valeur)); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <span className="adm-flotte-unite">{unite}</span>
      </label>
      {curseur && (
        <input type="range" className="adm-prix-curseur" min={min} max={max} step={pas} value={borner(valeur)} aria-label={libelle}
          onChange={(e) => onChange(Number(e.target.value))} />
      )}
      {aide ? <small className="adm-muted adm-flotte-aide">{aide}</small> : null}
    </div>
  );
}
