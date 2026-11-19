# ORION Chauffeur — hôte HarmonyOS (ArkTS / ArkWeb)

Projet HarmonyOS minimal qui héberge l'application web ORION Chauffeur dans le moteur
**ArkWeb** (composant `Web`). Même application que sur Android, iPhone et le navigateur :
rien n'est réécrit, et une correction publiée sur ORION arrive au prochain démarrage.

Sert pour les téléphones et tablettes Huawei sous HarmonyOS, et pour les écrans embarqués
des véhicules Huawei (mode écran de véhicule).

## Contenu

```
AppScope/app.json5                     identité de l'application (ci.orion.chauffeur)
build-profile.json5                    produit + module
entry/src/main/module.json5            permissions (Internet, position), page d'entrée
entry/src/main/ets/entryability/…      démarrage de l'application
entry/src/main/ets/pages/Index.ets     la vue ArkWeb qui ouvre l'app ORION
entry/src/main/resources/…             libellés, couleurs
```

## Adresse ouverte

`entry/src/main/ets/pages/Index.ets` → constante `ADRESSE`.
- Téléphone / tablette : `https://chauffeur.orion.ci/driver.html`
- Écran embarqué du véhicule : `https://chauffeur.orion.ci/vehicule.html` (paysage,
  appairage par code).

Remplacer par le vrai domaine avant publication.

## Ouvrir, lancer, publier

1. Installer **DevEco Studio** (Huawei) et le SDK HarmonyOS.
2. Ouvrir ce dossier `harmony/` comme projet.
3. Lancer sur l'émulateur HarmonyOS ou un appareil Huawei.
4. Pour **AppGallery** : signer avec un **compte développeur Huawei**, puis soumettre.

## Limite franche

Ce projet **ne se compile pas** sans DevEco Studio, le SDK HarmonyOS et un compte Huawei :
ils ne sont pas disponibles dans l'environnement de développement d'ORION. Le code ArkTS
est fourni complet et commenté ; il s'ouvre et se lance tel quel dans DevEco.
