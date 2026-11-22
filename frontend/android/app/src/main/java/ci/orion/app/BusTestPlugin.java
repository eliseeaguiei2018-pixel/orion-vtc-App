package ci.orion.app;

import android.content.ContentValues;
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
  private static final Uri ADRESSE = Uri.parse("content://ci.orion.app.bustest/entrees");

  @PluginMethod
  public void lire(PluginCall call) {
    JSObject reponse = new JSObject();
    JSObject entrees = new JSObject();
    try (Cursor c = getContext().getContentResolver().query(ADRESSE, null, null, null, null)) {
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
      reponse.put("ok", getContext().getContentResolver().insert(ADRESSE, v) != null);
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
      reponse.put("ok", cle != null && getContext().getContentResolver().delete(ADRESSE, null, new String[] { cle }) > 0);
    } catch (Exception e) {
      reponse.put("ok", false);
    }
    call.resolve(reponse);
  }
}
