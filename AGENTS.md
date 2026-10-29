# Publication boundary

This project separates the daily development/data checkout from a clean public checkout.
The local arrangement is sibling directories `story-atlas` (development/data) and `story-atlas-public` (publication only). Confirm the role in local Git metadata before any push.

- Read PUBLICATION.md before publishing. Keep this separation in future work.
- The development checkout has local manuscripts and references. Never add a GitHub remote, push it (including with an explicit URL), copy its `.git`, or bypass its pre-push hook.
- Use `npm run prepare:public` in the development checkout. It exports only committed files explicitly listed in `publication-files.json` into the locally configured public checkout. It does not push or transfer development history.
- Review new whitelist entries individually. Never add data, library, author scripts, screenshots, credentials, backups, or private identifiers. New source files are not exported until explicitly approved in the whitelist.
- Run syntax/tests and review the diff in the public checkout; commit there and run `npm run gate:public` before pushing from that checkout. Keep its pre-push hook enabled.
- Never run the app or import author data in the public checkout. It must contain source and synthetic fixtures only.
- Local publication roles, paths, blocked private terms, and scanner paths live in each checkout's Git metadata, outside commits.
- Do not treat this publication arrangement as a backup of novels. Preserve the development data and its existing service.
