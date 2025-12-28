export type FetchClientEventEmitterEventMap = Record<string, (...args: any[]) => void>;

export type FetchClientEventListener<T extends unknown[]> = (...args: T) => void;

export default class FetchClientEventEmitter<
  EventMap extends FetchClientEventEmitterEventMap = FetchClientEventEmitterEventMap
> {
  private listeners = new Map<
    keyof EventMap,
    Set<FetchClientEventListener<Parameters<EventMap[keyof EventMap]>>>
  >();

  public addEventListener<EventKey extends keyof EventMap>(
    event: EventKey,
    listener: FetchClientEventListener<Parameters<EventMap[EventKey]>>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const eventListeners = this.listeners.get(event)!;
    eventListeners.add(listener);
    return () => this.removeEventListener(event, listener);
  }

  public addOnceEventListener<EventKey extends keyof EventMap>(
    event: EventKey,
    listener: FetchClientEventListener<Parameters<EventMap[EventKey]>>
  ): () => void {
    const onceEventListener = (...args: Parameters<EventMap[EventKey]>) => {
      this.removeEventListener(event, onceEventListener);
      listener(...args);
    };

    return this.addEventListener(event, onceEventListener);
  }

  public removeEventListener<EventKey extends keyof EventMap>(
    event: EventKey,
    listener: FetchClientEventListener<Parameters<EventMap[EventKey]>>
  ): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;
    eventListeners.delete(listener);
    if (eventListeners.size === 0) {
      this.listeners.delete(event);
    }
  }

  public clearEventListeners<EventKey extends keyof EventMap>(event?: EventKey): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  public countEventListeners<EventKey extends keyof EventMap>(event: EventKey): number {
    const eventListeners = this.listeners.get(event);
    return eventListeners ? eventListeners.size : 0;
  }

  protected dispatchEvent<EventKey extends keyof EventMap>(
    event: EventKey,
    ...args: Parameters<EventMap[EventKey]>
  ): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;
    for (const listener of [...eventListeners]) {
      try {
        listener(...args);
      } catch (err) {
        console.error(`Error in event listener for event "${String(event)}":`, err);
      }
    }
  }
}
