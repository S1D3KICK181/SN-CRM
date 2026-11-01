import { useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Files,
  IndianRupee,
  Pencil,
  Plus,
  Search,
} from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
import type {
  ClientRecord,
  InvoiceRecord,
  ReceiptRecord,
  RecurringScheduleRecord,
} from '../../data';
import { Card, MoreButton } from '../../ui/workspace-primitives';
import { ClientProfileDrawer } from './client-profile-drawer';

type ClientComposeIntent = 'client' | 'schedule' | 'invoice' | 'receipt' | 'assignment';

interface ClientsWorkspaceProps {
  role: CompanyRole;
  model: {
    clients: ClientRecord[];
    schedules: RecurringScheduleRecord[];
    invoices: InvoiceRecord[];
    receipts: ReceiptRecord[];
  };
  actions: {
    compose: (intent: ClientComposeIntent) => void;
    notify: (message: string) => void;
    recordPaymentForInvoice: (invoice: InvoiceRecord) => void;
    updateClient?: (client: ClientRecord) => void;
  };
}

export function ClientsWorkspace({
  role,
  model,
  actions,
}: ClientsWorkspaceProps) {
  const { clients, schedules, invoices, receipts } = model;
  const { compose, notify, recordPaymentForInvoice, updateClient } = actions;

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [selectedClient, setSelectedClient] = useState<ClientRecord | null>(null);
  const [startInEditMode, setStartInEditMode] = useState(false);

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      const q = search.toLowerCase();
      const matchSearch =
        c.name.toLowerCase().includes(q) ||
        c.tradeName.toLowerCase().includes(q) ||
        c.pan.toLowerCase().includes(q) ||
        c.gstin.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q);
      const matchType = typeFilter === 'All' || c.type === typeFilter;
      return matchSearch && matchType;
    });
  }, [clients, search, typeFilter]);

  const leadership = role === 'founder' || role === 'manager';

  return (
    <div className="client-workspace">
      <section className="workspace-stats-grid">
        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Total Active Clients</span>
            <strong>48</strong>
            <small>6 currently in active view</small>
          </div>
          <span className="workspace-stat-icon">
            <Building2 aria-hidden="true" />
          </span>
        </article>
        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Active GST Filers</span>
            <strong>38</strong>
            <small>October filings due in 4 days</small>
          </div>
          <span className="workspace-stat-icon stat-success">
            <CheckCircle2 aria-hidden="true" />
          </span>
        </article>
        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Awaited Documents</span>
            <strong>12</strong>
            <small>5 client dependencies overdue</small>
          </div>
          <span className="workspace-stat-icon stat-warning">
            <Files aria-hidden="true" />
          </span>
        </article>
        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Practice Outstanding</span>
            <strong>₹1,21,750</strong>
            <small>₹88,500 over 60 days overdue</small>
          </div>
          <span className="workspace-stat-icon stat-gold">
            <IndianRupee aria-hidden="true" />
          </span>
        </article>
      </section>

      <div className="client-toolbar">
        <div className="client-search-wrap">
          <Search aria-hidden="true" />
          <input
            className="client-search-input"
            type="search"
            placeholder="Search by client name, PAN, GSTIN, trade name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="client-filter-group">
          <select
            className="client-select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by entity type"
          >
            <option value="All">All entity types</option>
            <option value="Private Limited">Private Limited</option>
            <option value="LLP">LLP</option>
            <option value="Proprietorship">Proprietorship</option>
            <option value="Partnership">Partnership</option>
            <option value="Public Limited">Public Limited</option>
          </select>
          {leadership ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => compose('client')}
            >
              <Plus aria-hidden="true" /> Add client
            </button>
          ) : null}
        </div>
      </div>

      <Card
        title="Client directory"
        description={`${filtered.length} entities matching current filter · Click row to open profile drawer`}
        action={<MoreButton />}
        className="table-card"
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Client / Trade Name</th>
                <th>Entity Type</th>
                <th>Tax IDs</th>
                <th>Relationship Owner</th>
                <th>Active Work</th>
                <th>Accounting Charges / Cadence</th>
                <th>Outstanding</th>
                <th>Profile</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => {
                const entityClass =
                  client.type === 'Private Limited'
                    ? 'entity-pvt-ltd'
                    : client.type === 'LLP'
                    ? 'entity-llp'
                    : client.type === 'Proprietorship'
                    ? 'entity-prop'
                    : client.type === 'Partnership'
                    ? 'entity-partnership'
                    : client.type === 'Public Limited'
                    ? 'entity-public-ltd'
                    : 'entity-individual';

                return (
                  <tr
                    key={client.id}
                    className="interactive-row"
                    onClick={() => {
                      setSelectedClient(client);
                      setStartInEditMode(false);
                    }}
                  >
                    <td>
                      <div>
                        <strong>{client.name}</strong>
                        <small className="table-secondary">{client.tradeName} · {client.city}</small>
                      </div>
                    </td>
                    <td>
                      <span className={`entity-badge ${entityClass}`}>{client.type}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <span className="tax-id-chip">{client.pan}</span>
                        <span className="tax-id-chip" style={{ color: 'var(--ink-muted)' }}>{client.gstin}</span>
                      </div>
                    </td>
                    <td>
                      <span>{client.primaryOwner}</span>
                    </td>
                    <td>
                      <span className="status tone-default">
                        {client.activeAssignments} active
                      </span>
                    </td>
                    <td>
                      <div>
                        <strong>{client.recurringFee}</strong>
                        <small className="table-secondary">{client.billingFrequency}</small>
                      </div>
                    </td>
                    <td>
                      <div>
                        <strong className={`tone-${client.outstandingTone}`}>{client.outstanding}</strong>
                        <small className="table-secondary">{client.outstandingAge}</small>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          className="text-button"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedClient(client);
                            setStartInEditMode(false);
                          }}
                        >
                          View <ChevronRight aria-hidden="true" />
                        </button>
                        {leadership ? (
                          <button
                            className="icon-button"
                            type="button"
                            title={`Edit ${client.name}`}
                            aria-label={`Edit ${client.name}`}
                            style={{ width: 28, height: 28 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedClient(client);
                              setStartInEditMode(true);
                            }}
                          >
                            <Pencil size={12} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedClient ? (
        <ClientProfileDrawer
          client={selectedClient}
          schedules={schedules}
          leadership={leadership}
          role={role}
          invoices={invoices}
          receipts={receipts}
          onClose={() => {
            setSelectedClient(null);
            setStartInEditMode(false);
          }}
          onToast={notify}
          onCompose={compose}
          onRecordPaymentForInvoice={recordPaymentForInvoice}
          onUpdateClient={(updated) => {
            setSelectedClient(updated);
            if (updateClient) updateClient(updated);
          }}
          initialEditing={startInEditMode}
        />
      ) : null}
    </div>
  );
}
