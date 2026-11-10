export const VERIFICATION_MODES = ["auto", "human", "ai"] as const;

export type VerificationMode = (typeof VERIFICATION_MODES)[number];

export type VerificationTextField = "auto" | "human" | "ai";

export interface VerificationRule {
  mode: VerificationMode;
  auto: { command: string };
  human: { instructions: string };
  ai: { instructions: string };
}

export const MAX_AUTO_COMMAND = 500;
export const MAX_HUMAN_INSTRUCTIONS = 2000;
export const MAX_AI_INSTRUCTIONS = 4000;

export function createDefaultVerification(): VerificationRule {
  return {
    mode: "human",
    auto: { command: "" },
    human: { instructions: "" },
    ai: { instructions: "" },
  };
}

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function normalizeCommand(value: unknown): string {
  return String(value ?? "")
    .replace(/\s*\r?\n+\s*/g, " ")
    .trim()
    .slice(0, MAX_AUTO_COMMAND);
}

function normalizeText(value: unknown, limit: number): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, limit);
}

function normalizeMode(value: unknown): VerificationMode {
  return VERIFICATION_MODES.includes(value as VerificationMode)
    ? (value as VerificationMode)
    : "human";
}

export function normalizeVerification(raw: unknown): VerificationRule {
  const source = isRecord(raw) ? raw : {};
  const auto = isRecord(source.auto) ? source.auto : {};
  const human = isRecord(source.human) ? source.human : {};
  const ai = isRecord(source.ai) ? source.ai : {};

  return {
    mode: normalizeMode(source.mode),
    auto: { command: normalizeCommand(auto.command) },
    human: {
      instructions: normalizeText(human.instructions, MAX_HUMAN_INSTRUCTIONS),
    },
    ai: { instructions: normalizeText(ai.instructions, MAX_AI_INSTRUCTIONS) },
  };
}

export function hasVerificationContent(rule: VerificationRule): boolean {
  return Boolean(
    rule.auto.command.trim() ||
    rule.human.instructions.trim() ||
    rule.ai.instructions.trim(),
  );
}

export function verificationModeLabel(mode: VerificationMode): string {
  if (mode === "auto") return "Auto-test";
  if (mode === "ai") return "AI";
  return "Human";
}
