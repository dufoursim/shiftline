# Guide des agents

[English version](AGENT-GUIDE.md)

Pour les personnes qui prennent les appels. Partagez cette page, ou collez le
[message pour le canal](#message-à-épingler-dans-le-canal) dans votre canal d'annonces et épinglez-le.

## À chaque quart

1. **Début de quart** : tapez `/online` dans Slack. Les appels de toutes vos files sonnent maintenant
   à votre poste. Pour une seule file : `/online ventes` (les mots à taper sont choisis par votre
   administrateur).
2. **Pendant le quart** : `/file` montre les appels en attente dans chaque file et qui est en ligne.
3. **Pause, dîner, fin de quart** : `/offline` (ou `/offline ventes` pour une seule file).

Le bot annonce chaque changement dans le canal des annonces :
« 🟢 Amélie Tremblay (poste 201) est en ligne — VENTES ». Si vous tapez la commande ailleurs
(message privé, autre canal), vous recevez aussi une confirmation privée. Les erreurs vous sont
toujours signalées en privé.

## États affichés par `/file`

| État | Signification |
|---|---|
| 🟢 disponible | Connecté et libre : le prochain appel peut sonner |
| 📞 en appel | Connecté, déjà en appel |
| 🔔 sonne | Un appel sonne en ce moment |
| ⏸️ en pause | Connecté mais en pause (les appels ne sonnent pas) |
| ⚫ téléphone non joignable | Connecté, mais le téléphone ou le softphone n'est pas enregistré : **ouvrez votre softphone** |

## Bon à savoir

- **Vous ne gérez que votre propre poste.** Votre compte Slack y est relié par votre administrateur.
- **À quelles files puis-je me connecter ?** Seulement celles que votre administrateur vous a
  données. `/online` sans mot vous connecte à toutes ; si vous tapez une file dont vous ne faites
  pas partie, le bot vous le dit.
- **`*45` fonctionne toujours.** Se connecter par le téléphone ou par Slack, c'est pareil : `/file`
  voit les deux, et `/offline` vous déconnecte même si vous avez utilisé `*45`.
- **Un message ⚠️ veut dire que rien n'a changé.** Réessayez ; si ça échoue encore, vérifiez avec
  `/file` et prévenez votre administrateur.
- **« Relié à aucun poste »** : demandez à votre administrateur de vous ajouter.

## Message à épingler dans le canal

Copiez, adaptez les mots des files, collez dans le canal des annonces, puis épinglez
(menu du message **⋮** → **Épingler au canal**).

```
📞 *Prendre les appels avec Shiftline*

• `/online` — début de quart : les appels de toutes vos files sonnent à votre poste
• `/online ventes` ou `/online soutien` — une seule file
• `/offline` — pause, dîner, fin de quart (ou `/offline ventes`)
• `/file` — qui est en ligne et combien d'appels attendent

Chaque changement est annoncé ici. *45 sur le téléphone fonctionne toujours et fait la même chose.
⚫ « téléphone non joignable » dans /file = ouvrez votre softphone !
Un message ⚠️ veut dire que rien n'a changé : réessayez, puis prévenez l'administrateur.
```

**Description du canal** (nom du canal → **Modifier la description**) :

```
Connexions et déconnexions aux files d'attente (/online, /offline). /file montre qui prend les appels.
```
