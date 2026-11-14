import type { ReportPeriodDto } from '@sn/contracts';

/** A CSV cell: text, a plain number, or empty. Money is passed as text from formatCsvRupees. */
export type CsvCell = string | number | null;

/** A byte order mark at the start tells Excel the file is UTF-8, so names and symbols show correctly. */
const BYTE_ORDER_MARK = '﻿';

/** One field, quoted only when it holds a comma, a quote or a line break (RFC 4180); quotes are doubled. */
export function csvField(cell: CsvCell): string {
  if (cell === null) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  const text = neutraliseFormula(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Excel runs text starting with = + - @ (or a tab or carriage return) as a formula. A leading apostrophe
 * makes it plain text. Plain numbers such as money ("1234.50", "-12.00") are left alone so they stay numbers.
 */
function neutraliseFormula(text: string): string {
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** The whole file: a byte order mark, the header row and the data rows, each ending in CRLF. */
export function buildCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(','));
  return `${BYTE_ORDER_MARK}${lines.join('\r\n')}\r\n`;
}

/** Integer paise as rupees with two decimals, no symbol and no thousands separators. */
export function formatCsvRupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(paise));
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

const kolkataDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** A YYYY-MM-DD date or an ISO timestamp (read on the Asia/Kolkata calendar) as DD/MM/YYYY; empty when unreadable. */
export function formatCsvDate(value: string): string {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) return `${plain[3]}/${plain[2]}/${plain[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : kolkataDateFormatter.format(date);
}

/** `<report>-<table>_<period start>.csv`; a month is stamped with its year and month, a day or week with its first date. */
export function csvFileName(report: string, table: string, period: Pick<ReportPeriodDto, 'kind' | 'start'>): string {
  const stamp = period.kind === 'month' ? period.start.slice(0, 7) : period.start;
  return `${report}-${table}_${stamp}.csv`;
}

/** Hands the file to the browser through a Blob and a temporary link. */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
