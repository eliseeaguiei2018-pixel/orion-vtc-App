import { useEffect, useRef, useState } from 'react';
import { AGENT_GENERIQUE, EMERGENCY_NUMBERS, type SosSuivi } from '../../api';
import { IconPhone, IconShield } from '../../icons';
import type { DriverApp } from '../useDriver';

const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/**
 * SUIVI DE SON ALERTE SOS — le même que celui du passager (mêmes styles, mêmes
 * étapes) : alerte reçue, prise en charge nominative par un agent ORION, secours
 * réellement sollicités, chat discret, clôture. Rien n'est affiché par anticipation :
 * un secours n'apparaît « prévenu » que lorsqu'un agent l'a effectivement appelé.
 */
export function SosLive({ app }: { app: DriverApp }) {
  const suivi = app.sosLive!;
  const [texte, setTexte] = useState('');
  const fin = useRef<HTMLDivElement>(null);
  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [suivi.chat.length]);
  const close = suivi.clotureeA !== null;
  const envoyer = (x: string) => { const v = x.trim(); if (v) { void app.actions.sosRepondre(v); setTexte(''); } };
  const agent = (a: string) => (a === AGENT_GENERIQUE ? 'Prise en charge par la supervision ORION' : `Prise en charge par ${a}, agent ORION`);
  const libelleSecours = (s: SosSuivi['secours'][number]) =>
    s.issue === 'joint' ? `${s.service} (${s.numero}) prévenu par ORION`
      : s.issue === 'tentative'
        ? (s.canal === 'appel' ? `ORION appelle ${s.service} (${s.numero})…` : `Votre position a été transmise à ${s.service}`)
        : `${s.service} (${s.numero}) injoignable — ORION insiste`;
  const numeros: Array<[string, string]> = [['SAMU', EMERGENCY_NUMBERS.samu], ['Police', EMERGENCY_NUMBERS.police], ['Pompiers', EMERGENCY_NUMBERS.pompiers]];

  return (
    <div className="sos-live" role="dialog" aria-live="polite" aria-label="Suivi de votre alerte SOS">
      <div className={`sos-live-head${close ? ' done' : ''}`}>
        <div className="row between">
          <span className="sos-live-badge">{close ? '✓' : 'SOS'}</span>
          {!close && <button className="sos-live-min" onClick={app.actions.sosReduire}>Réduire</button>}
        </div>
        <h2>{close ? 'Alerte clôturée' : 'Votre alerte est suivie'}</h2>
        <p>Envoyée à {heure(suivi.createdAt)}{suivi.zoneName ? ` · ${suivi.zoneName}` : ''}</p>
      </div>

      <div className="sos-live-body">
        {app.sosHorsLigne && !close && <p className="sos-offline">Connexion instable — votre alerte reste active côté ORION.</p>}
        <ol className="sos-steps">
          <li className="ok"><span className="dot" /><span className="grow">Alerte reçue par la supervision ORION</span><time>{heure(suivi.createdAt)}</time></li>
          {suivi.priseEnCharge
            ? <li className="ok"><span className="dot" /><span className="grow">{agent(suivi.priseEnCharge.agent)}</span><time>{heure(suivi.priseEnCharge.at)}</time></li>
            : !close && <li className="wait"><span className="dot" /><span className="grow">Un agent ORION va prendre votre alerte</span></li>}
          {suivi.secours.length > 0
            ? suivi.secours.map((s, i) => (
              <li key={i} className={s.issue === 'joint' || (s.issue === 'tentative' && s.canal !== 'appel') ? 'ok rescue' : s.issue === 'tentative' ? 'wait rescue' : 'warn'}>
                <span className="dot" /><span className="grow">{libelleSecours(s)}</span><time>{heure(s.at)}</time>
              </li>
            ))
            : !close && <li className="idle"><span className="dot" /><span className="grow">Aucun secours sollicité pour l’instant</span></li>}
          {close && <li className="ok"><span className="dot" /><span className="grow">Alerte clôturée</span><time>{heure(suivi.clotureeA!)}</time></li>}
        </ol>

        {!close && <p className="sos-geo"><IconShield size={14} /> Votre position est partagée avec la supervision ORION.</p>}

        <div className="sos-chat-box">
          <span className="eyebrow">Échange discret avec l’agent</span>
          <div className="sos-chat">
            {suivi.chat.map((m, i) => (
              <div key={i} className={`sos-bubble ${m.from}`}>
                <span>{m.text}</span>
                <small>{m.from === 'agent' ? (m.author ?? 'ORION') : 'Vous'} · {heure(m.at)}</small>
              </div>
            ))}
            <div ref={fin} />
          </div>
          {!close && (
            <>
              <div className="sos-quick">
                {['Je suis en sécurité', 'Je ne peux pas parler', 'Envoyez de l’aide'].map((q) => (
                  <button key={q} className="chip" onClick={() => envoyer(q)}>{q}</button>
                ))}
              </div>
              <div className="sos-input">
                <input value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Écrire à l’agent…" onKeyDown={(e) => { if (e.key === 'Enter') envoyer(texte); }} />
                <button className="btn btn-primary" onClick={() => envoyer(texte)}>Envoyer</button>
              </div>
            </>
          )}
        </div>

        <span className="eyebrow" style={{ display: 'block', marginTop: 14 }}>Appeler directement</span>
        <div className="sos-direct">
          {numeros.map(([label, num]) => (
            <a key={num} href={`tel:${num}`}><IconPhone size={15} /> <strong>{num}</strong> <span>{label}</span></a>
          ))}
        </div>
        {close && <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={app.actions.sosFermer}>Fermer</button>}
      </div>
    </div>
  );
}

/** Rappel permanent d'une alerte ouverte quand le panneau est réduit. */
export function SosPill({ app }: { app: DriverApp }) {
  const s = app.sosLive!;
  const joint = s.secours.find((x) => x.issue === 'joint');
  const etape = s.clotureeA ? 'Alerte clôturée'
    : joint ? `${joint.service} prévenu par ORION`
      : s.priseEnCharge ? (s.priseEnCharge.agent === AGENT_GENERIQUE ? 'Prise en charge par la supervision' : `Prise en charge par ${s.priseEnCharge.agent}`)
        : 'Alerte reçue par la supervision ORION';
  return (
    <button className="sos-pill" onClick={app.actions.sosOuvrir}>
      <span className="sos-pill-dot" /> <strong>SOS</strong> <span className="grow">{etape}</span>
    </button>
  );
}
