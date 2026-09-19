# Fern Draw project guidance

## Scope and restraint

- Before using tools, identify the exact files and exact change in one sentence.

## Shared implementation policy

Before changing shared UI, controls, styling, account behavior or cross-tool
utilities, read and follow [the canonical reuse policy](../fern-landing/docs/reuse-policy.md).
Use the existing implementation directly; do not copy it or create a competing
helper. This repository entry point must remain versionable; the policy itself
is maintained in Landing.
