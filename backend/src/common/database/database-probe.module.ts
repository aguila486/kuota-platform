import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { DATABASE_PROBE } from './database-probe.js';
import { PgConnectivityProbe } from './pg-connectivity-probe.js';

/** Provee `DATABASE_PROBE` con la credencial de runtime. Solo lo importa el módulo health (.dependency-cruiser.cjs). */
@Module({
  providers: [
    {
      provide: DATABASE_PROBE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new PgConnectivityProbe(config.database.appUrl),
    },
  ],
  exports: [DATABASE_PROBE],
})
export class DatabaseProbeModule {}
