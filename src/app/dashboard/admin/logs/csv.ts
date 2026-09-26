type CsvLog = {
  timestamp: string;
  event: string;
  severity: string;
  confidence: string;
  student: string;
  quiz: string;
};

export function encodeCsvCell(value: string): string {
  const literal = /^[=+\-@]/.test(value) ? `\t${value}` : value;
  return `"${literal.replaceAll('"', '""')}"`;
}

export function createAiLogsCsv(logs: CsvLog[]): string {
  const headers = ["Timestamp", "Event Type", "Severity", "Confidence", "Student", "Quiz"];
  const rows = logs.map((log) => [log.timestamp, log.event, log.severity, log.confidence, log.student, log.quiz]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(encodeCsvCell).join(",")).join("\r\n")}`;
}
