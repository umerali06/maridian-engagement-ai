/**
 * Prompt builders. The system prompt is structured so the static portion
 * (Meridian voice + tools instructions + applied learnings) can be cached
 * via Anthropic's prompt caching (~90% input-cost reduction on repeat turns).
 */

type Brand = {
  name: string;
  system_prompt: string;
  voice_guidelines: string;
  mandatory_disclaimer: string;
};

type Learning = { insight: string; suggested_fix: string | null };

export function buildSystemPrompt(
  brand: Brand,
  appliedLearnings: Learning[],
): string {
  const learningsBlock =
    appliedLearnings.length > 0
      ? `\n\n## Aprendizajes aplicados (loop de mejora)\n${appliedLearnings
          .map((l, i) => `${i + 1}. ${l.insight}${l.suggested_fix ? ` → ${l.suggested_fix}` : ""}`)
          .join("\n")}`
      : "";

  return `# Eres ${brand.name} AI

${brand.system_prompt}

## Guía de voz
${brand.voice_guidelines}

## Disclaimer obligatorio
Cuando menciones retornos, rentabilidad, ganancias o resultados de trading, AGREGA al final del mensaje:
"${brand.mandatory_disclaimer}"

## Herramientas disponibles
- handoff_to_human: úsala cuando el usuario pida hablar con alguien, quiera depositar fondos, esté molesto, mencione un problema de cumplimiento, o cuando no estés 90%+ seguro de la respuesta.
- send_landing_link: úsala cuando detectes intent de registro y el usuario haya mostrado interés concreto. Personaliza por persona (newbie/experienced/team_pro).
- save_lead_intent: úsala cuando captures información valiosa (nivel de experiencia, capital disponible, objetivo). Esto entrena retargeting.

## Reglas duras
- NUNCA prometas rentabilidad específica.
- NUNCA des consejo financiero personalizado.
- NUNCA inventes datos de la empresa. Si no sabes, di "déjame conectarte con alguien del equipo" y llama handoff_to_human.
- Si te preguntan por información sensible (depósito, retiro, datos bancarios), NUNCA pidas los datos. Llama handoff_to_human inmediatamente.
- Responde en máximo 3 frases. Si la respuesta requiere más, divídela o ofrece pasar a humano.
- Tutea siempre. 1 emoji máx por mensaje.${learningsBlock}`;
}

/**
 * Wrap the system prompt for prompt caching.
 * Returns the Anthropic-format `system` array with cache_control on the last block.
 */
export function buildCachedSystem(systemText: string) {
  return [
    {
      type: "text" as const,
      text: systemText,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

/**
 * Format the RAG context as a separate user-turn block (not cached — changes per query).
 * Sent as an injected user-style prefix message right before the actual user message.
 */
export function buildContextBlock(ragContent: string): string {
  if (!ragContent) return "";
  return `<contexto_de_base_de_conocimiento>
Usa la siguiente información para fundamentar tu respuesta. Si no es relevante, ignórala. No menciones que estás consultando "documentos" — habla como si supieras esto.

${ragContent}
</contexto_de_base_de_conocimiento>`;
}

/**
 * Reviewer prompt for the nightly learning loop.
 */
export function buildReviewerPrompt(transcript: string): string {
  return `Eres un reviewer de calidad de conversaciones de un community manager IA de un broker.

Analiza la siguiente conversación y devuelve UN JSON (sin texto antes ni después) con este formato:

{
  "issues": [
    {
      "category": "missed_intent|tone_correction|factual_gap|escalation_pattern|process_gap",
      "insight": "qué pasó, en 1 frase concreta",
      "severity": "low|medium|high",
      "suggested_fix": "cómo evitarlo la próxima vez, accionable"
    }
  ]
}

Si la conversación fue impecable, devuelve {"issues": []}.

Conversación:
${transcript}`;
}
