# AGENTS.md

## Repo Shape

- This is a Yarn 1 monorepo (`packageManager: yarn@1.22.22`) requiring Node `>=18`; CI uses Node 20.
- Workspaces are `excalidraw-app`, `packages/*`, and `examples/*`; use the root `yarn.lock` for those workspaces.
- `packages/excalidraw/` is the published React library (`@excalidraw/excalidraw`); `excalidraw-app/` is the Vite app for excalidraw.com.
- Internal package imports are aliased to source files in `tsconfig.json`, `vitest.config.mts`, and `excalidraw-app/vite.config.mts`; do not assume package imports resolve to `dist` during local dev/tests.
- `examples/with-nextjs` and `dev-docs` each have their own lockfile and are not root workspaces.

## Commands

- Install from the repo root with `yarn install`.
- Start the app with `yarn start`; this runs `yarn --cwd ./excalidraw-app start`, and the app Vite config loads env from the repo root (`envDir: ../`).
- Build the app with `yarn build`; build packages with `yarn build:packages`.
- Run the main test suite with `yarn test:app` or focused Vitest paths, for example `yarn test:app packages/math/tests/vector.test.ts --watch=false`.
- Update snapshots with `yarn test:update` (`vitest --update --watch=false`).
- CI lint/type gates are `yarn test:other` (Prettier on css/scss/json/md/html/yml), `yarn test:code` (ESLint with zero warnings), and `yarn test:typecheck` (`tsc`).
- `yarn test:all` runs `test:typecheck -> test:code -> test:other -> test:app --watch=false`.
- Auto-fix formatting/lint with `yarn fix`.

## Editing Rules Worth Remembering

- ESLint forbids direct `jotai` imports; use the app-specific `editor-jotai` or `app-jotai` modules instead.
- In `packages/excalidraw/**/*.{ts,tsx}` outside tests, do not import from package/index barrels such as `@excalidraw/excalidraw`, `.`, `..`, or `../index`; use direct relative module imports. Type-only barrel imports are allowed by the configured exception.
- Prefer separate type imports; `@typescript-eslint/consistent-type-imports` is an error.
- For math-related work, include `packages/math/src/types.ts` in context and use the repo `Point` type rather than ad hoc `{ x, y }` shapes.

## Package And Example Gotchas

- Package builds write `dist` and generated declarations: base packages use `scripts/buildBase.js`; `packages/excalidraw` uses `scripts/buildPackage.js`.
- The browser-script example must be run after building packages: root `yarn start:example` does `yarn build:packages` first.
- The Next.js example also builds packages and copies `packages/excalidraw/dist/prod/fonts` before `next dev`; use `yarn --cwd examples/with-nextjs dev` rather than plain `next dev`.
- For embed/integration changes, `packages/excalidraw/README.md` documents easy-to-miss requirements: import `@excalidraw/excalidraw/index.css`, render in a non-zero-height container, and use client-only rendering for SSR frameworks.

## Existing Instructions

- `CLAUDE.md` contains the project overview and repeats the expected verification commands.
- `.github/copilot-instructions.md` adds local conventions, including concise communication, performance-conscious TypeScript, and the math `Point` reminder.
