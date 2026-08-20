export type MermaidCaseStatus = 'stable' | 'experimental' | 'legacy' | 'utility' | 'external'

interface MermaidCaseBase {
  /** Stable, human-readable id used in test and report output. */
  id: string
  /** Maintenance signal; experimental syntax is expected to change upstream. */
  status: MermaidCaseStatus
  source: string
}

export interface MermaidSupportedCase extends MermaidCaseBase {
  /** Whether the full Mermaid UMD bundled by this plugin should render it. */
  expected: 'supported'
  /** Mermaid detector id expected from detectType(). */
  expectedType: string
  /** parse() may normalize a legacy detector to its current renderer id. */
  expectedParseType?: string
  /** Disable only when the renderer requires layout APIs unavailable in jsdom. */
  renderInJsdom?: boolean
}

export interface MermaidUnsupportedCase extends MermaidCaseBase {
  expected: 'unsupported'
}

export type MermaidSupportCase = MermaidSupportedCase | MermaidUnsupportedCase

export function isSupportedCase(testCase: MermaidSupportCase): testCase is MermaidSupportedCase {
  return testCase.expected === 'supported'
}

/**
 * Compatibility catalog for the full Mermaid UMD used by dsh-mermaid.
 *
 * Keep one minimal example for every detector registered by the lockfile's
 * Mermaid version. `mermaid-compat.spec.ts` fails if Mermaid adds/removes a
 * detector without a corresponding catalog entry, making upgrades explicit.
 */
export const MERMAID_SUPPORT_CASES: readonly MermaidSupportCase[] = [
  {
    id: 'flowchart', expectedType: 'flowchart-v2', status: 'stable', expected: 'supported',
    source: 'flowchart TD\n  A[Start] --> B[Done]',
  },
  {
    id: 'graph-legacy', expectedType: 'flowchart', expectedParseType: 'flowchart-v2', status: 'legacy', expected: 'supported',
    source: 'graph TD\n  A[Start] --> B[Done]',
  },
  {
    id: 'flowchart-elk', expectedType: 'flowchart-elk', status: 'experimental', expected: 'supported',
    source: 'flowchart-elk TD\n  A[Start] --> B[Done]',
  },
  {
    id: 'sequence', expectedType: 'sequence', status: 'stable', expected: 'supported',
    source: 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi',
  },
  {
    id: 'class', expectedType: 'class', status: 'stable', expected: 'supported',
    source: 'classDiagram\n  class Animal\n  Animal : +String name',
  },
  {
    id: 'class-v2', expectedType: 'classDiagram', status: 'legacy', expected: 'supported',
    source: 'classDiagram-v2\n  class Animal\n  Animal : +String name',
  },
  {
    id: 'state', expectedType: 'state', expectedParseType: 'stateDiagram', status: 'stable', expected: 'supported',
    source: 'stateDiagram\n  [*] --> Ready\n  Ready --> [*]',
  },
  {
    id: 'state-v2', expectedType: 'stateDiagram', status: 'legacy', expected: 'supported',
    source: 'stateDiagram-v2\n  [*] --> Ready\n  Ready --> [*]',
  },
  {
    id: 'entity-relationship', expectedType: 'er', status: 'stable', expected: 'supported',
    source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
  },
  {
    id: 'user-journey', expectedType: 'journey', status: 'stable', expected: 'supported',
    source: 'journey\n  title Working day\n  section Build\n    Write code: 5: Developer',
  },
  {
    id: 'gantt', expectedType: 'gantt', status: 'stable', expected: 'supported',
    source: 'gantt\n  title Delivery\n  dateFormat YYYY-MM-DD\n  section Build\n  Implement :a1, 2026-01-01, 1d',
  },
  {
    id: 'pie', expectedType: 'pie', status: 'stable', expected: 'supported',
    source: 'pie title Share\n  "A" : 60\n  "B" : 40',
  },
  {
    id: 'quadrant', expectedType: 'quadrantChart', status: 'stable', expected: 'supported',
    source: 'quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  Candidate: [0.4, 0.7]',
  },
  {
    id: 'requirement', expectedType: 'requirement', status: 'stable', expected: 'supported',
    source: 'requirementDiagram\n  requirement test_req {\n    id: 1\n    text: It works\n    risk: low\n    verifymethod: test\n  }',
  },
  {
    id: 'git-graph', expectedType: 'gitGraph', status: 'stable', expected: 'supported',
    source: 'gitGraph\n  commit\n  branch feature\n  commit',
  },
  {
    id: 'c4', expectedType: 'c4', status: 'experimental', expected: 'supported',
    source: 'C4Context\n  title Context\n  Person(user, "User")\n  System(app, "Application")\n  Rel(user, app, "Uses")',
  },
  {
    id: 'mindmap', expectedType: 'mindmap', status: 'stable', expected: 'supported',
    renderInJsdom: false,
    source: 'mindmap\n  root((Root))\n    Child\n      Leaf',
  },
  {
    id: 'timeline', expectedType: 'timeline', status: 'stable', expected: 'supported',
    source: 'timeline\n  title History\n  2025 : Started\n  2026 : Shipped',
  },
  {
    id: 'sankey', expectedType: 'sankey', status: 'experimental', expected: 'supported',
    source: 'sankey-beta\n  Source,Middle,10\n  Middle,Sink,7',
  },
  {
    id: 'xy-chart', expectedType: 'xychart', status: 'experimental', expected: 'supported',
    source: 'xychart-beta\n  x-axis [Jan, Feb, Mar]\n  y-axis "Sales" 0 --> 10\n  bar [3, 7, 5]',
  },
  {
    id: 'block', expectedType: 'block', status: 'experimental', expected: 'supported',
    source: 'block\n  columns 2\n  a["Start"] b["Done"]',
  },
  {
    id: 'packet', expectedType: 'packet', status: 'experimental', expected: 'supported',
    source: 'packet-beta\n  0-7: "Header"\n  8-15: "Payload"',
  },
  {
    id: 'kanban', expectedType: 'kanban', status: 'experimental', expected: 'supported',
    source: 'kanban\n  todo[Todo]\n    task1[Write tests]\n  done[Done]\n    task2[Ship]',
  },
  {
    id: 'architecture', expectedType: 'architecture', status: 'experimental', expected: 'supported',
    source: 'architecture-beta\n  service client(internet)[Client]\n  service server(server)[Server]\n  client:R --> L:server',
  },
  {
    id: 'radar', expectedType: 'radar', status: 'experimental', expected: 'supported',
    source: 'radar-beta\n  axis Quality, Speed, Safety\n  curve Product{8, 6, 9}\n  max 10\n  min 0',
  },
  {
    id: 'event-modeling', expectedType: 'eventmodeling', status: 'experimental', expected: 'supported',
    source: 'eventmodeling\n  tf 01 ui CartUI\n  tf 02 cmd AddItem\n  tf 03 evt ItemAdded',
  },
  {
    id: 'treemap', expectedType: 'treemap', status: 'experimental', expected: 'supported',
    source: 'treemap-beta\n  "Products"\n    "Desktop": 40\n    "Mobile": 60',
  },
  {
    id: 'venn', expectedType: 'venn', status: 'experimental', expected: 'supported',
    source: 'venn-beta\n  set A["Readers"]\n  set B["Writers"]\n  union A,B["Both"]',
  },
  {
    id: 'ishikawa', expectedType: 'ishikawa', status: 'experimental', expected: 'supported',
    source: 'ishikawa-beta\n  Slow delivery\n    People\n      Training\n    Process\n      Handoffs',
  },
  {
    id: 'wardley', expectedType: 'wardley', status: 'experimental', expected: 'supported',
    source: 'wardley-beta\n  title Value Chain\n  component User [0.95, 0.05]\n  component Service [0.70, 0.40]\n  User -> Service',
  },
  {
    id: 'cynefin', expectedType: 'cynefin', status: 'experimental', expected: 'supported',
    source: 'cynefin-beta\n  title Decisions\n  complex\n    "Experiment"\n  complicated\n    "Analyze"\n  clear\n    "Follow procedure"\n  chaotic\n    "Act now"\n  confusion\n    "Classify"',
  },
  {
    id: 'tree-view', expectedType: 'treeView', status: 'experimental', expected: 'supported',
    source: 'treeView-beta\n  project/\n    src/\n      index.ts\n    package.json',
  },
  {
    id: 'swimlane', expectedType: 'swimlane', status: 'experimental', expected: 'supported',
    source: 'swimlane-beta LR\n  subgraph Customer\n    request[Request]\n  end\n  subgraph Support\n    answer[Answer]\n  end\n  request --> answer',
  },
  {
    id: 'railroad-native', expectedType: 'railroad', status: 'experimental', expected: 'supported',
    source: 'railroad-beta\n  expression = choice(terminal("yes"), terminal("no")) ;',
  },
  {
    id: 'railroad-ebnf', expectedType: 'railroadEbnf', status: 'experimental', expected: 'supported',
    source: 'railroad-ebnf-beta\n  expression = "yes" | "no" ;',
  },
  {
    id: 'railroad-abnf', expectedType: 'railroadAbnf', status: 'experimental', expected: 'supported',
    source: 'railroad-abnf-beta\n  expression = "yes" / "no" ;',
  },
  {
    id: 'railroad-peg', expectedType: 'railroadPeg', status: 'experimental', expected: 'supported',
    source: 'railroad-peg-beta\n  expression <- "yes" / "no" ;',
  },
  {
    id: 'info', expectedType: 'info', status: 'utility', expected: 'supported',
    source: 'info',
  },
  {
    id: 'zenuml', status: 'external', expected: 'unsupported',
    source: 'zenuml\n  Alice->Bob: Hello',
  },
]
