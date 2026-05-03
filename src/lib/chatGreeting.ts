import type { ChatMessage } from "@/types";

export const ASSISTANT_GREETING_COPY =
  "Hey how are you? Let's create your memecoin algo strategy.";

export function createAssistantGreetingMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: ASSISTANT_GREETING_COPY,
    createdAt: Date.now(),
  };
}
