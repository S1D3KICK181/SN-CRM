import { ChevronRight, Pencil } from 'lucide-react';
import type { PageKey } from '../../shell/navigation';
import { Card, Status } from '../../ui/workspace-primitives';
import type { AssignmentRow } from '../../data';
import { isValidUuid } from '../../api/metadata-safety';
import { SlaChip } from './sla-chip';

export function AssignmentsTable({
  title,
  rows,
  onToast,
  onSelectAssignment,
  onNavigate,
  compact = false,
  canEdit = false,
}: {
  title: string;
  rows: AssignmentRow[];
  onToast: (message: string) => void;
  onSelectAssignment?: (assignment: AssignmentRow) => void;
  onNavigate?: (page: PageKey) => void;
  compact?: boolean;
  canEdit?: boolean;
}) {
  return (
    <Card
      title={title}
      description="Sorted by deadline, statutory risk, and dependency"
      className={`table-card ${compact ? 'is-compact' : ''}`}
      action={
        <button
          className="text-button"
          type="button"
          onClick={() => (onNavigate ? onNavigate('Assignments') : onToast('Assignments workspace opened'))}
        >
          View all <ChevronRight aria-hidden="true" />
        </button>
      }
    >
      <div className="table-scroll">
        <table className="assignments-table">
          <thead><tr><th>Assignment</th><th>Client</th><th>Due</th><th>Status</th><th>SLA</th><th>Progress</th><th>Owner</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const displayCode = row.code && !isValidUuid(row.code)
                ? row.code
                : !isValidUuid(row.id)
                ? row.id
                : undefined;
              const rowActionName = displayCode || row.title;
              return (
                <tr key={row.id}>
                  <td>
                    <button
                      className="assignment-link"
                      type="button"
                      title={row.title}
                      onClick={() => {
                        if (onSelectAssignment) onSelectAssignment(row);
                        else onToast(displayCode ? `${displayCode} opened` : `"${row.title}" opened`);
                      }}
                    >
                      <strong>{row.title}</strong>
                      <small>{displayCode ? `${displayCode} · ` : ''}{row.service}</small>
                    </button>
                  </td>
                  <td>{row.client}</td>
                  <td className={row.due === 'Today' ? 'is-danger-text' : ''}>{row.due}</td>
                  <td><Status tone={row.tone}>{row.status}</Status></td>
                  <td>{row.status === 'Cancelled' ? '—' : <SlaChip sla={row.sla} />}</td>
                  <td><div className="table-progress"><i><b style={{ width: `${row.progress}%` }} /></i><span>{row.progress}%</span></div></td>
                  <td>{row.owner}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button
                        className="row-button"
                        type="button"
                        aria-label={`Open ${rowActionName}`}
                        onClick={() => {
                          if (onSelectAssignment) onSelectAssignment(row);
                          else onToast(displayCode ? `${displayCode} details opened` : `"${row.title}" details opened`);
                        }}
                      >
                        <ChevronRight aria-hidden="true" />
                      </button>
                      {canEdit && onSelectAssignment ? (
                        <button
                          className="icon-button"
                          type="button"
                          title={`Edit ${rowActionName}`}
                          aria-label={`Edit ${rowActionName}`}
                          style={{ width: 26, height: 26 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAssignment(row);
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
  );
}
