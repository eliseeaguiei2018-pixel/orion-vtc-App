/**
 * Suppression de compte SANS l'app (exigence Google Play). Même vérification par code
 * SMS que l'app ; la session obtenue sert uniquement à supprimer le compte.
 */
const API = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const message = (txt: string, erreur = false) => { const m = $('message'); m.textContent = txt; m.className = erreur ? 'erreur' : ''; };

async function appel(path: string, init: RequestInit = {}): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const r = await fetch(`${API}${path}`, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
    const data = await r.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: r.ok, data };
  } catch {
    return { ok: false, data: { error: 'Connexion impossible. Réessayez dans un instant.' } };
  }
}
/** Le serveur répond `{ error: { code, message } }` ou `{ error: "texte" }`. */
const erreurDe = (d: Record<string, unknown>): string => {
  const e = d.error;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') return (e as { message: string }).message;
  return typeof e === 'string' ? e : 'Une erreur est survenue.';
};

let telephone = '';
$('etape-numero').addEventListener('submit', async (e) => {
  e.preventDefault();
  telephone = $<HTMLInputElement>('tel').value.trim();
  const r = await appel('/clients/auth/otp', { method: 'POST', body: JSON.stringify({ phone: telephone }) });
  if (!r.ok) { message(erreurDe(r.data), true); return; }
  if (!r.data.compteExistant) { message('Aucun compte ORION n’est rattaché à ce numéro.', true); return; }
  $('etape-numero').hidden = true;
  $('etape-code').hidden = false;
  if (r.data.devCode) { const n = $('code-dev'); n.hidden = false; n.textContent = `Code de test (développement) : ${String(r.data.devCode)}`; }
  message('Code envoyé par SMS.');
});

$('etape-code').addEventListener('submit', async (e) => {
  e.preventDefault();
  const bouton = (e.target as HTMLFormElement).querySelector('button')!;
  bouton.disabled = true;
  const code = $<HTMLInputElement>('code').value.replace(/\D/g, '');
  const v = await appel('/clients/auth/verify', { method: 'POST', body: JSON.stringify({ clientId: `web-suppression-${Date.now()}`, phone: telephone, code }) });
  if (!v.ok) { bouton.disabled = false; message(erreurDe(v.data), true); return; }
  const client = v.data.client as { id: string };
  const d = await appel(`/clients/${encodeURIComponent(client.id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${String(v.data.token)}` } });
  if (!d.ok) { bouton.disabled = false; message(erreurDe(d.data), true); return; }
  $('etape-code').hidden = true;
  message('Votre compte ORION a été supprimé. Votre nom, votre numéro, votre e-mail et votre photo sont effacés.');
});
