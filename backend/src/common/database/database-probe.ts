/**
 * Comprobación técnica de conectividad con PostgreSQL para `/health/ready` (T028).
 *
 * Alcance deliberadamente mínimo: solo responde si la base acepta conexiones y ejecuta `SELECT 1` con la credencial de
 * runtime (`kuota_app_login`). No fija contexto de tenant, no lee tablas y no ofrece acceso a datos: el acceso a datos
 * de negocio es exclusivo de `withTenant` (T039, ADR-0004). Que responda no prueba que RLS o el esquema estén bien; eso
 * lo cubren las pruebas de aislamiento (US2).
 */
export interface DatabaseProbe {
  /** Resuelve si PostgreSQL respondió dentro del límite de tiempo; rechaza en cualquier otro caso. */
  ping(): Promise<void>;
}

export const DATABASE_PROBE = Symbol('DATABASE_PROBE');

/** Límite total de una comprobación (conexión + consulta). Las sondas de orquestador suelen esperar 1–5 s. */
export const DATABASE_PROBE_TIMEOUT_MS = 2_000;
