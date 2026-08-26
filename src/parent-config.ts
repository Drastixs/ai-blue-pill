import { join } from "node:path";
import { writeJsonAtomic } from "./util.js";

export interface ParentSelection {
  provider: string;
  model: string;
  thinking: string;
}

export function parentSelection(fileConfig: Record<string, string>): ParentSelection {
  return {
    provider: fileConfig.AIBP_PARENT_PROVIDER || "openai-codex",
    model: fileConfig.AIBP_PARENT_MODEL || "gpt-5.6-sol",
    thinking: fileConfig.AIBP_PARENT_THINKING || "medium",
  };
}

export function prepareParentEnvironment(
  runDir: string,
  fileConfig: Record<string, string>,
  selection: ParentSelection,
): Record<string, string> {
  const baseUrl = fileConfig.AIBP_PARENT_BASE_URL;
  if (!baseUrl) return { ...fileConfig };
  if (!fileConfig.AIBP_PARENT_API_KEY) {
    throw new Error("AIBP_PARENT_API_KEY is required when AIBP_PARENT_BASE_URL is set");
  }
  const agentDir = join(runDir, "pi-agent");
  writeJsonAtomic(join(agentDir, "models.json"), {
    providers: {
      [selection.provider]: {
        baseUrl,
        api: fileConfig.AIBP_PARENT_API || "openai-responses",
        apiKey: "$AIBP_PARENT_API_KEY",
        models: [{
          id: selection.model,
          name: selection.model,
          reasoning: fileConfig.AIBP_PARENT_REASONING !== "false",
        }],
      },
    },
  });
  return { ...fileConfig, PI_CODING_AGENT_DIR: agentDir };
}
