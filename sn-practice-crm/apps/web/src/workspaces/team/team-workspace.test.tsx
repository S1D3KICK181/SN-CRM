// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReportingLineDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { DeterministicTestTeamDirectoryAdapter } from '../../api/test-team-directory-adapter';
import { TeamDirectoryOperationError } from '../../api/team-directory-types';
import { TeamWorkspace, getEmployeeInitials } from './team-workspace';

describe('TeamWorkspace component', () => {
  afterEach(() => {
    cleanup();
  });

  const founderLine: ReportingLineDto = {
    employee: {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'S. Narayanan',
      role: 'founder',
      reportsToId: null,
    },
    manager: null,
  };

  const managerLine: ReportingLineDto = {
    employee: {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'Ananya Rao',
      role: 'manager',
      reportsToId: '00000000-0000-4000-a000-000000000001',
    },
    manager: {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'S. Narayanan',
      role: 'founder',
      reportsToId: null,
    },
  };

  const seniorStaffLine: ReportingLineDto = {
    employee: {
      id: '00000000-0000-4000-a000-000000000003',
      name: 'Priya Desai',
      role: 'senior_staff',
      reportsToId: '00000000-0000-4000-a000-000000000002',
    },
    manager: {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'Ananya Rao',
      role: 'manager',
      reportsToId: '00000000-0000-4000-a000-000000000001',
    },
  };

  const staffLine: ReportingLineDto = {
    employee: {
      id: '00000000-0000-4000-a000-000000000004',
      name: 'Rohan Mehta',
      role: 'staff',
      reportsToId: '00000000-0000-4000-a000-000000000002',
    },
    manager: {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'Ananya Rao',
      role: 'manager',
      reportsToId: '00000000-0000-4000-a000-000000000001',
    },
  };

  const traineeLine: ReportingLineDto = {
    employee: {
      id: '00000000-0000-4000-a000-000000000005',
      name: 'Neha Kapoor',
      role: 'trainee',
      reportsToId: '00000000-0000-4000-a000-000000000002',
    },
    manager: {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'Ananya Rao',
      role: 'manager',
      reportsToId: '00000000-0000-4000-a000-000000000001',
    },
  };

  const standardLines = [founderLine, managerLine, seniorStaffLine, staffLine, traineeLine];

  describe('getEmployeeInitials helper', () => {
    it('correctly handles various name patterns', () => {
      expect(getEmployeeInitials('S. Narayanan')).toBe('SN');
      expect(getEmployeeInitials('Ananya Rao')).toBe('AR');
      expect(getEmployeeInitials('Priya Desai')).toBe('PD');
      expect(getEmployeeInitials('Rohan Mehta')).toBe('RM');
      expect(getEmployeeInitials('Neha Kapoor')).toBe('NK');
      expect(getEmployeeInitials('Priya')).toBe('PR');
      expect(getEmployeeInitials('')).toBe('??');
    });
  });

  it('renders live reporting structure with founder and reporting branches', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', standardLines);

    render(<TeamWorkspace role="founder" port={port} />);

    // Initially or upon resolve
    await waitFor(() => {
      expect(screen.getByTestId('team-tree-content')).toBeTruthy();
    });

    // Check Founder block
    const founderEl = screen.getByTestId(`employee-${founderLine.employee.id}`);
    expect(founderEl).toBeTruthy();
    expect(founderEl.textContent).toContain('SN');
    expect(founderEl.textContent).toContain('S. Narayanan');
    expect(founderEl.textContent).toContain('Founder');

    // Check Manager block
    const managerEl = screen.getByTestId(`employee-${managerLine.employee.id}`);
    expect(managerEl).toBeTruthy();
    expect(managerEl.textContent).toContain('AR');
    expect(managerEl.textContent).toContain('Ananya Rao');
    expect(managerEl.textContent).toContain('Manager · reports to S. Narayanan');

    // Check Staff block
    const staffEl = screen.getByTestId(`employee-${staffLine.employee.id}`);
    expect(staffEl).toBeTruthy();
    expect(staffEl.textContent).toContain('RM');
    expect(staffEl.textContent).toContain('Rohan Mehta');
    expect(staffEl.textContent).toContain('Staff · reports to Ananya Rao');

    // Check Trainee block
    const traineeEl = screen.getByTestId(`employee-${traineeLine.employee.id}`);
    expect(traineeEl).toBeTruthy();
    expect(traineeEl.textContent).toContain('NK');
    expect(traineeEl.textContent).toContain('Neha Kapoor');
    expect(traineeEl.textContent).toContain('Trainee · reports to Ananya Rao');

    // Check Authority guardrails card
    expect(screen.getByText('Authority guardrails')).toBeTruthy();
    expect(
      screen.getByText('Visible while previewing as Founder')
    ).toBeTruthy();
  });

  it('renders loading state initially while fetching reporting lines', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    let resolveDeferred!: (lines: ReportingLineDto[]) => void;
    const deferredPromise = new Promise<ReportingLineDto[]>((res) => {
      resolveDeferred = res;
    });
    port.setDeferredList('founder', deferredPromise);

    render(<TeamWorkspace role="founder" port={port} />);

    expect(screen.getByTestId('team-loading-state')).toBeTruthy();
    expect(screen.getByLabelText('Loading reporting structure')).toBeTruthy();

    // Resolve deferred
    resolveDeferred(standardLines);

    await waitFor(() => {
      expect(screen.queryByTestId('team-loading-state')).toBeNull();
      expect(screen.getByTestId('team-tree-content')).toBeTruthy();
    });
  });

  it('renders error state and allows retry on network failure', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setListError(
      'founder',
      new TeamDirectoryOperationError({
        code: 'unexpected',
        message: 'Failed to load team directory',
      })
    );

    render(<TeamWorkspace role="founder" port={port} />);

    await waitFor(() => {
      expect(screen.getByTestId('team-error-state')).toBeTruthy();
    });

    expect(screen.getByText('An unexpected error occurred while loading the team directory. Please try again.')).toBeTruthy();
    const retryBtn = screen.getByTestId('team-retry-button');
    expect(retryBtn).toBeTruthy();

    // Now configure success and click retry
    port.clearListError('founder');
    port.setReportingLinesResponse('founder', standardLines);
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('team-error-state')).toBeNull();
      expect(screen.getByTestId('team-tree-content')).toBeTruthy();
    });
  });

  it('renders empty state when zero reporting lines exist', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', []);

    render(<TeamWorkspace role="founder" port={port} />);

    await waitFor(() => {
      expect(screen.getByTestId('team-empty-state')).toBeTruthy();
    });

    expect(
      screen.getByText('No reporting lines recorded in the employee directory.')
    ).toBeTruthy();
  });

  it('updates dynamic preview role in authority guardrails when role changes', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', standardLines);
    port.setReportingLinesResponse('trainee', standardLines);

    const { rerender } = render(<TeamWorkspace role="founder" port={port} />);

    await waitFor(() => {
      expect(
        screen.getByText('Visible while previewing as Founder')
      ).toBeTruthy();
    });

    rerender(<TeamWorkspace role="trainee" port={port} />);

    expect(
      screen.getByText('Visible while previewing as Trainee')
    ).toBeTruthy();
  });

  it('renders nested DOM hierarchy with reportees grouped strictly under their manager branch', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', standardLines);

    render(<TeamWorkspace role="founder" port={port} />);

    await waitFor(() => {
      expect(screen.getByTestId('team-tree-content')).toBeTruthy();
    });

    const managerReportsContainer = screen.getByTestId(`manager-reports-${managerLine.employee.id}`);
    expect(managerReportsContainer).toBeTruthy();

    // Verify all 3 reportees are DOM descendants of the manager branch
    const seniorStaffEl = screen.getByTestId(`employee-${seniorStaffLine.employee.id}`);
    const staffEl = screen.getByTestId(`employee-${staffLine.employee.id}`);
    const traineeEl = screen.getByTestId(`employee-${traineeLine.employee.id}`);

    expect(managerReportsContainer.contains(seniorStaffEl)).toBe(true);
    expect(managerReportsContainer.contains(staffEl)).toBe(true);
    expect(managerReportsContainer.contains(traineeEl)).toBe(true);
  });

  it('correctly handles multiple managers, direct-to-founder non-managers, and orphan employees without dropping any records', async () => {
    const manager2Line: ReportingLineDto = {
      employee: {
        id: '00000000-0000-4000-a000-000000000010',
        name: 'Karthik Subramanian',
        role: 'manager',
        reportsToId: founderLine.employee.id,
      },
      manager: founderLine.employee,
    };

    const manager2Report: ReportingLineDto = {
      employee: {
        id: '00000000-0000-4000-a000-000000000011',
        name: 'Deepa Krishnan',
        role: 'staff',
        reportsToId: manager2Line.employee.id,
      },
      manager: manager2Line.employee,
    };

    const directToFounderNonManager: ReportingLineDto = {
      employee: {
        id: '00000000-0000-4000-a000-000000000012',
        name: 'Specialist Advisor',
        role: 'senior_staff',
        reportsToId: founderLine.employee.id,
      },
      manager: founderLine.employee,
    };

    const orphanEmployee: ReportingLineDto = {
      employee: {
        id: '00000000-0000-4000-a000-000000000099',
        name: 'External Contractor',
        role: 'staff',
        reportsToId: null,
      },
      manager: null,
    };

    const complexLines = [
      founderLine,
      managerLine,
      seniorStaffLine,
      manager2Line,
      manager2Report,
      directToFounderNonManager,
      orphanEmployee,
    ];

    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', complexLines);

    render(<TeamWorkspace role="founder" port={port} />);

    await waitFor(() => {
      expect(screen.getByTestId('team-tree-content')).toBeTruthy();
    });

    // 1. Both manager branches exist
    expect(screen.getByTestId(`manager-branch-${managerLine.employee.id}`)).toBeTruthy();
    expect(screen.getByTestId(`manager-branch-${manager2Line.employee.id}`)).toBeTruthy();

    // 2. Manager 2 report is inside manager 2's subbranch
    const m2ReportsContainer = screen.getByTestId(`manager-reports-${manager2Line.employee.id}`);
    const m2ReportEl = screen.getByTestId(`employee-${manager2Report.employee.id}`);
    expect(m2ReportsContainer.contains(m2ReportEl)).toBe(true);

    // 3. Direct to founder branch exists and contains the specialist
    const founderDirectContainer = screen.getByTestId('founder-direct-branch');
    const directEl = screen.getByTestId(`employee-${directToFounderNonManager.employee.id}`);
    expect(founderDirectContainer.contains(directEl)).toBe(true);

    // 4. Orphan branch exists and contains the unlinked employee
    const orphanContainer = screen.getByTestId('orphan-branch');
    const orphanEl = screen.getByTestId(`employee-${orphanEmployee.employee.id}`);
    expect(orphanContainer.contains(orphanEl)).toBe(true);

    // 5. Total employee nodes rendered matches all 7 lines (0 dropped)
    for (const line of complexLines) {
      expect(screen.getByTestId(`employee-${line.employee.id}`)).toBeTruthy();
    }
  });

  it('resolves conflicting manager metadata deterministically and renders each employee exactly once', async () => {
    const managerA: ReportingLineDto = {
      employee: {
        id: '00000000-0000-4000-a000-000000000002',
        name: 'Ananya Rao',
        role: 'manager',
        reportsToId: founderLine.employee.id,
      },
      manager: founderLine.employee,
    };

    const managerB: ReportingLineDto = {
      employee: {
        id: '00000000-0000-4000-a000-000000000010',
        name: 'Karthik Subramanian',
        role: 'manager',
        reportsToId: founderLine.employee.id,
      },
      manager: founderLine.employee,
    };

    // Conflicting metadata: employee reportsToId points to managerA, but line.manager metadata points to managerB
    const conflictedEmployee: ReportingLineDto = {
      employee: {
        id: '00000000-0000-4000-a000-000000000033',
        name: 'Conflicted Staff',
        role: 'staff',
        reportsToId: managerA.employee.id, // Authoritative!
      },
      manager: managerB.employee, // Inconsistent fallback metadata
    };

    // Duplicate entry in the same payload
    const duplicateConflicted: ReportingLineDto = {
      ...conflictedEmployee,
    };

    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', [
      founderLine,
      managerA,
      managerB,
      conflictedEmployee,
      duplicateConflicted,
    ]);

    render(<TeamWorkspace role="founder" port={port} />);

    await waitFor(() => {
      expect(screen.getByTestId('team-tree-content')).toBeTruthy();
    });

    // 1. Employee node is rendered exactly once (deduplicated and single placement)
    const matchedNodes = screen.getAllByTestId(`employee-${conflictedEmployee.employee.id}`);
    expect(matchedNodes).toHaveLength(1);
    const employeeNode = matchedNodes[0]!;

    // 2. Authoritative reportsToId placed the employee strictly under Manager A
    const managerAReports = screen.getByTestId(`manager-reports-${managerA.employee.id}`);
    expect(managerAReports.contains(employeeNode)).toBe(true);

    // 3. Manager B does NOT contain the employee
    const managerBBranch = screen.getByTestId(`manager-branch-${managerB.employee.id}`);
    expect(managerBBranch.contains(employeeNode)).toBe(false);
  });

  it('implements genuine accessible nested list semantics and deterministic sorting order', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', standardLines);

    render(<TeamWorkspace role="founder" port={port} />);

    await waitFor(() => {
      expect(screen.getByTestId('team-tree-content')).toBeTruthy();
    });

    // 1. Accessible region and list semantics
    const treeRegion = screen.getByRole('region', { name: 'Reporting hierarchy' });
    expect(treeRegion).toBeTruthy();

    const branchesList = screen.getByRole('list', { name: 'Reporting branches' });
    expect(branchesList).toBeTruthy();
    expect(branchesList.tagName.toLowerCase()).toBe('ul');

    const managerSubbranch = screen.getByRole('list', { name: `Direct reports to ${managerLine.employee.name}` });
    expect(managerSubbranch).toBeTruthy();
    expect(managerSubbranch.tagName.toLowerCase()).toBe('ul');

    // 2. Direct reports under manager are sorted by seniority (Senior Staff -> Staff -> Trainee)
    const reportCards = managerSubbranch.querySelectorAll('[data-testid^="employee-"]');
    expect(reportCards).toHaveLength(3);
    expect(reportCards[0]?.getAttribute('data-testid')).toBe(`employee-${seniorStaffLine.employee.id}`);
    expect(reportCards[1]?.getAttribute('data-testid')).toBe(`employee-${staffLine.employee.id}`);
    expect(reportCards[2]?.getAttribute('data-testid')).toBe(`employee-${traineeLine.employee.id}`);
  });
});
