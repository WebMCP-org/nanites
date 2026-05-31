import {
  SpanStatusCode,
  trace,
  type AttributeValue,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

const TRACER_NAME = "@nanites/observability";

export type OTelAttributes = Record<string, AttributeValue | undefined>;

function normalizeAttributes(attributes: OTelAttributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes).filter((entry): entry is [string, AttributeValue] => {
      return entry[1] !== undefined;
    }),
  );
}

export function setSpanAttributes(span: Span | null | undefined, attributes: OTelAttributes): void {
  if (!span) {
    return;
  }

  const normalized = normalizeAttributes(attributes);
  if (Object.keys(normalized).length === 0) {
    return;
  }

  span.setAttributes(normalized);
}

export function setActiveSpanAttributes(attributes: OTelAttributes): void {
  setSpanAttributes(trace.getActiveSpan(), attributes);
}

export function addSpanEvent(
  span: Span | null | undefined,
  name: string,
  attributes: OTelAttributes = {},
): void {
  if (!span) {
    return;
  }

  span.addEvent(name, normalizeAttributes(attributes));
}

export function addActiveSpanEvent(name: string, attributes: OTelAttributes = {}): void {
  addSpanEvent(trace.getActiveSpan(), name, attributes);
}

export function recordSpanException(
  span: Span | null | undefined,
  error: unknown,
  attributes: OTelAttributes = {},
): void {
  if (!span) {
    return;
  }

  setSpanAttributes(span, attributes);

  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    return;
  }

  span.recordException({ message: String(error) });
  span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
}

export function recordActiveSpanException(error: unknown, attributes: OTelAttributes = {}): void {
  recordSpanException(trace.getActiveSpan(), error, attributes);
}

export async function withActiveSpan<T>(
  name: string,
  attributes: OTelAttributes,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);

  return await tracer.startActiveSpan(
    name,
    { attributes: normalizeAttributes(attributes) },
    async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        recordSpanException(span, error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
