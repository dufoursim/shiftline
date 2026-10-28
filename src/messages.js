/**
 * Every text the bot shows in Slack, in English and French.
 * Pick the language with the LANGUAGE variable in wrangler.toml ("en" by default, or "fr").
 */

const plural = (n, one, many) => (n > 1 ? many : one);

const MESSAGES = {
  en: {
    notLinked: "Your Slack account is not linked to any phone extension. Ask your administrator to add it.",
    unknownQueue: (text, choices) => `Unknown queue “${text}”. You can use: ${choices} (or nothing for all your queues).`,
    notMember: (queue) => `You are not a member of the ${queue} queue.`,
    announceOnline: (agent, queues) => `:large_green_circle: *${agent.name}* (ext. ${agent.extension}) is online — ${queues}`,
    announceOffline: (agent, queues) => `:red_circle: *${agent.name}* (ext. ${agent.extension}) is offline — ${queues}`,
    confirmOnline: (queues, count, extension) =>
      `:large_green_circle: You are online in: *${queues}*. Calls from ${plural(count, "this queue", "these queues")} will ring at extension ${extension}.`,
    confirmOffline: (queues) => `:red_circle: You are offline for: *${queues}*. You will no longer get these calls.`,
    pbxUnreachable: (error) => `:warning: Could not reach FreePBX (${error}). Nothing was changed.`,
    statusUnreachable: (error) => `:warning: Could not read the queues (${error}).`,
    unknownCommand: (command) => `Unknown command: ${command}`,
    statusTitle: ":busts_in_silhouette: *Queues right now*",
    waiting: (n) => `:hourglass: *${n}* call${plural(n, "", "s")} waiting`,
    noneWaiting: "no calls waiting",
    nobodyOnline: "_Nobody online_",
    unknownError: "unknown error",
    states: {
      paused: ":double_vertical_bar: paused",
      available: ":large_green_circle: available",
      inCall: ":telephone_receiver: on a call",
      ringing: ":bell: ringing",
      unreachable: ":black_circle: phone unreachable",
      unknown: ":white_circle: unknown state",
    },
  },
  fr: {
    notLinked: "Ton compte Slack n'est relié à aucun poste téléphonique. Demande à l'administrateur de l'ajouter.",
    unknownQueue: (text, choices) => `File « ${text} » inconnue. Choix possibles : ${choices} (ou rien pour toutes tes files).`,
    notMember: (queue) => `Tu ne fais pas partie de la file ${queue}.`,
    announceOnline: (agent, queues) => `:large_green_circle: *${agent.name}* (poste ${agent.extension}) est en ligne — ${queues}`,
    announceOffline: (agent, queues) => `:red_circle: *${agent.name}* (poste ${agent.extension}) est hors ligne — ${queues}`,
    confirmOnline: (queues, count, extension) =>
      `:large_green_circle: Tu es en ligne dans : *${queues}*. Les appels de ${plural(count, "cette file", "ces files")} vont sonner à ton poste ${extension}.`,
    confirmOffline: (queues) => `:red_circle: Tu es hors ligne pour : *${queues}*. Tu ne recevras plus ces appels.`,
    pbxUnreachable: (error) => `:warning: Impossible de joindre FreePBX (${error}). Rien n'a changé.`,
    statusUnreachable: (error) => `:warning: Impossible de lire les files (${error}).`,
    unknownCommand: (command) => `Commande inconnue : ${command}`,
    statusTitle: ":busts_in_silhouette: *Files d'attente en ce moment*",
    waiting: (n) => `:hourglass: *${n}* appel${plural(n, "", "s")} en attente`,
    noneWaiting: "aucun appel en attente",
    nobodyOnline: "_Personne en ligne_",
    unknownError: "erreur inconnue",
    states: {
      paused: ":double_vertical_bar: en pause",
      available: ":large_green_circle: disponible",
      inCall: ":telephone_receiver: en appel",
      ringing: ":bell: sonne",
      unreachable: ":black_circle: téléphone non joignable",
      unknown: ":white_circle: état inconnu",
    },
  },
};

export function messages(env) {
  return MESSAGES[String(env.LANGUAGE ?? "").toLowerCase()] ?? MESSAGES.en;
}
