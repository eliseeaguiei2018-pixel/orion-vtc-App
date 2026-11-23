package ci.orion.chauffeur;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * AFFICHAGE PAR-DESSUS LES AUTRES APPLICATIONS (app chauffeur).
 *
 * Une course qui arrive pendant que le chauffeur suit Waze, téléphone ou écoute de la musique
 * doit s'afficher tout de suite, comme dans les apps VTC (Yango Pro, Uber Driver). Android
 * interdit à une app en arrière-plan de revenir au premier plan, SAUF si l'utilisateur lui a
 * donné l'autorisation « Afficher par-dessus les autres applications ». Avec elle, l'offre
 * ramène l'app ORION Chauffeur à l'écran ; sans elle, seule la notification sonne.
 *
 *  - autorise() : l'autorisation est-elle donnée ?
 *  - demander() : ouvre la page des réglages où le chauffeur l'active ;
 *  - ramener()  : remet l'app au premier plan (offre de course).
 */
@CapacitorPlugin(name = "PremierPlan")
public class PremierPlanPlugin extends Plugin {
  private boolean autoriseMaintenant() {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext());
  }

  @PluginMethod
  public void autorise(PluginCall call) {
    JSObject r = new JSObject();
    r.put("autorise", autoriseMaintenant());
    call.resolve(r);
  }

  @PluginMethod
  public void demander(PluginCall call) {
    if (!autoriseMaintenant()) {
      Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      try { getContext().startActivity(i); } catch (Exception ignore) { /* réglage absent (rare) */ }
    }
    call.resolve();
  }

  @PluginMethod
  public void ramener(PluginCall call) {
    try {
      Intent i = new Intent(getContext(), MainActivity.class);
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      getContext().startActivity(i);
      call.resolve();
    } catch (Exception e) {
      call.reject("Retour au premier plan impossible", e);
    }
  }
}
