export type ArenaFeedbackOutcome = "launched" | "hit" | "deflected";

export function getShieldTerminalOutcome(response: {
  code?: string;
  deflected?: boolean;
  attackStatus?: string;
}): "hit" | "deflected" | null {
  if (response.code === "blocked" || response.deflected || response.attackStatus === "deflected") {
    return "deflected";
  }
  if (response.attackStatus === "hit") return "hit";
  return null;
}

export function claimArenaFeedback(
  displayed: Set<string>,
  attackId: string,
  outcome: ArenaFeedbackOutcome,
): boolean {
  const key = `${attackId}:${outcome}`;
  if (displayed.has(key)) return false;
  displayed.add(key);
  return true;
}
