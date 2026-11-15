export type DiagnosticCategory =
  | 'filesystem'
  | 'parse'
  | 'specification'
  | 'reference'
  | 'semantic'
  | 'unsupported'
  | 'comparison'
  | 'configuration'
  | 'integration'
  | 'limit'
  | 'internal';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';
