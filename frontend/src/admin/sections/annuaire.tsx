import { useState } from 'react';
import { avis, demander } from '../dialogues';
import { ContactRapide, Kpi } from '../ui';
import type { AccountsStats, ContactHandler, RoleOption, StaffAccountRow } from '../types';

/**
 * ANNUAIRE DU PERSONNEL — qui travaille ici, et avec quel identifiant.
 *
 * Les comptes de la console ne venaient que de la configuration du serveur : ouvrir
 * un accès à une nouvelle trésorière ou à un chauffeur imposait d'éditer une
 * variable d'environnement et de redémarrer. Autant dire que personne n'aurait eu
 * de compte. Une entreprise embauche, mute et fait partir des gens toutes les
 * semaines ; cela se gère ici.
 */

const dt = (iso?: string) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais');

export function AnnuaireSection({ comptes, stats, roles, delegables, equipes, peutEcrire, onCreer, onModifier, onReinitialiser, onActiver, onContact }: {
  comptes: StaffAccountRow[];
  stats: AccountsStats | null;
  roles: RoleOption[];
  delegables: string[];
  equipes: Array<{ id: string; name: string }>;
  peutEcrire: boolean;
  onCreer: (p: Record<string, unknown>) => void;
  onModifier: (username: string, p: Record<string, unknown>) => void;
  onReinitialiser: (username: string) => void;
  onActiver: (username: string, active: boolean) => void;
  onContact: ContactHandler;
}) {
  const [q, setQ] = useState('');
  const [nom, setNom] = useState('');
  const [role, setRole] = useState('ops');
  const [service, setService] = useState('');
  const [tel, setTel] = useState('');
  const [email, setEmail] = useState('');
  const [teamId, setTeamId] = useState('');

  const visibles = comptes.filter((c) => {
    if (!q.trim()) return true;
    const n = q.toLowerCase();
    return c.name.toLowerCase().includes(n) || c.username.includes(n) || (c.matricule ?? '').toLowerCase().includes(n);
  });

  return (
    <>
      {stats && (
        <div className="adm-kpis">
          <Kpi label="Comptes" value={String(stats.total)} sub={`${stats.actifs} actif(s)`} tone="teal" />
          <Kpi label="Mots de passe provisoires" value={String(stats.aChangerMdp)} sub="non encore remplacés par l’intéressé" tone={stats.aChangerMdp ? 'blue' : 'green'} />
          <Kpi label="Rôles utilisés" value={String(Object.keys(stats.parRole).length)} sub={Object.entries(stats.parRole).map(([r, n]) => `${r} ${n}`).join(' · ') || '—'} tone="blue" />
          <Kpi label="Désactivés" value={String(stats.total - stats.actifs)} sub="conservés pour l’auditabilité du journal" tone="green" />
        </div>
      )}

      {peutEcrire && (
        <div className="adm-card">
          <div className="adm-card-h">
            <h3>Ouvrir un accès</h3>
            <span className="adm-muted">le mot de passe provisoire ne s’affiche qu’une fois</span>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field" style={{ minWidth: 190 }}><span>Nom complet</span><input className="adm-input" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Awa Diomandé" /></label>
            <label className="field" style={{ minWidth: 200 }}>
              <span>Rôle</span>
              <select className="adm-select" value={role} onChange={(e) => setRole(e.target.value)}>
                {roles
                  .filter((r) => delegables.length === 0 || delegables.includes(r.id) || !delegables.length)
                  .map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </label>
            <label className="field" style={{ minWidth: 150 }}><span>Service</span><input className="adm-input" value={service} onChange={(e) => setService(e.target.value)} placeholder="Finances" /></label>
            <label className="field" style={{ maxWidth: 160 }}><span>Téléphone</span><input className="adm-input" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="0708091011" /></label>
            <label className="field" style={{ minWidth: 190 }}><span>E-mail</span><input className="adm-input" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field" style={{ minWidth: 170 }}>
              <span>Équipe</span>
              <select className="adm-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">Aucune</option>
                {equipes.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <button
              className="adm-btn solid"
              onClick={() => {
                if (nom.trim().length < 2) { avis('Indiquez le nom complet.'); return; }
                onCreer({
                  name: nom.trim(), role,
                  service: service || undefined, phone: tel || undefined,
                  email: email || undefined, teamId: teamId || undefined,
                });
                setNom(''); setService(''); setTel(''); setEmail('');
              }}
            >
              Créer le compte
            </button>
          </div>
          <p className="adm-muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
            L’identifiant est dérivé du nom (« Awa Diomandé » → <span className="mono">awa.diomande</span>).
            Un compte chauffeur se crée depuis la session Équipages, pour qu’il soit rattaché à sa fiche.
          </p>
        </div>
      )}

      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Annuaire</h3>
          <div className="row" style={{ gap: 8 }}>
            <input className="adm-input" style={{ minWidth: 220 }} placeholder="Nom, identifiant, matricule…" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="adm-muted">{visibles.length} compte(s)</span>
          </div>
        </div>
        {visibles.length === 0 ? (
          <p className="adm-empty">Aucun compte ne correspond.</p>
        ) : (
          <table className="adm-table">
            <thead>
              <tr><th>Personne</th><th>Identifiant</th><th>Rôle</th><th>Service / Équipe</th><th>Dernière connexion</th><th>État</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {visibles.map((c) => (
                <tr key={c.username}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.matricule && <> <span className="adm-muted mono" style={{ fontSize: 11.5 }}>{c.matricule}</span></>}
                    <br />
                    <ContactRapide type="support" id={c.username} numero={c.phone ?? null} nom={c.name} onContact={onContact} />
                  </td>
                  <td className="mono">{c.username}</td>
                  <td>{c.roleLabel}<br /><span className="adm-muted" style={{ fontSize: 11.5 }}>{c.permissions} droit(s)</span></td>
                  <td className="adm-muted">{c.service ?? '—'}{c.teamId ? <><br />{equipes.find((e) => e.id === c.teamId)?.name ?? c.teamId}</> : null}</td>
                  <td className="adm-muted">{dt(c.lastLoginAt)}</td>
                  <td>
                    {c.active
                      ? <span className="adm-pill av-online">Actif</span>
                      : <span className="adm-pill tr-rejected">Désactivé</span>}
                    {c.mustChangePassword && c.active && <><br /><span className="adm-pill lvl-jaune">Mot de passe provisoire</span></>}
                    {c.disabledReason && <><br /><span className="adm-muted" style={{ fontSize: 11 }}>{c.disabledReason}</span></>}
                  </td>
                  <td>
                    {peutEcrire ? (
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <button className="adm-btn xs" onClick={() => onReinitialiser(c.username)}>Réinitialiser</button>
                        {c.active
                          ? <button className="adm-btn xs" onClick={() => onActiver(c.username, false)}>Désactiver</button>
                          : <button className="adm-btn xs solid" onClick={() => onActiver(c.username, true)}>Réactiver</button>}
                        <button
                          className="adm-btn xs"
                          onClick={async () => {
                            const r = await demander(`Nouveau rôle pour ${c.name} :\n${roles.map((x) => x.id).join(', ')}`, c.role);
                            if (r && r !== c.role) onModifier(c.username, { role: r });
                          }}
                        >
                          Rôle
                        </button>
                      </div>
                    ) : <span className="adm-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="adm-muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Un compte ne se supprime pas : il se désactive avec un motif. Le journal d’audit référence ces
          noms, et un dossier instruit par quelqu’un qui « n’existe plus » n’est pas auditable.
        </p>
      </div>
    </>
  );
}

/**
 * Changement de mot de passe. Obligatoire après une création ou une
 * réinitialisation : un mot de passe dicté au téléphone et jamais changé est un
 * mot de passe partagé.
 */
export function ChangerMotDePasse({ obligatoire, onChanger, onFermer }: {
  obligatoire: boolean;
  onChanger: (ancien: string, nouveau: string) => void;
  onFermer: () => void;
}) {
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirme, setConfirme] = useState('');
  const tropCourt = nouveau.length > 0 && nouveau.length < 10;
  const different = confirme.length > 0 && nouveau !== confirme;

  return (
    <div className="adm-modal-wrap">
      <div className="adm-modal">
        <div className="adm-card-h">
          <h3>{obligatoire ? 'Changez votre mot de passe' : 'Changer mon mot de passe'}</h3>
          {!obligatoire && <button className="adm-btn xs" onClick={onFermer}>Fermer</button>}
        </div>
        {obligatoire && (
          <p className="adm-muted" style={{ fontSize: 12.5 }}>
            Votre mot de passe est provisoire : quelqu’un vous l’a communiqué. Tant qu’il n’est pas
            remplacé, c’est un mot de passe partagé.
          </p>
        )}
        <div className="stack" style={{ gap: 10 }}>
          <label className="field"><span>Mot de passe actuel</span><input className="adm-input" type="password" value={ancien} onChange={(e) => setAncien(e.target.value)} /></label>
          <label className="field">
            <span>Nouveau mot de passe (10 caractères minimum)</span>
            <input className="adm-input" type="password" value={nouveau} onChange={(e) => setNouveau(e.target.value)} />
          </label>
          <label className="field"><span>Confirmation</span><input className="adm-input" type="password" value={confirme} onChange={(e) => setConfirme(e.target.value)} /></label>
          {tropCourt && <p className="adm-muted" style={{ margin: 0, fontSize: 12 }}>Encore {10 - nouveau.length} caractère(s).</p>}
          {different && <p className="adm-muted" style={{ margin: 0, fontSize: 12 }}>Les deux saisies diffèrent.</p>}
          <button
            className="adm-btn solid"
            disabled={!ancien || nouveau.length < 10 || nouveau !== confirme}
            onClick={() => onChanger(ancien, nouveau)}
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
