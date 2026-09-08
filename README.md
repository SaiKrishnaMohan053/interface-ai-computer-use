# Computer-Use Automation System

An interface.ai take-home implementation for controlled UI automation.

The intended end-to-end flow is:

Natural-language goal → LLM discovery → reusable capability artifact →
deterministic replay → human intervention when required.

## Current status

Phase 1.1: repository foundation.

Available:

- Strict TypeScript with Node.js ESM.
- Playwright and Zod dependencies.
- Vitest configuration.
- ESLint, Prettier, and build scripts.
- Module boundaries and documentation skeletons.

The demo banking application, browser runtime, discovery, capability compilation,
replay, and human handoff are not implemented yet.

## Prerequisites

- Node.js 24.x
- npm
- Playwright Chromium

## Setup

After cloning:

```sh
npm ci
npx playwright install chromium
```
