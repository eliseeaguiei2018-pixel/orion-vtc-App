/**
 * Zones, promos, services, support, journal, finances, trésorerie, mobilité verte, IA et entreprises.
 *
 * Extrait de Admin.tsx lors de l'audit : le fichier atteignait 3 750 lignes et
 * mélangeait types, couche réseau, orchestration et 37 composants.
 */
import { useEffect, useRef, useState } from 'react';
import { fcfa } from '../api';
import type { Amortization, Announcement, AssistantSujet, AuditEntry, CashDebtor, ChurnReport, Client, ContactHandler, Conversation, ConversionCell, CopilotAnswer, CorporateAccount, ElasticityCell, ExpenseTicket, Finance, FraudReport, GatewayStatus, GreenReport, Liquidity, Macro, OpsConfig, PredictCell, Pricing, Promo, SearchResults, ServicesConfig, ShadowPricing, SupportStats, Transfer, Triggers, Zone } from '../types';
import { ContactRapide, Kpi, availLabel, rideStatusLabel } from '../ui';
import { pct, slugify } from './operations';
import { ago } from './organisation';

export function ZonesSection({ zones, canWrite, onSave, onToggle, onDelete, onReset, onMatrixCsv }: { zones: Zone[]; canWrite: boolean; onSave: (z: Zone) => void; onToggle: (id: string, active: boolean) => void; onDelete: (id: string) => void; onReset: () => void; onMatrixCsv: () => void }) {
  const setFlatRate = (z: Zone) => {
    const to = window.prompt(`Forfait plat depuis « ${z.name} » — id de la zone d'arrivée :`, zones.find((x) => x.id !== z.id)?.id ?? '');
    if (!to) return;
    const price = window.prompt('Prix du forfait (F CFA) :', '15000');
    if (!price) return;
    const flatRates = [...(z.flatRates ?? []).filter((f) => f.toZoneId !== to), { toZoneId: to, price: Number(price) }];
    onSave({ ...z, flatRates });
  };
  const setEmptyReturn = (z: Zone) => {
    const fee = window.prompt(`Frais de retour à vide vers « ${z.name} » (F CFA, périphérie) :`, String(z.emptyReturnFee ?? 2000));
    if (fee === null) return;
    onSave({ ...z, emptyReturnFee: Number(fee) || 0 });
  };
  const [name, setName] = useState(''); const [factor, setFactor] = useState(1);
  const [lat, setLat] = useState(5.35); const [lng, setLng] = useState(-4.0); const [radiusKm, setRadiusKm] = useState(3);
  const add = () => {
    const id = slugify(name);
    if (!id) return;
    onSave({ id, name: name.trim(), factor, lat, lng, radiusKm, active: true });
    setName(''); setFactor(1);
  };
  return (
    <>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Le <strong>facteur de zone</strong> module le prix fixe selon la commune de <strong>prise en charge</strong>.
          1 = neutre · &lt; 1 = moins cher (plus compétitif) · &gt; 1 = plus cher. Le trafic reste intégré au prix garanti.
        </p>
      </div>
      {canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Nouvelle zone</h3></div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="price-field"><span>Nom (commune)</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cocody" /></label>
            <label className="price-field"><span>Facteur ×</span><input type="number" step="0.01" value={factor} onChange={(e) => setFactor(Number(e.target.value))} /></label>
            <label className="price-field"><span>Latitude</span><input type="number" step="0.0001" value={lat} onChange={(e) => setLat(Number(e.target.value))} /></label>
            <label className="price-field"><span>Longitude</span><input type="number" step="0.0001" value={lng} onChange={(e) => setLng(Number(e.target.value))} /></label>
            <label className="price-field"><span>Rayon (km)</span><input type="number" step="0.5" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} /></label>
            <button className="adm-btn solid" onClick={add}>Ajouter</button>
          </div>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Zones tarifaires</h3>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="adm-muted">{zones.length}</span>
            <button className="adm-btn xs" onClick={onMatrixCsv}>⬇ Matrice zones (Excel)</button>
            {canWrite && <button className="adm-btn xs" onClick={onReset}>Réinitialiser</button>}
          </div>
        </div>
        <table className="adm-table">
          <thead><tr><th>Zone</th><th className="r">Facteur</th><th className="r">Effet</th><th className="r">Rayon</th><th>Qualité de service</th><th>Actif</th>{canWrite && <th>Actions</th>}</tr></thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id}>
                <td>{z.name}<div className="mono adm-muted" style={{ fontSize: 11 }}>{z.id}</div></td>
                <td className="r">× {z.factor.toFixed(2)}</td>
                <td className={`r ${z.factor < 1 ? 'pos' : z.factor > 1 ? 'neg' : ''}`}>{pct(z.factor)}</td>
                <td className="r">{z.radiusKm} km</td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    {z.waitMaxMin && <span className="adm-pill" title="Temps d'attente garanti">⏱ ≤ {z.waitMaxMin} min</span>}
                    {z.minStandard && <span className="adm-pill tr-pending cap" title="Standard minimal">≥ {z.minStandard}</span>}
                    {z.pickupFee ? <span className="adm-pill" title="Frais de prise en charge">+{z.pickupFee} F</span> : null}
                    {z.driverBonus ? <span className="adm-pill av-online" title="Bonus chauffeur">🎁 {z.driverBonus} F</span> : null}
                    {z.dedicated && <span className="adm-pill tr-approved" title="Flotte cantonnée">📌 Flotte dédiée</span>}
                    {z.surgeManual && z.surgeManual > 1 ? <span className="adm-pill tr-rejected" title="Surge manuel d'urgence">⚡ surge ×{z.surgeManual}</span> : null}
                    {(z.flatRates ?? []).length > 0 ? <span className="adm-pill tr-approved" title="Forfaits A→B">🎫 {z.flatRates!.length} forfait(s)</span> : null}
                    {z.emptyReturnFee ? <span className="adm-pill" title="Retour à vide">↩ {z.emptyReturnFee} F</span> : null}
                    {z.premiumFloor ? <span className="adm-pill tr-pending" title="Plancher premium">⬆ {z.premiumFloor} F</span> : null}
                    {!z.waitMaxMin && !z.minStandard && !z.pickupFee && !z.driverBonus && !z.dedicated && !z.surgeManual && !(z.flatRates ?? []).length && !z.emptyReturnFee && !z.premiumFloor && <span className="adm-muted">—</span>}
                  </div>
                </td>
                <td><span className={`adm-pill ${z.active ? 'av-online' : 'kyc-manual_review'}`}>{z.active ? 'Actif' : 'Inactif'}</span></td>
                {canWrite && (
                  <td><div className="row" style={{ gap: 6 }}>
                    <button className="adm-btn xs" title="Surge manuel d'urgence (stade, concert…)" onClick={() => {
                      const cur = z.surgeManual ?? 1;
                      const input = window.prompt(`Surge manuel pour « ${z.name} » (1 = aucun, max 2.5, plafonné par le cap vert) :`, String(cur));
                      if (input === null) return;
                      const v = Math.min(2.5, Math.max(1, Number(input) || 1));
                      onSave({ ...z, surgeManual: v });
                    }}>⚡ Surge</button>
                    <button className="adm-btn xs" title="Forfait plat A→B" onClick={() => setFlatRate(z)}>🎫 Forfait</button>
                    <button className="adm-btn xs" title="Retour à vide (périphérie)" onClick={() => setEmptyReturn(z)}>↩ Retour</button>
                    <button className={`adm-btn xs${z.active ? '' : ' solid'}`} title="Kill switch territorial" onClick={() => onToggle(z.id, !z.active)}>{z.active ? '⏻ Couper' : 'Activer'}</button>
                    <button className="adm-btn xs" onClick={() => onDelete(z.id)}>Suppr.</button>
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function PromosSection({ promos, canWrite, onSave, onToggle, onDelete }: { promos: Promo[]; canWrite: boolean; onSave: (p: { code: string; kind: 'percent' | 'amount'; value: number; maxUses?: number }) => void; onToggle: (code: string, active: boolean) => void; onDelete: (code: string) => void }) {
  const [code, setCode] = useState(''); const [kind, setKind] = useState<'percent' | 'amount'>('percent'); const [value, setValue] = useState(20);
  return (
    <>
      {canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Nouveau code promo</h3></div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="price-field"><span>Code</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BIENVENUE" /></label>
            <label className="price-field"><span>Type</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'amount')} className="adm-select"><option value="percent">Pourcentage (%)</option><option value="amount">Montant (F)</option></select>
            </label>
            <label className="price-field"><span>Valeur</span><input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} /></label>
            <button className="adm-btn solid" onClick={() => { if (code.trim()) { onSave({ code: code.trim(), kind, value }); setCode(''); } }}>Créer</button>
          </div>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Codes promo</h3><span className="adm-muted">{promos.length}</span></div>
        <table className="adm-table">
          <thead><tr><th>Code</th><th>Remise</th><th className="r">Utilisations</th><th>Actif</th>{canWrite && <th>Actions</th>}</tr></thead>
          <tbody>
            {promos.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.id}</td>
                <td>{p.kind === 'percent' ? `-${p.value}%` : `-${fcfa(p.value)}`}</td>
                <td className="r">{p.uses}{p.maxUses ? ` / ${p.maxUses}` : ''}</td>
                <td><span className={`adm-pill ${p.active ? 'av-online' : 'kyc-manual_review'}`}>{p.active ? 'Actif' : 'Inactif'}</span></td>
                {canWrite && (
                  <td><div className="row" style={{ gap: 6 }}>
                    <button className="adm-btn xs" onClick={() => onToggle(p.id, !p.active)}>{p.active ? 'Désactiver' : 'Activer'}</button>
                    <button className="adm-btn xs" onClick={() => onDelete(p.id)}>Suppr.</button>
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export const SERVICE_LABEL: Record<string, string> = { course: 'Course (VTC)', delivery: 'Livraison moto', food: 'Food', shop: 'Achat & Vente', market: 'Supermarché', colis: 'Colis / Cargo' };
export function ServicesSection({ config, canWrite, onSave }: { config: ServicesConfig; canWrite: boolean; onSave: (patch: Partial<ServicesConfig>) => void }) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Services & disponibilité — {config.city}</h3><span className="adm-muted">Active/désactive les services de l'app cliente</span></div>
      <div className="opt" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--a-stroke)', marginBottom: 10 }}>
        <strong style={{ flex: 1 }}>ORION ouvert (service actif)</strong>
        <button className={`adm-toggle${config.open ? ' on' : ''}`} disabled={!canWrite} onClick={() => onSave({ open: !config.open })}><span /></button>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {Object.keys(SERVICE_LABEL).map((k) => (
          <div key={k} className="row between" style={{ padding: '8px 0' }}>
            <span>{SERVICE_LABEL[k]}</span>
            <button className={`adm-toggle${config.services[k] ? ' on' : ''}`} disabled={!canWrite} onClick={() => onSave({ services: { [k]: !config.services[k] } })}><span /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

export const PRIORITY_META: Record<number, { label: string; cls: string }> = {
  1: { label: 'P1 · Objet oublié', cls: 'tr-rejected' },
  2: { label: 'P2 · Facturation', cls: 'tr-pending' },
  3: { label: 'P3 · Général', cls: 'av-online' },
};

export function SupportSection({ convs, stats, macros, canWrite, canPromo, clients, onReply, onStatus, onCompensate, onContact }: {
  /** Fiches clients, pour retrouver le numéro de l'interlocuteur. */
  clients: Client[];
  /** Rappeler le client — l'écrit ne remplace pas toujours un appel. */
  onContact: ContactHandler;
  convs: Conversation[]; stats: SupportStats | null; macros: Macro[];
  canWrite: boolean; canPromo: boolean;
  onReply: (id: string, text: string) => void; onStatus: (id: string, s: string) => void;
  onCompensate: (clientId: string, percent: number) => void;
}) {
  const [sel, setSel] = useState<string | null>(convs[0]?.id ?? null);
  const [text, setText] = useState('');
  const [compPct, setCompPct] = useState(20);
  const conv = convs.find((c) => c.id === sel) ?? convs[0] ?? null;
  return (
    <>
      {stats && (
        <section className="adm-kpis">
          <Kpi label="Tickets ouverts" value={String(stats.open)} sub="boîte triée par priorité puis ancienneté" tone={stats.open ? 'teal' : 'muted'} />
          <Kpi label="1re réponse (moy.)" value={stats.avgFirstReplyMin != null ? `${stats.avgFirstReplyMin} min` : '—'} sub="SLA de première réponse" tone="green" />
          <Kpi label="Résolus aujourd'hui" value={String(stats.resolvedToday)} sub="tickets clos dans la journée" tone="mint" />
          <Kpi label="CSAT post-résolution" value={stats.csat != null ? `★ ${stats.csat}` : '—'} sub="satisfaction après traitement" tone="teal" />
        </section>
      )}
      <div className="adm-grid2">
        <div className="adm-card" style={{ maxHeight: 640, overflow: 'auto' }}>
          <div className="adm-card-h"><h3>File d'attente intelligente</h3><span className="adm-muted">{convs.length} · P1 objet oublié &gt; P2 facturation &gt; P3 général</span></div>
          <div className="stack" style={{ gap: 6 }}>
            {convs.length === 0 && <p className="adm-empty">Aucune conversation.</p>}
            {convs.map((c) => (
              <button key={c.id} className={`adm-conv${conv?.id === c.id ? ' on' : ''}`} onClick={() => setSel(c.id)}>
                <div className="row between">
                  <strong>{c.subject}</strong>
                  <span className="row" style={{ gap: 4 }}>
                    {c.priority && <span className={`adm-pill ${PRIORITY_META[c.priority]?.cls ?? ''}`}>{PRIORITY_META[c.priority]?.label ?? `P${c.priority}`}</span>}
                    <span className={`adm-pill s-${c.status === 'open' ? 'searching' : c.status === 'pending' ? 'in_progress' : 'completed'}`}>{convStatus(c.status)}</span>
                  </span>
                </div>
                <div className="adm-muted" style={{ fontSize: 12 }}>{c.clientId} · {c.messages.length} msg{c.csat ? ` · CSAT ★ ${c.csat}` : ''}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="adm-card" style={{ display: 'flex', flexDirection: 'column', maxHeight: 640 }}>
          {conv ? (
            <>
              <div className="adm-card-h">
                <h3>{conv.subject}</h3>
                <div className="row" style={{ gap: 10 }}>
                  <span className="adm-muted mono">{conv.clientId}</span>
                  {/* L'écrit ne remplace pas toujours un appel : un objet oublié ou un
                      litige de paiement se règle plus vite au téléphone. */}
                  <ContactRapide
                    type="support" id={conv.id}
                    numero={clients.find((x) => x.id === conv.clientId)?.phone}
                    nom={clients.find((x) => x.id === conv.clientId)?.name ?? conv.clientId}
                    onContact={onContact}
                  />
                </div>
              </div>
              <div className="adm-chat">
                {conv.messages.map((m) => (
                  <div key={m.id} className={`adm-bubble ${m.from}`}>
                    <div className="adm-bubble-txt">{m.text}</div>
                    <div className="adm-bubble-meta">{m.from === 'agent' ? (m.author ?? 'Agent') : 'Client'} · {new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                ))}
              </div>
              {canWrite && macros.length > 0 && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
                  {macros.map((m) => (
                    <button key={m.title} className="adm-btn xs" title={m.text} onClick={() => onReply(conv.id, m.text)}>⚡ {m.title}</button>
                  ))}
                </div>
              )}
              {canWrite && (
                <div className="adm-chat-input">
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Répondre au client…" onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onReply(conv.id, text.trim()); setText(''); } }} />
                  <button className="adm-btn solid" onClick={() => { if (text.trim()) { onReply(conv.id, text.trim()); setText(''); } }}>Envoyer</button>
                  <button className="adm-btn ghost" onClick={() => onStatus(conv.id, 'closed')}>Clore</button>
                </div>
              )}
              {canPromo && (
                <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  <span className="adm-muted" style={{ fontSize: 12 }}>Geste commercial :</span>
                  <input className="adm-inline-input" style={{ width: 70 }} type="number" min={5} max={50} value={compPct} onChange={(e) => setCompPct(Number(e.target.value))} />
                  <span className="adm-muted" style={{ fontSize: 12 }}>%</span>
                  <button className="adm-btn xs solid" onClick={() => onCompensate(conv.clientId, compPct)}>🎟 Code de dédommagement (7 j, usage unique)</button>
                </div>
              )}
            </>
          ) : <p className="adm-empty">Sélectionne une conversation.</p>}
        </div>
      </div>
    </>
  );
}

export function AuditSection({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="adm-card">
      <div className="adm-card-h"><h3>Journal d'audit</h3><span className="adm-muted">{entries.length} actions</span></div>
      <table className="adm-table">
        <thead><tr><th>Quand</th><th>Auteur</th><th>Rôle</th><th>Action</th><th>Cible</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="adm-muted">{new Date(e.at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              <td>{e.actor}</td><td className="cap">{e.role}</td><td className="mono">{e.action}</td><td className="mono adm-muted">{e.target ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export const convStatus = (s: string) => ({ open: 'Ouverte', pending: 'En attente', closed: 'Close' }[s] ?? s);

export const CHANNEL_META: Record<string, string> = { push: '📲 Push', sms: '✉️ SMS', email: '📧 E-mail' };
export const SEGMENT_LABEL: Record<string, string> = { tous: 'Tous', nouveaux: 'Nouveaux inscrits sans course', vip: 'Utilisateurs VIP', green: 'Adeptes 100 % électrique', inactifs: 'Inactifs 30 jours' };

export function NotifySection({ broadcasts, triggers, canWrite, onSend, onTrigger }: {
  broadcasts: Announcement[]; triggers: Triggers | null; canWrite: boolean;
  onSend: (a: { audience: string; title: string; body: string; channel?: string; segment?: string; scheduledAt?: string }) => void;
  onTrigger: (t: 'battery' | 'winback') => void;
}) {
  const [audience, setAudience] = useState('clients'); const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [channel, setChannel] = useState('push'); const [segment, setSegment] = useState('tous'); const [scheduledAt, setScheduledAt] = useState('');
  const audLabel = (a: string) => ({ clients: 'Clients', drivers: 'Chauffeurs', all: 'Tous' }[a] ?? a);
  const send = () => {
    if (!title.trim() || !body.trim()) return;
    onSend({
      audience, title: title.trim(), body: body.trim(), channel, segment,
      ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
    });
    setTitle(''); setBody(''); setScheduledAt('');
  };
  return (
    <>
      {canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Studio de création multicanal</h3><span className="adm-muted">Push · SMS · E-mail — ciblage comportemental</span></div>
          <div className="price-grid">
            <label className="price-field"><span>Canal</span>
              <select className="adm-select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="push">📲 Push in-app (immédiat)</option>
                <option value="sms">✉️ SMS (critique / hors-ligne)</option>
                <option value="email">📧 E-mail (newsletters, bilans)</option>
              </select>
            </label>
            <label className="price-field"><span>Destinataires</span>
              <select className="adm-select" value={audience} onChange={(e) => setAudience(e.target.value)}><option value="clients">Clients</option><option value="drivers">Chauffeurs</option><option value="all">Tous</option></select>
            </label>
            <label className="price-field"><span>Segment (hyper-ciblage)</span>
              <select className="adm-select" value={segment} onChange={(e) => setSegment(e.target.value)}>
                {Object.entries(SEGMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="price-field"><span>Planification (optionnel)</span>
              <input type="datetime-local" className="adm-select" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </label>
          </div>
          <label className="price-field" style={{ marginTop: 12 }}><span>Titre</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Wi-Fi gratuit à bord" /></label>
          <label className="price-field" style={{ marginTop: 12 }}><span>Message — balises : [Prénom], [Destination_Favorite]</span><textarea className="adm-select" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Bonjour [Prénom], voici 10 % de réduction pour votre prochain trajet vers [Destination_Favorite]…" /></label>
          <button className="adm-btn solid" style={{ marginTop: 12 }} onClick={send}>📣 {scheduledAt ? 'Programmer la campagne' : 'Diffuser maintenant'}</button>
        </div>
      )}
      {triggers && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Déclencheurs automatisés</h3><span className="adm-muted">scénarios exécutés sans intervention</span></div>
          <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="row between" style={{ marginBottom: 6 }}>
                <strong style={{ fontSize: 13 }}>🔋 Batterie &lt; 15 % → borne partenaire ({triggers.lowBattery.length})</strong>
                {canWrite && triggers.lowBattery.length > 0 && <button className="adm-btn xs solid" onClick={() => onTrigger('battery')}>Envoyer le guidage</button>}
              </div>
              <ul className="adm-conv-list">
                {triggers.lowBattery.map((d) => (
                  <li key={d.id}><span>{d.name} · {d.batteryPct} %</span><span className="adm-muted" style={{ fontSize: 11 }}>{d.station ?? '—'}</span></li>
                ))}
                {triggers.lowBattery.length === 0 && <li><span className="adm-muted">Aucun véhicule sous 15 %. ✅</span></li>}
              </ul>
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="row between" style={{ marginBottom: 6 }}>
                <strong style={{ fontSize: 13 }}>💚 Win-back — inactifs 30 j ({triggers.winback.length})</strong>
                {canWrite && <button className="adm-btn xs solid" onClick={() => onTrigger('winback')}>Envoyer code retour</button>}
              </div>
              <ul className="adm-conv-list">
                {triggers.winback.map((c) => (
                  <li key={c.id}><span>{c.name ?? c.id} · {c.rides} courses</span><span className="adm-muted">{ago(c.lastSeenAt)}</span></li>
                ))}
                {triggers.winback.length === 0 && <li><span className="adm-muted">Aucun client silencieux. ✅</span></li>}
              </ul>
            </div>
          </div>
          <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            Heures creuses recharge : {triggers.offPeak.start} h → {triggers.offPeak.end} h · bonus {triggers.offPeak.bonus} F
            (réglable dans Dispatch). Alerte météo/surge : les chauffeurs hors ligne sont prévenus quand la
            tarification dynamique s'active sur leur zone.
          </p>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Campagnes envoyées</h3><span className="adm-muted">{broadcasts.length} · délivrabilité / ouverture / clics / courses générées</span></div>
        <div className="stack" style={{ gap: 8 }}>
          {broadcasts.length === 0 && <p className="adm-empty">Aucune annonce.</p>}
          {broadcasts.map((a) => (
            <div key={a.id} className="adm-role-card">
              <div className="row between" style={{ flexWrap: 'wrap', gap: 6 }}>
                <strong>{a.title}</strong>
                <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  <span className="adm-pill">{CHANNEL_META[a.channel ?? 'push']}</span>
                  <span className="adm-pill av-online">{audLabel(a.audience)}</span>
                  {a.segment && a.segment !== 'tous' && <span className="adm-pill tr-pending">{SEGMENT_LABEL[a.segment] ?? a.segment}</span>}
                  {a.scheduledAt && Date.parse(a.scheduledAt) > Date.now() && <span className="adm-pill tr-pending">🕒 programmée</span>}
                </span>
              </div>
              <p className="adm-muted" style={{ margin: '4px 0', fontSize: 13 }}>{a.body}</p>
              {a.stats && a.stats.sent > 0 && (
                <div className="row" style={{ gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
                  <span>📤 {a.stats.sent} envoyés</span>
                  <span>✅ {a.stats.delivered} délivrés</span>
                  <span>👁 {a.stats.opened} ouverts ({a.stats.sent ? Math.round((a.stats.opened / a.stats.sent) * 100) : 0} %)</span>
                  <span>🖱 {a.stats.clicked} clics</span>
                  <span className="pos">🚗 {a.stats.rides} courses générées</span>
                </div>
              )}
              <span className="adm-muted" style={{ fontSize: 11 }}>{a.author} · {new Date(a.at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export const TIER_LABEL: Record<string, string> = { bronze: 'Bronze', argent: 'Argent', or: 'Or', diamant: 'Diamant', livraison: 'Livraison', ride: 'Course' };
export const GW_LABEL: Record<string, string> = { orange_money: 'Orange Money', mtn_momo: 'MTN MoMo', moov_money: 'Moov Money', wave: 'Wave', card: 'Carte bancaire', cash: 'Espèces' };
export const EXP_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'En attente CFO', cls: 'tr-pending' }, info_requested: { label: 'Complément demandé', cls: 'tr-pending' },
  approved: { label: 'Approuvé', cls: 'tr-approved' }, rejected: { label: 'Rejeté', cls: 'tr-rejected' },
};
export const EXP_CAT: Record<string, string> = { marketing: 'Marketing', recharge: 'Recharge', deplacement: 'Déplacement', materiel: 'Matériel', autre: 'Autre' };

export function FinanceSection({ finance, ops, cashDebt, gateways, expenses, onExport, canExport, canWrite, canGateway, canApprove, onSaveOps, onToggleGateway, onDecideExpense, onNewExpense, onPayouts }: {
  finance: Finance; ops: OpsConfig | null; cashDebt: CashDebtor[]; gateways: GatewayStatus[]; expenses: ExpenseTicket[];
  onExport: () => void; canExport: boolean; canWrite: boolean; canGateway: boolean; canApprove: boolean;
  onSaveOps: (p: Partial<OpsConfig>) => void; onToggleGateway: (m: string, e: boolean) => void;
  onDecideExpense: (id: string, d: 'approve' | 'reject' | 'info') => void; onNewExpense: () => void; onPayouts: () => void;
}) {
  const tiers = Object.entries(finance.byTier);
  const maxRev = Math.max(1, ...tiers.map(([, v]) => v.revenue));
  return (
    <>
      <section className="adm-kpis">
        <Kpi label="GMV (volume)" value={fcfa(finance.gmv)} sub="toutes courses" tone="teal" />
        <Kpi label="Revenu encaissé" value={fcfa(finance.revenue)} sub="courses payées" tone="green" />
        <Kpi label="Commission ORION" value={fcfa(finance.commission)} sub="marge plateforme" tone="mint" />
        <Kpi label="TVA collectée" value={fcfa(finance.taxes ?? 0)} sub="compte d'attente fiscal" tone="muted" />
      </section>

      {/* Moteur de commissions (take-rate) */}
      {ops && canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Moteur de commissions (take-rate)</h3></div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="price-field"><span>Commission standard (%)</span><input type="number" min={0} max={50} value={Math.round(ops.commissionStandard * 100)} onChange={(e) => onSaveOps({ commissionStandard: Number(e.target.value) / 100 })} /></label>
            <label className="price-field"><span>Commission verte réduite (%)</span><input type="number" min={0} max={50} value={Math.round(ops.commissionGreen * 100)} onChange={(e) => onSaveOps({ commissionGreen: Number(e.target.value) / 100 })} /></label>
            <label className="price-field"><span>Plafond dette espèces (F)</span><input type="number" min={0} step={5000} value={ops.cashDebtLimit} onChange={(e) => onSaveOps({ cashDebtLimit: Number(e.target.value) })} /></label>
            <label className="price-field"><span>Seuil fidélité (courses élec.)</span><input type="number" min={0} step={100} value={ops.loyaltyRideThreshold} onChange={(e) => onSaveOps({ loyaltyRideThreshold: Number(e.target.value) })} /></label>
            <label className="price-field"><span>Commission fidélité (%)</span><input type="number" min={0} max={50} value={Math.round(ops.commissionLoyalty * 100)} onChange={(e) => onSaveOps({ commissionLoyalty: Number(e.target.value) / 100 })} /></label>
          </div>
          <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            Commission modulée par gamme (verte réduite pour encourager la transition) et par fidélité
            (au-delà du seuil de courses électriques). Split payment : la part chauffeur, la commission ORION
            et la TVA sont isolées automatiquement à chaque course.
          </p>
        </div>
      )}

      {/* Passerelles de paiement */}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Passerelles de paiement (monitoring)</h3><button className="adm-btn xs" onClick={onPayouts}>⬇ Virements de masse (CSV)</button></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {gateways.map((g) => (
            <div key={g.method} className="row" style={{ gap: 8, alignItems: 'center', padding: '6px 10px', background: 'var(--a-panel2)', borderRadius: 8 }}>
              <span className={`adm-dot ${g.enabled ? 'green' : 'red'}`} />
              <span style={{ fontSize: 13 }}>{GW_LABEL[g.method] ?? g.method}</span>
              {canGateway && <button className={`adm-toggle${g.enabled ? ' on' : ''}`} onClick={() => onToggleGateway(g.method, !g.enabled)}><span /></button>}
            </div>
          ))}
        </div>
        <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>En cas de panne réseau opérateur, coupez la passerelle : le moyen de paiement est désactivé côté application client.</p>
      </div>

      {/* Recouvrement dette espèces */}
      {cashDebt.length > 0 && (
        <div className="adm-card" style={{ borderColor: 'var(--a-danger)' }}>
          <div className="adm-card-h"><h3>⚠️ Recouvrement — dette espèces</h3><span className="adm-muted">{cashDebt.length} chauffeur(s) au-delà du plafond</span></div>
          <table className="adm-table sm">
            <thead><tr><th>Chauffeur</th><th>Matricule</th><th className="r">Solde</th><th className="r">Plafond</th></tr></thead>
            <tbody>
              {cashDebt.map((d) => (
                <tr key={d.id}><td>{d.name ?? d.id}</td><td className="mono">{d.matricule ?? '—'}</td><td className="r neg">{fcfa(d.balance)}</td><td className="r">{fcfa(-d.limit)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="adm-muted" style={{ margin: '8px 0 0', fontSize: 12 }}>Ces chauffeurs ne reçoivent que des courses payées par carte jusqu'à épuration de la dette.</p>
        </div>
      )}

      {/* Notes de frais & avances */}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Notes de frais & avances</h3><button className="adm-btn xs solid" onClick={onNewExpense}>+ Demande de financement</button></div>
        {expenses.length === 0 && <p className="adm-empty">Aucune demande. Les employés et chauffeurs soumettent leurs tickets ici.</p>}
        <div className="stack" style={{ gap: 8 }}>
          {expenses.map((t) => (
            <div key={t.id} className="adm-dispute">
              <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{fcfa(t.amount)}</strong>
                  <span className="adm-pill">{EXP_CAT[t.category] ?? t.category}</span>
                  <span className={`adm-pill ${EXP_STATUS[t.status]?.cls ?? ''}`}>{EXP_STATUS[t.status]?.label ?? t.status}</span>
                  {t.blocked && <span className="adm-pill tr-rejected">🔒 gelé (justif. en retard)</span>}
                  {t.cashOut && <span className="adm-pill av-online">décaissé {t.cashOut.channel}</span>}
                  {t.receipt && <span className={`adm-pill ${t.receipt.matches ? 'tr-approved' : 'tr-rejected'}`}>justif. {fcfa(t.receipt.amount)}</span>}
                  {t.refunded ? <span className="adm-pill">reliquat {fcfa(t.refunded)}</span> : null}
                </div>
                <span className="adm-muted" style={{ fontSize: 12 }}>{t.requesterName}</span>
              </div>
              <p style={{ margin: '6px 0', fontSize: 13 }}>{t.description}</p>
              {canApprove && t.status === 'pending' && (
                <div className="row" style={{ gap: 6 }}>
                  <button className="adm-btn xs solid" onClick={() => onDecideExpense(t.id, 'approve')}>Approuver (crédit instantané)</button>
                  <button className="adm-btn xs" onClick={() => onDecideExpense(t.id, 'info')}>Complément</button>
                  <button className="adm-btn xs" onClick={() => onDecideExpense(t.id, 'reject')}>Rejeter</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="adm-card">
        <div className="adm-card-h"><h3>Revenu par catégorie</h3>{canExport && <button className="adm-btn ghost" onClick={onExport}>⬇ Exporter CSV</button>}</div>
        <div className="stack" style={{ gap: 10, marginTop: 6 }}>
          {tiers.map(([k, v]) => (
            <div key={k}>
              <div className="row between" style={{ fontSize: 13, marginBottom: 4 }}><span className="cap">{TIER_LABEL[k] ?? k} · {v.count} courses</span><strong>{fcfa(v.revenue)}</strong></div>
              <div className="fin-bar"><span style={{ width: `${(v.revenue / maxRev) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* --------------------------- Éditeur de prix ------------------------- */
export function exampleFare(p: Pricing, tier: string, km: number): number {
  const m = p.multipliers[tier] ?? 1;
  const base = p.baseFare * m;
  const distance = km * p.perKm * m;
  const time = (km / p.avgSpeedKmh) * 60 * p.perMinute * m;
  const subtotal = Math.max(base + distance + time, p.minFare * m);
  return Math.round((subtotal * (1 + p.tvaRate + p.feeRate)) / 50) * 50;
}

export function PricingEditor({ pricing, canWrite, onSave, onShadow, onMatrixCsv }: {
  pricing: Pricing; canWrite: boolean; onSave: (patch: Partial<Pricing>) => Promise<void>;
  onShadow: (p: { baseFactor: number; perKmFactor: number }) => Promise<ShadowPricing | null>;
  onMatrixCsv: () => void;
}) {
  const [form, setForm] = useState<Pricing>(pricing);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [shBase, setShBase] = useState(1.1);
  const [shKm, setShKm] = useState(1);
  const [shRes, setShRes] = useState<ShadowPricing | null>(null);
  useEffect(() => { setForm(pricing); }, [pricing]);

  const num = (k: keyof Pricing) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }));
  const mult = (t: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, multipliers: { ...f.multipliers, [t]: Number(e.target.value) } }));

  const save = async () => {
    setBusy(true); setSaved(false);
    try {
      await onSave({
        baseFare: form.baseFare, perKm: form.perKm, perMinute: form.perMinute, minFare: form.minFare,
        avgSpeedKmh: form.avgSpeedKmh, tvaRate: form.tvaRate, feeRate: form.feeRate,
        insuranceRate: form.insuranceRate, trafficWeight: form.trafficWeight, stopFee: form.stopFee,
        multipliers: form.multipliers,
        freeWaitMinutes: form.freeWaitMinutes, cancelGraceMinutes: form.cancelGraceMinutes, cancelFee: form.cancelFee,
        cleaningLight: form.cleaningLight, cleaningMajor: form.cleaningMajor,
        longPickupPerKm: form.longPickupPerKm, longPickupThresholdKm: form.longPickupThresholdKm,
      });
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } finally { setBusy(false); }
  };

  const tiers = ['bronze', 'argent', 'or', 'diamant'];
  const F = ({ label, k, step = 10 }: { label: string; k: keyof Pricing; step?: number }) => (
    <label className="price-field"><span>{label}</span><input type="number" step={step} value={form[k] as number} onChange={num(k)} disabled={!canWrite} /></label>
  );

  return (
    <>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Tarification — leviers de prix</h3><span className="adm-muted">Effet immédiat sur toutes les nouvelles courses</span></div>
        {!canWrite && <p className="adm-empty">Lecture seule — votre rôle ne permet pas de modifier les prix.</p>}
        <div className="price-grid">
          <F label="Prise en charge (F)" k="baseFare" />
          <F label="Prix / km (F)" k="perKm" />
          <F label="Prix / min (F)" k="perMinute" />
          <F label="Course minimum (F)" k="minFare" />
          <F label="Vitesse moyenne (km/h)" k="avgSpeedKmh" step={1} />
          <F label="Forfait arrêt (F)" k="stopFee" />
          <label className="price-field"><span>TVA (%)</span><input type="number" step={1} value={Math.round(form.tvaRate * 100)} onChange={(e) => setForm((f) => ({ ...f, tvaRate: Number(e.target.value) / 100 }))} disabled={!canWrite} /></label>
          <label className="price-field"><span>Frais ORION (%)</span><input type="number" step={1} value={Math.round(form.feeRate * 100)} onChange={(e) => setForm((f) => ({ ...f, feeRate: Number(e.target.value) / 100 }))} disabled={!canWrite} /></label>
          <label className="price-field"><span>Poids trafic (0–1)</span><input type="number" step={0.1} value={form.trafficWeight} onChange={num('trafficWeight')} disabled={!canWrite} /></label>
        </div>

        <div className="adm-card-h" style={{ marginTop: 18 }}><h3 style={{ fontSize: 14 }}>Multiplicateurs par niveau</h3></div>
        <div className="price-grid">
          {tiers.map((t) => (
            <label key={t} className="price-field cap"><span>{t}</span><input type="number" step={0.05} value={form.multipliers[t] ?? 1} onChange={mult(t)} disabled={!canWrite} /></label>
          ))}
        </div>

        {canWrite && (
          <div className="row" style={{ gap: 10, marginTop: 18 }}>
            <button className="adm-btn solid" onClick={() => void save()} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les prix'}</button>
            <button className="adm-btn ghost" onClick={() => setForm(pricing)} disabled={busy}>Annuler</button>
            {saved && <span className="adm-live on" style={{ alignSelf: 'center' }}>✓ Enregistré — appliqué</span>}
          </div>
        )}
      </div>

      <div className="adm-card">
        <div className="adm-card-h"><h3>Frais annexes & pénalités</h3></div>
        <div className="price-grid">
          <label className="price-field"><span>Attente offerte (min)</span><input type="number" min={0} max={30} value={form.freeWaitMinutes ?? 5} onChange={(e) => setForm((f) => ({ ...f, freeWaitMinutes: Number(e.target.value) }))} disabled={!canWrite} /></label>
          <label className="price-field"><span>Annulation gratuite (min)</span><input type="number" min={0} max={30} value={form.cancelGraceMinutes ?? 2} onChange={(e) => setForm((f) => ({ ...f, cancelGraceMinutes: Number(e.target.value) }))} disabled={!canWrite} /></label>
          <label className="price-field"><span>Frais d'annulation (F)</span><input type="number" min={0} step={100} value={form.cancelFee ?? 500} onChange={(e) => setForm((f) => ({ ...f, cancelFee: Number(e.target.value) }))} disabled={!canWrite} /></label>
          <label className="price-field"><span>Nettoyage léger (F)</span><input type="number" min={0} step={1000} value={form.cleaningLight ?? 10000} onChange={(e) => setForm((f) => ({ ...f, cleaningLight: Number(e.target.value) }))} disabled={!canWrite} /></label>
          <label className="price-field"><span>Nettoyage majeur (F)</span><input type="number" min={0} step={5000} value={form.cleaningMajor ?? 50000} onChange={(e) => setForm((f) => ({ ...f, cleaningMajor: Number(e.target.value) }))} disabled={!canWrite} /></label>
          <label className="price-field"><span>Prise en charge longue (F/km)</span><input type="number" min={0} step={25} value={form.longPickupPerKm ?? 100} onChange={(e) => setForm((f) => ({ ...f, longPickupPerKm: Number(e.target.value) }))} disabled={!canWrite} /></label>
          <label className="price-field"><span>Seuil approche longue (km)</span><input type="number" min={0} step={1} value={form.longPickupThresholdKm ?? 5} onChange={(e) => setForm((f) => ({ ...f, longPickupThresholdKm: Number(e.target.value) }))} disabled={!canWrite} /></label>
        </div>
        <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          Courtoisie d'attente offerte avant facturation, annulation progressive (gratuite dans le délai de grâce),
          barèmes de nettoyage appliqués depuis les Litiges, et prime de prise en charge longue reversée au chauffeur.
          Enregistrez ci-dessus pour appliquer.
        </p>
      </div>

      <div className="adm-card">
        <div className="adm-card-h"><h3>Shadow pricing (simulateur A/B)</h3><button className="adm-btn xs" onClick={onMatrixCsv}>⬇ Matrice tarifaire (Excel)</button></div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="price-field"><span>Facteur prise en charge ×</span><input type="number" step={0.05} value={shBase} onChange={(e) => setShBase(Number(e.target.value))} /></label>
          <label className="price-field"><span>Facteur prix/km ×</span><input type="number" step={0.05} value={shKm} onChange={(e) => setShKm(Number(e.target.value))} /></label>
          <button className="adm-btn solid" onClick={async () => setShRes(await onShadow({ baseFactor: shBase, perKmFactor: shKm }))}>▶ Simuler sur l'historique</button>
        </div>
        {shRes && (
          <div className="adm-mini-kpis" style={{ marginTop: 12 }}>
            <div className="adm-mini-kpi"><span>Courses rejouées</span><strong>{shRes.sampled}</strong></div>
            <div className="adm-mini-kpi"><span>Revenu réel</span><strong>{fcfa(shRes.realRevenue)}</strong></div>
            <div className="adm-mini-kpi"><span>Revenu simulé</span><strong>{fcfa(shRes.simulatedRevenue)}</strong></div>
            <div className="adm-mini-kpi"><span>Impact</span><strong className={shRes.impactPercent >= 0 ? 'pos' : 'neg'}>{shRes.impactPercent > 0 ? '+' : ''}{shRes.impactPercent} %</strong></div>
          </div>
        )}
        <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          Mesure l'impact d'une nouvelle grille sur les revenus <strong>sans impacter les utilisateurs</strong> (comparaison
          avec ce que les clients ont réellement payé).
        </p>
      </div>

      <div className="adm-card">
        <div className="adm-card-h"><h3>Aperçu du prix</h3><span className="adm-muted">Exemple : trajet de 6,7 km</span></div>
        <div className="adm-kpis">
          {tiers.map((t) => (
            <Kpi key={t} label={t.toUpperCase()} value={fcfa(exampleFare(form, t, 6.7))} sub="prix fixe TTC" tone={t === 'bronze' ? 'green' : t === 'diamant' ? 'teal' : 'mint'} />
          ))}
        </div>
      </div>
    </>
  );
}

/* ------------------------------ Rôles -------------------------------- */
/* --------------------------- Recherche globale ----------------------- */
export function GlobalSearch({ onSearch, onOpenDriver, onOpenClient, onOpenRide }: {
  onSearch: (q: string) => Promise<SearchResults>;
  onOpenDriver: (id: string) => void; onOpenClient: (id: string) => void; onOpenRide: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const change = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) { setResults(null); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      const r = await onSearch(value);
      setResults(r); setOpen(true);
    }, 220);
  };
  const close = () => { setOpen(false); setQ(''); setResults(null); };
  const empty = results && results.drivers.length === 0 && results.clients.length === 0 && results.rides.length === 0;

  return (
    <div className="adm-search">
      <input
        className="adm-search-input" type="search" placeholder="🔎 Rechercher chauffeur, client, course…"
        value={q} onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
      />
      {open && results && (
        <div className="adm-search-pop">
          {empty && <p className="adm-muted" style={{ margin: 8 }}>Aucun résultat pour « {q} »{results.partiel ? ' dans les fiches les plus récentes' : ''}.</p>}
          {results.partiel && (
            <p className="adm-muted" style={{ margin: 8, fontSize: 12 }}>
              Recherche limitée aux fiches les plus récentes. Saisissez un matricule, un numéro de téléphone ou un identifiant complet pour un résultat exact.
            </p>
          )}
          {results.drivers.length > 0 && (
            <div className="adm-search-group">
              <span className="adm-search-cat">Chauffeurs</span>
              {results.drivers.map((d) => (
                <button key={d.id} className="adm-search-item" onClick={() => { onOpenDriver(d.id); close(); }}>
                  <span>🧑‍✈️ {d.name}</span><span className="mono adm-muted">{d.matricule}</span>
                </button>
              ))}
            </div>
          )}
          {results.clients.length > 0 && (
            <div className="adm-search-group">
              <span className="adm-search-cat">Clients</span>
              {results.clients.map((c) => (
                <button key={c.id} className="adm-search-item" onClick={() => { onOpenClient(c.id); close(); }}>
                  <span>👤 {c.name ?? c.id}</span><span className="mono adm-muted">{c.phone ?? c.id}</span>
                </button>
              ))}
            </div>
          )}
          {results.rides.length > 0 && (
            <div className="adm-search-group">
              <span className="adm-search-cat">Courses</span>
              {results.rides.map((r) => (
                <button key={r.id} className="adm-search-item" onClick={() => { onOpenRide(r.id); close(); }}>
                  <span>🚗 {r.id.slice(0, 12)}</span><span className="adm-muted">{rideStatusLabel(r.status)} · {fcfa(r.amount)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------- Trésorerie (double validation) ------------------- */
export const TR_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'En attente d’aval', cls: 'tr-pending' },
  approved: { label: 'Approuvé & exécuté', cls: 'tr-approved' },
  rejected: { label: 'Rejeté', cls: 'tr-rejected' },
};

export function TreasurySection({ transfers, meName, liquidity, amortization, canRequest, canApprove, onRequest, onDecide, onExport, onReportPdf }: {
  transfers: Transfer[]; meName: string; liquidity: Liquidity | null; amortization: Amortization | null;
  canRequest: boolean; canApprove: boolean;
  onRequest: (i: { amount: number; destination: string; reason: string }) => void;
  onDecide: (id: string, action: 'approve' | 'reject', note?: string) => void;
  onExport: () => void; onReportPdf: () => void;
}) {
  const [amount, setAmount] = useState(1_000_000);
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const pending = transfers.filter((t) => t.status === 'pending');
  const approvedTotal = transfers.filter((t) => t.status === 'approved').reduce((s, t) => s + t.amount, 0);
  const submit = () => {
    if (!destination.trim() || !reason.trim() || amount <= 0) return;
    onRequest({ amount, destination: destination.trim(), reason: reason.trim() });
    setDestination(''); setReason('');
  };
  return (
    <>
      {/* Tour de contrôle liquidité (macro-économie) */}
      {liquidity && (
        <>
          <section className="adm-kpis">
            <Kpi label="Cash on hand" value={fcfa(liquidity.cashOnHand)} sub="liquidités consolidées" tone="teal" />
            <Kpi label="Ratio de couverture" value={`${liquidity.backingRatio} %`} sub={liquidity.backingOk ? 'séquestre conforme' : 'SOUS-CAPITALISÉ'} tone={liquidity.backingOk ? 'green' : 'danger'} />
            <Kpi label="Burn rate / mois" value={fcfa(liquidity.burnRate)} sub={liquidity.burnRate <= 0 ? 'rentable' : 'consommation de capital'} tone={liquidity.burnRate <= 0 ? 'mint' : 'danger'} />
            <Kpi label="Runway" value={liquidity.runwayMonths === null ? '∞' : `${liquidity.runwayMonths} mois`} sub="avant levée de fonds" tone="muted" />
          </section>
          <div className="adm-card">
            <div className="adm-card-h"><h3>Garantie des portefeuilles (escrow)</h3><button className="adm-btn xs solid" onClick={onReportPdf}>⬇ Reporting exécutif (PDF)</button></div>
            <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
              <div><span className="adm-muted" style={{ fontSize: 12 }}>Argent virtuel détenu (wallets)</span><div><strong>{fcfa(liquidity.virtualHeld)}</strong></div></div>
              <div><span className="adm-muted" style={{ fontSize: 12 }}>Compte séquestre</span><div><strong>{fcfa(liquidity.escrow)}</strong></div></div>
              <div><span className="adm-muted" style={{ fontSize: 12 }}>Revenu net mensuel</span><div><strong>{fcfa(liquidity.netMonthly)}</strong></div></div>
            </div>
            {!liquidity.backingOk && <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--a-danger)' }}>🔴 Alerte : l'argent virtuel dépasse le séquestre. Transférez des fonds vers le compte séquestre (risque de bank-run).</p>}
            {amortization && amortization.vehicles > 0 && (
              <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
                Flotte électrique en propre (CAPEX) : {amortization.vehicles} véhicule(s) · valeur nette comptable {fcfa(amortization.totalBookValue)} (amortissement selon les km).
              </p>
            )}
          </div>
        </>
      )}
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          <strong>Double validation obligatoire</strong> : le Directeur Financier <em>demande</em> un virement,
          seul un membre de la direction (CEO, DG, DAA, COO) peut l'<em>approuver</em> ou le <em>rejeter</em>.
          Personne ne peut approuver sa propre demande. Chaque décision est journalisée.
        </p>
      </div>
      <section className="adm-kpis">
        <Kpi label="Demandes en attente" value={String(pending.length)} sub="à valider par la direction" tone={pending.length ? 'danger' : 'muted'} />
        <Kpi label="Virements exécutés" value={fcfa(approvedTotal)} sub={`${transfers.filter((t) => t.status === 'approved').length} virement(s)`} tone="mint" />
        <Kpi label="Total demandes" value={String(transfers.length)} sub="historique complet" tone="teal" />
        <Kpi label="Votre pouvoir" value={canApprove ? 'Approbation' : canRequest ? 'Demande' : 'Lecture'} sub={canApprove ? 'niveau direction' : canRequest ? 'aval requis' : 'consultation'} tone="green" />
      </section>
      {canRequest && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Demander un virement</h3><span className="adm-muted">soumis à l'aval de la direction</span></div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="price-field"><span>Montant (F CFA)</span><input type="number" min={1} step={50000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label>
            <label className="price-field" style={{ minWidth: 260 }}><span>Destination (banque / compte)</span><input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="SGCI — CI93 SG01 0002 4518" /></label>
            <label className="price-field" style={{ minWidth: 220 }}><span>Motif</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Salaires, fournisseur…" /></label>
            <button className="adm-btn solid" onClick={submit}>Soumettre</button>
          </div>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Virements</h3>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="adm-muted">{transfers.length}</span>
            <button className="adm-btn xs" onClick={onExport}>⬇ Export comptable (CSV)</button>
          </div>
        </div>
        {transfers.length === 0 && <p className="adm-empty">Aucun virement pour l'instant.</p>}
        <table className="adm-table">
          <thead><tr><th>Réf.</th><th className="r">Montant</th><th>Destination</th><th>Motif</th><th>Demandé par</th><th>Statut</th><th>Décision</th>{canApprove && <th>Actions</th>}</tr></thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.id}</td>
                <td className="r"><strong>{fcfa(t.amount)}</strong></td>
                <td>{t.destination}</td>
                <td>{t.reason}</td>
                <td>{t.requestedBy}</td>
                <td><span className={`adm-pill ${TR_STATUS[t.status]?.cls ?? ''}`}>{TR_STATUS[t.status]?.label ?? t.status}</span></td>
                <td className="adm-muted" style={{ fontSize: 12 }}>{t.decidedBy ? `${t.decidedBy}${t.decisionNote ? ` — ${t.decisionNote}` : ''}` : '—'}</td>
                {canApprove && (
                  <td>
                    {t.status === 'pending' && t.requestedBy !== meName && (
                      <div className="row" style={{ gap: 6 }}>
                        <button className="adm-btn xs solid" onClick={() => onDecide(t.id, 'approve')}>Approuver</button>
                        <button className="adm-btn xs" onClick={() => onDecide(t.id, 'reject', 'Refusé par la direction')}>Rejeter</button>
                      </div>
                    )}
                    {t.status === 'pending' && t.requestedBy === meName && <span className="adm-muted" style={{ fontSize: 12 }}>Votre demande — aval d'un autre dirigeant requis</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* --------------------------- Mobilité verte --------------------------- */
export function GreenSection({ g, ops, onPdf, onEnergyCsv }: { g: GreenReport; ops: OpsConfig | null; onPdf: () => void; onEnergyCsv: () => void }) {
  const co2 = g.co2SavedTons >= 1 ? `${g.co2SavedTons.toLocaleString('fr-FR')} t` : `${g.co2SavedKg.toLocaleString('fr-FR')} kg`;
  return (
    <>
      <section className="adm-kpis">
        <Kpi label="CO2 économisé" value={co2} sub="vs flotte thermique équivalente" tone="green" />
        <Kpi label="Trajets 100 % électriques" value={`${g.electricShare} %`} sub={`${g.kmElectric.toLocaleString('fr-FR')} km parcourus`} tone="mint" />
        <Kpi label="Santé batteries (SoH)" value={g.fleet.avgSoh != null ? `${g.fleet.avgSoh} %` : '—'} sub="dégradation moyenne — maintenance" tone="teal" />
        <Kpi label="Batteries faibles" value={String(g.fleet.lowBattery)} sub="véhicules < 20 % (exclus du dispatch si insuffisant)" tone={g.fleet.lowBattery ? 'danger' : 'muted'} />
      </section>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Hypothèses : thermique ~150 g CO2/km · électrique ~20 g/km · hybride ~90 g/km (courses terminées).
          L'algorithme <strong>écarte automatiquement</strong> du dispatch tout électrique dont la batterie ne couvre
          pas la course demandée (~1 %/km + réserve 10 %). Incitation heures creuses{ops ? ` (${ops.offPeakStart} h → ${ops.offPeakEnd} h, bonus ${ops.offPeakBonus} F)` : ''} pour lisser les coûts d'électricité.
        </p>
      </div>
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Rapports & exports</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="adm-btn xs solid" onClick={onPdf}>⬇ Certificat CO2 (PDF)</button>
            <button className="adm-btn xs" onClick={onEnergyCsv}>⬇ Data énergie (Excel/CSV)</button>
          </div>
        </div>
        <p className="adm-muted" style={{ margin: 0, fontSize: 12 }}>
          Certificat d'économie de CO2 (communication institutionnelle, subventions) et export OPEX
          (km électriques, kWh estimés, coûts de recharge) pour le business plan. Les rapports ESG par
          client entreprise sont dans la session Entreprises (B2B).
        </p>
      </div>
      {(g.topGreenClients ?? []).length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Fidélisation verte — Points Carbone</h3><span className="adm-muted">passagers les plus engagés</span></div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {g.topGreenClients!.map((c) => (
              <span key={c.id} className="adm-pill av-online" title={c.id}>🌿 {c.name ?? c.id} · {c.greenPoints.toLocaleString('fr-FR')} pts</span>
            ))}
          </div>
          <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            1 point par kilomètre 100 % électrique payé. Les paliers d'échange (réductions) se configurent avec les codes promo.
          </p>
        </div>
      )}
      {(g.chargingStations ?? []).length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Bornes de recharge partenaires</h3><span className="adm-muted">{g.chargingStations!.length} bornes · Abidjan</span></div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {g.chargingStations!.map((s) => (
              <span key={s.id} className={`adm-pill ${s.fast ? 'av-online' : ''}`} title={`${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`}>
                🔌 {s.name}{s.fast ? ' · rapide' : ''}
              </span>
            ))}
          </div>
          <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            En heures creuses, dirige les chauffeurs en batterie faible vers les bornes via une notification
            (section Notifications → audience « chauffeurs »).
          </p>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Télémétrie batteries (SoC & SoH)</h3><span className="adm-muted">{g.fleet.electric} électriques · {g.fleet.hybrid} hybrides · vert &gt; 50 % · orange 20–50 % · rouge &lt; 20 %</span></div>
        {g.fleet.batteries.length === 0 && <p className="adm-empty">Aucune télémétrie remontée (app chauffeur → POST /drivers/:id/telemetry).</p>}
        <table className="adm-table">
          <thead><tr><th>Véhicule</th><th>Matricule</th><th>État</th><th style={{ width: '34%' }}>Charge (SoC)</th><th className="r">Santé (SoH)</th></tr></thead>
          <tbody>
            {g.fleet.batteries.map((b) => {
              const soc = b.batteryPct ?? 0;
              const socCls = soc < 20 ? ' low' : soc < 50 ? ' mid' : '';
              return (
                <tr key={b.id}>
                  <td>{b.name}</td><td className="mono">{b.matricule}</td>
                  <td><span className={`adm-pill av-${b.availability}`}>{availLabel(b.availability)}</span></td>
                  <td>
                    <div className="adm-batt">
                      <div className={`adm-batt-fill${socCls}`} style={{ width: `${soc}%` }} />
                      <span className="adm-batt-label">{soc} %</span>
                    </div>
                  </td>
                  <td className={`r ${b.batteryHealthPct != null && b.batteryHealthPct < 80 ? 'neg' : ''}`}>{b.batteryHealthPct != null ? `${b.batteryHealthPct} %` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------------- Intelligence & prédiction --------------------- */
/** Nom affichable d'une session, pour renvoyer l'employé là où le sujet se traite. */
const SECTION_LABEL: Record<string, string> = {
  vigilance: 'Vigilance', direction: 'Direction générale', rental: 'Location',
  rentalTarifs: 'Tarifs location', subscriptions: 'Abonnements', treasury: 'Trésorerie',
  finance: 'Finance', drivers: 'Chauffeurs', dispatch: 'Dispatch', rides: 'Courses',
  green: 'Flotte verte', disputes: 'Litiges', support: 'Support', security: 'Sécurité',
  audit: 'Journal', zones: 'Zones',
};

export function IntelSection({ predict, conversion, churn, fraud, elasticity, canNotify, onReengage, onCopilot, onSujets, onAller }: {
  predict: { hour: number; cells: PredictCell[] } | null; conversion: ConversionCell[];
  churn: ChurnReport | null; fraud: FraudReport | null; elasticity: ElasticityCell[];
  canNotify: boolean; onReengage: () => void;
  onCopilot: (q: string) => Promise<CopilotAnswer | null>;
  /** Ce que l'assistant sait réellement répondre — chargé depuis le serveur. */
  onSujets: () => Promise<AssistantSujet[]>;
  onAller: (section: string) => void;
}) {
  const [cq, setCq] = useState('');
  const [ans, setAns] = useState<CopilotAnswer | null>(null);
  const [thinking, setThinking] = useState(false);
  const [sujets, setSujets] = useState<AssistantSujet[]>([]);

  // Les suggestions viennent du serveur : affichées en dur, elles finissaient par
  // proposer des questions que le moteur ne savait plus traiter.
  useEffect(() => { void onSujets().then(setSujets); }, [onSujets]);

  const ask = async (q?: string) => {
    const texte = (q ?? cq).trim();
    if (!texte) return;
    setCq(texte);
    setThinking(true);
    try { setAns(await onCopilot(texte)); } finally { setThinking(false); }
  };

  return (
    <>
      {/* Assistant ORION — moteur de questions sur les données réelles. */}
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>🔎 Assistant ORION</h3>
          <span className="adm-muted">interroge les données réelles de la plateforme</span>
        </div>
        <div className="adm-chat-input">
          <input
            value={cq}
            onChange={(e) => setCq(e.target.value)}
            placeholder="Ex. « la plateforme va-t-elle bien ? », « chiffre d’affaires des locations ce mois-ci »…"
            onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }}
          />
          <button className="adm-btn solid" onClick={() => void ask()} disabled={thinking}>{thinking ? '…' : 'Demander'}</button>
        </div>

        {ans && (
          <div className="adm-role-card" style={{ marginTop: 10 }}>
            <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-line' }}>{ans.answer}</p>
            {ans.sources.length > 0 && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                <span className="adm-muted" style={{ fontSize: 12 }}>Creuser dans :</span>
                {ans.sources.map((sec) => (
                  <button key={sec} className="adm-btn xs" onClick={() => onAller(sec)}>{SECTION_LABEL[sec] ?? sec} →</button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Quand la question n'est pas comprise, on le dit — et on montre quoi demander. */}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {sujets.map((s) => (
            <button key={s.id} className="adm-btn xs" onClick={() => void ask(s.exemple)}>{s.exemple}</button>
          ))}
        </div>

        <p className="adm-muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>
          L’assistant lit les modules de la plateforme et répond avec les chiffres du moment.
          Il ne rédige rien d’inventé : aucun modèle de langage n’intervient, et quand il ne
          comprend pas une question, il le dit au lieu de produire une réponse plausible.
        </p>
      </div>

      {/* Moteur anti-fraude */}
      <div className="adm-card">
        <div className="adm-card-h"><h3>🛡️ Détection de fraude</h3><span className="adm-muted">courses fantômes · spoofing GPS · risque transactionnel</span></div>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>Courses fantômes / collusion ({fraud?.ghostRides.length ?? 0})</p>
            <ul className="adm-conv-list">
              {(fraud?.ghostRides ?? []).map((g, i) => (
                <li key={i}><span>{g.driverName ?? g.driverId.slice(0, 8)} ↔ {g.clientId.slice(0, 12)}</span><span className="adm-pill tr-rejected">{g.count} courses</span></li>
              ))}
              {(fraud?.ghostRides.length ?? 0) === 0 && <li><span className="adm-muted">Aucune collusion détectée ✅</span></li>}
            </ul>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>Spoofing GPS (téléportation) ({fraud?.gpsSpoof.length ?? 0})</p>
            <ul className="adm-conv-list">
              {(fraud?.gpsSpoof ?? []).map((s, i) => (
                <li key={i}><span className="mono">{s.rideId.slice(0, 10)}</span><span className="adm-pill tr-rejected">saut {(s.jumpMeters / 1000).toFixed(1)} km</span></li>
              ))}
              {(fraud?.gpsSpoof.length ?? 0) === 0 && <li><span className="adm-muted">Aucun spoofing détecté ✅</span></li>}
            </ul>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>Risque transactionnel ({fraud?.txRisk.length ?? 0})</p>
            <ul className="adm-conv-list">
              {(fraud?.txRisk ?? []).map((c) => (
                <li key={c.id}><span>{c.name ?? c.id}</span><span className="adm-pill tr-pending">{c.cancellations} annul.</span></li>
              ))}
              {(fraud?.txRisk.length ?? 0) === 0 && <li><span className="adm-muted">Aucun compte à risque ✅</span></li>}
            </ul>
          </div>
        </div>
      </div>

      {/* Élasticité-prix */}
      {elasticity.length > 0 && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>📈 Élasticité-prix</h3><span className="adm-muted">multiplicateur recommandé d’après le taux de conversion observé</span></div>
          <table className="adm-table">
            <thead><tr><th>Cellule</th><th className="r">Sessions</th><th className="r">Conversion</th><th className="r">Multiplicateur optimal</th></tr></thead>
            <tbody>
              {elasticity.map((c) => (
                <tr key={c.cell}>
                  <td className="mono">{c.lat.toFixed(3)}, {c.lng.toFixed(3)}</td>
                  <td className="r">{c.sessions}</td>
                  <td className={`r ${c.rate < 30 ? 'neg' : 'pos'}`}>{c.rate} %</td>
                  <td className="r"><span className={`adm-pill ${c.recommended > 1 ? 'tr-pending' : 'av-online'}`}>×{c.recommended.toFixed(2)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="adm-muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
            Règle appliquée, sur les 12 dernières heures et à partir de 5 sessions dans la cellule :
            conversion ≥ 60 % → ×1,50 ; ≥ 40 % → ×1,25 ; en dessous → aucune majoration, car majorer une
            zone qui convertit mal ferait fuir les clients restants. C’est un barème, pas une prédiction :
            le multiplicateur reste plafonné par l’incitation verte définie dans Tarification.
          </p>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Heatmap prédictive</h3><span className="adm-muted">demande attendue vers {predict ? `${String(predict.hour).padStart(2, '0')}h` : '—'} (moyenne historique)</span></div>
        {(!predict || predict.cells.length === 0) && <p className="adm-empty">Pas encore assez d'historique pour prédire — les cellules apparaîtront avec l'activité.</p>}
        {predict && predict.cells.length > 0 && (
          <table className="adm-table">
            <thead><tr><th>Cellule</th><th className="r">Demande prévue</th><th className="r">Chauffeurs sur place</th><th className="r">Manque</th><th>Recommandation</th></tr></thead>
            <tbody>
              {predict.cells.map((c) => (
                <tr key={c.cell}>
                  <td className="mono">{c.lat.toFixed(3)}, {c.lng.toFixed(3)}</td>
                  <td className="r">{c.expected}</td><td className="r">{c.supply}</td>
                  <td className={`r ${c.gap > 0 ? 'neg' : 'pos'}`}>{c.gap}</td>
                  <td>{c.gap > 0 ? <span className="adm-pill tr-pending">Diriger {c.gap} chauffeur{c.gap > 1 ? 's' : ''} en avance</span> : <span className="adm-pill av-online">Couvert</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="adm-card">
        <div className="adm-card-h"><h3>Conversion par zone</h3><span className="adm-muted">sessions (devis) vs commandes</span></div>
        {conversion.length === 0 && <p className="adm-empty">Aucune session enregistrée pour l'instant.</p>}
        {conversion.length > 0 && (
          <table className="adm-table">
            <thead><tr><th>Cellule</th><th className="r">Sessions</th><th className="r">Commandes</th><th className="r">Taux</th><th>Diagnostic</th></tr></thead>
            <tbody>
              {conversion.map((c) => (
                <tr key={c.cell}>
                  <td className="mono">{c.lat.toFixed(3)}, {c.lng.toFixed(3)}</td>
                  <td className="r">{c.sessions}</td><td className="r">{c.orders}</td>
                  <td className={`r ${c.rate < 30 ? 'neg' : 'pos'}`}>{c.rate} %</td>
                  <td>{c.rate < 30 ? <span className="adm-pill tr-rejected">Tarif élevé ou manque de chauffeurs</span> : <span className="adm-pill av-online">Saine</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="adm-card">
        <div className="adm-card-h">
          <h3>Prédiction d'attrition (churn)</h3>
          {canNotify && <button className="adm-btn xs solid" onClick={onReengage}>📣 Campagne de réengagement</button>}
        </div>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>Clients réguliers silencieux ≥ 14 j ({churn?.clients.length ?? 0})</p>
            <ul className="adm-conv-list">
              {(churn?.clients ?? []).map((c) => (
                <li key={c.id}><span>{c.name ?? c.id} · {c.rides} courses</span><span className="adm-muted">{ago(c.lastSeenAt)}</span></li>
              ))}
              {(churn?.clients.length ?? 0) === 0 && <li><span className="adm-muted">Aucun — fidélité au vert ✅</span></li>}
            </ul>
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <p className="adm-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>Chauffeurs inactifs ≥ 7 j ({churn?.drivers.length ?? 0})</p>
            <ul className="adm-conv-list">
              {(churn?.drivers ?? []).map((d) => (
                <li key={d.id}><span>{d.name}</span><span className="adm-muted mono">{d.matricule}</span></li>
              ))}
              {(churn?.drivers.length ?? 0) === 0 && <li><span className="adm-muted">Aucun — flotte engagée ✅</span></li>}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------ Comptes Entreprises (B2B) ------------------- */
export function CorporateSection({ accounts, canWrite, canSettle, canBook, onSave, onSettle, onInvoice, onEsg, onInvoicePdf, onImport, onBook, onContact }: {
  accounts: CorporateAccount[]; canWrite: boolean; canSettle: boolean; canBook: boolean;
  onSave: (i: { id?: string; name: string; contactEmail?: string; contactPhone?: string; creditLimit: number; nif?: string; kickbackRate?: number }) => void;
  /** Relancer un compte en dépassement se fait au téléphone, pas par courriel. */
  onContact: ContactHandler;
  onSettle: (id: string) => void; onInvoice: (id: string) => void; onEsg: (id: string) => void;
  onInvoicePdf: (id: string) => void;
  onImport: (id: string, memberIds: string[]) => void;
  onBook: (id: string, input: { guestName: string; origin: { lat: number; lng: number }; destination: { lat: number; lng: number }; category: string }) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [limit, setLimit] = useState(500_000);
  const [nif, setNif] = useState('');
  const [tel, setTel] = useState('');
  const [kickback, setKickback] = useState(0);
  const doImport = (id: string) => {
    const raw = window.prompt('Import de masse — identifiants clients ORION séparés par des virgules :', 'client-1, client-2, client-3');
    if (!raw) return;
    onImport(id, raw.split(',').map((s) => s.trim()).filter(Boolean));
  };
  const doBook = (id: string) => {
    const guestName = window.prompt('Web Booker (conciergerie) — prénom du client :', '');
    if (!guestName) return;
    onBook(id, { guestName, origin: { lat: 5.3596, lng: -3.9903 }, destination: { lat: 5.2614, lng: -3.9268 }, category: 'or' });
  };
  return (
    <>
      <div className="adm-card">
        <p className="adm-muted" style={{ margin: 0 }}>
          Hôtels, sociétés, ambassades : chaque compte dispose d'une <strong>ligne de crédit mensuelle</strong>.
          Leurs employés commandent avec le <strong>code société</strong> sans paiement immédiat ; au-delà du
          plafond, la course est refusée. Facture <strong>consolidée</strong> en fin de mois (CSV compatible
          logiciels comptables), règlement avec aval de la direction.
        </p>
      </div>
      {canWrite && (
        <div className="adm-card">
          <div className="adm-card-h"><h3>Nouveau compte entreprise</h3></div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="price-field"><span>Raison sociale</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hôtel Ivoire" /></label>
            <label className="price-field"><span>NIF (fiscal)</span><input value={nif} onChange={(e) => setNif(e.target.value)} placeholder="CI-123456" /></label>
            <label className="price-field"><span>E-mail de facturation</span><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="compta@hotel.ci" /></label>
            <label className="price-field"><span>Ligne de crédit (F / mois)</span><input type="number" min={0} step={50000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
            <label className="price-field"><span>Rétrocommission (%)</span><input type="number" min={0} max={50} value={kickback} onChange={(e) => setKickback(Number(e.target.value))} /></label>
            <label className="price-field"><span>Téléphone du donneur d’ordre</span><input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="+225…" /></label>
            <button className="adm-btn solid" onClick={() => { if (name.trim()) { onSave({ name: name.trim(), contactEmail: email.trim() || undefined, contactPhone: tel.trim() || undefined, creditLimit: limit, nif: nif.trim() || undefined, kickbackRate: kickback ? kickback / 100 : undefined }); setName(''); setEmail(''); setTel(''); setNif(''); setKickback(0); } }}>Créer</button>
          </div>
          <p className="adm-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            Filiales/départements, politiques de déplacement (horaires/zones/gammes), import de masse des
            collaborateurs, web booker conciergerie et rétrocommission d'apport d'affaires (kickback).
          </p>
        </div>
      )}
      <div className="adm-card">
        <div className="adm-card-h"><h3>Comptes</h3><span className="adm-muted">{accounts.length}</span></div>
        {accounts.length === 0 && <p className="adm-empty">Aucun compte entreprise pour l'instant.</p>}
        <table className="adm-table">
          <thead><tr><th>Société</th><th>Code</th><th className="r">Crédit consommé</th><th className="r">Plafond</th><th style={{ width: '22%' }}>Utilisation</th><th>Actions</th></tr></thead>
          <tbody>
            {accounts.map((a) => {
              const pctUsed = a.creditLimit ? Math.min(100, Math.round((a.balanceUsed / a.creditLimit) * 100)) : 0;
              return (
                <tr key={a.id}>
                  <td>{a.name}
                    <div className="adm-muted" style={{ fontSize: 11 }}>{a.contactEmail ?? '—'}{a.nif ? ` · NIF ${a.nif}` : ''}{a.parentId ? ` · filiale de ${a.parentId}` : ''}</div>
                    <div style={{ marginTop: 4 }}>
                      <ContactRapide type="entreprise" id={a.id} numero={a.contactPhone} nom={a.name} onContact={onContact} />
                    </div>
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                      {a.kickbackRate ? <span className="adm-pill av-online" title="Rétrocommission">↩ {Math.round(a.kickbackRate * 100)} %</span> : null}
                      {(a.members?.length ?? 0) > 0 ? <span className="adm-pill">👥 {a.members!.length}</span> : null}
                      {a.policy ? <span className="adm-pill tr-pending" title="Politique de déplacement active">🔒 politique</span> : null}
                    </div>
                  </td>
                  <td className="mono">{a.id}</td>
                  <td className="r">{fcfa(a.balanceUsed)}</td>
                  <td className="r">{fcfa(a.creditLimit)}</td>
                  <td>
                    <div className="adm-batt">
                      <div className={`adm-batt-fill${pctUsed >= 90 ? ' low' : ''}`} style={{ width: `${pctUsed}%` }} />
                      <span className="adm-batt-label">{pctUsed} %</span>
                    </div>
                  </td>
                  <td><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {canBook && <button className="adm-btn xs" title="Web Booker (conciergerie)" onClick={() => doBook(a.id)}>🛎 Booker</button>}
                    {canWrite && <button className="adm-btn xs" title="Import de masse des collaborateurs" onClick={() => doImport(a.id)}>👥 Import</button>}
                    <button className="adm-btn xs" onClick={() => onInvoice(a.id)}>⬇ CSV</button>
                    <button className="adm-btn xs" title="Facture consolidée PDF" onClick={() => onInvoicePdf(a.id)}>⬇ Facture</button>
                    <button className="adm-btn xs" title="Rapport ESG / RSE (bilan carbone certifié)" onClick={() => onEsg(a.id)}>⬇ ESG</button>
                    {canSettle && a.balanceUsed > 0 && <button className="adm-btn xs solid" onClick={() => onSettle(a.id)}>Régler</button>}
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* --------------------------- Équipes & managers ----------------------- */
