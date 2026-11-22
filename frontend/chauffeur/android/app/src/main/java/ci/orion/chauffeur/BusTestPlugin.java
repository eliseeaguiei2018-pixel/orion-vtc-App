package ci.orion.chauffeur;

import android.content.ContentValues;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Accès au registre de test partagé, tenu par l'app client ORION (BusTestProvider).
 * Même code dans les deux apps : l'app client lit son propre registre, l'app chauffeur
 * celui de l'app client installée sur le même téléphone. Si l'app client n'est pas
 * installée (ou pas signée pareil), « disponible » vaut false et l'app reste seule.
 */
@CapacitorPlugin(name = "BusTest")
public class BusTestPlugin extends Plugin {
  /**
   * Adresse du registre. Par défaut, celui de l'app client ORION ; les APK de test temps réel
   * (app client et mini console, installées à part) en désignent un autre par la méta-donnée
   * « ci.orion.bustest.autorite » de leur manifeste : les deux paires ne se mélangent pas.
   */
  private Uri adresse() {
    String autorite = "ci.orion.app.bustest";
    try {
      ApplicationInfo ai = getContext().getPackageManager().getApplicationInfo(getContext().getPackageName(), PackageManager.GET_META_DATA);
      if (ai.metaData != null && ai.metaData.getString("ci.orion.bustest.autorite") != null) autorite = ai.metaData.getString("ci.orion.bustest.autorite");
    } catch (Exception ignore) {
      // Sans méta-donnée lisible : le registre de l'app client ORION.
    }
    return Uri.parse("content://" + autorite + "/entrees");
  }

  @PluginMethod
  public void lire(PluginCall call) {
    JSObject reponse = new JSObject();
    JSObject entrees = new JSObject();
    try (Cursor c = getContext().getContentResolver().query(adresse(), null, null, null, null)) {
      if (c == null) {
        reponse.put("disponible", false);
      } else {
        while (c.moveToNext()) entrees.put(c.getString(0), c.getString(1));
        reponse.put("disponible", true);
      }
    } catch (Exception e) {
      reponse.put("disponible", false);
      reponse.put("raison", e.getClass().getSimpleName());
    }
    reponse.put("entrees", entrees);
    call.resolve(reponse);
  }

  @PluginMethod
  public void ecrire(PluginCall call) {
    String cle = call.getString("cle");
    String valeur = call.getString("valeur");
    JSObject reponse = new JSObject();
    if (cle == null || valeur == null) {
      reponse.put("ok", false);
      call.resolve(reponse);
      return;
    }
    try {
      ContentValues v = new ContentValues();
      v.put("cle", cle);
      v.put("valeur", valeur);
      reponse.put("ok", getContext().getContentResolver().insert(adresse(), v) != null);
    } catch (Exception e) {
      reponse.put("ok", false);
    }
    call.resolve(reponse);
  }

  @PluginMethod
  public void effacer(PluginCall call) {
    String cle = call.getString("cle");
    JSObject reponse = new JSObject();
    try {
      reponse.put("ok", cle != null && getContext().getContentResolver().delete(adresse(), null, new String[] { cle }) > 0);
    } catch (Exception e) {
      reponse.put("ok", false);
    }
    call.resolve(reponse);
  }
}
