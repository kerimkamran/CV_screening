import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Principal } from '../auth/principal';
import type { Breakdown } from './score';

export interface CandidateRow {
  screeningId: string | null;
  documentId: string;
  filename: string;
  uploadedAt: string;
  parseStatus: string;
  candidateName: string | null;
  state: string;
  band: string | null;
  erased: boolean;
  score: { value: number; breakdown: Breakdown } | null;
  knockoutTriggered: boolean | null;
  injectionSuspected: boolean | null;
  error: string | null;
  decision: { outcome: string; reason: string; decidedAt: string; decidedBy: string } | null;
  /** Set when the recruiter's requirement changes were applied to this score (spec 6.2.5). */
  /** 1-based upload order within the vacancy; the pseudonym "Candidate NN" is built from it. */
  ordinal?: number;
  adjusted?: boolean;
  originalScore?: number | null;
}
type Row = CandidateRow;

/** Spreadsheet cells that start with = + - @ are executed by Excel; neutralise them. */
const safe = (v: unknown) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

@Injectable()
export class ExportService {
  async build(title: string, vacancyId: string, rows: Row[], by: Principal): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const reqs: { id: string; text: string }[] = [];
    for (const r of rows) {
      for (const i of r.score?.breakdown.items ?? []) {
        if (!reqs.some((x) => x.id === i.requirementId))
          reqs.push({ id: i.requirementId, text: i.text });
      }
    }
    const ws = wb.addWorksheet('Candidates');
    ws.columns = [
      { header: 'Candidate (AI-extracted)', key: 'name', width: 28 },
      { header: 'File', key: 'file', width: 30 },
      { header: 'Score (0-100)', key: 'score', width: 14 },
      { header: 'AI band (sorting aid)', key: 'band', width: 20 },
      { header: 'Needs review: knockout', key: 'ko', width: 20 },
      { header: 'Needs review: suspicious text', key: 'inj', width: 24 },
      { header: 'Mandatory gaps', key: 'gaps', width: 16 },
      { header: 'Human decision', key: 'decision', width: 16 },
      { header: 'Decision reason', key: 'reason', width: 40 },
      { header: 'Decided by', key: 'by', width: 22 },
      { header: 'Decided at', key: 'at', width: 22 },
      ...reqs.map((q, i) => ({ header: `R${i + 1}`, key: q.id, width: 14 })),
    ];
    for (const r of rows) {
      const statusById = new Map(
        (r.score?.breakdown.items ?? []).map((i) => [i.requirementId, i.status]),
      );
      ws.addRow({
        name: safe(r.erased ? '(erased)' : (r.candidateName ?? '')),
        file: safe(r.erased ? '(erased)' : r.filename),
        score: r.score?.value ?? '',
        band: r.band ?? r.state,
        ko: r.knockoutTriggered ? 'yes' : '',
        inj: r.injectionSuspected ? 'yes' : '',
        gaps: r.score?.breakdown.mandatoryGaps ?? '',
        decision: r.decision?.outcome ?? 'undecided',
        reason: safe(r.decision?.reason ?? ''),
        by: safe(r.decision?.decidedBy ?? ''),
        at: r.decision?.decidedAt ? new Date(r.decision.decidedAt).toISOString() : '',
        ...Object.fromEntries(reqs.map((q) => [q.id, statusById.get(q.id) ?? ''])),
      });
    }
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const legend = wb.addWorksheet('Criteria and notes');
    legend.columns = [
      { header: 'Column', key: 'k', width: 10 },
      { header: 'Criterion', key: 'v', width: 100 },
    ];
    reqs.forEach((q, i) => legend.addRow({ k: `R${i + 1}`, v: safe(q.text) }));
    legend.addRow({});
    for (const line of [
      `Vacancy: ${title} (${vacancyId})`,
      `Exported by ${by.displayName ?? by.email ?? by.userId} at ${new Date().toISOString()}`,
      'Scores and bands are AI-assisted recommendations for sorting. They are not decisions.',
      'Every shortlist, hold or reject decision is made and recorded by a named human reviewer.',
      'Score = 100 × Σ(weight × points) ÷ Σ(weight); met 1, partially met 0.5, otherwise 0.',
      '"not_found" means the CV says nothing about the criterion; it is not the same as "not_met".',
    ])
      legend.addRow({ k: '', v: line });
    legend.getRow(1).font = { bold: true };

    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
