export const ARTIFACT_ERROR_CODES = [
  'ARTIFACT_SCHEMA_INVALID',
  'ARTIFACT_SEMANTIC_INVALID',
  'ARTIFACT_SENSITIVE_DATA_DETECTED',
  'ARTIFACT_SOURCE_INVALID',
  'ARTIFACT_SOURCE_NOT_SUCCESSFUL',
  'ARTIFACT_PARAMETER_BINDING_INVALID',
  'ARTIFACT_OUTPUT_BINDING_INVALID',
  'ARTIFACT_VERSION_INVALID',
  'ARTIFACT_VERSION_ALREADY_EXISTS',
  'ARTIFACT_NOT_FOUND',
  'ARTIFACT_PATH_INVALID',
  'ARTIFACT_IO_ERROR',
] as const;

export type ArtifactErrorCode = (typeof ARTIFACT_ERROR_CODES)[number];

export class ArtifactError extends Error {
  constructor(
    readonly code: ArtifactErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ArtifactError';
  }
}
