import type { Ligne } from './index';

/** Météo d'ORION Pro (Google, via le serveur) et photo du point de prise en charge (Street View). */
export const METEO: Ligne[] = [
  ['Orage', 'Thunderstorm', 'Tormenta', 'Temporale', 'عاصفة رعدية', '雷暴', 'Gewitter', 'Гроза'],
  ['Forte pluie', 'Heavy rain', 'Lluvia fuerte', 'Pioggia forte', 'أمطار غزيرة', '大雨', 'Starkregen', 'Сильный дождь'],
  ['Averses', 'Showers', 'Chubascos', 'Rovesci', 'زخات مطر', '阵雨', 'Schauer', 'Ливни'],
  ['Pluie', 'Rain', 'Lluvia', 'Pioggia', 'مطر', '下雨', 'Regen', 'Дождь'],
  ['Brouillard', 'Fog', 'Niebla', 'Nebbia', 'ضباب', '雾', 'Nebel', 'Туман'],
  ['Venteux', 'Windy', 'Ventoso', 'Ventoso', 'عاصف', '有风', 'Windig', 'Ветрено'],
  ['Partiellement nuageux', 'Partly cloudy', 'Parcialmente nublado', 'Parzialmente nuvoloso', 'غائم جزئيًا', '局部多云', 'Teilweise bewölkt', 'Переменная облачность'],
  ['Nuageux', 'Cloudy', 'Nublado', 'Nuvoloso', 'غائم', '多云', 'Bewölkt', 'Облачно'],
  ['Dégagé', 'Clear', 'Despejado', 'Sereno', 'صافٍ', '晴', 'Klar', 'Ясно'],
  ['en ce moment', 'right now', 'ahora mismo', 'in questo momento', 'الآن', '现在', 'gerade jetzt', 'сейчас'],
  ['dans {0} min', 'in {0} min', 'en {0} min', 'tra {0} min', 'خلال {0} دقيقة', '{0} 分钟后', 'in {0} Min.', 'через {0} мин'],
  ['vers {0} h', 'around {0}:00', 'hacia las {0} h', 'verso le {0}', 'نحو الساعة {0}', '约 {0} 点', 'gegen {0} Uhr', 'около {0} ч'],
  ['Orage attendu à {0} {1}', 'Thunderstorm expected in {0} {1}', 'Tormenta prevista en {0} {1}', 'Temporale previsto a {0} {1}', 'عاصفة رعدية متوقعة في {0} {1}', '{0} 预计 {1} 有雷暴', 'Gewitter erwartet in {0} {1}', 'Гроза ожидается в {0} {1}'],
  ['Forte pluie attendue à {0} {1}', 'Heavy rain expected in {0} {1}', 'Lluvia fuerte prevista en {0} {1}', 'Pioggia forte prevista a {0} {1}', 'أمطار غزيرة متوقعة في {0} {1}', '{0} 预计 {1} 有大雨', 'Starkregen erwartet in {0} {1}', 'Сильный дождь ожидается в {0} {1}'],
  ['Pluie attendue à {0} {1}', 'Rain expected in {0} {1}', 'Lluvia prevista en {0} {1}', 'Pioggia prevista a {0} {1}', 'أمطار متوقعة في {0} {1}', '{0} 预计 {1} 下雨', 'Regen erwartet in {0} {1}', 'Дождь ожидается в {0} {1}'],
  ['Météo · {0}', 'Weather · {0}', 'Tiempo · {0}', 'Meteo · {0}', 'الطقس · {0}', '天气 · {0}', 'Wetter · {0}', 'Погода · {0}'],
  ['ressenti {0}°', 'feels like {0}°', 'sensación {0}°', 'percepita {0}°', 'الإحساس {0}°', '体感 {0}°', 'gefühlt {0}°', 'ощущается как {0}°'],
  ['Chaussée glissante : ralentissez et allumez vos feux.', 'Slippery roads: slow down and turn on your lights.', 'Calzada resbaladiza: reduzca la velocidad y encienda las luces.', 'Strada scivolosa: rallenta e accendi le luci.', 'الطريق زلق: خفّف السرعة وأشعل الأضواء.', '路面湿滑：请减速并打开车灯。', 'Rutschige Fahrbahn: langsamer fahren und Licht einschalten.', 'Скользкая дорога: снизьте скорость и включите фары.'],
  ['Les clients commandent davantage quand il pleut : restez en ligne près de ces quartiers.', 'Customers order more when it rains: stay online near these areas.', 'Los clientes piden más cuando llueve: siga en línea cerca de estas zonas.', 'I clienti ordinano di più quando piove: resta online vicino a queste zone.', 'يطلب العملاء أكثر عند المطر: ابقَ متصلًا قرب هذه الأحياء.', '下雨时乘客订单更多：请在这些区域附近保持在线。', 'Bei Regen bestellen Kunden mehr: Bleiben Sie in der Nähe dieser Viertel online.', 'В дождь клиенты заказывают чаще: оставайтесь на линии рядом с этими районами.'],
  ['Voir le point de prise en charge', 'See the pickup point', 'Ver el punto de recogida', 'Vedi il punto di ritiro', 'عرض نقطة الالتقاء', '查看上车点', 'Abholpunkt ansehen', 'Посмотреть место посадки'],
  ['Point de prise en charge', 'Pickup point', 'Punto de recogida', 'Punto di ritiro', 'نقطة الالتقاء', '上车点', 'Abholpunkt', 'Место посадки'],
  ['Photo de la rue où attend le client', 'Photo of the street where the customer is waiting', 'Foto de la calle donde espera el cliente', 'Foto della strada dove aspetta il cliente', 'صورة الشارع حيث ينتظر العميل', '乘客等候街道的照片', 'Foto der Straße, in der der Kunde wartet', 'Фото улицы, где ждёт клиент'],
  ['Chargement de la photo…', 'Loading the photo…', 'Cargando la foto…', 'Caricamento della foto…', 'جارٍ تحميل الصورة…', '正在加载照片…', 'Foto wird geladen…', 'Загрузка фото…'],
  ['Photo Google Street View · {0}', 'Google Street View photo · {0}', 'Foto de Google Street View · {0}', 'Foto Google Street View · {0}', 'صورة Google Street View · {0}', 'Google 街景照片 · {0}', 'Google-Street-View-Foto · {0}', 'Фото Google Street View · {0}'],
];
