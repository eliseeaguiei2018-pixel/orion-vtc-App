package ci.orion.chauffeur;

import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

/**
 * App Chauffeur ORION (Android).
 *
 * TAUX DE RAFRAÎCHISSEMENT ÉLEVÉ. Beaucoup de téléphones et d'écrans de véhicule montent
 * à 90, 120 ou 144 Hz, mais Android ne l'accorde pas d'office : on le DEMANDE. Le système
 * reste maître (il redescend pour économiser la batterie), mais la navigation guidée et la
 * carte défilent alors au taux le plus fluide que l'appareil sait tenir — y compris sur
 * les dalles LTPO à fréquence variable.
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Registre de test partagé entre l'app client et l'app chauffeur (même téléphone).
    registerPlugin(BusTestPlugin.class);
    super.onCreate(savedInstanceState);
    demanderRafraichissementMax();
  }

  private void demanderRafraichissementMax() {
    Window fenetre = getWindow();
    if (fenetre == null) return;
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Display ecran = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? getDisplay() : fenetre.getWindowManager().getDefaultDisplay();
        if (ecran == null) return;
        Display.Mode[] modes = ecran.getSupportedModes();
        Display.Mode courant = ecran.getMode();
        int meilleur = courant.getModeId();
        float max = courant.getRefreshRate();
        // On garde la définition courante et on cherche le mode le plus rapide à cette définition.
        for (Display.Mode m : modes) {
          if (m.getPhysicalWidth() == courant.getPhysicalWidth()
              && m.getPhysicalHeight() == courant.getPhysicalHeight()
              && m.getRefreshRate() > max + 0.1f) {
            max = m.getRefreshRate();
            meilleur = m.getModeId();
          }
        }
        WindowManager.LayoutParams p = fenetre.getAttributes();
        p.preferredDisplayModeId = meilleur;            // mode complet (définition + fréquence)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) p.preferredRefreshRate = max;
        fenetre.setAttributes(p);
      }
    } catch (Exception ignore) {
      // Sur un appareil qui refuse, l'app tourne simplement à la fréquence par défaut.
    }
  }
}
