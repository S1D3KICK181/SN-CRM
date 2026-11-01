import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { AssignmentTone } from '../data';

export function Card({ title, description, action, children, className = '' }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function MoreButton({ label = 'More options' }: { label?: string }) {
  return (
    <button className="card-menu" type="button" aria-label={label}>
      <MoreHorizontal aria-hidden="true" />
    </button>
  );
}

export function Status({ tone = 'default', children }: { tone?: AssignmentTone; children: ReactNode }) {
  return <span className={`status tone-${tone}`}>{children}</span>;
}

export function Field({ label, children, full = false, hint }: { label: string; children: ReactNode; full?: boolean; hint?: string }) {
  return <label className={full ? 'field is-full' : 'field'}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
