import { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { createPortal } from 'react-dom';
import { connexionCourse, ErreurCourse, LiaisonVocale, microDisponible, type ApercuArret, type ArretAjoute, type Auteur, type EtatAppel, type MessageChat, type ResumeArrets } from './courseLive';
import { prevenir } from './arrierePlan';
import './courseLive.css';

/**
 * LA COURSE EN DIRECT À L'ÉCRAN, commune à l'app client et à ORION Pro : chat, appel par
 * internet, arrêts facturés à la minute, réponses à l'arrivée, espèces de secours.
 * Textes en 8 langues ici même, pour se comporter pareil dans les deux apps.
 */
type Evt = { type: string; data?: unknown };
const ecouteurs = new Set<(m: Evt) => void>();
/** Les apps relaient ici les messages de leur canal temps réel (course, chauffeur). */
export function relayerEvenementCourse(m: Evt): void {
  if (/^(chat\.message|appel\.etat|ride\.arrets|paiement\.especes|ride\.status)$/.test(m.type)) for (const f of ecouteurs) f(m);
}

const LANGUES = ['fr', 'en', 'es', 'it', 'de', 'ar', 'zh', 'ru'] as const;
type Huit = readonly [string, string, string, string, string, string, string, string];
const T = {
  chat: ['Chat', 'Chat', 'Chat', 'Chat', 'Chat', 'دردشة', '聊天', 'Чат'],
  ecrire: ['Écrire un message…', 'Write a message…', 'Escribir un mensaje…', 'Scrivi un messaggio…', 'Nachricht schreiben…', 'اكتب رسالة…', '输入消息…', 'Напишите сообщение…'],
  envoyer: ['Envoyer', 'Send', 'Enviar', 'Invia', 'Senden', 'إرسال', '发送', 'Отправить'],
  discussion: ['Discussion avec {nom}', 'Chat with {nom}', 'Chat con {nom}', 'Chat con {nom}', 'Chat mit {nom}', 'محادثة مع {nom}', '与 {nom} 聊天', 'Чат с {nom}'],
  vide: ['Aucun message pour l’instant.', 'No messages yet.', 'Aún no hay mensajes.', 'Ancora nessun messaggio.', 'Noch keine Nachrichten.', 'لا توجد رسائل بعد.', '暂无消息。', 'Сообщений пока нет.'],
  close: ['La discussion de cette course est close.', 'This ride’s chat is closed.', 'El chat de este viaje está cerrado.', 'La chat di questa corsa è chiusa.', 'Der Chat dieser Fahrt ist geschlossen.', 'أُغلقت محادثة هذه الرحلة.', '本次行程的聊天已关闭。', 'Чат этой поездки закрыт.'],
  fermer: ['Fermer', 'Close', 'Cerrar', 'Chiudi', 'Schließen', 'إغلاق', '关闭', 'Закрыть'],
  sors: ['J’arrive, je sors tout de suite', 'Coming, I’ll be right out', 'Ya voy, salgo enseguida', 'Arrivo, esco subito', 'Ich komme sofort raus', 'قادم، سأخرج حالًا', '马上来，我这就出来', 'Иду, сейчас выйду'],
  retard: ['Un instant, je serai un peu en retard', 'One moment, I’ll be a little late', 'Un momento, llegaré un poco tarde', 'Un attimo, sarò un po’ in ritardo', 'Einen Moment, ich verspäte mich etwas', 'لحظة، سأتأخر قليلًا', '稍等，我会晚一点', 'Минутку, я немного задержусь'],
  orionArrive: ['Votre chauffeur est arrivé au point de prise en charge.', 'Your driver has arrived at the pickup point.', 'Su conductor ha llegado al punto de recogida.', 'Il tuo autista è arrivato al punto di ritiro.', 'Ihr Fahrer ist am Abholort angekommen.', 'وصل سائقك إلى نقطة الالتقاء.', '您的司机已到达上车点。', 'Ваш водитель прибыл к месту посадки.'],
  arriveeTitre: ['Votre chauffeur est là', 'Your driver is here', 'Su conductor está aquí', 'Il tuo autista è qui', 'Ihr Fahrer ist da', 'سائقك هنا', '您的司机到了', 'Ваш водитель на месте'],
  arriveeTexte: ['Répondez-lui d’un toucher :', 'Reply with one tap:', 'Respóndale con un toque:', 'Rispondigli con un tocco:', 'Antworten Sie mit einem Tippen:', 'أجبه بلمسة واحدة:', '一键回复：', 'Ответьте одним касанием:'],
  repondu: ['Réponse envoyée à votre chauffeur', 'Reply sent to your driver', 'Respuesta enviada a su conductor', 'Risposta inviata al tuo autista', 'Antwort an Ihren Fahrer gesendet', 'أُرسل الرد إلى سائقك', '已回复您的司机', 'Ответ отправлен водителю'],
  appel: ['Appel ORION', 'ORION call', 'Llamada ORION', 'Chiamata ORION', 'ORION-Anruf', 'مكالمة ORION', 'ORION 通话', 'Звонок ORION'],
  internet: ['Par internet · sans unités', 'Over the internet · no airtime', 'Por internet · sin saldo', 'Via internet · senza credito', 'Über Internet · ohne Guthaben', 'عبر الإنترنت · بلا رصيد', '网络通话 · 不耗话费', 'Через интернет · без минут'],
  entrant: ['{nom} vous appelle', '{nom} is calling you', '{nom} le está llamando', '{nom} ti sta chiamando', '{nom} ruft Sie an', '{nom} يتصل بك', '{nom} 来电', '{nom} звонит вам'],
  sortant: ['Appel de {nom}…', 'Calling {nom}…', 'Llamando a {nom}…', 'Chiamata a {nom}…', '{nom} wird angerufen…', 'جارٍ الاتصال بـ {nom}…', '正在呼叫 {nom}…', 'Звоним {nom}…'],
  decrocher: ['Décrocher', 'Answer', 'Contestar', 'Rispondi', 'Annehmen', 'رد', '接听', 'Ответить'],
  refuser: ['Refuser', 'Decline', 'Rechazar', 'Rifiuta', 'Ablehnen', 'رفض', '拒绝', 'Отклонить'],
  raccrocher: ['Raccrocher', 'Hang up', 'Colgar', 'Riaggancia', 'Auflegen', 'إنهاء', '挂断', 'Завершить'],
  muet: ['Micro coupé', 'Muted', 'Silenciado', 'Microfono spento', 'Stumm', 'الميكروفون مكتوم', '已静音', 'Микрофон выкл.'],
  couper: ['Couper le micro', 'Mute', 'Silenciar', 'Disattiva microfono', 'Stummschalten', 'كتم الميكروفون', '静音', 'Выкл. микрофон'],
  remettre: ['Remettre le micro', 'Unmute', 'Activar micrófono', 'Riattiva microfono', 'Mikrofon an', 'تشغيل الميكروفون', '取消静音', 'Вкл. микрофон'],
  fini: ['Appel terminé', 'Call ended', 'Llamada finalizada', 'Chiamata terminata', 'Anruf beendet', 'انتهت المكالمة', '通话结束', 'Звонок завершён'],
  sansReponse: ['Sans réponse', 'No answer', 'Sin respuesta', 'Nessuna risposta', 'Keine Antwort', 'لا رد', '无人接听', 'Нет ответа'],
  refuse: ['Appel refusé', 'Call declined', 'Llamada rechazada', 'Chiamata rifiutata', 'Anruf abgelehnt', 'رُفضت المكالمة', '对方已拒绝', 'Звонок отклонён'],
  micro: ['Autorisez le micro pour appeler par internet.', 'Allow the microphone to call over the internet.', 'Permita el micrófono para llamar por internet.', 'Consenti il microfono per chiamare via internet.', 'Erlauben Sie das Mikrofon für Internetanrufe.', 'اسمح باستخدام الميكروفون للاتصال عبر الإنترنت.', '请允许使用麦克风以进行网络通话。', 'Разрешите доступ к микрофону для звонков через интернет.'],
  maj: ['Mettez à jour l’application pour appeler par internet.', 'Update the app to call over the internet.', 'Actualice la aplicación para llamar por internet.', 'Aggiorna l’app per chiamare via internet.', 'Aktualisieren Sie die App für Internetanrufe.', 'حدّث التطبيق للاتصال عبر الإنترنت.', '请更新应用以使用网络通话。', 'Обновите приложение для звонков через интернет.'],
  reseau: ['Connexion perdue', 'Connection lost', 'Conexión perdida', 'Connessione persa', 'Verbindung verloren', 'انقطع الاتصال', '连接中断', 'Связь потеряна'],
  arrets: ['Arrêts', 'Stops', 'Paradas', 'Fermate', 'Stopps', 'التوقفات', '停靠', 'Остановки'],
  enCours: ['Arrêt en cours', 'Stop in progress', 'Parada en curso', 'Sosta in corso', 'Stopp läuft', 'توقف جارٍ', '停靠中', 'Идёт остановка'],
  demande: ['Arrêt demandé', 'Requested stop', 'Parada solicitada', 'Sosta richiesta', 'Gewünschter Stopp', 'توقف مطلوب', '临时停靠', 'Остановка по просьбе'],
  jeSuis: ['Je suis à l’arrêt : {nom}', 'I’m at the stop: {nom}', 'Estoy en la parada: {nom}', 'Sono alla fermata: {nom}', 'Ich bin am Stopp: {nom}', 'أنا في نقطة التوقف: {nom}', '已到停靠点：{nom}', 'Я на остановке: {nom}'],
  demandeClient: ['Arrêt demandé par le client', 'Stop requested by the customer', 'Parada pedida por el cliente', 'Sosta chiesta dal cliente', 'Stopp auf Kundenwunsch', 'توقف بطلب من العميل', '乘客要求停靠', 'Остановка по просьбе клиента'],
  reprendre: ['Continuer l’itinéraire', 'Continue the route', 'Continuar el itinerario', 'Continua l’itinerario', 'Route fortsetzen', 'متابعة المسار', '继续路线', 'Продолжить маршрут'],
  ensuite: ['Ensuite : {nom}', 'Next: {nom}', 'Después: {nom}', 'Poi: {nom}', 'Danach: {nom}', 'التالي: {nom}', '下一站：{nom}', 'Далее: {nom}'],
  laDestination: ['la destination', 'the destination', 'el destino', 'la destinazione', 'das Ziel', 'الوجهة', '目的地', 'пункт назначения'],
  ajoutes: ['Arrêts ajoutés au prix : {f}', 'Stops added to the price: {f}', 'Paradas sumadas al precio: {f}', 'Soste aggiunte al prezzo: {f}', 'Stopps zum Preis addiert: {f}', 'التوقفات المضافة إلى السعر: {f}', '停靠费已计入：{f}', 'Остановки в цене: {f}'],
  parMinute: ['Chaque minute d’arrêt : {f}', 'Each minute stopped: {f}', 'Cada minuto de parada: {f}', 'Ogni minuto di sosta: {f}', 'Jede Stoppminute: {f}', 'كل دقيقة توقف: {f}', '每停靠一分钟：{f}', 'Каждая минута остановки: {f}'],
  prevu: ['Arrêt prévu', 'Planned stop', 'Parada prevista', 'Sosta prevista', 'Geplanter Stopp', 'توقف مخطط', '计划停靠', 'Плановая остановка'],
  autoriser: ['Autoriser l’espèce au client', 'Allow the customer to pay cash', 'Autorizar efectivo al cliente', 'Consenti il contante al cliente', 'Barzahlung erlauben', 'السماح للعميل بالدفع نقدًا', '允许乘客付现金', 'Разрешить клиенту наличные'],
  autorisees: ['Espèces autorisées : le client peut payer en espèces.', 'Cash allowed: the customer can pay in cash.', 'Efectivo autorizado: el cliente puede pagar en efectivo.', 'Contante consentito: il cliente può pagare in contanti.', 'Barzahlung erlaubt: Der Kunde kann bar zahlen.', 'تم السماح بالدفع نقدًا: يمكن للعميل الدفع نقدًا.', '已允许现金：乘客可以付现金。', 'Наличные разрешены: клиент может заплатить наличными.'],
  clientEspeces: ['Le client confirme payer en espèces : encaissez puis confirmez.', 'The customer confirms paying cash: collect it, then confirm.', 'El cliente confirma pagar en efectivo: cobre y confirme.', 'Il cliente conferma di pagare in contanti: incassa e conferma.', 'Der Kunde zahlt bar: kassieren und bestätigen.', 'أكد العميل الدفع نقدًا: استلم المبلغ ثم أكد.', '乘客确认付现金：收款后请确认。', 'Клиент платит наличными: получите и подтвердите.'],
  ajouterArret: ['Ajouter un arrêt', 'Add a stop', 'Añadir una parada', 'Aggiungi una sosta', 'Stopp hinzufügen', 'إضافة توقف', '添加停靠点', 'Добавить остановку'],
  arretVers: ['Arrêt : {nom}', 'Stop: {nom}', 'Parada: {nom}', 'Sosta: {nom}', 'Stopp: {nom}', 'توقف: {nom}', '停靠点：{nom}', 'Остановка: {nom}'],
  calcul: ['Calcul du supplément…', 'Working out the extra cost…', 'Calculando el suplemento…', 'Calcolo del supplemento…', 'Aufpreis wird berechnet…', 'جارٍ حساب الرسوم الإضافية…', '正在计算附加费…', 'Считаем доплату…'],
  apercuTexte: ['Votre chauffeur passera par cet arrêt. Le détour ajoute {f} au prix ; chaque minute d’attente sur place coûte {m} (15 s offertes).', 'Your driver will go via this stop. The detour adds {f} to the price; each minute waiting there costs {m} (first 15 s free).', 'Su conductor pasará por esta parada. El desvío suma {f} al precio; cada minuto de espera allí cuesta {m} (15 s gratis).', 'Il tuo autista passerà da questa sosta. La deviazione aggiunge {f} al prezzo; ogni minuto di attesa costa {m} (15 s gratis).', 'Ihr Fahrer fährt über diesen Stopp. Der Umweg kostet {f} mehr; jede Wartezeitminute dort kostet {m} (15 s frei).', 'سيمر سائقك بهذا التوقف. يضيف التحويل {f} إلى السعر؛ وكل دقيقة انتظار هناك تكلف {m} (أول 15 ثانية مجانًا).', '司机将途经此停靠点。绕行加价 {f}；在该处每等待一分钟收费 {m}（前 15 秒免费）。', 'Водитель заедет на эту остановку. Крюк добавит {f} к цене; каждая минута ожидания стоит {m} (15 с бесплатно).'],
  sansDetour: ['Pas de détour : le prix ne change pas ; chaque minute d’attente sur place coûte {m} (15 s offertes).', 'No detour: the price stays the same; each minute waiting there costs {m} (first 15 s free).', 'Sin desvío: el precio no cambia; cada minuto de espera allí cuesta {m} (15 s gratis).', 'Nessuna deviazione: il prezzo non cambia; ogni minuto di attesa costa {m} (15 s gratis).', 'Kein Umweg: Der Preis bleibt; jede Wartezeitminute dort kostet {m} (15 s frei).', 'لا يوجد تحويل: السعر لا يتغير؛ وكل دقيقة انتظار هناك تكلف {m} (أول 15 ثانية مجانًا).', '无需绕行：价格不变；在该处每等待一分钟收费 {m}（前 15 秒免费）。', 'Без крюка: цена прежняя; каждая минута ожидания стоит {m} (15 с бесплатно).'],
  nouveauPrix: ['Nouveau prix : {f}', 'New price: {f}', 'Nuevo precio: {f}', 'Nuovo prezzo: {f}', 'Neuer Preis: {f}', 'السعر الجديد: {f}', '新价格：{f}', 'Новая цена: {f}'],
  confirmerArret: ['Ajouter l’arrêt · +{f}', 'Add the stop · +{f}', 'Añadir la parada · +{f}', 'Aggiungi la sosta · +{f}', 'Stopp hinzufügen · +{f}', 'إضافة التوقف · +{f}', '添加停靠点 · +{f}', 'Добавить остановку · +{f}'],
  annuler: ['Annuler', 'Cancel', 'Cancelar', 'Annulla', 'Abbrechen', 'إلغاء', '取消', 'Отмена'],
  arretAjouteOk: ['Arrêt ajouté : votre chauffeur est prévenu.', 'Stop added: your driver has been told.', 'Parada añadida: su conductor está avisado.', 'Sosta aggiunta: il tuo autista è stato avvisato.', 'Stopp hinzugefügt: Ihr Fahrer ist informiert.', 'أُضيف التوقف: تم إخطار سائقك.', '已添加停靠点，已通知司机。', 'Остановка добавлена: водитель предупреждён.'],
  nouvelArret: ['Le client a ajouté un arrêt : {nom}', 'The customer added a stop: {nom}', 'El cliente añadió una parada: {nom}', 'Il cliente ha aggiunto una sosta: {nom}', 'Der Kunde hat einen Stopp hinzugefügt: {nom}', 'أضاف العميل توقفًا: {nom}', '乘客添加了停靠点：{nom}', 'Клиент добавил остановку: {nom}'],
  detour: ['Détour : +{f} · le guidage passe par l’arrêt', 'Detour: +{f} · guidance goes via the stop', 'Desvío: +{f} · la guía pasa por la parada', 'Deviazione: +{f} · la guida passa dalla sosta', 'Umweg: +{f} · die Navigation führt über den Stopp', 'التحويل: +{f} · يمر التوجيه بالتوقف', '绕行：+{f} · 导航将途经该点', 'Крюк: +{f} · маршрут через остановку'],
  orionArret: ['Le client a ajouté un arrêt : {nom}. Chaque minute sur place est comptée.', 'The customer added a stop: {nom}. Each minute there is counted.', 'El cliente añadió una parada: {nom}. Cada minuto allí se cobra.', 'Il cliente ha aggiunto una sosta: {nom}. Ogni minuto lì viene conteggiato.', 'Der Kunde hat einen Stopp hinzugefügt: {nom}. Jede Minute dort zählt.', 'أضاف العميل توقفًا: {nom}. تُحتسب كل دقيقة هناك.', '乘客添加了停靠点：{nom}。在该处的每分钟都会计费。', 'Клиент добавил остановку: {nom}. Каждая минута там учитывается.'],
  orionArretDetour: ['Le client a ajouté un arrêt : {nom}. Détour : +{f} ; chaque minute sur place est comptée.', 'The customer added a stop: {nom}. Detour: +{f}; each minute there is counted.', 'El cliente añadió una parada: {nom}. Desvío: +{f}; cada minuto allí se cobra.', 'Il cliente ha aggiunto una sosta: {nom}. Deviazione: +{f}; ogni minuto lì viene conteggiato.', 'Der Kunde hat einen Stopp hinzugefügt: {nom}. Umweg: +{f}; jede Minute dort zählt.', 'أضاف العميل توقفًا: {nom}. التحويل: +{f}؛ تُحتسب كل دقيقة هناك.', '乘客添加了停靠点：{nom}。绕行：+{f}；在该处的每分钟都会计费。', 'Клиент добавил остановку: {nom}. Крюк: +{f}; каждая минута там учитывается.'],
  detourLigne: ['Détour vers {nom}', 'Detour to {nom}', 'Desvío a {nom}', 'Deviazione verso {nom}', 'Umweg zu {nom}', 'تحويل إلى {nom}', '绕行至 {nom}', 'Крюк к {nom}'],
  autoriseClient: ['Votre chauffeur autorise le paiement en espèces.', 'Your driver allows payment in cash.', 'Su conductor autoriza el pago en efectivo.', 'Il tuo autista consente il pagamento in contanti.', 'Ihr Fahrer erlaubt Barzahlung.', 'يسمح سائقك بالدفع نقدًا.', '您的司机允许现金支付。', 'Водитель разрешает оплату наличными.'],
} satisfies Record<string, Huit>;
type Cle = keyof typeof T;

function langue(): number {
  let l = '';
  try { l = document.documentElement.lang || localStorage.getItem('orion.driver.lang') || localStorage.getItem('orion.lang') || navigator.language; } catch { l = 'fr'; }
  const i = LANGUES.indexOf((l || 'fr').slice(0, 2).toLowerCase() as (typeof LANGUES)[number]);
  return i < 0 ? 0 : i;
}
export function tx(cle: Cle, vars: Record<string, string | number> = {}): string {
  return T[cle][langue()]!.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
export const francs = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** Même règle que le serveur : 15 s de tolérance, puis chaque minute entamée. */
const minutesFacturees = (ms: number) => { const s = ms / 1000; return s <= 15 ? 0 : Math.ceil((s - 15) / 60); };

/** Texte d'un message dans la langue de l'écran (réponses toutes prêtes, annonces d'ORION). */
function texteMessage(m: MessageChat): string {
  if (m.rapide) return tx(m.rapide);
  if (m.de === 'orion' && m.texte.startsWith('Votre chauffeur est arrivé')) return tx('orionArrive');
  const ajout = m.de === 'orion' ? /^Le client a ajouté un arrêt : (.+?)\. (?:Détour : \+(.+?) F ; )?[Cc]haque minute/.exec(m.texte) : null;
  if (ajout) return ajout[2] ? tx('orionArretDetour', { nom: ajout[1]!, f: `${ajout[2]} F` }) : tx('orionArret', { nom: ajout[1]! });
  return m.texte;
}

export interface AppelEnCours { id: string; etat: EtatAppel; de: Auteur; depuis: number; fin?: 'refuse' | 'sans_reponse' | 'raccroche' | 'coupe' }

export function useCourseLive(o: { rideId: string | null; moi: Auteur; jeton: () => string | null; actif: boolean; nomAutre: string }) {
  const cx = useMemo(() => connexionCourse(o.jeton), [o.jeton]);
  const [arrets, setArrets] = useState<ResumeArrets | null>(null);
  const [messages, setMessages] = useState<MessageChat[]>([]);
  const [chatVisible, setChatVisible] = useState(false);
  const [nonLus, setNonLus] = useState(0);
  const [appel, setAppel] = useState<AppelEnCours | null>(null);
  const [muet, setMuet] = useState(false);
  const [avis, setAvis] = useState<string | null>(null);
  const [especes, setEspeces] = useState<{ autorise: boolean; clientConfirme: boolean }>({ autorise: false, clientConfirme: false });
  const [occupe, setOccupe] = useState(false);
  /** Dernier arrêt ajouté par le client (le chauffeur en est prévenu). */
  const [nouvelArret, setNouvelArret] = useState<ArretAjoute | null>(null);
  const liaison = useRef<LiaisonVocale | null>(null);
  const appelCourant = useRef<AppelEnCours | null>(null);
  appelCourant.current = appel;
  const vu = useRef(chatVisible);
  vu.current = chatVisible;
  const id = o.actif ? o.rideId : null;

  // État initial, puis relecture régulière (un événement manqué hors connexion se rattrape).
  useEffect(() => {
    if (!id) return;
    let fini = false;
    const lire = () => {
      void cx.arrets(id).then((a) => { if (!fini) setArrets(a); }).catch(() => undefined);
      void cx.chat(id).then((c) => {
        if (fini) return;
        setMessages((avant) => {
          const nouveaux = c.messages.filter((m) => !avant.some((x) => x.id === m.id) && m.de !== o.moi);
          if (avant.length && nouveaux.length && !vu.current) setNonLus((n) => n + nouveaux.length);
          return c.messages;
        });
      }).catch(() => undefined);
    };
    lire();
    const t = window.setInterval(lire, 20_000);
    return () => { fini = true; window.clearInterval(t); };
  }, [id, cx, o.moi]);

  useEffect(() => {
    if (!id) return;
    const f = (m: Evt) => {
      const d = (m.data ?? {}) as Record<string, unknown>;
      if (d.rideId && d.rideId !== id) return;
      if (m.type === 'ride.arrets') {
        setArrets(d.arrets as ResumeArrets);
        const ajout = d.nouvelArret as ArretAjoute | undefined;
        if (ajout && o.moi === 'chauffeur') {
          setNouvelArret(ajout);
          try { navigator.vibrate?.([120, 80, 120]); } catch { /* sans vibreur */ }
          if (document.hidden) void prevenir('ORION', tx('nouvelArret', { nom: ajout.nom })).catch(() => undefined);
        }
      }
      if (m.type === 'paiement.especes') setEspeces({ autorise: Boolean(d.autorise), clientConfirme: Boolean(d.clientConfirme) });
      if (m.type === 'chat.message') {
        const msg = d.message as MessageChat;
        setMessages((l) => (l.some((x) => x.id === msg.id) ? l : [...l, msg]));
        if (msg.de !== o.moi) {
          if (!vu.current) {
            setNonLus((n) => n + 1);
            // Chat fermé : une notification discrète sur le téléphone.
            void prevenir(msg.de === 'orion' ? 'ORION' : o.nomAutre, texteMessage(msg)).catch(() => undefined);
          }
          try { navigator.vibrate?.(60); } catch { /* sans vibreur */ }
        }
      }
      if (m.type === 'appel.etat') {
        const etat = d.etat as EtatAppel;
        const de = d.de as Auteur;
        if (etat === 'fini') {
          setAppel((a) => (a ? { ...a, etat: 'fini', fin: d.raison as AppelEnCours['fin'] } : a));
          window.setTimeout(() => setAppel((a) => (a?.etat === 'fini' ? null : a)), 1800);
          return;
        }
        setAppel((a) => ({ id: String(d.appelId), etat, de, depuis: etat === 'en_cours' ? Date.now() : a?.depuis ?? Date.now() }));
        if (etat === 'sonne' && de !== o.moi) {
          try { navigator.vibrate?.([400, 200, 400, 200, 400]); } catch { /* sans vibreur */ }
          void prevenir(tx('appel'), tx('entrant', { nom: o.nomAutre })).catch(() => undefined);
        }
      }
    };
    ecouteurs.add(f);
    return () => { ecouteurs.delete(f); };
  }, [id, o.moi, o.nomAutre]);

  // La voix circule dès que l'appel est décroché, des deux côtés.
  useEffect(() => {
    if (!id || appel?.etat !== 'en_cours') return;
    const url = cx.urlVoix(id);
    if (!url) return;
    const l = new LiaisonVocale(url, (raison) => {
      if (raison === 'micro') setAvis(tx('micro'));
      // Canal fermé : fin normale (raccroché) ou vraie coupure ; seule la coupure s'annonce.
      if (raison === 'reseau') window.setTimeout(() => { if (appelCourant.current?.etat === 'en_cours') setAvis(tx('reseau')); }, 1500);
    });
    liaison.current = l;
    void l.demarrer().catch(() => { void cx.appel(id, 'raccrocher').catch(() => undefined); });
    return () => { l.arreter(); liaison.current = null; };
  }, [id, appel?.etat, cx]);
  useEffect(() => { if (liaison.current) liaison.current.muet = muet; }, [muet]);

  /** Le micro doit être accordé avant de sonner ou de décrocher (APK sans micro : mise à jour). */
  const verifierMicro = async (): Promise<boolean> => {
    if (!microDisponible()) { setAvis(tx('maj')); return false; }
    // APK d'avant les appels par internet (2.0.0, code 26) : sans permission micro, il faut la nouvelle APK.
    if (Capacitor.isNativePlatform()) {
      const build = Number((await App.getInfo().catch(() => ({ build: '0' }))).build) || 0;
      if (build > 0 && build < 27) { setAvis(tx('maj')); return false; }
    }
    try {
      const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
      flux.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      setAvis(tx('micro'));
      return false;
    }
  };
  const agir = async (f: () => Promise<unknown>) => {
    setOccupe(true);
    try { await f(); } catch (e) { setAvis(e instanceof ErreurCourse ? e.message : tx('reseau')); } finally { setOccupe(false); }
  };

  return {
    actif: Boolean(id),
    arrets, messages, nonLus, chatVisible, appel, muet, avis, especes, occupe, nouvelArret,
    effacerNouvelArret: () => setNouvelArret(null),
    /** Client : supplément d'un arrêt avant de l'ajouter. */
    apercuArret: async (position: { lat: number; lng: number }, nom?: string): Promise<ApercuArret | null> => {
      if (!id) return null;
      try { return await cx.apercuArret(id, position, nom); } catch (e) { setAvis(e instanceof ErreurCourse ? e.message : tx('reseau')); return null; }
    },
    /** Client : ajoute l'arrêt (le chauffeur est prévenu, le prix monte du détour). */
    ajouterArret: async (position: { lat: number; lng: number }, nom?: string): Promise<boolean> => {
      if (!id) return false;
      setOccupe(true);
      try { setArrets(await cx.ajouterArret(id, position, nom)); return true; } catch (e) { setAvis(e instanceof ErreurCourse ? e.message : tx('reseau')); return false; } finally { setOccupe(false); }
    },
    ouvrirChat: () => { setChatVisible(true); setNonLus(0); },
    fermerChat: () => setChatVisible(false),
    effacerAvis: () => setAvis(null),
    envoyer: (m: { texte?: string; rapide?: 'sors' | 'retard' }) => id ? agir(async () => {
      const r = await cx.envoyer(id, m);
      setMessages((l) => (l.some((x) => x.id === r.message.id) ? l : [...l, r.message]));
    }) : Promise.resolve(),
    appeler: () => id ? agir(async () => {
      if (!(await verifierMicro())) return;
      const r = await cx.appel(id, 'appeler');
      setAppel({ id: r.appelId, etat: 'sonne', de: o.moi, depuis: Date.now() });
    }) : Promise.resolve(),
    decrocher: () => id ? agir(async () => {
      if (!(await verifierMicro())) { await cx.appel(id, 'refuser'); return; }
      await cx.appel(id, 'decrocher');
    }) : Promise.resolve(),
    refuser: () => id ? agir(() => cx.appel(id, 'refuser')) : Promise.resolve(),
    raccrocher: () => id ? agir(() => cx.appel(id, 'raccrocher')) : Promise.resolve(),
    basculerMuet: () => setMuet((m) => !m),
    debutArret: (type: 'prevu' | 'demande', index?: number, position?: { lat: number; lng: number } | null) => id ? agir(async () => setArrets(await cx.debutArret(id, type, index, position))) : Promise.resolve(),
    finArret: () => id ? agir(async () => setArrets(await cx.finArret(id))) : Promise.resolve(),
    autoriserEspeces: () => id ? agir(async () => { await cx.especesAutoriser(id); setEspeces((e) => ({ ...e, autorise: true })); }) : Promise.resolve(),
    confirmerEspeces: () => id ? agir(async () => { await cx.especesConfirmer(id); setEspeces({ autorise: true, clientConfirme: true }); }) : Promise.resolve(),
  };
}
export type CourseLive = ReturnType<typeof useCourseLive>;

/* --------------------------------- Écrans --------------------------------- */

function IconeChat() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>;
}
function IconeAppel() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /></svg>;
}

/**
 * Deux boutons : chat (avec les messages non lus) et appel ORION par internet.
 * App client : le chat est un bouton jaune en léger relief (`variante="client"`).
 */
export function BoutonsCourse({ live, variante }: { live: CourseLive; variante?: 'client' }) {
  if (!live.actif) return null;
  return (
    <div className="cl-boutons">
      <button type="button" className={`cl-bouton${variante === 'client' ? ' cl-chat-jaune' : ''}`} onClick={live.ouvrirChat} aria-label={tx('chat')}>
        <IconeChat /> {tx('chat')}
        {live.nonLus > 0 && <span className="cl-pastille" aria-label={`${live.nonLus}`}>{live.nonLus}</span>}
      </button>
      <button type="button" className="cl-bouton" onClick={() => void live.appeler()} disabled={live.occupe || Boolean(live.appel)}>
        <IconeAppel /> <span className="cl-bouton-texte"><span>{tx('appel')}</span><small>{tx('internet')}</small></span>
      </button>
      {live.avis && <p className="cl-avis" role="alert" onClick={live.effacerAvis}>{live.avis}</p>}
    </div>
  );
}

/** Le chauffeur est arrivé : deux réponses toutes prêtes pour le client. */
export function ReponsesArrivee({ live }: { live: CourseLive }) {
  const deja = live.messages.some((m) => m.de === 'client' && m.rapide);
  if (!live.actif) return null;
  return (
    <div className="cl-arrivee" role="status">
      <strong>{tx('arriveeTitre')}</strong>
      {deja ? <span className="cl-muet">{tx('repondu')}</span> : (
        <>
          <span className="cl-muet">{tx('arriveeTexte')}</span>
          <div className="cl-rapides">
            <button type="button" className="cl-rapide" disabled={live.occupe} onClick={() => void live.envoyer({ rapide: 'sors' })}>{tx('sors')}</button>
            <button type="button" className="cl-rapide" disabled={live.occupe} onClick={() => void live.envoyer({ rapide: 'retard' })}>{tx('retard')}</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Fenêtre de discussion (plein écran) ; réponses toutes prêtes pour le client à l'arrivée. */
export function FenetreChat({ live, moi, nomAutre, rapides = false }: { live: CourseLive; moi: Auteur; nomAutre: string; rapides?: boolean }) {
  const [texte, setTexte] = useState('');
  const fin = useRef<HTMLDivElement | null>(null);
  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }); }, [live.messages.length, live.chatVisible]);
  if (!live.chatVisible) return null;
  const envoyer = () => { const t = texte.trim(); if (!t) return; setTexte(''); void live.envoyer({ texte: t }); };
  return createPortal(
    <div className="cl-fond" role="dialog" aria-modal="true" aria-label={tx('discussion', { nom: nomAutre })}>
      <div className="cl-chat">
        <header className="cl-chat-tete">
          <strong>{tx('discussion', { nom: nomAutre })}</strong>
          <button type="button" className="cl-fermer" onClick={live.fermerChat} aria-label={tx('fermer')}>×</button>
        </header>
        <div className="cl-fil">
          {live.messages.length === 0 && <p className="cl-muet cl-centre">{tx('vide')}</p>}
          {live.messages.map((m) => (
            <div key={m.id} className={`cl-msg ${m.de === moi ? 'moi' : m.de === 'orion' ? 'orion' : 'autre'}`}>
              <span>{texteMessage(m)}</span>
              <time>{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
          ))}
          <div ref={fin} />
        </div>
        {rapides && moi === 'client' && (
          <div className="cl-rapides cl-rapides-chat">
            <button type="button" className="cl-rapide" onClick={() => void live.envoyer({ rapide: 'sors' })}>{tx('sors')}</button>
            <button type="button" className="cl-rapide" onClick={() => void live.envoyer({ rapide: 'retard' })}>{tx('retard')}</button>
          </div>
        )}
        <form className="cl-saisie" onSubmit={(e) => { e.preventDefault(); envoyer(); }}>
          <input value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={tx('ecrire')} maxLength={500} aria-label={tx('ecrire')} />
          <button type="submit" className="cl-envoyer" disabled={!texte.trim() || live.occupe}>{tx('envoyer')}</button>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/** Écran d'appel : sonnerie (décrocher / refuser), communication (micro, raccrocher), fin. */
export function EcranAppel({ live, moi, nomAutre }: { live: CourseLive; moi: Auteur; nomAutre: string }) {
  const [, tic] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tic((n) => n + 1), 1000); return () => window.clearInterval(t); }, []);
  const a = live.appel;
  if (!a) return null;
  const entrant = a.de !== moi;
  const statut = a.etat === 'fini'
    ? (a.fin === 'sans_reponse' ? tx('sansReponse') : a.fin === 'refuse' ? tx('refuse') : tx('fini'))
    : a.etat === 'sonne' ? (entrant ? tx('entrant', { nom: nomAutre }) : tx('sortant', { nom: nomAutre }))
    : mmss((Date.now() - a.depuis) / 1000);
  return createPortal(
    <div className="cl-fond cl-appel-fond" role="dialog" aria-modal="true" aria-label={tx('appel')}>
      <div className="cl-appel">
        <span className={`cl-appel-onde${a.etat === 'sonne' ? ' sonne' : ''}`} aria-hidden="true"><IconeAppel /></span>
        <strong className="cl-appel-nom">{nomAutre}</strong>
        <span className="cl-appel-statut" role="status">{statut}</span>
        <span className="cl-muet">{tx('internet')}</span>
        {live.avis && <p className="cl-avis" role="alert">{live.avis}</p>}
        <div className="cl-appel-actions">
          {a.etat === 'sonne' && entrant && (
            <>
              <button type="button" className="cl-rond rouge" onClick={() => void live.refuser()} aria-label={tx('refuser')}><IconeAppel /><span>{tx('refuser')}</span></button>
              <button type="button" className="cl-rond vert" onClick={() => void live.decrocher()} aria-label={tx('decrocher')}><IconeAppel /><span>{tx('decrocher')}</span></button>
            </>
          )}
          {a.etat === 'en_cours' && (
            <button type="button" className={`cl-rond${live.muet ? ' actif' : ''}`} onClick={live.basculerMuet} aria-pressed={live.muet}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />{live.muet && <path d="M4 4l16 16" />}</svg>
              <span>{live.muet ? tx('remettre') : tx('couper')}</span>
            </button>
          )}
          {(a.etat === 'en_cours' || (a.etat === 'sonne' && !entrant)) && (
            <button type="button" className="cl-rond rouge" onClick={() => void live.raccrocher()} aria-label={tx('raccrocher')}><IconeAppel /><span>{tx('raccrocher')}</span></button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Compteur de l'arrêt en cours (mm:ss) et son coût, à la seconde. */
function useCompteur(debut: string | null | undefined, tarif: number) {
  const [, tic] = useState(0);
  useEffect(() => { if (!debut) return; const t = window.setInterval(() => tic((n) => n + 1), 1000); return () => window.clearInterval(t); }, [debut]);
  if (!debut) return null;
  const ms = Math.max(0, Date.now() - Date.parse(debut));
  return { temps: mmss(ms / 1000), montant: minutesFacturees(ms) * tarif };
}

/**
 * Arrêts : côté chauffeur, les boutons (« Je suis à l'arrêt », « Arrêt demandé par le client »,
 * « Continuer l'itinéraire », qui relance le guidage vers l'arrêt suivant ou la destination) ;
 * côté client, le compteur et le récapitulatif.
 */
export function PanneauArrets({ live, role, enCourse, position }: { live: CourseLive; role: Auteur; enCourse: boolean; position?: { lat: number; lng: number } | null }) {
  const r = live.arrets;
  const c = useCompteur(r?.enCours?.debut, r?.tarifMin ?? 0);
  if (!live.actif || !r) return null;
  const prochain = r.prevus.find((p) => !p.fait);
  const finis = r.arrets.filter((a) => a.fin);
  const detours = (r.ajoutes ?? []).filter((a) => a.supplement > 0);
  if (role === 'client' && !r.enCours && finis.length === 0 && detours.length === 0) return null;
  if (role === 'chauffeur' && !enCourse && finis.length === 0 && detours.length === 0) return null;
  return (
    <div className="cl-arrets">
      {r.enCours ? (
        <div className="cl-arret-cours" role="status">
          <span className="cl-arret-titre">{tx('enCours')} · {r.enCours.type === 'prevu' ? (r.enCours.nom ?? tx('prevu')) : tx('demande')}</span>
          <span className="cl-arret-compteur">{c?.temps}</span>
          <span className="cl-muet">{francs(c?.montant ?? 0)} · {tx('parMinute', { f: francs(r.tarifMin) })}</span>
          {role === 'chauffeur' && (
            <>
              <button type="button" className="cl-principal" disabled={live.occupe} onClick={() => void live.finArret()}>{tx('reprendre')}</button>
              {/* L'arrêt en cours est déjà marqué : la suite est l'arrêt suivant, sinon la destination. */}
              <span className="cl-muet">{tx('ensuite', { nom: prochain?.nom ?? tx('laDestination') })}</span>
            </>
          )}
        </div>
      ) : role === 'chauffeur' && enCourse && (
        <div className="cl-arret-actions">
          {prochain && <button type="button" className="cl-principal" disabled={live.occupe} onClick={() => void live.debutArret('prevu', prochain.index, position)}>{tx('jeSuis', { nom: prochain.nom })}</button>}
          <button type="button" className="cl-secondaire" disabled={live.occupe} onClick={() => void live.debutArret('demande', undefined, position)}>{tx('demandeClient')}</button>
          <span className="cl-muet">{tx('parMinute', { f: francs(r.tarifMin) })}</span>
        </div>
      )}
      {(finis.length > 0 || detours.length > 0) && (
        <ul className="cl-arret-liste">
          {detours.map((a) => (
            <li key={`d${a.index}`}><span>{tx('detourLigne', { nom: a.nom })}</span><span>+{francs(a.supplement)}</span></li>
          ))}
          {finis.map((a) => (
            <li key={a.id}><span>{a.type === 'prevu' ? (a.nom ?? tx('prevu')) : tx('demande')}</span><span>{a.minutes ?? 0} min · {francs(a.montant ?? 0)}</span></li>
          ))}
          <li className="cl-arret-total"><span>{tx('ajoutes', { f: francs(r.montant) })}</span></li>
        </ul>
      )}
    </div>
  );
}

/** Chauffeur : le moyen choisi n'a pas fonctionné, il autorise les espèces. */
export function BoutonEspeces({ live }: { live: CourseLive }) {
  if (!live.actif) return null;
  if (live.especes.clientConfirme) return <p className="cl-info" role="status">{tx('clientEspeces')}</p>;
  if (live.especes.autorise) return <p className="cl-info" role="status">{tx('autorisees')}</p>;
  return <button type="button" className="cl-secondaire" disabled={live.occupe} onClick={() => void live.autoriserEspeces()}>{tx('autoriser')}</button>;
}

/** Chauffeur : le client vient d'ajouter un arrêt (bandeau discret, le guidage passe par l'arrêt). */
export function AvisNouvelArret({ live }: { live: CourseLive }) {
  const a = live.nouvelArret;
  useEffect(() => { if (!a) return; const t = window.setTimeout(live.effacerNouvelArret, 12_000); return () => window.clearTimeout(t); }, [a, live.effacerNouvelArret]);
  if (!a) return null;
  return (
    <button type="button" className="cl-avis-arret" role="status" onClick={live.effacerNouvelArret}>
      <strong>{tx('nouvelArret', { nom: a.nom })}</strong>
      <span>{a.supplement > 0 ? tx('detour', { f: francs(a.supplement) }) : tx('parMinute', { f: francs(live.arrets?.tarifMin ?? 100) })}</span>
    </button>
  );
}

/**
 * Client : il a choisi un lieu pour un nouvel arrêt. Le supplément s'affiche (détour, minutes sur
 * place), il confirme ; le chauffeur est prévenu et le prix de la course monte d'autant.
 */
export function AjoutArretClient({ live, lieu, onFini }: { live: CourseLive; lieu: { nom: string; lat: number; lng: number }; onFini: (ajoute: boolean) => void }) {
  const [apercu, setApercu] = useState<ApercuArret | null>(null);
  const [charge, setCharge] = useState(true);
  useEffect(() => {
    let fini = false;
    setCharge(true);
    void live.apercuArret({ lat: lieu.lat, lng: lieu.lng }, lieu.nom).then((a) => { if (!fini) { setApercu(a); setCharge(false); } });
    return () => { fini = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lieu.lat, lieu.lng, lieu.nom]);
  const confirmer = async () => { if (await live.ajouterArret({ lat: lieu.lat, lng: lieu.lng }, lieu.nom)) onFini(true); };
  return createPortal(
    <div className="cl-fond" role="dialog" aria-modal="true" aria-label={tx('ajouterArret')}>
      <div className="cl-ajout-arret">
        <strong className="cl-ajout-titre">{tx('arretVers', { nom: lieu.nom })}</strong>
        {charge ? <p className="cl-muet">{tx('calcul')}</p> : apercu ? (
          <>
            <p className="cl-ajout-texte">{apercu.supplement > 0
              ? tx('apercuTexte', { f: francs(apercu.supplement), m: francs(apercu.tarifMin) })
              : tx('sansDetour', { m: francs(apercu.tarifMin) })}</p>
            <div className="cl-ajout-prix"><span>{tx('nouveauPrix', { f: francs(apercu.prixApres) })}</span>{apercu.supplement > 0 && <strong>+{francs(apercu.supplement)}</strong>}</div>
          </>
        ) : <p className="cl-info" role="alert">{live.avis ?? tx('reseau')}</p>}
        <div className="cl-ajout-actions">
          <button type="button" className="cl-secondaire" onClick={() => { live.effacerAvis(); onFini(false); }}>{tx('annuler')}</button>
          <button type="button" className="cl-principal" disabled={!apercu || live.occupe} onClick={() => void confirmer()}>{apercu ? tx('confirmerArret', { f: francs(apercu.supplement) }) : tx('ajouterArret')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
