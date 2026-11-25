export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface BreakerEntry {
  state: CircuitState;
  consecutiveFailures: number;
  openedAtMs: number | null;
}

const breakers = new Map<string, BreakerEntry>();

export class ProviderCircuitBreaker {
  constructor(
    private readonly failureThreshold = 3,
    private readonly cooldownMs = 60_000,
  ) {}

  public checkAllow(provider: string, nowMs = Date.now()): boolean {
    const entry = breakers.get(provider);
    if (!entry || entry.state === 'CLOSED') {
      return true;
    }

    if (entry.state === 'OPEN') {
      if (entry.openedAtMs !== null && nowMs - entry.openedAtMs >= this.cooldownMs) {
        entry.state = 'HALF_OPEN';
        breakers.set(provider, entry);
        return true;
      }
      return false;
    }

    return true;
  }

  public recordSuccess(provider: string): void {
    breakers.set(provider, {
      state: 'CLOSED',
      consecutiveFailures: 0,
      openedAtMs: null,
    });
  }

  public recordFailure(provider: string, nowMs = Date.now()): CircuitState {
    const entry = breakers.get(provider) ?? {
      state: 'CLOSED' as CircuitState,
      consecutiveFailures: 0,
      openedAtMs: null,
    };
    entry.consecutiveFailures += 1;
    if (entry.consecutiveFailures >= this.failureThreshold) {
      entry.state = 'OPEN';
      entry.openedAtMs = nowMs;
    }
    breakers.set(provider, entry);
    return entry.state;
  }

  public getState(provider: string): CircuitState {
    return breakers.get(provider)?.state ?? 'CLOSED';
  }

  public resetAll(): void {
    breakers.clear();
  }
}

export const aiCircuitBreaker = new ProviderCircuitBreaker(3, 60_000);
