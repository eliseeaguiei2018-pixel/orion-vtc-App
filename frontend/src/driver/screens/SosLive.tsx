import { useEffect, useRef, useState } from 'react';
import { AGENT_GENERIQUE, EMERGENCY_NUMBERS, type SosSuivi } from '../../api';
import { IconPhone, IconShield } from '../../icons';
import type { DriverApp } from '../useDriver';
import { aTraduire, localeCourante, tr } from '../i18n';

const heure = (iso: string) => new Date(iso).toLocaleTimeString(localeCourante(), { hour: '2-digit', minute: '2-digit' });

/**
 * SUIVI DE SON ALERTE SOS — le même que celui du passager (mêmes styles, mêmes
 * étapes) : alerte reçue, prise en charge nominative par un agent ORION, secours
 * réellement sollicités, chat discret, clôture. Rien n'est affiché par anticipation :
 * un secours n'apparaît « prévenu » que lorsqu'un agent l'a effectivement appelé.
 */
export function SosLive({ app }: { app: DriverApp }) {
  const suivi = app.sosLive!;
  const [texte, setTexte] = useState('');
  // Fin de l'alerte par le chauffeur lui-même : motif demandé, l'agent ORION en est informé.
  const [finOuverte, setFinOuverte] = useState(false);
  const [finEnvoi, setFinEnvoi] = useState(false);
  const [finEchec, setFinEchec] = useState(false);
  const terminer = async (motif: 'en_securite' | 'fausse_alerte') => {
    setFinEnvoi(true); setFinEchec(false);
    const ok = await app.actions.sosTerminer(motif);
    setFinEnvoi(false);
    if (ok) setFinOuverte(false); else setFinEchec(true);
  };
  const fin = useRef<HTMLDivElement>(null);
  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [suivi.chat.length]);
  const close = suivi.clotureeA !== null;
  const envoyer = (x: string) => { const v = x.trim(); if (v) { void app.actions.sosRepondre(v); setTexte(''); } };
  const agent = (a: string) => (a === AGENT_GENERIQUE ? tr('Prise en charge par la supervision ORION') : tr('Prise en charge par {0}, agent ORION', [a]));
  const libelleSecours = (s: SosSuivi['secours'][number]) =>
    s.issue === 'joint' ? tr('{0} ({1}) prévenu par ORION', [s.service, s.numero])
      : s.issue === 'tentative'
        ? (s.canal === 'appel' ? tr('ORION appelle {0} ({1})…', [s.service, s.numero]) : tr('Votre position a été transmise à {0}', [s.service]))
        : tr('{0} ({1}) injoignable — ORION insiste', [s.service, s.numero]);
  const numeros: Array<[string, string]> = [[tr('SAMU'), EMERGENCY_NUMBERS.samu], [tr('Police'), EMERGENCY_NUMBERS.police], [tr('Pompiers'), EMERGENCY_NUMBERS.pompiers]];

  return (
    <div className="sos-live" role="dialog" aria-live="polite" aria-label={tr('Suivi de votre alerte SOS')}>
      <div className={`sos-live-head${close ? ' done' : ''}`}>
        <div className="row between">
          <span className="sos-live-badge">{close ? '✓' : tr('SOS')}</span>
          {!close && <button className="sos-live-min" onClick={app.actions.sosReduire}>{tr('Réduire')}</button>}
        </div>
        <h2>{close ? tr('Alerte clôturée') : tr('Votre alerte est suivie')}</h2>
        <p>{tr('Envoyée à {0}{1}', [heure(suivi.createdAt), suivi.zoneName ? ` · ${suivi.zoneName}` : ''])}</p>
      </div>

      <div className="sos-live-body">
        {app.sosHorsLigne && !close && <p className="sos-offline">{tr('Connexion instable — votre alerte reste active côté ORION.')}</p>}
        <ol className="sos-steps">
          <li className="ok"><span className="dot" /><span className="grow">{tr('Alerte reçue par la supervision ORION')}</span><time>{heure(suivi.createdAt)}</time></li>
          {suivi.priseEnCharge
            ? <li className="ok"><span className="dot" /><span className="grow">{agent(suivi.priseEnCharge.agent)}</span><time>{heure(suivi.priseEnCharge.at)}</time></li>
            : !close && <li className="wait"><span className="dot" /><span className="grow">{tr('Un agent ORION va prendre votre alerte')}</span></li>}
          {suivi.secours.length > 0
            ? suivi.secours.map((s, i) => (
              <li key={i} className={s.issue === 'joint' || (s.issue === 'tentative' && s.canal !== 'appel') ? 'ok rescue' : s.issue === 'tentative' ? 'wait rescue' : 'warn'}>
                <span className="dot" /><span className="grow">{libelleSecours(s)}</span><time>{heure(s.at)}</time>
              </li>
            ))
            : !close && <li className="idle"><span className="dot" /><span className="grow">{tr('Aucun secours sollicité pour l’instant')}</span></li>}
          {close && <li className="ok"><span className="dot" /><span className="grow">{tr('Alerte clôturée')}</span><time>{heure(suivi.clotureeA!)}</time></li>}
        </ol>

        {!close && <p className="sos-geo"><IconShield size={14} /> {tr('Votre position est partagée avec la supervision ORION.')}</p>}

        <div className="sos-chat-box">
          <span className="eyebrow">{tr('Échange discret avec l’agent')}</span>
          <div className="sos-chat">
            {suivi.chat.map((m, i) => (
              <div key={i} className={`sos-bubble ${m.from}`}>
                <span>{m.text}</span>
                <small>{m.from === 'agent' ? (m.author ?? 'ORION') : tr('Vous')} · {heure(m.at)}</small>
              </div>
            ))}
            <div ref={fin} />
          </div>
          {!close && (
            <>
              <div className="sos-quick">
                {/* Réponses rapides envoyées en français à l'agent ORION ; affichées dans la langue du chauffeur. */}
                {[aTraduire('Je suis en sécurité'), aTraduire('Je ne peux pas parler'), aTraduire('Envoyez de l’aide')].map((q) => (
                  <button key={q} className="chip" onClick={() => envoyer(q)}>{tr(q)}</button>
                ))}
              </div>
              <div className="sos-input">
                <input value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={tr('Écrire à l’agent…')} onKeyDown={(e) => { if (e.key === 'Enter') envoyer(texte); }} />
                <button className="btn btn-primary" onClick={() => envoyer(texte)}>{tr('Envoyer')}</button>
              </div>
            </>
          )}
        </div>

        <span className="eyebrow" style={{ display: 'block', marginTop: 14 }}>{tr('Appeler directement')}</span>
        <div className="sos-direct">
          {numeros.map(([label, num]) => (
            <a key={num} href={`tel:${num}`}><IconPhone size={15} /> <strong>{num}</strong> <span>{label}</span></a>
          ))}
        </div>
        {!close && !finOuverte && <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => setFinOuverte(true)}>{tr('Mettre fin à l’alerte')}</button>}
        {!close && finOuverte && (
          <div className="sos-fin" role="group" aria-label={tr('Mettre fin à l’alerte')}>
            <p>{tr('Pourquoi mettez-vous fin à l’alerte ? L’agent ORION en sera informé.')}</p>
            <button className="btn btn-primary" disabled={finEnvoi} onClick={() => void terminer('en_securite')}>{tr('Je suis en sécurité')}</button>
            <button className="btn btn-ghost" disabled={finEnvoi} onClick={() => void terminer('fausse_alerte')}>{tr('C’était une fausse alerte')}</button>
            <button className="btn btn-ghost" disabled={finEnvoi} onClick={() => { setFinOuverte(false); setFinEchec(false); }}>{tr('Garder l’alerte active')}</button>
            {finEchec && <p className="sos-offline" role="alert">{tr('Impossible de mettre fin à l’alerte pour l’instant : réessayez. L’alerte reste suivie par ORION.')}</p>}
          </div>
        )}
        {close && <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={app.actions.sosFermer}>{tr('Fermer')}</button>}
      </div>
    </div>
  );
}

/** Rappel permanent d'une alerte ouverte quand le panneau est réduit. */
export function SosPill({ app }: { app: DriverApp }) {
  const s = app.sosLive!;
  const joint = s.secours.find((x) => x.issue === 'joint');
  const etape = s.clotureeA ? tr('Alerte clôturée')
    : joint ? tr('{0} prévenu par ORION', [joint.service])
      : s.priseEnCharge ? (s.priseEnCharge.agent === AGENT_GENERIQUE ? tr('Prise en charge par la supervision') : tr('Prise en charge par {0}', [s.priseEnCharge.agent]))
        : tr('Alerte reçue par la supervision ORION');
  return (
    <button className="sos-pill" onClick={app.actions.sosOuvrir}>
      <span className="sos-pill-dot" /> <strong>{tr('SOS')}</strong> <span className="grow">{etape}</span>
    </button>
  );
}
