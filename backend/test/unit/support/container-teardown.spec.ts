import { describe, expect, it } from 'vitest';
import { type ContainerTeardownSteps, teardownContainer } from '../../support/postgres.js';

/**
 * Desmontaje de Testcontainers (research: "409 en el desmontaje"): el `rm` nunca se envía mientras Docker no haya
 * confirmado que el contenedor terminó, y si no termina a tiempo el error es explícito (sin `force` ni reintentos).
 */
function fakeSteps(exitAfterMs: number | 'never', calls: string[]): ContainerTeardownSteps {
  let running = true;
  return {
    id: 'abc123',
    stop: () => {
      calls.push('stop');
      return Promise.resolve();
    },
    waitNotRunning: () =>
      new Promise((resolve) => {
        calls.push('wait');
        if (exitAfterMs === 'never') return;
        setTimeout(() => {
          running = false;
          calls.push('exited');
          resolve(undefined);
        }, exitAfterMs);
      }),
    status: () => Promise.resolve(running ? 'running' : 'exited'),
    remove: () => {
      // Docker responde 409 si el contenedor sigue en marcha: la prueba falla si el orden es incorrecto.
      if (running) return Promise.reject(new Error('(HTTP code 409) container is running'));
      calls.push('remove');
      return Promise.resolve();
    },
  };
}

describe('teardownContainer', () => {
  it('stop → espera a que Docker confirme la salida → remove, aunque la salida tarde', async () => {
    const calls: string[] = [];
    await teardownContainer(fakeSteps(150, calls), 5_000);
    expect(calls).toEqual(['stop', 'wait', 'exited', 'remove']);
  });

  it('si el contenedor no termina dentro del límite: error con el estado y sin remove', async () => {
    const calls: string[] = [];
    await expect(teardownContainer(fakeSteps('never', calls), 50)).rejects.toThrow(
      /abc123 sigue en estado running 50 ms después del stop/,
    );
    expect(calls).toEqual(['stop', 'wait']);
  });

  it('un fallo del stop se propaga y no se intenta remove', async () => {
    const calls: string[] = [];
    const steps = { ...fakeSteps(0, calls), stop: () => Promise.reject(new Error('stop falló')) };
    await expect(teardownContainer(steps, 1_000)).rejects.toThrow('stop falló');
    expect(calls).toEqual([]);
  });
});
