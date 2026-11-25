import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { IconClose, IconImage } from '../icons';
import { chargerMedias, mediasPour, type MediaVehicule, type ServiceMedia, type ValeurOption } from '../medias';

/**
 * VITRINE DU VÉHICULE — photos et vidéos réelles, selon les options choisies.
 *
 * Elle se met à jour dès que le client change de véhicule ou d'option. Sans média
 * enregistré pour ce choix, elle montre le modèle en volume (`secours`) et l'annonce :
 * aucune image d'un autre véhicule n'est présentée à la place.
 */
export function GalerieVehicule({ service, vehicule, options, titre, secours }: {
  service: ServiceMedia; vehicule: string; options: Record<string, ValeurOption>;
  /** Nom du véhicule choisi, affiché au-dessus de la vitrine. */
  titre: string;
  /** Rendu en volume du véhicule, montré tant qu'aucune photo réelle n'existe. */
  secours: ReactNode;
}) {
  const { t } = useI18n();
  const [liste, setListe] = useState<MediaVehicule[] | null>(null);
  const [grand, setGrand] = useState<number | null>(null);
  const [vue, setVue] = useState(0);
  const piste = useRef<HTMLDivElement>(null);
  useEffect(() => { let vivant = true; void chargerMedias().then((l) => { if (vivant) setListe(l); }); return () => { vivant = false; }; }, []);

  const cle = `${service}|${vehicule}|${JSON.stringify(options)}`;
  const medias = liste ? mediasPour(liste, service, vehicule, options) : [];
  // Nouveau choix : on revient à la première image.
  useEffect(() => { setVue(0); setGrand(null); piste.current?.scrollTo({ left: 0 }); }, [cle]);

  const defile = () => {
    const el = piste.current;
    if (el) setVue(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  };
  const media = (m: MediaVehicule, plein = false) => (m.type === 'video'
    ? <video src={m.src} poster={m.affiche} controls playsInline preload="metadata" muted={!plein} />
    : <img src={m.src} alt={m.legende ?? titre} loading="lazy" decoding="async" />);

  return (
    <section className="vitrine" aria-label={t('vit_titre')}>
      <header>
        <span className="eyebrow"><IconImage size={13} /> {t('vit_titre')}</span>
        <strong>{titre}</strong>
      </header>
      {medias.length === 0 ? (
        <div className="vitrine-vide">
          <div className="vitrine-rendu">{secours}</div>
          <p>{liste === null ? '…' : t('vit_vide')}</p>
        </div>
      ) : (
        <>
          <div className="vitrine-piste" ref={piste} onScroll={defile}>
            {medias.map((m, i) => (
              <figure key={`${m.src}-${i}`} className="vitrine-media">
                {m.type === 'image'
                  ? <button type="button" onClick={() => setGrand(i)} aria-label={t('vit_agrandir')}>{media(m)}</button>
                  : media(m)}
                {m.legende && <figcaption>{m.legende}</figcaption>}
              </figure>
            ))}
          </div>
          {medias.length > 1 && (
            <div className="vitrine-points" aria-hidden="true">{medias.map((_, i) => <i key={i} className={i === vue ? 'on' : ''} />)}</div>
          )}
          <p className="vitrine-compte">{t('vit_compte', { n: vue + 1, t: medias.length })}</p>
        </>
      )}
      {grand !== null && medias[grand] && (
        <div className="vitrine-plein" role="dialog" aria-modal="true" aria-label={medias[grand]!.legende ?? titre} onClick={() => setGrand(null)}>
          <button className="bulle" onClick={() => setGrand(null)} aria-label={t('vit_fermer')}><IconClose size={20} /></button>
          <div onClick={(e) => e.stopPropagation()}>{media(medias[grand]!, true)}</div>
          {medias[grand]!.legende && <p>{medias[grand]!.legende}</p>}
        </div>
      )}
    </section>
  );
}
