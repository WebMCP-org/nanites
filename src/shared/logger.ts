import {
  configureSync,
  getConsoleSink,
  type ConsoleFormatter,
  type LogRecord,
} from "@logtape/logtape";
import { LOGGING } from "#/shared/observability/logging.ts";

let configured = false;

const structuredConsoleFormatter: ConsoleFormatter = (record: LogRecord) => [
  {
    timestamp: new Date(record.timestamp).toISOString(),
    level: record.level,
    category: record.category.join("."),
    message: record.message,
    ...record.properties,
  },
];

export function configureAgentLogging(lowestLevel: "debug" | "info" = "info"): void {
  if (configured) {
    return;
  }

  configured = true;

  configureSync({
    sinks: {
      console: getConsoleSink({
        formatter: structuredConsoleFormatter,
      }),
    },
    loggers: [
      {
        category: LOGGING.ROOT_CATEGORY,
        sinks: ["console"],
        lowestLevel,
      },
      {
        category: [...LOGGING.LOGTAPE_META_CATEGORY],
        sinks: ["console"],
        lowestLevel: "warning",
      },
    ],
    reset: true,
  });
}
