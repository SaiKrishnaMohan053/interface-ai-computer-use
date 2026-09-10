export {
  parseTargetSpec,
  targetSpecSchema,
  targetStrategySchema,
  targetTextMatchSchema,
} from './target-spec.js';

export { TargetResolver } from './target-resolver.js';

export { createTableCellTargetSpec } from './structural-target.js';

export type { TargetSpec, TargetStrategy, TargetTextMatch } from './target-spec.js';

export type {
  TargetResolutionAttempt,
  TargetResolverRequest,
  TargetResolverResult,
} from './target-resolver.js';

export type { TableCellTargetSpecInput } from './structural-target.js';
