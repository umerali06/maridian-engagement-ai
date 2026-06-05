import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getClient() as any)[prop];
  },
});

export const MODEL_BRAIN = process.env.ANTHROPIC_MODEL_BRAIN || "claude-sonnet-4-6";
export const MODEL_CHEAP = process.env.ANTHROPIC_MODEL_CHEAP || "claude-haiku-4-5-20251001";

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};
