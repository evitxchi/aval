# Workspace UI refresh

The app shares quieter surfaces, readable controls, keyboard focus, and motion
through `app/enterprise.css`. It follows the supplied dashboard, settings,
integration catalog, upload queue, and activity drawer references. The two video
references informed the expanding project cards and foldout timing. Reduced
motion follows the operating system preference.

## Workflows

- Tasks, Calendar, Projects, and Teams use the same saved planning records.
  Board, month, week timeline, and list views support project, status, assignee,
  and text filters. Task/event forms edit dates, ownership, descriptions, and
  status. Project creation includes a description and color; expanded project
  cards show progress and link to their work. Teams combines workload with
  the existing membership controls. Existing agent activity and document draft
  workflows remain on Tasks.
- Operations uses `/api/operations/overview` for authenticated workspaces.
  Guests see labeled sample data. Reporting windows refresh the underlying
  summaries. Charts support negative values, readable axes, series selection,
  keyboard inspection, and an exact-value data table. Source management opens
  the existing connection flow.
- Integrations supports search, categories, and connected-only filtering.
  Provider details retain the existing setup, authorization, and disconnect
  behavior.
- Documents accepts TXT, Markdown, CSV, JSON, XML, and LOG files, up to 2 MB
  each and ten per selection. Uploads show actual transfer progress and
  server processing, cancellation, retry, and completion. Text extraction
  remains limited to 60,000 characters, with truncation stated in the queue.
  PDF, Office, and binary file extraction are not included.
- Ask Aval has a multiline composer, a Tools menu, and minimize/expand
  controls. Enter sends; Shift+Enter inserts a line break. Composition via an
  input method editor does not send prematurely.

## Storage and deployment

Migration `0022_fat_bullseye.sql` adds `planning_projects` and `planning_items`.
Apply it before running the new planning endpoints. The existing production
GitHub workflow applies D1 migrations before deploying the Worker.

Planning reads and writes are organization scoped. Guests cannot use planning
or upload files. Item updates and deletion require the current version; stale
edits return 409 instead of overwriting someone else's work. Platform identities
can assign work to themselves even without a local password-account record.

Each upload carries a stable request ID scoped to its workspace and uploader.
Retries after a lost response return the same stored document. Reusing a request
ID with different content does not overwrite the original.

## Validation

Run `npm test` and `npm run lint`. Tests cover persisted planning, assignment
validation, workspace isolation, concurrent edits, stale deletion, guest access,
invalid input, upload retry behavior, and chart scales with negative and missing
values. The normal suite also builds and server-renders the app in both locales.

Browser interaction and visual review have not been performed for this refresh.
Live provider connections and production migration execution are not exercised
by the local tests.
