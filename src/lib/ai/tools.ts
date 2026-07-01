import type Anthropic from "@anthropic-ai/sdk";

export const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "handoff_to_human",
    description:
      "Escala la conversación a un humano del equipo. Úsala cuando el usuario pida hablar con alguien, mencione depositar/retirar, esté molesto, mencione compliance, o cuando no estés ≥90% seguro de la respuesta.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Razón breve para escalar (1 frase).",
        },
        urgency: {
          type: "string",
          enum: ["low", "normal", "high", "critical"],
          description:
            "critical = pérdida de dinero o queja seria. high = quiere depositar ya. normal = duda compleja. low = solo prefiere humano.",
        },
        user_message_to_send: {
          type: "string",
          description:
            "Mensaje a enviar al usuario confirmando el handoff. Ej: 'Te conecto con alguien del equipo, te responde en breve 🙌'.",
        },
      },
      required: ["reason", "urgency", "user_message_to_send"],
    },
  },
  {
    name: "send_landing_link",
    description:
      "Genera y envía el link al landing page con UTMs personalizados. Úsala cuando el usuario muestre intent de registro.",
    input_schema: {
      type: "object",
      properties: {
        persona: {
          type: "string",
          enum: ["newbie", "experienced", "team_pro", "general"],
          description: "Persona detectada para personalizar el destino del landing.",
        },
        utm_campaign: {
          type: "string",
          description: "Etiqueta de campaña, ej: 'ig_dm_q3'",
        },
        utm_content: {
          type: "string",
          description: "Etiqueta de contenido específico, ej: 'apertura_cuenta'",
        },
        message: {
          type: "string",
          description:
            "Mensaje que acompañará el link. Ej: 'Aquí te dejo el enlace para abrir cuenta, te toma 3 min 👉 {LINK}'. Usa el placeholder literal {LINK}.",
        },
      },
      required: ["persona", "utm_campaign", "message"],
    },
  },
  {
    name: "save_lead_intent",
    description:
      "Guarda información del lead detectada en la conversación (nivel, capital, objetivo). Esto entrena retargeting.",
    input_schema: {
      type: "object",
      properties: {
        intent_type: {
          type: "string",
          enum: ["registration", "deposit_question", "team_pro_inquiry", "support", "info_only"],
        },
        score: {
          type: "number",
          description: "0-100, qué tan caliente está el lead.",
        },
        persona: {
          type: "string",
          enum: ["newbie", "experienced", "team_pro", "general"],
        },
        notes: {
          type: "string",
          description: "Notas estructuradas: experiencia, capital aprox, objetivo, timeframe.",
        },
      },
      required: ["intent_type", "score", "notes"],
    },
  },
  {
    name: "schedule_callback",
    description:
      "Ofrece agendar una llamada o callback cuando el usuario quiere hablar con el equipo, pero no es una queja ni un caso sensible que requiera handoff inmediato.",
    input_schema: {
      type: "object",
      properties: {
        preferred_time: {
          type: "string",
          description: "Horario preferido indicado por el usuario, ej: 'mañana en la tarde'.",
        },
        contact_method: {
          type: "string",
          enum: ["instagram", "whatsapp", "phone", "email"],
          description: "Canal preferido para el callback.",
        },
        notes: {
          type: "string",
          description: "Resumen breve de qué quiere resolver en la llamada.",
        },
        message: {
          type: "string",
          description:
            "Mensaje al usuario. Si hay link de agenda, usa el placeholder literal {LINK}.",
        },
      },
      required: ["preferred_time", "contact_method", "notes", "message"],
    },
  },
];

export function buildLandingUrl(
  base: string,
  persona: string,
  utm_campaign: string,
  utm_content?: string,
): string {
  const u = new URL(base);
  const pathMap: Record<string, string> = {
    newbie: "/abrir-cuenta-principiante",
    experienced: "/cuenta-pro",
    team_pro: "/team-pro",
    general: "/abrir-cuenta",
  };
  u.pathname = pathMap[persona] || "/abrir-cuenta";
  u.searchParams.set("utm_source", "manychat");
  u.searchParams.set("utm_medium", "dm");
  u.searchParams.set("utm_campaign", utm_campaign);
  if (utm_content) u.searchParams.set("utm_content", utm_content);
  u.searchParams.set("utm_term", persona);
  return u.toString();
}

export function buildShortLandingUrl(
  appUrl: string,
  nonce: string,
): string {
  const u = new URL("/r", appUrl);
  u.searchParams.set("n", nonce);
  return u.toString();
}
