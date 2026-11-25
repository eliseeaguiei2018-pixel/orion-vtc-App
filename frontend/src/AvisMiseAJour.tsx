import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { avisMiseAJour, installerMiseAJour, reporterMiseAJour, type AvisMaj } from './miseAJour';
import './miseAJour.css';

/**
 * « Mise à jour disponible » : le message commun aux trois apps (client, ORION Pro, console),
 * affiché à l'ouverture quand le serveur ORION a publié une nouvelle version. Ses textes sont
 * ici, en 8 langues, pour fonctionner pareil dans les trois apps.
 */
type Cle = 'titre' | 'titreApk' | 'texte' | 'texteApk' | 'installer' | 'telecharger' | 'plusTard' | 'telechargement' | 'installation' | 'erreur' | 'reessayer' | 'ouvert' | 'retelecharger' | 'obligatoire' | 'version';
const LANGUES = ['fr', 'en', 'es', 'it', 'de', 'ar', 'zh', 'ru'] as const;
const T: Record<Cle, readonly [string, string, string, string, string, string, string, string]> = {
  titre: ['Mise à jour disponible', 'Update available', 'Actualización disponible', 'Aggiornamento disponibile', 'Update verfügbar', 'تحديث متاح', '有可用更新', 'Доступно обновление'],
  titreApk: ['Nouvelle version de l’application', 'New version of the app', 'Nueva versión de la aplicación', 'Nuova versione dell’app', 'Neue App-Version', 'إصدار جديد من التطبيق', '应用新版本', 'Новая версия приложения'],
  texte: [
    'Une nouvelle version de {app} est prête. Le téléchargement prend quelques secondes, puis l’application redémarre.',
    'A new version of {app} is ready. The download takes a few seconds, then the app restarts.',
    'Hay una nueva versión de {app} lista. La descarga tarda unos segundos y luego la aplicación se reinicia.',
    'È pronta una nuova versione di {app}. Il download richiede pochi secondi, poi l’app si riavvia.',
    'Eine neue Version von {app} ist bereit. Der Download dauert wenige Sekunden, dann startet die App neu.',
    'إصدار جديد من {app} جاهز. يستغرق التنزيل بضع ثوانٍ، ثم يُعاد تشغيل التطبيق.',
    '{app} 新版本已就绪。下载只需几秒钟，随后应用会重新启动。',
    'Новая версия {app} готова. Загрузка займёт несколько секунд, затем приложение перезапустится.',
  ],
  texteApk: [
    'Téléchargez la nouvelle version de {app}, puis touchez « Mettre à jour » quand Android le propose. Vos données et votre compte sont conservés.',
    'Download the new version of {app}, then tap “Update” when Android offers it. Your data and account are kept.',
    'Descargue la nueva versión de {app} y toque «Actualizar» cuando Android lo proponga. Sus datos y su cuenta se conservan.',
    'Scarica la nuova versione di {app}, poi tocca «Aggiorna» quando Android lo propone. Dati e account restano.',
    'Laden Sie die neue Version von {app} herunter und tippen Sie auf „Aktualisieren“, wenn Android es anbietet. Daten und Konto bleiben erhalten.',
    'نزّل الإصدار الجديد من {app}، ثم المس «تحديث» عندما يقترحه أندرويد. تبقى بياناتك وحسابك محفوظة.',
    '下载 {app} 新版本，然后在 Android 提示时点按“更新”。您的数据和账户都会保留。',
    'Скачайте новую версию {app} и нажмите «Обновить», когда Android предложит. Данные и аккаунт сохранятся.',
  ],
  installer: ['Mettre à jour', 'Update now', 'Actualizar', 'Aggiorna', 'Jetzt aktualisieren', 'تحديث الآن', '立即更新', 'Обновить'],
  telecharger: ['Télécharger la mise à jour', 'Download the update', 'Descargar la actualización', 'Scarica l’aggiornamento', 'Update herunterladen', 'تنزيل التحديث', '下载更新', 'Скачать обновление'],
  plusTard: ['Plus tard', 'Later', 'Más tarde', 'Più tardi', 'Später', 'لاحقًا', '稍后', 'Позже'],
  telechargement: ['Téléchargement… {p} %', 'Downloading… {p}%', 'Descargando… {p} %', 'Download… {p}%', 'Wird geladen… {p} %', 'جارٍ التنزيل… {p}٪', '正在下载… {p}%', 'Загрузка… {p} %'],
  installation: ['Installation…', 'Installing…', 'Instalando…', 'Installazione…', 'Wird installiert…', 'جارٍ التثبيت…', '正在安装…', 'Установка…'],
  erreur: [
    'Le téléchargement n’a pas abouti. Vérifiez votre connexion et réessayez.',
    'The download didn’t complete. Check your connection and try again.',
    'La descarga no se completó. Compruebe su conexión e inténtelo de nuevo.',
    'Il download non è andato a buon fine. Controlla la connessione e riprova.',
    'Der Download wurde nicht abgeschlossen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    'لم يكتمل التنزيل. تحقق من اتصالك وحاول مجددًا.',
    '下载未完成。请检查网络连接后重试。',
    'Загрузка не завершилась. Проверьте подключение и повторите попытку.',
  ],
  reessayer: ['Réessayer', 'Try again', 'Reintentar', 'Riprova', 'Erneut versuchen', 'إعادة المحاولة', '重试', 'Повторить'],
  ouvert: [
    'Le téléchargement a démarré. Ouvrez le fichier depuis les notifications, puis touchez « Mettre à jour ». Si Android le demande, autorisez l’installation depuis votre navigateur.',
    'The download has started. Open the file from your notifications, then tap “Update”. If Android asks, allow installs from your browser.',
    'La descarga ha comenzado. Abra el archivo desde las notificaciones y toque «Actualizar». Si Android lo pide, permita la instalación desde su navegador.',
    'Il download è partito. Apri il file dalle notifiche, poi tocca «Aggiorna». Se Android lo chiede, consenti l’installazione dal browser.',
    'Der Download hat begonnen. Öffnen Sie die Datei über die Benachrichtigungen und tippen Sie auf „Aktualisieren“. Falls Android fragt, erlauben Sie Installationen aus Ihrem Browser.',
    'بدأ التنزيل. افتح الملف من الإشعارات ثم المس «تحديث». إذا طلب أندرويد ذلك، اسمح بالتثبيت من متصفحك.',
    '下载已开始。请从通知中打开文件，然后点按“更新”。如果 Android 提示，请允许通过浏览器安装。',
    'Загрузка началась. Откройте файл из уведомлений и нажмите «Обновить». Если Android спросит, разрешите установку из браузера.',
  ],
  retelecharger: ['Relancer le téléchargement', 'Download again', 'Volver a descargar', 'Scarica di nuovo', 'Erneut herunterladen', 'إعادة التنزيل', '重新下载', 'Скачать снова'],
  obligatoire: ['Cette mise à jour est nécessaire pour continuer.', 'This update is required to continue.', 'Esta actualización es necesaria para continuar.', 'Questo aggiornamento è necessario per continuare.', 'Dieses Update ist zum Fortfahren erforderlich.', 'هذا التحديث ضروري للمتابعة.', '需要此更新才能继续使用。', 'Это обновление необходимо для продолжения.'],
  version: ['Version {v} · {mo} Mo', 'Version {v} · {mo} MB', 'Versión {v} · {mo} MB', 'Versione {v} · {mo} MB', 'Version {v} · {mo} MB', 'الإصدار {v} · {mo} م.ب', '版本 {v} · {mo} MB', 'Версия {v} · {mo} МБ'],
};

const NOMS = { client: 'ORION', chauffeur: 'ORION Pro', console: 'ORION Console' } as const;
const ICONES = { client: 'rendus/icone-app.webp', chauffeur: 'icones/chauffeur-192.png', console: 'icones/console-192.png' } as const;

function langue(): number {
  let l = '';
  try { l = document.documentElement.lang || localStorage.getItem('orion.driver.lang') || localStorage.getItem('orion.lang') || navigator.language; } catch { l = 'fr'; }
  const i = LANGUES.indexOf((l || 'fr').slice(0, 2).toLowerCase() as (typeof LANGUES)[number]);
  return i < 0 ? 0 : i;
}

function texte(cle: Cle, vars: Record<string, string | number> = {}): string {
  return T[cle][langue()]!.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** Version courte pour l'écran : « 2.1.0 » plutôt que « 2.1.0-2611231800 ». */
const versionCourte = (v: string) => v.replace(/-\d{10}$/, '');

export function AvisMiseAJour() {
  const a: AvisMaj | null = useSyncExternalStore(avisMiseAJour.abonner, avisMiseAJour.lire, () => null);
  if (!a) return null;
  const app = NOMS[a.app];
  const mo = (Math.max(0.1, a.taille / 1_048_576)).toFixed(1).replace('.', langue() === 1 || langue() === 6 ? '.' : ',');
  const occupe = a.etat === 'telechargement' || a.etat === 'installation';
  const notes = langue() === 0 && a.notes.trim() ? a.notes.trim() : '';
  // Directement dans la page : au-dessus de la carte et de tout écran de l'app, quel qu'il soit.
  return createPortal(
    <div className="maj-fond" role="presentation">
      <div className="maj-carte" role="alertdialog" aria-modal="true" aria-labelledby="maj-titre" aria-describedby="maj-texte" dir={langue() === 5 ? 'rtl' : 'ltr'}>
        <img className="maj-icone" src={`${import.meta.env.BASE_URL}${ICONES[a.app]}`} alt="" draggable={false} />
        <h2 id="maj-titre" className="maj-titre">{texte(a.type === 'apk' ? 'titreApk' : 'titre')}</h2>
        <p className="maj-version">{texte('version', { v: versionCourte(a.version), mo })}</p>
        <p id="maj-texte" className="maj-texte">{a.etat === 'ouvert' ? texte('ouvert') : a.etat === 'erreur' ? texte('erreur') : texte(a.type === 'apk' ? 'texteApk' : 'texte', { app })}</p>
        {notes && a.etat === 'propose' && <p className="maj-notes">{notes}</p>}
        {a.obligatoire && a.etat === 'propose' && <p className="maj-obligatoire">{texte('obligatoire')}</p>}
        {occupe && (
          <div className="maj-barre" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={a.progression}>
            <span style={{ width: `${a.etat === 'installation' ? 100 : Math.max(4, a.progression)}%` }} />
          </div>
        )}
        <button className="maj-principal" disabled={occupe} onClick={() => void installerMiseAJour()}>
          {a.etat === 'telechargement' ? texte('telechargement', { p: a.progression })
            : a.etat === 'installation' ? texte('installation')
            : a.etat === 'erreur' ? texte('reessayer')
            : a.etat === 'ouvert' ? texte('retelecharger')
            : texte(a.type === 'apk' ? 'telecharger' : 'installer')}
        </button>
        {!a.obligatoire && !occupe && <button className="maj-second" onClick={reporterMiseAJour}>{texte('plusTard')}</button>}
      </div>
    </div>,
    document.body,
  );
}
