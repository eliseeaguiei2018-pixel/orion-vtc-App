import { useEffect, useState } from 'react';
import { IconAlert, IconAward, IconCheck, IconClock } from '../../icons';
import type { ScreenProps } from '../Driver';
import { Banner, BellButton, PageHeader, Progress, Section } from '../ui';
import { fcfa } from '../format';
import { localeCourante, tr } from '../i18n';
import { decalerMois, libelleMois, moisCourant, type PrimeMois } from '../salarie';
import { ChoixMois } from './Activite';

/**
 * PRIME DE PERFORMANCE — chauffeur salarié d'ORION.
 *
 * Le palier dépend du nombre de courses réalisées dans le mois ; il n'est acquis que si
 * les conditions de qualité sont tenues (note, acceptation des offres, annulations). Deux
 * bonus s'ajoutent (excellence, assiduité). La grille est réglée par ORION dans la console ;
 * la prime est versée avec le salaire, après validation de fin de mois.
 */
export function Prime({ app, unread, openNotices }: ScreenProps) {
  const [mois, setMois] = useState(moisCourant());
  const [prime, setPrime] = useState<PrimeMois | null>(null);
  const [erreur, setErreur] = useState(false);
  useEffect(() => {
    void app.backend.prime(mois).then((p) => { setPrime(p); setErreur(false); }).catch(() => setErreur(true));
  }, [app.backend, app.settled, mois]);

  const p = prime;
  const dernier = p?.paliers[p.paliers.length - 1];
  const tenues = p ? p.conditions.every((c) => c.ok) : true;
  const versement = libelleMois(decalerMois(mois, 1), localeCourante());

  return (
    <div className="dv-page">
      <PageHeader title={tr('Prime de performance')} sub={tr('Grille fixée par ORION')} right={<BellButton count={unread} onClick={openNotices} />}>
        <ChoixMois mois={mois} onMois={setMois} />
      </PageHeader>

      <div className={`dv-solde dv-solde-pose${p && !tenues ? ' neg' : ''}`}>
        <span className="dv-stat-label"><IconAward size={14} /> {p?.clos ? tr('Prime du mois') : tr('Prime estimée à ce jour')}</span>
        <span className="dv-solde-montant">{p ? fcfa(p.montantEstime) : '—'}</span>
        <span className="dv-solde-sub">
          {!p ? tr('Chargement…')
            : !p.actif ? tr('Pas de prime de performance ce mois-ci.')
              : tr('Jusqu’à {0} possibles · versée avec le salaire de {1}', [fcfa(p.montantMax), versement])}
        </span>
      </div>

      {erreur && !p && (
        <Banner tone="warn" icon={<IconAward size={18} />} title={tr('Prime indisponible')}>
          {tr('Le serveur ORION ne répond pas pour le moment. Réessayez dans un instant.')}
        </Banner>
      )}

      {p?.actif && (
        <>
          <Section title={tr('Paliers de courses')}>
            <div className="card" style={{ padding: 14 }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <strong className="tnum">{tr('{0} course(s) réalisée(s)', [p.courses])}</strong>
                {dernier && <span className="muted tnum">/ {dernier.courses}</span>}
              </div>
              <Progress value={p.courses} max={dernier?.courses ?? 1} tone={p.palier ? 'gold' : 'green'} />
              <div className="dv-paliers">
                {p.paliers.map((x) => {
                  const atteint = p.courses >= x.courses;
                  return (
                    <div key={x.courses} className={`dv-palier${atteint ? ' on' : ''}`}>
                      <span className="dv-palier-ico">{atteint ? <IconCheck size={14} /> : <IconClock size={14} />}</span>
                      <span className="grow">{tr('{0} courses', [x.courses])}</span>
                      <strong className="tnum">{fcfa(x.montant)}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="dv-item-sub" style={{ marginTop: 8 }}>
                {p.prochain
                  ? tr('Encore {0} course(s) pour le palier de {1}.', [p.prochain.reste, fcfa(p.prochain.montant)])
                  : tr('Palier le plus haut atteint. Bravo.')}
              </div>
            </div>
          </Section>

          <Section title={tr('Conditions de qualité')}>
            {!tenues && (
              <Banner tone="danger" icon={<IconAlert size={18} />} title={tr('Une condition n’est pas tenue')}>
                {tr('Tant qu’elle ne l’est pas, la prime du palier et les bonus ne sont pas acquis.')}
              </Banner>
            )}
            <div className="col" style={{ gap: 8 }}>
              {p.conditions.map((c) => (
                <div key={c.id} className={`card dv-condition${c.ok ? ' ok' : ' ko'}`}>
                  <span className="dv-palier-ico">{c.ok ? <IconCheck size={14} /> : <IconAlert size={14} />}</span>
                  <div className="grow">
                    <div className="dv-item-title">{tr(c.libelle)}</div>
                    <div className="dv-item-sub tnum">
                      {c.enAttente ? tr('Pas encore de données ce mois-ci')
                        : c.id === 'note' ? tr('Votre note : {0}', [c.valeur?.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) ?? '—'])
                          : c.id === 'acceptation' ? tr('Votre taux : {0} %', [c.valeur ?? 0])
                            : tr('Vos annulations : {0}', [c.valeur ?? 0])}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {p.bonus.length > 0 && (
            <Section title={tr('Bonus')}>
              <div className="col" style={{ gap: 8 }}>
                {p.bonus.map((b) => (
                  <div key={b.id} className={`card dv-condition${b.acquis ? ' ok' : ''}`}>
                    <span className="dv-palier-ico">{b.acquis ? <IconCheck size={14} /> : <IconAward size={14} />}</span>
                    <div className="grow">
                      <div className="row between"><span className="dv-item-title">{tr(b.libelle)}</span><strong className="tnum">+ {fcfa(b.montant)}</strong></div>
                      <div className="dv-item-sub">{b.detail}</div>
                      {!b.acquis && <div style={{ marginTop: 6 }}><Progress value={b.progression} max={1} /></div>}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      <div className="faint" style={{ fontSize: 12, padding: '0 4px 12px' }}>
        {tr('Montant indicatif, calculé en direct par le serveur ORION. La prime définitive est validée par ORION en fin de mois.')}
      </div>
    </div>
  );
}
