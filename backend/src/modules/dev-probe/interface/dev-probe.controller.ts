import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { KuotaProblemError } from '../../../common/errors/problem.js';
import { IdempotencyKeyHeader, IdempotencyKeyPipe } from '../../../common/idempotency/idempotency-key.pipe.js';
import { DevTenantGuard } from '../../../common/tenant-context/dev-tenant.guard.js';
import { DevProbeService } from '../application/dev-probe.service.js';
import {
  asValidationError,
  decodeCursor,
  type DevProbeItemJson,
  type DevProbeItemPageJson,
  encodeCursor,
  normalizeId,
  parseCreateBody,
  parseLimit,
  parseUpdateBody,
  toJson,
} from './dev-probe.http.js';

const requireId = (raw: string): string => {
  const id = normalizeId(raw);
  if (id === null) throw new KuotaProblemError('not-found');
  return id;
};

/**
 * `/v1/dev/probe-items` (T042; contrato `dev-probe`). Recurso técnico NO productivo: el módulo solo se registra en
 * local/testing con el contexto técnico habilitado (FR-040, R-05); fuera de ahí las rutas no existen (404).
 *
 * El contexto de tenant lo fija `DevTenantGuard` (encabezado técnico, NO autenticación). Ningún campo del body, query o
 * path fija el tenant: un `tenant_id` en el body es una propiedad no permitida (400).
 */
@Controller('dev/probe-items')
@UseGuards(DevTenantGuard)
export class DevProbeController {
  constructor(private readonly service: DevProbeService) {}

  /**
   * `createDevProbeItem`: exige `Idempotency-Key` válida (formato). La deduplicación y la auditoría son US6
   * (T076, T078): hoy la clave se valida pero no se almacena.
   */
  @Post()
  async create(
    @IdempotencyKeyHeader(IdempotencyKeyPipe) _idempotencyKey: string,
    @Body() body: unknown,
  ): Promise<DevProbeItemJson> {
    const input = parseCreateBody(body);
    const item = await asValidationError(() => this.service.createDevProbeItem(input.label, input.sampleAmount));
    return toJson(item);
  }

  @Get()
  async list(@Query('limit') limit?: unknown, @Query('cursor') cursor?: unknown): Promise<DevProbeItemPageJson> {
    const page = await this.service.listDevProbeItems(parseLimit(limit), decodeCursor(cursor));
    return { data: page.items.map(toJson), next_cursor: encodeCursor(page.nextAfterId) };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<DevProbeItemJson> {
    return toJson(await this.service.getDevProbeItem(requireId(id)));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown): Promise<DevProbeItemJson> {
    const input = parseUpdateBody(body);
    const itemId = requireId(id);
    const item = await asValidationError(() => this.service.updateDevProbeItem(itemId, input.label, input.version));
    return toJson(item);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.deleteDevProbeItem(requireId(id));
  }
}
