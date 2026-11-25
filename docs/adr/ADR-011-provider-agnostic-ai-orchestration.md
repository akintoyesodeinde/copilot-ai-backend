# ADR-011: Provider-Agnostic AI Orchestration, Budgets, and Deterministic CI Mock

- **Status:** Accepted
- **Date:** 2026-11-25
- **Phase:** Phase 2

## Decision

Isolate all LLM invocations behind `AiProviderAdapter` (`OpenAiProviderAdapter`, `AnthropicProviderAdapter`, `BedrockProviderAdapter`, and `MockAiProviderAdapter`). Enforce workspace provider allowlists, monthly token and USD spend limits, per-request cost caps, secret redaction, `<UNTRUSTED_REPOSITORY_DATA>` prompt-injection delimiters, circuit breakers, timeouts, versioned prompts (`prompt_versions`), and strict Zod structured output validation. CI runs deterministically with `MockAiProviderAdapter` requiring zero paid API keys.
