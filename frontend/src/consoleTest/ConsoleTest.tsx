/**
 * MINI CONSOLE DE TEST — se comporte comme un chauffeur ORION, pour essayer l'APK client
 * de test « temps réel » sur le même téléphone (même registre de test partagé).
 *
 * - Carte Google avec le trafic en direct.
 * - Position du client telle que l'app client la publie, en direct.
 * - Un chauffeur virtuel placé à la distance choisie du client (curseur, en km) : l'app
 *   client calcule l'approche réelle (route et trafic de Google) depuis cette position, et
 *   l'ajoute au prix.
 * - Les courses commandées dans l'app client arrivent ici : accepter, rouler vers le client
 *   (la voiture suit la route de Google à la vitesse du trafic), arriver, vérifier le code,
 *   rouler jusqu'à la destination, terminer, encaisser.
 *
 * Application de test, en français. Aucune donnée ne quitte le téléphone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chargerGoogle, type GMap, type GoogleMaps, type GPolyline } from '../carteGoogle';
import { optionsCarte, poserRepere, traficEnDirect } from '../components/CarteGoogle';
import { rendu } from '../components/Vehicules';
import { useTheme } from '../theme';
import { calculerApproche, traficReel } from '../tempsReel';
import { itineraireGoogle } from '../itineraireGoogle';
import { majChauffeur, majCourse, suivreBus, type CourseBus, type EtatBus, type PresenceClient } from '../busTest';
import type { LatLng } from '../types';

const MOI = { id: 'console-test', matricule: 'ORION-TEST-01', plaque: 'TEST-001-CI', telephone: '+2250100000000' };
const VEHICULES: Record<string, string> = { argent: 'Geely Galaxy E8', or: 'AVATR 11', diamant: 'Huawei Stelato S9' };
const DIRECTIONS: Array<[string, number]> = [['Nord', 0], ['Est', 90], ['Sud', 180], ['Ouest', 270]];
const VITESSES = [1, 5, 20];
const fcfa = (n: number) => `${new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/ | /g, ' ')} F`;
const km = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const minutes = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;

/** Point à `d` mètres de `p`, dans la direction `cap` (degrés, 0 = nord). */
function pointA(p: LatLng, d: number, cap: number): LatLng {
  const R = 6_371_000, b = (cap * Math.PI) / 180, la = (p.lat * Math.PI) / 180, lo = (p.lng * Math.PI) / 180, r = d / R;
  const la2 = Math.asin(Math.sin(la) * Math.cos(r) + Math.cos(la) * Math.sin(r) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(r) * Math.cos(la), Math.cos(r) - Math.sin(la) * Math.sin(la2));
  return { lat: (la2 * 180) / Math.PI, lng: (lo2 * 180) / Math.PI };
}
const ecart = (a: LatLng, b: LatLng) => Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180)) * 111_320;
/** Position à la fraction `t` d'un tracé. */
function surTrace(trace: LatLng[], t: number): LatLng {
  if (trace.length < 2) return trace[0]!;
  const cumul = [0];
  for (let i = 1; i < trace.length; i++) cumul.push(cumul[i - 1]! + ecart(trace[i - 1]!, trace[i]!));
  const cible = Math.min(1, Math.max(0, t)) * (cumul[cumul.length - 1]! || 1);
  let i = 1;
  while (i < cumul.length - 1 && cumul[i]! < cible) i++;
  const f = (cible - cumul[i - 1]!) / ((cumul[i]! - cumul[i - 1]!) || 1);
  const a = trace[i - 1]!, b = trace[i]!;
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}
const capEntre = (a: LatLng, b: LatLng) => (Math.atan2((b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI;

interface Trajet { geometrie: LatLng[]; distanceMeters: number; durationSeconds: number; fluideSeconds: number; google: boolean }
type Etape = 'libre' | 'offre' | 'acceptee' | 'approche' | 'arrivee' | 'en_cours' | 'terminee';

export function ConsoleTest() {
  const { resolved } = useTheme();
  const [enLigne, setEnLigne] = useState(true);
  const [gamme, setGamme] = useState('argent');
  const [distanceKm, setDistanceKm] = useState(3);
  const [direction, setDirection] = useState(90);
  const [vitesse, setVitesse] = useState(1);
  const [client, setClient] = useState<PresenceClient | null>(null);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [approche, setApproche] = useState<Trajet | null>(null);
  const [course, setCourse] = useState<CourseBus | null>(null);
  const [etape, setEtape] = useState<Etape>('libre');
  const [trajetCourse, setTrajetCourse] = useState<Trajet | null>(null);
  const [code, setCode] = useState('');
  const [erreurCode, setErreurCode] = useState('');
  const [journal, setJournal] = useState<Array<{ at: number; texte: string }>>([]);
  const noter = useCallback((texte: string) => setJournal((j) => [{ at: Date.now(), texte }, ...j].slice(0, 30)), []);
  const etat = useRef({ enLigne, gamme, position, course, etape });
  etat.current = { enLigne, gamme, position, course, etape };
  const refusees = useRef(new Set<string>());
  const ancre = useRef<LatLng | null>(null);

  /* ---- Registre : le client, sa position, les courses ---- */
  useEffect(() => suivreBus((e: EtatBus) => {
    const c = e.clients.filter((x) => x.position).sort((a, b) => b.majLe - a.majLe)[0] ?? null;
    setClient(c);
    const { course: cours, etape: et } = etat.current;
    if (cours) {
      const maj = e.courses.find((x) => x.id === cours.id);
      if (maj) {
        setCourse(maj);
        if (maj.statut === 'annulee' && maj.annuleePar === 'client' && et !== 'libre') { noter('Le client a annulé la course.'); terminer(); return; }
        if (et === 'terminee' && maj.paiementRegle && maj.paiementRegle !== 'cash' && maj.statut !== 'payee') {
          void majCourse(maj.id, { statut: 'payee' }); noter(`Paiement reçu dans l'app client (${maj.paiementRegle}).`);
        }
        if (maj.statut === 'payee' && et === 'terminee') { noter('Course payée.'); terminer(); }
      }
      return;
    }
    if (!etat.current.enLigne) return;
    const offre = e.courses.find((x) => x.statut === 'demandee' && (!x.chauffeurId || x.chauffeurId === MOI.id) && (x.offreJusqua ?? 0) > Date.now() && !refusees.current.has(x.id));
    if (offre) { setCourse(offre); setEtape('offre'); noter(`Nouvelle course : ${offre.client.nom}, ${offre.origine.nom} → ${offre.destination.nom}, ${fcfa(offre.montant)}.`); }
  }, 1500), [noter]);

  /* ---- Le chauffeur virtuel reste à la distance choisie du client ---- */
  useEffect(() => {
    if (!client?.position || etape !== 'libre') return;
    const p = client.position;
    // Le client a bougé de plus de 150 m, ou le réglage a changé : on replace le chauffeur.
    if (!ancre.current || ecart(ancre.current, p) > 150 || !position) ancre.current = p;
    setPosition(pointA(ancre.current, distanceKm * 1000, direction));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.position?.lat, client?.position?.lng, distanceKm, direction, etape]);

  /* ---- Approche jusqu'au client : route et trafic de Google ---- */
  useEffect(() => {
    if (!position || !client?.position || etape !== 'libre') return;
    let actif = true;
    const t = window.setTimeout(() => {
      void calculerApproche(position, client.position!).then((r) => { if (actif) setApproche({ ...r, geometrie: r.geometrie ?? [position, client.position!] }); });
    }, 500);
    return () => { actif = false; window.clearTimeout(t); };
  }, [position, client?.position, etape]);

  /* ---- Présence du chauffeur dans le registre ---- */
  useEffect(() => {
    const publier = () => void majChauffeur({
      id: MOI.id, nom: 'Chauffeur test ORION', matricule: MOI.matricule, gamme: etat.current.gamme,
      vehicule: VEHICULES[etat.current.gamme] ?? '', plaque: MOI.plaque, couleur: 'Blanc', telephone: MOI.telephone, note: 5, nbCourses: 0,
      enLigne: etat.current.enLigne, occupe: etat.current.etape !== 'libre', position: etat.current.position,
    });
    publier();
    const id = window.setInterval(publier, 2000);
    return () => window.clearInterval(id);
  }, [enLigne, gamme, position, etape]);

  /* ---- Déplacement le long d'un tracé, à la vitesse du trafic (× la vitesse de simulation) ---- */
  const conduite = useRef<{ arret: () => void } | null>(null);
  const rouler = (t: Trajet, fin: () => void) => {
    conduite.current?.arret();
    let fait = 0, dernier = Date.now();
    const id = window.setInterval(() => {
      const maintenant = Date.now();
      fait += ((maintenant - dernier) / 1000) * vitesseRef.current;
      dernier = maintenant;
      const f = Math.min(1, fait / Math.max(1, t.durationSeconds));
      const p = surTrace(t.geometrie, f);
      setPosition(p);
      if (f >= 1) { window.clearInterval(id); conduite.current = null; fin(); }
    }, 1000);
    conduite.current = { arret: () => window.clearInterval(id) };
  };
  const vitesseRef = useRef(vitesse);
  vitesseRef.current = vitesse;

  const terminer = () => {
    conduite.current?.arret();
    setCourse(null); setEtape('libre'); setTrajetCourse(null); setCode(''); setErreurCode('');
    ancre.current = null;
  };

  /* ---- Gestes du chauffeur ---- */
  const accepter = async () => {
    if (!course) return;
    await majCourse(course.id, {
      statut: 'acceptee', chauffeurId: MOI.id,
      chauffeur: { id: MOI.id, nom: 'Chauffeur test ORION', matricule: MOI.matricule, gamme, vehicule: VEHICULES[gamme] ?? '', plaque: MOI.plaque, couleur: 'Blanc', telephone: MOI.telephone, note: 5, nbCourses: 0 },
    });
    setEtape('acceptee'); noter('Course acceptée : le client voit le chauffeur et le véhicule.');
  };
  const refuser = async () => {
    if (!course) return;
    refusees.current.add(course.id);
    await majCourse(course.id, { statut: 'refusee' });
    noter('Course refusée.'); terminer();
  };
  const partir = async () => {
    if (!course || !position) return;
    const pickup = { lat: course.origine.lat, lng: course.origine.lng };
    const r = await calculerApproche(position, pickup);
    const t: Trajet = { ...r, geometrie: r.geometrie ?? [position, pickup] };
    setApproche(t); setEtape('approche');
    noter(`En route vers le client : ${km(t.distanceMeters)}, ${minutes(t.durationSeconds)} avec le trafic.`);
    rouler(t, () => noter('Arrivé au point de prise en charge (appuyez sur « Je suis arrivé »).'));
  };
  const arriver = async () => {
    if (!course) return;
    conduite.current?.arret();
    setPosition({ lat: course.origine.lat, lng: course.origine.lng });
    await majCourse(course.id, { statut: 'arrivee' });
    setEtape('arrivee'); noter('Arrivé : demandez le code au client.');
  };
  const demarrer = async () => {
    if (!course) return;
    if (code !== course.code) { setErreurCode('Code incorrect : demandez le code affiché dans l’app client.'); return; }
    setErreurCode('');
    const points = [{ lat: course.origine.lat, lng: course.origine.lng }, ...course.arrets.map((a) => ({ lat: a.lat, lng: a.lng })), { lat: course.destination.lat, lng: course.destination.lng }];
    // L'itinéraire choisi par le client (pont à péage ou voie normale) : on roule sur son tracé.
    const choisi = course.itineraire?.trace && course.itineraire.trace.length > 1 ? course.itineraire.trace : null;
    const r = choisi ? null : await itineraireGoogle(points);
    const t: Trajet = choisi
      ? { geometrie: choisi, distanceMeters: course.distanceMetres, durationSeconds: course.dureeSecondes, fluideSeconds: course.dureeSecondes, google: false }
      : r
      ? { geometrie: r.geometrie, distanceMeters: r.distanceMeters, durationSeconds: r.durationSeconds, fluideSeconds: r.fluideSeconds ?? r.durationSeconds, google: true }
      : { geometrie: points, distanceMeters: course.distanceMetres, durationSeconds: course.dureeSecondes, fluideSeconds: course.dureeSecondes, google: false };
    setTrajetCourse(t);
    await majCourse(course.id, { statut: 'en_cours', codeVerifie: true });
    setEtape('en_cours'); noter(`Code vérifié, course démarrée : ${km(t.distanceMeters)}, ${minutes(t.durationSeconds)} avec le trafic.`);
    rouler(t, () => noter('Destination atteinte (appuyez sur « Terminer la course »).'));
  };
  const finir = async () => {
    if (!course) return;
    conduite.current?.arret();
    setPosition({ lat: course.destination.lat, lng: course.destination.lng });
    await majCourse(course.id, { statut: 'terminee' });
    setEtape('terminee');
    noter(course.paiement === 'cash' ? 'Course terminée : encaissez les espèces.' : 'Course terminée : le client paie dans son app.');
  };
  const especes = async () => {
    if (!course) return;
    await majCourse(course.id, { statut: 'payee', paiementRegle: 'cash' });
    noter(`Espèces reçues : ${fcfa(course.montant)}.`); terminer();
  };

  const niveau = approche ? traficReel(approche.durationSeconds, approche.fluideSeconds) : null;
  const restant = course?.offreJusqua ? Math.max(0, Math.round((course.offreJusqua - Date.now()) / 1000)) : 0;
  const [, rafraichir] = useState(0);
  useEffect(() => { if (etape !== 'offre') return; const id = window.setInterval(() => rafraichir((n) => n + 1), 1000); return () => window.clearInterval(id); }, [etape]);
  useEffect(() => { if (etape === 'offre' && restant <= 0 && course) { noter('Offre expirée.'); void majCourse(course.id, { statut: 'expiree' }); terminer(); } });

  return (
    <div className={`ct ${resolved === 'light' ? 'clair' : 'sombre'}`}>
      <CarteTest client={client?.position ?? null} chauffeur={position} approche={etape === 'libre' || etape === 'approche' || etape === 'acceptee' || etape === 'offre' ? approche?.geometrie ?? null : null}
        trajet={trajetCourse?.geometrie ?? null} destination={course ? { lat: course.destination.lat, lng: course.destination.lng } : null} />
      <section className="ct-feuille">
        <header className="ct-tete">
          <div>
            <strong>ORION Console test</strong>
            <span>Chauffeur virtuel · temps réel</span>
          </div>
          <button className={`toggle${enLigne ? ' on' : ''}`} role="switch" aria-checked={enLigne} aria-label="En ligne"
            disabled={etape !== 'libre'} onClick={() => setEnLigne((v) => !v)}><span /></button>
        </header>

        <div className="ct-carte">
          <div className="ct-ligne"><span>Client</span>
            <strong>{client?.position ? `${client.nom} · position reçue il y a ${Math.max(0, Math.round((Date.now() - client.majLe) / 1000))} s` : 'Ouvrez l’app ORION Test : sa position apparaîtra ici.'}</strong>
          </div>
          <div className="ct-ligne"><span>Chauffeur</span><strong>{enLigne ? (etape === 'libre' ? 'En ligne, libre' : 'En course') : 'Hors ligne'} · {VEHICULES[gamme]}</strong></div>
          <div className="chips" role="group" aria-label="Gamme">
            {['argent', 'or', 'diamant'].map((g) => (
              <button key={g} className={`chip${gamme === g ? ' active' : ''}`} disabled={etape !== 'libre'} onClick={() => setGamme(g)}>{g === 'argent' ? 'Argent' : g === 'or' ? 'Or' : 'Diamant'}</button>
            ))}
          </div>
        </div>

        {etape === 'libre' && (
          <div className="ct-carte">
            <label className="ct-curseur">
              <span>Distance au client : <strong>{distanceKm.toFixed(1).replace('.', ',')} km</strong> (à vol d’oiseau)</span>
              <input type="range" min={0.3} max={20} step={0.1} value={distanceKm} onChange={(e) => setDistanceKm(Number(e.target.value))} />
            </label>
            <div className="ct-km">
              {[0.5, 1, 2, 3, 5, 8, 12].map((k) => <button key={k} className={`chip${distanceKm === k ? ' active' : ''}`} onClick={() => setDistanceKm(k)}>{String(k).replace('.', ',')} km</button>)}
            </div>
            <div className="chips" role="group" aria-label="Direction">
              {DIRECTIONS.map(([nom, cap]) => <button key={nom} className={`chip${direction === cap ? ' active' : ''}`} onClick={() => setDirection(cap)}>{nom}</button>)}
            </div>
            <p className="ct-approche">
              {approche && client?.position
                ? <>Approche par la route : <strong>{km(approche.distanceMeters)}</strong> · <strong>{minutes(approche.durationSeconds)}</strong> avec le trafic ({minutes(approche.fluideSeconds)} sans){niveau && <> · trafic <strong>{niveau.level === 'jam' ? 'embouteillé' : niveau.level === 'dense' ? 'dense' : 'fluide'}</strong></>}{!approche.google && ' (estimation hors Google)'}</>
                : 'L’approche s’affiche dès que la position du client est connue.'}
            </p>
          </div>
        )}

        {course && etape !== 'libre' && (
          <div className="ct-carte ct-course">
            <div className="ct-ligne"><span>Client</span><strong>{course.client.nom}</strong></div>
            <div className="ct-ligne"><span>Départ</span><strong>{course.origine.nom}</strong></div>
            <div className="ct-ligne"><span>Arrivée</span><strong>{course.destination.nom}</strong></div>
            <div className="ct-ligne"><span>Prix fixe</span><strong>{fcfa(course.montant)} · {course.paiement === 'cash' ? 'Espèces' : course.paiement}</strong></div>
            {course.miseADisposition
              ? <div className="ct-ligne"><span>Mise à disposition</span><strong>{course.miseADisposition.heures} h avec le client</strong></div>
              : <div className="ct-ligne"><span>Trajet</span><strong>{km(course.distanceMetres)} · {minutes(course.dureeSecondes)}</strong></div>}
            {course.itineraire && <div className="ct-ligne"><span>Itinéraire</span><strong>{course.itineraire.choix === 'peage' ? `Pont à péage · ${fcfa(course.itineraire.peage)} compris` : 'Voie normale (sans péage)'}</strong></div>}

            {etape === 'offre' && (<>
              <p className="ct-compte">Répondez dans {restant} s</p>
              <div className="ct-boutons"><button className="btn btn-ghost" onClick={() => void refuser()}>Refuser</button><button className="btn btn-primary" onClick={() => void accepter()}>Accepter</button></div>
            </>)}
            {(etape === 'acceptee' || etape === 'approche') && (<>
              <VitesseSimulation vitesse={vitesse} onVitesse={setVitesse} />
              <div className="ct-boutons">
                {etape === 'acceptee' && <button className="btn btn-primary" onClick={() => void partir()}>Partir vers le client</button>}
                <button className={`btn ${etape === 'approche' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => void arriver()}>Je suis arrivé</button>
              </div>
            </>)}
            {etape === 'arrivee' && (<>
              <label className="ct-code"><span>Code du client</span>
                <input inputMode="numeric" maxLength={4} value={code} placeholder="••••" onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 4)); setErreurCode(''); }} />
              </label>
              {erreurCode && <p className="ct-erreur" role="alert">{erreurCode}</p>}
              <button className="btn btn-primary" disabled={code.length !== 4} onClick={() => void demarrer()}>Vérifier le code et démarrer</button>
            </>)}
            {etape === 'en_cours' && (<>
              <VitesseSimulation vitesse={vitesse} onVitesse={setVitesse} />
              <button className="btn btn-primary" onClick={() => void finir()}>Terminer la course</button>
            </>)}
            {etape === 'terminee' && (course.paiement === 'cash'
              ? <button className="btn btn-primary" onClick={() => void especes()}>Espèces reçues · {fcfa(course.montant)}</button>
              : <p className="ct-compte">En attente du paiement dans l’app client…</p>)}
          </div>
        )}

        <div className="ct-journal">
          <strong>Journal</strong>
          {journal.length === 0 && <span className="ct-vide">Rien pour l’instant.</span>}
          {journal.map((l) => <span key={l.at + l.texte}><time>{new Date(l.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time> {l.texte}</span>)}
        </div>
      </section>
    </div>
  );
}

function VitesseSimulation({ vitesse, onVitesse }: { vitesse: number; onVitesse: (v: number) => void }) {
  return (
    <div className="chips" role="group" aria-label="Vitesse de la voiture">
      {VITESSES.map((v) => <button key={v} className={`chip${vitesse === v ? ' active' : ''}`} onClick={() => onVitesse(v)}>{v === 1 ? 'Vitesse réelle' : `× ${v}`}</button>)}
    </div>
  );
}

/** Carte Google de la console : trafic en direct, client, chauffeur, approche et trajet. */
function CarteTest({ client, chauffeur, approche, trajet, destination }: { client: LatLng | null; chauffeur: LatLng | null; approche: LatLng[] | null; trajet: LatLng[] | null; destination: LatLng | null }) {
  const { resolved } = useTheme();
  const boite = useRef<HTMLDivElement>(null);
  const g = useRef<GoogleMaps | null>(null);
  const carte = useRef<GMap | null>(null);
  const [prete, setPrete] = useState(false);
  const [echec, setEchec] = useState(false);
  const reperes = useRef<{ client?: ReturnType<typeof poserRepere>; voiture?: ReturnType<typeof poserRepere>; arrivee?: ReturnType<typeof poserRepere> }>({});
  const lignes = useRef<{ approche?: GPolyline; trajet?: GPolyline }>({});
  const precedente = useRef<LatLng | null>(null);
  const cadree = useRef(false);

  useEffect(() => {
    let annule = false;
    void chargerGoogle().then((api) => {
      if (annule || !boite.current) return;
      g.current = api;
      const centre = client ?? { lat: 5.3458, lng: -4.001 };
      const m = new api.Map(boite.current, optionsCarte(api, resolved !== 'light', centre, 14));
      traficEnDirect(api, m);
      carte.current = m;
      api.event.addListenerOnce(m, 'idle', () => { if (!annule) setPrete(true); });
    }).catch(() => { if (!annule) setEchec(true); });
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  const element = (html: string, classe: string) => { const d = document.createElement('div'); d.className = classe; d.innerHTML = html; return d; };
  useEffect(() => {
    const api = g.current, m = carte.current;
    if (!prete || !api || !m) return;
    const R = reperes.current;
    if (client) {
      R.client ??= poserRepere(api, m, element('<span></span>', 'ct-repere-client'), client);
      R.client.placer(client);
    }
    if (chauffeur) {
      const angle = precedente.current && ecart(precedente.current, chauffeur) > 3 ? capEntre(precedente.current, chauffeur) : undefined;
      R.voiture ??= poserRepere(api, m, element(`<img src="${rendu('voiture-dessus')}" width="22" height="44" alt="" draggable="false" />`, 'ct-repere-voiture'), chauffeur);
      R.voiture.placer(chauffeur, angle);
      precedente.current = chauffeur;
    }
    if (destination) {
      R.arrivee ??= poserRepere(api, m, element('<span></span>', 'ct-repere-arrivee'), destination, 'bas');
      R.arrivee.placer(destination);
    } else if (R.arrivee) { R.arrivee.retirer(); R.arrivee = undefined; }
    const L = lignes.current;
    L.approche ??= new api.Polyline({ map: m, strokeColor: '#2563eb', strokeOpacity: 0.85, strokeWeight: 5 });
    L.approche.setPath(approche ?? []);
    L.trajet ??= new api.Polyline({ map: m, strokeColor: '#16a34a', strokeOpacity: 0.9, strokeWeight: 5 });
    L.trajet.setPath(trajet ?? []);
    // Cadrage : client et chauffeur visibles (une fois, puis à la demande du bouton).
    if (!cadree.current && client && chauffeur) { cadrer(); cadree.current = true; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prete, client?.lat, client?.lng, chauffeur?.lat, chauffeur?.lng, approche, trajet, destination?.lat, destination?.lng]);

  const cadrer = () => {
    const api = g.current, m = carte.current;
    if (!api || !m) return;
    const b = new api.LatLngBounds();
    for (const p of [client, chauffeur, destination, ...(approche ?? []), ...(trajet ?? [])]) if (p) b.extend(p);
    m.fitBounds(b, 48);
  };
  const points = useMemo(() => [client, chauffeur].filter(Boolean).length, [client, chauffeur]);
  return (
    <div className="ct-carte-hote">
      <div ref={boite} className="ct-carte-google" />
      {echec && <p className="ct-carte-echec">Google Maps ne répond pas (connexion ou clé). La console fonctionne quand même.</p>}
      {points > 0 && <button className="ct-recadrer" onClick={cadrer}>Recadrer</button>}
    </div>
  );
}
