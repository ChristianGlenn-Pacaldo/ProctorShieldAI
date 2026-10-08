type NotificationText = { title: string; message: string };

// Retired progression notifications remain in storage for compatibility. Only
// their presentation is hidden; ordinary scores, ranks and alerts stay visible.
function isProgressionTitle(title: string) {
  const value = title.trim().replace(/[!.:]+$/, "").replace(/\s+/g, " ");
  return /^(?:student progression|classroom exp progression|(?:exp|xp|experience points)(?: (?:earned|reward|rewards|progression|progress))?|level progression|level[- ]?up(?:\s*[:—–-]?\s*(?:to\s+)?level\s+\d+)?|level\s+\d+\s+(?:reached|unlocked)|\+?\d[\d,]*\s+(?:exp|xp)(?:\s+earned)?)$/i.test(value);
}

function completionMessage(message: string) {
  // Keep quoted quiz names verbatim, including legitimate EXP/Level lessons.
  return message.split(/("[^"]*"|“[^”]*”)/).map((part, index) => {
    if (index % 2 === 1) return part;
    return part
      .replace(/\bYour EXP and Level are securely saved to your student profile\.?/gi, "")
      .replace(/(?:\b(?:you\s+)?(?:earned|gained|awarded)\s+\+?\d[\d,]*|\+\d[\d,]*)\s+(?:EXP|XP|Experience Points)(?:\s+earned)?[!.]?/gi, "")
      .replace(/\b(?:you\s+)?(?:leveled up|level[- ]?up)(?:\s+to)?(?:\s+level)?\s*\d*[!.]?/gi, "")
      .replace(/\s{2,}/g, " ");
  }).join("").trim();
}

export function visibleStudentNotifications<T extends NotificationText>(notifications: readonly T[]): T[] {
  return notifications.flatMap((notification) => {
    if (isProgressionTitle(notification.title)) return [];
    const completion = /^(?:quiz completed|arena match completed|power arena match completed)$/i.test(notification.title.trim());
    const message = completion ? completionMessage(notification.message) : notification.message;
    return [message === notification.message ? notification : { ...notification, message }];
  });
}
