import { INTENT_PARSER_SYSTEM_PROMPT, INTENT_PROPOSAL_JSON_SCHEMA } from "./prompts.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";

export function createOpenAIClient(options = {}) {
  const provider = options.provider ?? process.env.AI_PROVIDER ?? "openai";
  const apiKey =
    options.apiKey ??
    (provider === "deepseek" ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY);
  const model =
    options.model ??
    (provider === "deepseek"
      ? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash"
      : process.env.OPENAI_MODEL ?? "gpt-4o-mini");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("fetch is not available in this Node.js runtime");
  }

  return {
    async parseIntent(prompt) {
      if (!apiKey) {
        const error = new Error(
          provider === "deepseek"
            ? "DEEPSEEK_API_KEY is required for real AI parsing"
            : "OPENAI_API_KEY is required for real AI parsing"
        );
        error.statusCode = 503;
        throw error;
      }

      if (provider === "deepseek") {
        return parseDeepSeekResponse(
          await postDeepSeekChatCompletion(fetchImpl, {
            apiKey,
            model,
            prompt,
            baseUrl: options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEEPSEEK_CHAT_COMPLETIONS_URL
          })
        );
      }

      const response = await fetchImpl(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "system",
              content: INTENT_PARSER_SYSTEM_PROMPT
            },
            {
              role: "user",
              content: prompt
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "intent_proposal",
              strict: true,
              schema: INTENT_PROPOSAL_JSON_SCHEMA
            }
          }
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error?.message ?? "OpenAI request failed");
        error.statusCode = response.status;
        throw error;
      }

      return parseResponsePayload(payload);
    }
  };
}

async function postDeepSeekChatCompletion(fetchImpl, { apiKey, model, prompt, baseUrl }) {
  const response = await fetchImpl(baseUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: INTENT_PARSER_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: {
        type: "json_object"
      },
      max_tokens: 4096,
      stream: false
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? "DeepSeek request failed");
    error.statusCode = response.status;
    error.details = payload;
    throw error;
  }

  return payload;
}

export function parseDeepSeekResponse(payload) {
  const text = payload.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("DeepSeek response did not contain message content");
  }

  return JSON.parse(text);
}

export function parseResponsePayload(payload) {
  if (typeof payload.output_text === "string") {
    return JSON.parse(payload.output_text);
  }

  const text = payload.output
    ?.flatMap((item) => item.content ?? [])
    ?.filter((content) => content.type === "output_text" && typeof content.text === "string")
    ?.map((content) => content.text)
    ?.join("");

  if (!text) {
    throw new Error("OpenAI response did not contain output text");
  }

  return JSON.parse(text);
}
