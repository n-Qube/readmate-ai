# Dependency risk register

Last reviewed: 2026-08-24 with npm's current advisory database.

The release gate rejects critical advisories. High/moderate entries require an explicit review because npm commonly reports build tooling and bundled-but-unreachable optional integrations as production dependencies.

## Remediated in this change

- Vitest 4.1.11 removes the critical UI-server file read/execution advisory.
- Vite 8.2.2 and `@vitejs/plugin-react` 6.1.0 remove the affected Vite/esbuild development-server lines.
- Sharp 0.35.3 includes the fixed libvips release.
- Metro, Metro Config, and Metro Transform Worker are pinned to patched 0.84.5.
- Clerk Expo moved from the deprecated Core 2 package to supported `@clerk/expo` Core 3. The custom sign-in factor UI uses Clerk's documented legacy adapter while the rest of the app uses current Core 3 hooks.
- The API runtime image uses Node 22 and prunes development and peer tooling.

## Accepted upstream advisories

- npm reports three high entries for `prisma` -> `@prisma/config` -> `deepmerge-ts@7.1.5`. The affected recursive-object merge is in the Prisma CLI configuration path. No fixed stable Prisma release is currently published; Prisma 7.9.1 remains in npm's affected range. The CLI is used only in the isolated build/migration stages, its config is repository-controlled, and it is removed from the runtime image with `--omit=dev --omit=peer`.
- Remaining moderate entries originate in the current Expo 56 toolchain and optional Clerk/Solana wallet packages. npm reports no compatible fixed dependency path for those chains. ReadMate does not expose a Metro/Vite dev server in production and does not use Solana wallet sign-in. Recheck on every lockfile update and remove this exception as soon as upstream publishes compatible fixes.

Do not use `npm audit fix --force`: npm currently proposes incompatible downgrades (including Expo 46) or unrelated major transitions. Review and test each direct upgrade instead.
