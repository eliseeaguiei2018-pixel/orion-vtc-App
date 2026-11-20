/**
 * Traductions des textes OPÉRATIONNELS ajoutés après la traduction initiale (appel du
 * chauffeur, messagerie ORION, code de prise en charge, livraison, crédits des cartes).
 *
 * Avant l'audit, ces textes restaient en français pour un client qui avait choisi
 * l'arabe, le chinois ou le russe — y compris la consigne de sécurité « ne montez
 * qu'après vérification du code ».
 *
 * Les textes MÉDICAUX et JURIDIQUES d'ORION Assurance (consentement, données de santé)
 * restent volontairement en français : un consentement doit être traduit et validé par
 * un traducteur assermenté avant publication. `as_langue_note` le dit au client dans
 * sa langue.
 */
type D = Record<string, string>;

const es: D = {
  legal_langue_note: 'Estas condiciones se presentan en francés, la versión que da fe; su traducción jurídica está en validación.',
  call_clavier: 'Abre el teclado de su teléfono',
  call_demo: 'Modo demostración: en servicio, este botón abre el teclado de su teléfono con el número del conductor.',
  call_indispo: 'El número del conductor no está disponible por ahora. Vuelva a intentarlo en un momento o escríbale.',
  set_assurance_d_on: 'Activo · ficha de primeros auxilios', set_assurance_d_off: 'Gratis · active su protección de salud',
  msg_titre: 'Mensajes ORION', msg_vide: 'Aún no hay mensajes. La supervisión ORION le escribe aquí.', msg_repondu: 'Usted respondió: {r}',
  msg_alerte: 'Alerta enviada: la supervisión ORION le contacta enseguida.',
  msg_controle: 'Control de seguridad', msg_consigne: 'Instrucción', msg_info: 'Información', msg_ouvrir: 'Mensajes', msg_plus_tard: 'Más tarde',
  pay_failed: 'El pago no se completó. Vuelva a intentarlo o elija otro medio de pago.',
  act_cancel_liv: 'Cancelar la entrega', rate_done_liv: 'Entrega terminada', toast_done_liv: '¡Gracias! Paquete entregado 🌱',
  msg_clos: 'Viaje terminado. En caso de emergencia, el botón SOS sigue a su disposición.',
  code_titre: 'Código de recogida',
  code_aide: 'Dé este código al conductor cuando llegue. Suba solo después de que lo haya verificado.',
  code_ok: 'Identidad confirmada: el conductor introdujo su código',
  code_bloque: 'Código bloqueado tras 5 errores. No suba: la supervisión ORION le llamará.',
  legal_credits_t: 'Mapas e itinerarios',
  legal_carte: 'Mapas: © colaboradores de OpenStreetMap (licencia ODbL), teselas OpenFreeMap, itinerarios calculados con OSRM.',
  as_langue_note: 'ORION Assurance se presenta en francés: su traducción médica y jurídica está en validación.',
};

const it: D = {
  legal_langue_note: 'Queste condizioni sono presentate in francese, la versione che fa fede; la traduzione legale è in fase di validazione.',
  call_clavier: 'Apre la tastiera del telefono',
  call_demo: 'Modalità demo: in servizio, questo pulsante apre la tastiera del telefono con il numero dell’autista.',
  call_indispo: 'Il numero dell’autista non è disponibile al momento. Riprova tra poco o scrivigli.',
  set_assurance_d_on: 'Attiva · scheda di primo soccorso', set_assurance_d_off: 'Gratuita · attiva la tua protezione sanitaria',
  msg_titre: 'Messaggi ORION', msg_vide: 'Nessun messaggio per ora. La supervisione ORION ti scrive qui.', msg_repondu: 'Hai risposto: {r}',
  msg_alerte: 'Allerta inviata: la supervisione ORION ti contatta subito.',
  msg_controle: 'Controllo di sicurezza', msg_consigne: 'Istruzione', msg_info: 'Informazione', msg_ouvrir: 'Messaggi', msg_plus_tard: 'Più tardi',
  pay_failed: 'Il pagamento non è andato a buon fine. Riprova o scegli un altro metodo di pagamento.',
  act_cancel_liv: 'Annulla la consegna', rate_done_liv: 'Consegna completata', toast_done_liv: 'Grazie! Pacco consegnato 🌱',
  msg_clos: 'Corsa terminata. In caso di emergenza, il pulsante SOS resta a tua disposizione.',
  code_titre: 'Codice di partenza',
  code_aide: 'Dai questo codice all’autista al suo arrivo. Sali solo dopo la sua verifica.',
  code_ok: 'Identità confermata: l’autista ha inserito il tuo codice',
  code_bloque: 'Codice bloccato dopo 5 errori. Non salire: la supervisione ORION ti richiama.',
  legal_credits_t: 'Mappe e percorsi',
  legal_carte: 'Mappe: © contributori di OpenStreetMap (licenza ODbL), tile OpenFreeMap, percorsi calcolati con OSRM.',
  as_langue_note: 'ORION Assurance è presentata in francese: la traduzione medica e legale è in fase di validazione.',
};

const de: D = {
  legal_langue_note: 'Diese Bedingungen werden auf Französisch angezeigt, der maßgeblichen Fassung; die rechtliche Übersetzung wird geprüft.',
  call_clavier: 'Öffnet die Telefontastatur',
  call_demo: 'Demomodus: Im Betrieb öffnet diese Taste die Telefontastatur mit der Nummer des Fahrers.',
  call_indispo: 'Die Nummer des Fahrers ist gerade nicht verfügbar. Versuchen Sie es gleich erneut oder schreiben Sie ihm.',
  set_assurance_d_on: 'Aktiv · Erste-Hilfe-Akte', set_assurance_d_off: 'Kostenlos · Gesundheitsschutz aktivieren',
  msg_titre: 'ORION-Nachrichten', msg_vide: 'Noch keine Nachrichten. Die ORION-Leitstelle schreibt Ihnen hier.', msg_repondu: 'Ihre Antwort: {r}',
  msg_alerte: 'Alarm gesendet: Die ORION-Leitstelle meldet sich sofort bei Ihnen.',
  msg_controle: 'Sicherheitskontrolle', msg_consigne: 'Anweisung', msg_info: 'Information', msg_ouvrir: 'Nachrichten', msg_plus_tard: 'Später',
  pay_failed: 'Die Zahlung ist fehlgeschlagen. Versuchen Sie es erneut oder wählen Sie eine andere Zahlungsart.',
  act_cancel_liv: 'Lieferung stornieren', rate_done_liv: 'Lieferung abgeschlossen', toast_done_liv: 'Danke! Paket zugestellt 🌱',
  msg_clos: 'Fahrt beendet. Im Notfall steht Ihnen die SOS-Taste weiterhin zur Verfügung.',
  code_titre: 'Abholcode',
  code_aide: 'Geben Sie dem Fahrer diesen Code bei seiner Ankunft. Steigen Sie erst nach seiner Prüfung ein.',
  code_ok: 'Identität bestätigt: Der Fahrer hat Ihren Code eingegeben',
  code_bloque: 'Code nach 5 Fehlversuchen gesperrt. Steigen Sie nicht ein: Die ORION-Leitstelle ruft Sie zurück.',
  legal_credits_t: 'Karten und Routen',
  legal_carte: 'Karten: © OpenStreetMap-Mitwirkende (ODbL-Lizenz), Kacheln von OpenFreeMap, Routen berechnet mit OSRM.',
  as_langue_note: 'ORION Assurance wird auf Französisch angezeigt: Die medizinische und rechtliche Übersetzung wird noch geprüft.',
};

const ar: D = {
  legal_langue_note: 'تُعرض هذه الشروط بالفرنسية، وهي النسخة المعتمدة؛ الترجمة القانونية قيد المراجعة.',
  call_clavier: 'يفتح لوحة الاتصال في هاتفك',
  call_demo: 'وضع العرض: أثناء الخدمة، يفتح هذا الزر لوحة الاتصال برقم السائق.',
  call_indispo: 'رقم السائق غير متاح حاليًا. أعد المحاولة بعد لحظة أو راسله.',
  set_assurance_d_on: 'مُفعّل · ملف الإسعافات الأولية', set_assurance_d_off: 'مجاني · فعّل حمايتك الصحية',
  msg_titre: 'رسائل أوريون', msg_vide: 'لا توجد رسائل بعد. يراسلك مركز إشراف أوريون هنا.', msg_repondu: 'لقد أجبت: {r}',
  msg_alerte: 'تم إرسال التنبيه: مركز إشراف أوريون يتصل بك فورًا.',
  msg_controle: 'فحص أمني', msg_consigne: 'تعليمات', msg_info: 'معلومة', msg_ouvrir: 'الرسائل', msg_plus_tard: 'لاحقًا',
  pay_failed: 'لم يتم الدفع. أعد المحاولة أو اختر وسيلة دفع أخرى.',
  act_cancel_liv: 'إلغاء التوصيل', rate_done_liv: 'تم التوصيل', toast_done_liv: 'شكرًا! تم تسليم الطرد 🌱',
  msg_clos: 'انتهت الرحلة. في حالة الطوارئ، يبقى زر SOS في متناولك.',
  code_titre: 'رمز الركوب',
  code_aide: 'أعطِ هذا الرمز للسائق عند وصوله. لا تركب إلا بعد أن يتحقق منه.',
  code_ok: 'تم تأكيد الهوية: أدخل السائق رمزك',
  code_bloque: 'تم قفل الرمز بعد 5 أخطاء. لا تركب: سيتصل بك مركز إشراف أوريون.',
  legal_credits_t: 'الخرائط والمسارات',
  legal_carte: 'الخرائط: © المساهمون في OpenStreetMap (رخصة ODbL)، مربعات OpenFreeMap، مسارات محسوبة بواسطة OSRM.',
  as_langue_note: 'تُعرض خدمة أوريون للتأمين بالفرنسية: الترجمة الطبية والقانونية قيد المراجعة.',
};

const zh: D = {
  legal_langue_note: '本条款以法语显示，法语版本为准；法律译文正在审核中。',
  call_clavier: '打开手机拨号键盘',
  call_demo: '演示模式：正式服务时，此按钮会打开拨号键盘并填入司机号码。',
  call_indispo: '暂时无法获取司机号码。请稍后重试，或给司机发消息。',
  set_assurance_d_on: '已启用 · 急救档案', set_assurance_d_off: '免费 · 开启您的健康保障',
  msg_titre: 'ORION 消息', msg_vide: '暂无消息。ORION 监控中心会在这里联系您。', msg_repondu: '您的回复：{r}',
  msg_alerte: '警报已发送：ORION 监控中心正在联系您。',
  msg_controle: '安全检查', msg_consigne: '指示', msg_info: '信息', msg_ouvrir: '消息', msg_plus_tard: '稍后',
  pay_failed: '支付未成功。请重试或选择其他支付方式。',
  act_cancel_liv: '取消配送', rate_done_liv: '配送完成', toast_done_liv: '谢谢！包裹已送达 🌱',
  msg_clos: '行程已结束。如遇紧急情况，SOS 按钮始终可用。',
  code_titre: '上车验证码',
  code_aide: '司机到达时请告诉他此验证码。核实之后再上车。',
  code_ok: '身份已确认：司机已输入您的验证码',
  code_bloque: '输错 5 次，验证码已锁定。请勿上车：ORION 监控中心将给您回电。',
  legal_credits_t: '地图与路线',
  legal_carte: '地图：© OpenStreetMap 贡献者（ODbL 许可），OpenFreeMap 瓦片，路线由 OSRM 计算。',
  as_langue_note: 'ORION 保险以法语显示：医疗和法律译文正在审核中。',
};

const ru: D = {
  legal_langue_note: 'Эти условия представлены на французском языке, который имеет силу; юридический перевод проходит проверку.',
  call_clavier: 'Открывает номеронабиратель телефона',
  call_demo: 'Демо-режим: в работе эта кнопка открывает номеронабиратель с номером водителя.',
  call_indispo: 'Номер водителя сейчас недоступен. Повторите попытку через минуту или напишите ему.',
  set_assurance_d_on: 'Активна · карта первой помощи', set_assurance_d_off: 'Бесплатно · включите защиту здоровья',
  msg_titre: 'Сообщения ORION', msg_vide: 'Сообщений пока нет. Диспетчерская ORION пишет вам здесь.', msg_repondu: 'Ваш ответ: {r}',
  msg_alerte: 'Тревога отправлена: диспетчерская ORION сейчас свяжется с вами.',
  msg_controle: 'Проверка безопасности', msg_consigne: 'Указание', msg_info: 'Информация', msg_ouvrir: 'Сообщения', msg_plus_tard: 'Позже',
  pay_failed: 'Платёж не прошёл. Повторите попытку или выберите другой способ оплаты.',
  act_cancel_liv: 'Отменить доставку', rate_done_liv: 'Доставка завершена', toast_done_liv: 'Спасибо! Посылка доставлена 🌱',
  msg_clos: 'Поездка завершена. В экстренной ситуации кнопка SOS всегда доступна.',
  code_titre: 'Код посадки',
  code_aide: 'Назовите этот код водителю по прибытии. Садитесь только после его проверки.',
  code_ok: 'Личность подтверждена: водитель ввёл ваш код',
  code_bloque: 'Код заблокирован после 5 ошибок. Не садитесь: диспетчерская ORION перезвонит вам.',
  legal_credits_t: 'Карты и маршруты',
  legal_carte: 'Карты: © участники OpenStreetMap (лицензия ODbL), тайлы OpenFreeMap, маршруты рассчитаны с помощью OSRM.',
  as_langue_note: 'ORION Assurance показана на французском: медицинский и юридический перевод проходит проверку.',
};

export const COMPLEMENTS_LANGUES: Record<'es' | 'it' | 'de' | 'ar' | 'zh' | 'ru', D> = { es, it, de, ar, zh, ru };
