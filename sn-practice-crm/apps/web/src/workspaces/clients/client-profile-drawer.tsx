import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Building2,
  Check,
  Files,
  FileText,
  Mail,
  Pencil,
  Phone,
  Plus,
  ReceiptIndianRupee,
  X,
} from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
import {
  ASSIGNMENTS,
  formatINR,
  type ClientRecord,
  type ClientType,
  type InvoiceRecord,
  type ReceiptRecord,
  type RecurringScheduleRecord,
} from '../../data';
import { Field, Status } from '../../ui/workspace-primitives';

export function ClientProfileDrawer({
  client,
  schedules,
  leadership,
  role,
  invoices,
  receipts,
  onClose,
  onToast,
  onCompose,
  onRecordPaymentForInvoice,
  onUpdateClient,
  initialEditing = false,
}: {
  client: ClientRecord;
  schedules: RecurringScheduleRecord[];
  leadership: boolean;
  role?: CompanyRole;
  invoices: InvoiceRecord[];
  receipts: ReceiptRecord[];
  onClose: () => void;
  onToast: (msg: string) => void;
  onCompose: (mode: 'client' | 'schedule' | 'invoice' | 'receipt' | 'assignment') => void;
  onRecordPaymentForInvoice: (inv: InvoiceRecord) => void;
  onUpdateClient?: (updated: ClientRecord) => void;
  initialEditing?: boolean;
}) {
  const canFullEdit = role === 'founder' || role === 'manager';
  const [tab, setTab] = useState<'overview' | 'kyc' | 'schedules' | 'work' | 'billing'>('overview');
  const [isEditing, setIsEditing] = useState(initialEditing);

  const [editName, setEditName] = useState(client.name);
  const [editTradeName, setEditTradeName] = useState(client.tradeName);
  const [editType, setEditType] = useState<ClientType>(client.type);
  const [editIndustry, setEditIndustry] = useState(client.industry);
  const [editCity, setEditCity] = useState(client.city);
  const [editState, setEditState] = useState(client.state);
  const [editPan, setEditPan] = useState(client.pan);
  const [editGstin, setEditGstin] = useState(client.gstin);
  const [editGstScheme, setEditGstScheme] = useState<'Regular' | 'QRMP' | 'Composition' | 'Unregistered'>(client.gstScheme || 'Regular');
  const [editCin, setEditCin] = useState(client.cin || '');
  const [editTan, setEditTan] = useState(client.tan || '');
  const [editContactName, setEditContactName] = useState(client.contactName);
  const [editContactDesignation, setEditContactDesignation] = useState(client.contactDesignation);
  const [editPhone, setEditPhone] = useState(client.phone);
  const [editEmail, setEditEmail] = useState(client.email);
  const [editOwner, setEditOwner] = useState(client.primaryOwner);
  const [editStatus, setEditStatus] = useState(client.status);
  const [editBillingFreq, setEditBillingFreq] = useState<'Monthly' | 'Quarterly' | 'Annual'>(client.billingFrequency);
  const [editRecurringFee, setEditRecurringFee] = useState(
    parseInt(client.recurringFee.replace(/[^0-9]/g, ''), 10) || 25000
  );
  const [editNotes, setEditNotes] = useState(client.notes || '');
  const [editBankStatementReq, setEditBankStatementReq] = useState<boolean>(client.bankStatementRequired !== false);

  useEffect(() => {
    setEditName(client.name);
    setEditTradeName(client.tradeName);
    setEditType(client.type);
    setEditIndustry(client.industry);
    setEditCity(client.city);
    setEditState(client.state);
    setEditPan(client.pan);
    setEditGstin(client.gstin);
    setEditGstScheme(client.gstScheme || 'Regular');
    setEditCin(client.cin || '');
    setEditTan(client.tan || '');
    setEditContactName(client.contactName);
    setEditContactDesignation(client.contactDesignation);
    setEditPhone(client.phone);
    setEditEmail(client.email);
    setEditOwner(client.primaryOwner);
    setEditStatus(client.status);
    setEditBillingFreq(client.billingFrequency);
    setEditRecurringFee(parseInt(client.recurringFee.replace(/[^0-9]/g, ''), 10) || 25000);
    setEditNotes(client.notes || '');
    setEditBankStatementReq(client.bankStatementRequired !== false);
    setIsEditing(initialEditing);
  }, [client, initialEditing]);

  function handleSave(e?: FormEvent) {
    if (e) e.preventDefault();
    const updatedClient: ClientRecord = {
      ...client,
      name: editName.trim() || client.name,
      tradeName: editTradeName.trim() || client.tradeName,
      type: editType,
      industry: editIndustry.trim() || client.industry,
      city: editCity.trim() || client.city,
      state: editState.trim() || client.state,
      pan: editPan.trim().toUpperCase() || client.pan,
      gstin: editGstin.trim().toUpperCase() || client.gstin,
      gstScheme: editGstScheme,
      cin: editCin.trim() || undefined,
      tan: editTan.trim().toUpperCase() || undefined,
      contactName: editContactName.trim() || client.contactName,
      contactDesignation: editContactDesignation.trim() || client.contactDesignation,
      phone: editPhone.trim() || client.phone,
      email: editEmail.trim() || client.email,
      primaryOwner: editOwner,
      status: editStatus,
      billingFrequency: editBillingFreq,
      recurringFee: `₹${editRecurringFee.toLocaleString('en-IN')}`,
      notes: editNotes.trim(),
      bankStatementRequired: editBankStatementReq,
      hasBankAccount: editBankStatementReq,
    };

    if (onUpdateClient) {
      onUpdateClient(updatedClient);
    }
    setIsEditing(false);
  }

  const clientAssignments = useMemo(() => {
    return ASSIGNMENTS.filter(
      (a) =>
        a.client.toLowerCase().includes(client.tradeName.toLowerCase()) ||
        a.client.toLowerCase().includes(client.name.toLowerCase())
    );
  }, [client]);

  const clientSchedules = useMemo(() => {
    return schedules.filter((s) => s.clientId === client.id);
  }, [client, schedules]);

  const clientInvoices = useMemo(() => {
    return invoices.filter((i) => i.clientId === client.id);
  }, [invoices, client.id]);

  const clientReceipts = useMemo(() => {
    return receipts.filter((r) => r.clientId === client.id);
  }, [receipts, client.id]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="client-drawer" aria-label="Client details">
        <div className="client-drawer-header">
          <div className="drawer-client-lead">
            <span className="drawer-monogram">{client.name.substring(0, 2).toUpperCase()}</span>
            <div>
              <h2>{client.name}</h2>
              <p>{client.tradeName} · {client.type} · {client.city}, {client.state}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {canFullEdit ? (
              <button
                className="soft-button"
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                style={{ fontSize: 11, padding: '5px 12px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Pencil size={12} /> {isEditing ? 'Cancel Edit' : 'Edit Details'}
              </button>
            ) : null}
            <button className="drawer-close-btn" type="button" onClick={onClose} aria-label="Close drawer">
              <X aria-hidden="true" />
            </button>
          </div>
        </div>

        {!isEditing ? (
          <nav className="drawer-tabs">
            <button
              className={`drawer-tab ${tab === 'overview' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('overview')}
            >
              Overview
            </button>
            <button
              className={`drawer-tab ${tab === 'kyc' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('kyc')}
            >
              Registrations & KYC
            </button>
            <button
              className={`drawer-tab ${tab === 'schedules' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('schedules')}
            >
              Compliance Schedules ({clientSchedules.length})
            </button>
            <button
              className={`drawer-tab ${tab === 'work' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('work')}
            >
              Active Work ({clientAssignments.length})
            </button>
            <button
              className={`drawer-tab ${tab === 'billing' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('billing')}
            >
              Billing & Accounting Charges
            </button>
          </nav>
        ) : null}

        <div className="drawer-content">
          {isEditing ? (
            <form id="client-edit-form" onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'var(--canvas)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Edit Client Profile · {client.id}
                </span>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
                  Update statutory registrations, entity classification, staff assignment, and contact info.
                </p>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Entity &amp; Business Information</h4>
                <div className="form-grid">
                  <Field label="Legal Entity Name" full>
                    <input
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="e.g. Aster Foods Private Limited"
                    />
                  </Field>
                  <Field label="Trade Name / Brand">
                    <input
                      value={editTradeName}
                      onChange={(e) => setEditTradeName(e.target.value)}
                      placeholder="e.g. Aster Foods"
                    />
                  </Field>
                  <Field label="Entity Type">
                    <select
                      value={editType}
                      onChange={(e) => setEditType(e.target.value as ClientType)}
                    >
                      <option value="Private Limited">Private Limited</option>
                      <option value="LLP">LLP</option>
                      <option value="Proprietorship">Proprietorship</option>
                      <option value="Partnership">Partnership</option>
                      <option value="Public Limited">Public Limited</option>
                      <option value="Individual">Individual</option>
                    </select>
                  </Field>
                  <Field label="City">
                    <input
                      value={editCity}
                      onChange={(e) => setEditCity(e.target.value)}
                      placeholder="e.g. Mumbai"
                    />
                  </Field>
                  <Field label="State">
                    <input
                      value={editState}
                      onChange={(e) => setEditState(e.target.value)}
                      placeholder="e.g. Maharashtra"
                    />
                  </Field>
                  <Field label="Industry / Sector" full>
                    <input
                      value={editIndustry}
                      onChange={(e) => setEditIndustry(e.target.value)}
                      placeholder="e.g. FMCG & Food Processing"
                    />
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Statutory Registrations &amp; GST Scheme</h4>
                <div className="form-grid">
                  <Field label="PAN Number">
                    <input
                      required
                      maxLength={10}
                      value={editPan}
                      onChange={(e) => setEditPan(e.target.value.toUpperCase())}
                      style={{ textTransform: 'uppercase' }}
                    />
                  </Field>
                  <Field label="Primary GSTIN">
                    <input
                      maxLength={15}
                      value={editGstin}
                      onChange={(e) => setEditGstin(e.target.value.toUpperCase())}
                      style={{ textTransform: 'uppercase' }}
                    />
                  </Field>
                  <Field label="GST Registration Scheme" full>
                    <select
                      value={editGstScheme}
                      onChange={(e) => setEditGstScheme(e.target.value as any)}
                    >
                      <option value="Regular">Regular Scheme (Monthly GSTR-1 &amp; GSTR-3B)</option>
                      <option value="QRMP">QRMP Scheme (Quarterly Return, Monthly PMT-06)</option>
                      <option value="Composition">Composition Scheme (Quarterly CMP-08 &amp; GSTR-4)</option>
                      <option value="Unregistered">Unregistered / Exempt</option>
                    </select>
                  </Field>
                  <Field label="CIN (Corporate ID)">
                    <input
                      value={editCin}
                      onChange={(e) => setEditCin(e.target.value.toUpperCase())}
                      placeholder="e.g. U01111MH2021PTC123456"
                    />
                  </Field>
                  <Field label="TAN Number">
                    <input
                      value={editTan}
                      onChange={(e) => setEditTan(e.target.value.toUpperCase())}
                      placeholder="e.g. MUMA12345D"
                    />
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Relationship &amp; Commercials</h4>
                <div className="form-grid">
                  <Field label="Staff In-Charge">
                    <select
                      value={editOwner}
                      onChange={(e) => setEditOwner(e.target.value)}
                    >
                      <option value="S. Narayanan">S. Narayanan · Founder</option>
                      <option value="Ananya Rao">Ananya Rao · Manager</option>
                      <option value="Priya Desai">Priya Desai · Senior Staff</option>
                      <option value="Rohan Mehta">Rohan Mehta · Staff</option>
                    </select>
                  </Field>
                  <Field label="Relationship Status">
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as any)}
                    >
                      <option value="Active">Active</option>
                      <option value="Review required">Review required</option>
                      <option value="Suspended">Suspended</option>
                    </select>
                  </Field>
                  <Field label="Monthly Accounting Charges (₹)">
                    <input
                      type="number"
                      value={editRecurringFee}
                      onChange={(e) => setEditRecurringFee(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Billing Cadence">
                    <select
                      value={editBillingFreq}
                      onChange={(e) => setEditBillingFreq(e.target.value as any)}
                    >
                      <option value="Monthly">Monthly</option>
                      <option value="Quarterly">Quarterly</option>
                      <option value="Annual">Annual</option>
                    </select>
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Primary Contact</h4>
                <div className="form-grid">
                  <Field label="Contact Person Name">
                    <input
                      value={editContactName}
                      onChange={(e) => setEditContactName(e.target.value)}
                      placeholder="e.g. Rajesh Kumar"
                    />
                  </Field>
                  <Field label="Designation">
                    <input
                      value={editContactDesignation}
                      onChange={(e) => setEditContactDesignation(e.target.value)}
                      placeholder="e.g. Chief Financial Officer"
                    />
                  </Field>
                  <Field label="Mobile / WhatsApp">
                    <input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="e.g. +91 98200 12345"
                    />
                  </Field>
                  <Field label="Email Address">
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      placeholder="e.g. rajesh@asterfoods.in"
                    />
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 6 }}>Banking &amp; GST Reconciliation</h4>
                <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-muted)' }}>
                  Some clients do not operate through bank accounts or file cash-only returns. Setting this to "No" marks bank reconciliation as Not Applicable on GST filings.
                </p>
                <div className="form-grid">
                  <Field label="Bank Statement Required for GST Return Filing?" full>
                    <select
                      value={editBankStatementReq ? 'yes' : 'no'}
                      onChange={(e) => setEditBankStatementReq(e.target.value === 'yes')}
                    >
                      <option value="yes">Yes — Mandatory bank statement &amp; reconciliation before filing</option>
                      <option value="no">No — Not Applicable (Client has no bank operations / cash-only filing)</option>
                    </select>
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Engagement Notes</h4>
                <textarea
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Internal audit notes, client billing terms, or special compliance instructions"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
                />
              </div>
            </form>
          ) : (
            <>
          {tab === 'overview' ? (
            <>
              <div className="drawer-card">
                <h4>Primary Contact</h4>
                <div className="drawer-grid">
                  <div className="drawer-item">
                    <span className="drawer-label">Contact Person</span>
                    <span className="drawer-val">{client.contactName}</span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Designation</span>
                    <span className="drawer-val">{client.contactDesignation}</span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Mobile</span>
                    <span className="drawer-val">{client.phone}</span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Email</span>
                    <span className="drawer-val">{client.email}</span>
                  </div>
                </div>
                <div className="drawer-contact-actions">
                  <a className="contact-action-btn" href={`tel:${client.phone}`}>
                    <Phone size={12} /> Call
                  </a>
                  <a className="contact-action-btn" href={`mailto:${client.email}`}>
                    <Mail size={12} /> Email
                  </a>
                </div>
              </div>

              {/* Banking Status & GST Return Workflow Toggle Card (Editable by Staff & Leadership) */}
              <div className="drawer-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Building2 size={15} color="var(--brand)" />
                      Banking Operations &amp; GST Return Workflow
                    </h4>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.4 }}>
                      {client.bankStatementRequired === false
                        ? 'Client operates without bank accounts (cash-only). Bank statement collection and reconciliation are excluded from the GST return filing workflow.'
                        : 'Client operates active bank account(s). Bank statement receipt and bank reconciliation are active steps in monthly GST compliance.'}
                    </p>
                  </div>
                  <span
                    className="filing-chip"
                    style={{
                      whiteSpace: 'nowrap',
                      background: client.bankStatementRequired === false ? 'var(--canvas)' : '#ecfdf5',
                      color: client.bankStatementRequired === false ? 'var(--ink-muted)' : '#059669',
                      border: `1px solid ${client.bankStatementRequired === false ? 'var(--border)' : '#a7f3d0'}`,
                      fontWeight: 600,
                      padding: '3px 10px',
                      borderRadius: 12,
                      fontSize: 11,
                    }}
                  >
                    {client.bankStatementRequired === false ? '— No Bank (Excluded)' : '✓ Active Bank'}
                  </span>
                </div>

                {role !== 'trainee' ? (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                      {role === 'staff' || role === 'senior_staff' ? 'Staff banking toggle (fieldwork scope):' : 'Banking status toggle:'}
                    </span>
                    <button
                      type="button"
                      className={client.bankStatementRequired === false ? 'primary-button' : 'soft-button'}
                      style={{ fontSize: 11, padding: '5px 12px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      onClick={() => {
                        const nextVal = client.bankStatementRequired === false ? true : false;
                        const updatedClient: ClientRecord = {
                          ...client,
                          bankStatementRequired: nextVal,
                          hasBankAccount: nextVal,
                        };
                        if (onUpdateClient) onUpdateClient(updatedClient);
                        onToast(
                          nextVal
                            ? `Enabled bank operations for ${client.tradeName}. Added banking steps to GST filing workflow.`
                            : `Set ${client.tradeName} to No Bank. Banking steps excluded from GST return filing workflow.`
                        );
                      }}
                    >
                      <Building2 size={12} />
                      {client.bankStatementRequired === false ? 'Enable Active Bank & Workflow' : 'Toggle to No Bank (Exclude Banking)'}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="drawer-grid">
                <div className="drawer-item">
                  <span className="drawer-label">Industry</span>
                  <span className="drawer-val">{client.industry}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Relationship Manager</span>
                  <span className="drawer-val">{client.primaryOwner}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Bank Rec for GST</span>
                  <span className="drawer-val">
                    {client.bankStatementRequired === false ? (
                      <span className="category-tag" style={{ background: '#f1f5f9', color: '#64748b', padding: '2px 8px' }}>
                        Excluded from Workflow (No Bank)
                      </span>
                    ) : (
                      <span style={{ color: '#01b574', fontWeight: 600 }}>Required (Standard)</span>
                    )}
                  </span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Compliance Status</span>
                  <span className="drawer-val">{client.status}</span>
                </div>
                <div className="drawer-item full-width">
                  <span className="drawer-label">Internal Practice Notes</span>
                  <span className="drawer-val" style={{ fontWeight: 400, color: 'var(--ink)' }}>{client.notes}</span>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'kyc' ? (
            <div className="drawer-grid">
              <div className="drawer-item full-width">
                <span className="drawer-label">Permanent Account Number (PAN)</span>
                <span className="tax-id-chip" style={{ fontSize: 13, alignSelf: 'flex-start', padding: '4px 8px' }}>
                  {client.pan}
                </span>
              </div>
              <div className="drawer-item full-width">
                <span className="drawer-label">Primary Goods & Services Tax ID (GSTIN)</span>
                <span className="tax-id-chip" style={{ fontSize: 13, alignSelf: 'flex-start', padding: '4px 8px' }}>
                  {client.gstin}
                </span>
              </div>
              {client.cin ? (
                <div className="drawer-item full-width">
                  <span className="drawer-label">Corporate Identification Number (CIN)</span>
                  <span className="tax-id-chip" style={{ fontSize: 12, alignSelf: 'flex-start', padding: '4px 8px' }}>
                    {client.cin}
                  </span>
                </div>
              ) : null}
              {client.tan ? (
                <div className="drawer-item full-width">
                  <span className="drawer-label">Tax Deduction Account Number (TAN)</span>
                  <span className="tax-id-chip" style={{ fontSize: 12, alignSelf: 'flex-start', padding: '4px 8px' }}>
                    {client.tan}
                  </span>
                </div>
              ) : null}
              <div className="drawer-item">
                <span className="drawer-label">State Jurisdiction</span>
                <span className="drawer-val">{client.state}</span>
              </div>
              <div className="drawer-item">
                <span className="drawer-label">GST Filing Scheme</span>
                <span className="drawer-val" style={{ fontWeight: 600, color: 'var(--brand)' }}>
                  {client.gstScheme === 'Composition'
                    ? 'Composition Scheme (Quarterly CMP-08)'
                    : client.gstScheme === 'QRMP'
                    ? 'QRMP Scheme (Quarterly Return, Monthly Payment)'
                    : 'Regular Scheme (Monthly GSTR-1 & 3B)'}
                </span>
              </div>
            </div>
          ) : null}

          {tab === 'schedules' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-strong)' }}>
                  Assigned Compliance Mandates ({clientSchedules.length})
                </span>
                {leadership ? (
                  <button
                    className="soft-button"
                    type="button"
                    style={{ fontSize: 11, padding: '4px 10px' }}
                    onClick={() => onCompose('schedule')}
                  >
                    <Plus size={12} /> Add schedule
                  </button>
                ) : null}
              </div>

              {clientSchedules.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  No standing compliance schedules configured for this client yet.
                </p>
              ) : (
                clientSchedules.map((s) => (
                  <div key={s.id} className="drawer-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <strong style={{ fontSize: 13, color: 'var(--ink-strong)' }}>{s.title}</strong>
                          <span className={`category-tag cat-${s.category.toLowerCase().replace(/[^a-z]/g, '')}`}>{s.category}</span>
                        </div>
                        <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>
                          {s.cadence} · Due: {s.statutoryDueDay}
                        </p>
                      </div>
                      <span className={`filing-chip ${
                        s.currentStatus === 'Ready to File'
                          ? 'is-ready'
                          : s.currentStatus === 'Docs Awaited'
                          ? 'is-awaited'
                          : s.currentStatus === 'Bank Statement Received' || s.currentStatus === 'Filed'
                          ? 'is-done'
                          : 'is-pending'
                      }`}>
                        {s.currentStatus || 'Active'}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, background: 'var(--canvas)', padding: 10, borderRadius: 10, fontSize: 11 }}>
                      <div>
                        <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: 10 }}>Staff In-Charge</span>
                        <strong style={{ color: 'var(--ink-strong)' }}>{s.defaultOwner}</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: 10 }}>Bank Reconciliation</span>
                        <span style={{ fontWeight: 600, color: s.bankRecStatus === 'Completed' ? 'var(--success)' : s.bankRecStatus === 'In progress' ? '#b45309' : s.bankRecStatus === 'Awaited' ? '#2563eb' : 'var(--ink)' }}>
                          {s.bankRecStatus === 'Completed' ? '✓ Reconciled' : s.bankRecStatus === 'In progress' ? '⏳ In progress' : s.bankRecStatus === 'Awaited' ? '⚠️ Statement Awaited' : '—'}
                        </span>
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Checklist Steps ({s.checklistTemplate.length})
                      </span>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 11, color: 'var(--ink)' }}>
                        {s.checklistTemplate.map((step, idx) => (
                          <li key={idx} style={{ marginBottom: 3 }}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === 'work' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {clientAssignments.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No assignments currently linked to this client.</p>
              ) : (
                clientAssignments.map((a) => (
                  <div key={a.id} className="drawer-card" style={{ padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <strong style={{ fontSize: 13, color: 'var(--ink-strong)' }}>{a.title}</strong>
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>{a.service} · Due {a.due}</p>
                      </div>
                      <Status tone={a.tone}>{a.status}</Status>
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, color: 'var(--ink-muted)', width: 45 }}>{a.progress}%</span>
                      <i style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', display: 'block' }}>
                        <b style={{ width: `${a.progress}%`, height: '100%', background: 'var(--brand)', display: 'block' }} />
                      </i>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === 'billing' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="drawer-grid">
                <div className="drawer-item">
                  <span className="drawer-label">Accounting Charges</span>
                  <span className="drawer-val" style={{ fontSize: 16 }}>{client.recurringFee}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Billing Cadence</span>
                  <span className="drawer-val">{client.billingFrequency}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Current Outstanding</span>
                  <span className={`drawer-val tone-${client.outstandingTone}`} style={{ fontSize: 16 }}>
                    {client.outstanding}
                  </span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Aging</span>
                  <span className="drawer-val">{client.outstandingAge}</span>
                </div>
              </div>

              {/* Invoices List */}
              <div className="drawer-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileText size={14} color="var(--brand)" />
                    <strong style={{ fontSize: 12, color: 'var(--ink-strong)' }}>
                      Tax Invoices ({clientInvoices.length})
                    </strong>
                  </div>
                  {leadership ? (
                    <button
                      className="soft-button"
                      type="button"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => {
                        onClose();
                        onCompose('invoice');
                      }}
                    >
                      <Plus size={12} /> Raise invoice
                    </button>
                  ) : null}
                </div>

                {clientInvoices.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>
                    No tax invoices issued for this client yet.
                  </p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Invoice #</th>
                          <th>Date</th>
                          <th>Description</th>
                          <th>Total</th>
                          <th>Balance</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientInvoices.map((inv) => (
                          <tr key={inv.id}>
                            <td>
                              <strong style={{ fontSize: 11, color: 'var(--ink-strong)' }}>{inv.invoiceNumber}</strong>
                            </td>
                            <td><span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{inv.invoiceDate}</span></td>
                            <td><span style={{ fontSize: 11 }}>{inv.description}</span></td>
                            <td><strong style={{ fontSize: 11 }}>{formatINR(inv.total)}</strong></td>
                            <td>
                              <span style={{ fontSize: 11, fontWeight: inv.balance > 0 ? 600 : 400, color: inv.balance > 0 ? '#ee5d50' : 'var(--ink-muted)' }}>
                                {formatINR(inv.balance)}
                              </span>
                            </td>
                            <td>
                              <span className={`invoice-chip is-${inv.status.toLowerCase().replace(/[^a-z]/g, '')}`} style={{ fontSize: 10 }}>
                                {inv.status}
                              </span>
                            </td>
                            <td>
                              {inv.balance > 0 ? (
                                <button
                                  className="primary-button"
                                  type="button"
                                  style={{ fontSize: 10, padding: '3px 8px', whiteSpace: 'nowrap' }}
                                  onClick={() => {
                                    onClose();
                                    onRecordPaymentForInvoice(inv);
                                  }}
                                >
                                  Record Receipt
                                </button>
                              ) : (
                                <span style={{ fontSize: 11, color: '#01b574', fontWeight: 600 }}>Settled</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Receipts & Payments Register */}
              <div className="drawer-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ReceiptIndianRupee size={14} color="#01b574" />
                    <strong style={{ fontSize: 12, color: 'var(--ink-strong)' }}>
                      Payment Receipts ({clientReceipts.length})
                    </strong>
                  </div>
                  <button
                    className="soft-button"
                    type="button"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => {
                      onClose();
                      const openInv = clientInvoices.find((i) => i.balance > 0);
                      if (openInv) onRecordPaymentForInvoice(openInv);
                      else onCompose('receipt');
                    }}
                  >
                    <Plus size={12} /> Record Receipt
                  </button>
                </div>

                {clientReceipts.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>
                    No payment receipts recorded for this FY yet.
                  </p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Receipt #</th>
                          <th>Date</th>
                          <th>Mode</th>
                          <th>Bank Ref / UTR</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientReceipts.map((rec) => (
                          <tr key={rec.id}>
                            <td>
                              <strong style={{ fontSize: 11, color: 'var(--ink-strong)' }}>{rec.receiptNumber}</strong>
                            </td>
                            <td><span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{rec.receiptDate}</span></td>
                            <td>
                              <span className="category-tag cat-gst" style={{ fontSize: 9, padding: '2px 6px' }}>
                                {rec.paymentMode}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--ink)' }}>
                                {rec.referenceNumber}
                              </span>
                            </td>
                            <td>
                              <strong style={{ fontSize: 11, color: '#01b574' }}>{formatINR(rec.amount)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}
            </>
          )}
        </div>

        <div className="drawer-footer">
          {isEditing ? (
            <>
              <button
                className="soft-button"
                type="button"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                form="client-edit-form"
                onClick={() => handleSave()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Check size={14} /> Save Changes
              </button>
            </>
          ) : (
            <>
              {leadership ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    onClose();
                    onCompose('assignment');
                  }}
                >
                  <Plus size={14} /> New assignment
                </button>
              ) : null}
              <button
                className="soft-button"
                type="button"
                onClick={() => {
                  onClose();
                  onToast(`Document request notice issued to ${client.tradeName}`);
                }}
              >
                <Files size={14} /> Request docs
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
