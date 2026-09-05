# Demo workspace isolation

Settings → Enable demo mode opens a populated, fictional workspace. A persistent
DEMO DATA banner and Exit demo control remain visible throughout it. Signed-out
visitors use this preview as well. The legacy mobile preview is explicitly
labeled as demo data and links back to the real responsive dashboard.

Mode is resolved on the server from the URL before rendering. DemoWorkspace
mounts instead of DesktopApp: it never mounts authenticated draft, assistant,
integration, membership, document-upload, or settings hooks. Sample planning
changes are held in memory and shared across calendar, projects, and teams.
Sample drafts cannot be sent or exported; sample replies are labeled previews.
Provider status changes are simulations with no OAuth or credential flow.

There is no database seeding endpoint, copied account data, or demo flag on real
records. Reloading or exiting discards the preview. Exit performs a full
navigation with `data=live`; the real workspace mounts and reads its current
records and connections again. Guests are taken to sign-in. Separate tabs may
use different modes, and every demo tab is visibly labeled.

Draft deletion uses stable IDs shared by the browser and server. Delete/Clear
removes content and leaves only a content-free deletion marker, so an in-flight
generation cannot recreate a deleted draft. Generation attempts are separately
identified so an earlier retry cannot overwrite a later result. Clear operates
on the displayed draft snapshot confirmed by the user. All queries and writes
are scoped to the authenticated organization.

Validation covers deletion before/during generation, retries, organization
boundaries, reload persistence, invalid bulk requests, mode transitions, and
server-rendered demo labels and disabled exports across every dashboard view.
