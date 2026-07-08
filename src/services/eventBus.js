// Lightweight in-process event bus.

const subscribers = new Map();

export function subscribe(eventType, handler) {
  if (!subscribers.has(eventType)) {
    subscribers.set(eventType, new Set());
  }
  subscribers.get(eventType).add(handler);
  return () => {
    subscribers.get(eventType)?.delete(handler);
  };
}

export function publish(eventType, payload) {
  const handlers = subscribers.get(eventType);
  if (!handlers) return;
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch (err) {
      // Swallow handler errors to avoid breaking the publisher.
      console.error(`Event handler error for ${eventType}:`, err.message);
    }
  }
}

export function clearSubscribers() {
  subscribers.clear();
}
