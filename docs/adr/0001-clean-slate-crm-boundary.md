# Build the new CRM beside the Lovable reference

The production CRM will be implemented as a clean-slate application under `sn-practice-crm/`, while the existing Lovable code remains intact as a behavioural and data-workflow reference. This avoids accumulating incompatible visual and authorization assumptions in the old routes, lets the new frontend reproduce the approved compact Horizon shell consistently, and creates explicit domain, API, and database boundaries without rewriting published Lovable history.

## Consequences

The new application may copy proven business behaviour but does not import legacy UI components. Shared concepts must pass through the new domain authority module, and migration to the new application will happen by verified workflows rather than an all-at-once replacement.
