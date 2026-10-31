alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
grant update on public.profiles to authenticated;
grant insert on public.profiles to authenticated;
grant all on public.profiles to service_role;
create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());
create policy "founder inserts profiles" on public.profiles for insert to authenticated with check (public.is_founder());

alter table public.user_roles enable row level security;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
create policy "roles readable" on public.user_roles for select to authenticated using (true);
create policy "founder manages roles" on public.user_roles for all to authenticated
  using (public.is_founder()) with check (public.is_founder());

alter table public.departments enable row level security;
grant select on public.departments to authenticated;
grant all on public.departments to service_role;
create policy "departments readable" on public.departments for select to authenticated using (true);
create policy "management edits departments" on public.departments for all to authenticated
  using (public.is_management()) with check (public.is_management());

alter table public.user_departments enable row level security;
grant select on public.user_departments to authenticated;
grant all on public.user_departments to service_role;
create policy "user_departments readable" on public.user_departments for select to authenticated using (true);
create policy "founder manages user_departments" on public.user_departments for all to authenticated
  using (public.is_founder()) with check (public.is_founder());

alter table public.workflow_templates enable row level security;
grant select on public.workflow_templates to authenticated;
grant all on public.workflow_templates to service_role;
create policy "templates readable" on public.workflow_templates for select to authenticated using (true);
create policy "management edits templates" on public.workflow_templates for all to authenticated
  using (public.is_management()) with check (public.is_management());

alter table public.workflow_stages enable row level security;
grant select on public.workflow_stages to authenticated;
grant all on public.workflow_stages to service_role;
create policy "stages readable" on public.workflow_stages for select to authenticated using (true);
create policy "management edits stages" on public.workflow_stages for all to authenticated
  using (public.is_management()) with check (public.is_management());

alter table public.services enable row level security;
grant select on public.services to authenticated;
grant all on public.services to service_role;
create policy "services readable" on public.services for select to authenticated using (true);
create policy "management edits services" on public.services for all to authenticated
  using (public.is_management()) with check (public.is_management());

alter table public.clients enable row level security;
grant select on public.clients to authenticated;
grant all on public.clients to service_role;
create policy "clients visible by role" on public.clients for select to authenticated
  using (public.client_visible(id));
create policy "management creates clients" on public.clients for insert to authenticated
  with check (public.is_management());
create policy "management edits clients" on public.clients for update to authenticated
  using (public.is_management());
create policy "founder deletes clients" on public.clients for delete to authenticated
  using (public.is_founder());

alter table public.client_contacts enable row level security;
grant select on public.client_contacts to authenticated;
grant all on public.client_contacts to service_role;
create policy "contacts visible" on public.client_contacts for select to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id and public.client_visible(c.id)));
create policy "management edits contacts" on public.client_contacts for all to authenticated
  using (public.is_management()) with check (public.is_management());

alter table public.client_branches enable row level security;
grant select on public.client_branches to authenticated;
grant all on public.client_branches to service_role;
create policy "branches visible" on public.client_branches for select to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id and public.client_visible(c.id)));
create policy "management edits branches" on public.client_branches for all to authenticated
  using (public.is_management()) with check (public.is_management());

alter table public.engagements enable row level security;
grant select on public.engagements to authenticated;
grant all on public.engagements to service_role;
create policy "engagements visible" on public.engagements for select to authenticated
  using (public.client_visible(client_id));
create policy "management creates engagements" on public.engagements for insert to authenticated
  with check (public.is_management());
create policy "management edits engagements" on public.engagements for update to authenticated
  using (public.is_management());
create policy "founder deletes engagements" on public.engagements for delete to authenticated
  using (public.is_founder());

alter table public.work_assignments enable row level security;
grant select on public.work_assignments to authenticated;
grant all on public.work_assignments to service_role;
create policy "assignments visible" on public.work_assignments for select to authenticated
  using (public.client_visible(client_id) or public.assignment_involvement(id));
create policy "staff creates assignments" on public.work_assignments for insert to authenticated
  with check (public.is_management() or assigned_staff = auth.uid());
create policy "involved updates assignments" on public.work_assignments for update to authenticated
  using (public.assignment_involvement(id) or assigned_staff = auth.uid() or reviewer = auth.uid());
create policy "founder deletes assignments" on public.work_assignments for delete to authenticated
  using (public.is_founder());

alter table public.assignment_stages enable row level security;
grant select on public.assignment_stages to authenticated;
grant all on public.assignment_stages to service_role;
create policy "stages visible" on public.assignment_stages for select to authenticated
  using (public.assignment_involvement(assignment_id));
create policy "involved updates stages" on public.assignment_stages for update to authenticated
  using (public.assignment_involvement(assignment_id));
create policy "management creates stages" on public.assignment_stages for insert to authenticated
  with check (public.is_management());
create policy "founder deletes stages" on public.assignment_stages for delete to authenticated
  using (public.is_founder());

alter table public.checklist_items enable row level security;
grant select on public.checklist_items to authenticated;
grant all on public.checklist_items to service_role;
create policy "checklist visible" on public.checklist_items for select to authenticated
  using (public.assignment_involvement(assignment_id));
create policy "involved updates checklist" on public.checklist_items for update to authenticated
  using (public.assignment_involvement(assignment_id));
create policy "involved creates checklist" on public.checklist_items for insert to authenticated
  with check (public.assignment_involvement(assignment_id));
create policy "founder deletes checklist" on public.checklist_items for delete to authenticated
  using (public.is_founder());

alter table public.tasks enable row level security;
grant select on public.tasks to authenticated;
grant all on public.tasks to service_role;
create policy "tasks visible" on public.tasks for select to authenticated
  using (
    (client_id is not null and public.client_visible(client_id))
    or assignee = auth.uid()
    or reviewer = auth.uid()
    or (assignment_id is not null and public.assignment_involvement(assignment_id))
  );
create policy "staff creates tasks" on public.tasks for insert to authenticated
  with check (assignee = auth.uid() or public.is_management());
create policy "involved updates tasks" on public.tasks for update to authenticated
  using (assignee = auth.uid() or reviewer = auth.uid() or public.is_management());
create policy "founder deletes tasks" on public.tasks for delete to authenticated
  using (public.is_founder());

alter table public.task_comments enable row level security;
grant select on public.task_comments to authenticated;
grant all on public.task_comments to service_role;
create policy "task comments visible" on public.task_comments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and (t.assignee = auth.uid() or t.reviewer = auth.uid() or public.is_management())));
create policy "involved comments tasks" on public.task_comments for insert to authenticated
  with check (exists (select 1 from public.tasks t where t.id = task_id and (t.assignee = auth.uid() or t.reviewer = auth.uid() or public.is_management())));
create policy "founder deletes task comments" on public.task_comments for delete to authenticated
  using (public.is_founder());

alter table public.assignment_comments enable row level security;
grant select on public.assignment_comments to authenticated;
grant all on public.assignment_comments to service_role;
create policy "assignment comments visible" on public.assignment_comments for select to authenticated
  using (public.assignment_involvement(assignment_id));
create policy "involved comments assignments" on public.assignment_comments for all to authenticated
  using (public.assignment_involvement(assignment_id)) with check (public.assignment_involvement(assignment_id));

alter table public.document_items enable row level security;
grant select on public.document_items to authenticated;
grant all on public.document_items to service_role;
create policy "documents visible" on public.document_items for select to authenticated
  using (public.client_visible(client_id) or (assignment_id is not null and public.assignment_involvement(assignment_id)));
create policy "involved edits documents" on public.document_items for update to authenticated
  using (public.client_visible(client_id) or (assignment_id is not null and public.assignment_involvement(assignment_id)));
create policy "involved creates documents" on public.document_items for insert to authenticated
  with check (public.client_visible(client_id));
create policy "founder deletes documents" on public.document_items for delete to authenticated
  using (public.is_founder());

alter table public.comm_templates enable row level security;
grant select on public.comm_templates to authenticated;
grant all on public.comm_templates to service_role;
create policy "comm templates readable" on public.comm_templates for select to authenticated using (true);
create policy "management edits comm templates" on public.comm_templates for all to authenticated
  using (public.is_management()) with check (public.is_management());

alter table public.comm_logs enable row level security;
grant select on public.comm_logs to authenticated;
grant all on public.comm_logs to service_role;
create policy "comm logs visible" on public.comm_logs for select to authenticated
  using (client_id is null or public.client_visible(client_id));
create policy "staff logs communications" on public.comm_logs for insert to authenticated
  with check (client_id is null or public.client_visible(client_id));
create policy "staff updates own communications" on public.comm_logs for update to authenticated
  using (client_id is null or public.client_visible(client_id));
create policy "founder deletes communications" on public.comm_logs for delete to authenticated
  using (public.is_founder());

alter table public.invoices enable row level security;
grant select on public.invoices to authenticated;
grant all on public.invoices to service_role;
create policy "invoices finance visible" on public.invoices for select to authenticated
  using (public.is_finance_or_manager());
create policy "finance creates invoices" on public.invoices for insert to authenticated
  with check (public.is_finance_or_manager());
create policy "finance edits invoices" on public.invoices for update to authenticated
  using (public.is_finance_or_manager());
create policy "founder deletes invoices" on public.invoices for delete to authenticated
  using (public.is_founder());

alter table public.invoice_items enable row level security;
grant select on public.invoice_items to authenticated;
grant all on public.invoice_items to service_role;
create policy "invoice items visible" on public.invoice_items for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and public.is_finance_or_manager()));
create policy "finance edits invoice items" on public.invoice_items for insert to authenticated
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and public.is_finance_or_manager()));
create policy "finance updates invoice items" on public.invoice_items for update to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and public.is_finance_or_manager()));
create policy "founder deletes invoice items" on public.invoice_items for delete to authenticated
  using (public.is_founder());

alter table public.payments enable row level security;
grant select on public.payments to authenticated;
grant all on public.payments to service_role;
create policy "payments finance visible" on public.payments for select to authenticated
  using (public.is_finance_or_manager());
create policy "finance creates payments" on public.payments for insert to authenticated
  with check (public.is_finance_or_manager());
create policy "finance edits payments" on public.payments for update to authenticated
  using (public.is_finance_or_manager());
create policy "founder deletes payments" on public.payments for delete to authenticated
  using (public.is_founder());

alter table public.payment_allocations enable row level security;
grant select on public.payment_allocations to authenticated;
grant all on public.payment_allocations to service_role;
create policy "allocations visible" on public.payment_allocations for select to authenticated
  using (public.is_finance_or_manager());
create policy "finance edits allocations" on public.payment_allocations for all to authenticated
  using (public.is_finance_or_manager()) with check (public.is_finance_or_manager());

alter table public.collection_followups enable row level security;
grant select on public.collection_followups to authenticated;
grant all on public.collection_followups to service_role;
create policy "followups visible" on public.collection_followups for select to authenticated
  using (public.is_finance_or_manager() or owner = auth.uid());
create policy "finance edits followups" on public.collection_followups for all to authenticated
  using (public.is_finance_or_manager() or owner = auth.uid())
  with check (public.is_finance_or_manager() or owner = auth.uid());

alter table public.client_tax_money enable row level security;
grant select on public.client_tax_money to authenticated;
grant all on public.client_tax_money to service_role;
create policy "tax money finance visible" on public.client_tax_money for select to authenticated
  using (public.is_finance_or_manager() or responsible = auth.uid());
create policy "finance edits tax money" on public.client_tax_money for all to authenticated
  using (public.is_finance_or_manager() or responsible = auth.uid())
  with check (public.is_finance_or_manager() or responsible = auth.uid());

alter table public.audit_engagements enable row level security;
grant select on public.audit_engagements to authenticated;
grant all on public.audit_engagements to service_role;
create policy "audit visible to management" on public.audit_engagements for select to authenticated
  using (public.is_management());
create policy "management edits audit" on public.audit_engagements for all to authenticated
  using (public.is_management()) with check (public.is_management());

alter table public.audit_findings enable row level security;
grant select on public.audit_findings to authenticated;
grant all on public.audit_findings to service_role;
create policy "findings visible to management" on public.audit_findings for select to authenticated
  using (public.is_management());
create policy "management edits findings" on public.audit_findings for all to authenticated
  using (public.is_management()) with check (public.is_management());

alter table public.advisory_reports enable row level security;
grant select on public.advisory_reports to authenticated;
grant all on public.advisory_reports to service_role;
create policy "advisory visible" on public.advisory_reports for select to authenticated
  using (public.client_visible(client_id));
create policy "management edits advisory" on public.advisory_reports for all to authenticated
  using (public.is_management()) with check (public.is_management());

alter table public.advisory_actions enable row level security;
grant select on public.advisory_actions to authenticated;
grant all on public.advisory_actions to service_role;
create policy "advisory actions visible" on public.advisory_actions for select to authenticated
  using (public.client_visible(client_id));
create policy "management edits advisory actions" on public.advisory_actions for all to authenticated
  using (public.is_management()) with check (public.is_management());

alter table public.org_settings enable row level security;
grant select on public.org_settings to authenticated;
grant all on public.org_settings to service_role;
create policy "settings readable" on public.org_settings for select to authenticated using (true);
create policy "founder edits settings" on public.org_settings for update to authenticated
  using (public.is_founder()) with check (public.is_founder());
create policy "founder inserts settings" on public.org_settings for insert to authenticated
  with check (public.is_founder());

alter table public.activity_logs enable row level security;
grant select on public.activity_logs to authenticated;
grant all on public.activity_logs to service_role;
create policy "logs visible to founder" on public.activity_logs for select to authenticated
  using (public.is_founder());
create policy "users write own logs" on public.activity_logs for insert to authenticated
  with check (user_id = auth.uid());
