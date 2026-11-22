package ci.orion.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.net.Uri;

/**
 * REGISTRE DE TEST PARTAGÉ (en attendant le serveur ORION en ligne).
 *
 * L'app client et l'app chauffeur installées sur le MÊME téléphone s'échangent les courses
 * par ce registre : une course commandée dans l'app client y est écrite, l'app chauffeur
 * la lit, l'accepte et fait avancer son statut ; l'app client suit.
 *
 * Accès réservé : la permission « ci.orion.permission.BUS_TEST » est de niveau signature,
 * seules les applications signées avec la même clé qu'ORION peuvent lire ou écrire ici.
 * Rien ne quitte le téléphone, et rien n'y reste plus de 24 heures.
 */
public class BusTestProvider extends ContentProvider {
  private static final String TABLE = "entrees";
  private static final long JOUR_MS = 86_400_000L;
  private SQLiteOpenHelper base;

  @Override
  public boolean onCreate() {
    base = new SQLiteOpenHelper(getContext(), "bus-test.db", null, 1) {
      @Override
      public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE " + TABLE + " (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL, maj INTEGER NOT NULL)");
      }

      @Override
      public void onUpgrade(SQLiteDatabase db, int ancienne, int nouvelle) { /* une seule version */ }
    };
    return true;
  }

  @Override
  public Cursor query(Uri uri, String[] colonnes, String selection, String[] args, String tri) {
    SQLiteDatabase db = base.getWritableDatabase();
    db.delete(TABLE, "maj < ?", new String[] { String.valueOf(System.currentTimeMillis() - JOUR_MS) });
    return db.query(TABLE, new String[] { "cle", "valeur", "maj" }, null, null, null, null, "maj DESC");
  }

  @Override
  public Uri insert(Uri uri, ContentValues valeurs) {
    if (valeurs == null) return null;
    String cle = valeurs.getAsString("cle");
    String valeur = valeurs.getAsString("valeur");
    // Garde-fous : clés courtes, valeurs bornées (une course pèse quelques kilo-octets).
    if (cle == null || valeur == null || cle.length() > 200 || valeur.length() > 200_000) return null;
    ContentValues ligne = new ContentValues();
    ligne.put("cle", cle);
    ligne.put("valeur", valeur);
    ligne.put("maj", System.currentTimeMillis());
    base.getWritableDatabase().insertWithOnConflict(TABLE, null, ligne, SQLiteDatabase.CONFLICT_REPLACE);
    if (getContext() != null) getContext().getContentResolver().notifyChange(uri, null);
    return Uri.withAppendedPath(uri, Uri.encode(cle));
  }

  @Override
  public int delete(Uri uri, String selection, String[] args) {
    if (args == null || args.length == 0 || args[0] == null) return 0;
    return base.getWritableDatabase().delete(TABLE, "cle = ?", new String[] { args[0] });
  }

  @Override
  public int update(Uri uri, ContentValues valeurs, String selection, String[] args) {
    return 0;
  }

  @Override
  public String getType(Uri uri) {
    return "vnd.android.cursor.dir/vnd.ci.orion.bustest";
  }
}
