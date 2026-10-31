# SN Practice CRM — roadmap

Source spec: user-uploads://Build_a_professional_responsive_multi-user_web_pasted.md

## Done this build
- [x] Schema: 30 tables, RLS per role, auto-numbering, allocation trigger, demo flags
- [x] Email/password auth, signup → first user becomes Founder, reset-password page
- [x] Sidebar app: Dashboard, Clients (+detail), Services & Engagements, Work Assignments (+detail with workflow/checklist/documents/comments/WhatsApp), My Tasks, Team & Departments, Documents, Communication & Reminders, Billing & Invoices (PDF), Receipts & Collections (allocation, ageing, weekly report), Client Tax Money, Internal Audit, L2/Virtual CFO, Reports (CSV/print), Settings
- [x] Demo data: 6 clients, 5 demo staff (password Demo@1234), invoices/receipts/audit/L2 records
- [x] Demo data removal (Settings) + demo staff removal (Team)
- [x] Full typecheck clean (tsgo + tsc); browser-verified all 14 pages signed-in with zero console errors; end-to-end client create (auto-numbered CL-0019) verified and test row removed

## Known limitations / next
- [ ] WhatsApp Business API integration — shown "Not connected" until configured
- [ ] File attachments to document items (private storage bucket) — paths stored, upload UI pending
- [ ] Saved views/filters persistence
- [ ] Client profitability report (needs cost data)
- [ ] Service catalogue editor for workflow stage reorder (templates read-only in UI v1)
