import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { InterventionNotFoundError } from './intervention-errors.js';

import type { InterventionController } from './intervention-controller.js';

import type { InterventionManager } from './intervention-manager.js';

import type { LiveInterventionRegistry } from './live-intervention-registry.js';

import { toOperatorInterventionView } from './operator-control-types.js';

const OPERATOR_CONTROL_HOST = '127.0.0.1';

const DEFAULT_OPERATOR_CONTROL_PORT = 4177;

const MAX_REQUEST_BODY_BYTES = 16 * 1024;

export interface OperatorControlServerDependencies {
  manager: InterventionManager;

  controller: InterventionController;

  liveRegistry: LiveInterventionRegistry;
}

export interface OperatorControlServerOptions {
  port?: number;
}

export interface OperatorControlServerAddress {
  host: string;

  port: number;

  baseUrl: string;
}

interface AcquireBody {
  acquisitionId?: string;

  operatorId?: string;
}

interface OperatorIdentityBody {
  operatorId?: string;
}

export class OperatorControlServer {
  private server: Server | undefined;

  private address: OperatorControlServerAddress | undefined;

  constructor(
    private readonly dependencies: OperatorControlServerDependencies,

    private readonly options: OperatorControlServerOptions = {},
  ) {}

  async start(): Promise<OperatorControlServerAddress> {
    if (this.server !== undefined) {
      throw new Error('Operator control server is already started');
    }

    const server = createServer((request, response) => {
      void this.handle(request, response);
    });

    this.server = server;

    const requestedPort = this.options.port ?? DEFAULT_OPERATOR_CONTROL_PORT;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening);

        reject(error);
      };

      const onListening = (): void => {
        server.off('error', onError);

        resolve();
      };

      server.once('error', onError);

      server.once('listening', onListening);

      server.listen(requestedPort, OPERATOR_CONTROL_HOST);
    });

    const rawAddress = server.address();

    if (rawAddress === null || typeof rawAddress === 'string') {
      await this.close();

      throw new Error('Operator control server did not bind a TCP address');
    }

    this.address = {
      host: OPERATOR_CONTROL_HOST,

      port: rawAddress.port,

      baseUrl: `http://${OPERATOR_CONTROL_HOST}:${rawAddress.port}`,
    };

    return this.address;
  }

  getAddress(): OperatorControlServerAddress {
    if (this.address === undefined) {
      throw new Error('Operator control server is not started');
    }

    return this.address;
  }

  async close(): Promise<void> {
    const server = this.server;

    this.server = undefined;
    this.address = undefined;

    if (server === undefined) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
          return;
        }

        reject(error);
      });
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const method = request.method ?? 'GET';

      const url = new URL(request.url ?? '/', `http://${OPERATOR_CONTROL_HOST}`);

      if (method === 'GET' && url.pathname === '/interventions') {
        const records = await this.dependencies.manager.list();

        this.sendJson(
          response,
          200,
          records.map((record) =>
            toOperatorInterventionView({
              request: record.request,

              ...(record.acquisition === undefined
                ? {}
                : {
                    acquisition: record.acquisition,
                  }),

              auditTrail: record.auditTrail,
            }),
          ),
        );

        return;
      }

      const route = this.parseInterventionRoute(url.pathname);

      if (route === null) {
        this.sendJson(response, 404, {
          error: 'NOT_FOUND',
        });

        return;
      }

      if (method === 'GET' && route.action === null) {
        const record = await this.dependencies.manager.get(route.interventionId);

        this.sendJson(
          response,
          200,
          toOperatorInterventionView({
            request: record.request,

            ...(record.acquisition === undefined
              ? {}
              : {
                  acquisition: record.acquisition,
                }),

            auditTrail: record.auditTrail,
          }),
        );

        return;
      }

      if (method === 'POST' && route.action === 'acquire') {
        const body = await this.readAcquireBody(request);

        const context = this.dependencies.liveRegistry.get(route.interventionId);

        await this.dependencies.controller.acquireHumanControl({
          interventionId: route.interventionId,

          context,

          acquisitionId: body.acquisitionId ?? randomUUID(),

          ...(body.operatorId === undefined
            ? {}
            : {
                operatorId: body.operatorId,
              }),
        });

        const record = await this.dependencies.manager.get(route.interventionId);

        this.sendJson(
          response,
          200,
          toOperatorInterventionView({
            request: record.request,

            ...(record.acquisition === undefined
              ? {}
              : {
                  acquisition: record.acquisition,
                }),

            auditTrail: record.auditTrail,
          }),
        );

        return;
      }

      if (method === 'POST' && route.action === 'start') {
        const context = this.dependencies.liveRegistry.get(route.interventionId);

        if (context.sessionManager.state !== 'PAUSED' || context.sessionManager.owner !== 'HUMAN') {
          throw new Error(
            `Human work requires PAUSED/HUMAN session ownership; received ${context.sessionManager.state}/${context.sessionManager.owner}`,
          );
        }

        await this.dependencies.controller.markHumanWorkInProgress(route.interventionId);

        const record = await this.dependencies.manager.get(route.interventionId);

        this.sendJson(
          response,
          200,
          toOperatorInterventionView({
            request: record.request,

            ...(record.acquisition === undefined
              ? {}
              : {
                  acquisition: record.acquisition,
                }),

            auditTrail: record.auditTrail,
          }),
        );

        return;
      }

      if (method === 'POST' && route.action === 'manual-action') {
        const body = await this.readManualActionBody(request);

        const context = this.dependencies.liveRegistry.get(route.interventionId);

        if (context.sessionManager.state !== 'PAUSED' || context.sessionManager.owner !== 'HUMAN') {
          throw new Error(
            `Manual human action requires PAUSED/HUMAN session ownership; received ${context.sessionManager.state}/${context.sessionManager.owner}`,
          );
        }

        await this.dependencies.controller.recordManualAction({
          interventionId: route.interventionId,

          summary: body.summary,

          ...(body.operatorId === undefined
            ? {}
            : {
                operatorId: body.operatorId,
              }),
        });

        const record = await this.dependencies.manager.get(route.interventionId);

        this.sendJson(
          response,
          200,
          toOperatorInterventionView({
            request: record.request,

            ...(record.acquisition === undefined
              ? {}
              : {
                  acquisition: record.acquisition,
                }),

            auditTrail: record.auditTrail,
          }),
        );

        return;
      }

      if (method === 'POST' && route.action === 'resume') {
        const body = await this.readOperatorIdentityBody(request);

        const context = this.dependencies.liveRegistry.get(route.interventionId);

        await this.dependencies.controller.resumeAutomation({
          interventionId: route.interventionId,

          context,

          ...(body.operatorId === undefined
            ? {}
            : {
                operatorId: body.operatorId,
              }),
        });

        const record = await this.dependencies.manager.get(route.interventionId);

        this.sendJson(
          response,
          200,
          toOperatorInterventionView({
            request: record.request,

            ...(record.acquisition === undefined
              ? {}
              : {
                  acquisition: record.acquisition,
                }),

            auditTrail: record.auditTrail,
          }),
        );

        return;
      }

      if (method === 'POST' && route.action === 'abort') {
        const body = await this.readOperatorIdentityBody(request);

        const context = this.dependencies.liveRegistry.get(route.interventionId);

        await this.dependencies.controller.abortHumanIntervention({
          interventionId: route.interventionId,

          context,

          ...(body.operatorId === undefined
            ? {}
            : {
                operatorId: body.operatorId,
              }),
        });

        const record = await this.dependencies.manager.get(route.interventionId);

        this.sendJson(
          response,
          200,
          toOperatorInterventionView({
            request: record.request,

            ...(record.acquisition === undefined
              ? {}
              : {
                  acquisition: record.acquisition,
                }),

            auditTrail: record.auditTrail,
          }),
        );

        return;
      }

      this.sendJson(response, 405, {
        error: 'METHOD_NOT_ALLOWED',
      });
    } catch (error) {
      this.handleError(response, error);
    }
  }

  private parseInterventionRoute(pathname: string): {
    interventionId: string;

    action: 'acquire' | 'start' | 'manual-action' | 'resume' | 'abort' | null;
  } | null {
    const parts = pathname.split('/').filter((part) => part.length > 0);

    if (parts[0] !== 'interventions' || parts.length < 2 || parts.length > 3) {
      return null;
    }

    const interventionId = decodeURIComponent(parts[1] ?? '');

    if (interventionId.trim().length === 0) {
      return null;
    }

    if (parts.length === 2) {
      return {
        interventionId,
        action: null,
      };
    }

    const action = parts[2];

    if (
      action !== 'acquire' &&
      action !== 'start' &&
      action !== 'manual-action' &&
      action !== 'resume' &&
      action !== 'abort'
    ) {
      return null;
    }

    return {
      interventionId,
      action,
    };
  }

  private async readAcquireBody(request: IncomingMessage): Promise<AcquireBody> {
    const chunks: Uint8Array[] = [];

    let totalBytes = 0;

    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      totalBytes += buffer.length;

      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        throw new Error('Operator request body is too large');
      }

      chunks.push(buffer);
    }

    if (chunks.length === 0) {
      return {};
    }

    const text = Buffer.concat(chunks).toString('utf8');

    if (text.trim().length === 0) {
      return {};
    }

    const parsed: unknown = JSON.parse(text);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Acquire request body must be a JSON object');
    }

    const body = parsed as Record<string, unknown>;

    const acquisitionId = body.acquisitionId;

    const operatorId = body.operatorId;

    if (
      acquisitionId !== undefined &&
      (typeof acquisitionId !== 'string' || acquisitionId.trim().length === 0)
    ) {
      throw new Error('acquisitionId must be a non-empty string');
    }

    if (
      operatorId !== undefined &&
      (typeof operatorId !== 'string' || operatorId.trim().length === 0)
    ) {
      throw new Error('operatorId must be a non-empty string');
    }

    return {
      ...(typeof acquisitionId === 'string'
        ? {
            acquisitionId: acquisitionId.trim(),
          }
        : {}),

      ...(typeof operatorId === 'string'
        ? {
            operatorId: operatorId.trim(),
          }
        : {}),
    };
  }

  private async readOperatorIdentityBody(request: IncomingMessage): Promise<OperatorIdentityBody> {
    const chunks: Uint8Array[] = [];

    let totalBytes = 0;

    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      totalBytes += buffer.length;

      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        throw new Error('Operator request body is too large');
      }

      chunks.push(buffer);
    }

    if (chunks.length === 0) {
      return {};
    }

    const text = Buffer.concat(chunks).toString('utf8');

    if (text.trim().length === 0) {
      return {};
    }

    const parsed: unknown = JSON.parse(text);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Operator request body must be a JSON object');
    }

    const body = parsed as Record<string, unknown>;

    if (
      body.operatorId !== undefined &&
      (typeof body.operatorId !== 'string' || body.operatorId.trim().length === 0)
    ) {
      throw new Error('operatorId must be a non-empty string');
    }

    return {
      ...(typeof body.operatorId === 'string'
        ? {
            operatorId: body.operatorId.trim(),
          }
        : {}),
    };
  }

  private async readManualActionBody(request: IncomingMessage): Promise<{
    summary: string;

    operatorId?: string;
  }> {
    const chunks: Uint8Array[] = [];

    let totalBytes = 0;

    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      totalBytes += buffer.length;

      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        throw new Error('Operator request body is too large');
      }

      chunks.push(buffer);
    }

    const text = Buffer.concat(chunks).toString('utf8');

    if (text.trim().length === 0) {
      throw new Error('Manual action request body is required');
    }

    const parsed: unknown = JSON.parse(text);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Manual action request body must be a JSON object');
    }

    const body = parsed as Record<string, unknown>;

    if (typeof body.summary !== 'string' || body.summary.trim().length === 0) {
      throw new Error('summary must be a non-empty string');
    }

    if (
      body.operatorId !== undefined &&
      (typeof body.operatorId !== 'string' || body.operatorId.trim().length === 0)
    ) {
      throw new Error('operatorId must be a non-empty string');
    }

    return {
      summary: body.summary.trim(),

      ...(typeof body.operatorId === 'string'
        ? {
            operatorId: body.operatorId.trim(),
          }
        : {}),
    };
  }

  private handleError(response: ServerResponse, error: unknown): void {
    if (error instanceof InterventionNotFoundError) {
      this.sendJson(response, 404, {
        error: 'INTERVENTION_NOT_FOUND',

        message: error.message,
      });

      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown operator control error';

    const statusCode = message.includes('No live intervention context registered')
      ? 409
      : message.includes('cannot be acquired') ||
          message.includes('must be WAITING_FOR_HUMAN') ||
          message.includes('requires PAUSED') ||
          message.includes('Expected') ||
          message.includes('must be ACQUIRED') ||
          message.includes('requires HUMAN ownership') ||
          message.includes('handoff completion requires')
        ? 409
        : message.includes('request body') ||
            message.includes('acquisitionId') ||
            message.includes('operatorId') ||
            message.includes('summary') ||
            error instanceof SyntaxError
          ? 400
          : 500;

    this.sendJson(response, statusCode, {
      error:
        statusCode === 400 ? 'INVALID_REQUEST' : statusCode === 409 ? 'CONFLICT' : 'INTERNAL_ERROR',

      message,
    });
  }

  private sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.statusCode = statusCode;

    response.setHeader('content-type', 'application/json; charset=utf-8');

    response.setHeader('cache-control', 'no-store');

    response.end(JSON.stringify(body));
  }
}
