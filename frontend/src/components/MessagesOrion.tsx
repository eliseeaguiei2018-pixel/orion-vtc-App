import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { TopBar } from './ui';
import { IconMessage, IconShieldCheck, IconBell, IconCheck } from '../icons';
import { listerMessages, marquerMessageLu, repondreMessage, sessionClient, type MessageOrion } from '../api';

/**
 * MESSAGERIE ORION (app cliente).
 *
 * La supervision écrit au client (consignes, informations) et, pendant une course,
 * l'app lui demande s'il est en sécurité. Il répond d'un geste. « Je ne me sens pas en
 * sécurité » vaut un SOS : le serveur lève l'alerte, l'app le confirme aussitôt.
 */

export function useMessagerie() {
  const [messages, setMessages] = useState<MessageOrion[]>([]);
  const [nonLus, setNonLus] = useState(0);
  const actif = Boolean(sessionClient());
  const rafraichir = useCallback(async () => {
    if (!actif) return;
    const r = await listerMessages();
    if (r) { setMessages(r.messages); setNonLus(r.nonLus); }
  }, [actif]);
  useEffect(() => {
    if (!actif) return;
    void rafraichir();
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void rafraichir(); }, 8000);
    return () => window.clearInterval(id);
  }, [actif, rafraichir]);
  /** Message reçu en direct (canal de la course) : affiché sans attendre le prochain relevé. */
  const recevoir = useCallback((m: MessageOrion) => {
    setMessages((liste) => (liste.some((x) => x.id === m.id) ? liste : [m, ...liste]));
    setNonLus((n) => n + 1);
  }, []);
  const lu = useCallback(async (id: string) => {
    setMessages((l) => l.map((m) => (m.id === id && !m.luLe ? { ...m, luLe: new Date().toISOString() } : m)));
    const n = await marquerMessageLu(id);
    if (n !== null) setNonLus(n);
  }, []);
  const repondre = useCallback(async (id: string, code: string) => {
    const r = await repondreMessage(id, code);
    if (r) setMessages((l) => l.map((m) => (m.id === id ? r.message : m)));
    void rafraichir();
    return r;
  }, [rafraichir]);
  return { messages, nonLus, rafraichir, recevoir, lu, repondre, actif };
}

export function BoutonMessages({ nonLus, onClick, clair = false }: { nonLus: number; onClick: () => void; clair?: boolean }) {
  const { t } = useI18n();
  return (
    <button className={`avatar bouton-messages${clair ? ' clair' : ''}`} onClick={onClick} aria-label={`${t('msg_titre')}${nonLus ? ` (${nonLus})` : ''}`}>
      <IconMessage size={20} />
      {nonLus > 0 && <span className="pastille-messages">{nonLus > 9 ? '9+' : nonLus}</span>}
    </button>
  );
}

const quand = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const typeLibelle = { controle: 'msg_controle', consigne: 'msg_consigne', info: 'msg_info' } as const;

function CarteMessage({ m, onRepondre, alerte }: { m: MessageOrion; onRepondre: (code: string) => void; alerte?: boolean }) {
  const { t } = useI18n();
  return (
    <article className={`message-orion ${m.type}${m.luLe ? '' : ' nouveau'}`}>
      <header>
        <span className="message-type">{m.type === 'controle' ? <IconShieldCheck size={14} /> : <IconBell size={14} />} {t(typeLibelle[m.type])}</span>
        <time>{quand(m.envoyeLe)}</time>
      </header>
      <h3>{m.titre}</h3>
      <p>{m.texte}</p>
      <footer className="faint">{m.auteur}</footer>
      {m.reponse
        ? <p className="message-repondu"><IconCheck size={14} /> {t('msg_repondu', { r: m.reponse.libelle })}</p>
        : m.clos ? <p className="message-clos">{t('msg_clos')}</p>
        : m.reponses.length > 0 && (
          <div className="reponses-rapides">
            {m.reponses.map((r) => (
              <button key={r.code} className={`reponse-rapide${r.alerte ? ' danger' : ''}`} onClick={() => onRepondre(r.code)}>{r.libelle}</button>
            ))}
          </div>
        )}
      {alerte && <p className="message-alerte" role="alert">{t('msg_alerte')}</p>}
    </article>
  );
}

export function MessagesScreen({ messagerie, onBack }: { messagerie: ReturnType<typeof useMessagerie>; onBack: () => void }) {
  const { t } = useI18n();
  const [alertes, setAlertes] = useState<Record<string, boolean>>({});
  const vus = useRef(false);
  useEffect(() => {
    if (vus.current) return;
    vus.current = true;
    for (const m of messagerie.messages) if (!m.luLe) void messagerie.lu(m.id);
  }, [messagerie]);
  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('msg_titre')} />
      <div className="page-body">
        {messagerie.messages.length === 0
          ? <div className="messages-vide"><IconMessage size={34} /><p>{t('msg_vide')}</p></div>
          : (
            <div className="stack">
              {messagerie.messages.map((m) => (
                <CarteMessage key={m.id} m={m} alerte={alertes[m.id]} onRepondre={(code) => void messagerie.repondre(m.id, code).then((r) => {
                  if (r?.alerteId) setAlertes((a) => ({ ...a, [m.id]: true }));
                })} />
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

/**
 * Contrôle de sécurité pendant la course : une carte s'ouvre par-dessus le suivi.
 * Le client répond d'un geste, ou la referme (la question reste dans ses messages).
 */
export function ControleSecurite({ messagerie, rideId }: { messagerie: ReturnType<typeof useMessagerie>; rideId?: string | null }) {
  const { t } = useI18n();
  const [fermes, setFermes] = useState<string[]>([]);
  const [alerte, setAlerte] = useState(false);
  const m = messagerie.messages.find((x) => x.type === 'controle' && !x.reponse && !fermes.includes(x.id) && (!rideId || !x.rideId || x.rideId === rideId));
  const [repondu, setRepondu] = useState<MessageOrion | null>(null);
  if (!m && !repondu) return null;
  const affiche = repondu ?? m!;
  return (
    <div className="controle-voile" role="dialog" aria-modal="true" aria-label={affiche.titre}>
      <div className="controle-carte">
        <span className="controle-ico"><IconShieldCheck size={26} /></span>
        <h3>{affiche.titre}</h3>
        <p>{affiche.texte}</p>
        {repondu
          ? (
            <>
              <p className={alerte ? 'message-alerte' : 'message-repondu'}>{alerte ? t('msg_alerte') : t('msg_repondu', { r: repondu.reponse?.libelle ?? '' })}</p>
              <button className="btn btn-ghost" onClick={() => { setRepondu(null); setFermes((f) => [...f, affiche.id]); }}>OK</button>
            </>
          )
          : (
            <>
              <div className="reponses-rapides colonne">
                {affiche.reponses.map((r) => (
                  <button key={r.code} className={`reponse-rapide${r.alerte ? ' danger' : ''}`} onClick={() => void messagerie.repondre(affiche.id, r.code).then((res) => {
                    if (res) { setAlerte(Boolean(res.alerteId)); setRepondu(res.message); void messagerie.lu(affiche.id); }
                  })}>{r.libelle}</button>
                ))}
              </div>
              <button className="btn btn-ghost controle-plus-tard" onClick={() => setFermes((f) => [...f, affiche.id])}>{t('msg_plus_tard')}</button>
            </>
          )}
      </div>
    </div>
  );
}
