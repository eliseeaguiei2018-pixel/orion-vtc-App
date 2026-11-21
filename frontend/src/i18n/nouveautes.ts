import type { Dict } from './translations';

/**
 * Textes de la version 1.2 : forfaits de location, centre de contrôle ORION, contrôle de
 * sécurité en course, réglage du serveur. Chaque texte est donné dans les huit langues,
 * dans l'ordre : français, anglais, espagnol, italien, allemand, arabe, chinois, russe.
 */
type Langue = 'fr' | 'en' | 'es' | 'it' | 'de' | 'ar' | 'zh' | 'ru';
const ORDRE: Langue[] = ['fr', 'en', 'es', 'it', 'de', 'ar', 'zh', 'ru'];
type Huit = [string, string, string, string, string, string, string, string];

const TEXTES: Record<string, Huit> = {
  /* ------------------------------ Location ------------------------------ */
  rent_f_entrepriseHint: [
    'Société, institution, ambassade — forfait mensuel, 6 mois minimum, facture TVA.',
    'Company, institution, embassy — monthly plan, 6 months minimum, VAT invoice.',
    'Empresa, institución, embajada — plan mensual, 6 meses mínimo, factura con IVA.',
    'Azienda, istituzione, ambasciata — canone mensile, minimo 6 mesi, fattura con IVA.',
    'Unternehmen, Institution, Botschaft — Monatspaket, mindestens 6 Monate, Rechnung mit MwSt.',
    'شركة، مؤسسة، سفارة — باقة شهرية، 6 أشهر على الأقل، فاتورة ضريبية.',
    '企业、机构、使馆 — 包月方案，至少 6 个月，开具增值税发票。',
    'Компания, учреждение, посольство — помесячный тариф, минимум 6 месяцев, счёт с НДС.',
  ],
  rent_f_mise_a_dispositionHint: [
    'Gardez la voiture et son chauffeur : à l’heure, à la journée ou au mois.',
    'Keep the car and its chauffeur: by the hour, by the day or by the month.',
    'Conserve el coche y su chófer: por horas, por día o por mes.',
    'Tenga l’auto e il suo autista: a ore, a giornata o al mese.',
    'Behalten Sie Wagen und Chauffeur: stunden-, tage- oder monatsweise.',
    'احتفظ بالسيارة وسائقها: بالساعة أو باليوم أو بالشهر.',
    '保留车辆和司机：按小时、按天或按月。',
    'Автомобиль с водителем остаётся у вас: по часам, на день или на месяц.',
  ],
  rent_monthlyOnly: [
    'Les entreprises louent au forfait mensuel, {min} mois minimum, renouvelable ou non.',
    'Companies rent on a monthly plan, {min} months minimum, renewable or not.',
    'Las empresas alquilan con plan mensual, {min} meses mínimo, renovable o no.',
    'Le aziende noleggiano a canone mensile, minimo {min} mesi, rinnovabile o no.',
    'Unternehmen mieten im Monatspaket, mindestens {min} Monate, verlängerbar oder nicht.',
    'تستأجر الشركات بباقة شهرية، {min} أشهر على الأقل، قابلة للتجديد أو لا.',
    '企业按月租用，至少 {min} 个月，可续约或不续约。',
    'Компании арендуют помесячно, минимум {min} месяцев, с продлением или без.',
  ],
  rent_months: ['Durée du forfait', 'Plan length', 'Duración del plan', 'Durata del canone', 'Laufzeit', 'مدة الباقة', '方案期限', 'Срок тарифа'],
  rent_monthsN: ['{n} mois', '{n} mo.', '{n} meses', '{n} mesi', '{n} Mon.', '{n} شهر', '{n} 个月', '{n} мес.'],
  rent_tiersLabel: ['Remises selon la durée', 'Discounts by length', 'Descuentos según la duración', 'Sconti in base alla durata', 'Rabatte nach Laufzeit', 'الخصومات حسب المدة', '按期限折扣', 'Скидки по сроку'],
  rent_tierFrom: ['dès {n} mois', 'from {n} mo.', 'desde {n} meses', 'da {n} mesi', 'ab {n} Mon.', 'من {n} شهر', '{n} 个月起', 'от {n} мес.'],
  rent_renew: ['Reconduction à l’échéance', 'Renew at term', 'Renovación al vencimiento', 'Rinnovo alla scadenza', 'Verlängerung bei Ablauf', 'التجديد عند الانتهاء', '到期续约', 'Продление по окончании'],
  rent_renewOn: [
    'Le forfait se renouvelle pour la même durée.',
    'The plan renews for the same length.',
    'El plan se renueva por la misma duración.',
    'Il canone si rinnova per la stessa durata.',
    'Das Paket verlängert sich um die gleiche Laufzeit.',
    'تتجدد الباقة للمدة نفسها.',
    '方案按相同期限续约。',
    'Тариф продлевается на тот же срок.',
  ],
  rent_renewOff: [
    'Le forfait s’arrête à la date de fin.',
    'The plan stops on its end date.',
    'El plan termina en la fecha de fin.',
    'Il canone termina alla data di fine.',
    'Das Paket endet zum Enddatum.',
    'تنتهي الباقة في تاريخ نهايتها.',
    '方案在结束日期终止。',
    'Тариф заканчивается в дату окончания.',
  ],
  rent_renewShort: ['renouvelable', 'renewable', 'renovable', 'rinnovabile', 'verlängerbar', 'قابلة للتجديد', '可续约', 'с продлением'],
  rent_noRenewShort: ['non renouvelable', 'not renewable', 'no renovable', 'non rinnovabile', 'nicht verlängerbar', 'غير قابلة للتجديد', '不续约', 'без продления'],
  rent_perMonth: ['/ mois', '/ month', '/ mes', '/ mese', '/ Monat', '/ شهر', '/ 月', '/ мес.'],
  rent_lineFull: ['Tarif journalier × {n} jours', 'Daily rate × {n} days', 'Tarifa diaria × {n} días', 'Tariffa giornaliera × {n} giorni', 'Tagespreis × {n} Tage', 'السعر اليومي × {n} يوم', '日租价 × {n} 天', 'Суточный тариф × {n} дн.'],
  rent_lineDuration: ['Remise de durée (−{pct} %)', 'Length discount (−{pct}%)', 'Descuento por duración (−{pct} %)', 'Sconto durata (−{pct} %)', 'Laufzeitrabatt (−{pct} %)', 'خصم المدة (−{pct}٪)', '期限折扣（−{pct}%）', 'Скидка за срок (−{pct} %)'],
  rent_monthly: ['Mensualité', 'Monthly payment', 'Cuota mensual', 'Rata mensile', 'Monatsrate', 'القسط الشهري', '月付金额', 'Ежемесячный платёж'],
  rent_contractTotal: ['Total du forfait ({n} mois)', 'Plan total ({n} months)', 'Total del plan ({n} meses)', 'Totale del canone ({n} mesi)', 'Paketsumme ({n} Monate)', 'إجمالي الباقة ({n} شهر)', '方案总额（{n} 个月）', 'Итого за тариф ({n} мес.)'],
  rent_depositMonth: [
    'Caution équivalente à un mois, restituée en fin de forfait : {amount}',
    'Deposit equal to one month, refunded at the end of the plan: {amount}',
    'Fianza equivalente a un mes, devuelta al final del plan: {amount}',
    'Cauzione pari a un mese, restituita a fine canone: {amount}',
    'Kaution in Höhe eines Monats, Rückzahlung bei Paketende: {amount}',
    'تأمين يعادل شهرًا واحدًا، يُسترد عند نهاية الباقة: {amount}',
    '押金相当于一个月，方案结束时退还：{amount}',
    'Залог в размере одного месяца, возвращается по окончании тарифа: {amount}',
  ],
};

export const NOUVEAUTES = Object.fromEntries(
  ORDRE.map((langue, i) => [langue, Object.fromEntries(Object.entries(TEXTES).map(([cle, v]) => [cle, v[i]]))]),
) as Record<Langue, Dict>;
