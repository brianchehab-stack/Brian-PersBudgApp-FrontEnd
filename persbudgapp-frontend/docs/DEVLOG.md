# Development Log (Devlog)

Project: Personal Budget App Frontend
Repository: Brian-PersBudgApp-FrontEnd


### Project Setup and Docs

- Clarified startup flow in `persbudgapp-frontend/README.md` with simple activation steps.
- Added explicit local environment setup (`VITE_API_BASE_URL`) and run/build commands.
- Kept documentation aligned with Vite and Render static deployment.

### Core Frontend Improvements

- Implemented authenticated session restoration flow with token persistence and user restore on refresh.
- Improved user-specific local caching of transactions and budgets using a scoped key strategy.
- Preserved local entries on logout to avoid accidental in-session data loss.

### Data Sync and Reliability

- Added backend/local fallback behavior to keep the app usable when API calls fail.
- Improved sync behavior to reduce missing alerts after logout/login by preserving cached entries.
- Updated transaction API category handling to better match backend-supported category values.

### UX and Dashboard Updates

- Refined top navigation and screen routing behavior across dashboard tabs.
- Adjusted greeting behavior to first-name display.
- Added clickable alert metric that navigates and scrolls to the alerts section.
- Applied explicit category colors for chart consistency.
- Updated dashboard panel arrangement for quick-add and budget snapshot placement.

### Voice Transaction Flow

- Improved voice parsing for type, category, and amount extraction.
- Added normalization before save to reduce invalid submissions.
- Continued hardening for backend category compatibility.

## Known Follow-Ups

- Verify all backend enum/category expectations for voice and manual transaction saves.
- Add automated tests for:
  - auth restore and logout/login data persistence,
  - alerts calculation after sync,
  - voice input normalization and API payload mapping.
- Add a short release checklist for deployment validation (env vars, build output, API connectivity).

## Notes

- App is designed to degrade gracefully to local storage when backend is unavailable.
- User-scoped local entries are used to improve continuity across sessions.
