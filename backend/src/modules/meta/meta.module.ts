import { Module } from '@nestjs/common';
import { CompatibilityController } from './compatibility.controller.js';

/** Metadatos públicos del servicio (T029). */
@Module({ controllers: [CompatibilityController] })
export class MetaModule {}
